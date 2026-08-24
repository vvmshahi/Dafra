-- Stage D: isolated canonical Super Admin owner provisioning contract.
-- This does not alter the legacy create-owner-account endpoint or Phase 2 fiscal functions.

CREATE TABLE IF NOT EXISTS public.owner_account_provisioning_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  initiated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NULL REFERENCES public.tenant_subscriptions(id) ON DELETE RESTRICT,
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'requested',
  setup_link_generated boolean NOT NULL DEFAULT false,
  setup_link_error text NULL,
  last_error_code text NULL,
  failure_step text NULL,
  failure_code text NULL,
  failure_message_safe text NULL,
  failure_detail_safe text NULL,
  failure_hint_safe text NULL,
  failure_sqlstate text NULL,
  failure_source text NULL,
  failed_at timestamptz NULL,
  compensation_status text NOT NULL DEFAULT 'not_started',
  attempt_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_account_v2_state_check CHECK (state IN ('requested', 'auth_user_ready', 'complete', 'failed_recoverable', 'failed_manual_review')),
  CONSTRAINT owner_account_v2_key_check CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200)
);

ALTER TABLE public.owner_account_provisioning_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failure_step text NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failure_code text NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failure_message_safe text NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failure_detail_safe text NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failure_hint_safe text NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failure_sqlstate text NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failure_source text NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS failed_at timestamptz NULL;
ALTER TABLE public.owner_account_provisioning_v2 ADD COLUMN IF NOT EXISTS compensation_status text NOT NULL DEFAULT 'not_started';
REVOKE ALL ON TABLE public.owner_account_provisioning_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.owner_account_provisioning_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_owner_account_provisioning_v2(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_initiated_by uuid,
  p_request_payload jsonb
) RETURNS TABLE (
  operation_id uuid, state text, auth_user_id uuid, tenant_id uuid,
  subscription_id uuid, branch_id uuid, setup_link_generated boolean, is_replay boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE v_row public.owner_account_provisioning_v2%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_initiated_by AND role = 'super_admin' AND is_active IS TRUE
  ) THEN RAISE EXCEPTION 'PROVISIONING_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_idempotency_key), 704221));
  SELECT * INTO v_row FROM public.owner_account_provisioning_v2
    WHERE idempotency_key = btrim(p_idempotency_key) FOR UPDATE;
  IF FOUND THEN
    IF v_row.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    UPDATE public.owner_account_provisioning_v2
      SET attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN QUERY SELECT v_row.id, v_row.state, v_row.auth_user_id, v_row.tenant_id,
      v_row.subscription_id, v_row.branch_id, v_row.setup_link_generated, true;
    RETURN;
  END IF;
  INSERT INTO public.owner_account_provisioning_v2 (
    idempotency_key, request_fingerprint, initiated_by, request_payload
  ) VALUES (btrim(p_idempotency_key), p_request_fingerprint, p_initiated_by,
    jsonb_strip_nulls(p_request_payload)) RETURNING * INTO v_row;
  RETURN QUERY SELECT v_row.id, v_row.state, v_row.auth_user_id, v_row.tenant_id,
    v_row.subscription_id, v_row.branch_id, v_row.setup_link_generated, false;
END
$$;

