-- Preserve the requested capability separately from the active credential's
-- verified capability. This is additive metadata only; existing credentials
-- and functionality_map values are not rewritten.
BEGIN;

ALTER TABLE public.zatca_production_credentials
  ADD COLUMN IF NOT EXISTS requested_functionality_map text,
  ADD COLUMN IF NOT EXISTS issued_functionality_map text;

ALTER TABLE public.zatca_production_credentials
  DROP CONSTRAINT IF EXISTS zatca_production_credentials_requested_functionality_map_check,
  DROP CONSTRAINT IF EXISTS zatca_production_credentials_issued_functionality_map_check;

ALTER TABLE public.zatca_production_credentials
  ADD CONSTRAINT zatca_production_credentials_requested_functionality_map_check
  CHECK (requested_functionality_map IS NULL OR requested_functionality_map IN ('0100', '1000', '1100'));
ALTER TABLE public.zatca_production_credentials
  ADD CONSTRAINT zatca_production_credentials_issued_functionality_map_check
  CHECK (issued_functionality_map IS NULL OR issued_functionality_map IN ('0100', '1000', '1100'));

COMMENT ON COLUMN public.zatca_production_credentials.requested_functionality_map IS
  'Owner-selected TSXY functionality map submitted for this onboarding attempt.';
COMMENT ON COLUMN public.zatca_production_credentials.issued_functionality_map IS
  'Verified functionality map issued by ZATCA when returned by the upstream contract.';

CREATE TABLE IF NOT EXISTS public.zatca_production_onboarding_reset_history (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  credential_row_id uuid NOT NULL,
  previous_status text NOT NULL,
  previous_functionality_map text,
  previous_last_error text,
  previous_updated_at timestamptz,
  reset_reason text NOT NULL,
  reset_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reset_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credential_row_id, reset_at)
);

ALTER TABLE public.zatca_production_onboarding_reset_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zatca_production_onboarding_reset_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zatca_production_onboarding_reset_history TO service_role;

CREATE OR REPLACE FUNCTION public.reset_failed_zatca_onboarding(
  p_branch_id uuid,
  p_actor_id uuid,
  p_reason text DEFAULT 'Owner requested a fresh Production onboarding attempt.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_profile record;
  v_branch record;
  v_current record;
  v_previous_reset record;
  v_reset_id uuid;
BEGIN
  SELECT id, role::text AS role, tenant_id, is_active INTO v_profile
  FROM public.user_profiles WHERE id = p_actor_id AND is_active IS TRUE;
  IF NOT FOUND OR v_profile.role NOT IN ('owner', 'super_admin') THEN
    RAISE EXCEPTION 'ZATCA_BRANCH_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT id, tenant_id, is_active INTO v_branch
  FROM public.branches WHERE id = p_branch_id AND tenant_id = v_profile.tenant_id FOR UPDATE;
  IF NOT FOUND OR NOT v_branch.is_active THEN
    RAISE EXCEPTION 'ZATCA_BRANCH_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_current
  FROM public.zatca_production_credentials
  WHERE branch_id = p_branch_id AND tenant_id = v_profile.tenant_id AND environment = 'production'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZATCA_RESET_NOT_ALLOWED' USING ERRCODE = 'P0001'; END IF;
  IF v_current.onboarding_status = 'production_connected'
     OR v_current.encrypted_production_csid IS NOT NULL THEN
    RAISE EXCEPTION 'ZATCA_ACTIVE_CREDENTIAL_EXISTS' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.onboarding_status = 'production_csid_requested' THEN
    RAISE EXCEPTION 'ZATCA_RECONCILIATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.onboarding_status = 'not_started' AND v_current.requested_functionality_map IS NULL THEN
    SELECT id INTO v_previous_reset FROM public.zatca_production_onboarding_reset_history
    WHERE credential_row_id = v_current.id ORDER BY reset_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'already_reset', true, 'branch_id', p_branch_id,
        'onboarding_status', 'not_started', 'reset_id', v_previous_reset.id);
    END IF;
    RAISE EXCEPTION 'ZATCA_RESET_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
  IF v_current.onboarding_status <> 'compliance_failed' THEN
    RAISE EXCEPTION 'ZATCA_RESET_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.zatca_production_onboarding_reset_history (
    tenant_id, branch_id, credential_row_id, previous_status,
    previous_functionality_map, previous_last_error, previous_updated_at,
    reset_reason, reset_by
  ) VALUES (
    v_profile.tenant_id, p_branch_id, v_current.id, v_current.onboarding_status,
    v_current.functionality_map, v_current.last_error, v_current.updated_at,
    coalesce(nullif(btrim(p_reason), ''), 'Owner requested a fresh Production onboarding attempt.'),
    p_actor_id
  ) RETURNING id INTO v_reset_id;
  UPDATE public.zatca_production_credentials
  SET onboarding_status = 'not_started',
      csr_common_name = NULL, csr_organization_name = NULL,
      csr_organizational_unit_name = NULL, csr_location = NULL, csr_industry = NULL,
      csr_pem = NULL, public_key_pem = NULL, encrypted_private_key = NULL,
      compliance_request_id = NULL, encrypted_compliance_csid = NULL,
      encrypted_compliance_secret = NULL, encrypted_production_csid = NULL,
      encrypted_production_secret = NULL, compliance_sample_results = '[]'::jsonb,
      last_error = NULL, connected_at = NULL, disconnected_at = NULL,
      requested_functionality_map = NULL, issued_functionality_map = NULL,
      updated_by = p_actor_id, updated_at = now()
  WHERE id = v_current.id;
  IF to_regprocedure('public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'zatca_onboarding_failed_reset', v_profile.tenant_id, p_branch_id, p_actor_id,
      v_profile.role, 'branch', p_branch_id, 'warning', 'succeeded',
      jsonb_build_object('reset_id', v_reset_id, 'previous_status', v_current.onboarding_status), NULL, NULL
    );
  END IF;
  RETURN jsonb_build_object('ok', true, 'already_reset', false, 'branch_id', p_branch_id,
    'onboarding_status', 'not_started', 'reset_id', v_reset_id);
END
$function$;

ALTER FUNCTION public.reset_failed_zatca_onboarding(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reset_failed_zatca_onboarding(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_failed_zatca_onboarding(uuid, uuid, text) TO service_role;

COMMIT;
