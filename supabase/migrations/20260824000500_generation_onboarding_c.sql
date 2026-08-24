-- Stage C: business-facing fiscal-mode onboarding and canonical Generation readiness.
-- Source-only. Apply only through the controlled migration gate.

CREATE TABLE IF NOT EXISTS public.tenant_fiscal_onboarding_intents (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_regime text NOT NULL CHECK (requested_regime IN ('generation', 'integration')),
  requested_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_fiscal_onboarding_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_fiscal_onboarding_intents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tenant_fiscal_onboarding_intents TO service_role;

CREATE OR REPLACE FUNCTION public.capture_owner_fiscal_onboarding_intent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_regime text := CASE WHEN NEW.request_payload->>'fiscal_regime' = 'generation'
    THEN 'generation' ELSE 'integration' END;
BEGIN
  IF NEW.tenant_id IS NOT NULL AND (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    INSERT INTO public.tenant_fiscal_onboarding_intents (tenant_id, requested_regime, requested_by)
    VALUES (NEW.tenant_id, v_regime, NEW.initiated_by)
    ON CONFLICT (tenant_id) DO UPDATE SET
      requested_regime = EXCLUDED.requested_regime,
      requested_by = EXCLUDED.requested_by,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_owner_fiscal_intent ON public.owner_provisioning_requests;
CREATE TRIGGER trg_capture_owner_fiscal_intent
AFTER UPDATE OF tenant_id ON public.owner_provisioning_requests
FOR EACH ROW EXECUTE FUNCTION public.capture_owner_fiscal_onboarding_intent();

CREATE OR REPLACE FUNCTION public.apply_fiscal_onboarding_intent_to_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_regime text;
BEGIN
  SELECT requested_regime INTO v_regime
  FROM public.tenant_fiscal_onboarding_intents WHERE tenant_id = NEW.tenant_id;
  IF v_regime = 'generation' THEN
    NEW.fiscal_regime := 'generation';
    NEW.fiscal_activation_state := 'generation_active';
    NEW.fiscal_policy_revision := 1;
    -- B1 keeps this column non-null; it is intentionally not exposed in the UI.
    NEW.integration_environment := 'production';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_fiscal_onboarding_intent ON public.branches;
CREATE TRIGGER trg_apply_fiscal_onboarding_intent
BEFORE INSERT ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.apply_fiscal_onboarding_intent_to_branch();

CREATE OR REPLACE FUNCTION public.prevent_client_fiscal_policy_spoof()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' AND current_setting('app.fiscal_policy_transition', true) <> 'allow' AND (
    NEW.fiscal_regime IS DISTINCT FROM OLD.fiscal_regime OR
    NEW.integration_environment IS DISTINCT FROM OLD.integration_environment OR
    NEW.fiscal_policy_revision IS DISTINCT FROM OLD.fiscal_policy_revision OR
    NEW.fiscal_activation_state IS DISTINCT FROM OLD.fiscal_activation_state
  ) THEN
    RAISE EXCEPTION 'FISCAL_POLICY_SERVER_AUTHORITATIVE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_fiscal_policy_spoof ON public.branches;
CREATE TRIGGER trg_prevent_client_fiscal_policy_spoof
BEFORE UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_fiscal_policy_spoof();

CREATE OR REPLACE FUNCTION public.get_generation_readiness_v1(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_policy jsonb;
  v_branch public.branches%ROWTYPE;
  v_missing text[] := ARRAY[]::text[];
  v_integration_missing text[] := ARRAY[]::text[];
BEGIN
  v_policy := public.resolve_fiscal_policy(p_branch_id);
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id AND is_active IS TRUE;
  IF v_branch.id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  IF nullif(btrim(coalesce(v_branch.business_name, v_branch.display_name, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'business_name');
  END IF;
  IF v_branch.vat_number !~ '^[0-9]{15}$' THEN v_missing := array_append(v_missing, 'vat_number'); END IF;
  IF nullif(btrim(v_branch.name), '') IS NULL THEN v_missing := array_append(v_missing, 'branch_name'); END IF;
  IF nullif(btrim(v_branch.city), '') IS NULL THEN v_missing := array_append(v_missing, 'city'); END IF;
  IF nullif(btrim(v_branch.street), '') IS NULL THEN v_missing := array_append(v_missing, 'street'); END IF;
  IF nullif(btrim(v_branch.building_number), '') IS NULL THEN v_missing := array_append(v_missing, 'building_number'); END IF;
  IF nullif(btrim(v_branch.postal_code), '') IS NULL THEN v_missing := array_append(v_missing, 'postal_code'); END IF;
  IF nullif(btrim(v_branch.invoice_prefix), '') IS NULL THEN v_missing := array_append(v_missing, 'invoice_prefix'); END IF;

  IF v_branch.cr_number IS NULL THEN v_integration_missing := array_append(v_integration_missing, 'cr_number'); END IF;
  IF v_branch.fiscal_regime = 'generation' THEN
    v_integration_missing := array_append(v_integration_missing, 'zatca_connection');
  END IF;

  RETURN jsonb_build_object(
    'branchId', v_policy->>'branchId', 'fiscalRegime', v_policy->>'regime',
    'activationState', v_policy->>'activationState', 'policyRevision', (v_policy->>'policyRevision')::bigint,
    'generationReady', cardinality(v_missing) = 0,
    'generationMissingFields', to_jsonb(v_missing),
    'integrationReadiness', jsonb_build_object('ready', cardinality(v_integration_missing) = 0,
      'missingFields', to_jsonb(v_integration_missing))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_integration_setup_v1(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_policy jsonb; v_actor uuid := auth.uid(); v_role text;
BEGIN
  SELECT role::text INTO v_role FROM public.user_profiles WHERE id = v_actor AND is_active IS TRUE;
  IF v_role <> 'owner' THEN RAISE EXCEPTION 'INTEGRATION_SETUP_OWNER_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_policy := public.resolve_fiscal_policy(p_branch_id);
  IF v_policy->>'regime' <> 'generation' THEN RAISE EXCEPTION 'FISCAL_POLICY_INVALID' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.fiscal_policy_transition', 'allow', true);
  UPDATE public.branches SET fiscal_activation_state = 'integration_setup', fiscal_activated_at = now(), fiscal_activated_by = v_actor WHERE id = p_branch_id;
  RETURN public.resolve_fiscal_policy(p_branch_id);
END;
$$;

REVOKE ALL ON FUNCTION public.capture_owner_fiscal_onboarding_intent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_fiscal_onboarding_intent_to_branch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_client_fiscal_policy_spoof() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_generation_readiness_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_generation_readiness_v1(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.begin_integration_setup_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_integration_setup_v1(uuid) TO authenticated;