CREATE OR REPLACE FUNCTION public.complete_owner_account_provisioning_v2(
  p_operation_id uuid, p_auth_user_id uuid
) RETURNS TABLE (
  operation_id uuid, state text, auth_user_id uuid, tenant_id uuid,
  subscription_id uuid, branch_id uuid, fiscal_regime text,
  fiscal_activation_state text, fiscal_policy_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_op public.owner_account_provisioning_v2%ROWTYPE;
  v_payload jsonb;
  v_tenant_id uuid;
  v_subscription_id uuid;
  v_branch_id uuid;
  v_plan public.subscription_plans%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_intent text;
  v_legacy_phase integer;
  v_failure_step text := 'begin_db_provisioning';
  v_sqlstate text;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  SELECT * INTO v_op FROM public.owner_account_provisioning_v2
    WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVISIONING_NOT_FOUND'; END IF;
  IF v_op.auth_user_id IS NOT NULL AND v_op.auth_user_id <> p_auth_user_id THEN
    RAISE EXCEPTION 'AUTH_IDENTITY_AMBIGUOUS';
  END IF;
  IF v_op.state = 'complete' THEN
    SELECT * INTO v_branch FROM public.branches WHERE id = v_op.branch_id;
    RETURN QUERY SELECT v_op.id, v_op.state, v_op.auth_user_id, v_op.tenant_id,
      v_op.subscription_id, v_op.branch_id, v_branch.fiscal_regime,
      v_branch.fiscal_activation_state, v_branch.fiscal_policy_revision;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_auth_user_id) THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_READY';
  END IF;
  v_payload := v_op.request_payload;
  IF v_payload->>'account_type' NOT IN ('production', 'demo') THEN RAISE EXCEPTION 'ACCOUNT_TYPE_INVALID'; END IF;
  IF v_payload->>'fiscal_intent' NOT IN ('generation', 'integration_setup') THEN RAISE EXCEPTION 'FISCAL_INTENT_INVALID'; END IF;
  IF NOT (v_payload->>'branch_count')::integer BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_BRANCH_ALLOWANCE'; END IF;
  SELECT p.* INTO v_plan FROM public.subscription_plans p
    WHERE p.id = (v_payload->>'plan_id')::uuid AND p.is_active IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_ELIGIBLE'; END IF;
  v_intent := CASE WHEN v_payload->>'fiscal_intent' = 'generation' THEN 'generation' ELSE 'integration' END;
  v_legacy_phase := CASE WHEN coalesce(v_plan.features, '[]'::jsonb) ? 'zatca_phase2' THEN 2 ELSE 1 END;

  v_failure_step := 'create_tenant';
  INSERT INTO public.tenants (
    name, name_ar, vat_number, cr_number, email, phone, city, address,
    country, is_active, max_branches, business_type, is_demo
  ) VALUES (
    btrim(v_payload->>'company_name'), nullif(btrim(v_payload->>'company_name_ar'), ''),
    nullif(btrim(v_payload->>'vat_number'), ''), nullif(btrim(v_payload->>'cr_number'), ''),
    lower(btrim(v_payload->>'email')), nullif(btrim(v_payload->>'phone'), ''),
    nullif(btrim(v_payload->>'city'), ''), nullif(btrim(v_payload->>'notes'), ''),
    'SA', true, (v_payload->>'branch_count')::integer,
    CASE WHEN v_payload->>'business_type' = 'service' THEN 'service' ELSE 'trading' END,
    (v_payload->>'account_type') = 'demo'
  ) RETURNING id INTO v_tenant_id;

  v_failure_step := 'link_owner_profile';
  INSERT INTO public.user_profiles (id, role, tenant_id, branch_id, full_name, email, is_active)
  VALUES (p_auth_user_id, 'owner', v_tenant_id, NULL, btrim(v_payload->>'company_name'),
    lower(btrim(v_payload->>'email')), true)
  ON CONFLICT ON CONSTRAINT user_profiles_pkey DO UPDATE SET tenant_id = EXCLUDED.tenant_id, branch_id = NULL,
    role = 'owner', full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    is_active = true, updated_at = now()
  WHERE public.user_profiles.tenant_id IS NULL;

  SELECT up.tenant_id INTO v_tenant_id FROM public.user_profiles up
    WHERE up.id = p_auth_user_id AND up.role = 'owner' AND up.is_active IS TRUE;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'OWNER_PROFILE_CONFLICT'; END IF;

  v_failure_step := 'create_subscription';
  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, starts_at, ends_at, trial_ends_at,
    cancelled_at, moyasar_subscription_id, paid_branch_count
  ) VALUES (
    v_tenant_id, (v_payload->>'plan_id')::uuid, 'active', now(),
    CASE WHEN coalesce((v_payload->>'duration_months')::integer, 0) = 0
      THEN NULL ELSE nullif(v_payload->>'ends_at', '')::timestamptz END,
    NULL, NULL,
    CASE WHEN coalesce((v_payload->>'duration_months')::integer, 0) = 0
      THEN 'Lifetime Free' ELSE nullif(concat_ws(' · ', nullif(v_payload->>'pay_method',''), nullif(v_payload->>'pay_ref','')), '') END,
    (v_payload->>'branch_count')::integer
  ) RETURNING id INTO v_subscription_id;

  v_failure_step := 'initialize_fiscal_policy';
  INSERT INTO public.tenant_fiscal_onboarding_intents (tenant_id, requested_regime, requested_by)
  VALUES (v_tenant_id, v_intent, v_op.initiated_by)
  ON CONFLICT ON CONSTRAINT tenant_fiscal_onboarding_intents_pkey DO UPDATE SET requested_regime = EXCLUDED.requested_regime,
    requested_by = EXCLUDED.requested_by, updated_at = now();

  v_failure_step := 'create_first_branch';
  INSERT INTO public.branches (
    tenant_id, name, business_name, phone, city, country, is_main_branch, is_active,
    vat_mode, invoice_prefix, invoice_language, show_logo, zatca_phase
  ) VALUES (
    v_tenant_id, btrim(v_payload->>'company_name'), btrim(v_payload->>'company_name'),
    nullif(btrim(v_payload->>'phone'), ''), nullif(btrim(v_payload->>'city'), ''),
    'SA', true, true, 'exclusive', 'INV', 'both', true, v_legacy_phase
  ) RETURNING id INTO v_branch_id;

  v_failure_step := 'finalize_db_provisioning';
  INSERT INTO public.tenant_onboarding_status (
    tenant_id, onboarding_status, owner_setup_status, branch_setup_status,
    zatca_setup_status, updated_by
  ) VALUES (v_tenant_id, 'owner_invited', 'owner_invited', 'first_branch_created',
    CASE WHEN v_intent = 'generation' THEN 'not_required' ELSE 'zatca_setup_pending' END,
    v_op.initiated_by)
  ON CONFLICT ON CONSTRAINT tenant_onboarding_status_tenant_id_key DO UPDATE SET onboarding_status = EXCLUDED.onboarding_status,
    owner_setup_status = EXCLUDED.owner_setup_status, branch_setup_status = EXCLUDED.branch_setup_status,
    zatca_setup_status = EXCLUDED.zatca_setup_status, updated_by = EXCLUDED.updated_by;

  SELECT * INTO v_branch FROM public.branches WHERE id = v_branch_id;
  UPDATE public.owner_account_provisioning_v2 SET
    auth_user_id = p_auth_user_id, tenant_id = v_tenant_id, subscription_id = v_subscription_id,
    branch_id = v_branch_id, state = 'complete', last_error_code = NULL, updated_at = now()
  WHERE id = v_op.id;
  RETURN QUERY SELECT v_op.id, 'complete'::text, p_auth_user_id, v_tenant_id,
    v_subscription_id, v_branch_id, v_branch.fiscal_regime,
    v_branch.fiscal_activation_state, v_branch.fiscal_policy_revision;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS
    v_sqlstate = RETURNED_SQLSTATE,
    v_message = MESSAGE_TEXT,
    v_detail = PG_EXCEPTION_DETAIL,
    v_hint = PG_EXCEPTION_HINT;
  v_message := left(regexp_replace(coalesce(v_message, 'DATABASE_ERROR'), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[REDACTED_EMAIL]', 'g'), 500);
  v_detail := left(regexp_replace(coalesce(v_detail, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[REDACTED_EMAIL]', 'g'), 500);
  v_hint := left(regexp_replace(coalesce(v_hint, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[REDACTED_EMAIL]', 'g'), 500);
  UPDATE public.owner_account_provisioning_v2 SET
    state = 'failed_recoverable', last_error_code = 'DB_PROVISIONING_FAILED',
    failure_step = v_failure_step, failure_code = coalesce(nullif(v_sqlstate, ''), 'UNKNOWN_DATABASE_ERROR'),
    failure_message_safe = nullif(v_message, ''), failure_detail_safe = nullif(v_detail, ''),
    failure_hint_safe = nullif(v_hint, ''), failure_sqlstate = nullif(v_sqlstate, ''),
    failure_source = 'complete_owner_account_provisioning_v2', failed_at = now(),
    compensation_status = 'db_rollback_complete', updated_at = now()
  WHERE id = v_op.id;
  RETURN QUERY SELECT v_op.id, 'failed_recoverable'::text, NULL::uuid, NULL::uuid,
    NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::bigint;
END
$$;

CREATE OR REPLACE FUNCTION public.set_owner_account_v2_setup_link(
  p_operation_id uuid, p_generated boolean, p_error text DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE public.owner_account_provisioning_v2
  SET setup_link_generated = p_generated, setup_link_error = p_error, updated_at = now()
  WHERE id = p_operation_id;
$$;

REVOKE ALL ON FUNCTION public.acquire_owner_account_provisioning_v2(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_owner_account_provisioning_v2(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_owner_account_v2_setup_link(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_owner_account_provisioning_v2(text,text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_owner_account_provisioning_v2(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_owner_account_v2_setup_link(uuid,boolean,text) TO service_role;
