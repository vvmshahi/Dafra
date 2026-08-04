-- Keep failed/revoked Trading Sandbox rows as immutable history while allowing
-- one new current onboarding record for a restart.
BEGIN;

DROP INDEX IF EXISTS public.zatca_sandbox_credentials_one_current_onboarding_uidx;

CREATE UNIQUE INDEX zatca_sandbox_credentials_one_current_onboarding_uidx
  ON public.zatca_sandbox_credentials (tenant_id, branch_id, environment)
  WHERE status IN ('pending', 'compliance', 'active');

-- Serialize CSR-record creation per Trading branch.  Failed/revoked rows are
-- deliberately excluded from the current-record lookup so retries are
-- idempotent for an existing current record and create one fresh record after
-- a failed attempt.
CREATE OR REPLACE FUNCTION public.create_zatca_sandbox_credential(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_device_id uuid,
  p_functionality_map text,
  p_egs_serial_number text,
  p_csr_common_name text,
  p_csr_organization_name text,
  p_csr_organizational_unit_name text,
  p_csr_location text,
  p_csr_industry text,
  p_csr_pem text,
  p_public_key_pem text,
  p_encrypted_private_key text,
  p_csr_generated_at timestamptz,
  p_last_safe_response jsonb
)
RETURNS TABLE(credential_id uuid, idempotent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_current public.zatca_sandbox_credentials%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM 'ebf1144b-55ed-472a-99c9-23b5ee915351'::uuid
     OR p_branch_id IS DISTINCT FROM '14271653-b404-44bf-9f39-7e9927569c02'::uuid THEN
    RAISE EXCEPTION 'Trading Sandbox credential scope is invalid' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.tenants t
  JOIN public.branches b ON b.tenant_id = t.id
  WHERE t.id = p_tenant_id
    AND b.id = p_branch_id
    AND t.is_demo IS TRUE
    AND t.is_active IS TRUE
    AND b.is_active IS TRUE
    AND b.zatca_environment = 'sandbox';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trading Sandbox branch is unavailable' USING ERRCODE = '42501';
  END IF;

  -- The branch lock makes concurrent identical retries converge on the same
  -- current row before either request attempts an insert.
  PERFORM 1 FROM public.branches WHERE id = p_branch_id FOR UPDATE;

  SELECT * INTO v_current
  FROM public.zatca_sandbox_credentials
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
    AND status IN ('pending', 'compliance', 'active')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_current.functionality_map IS DISTINCT FROM p_functionality_map THEN
      RAISE EXCEPTION 'A current Trading Sandbox onboarding record already exists'
        USING ERRCODE = '23505', CONSTRAINT = 'zatca_sandbox_credentials_one_current_onboarding_uidx';
    END IF;
    RETURN QUERY SELECT v_current.id, true;
    RETURN;
  END IF;

  INSERT INTO public.zatca_sandbox_credentials (
    tenant_id, branch_id, environment, device_id, status,
    onboarding_status, last_successful_onboarding_status,
    functionality_map, egs_serial_number, csr_common_name,
    csr_organization_name, csr_organizational_unit_name, csr_location,
    csr_industry, csr_pem, public_key_pem, encrypted_private_key,
    csr_generated_at, last_safe_response
  ) VALUES (
    p_tenant_id, p_branch_id, 'sandbox', p_device_id, 'pending',
    'csr_ready', 'csr_ready', p_functionality_map, p_egs_serial_number,
    p_csr_common_name, p_csr_organization_name,
    p_csr_organizational_unit_name, p_csr_location, p_csr_industry,
    p_csr_pem, p_public_key_pem, p_encrypted_private_key,
    p_csr_generated_at, p_last_safe_response
  )
  RETURNING id INTO credential_id;

  idempotent := false;
  RETURN NEXT;
END;
$function$;

-- Retire older current credentials and activate the fully validated target in
-- one transaction.  The Edge Function performs all secret/certificate checks
-- before calling this state transition.
CREATE OR REPLACE FUNCTION public.activate_zatca_sandbox_credential(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_credential_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_target public.zatca_sandbox_credentials%ROWTYPE;
BEGIN
  IF p_tenant_id IS DISTINCT FROM 'ebf1144b-55ed-472a-99c9-23b5ee915351'::uuid
     OR p_branch_id IS DISTINCT FROM '14271653-b404-44bf-9f39-7e9927569c02'::uuid THEN
    RAISE EXCEPTION 'Trading Sandbox credential scope is invalid' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.branches WHERE id = p_branch_id FOR UPDATE;

  SELECT * INTO v_target
  FROM public.zatca_sandbox_credentials
  WHERE id = p_credential_id
    AND tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
    AND status = 'compliance'
    AND onboarding_status = 'sandbox_production_csid_ready'
    AND onboarding_operation = 'activate'
    AND encrypted_private_key IS NOT NULL
    AND encrypted_production_csid IS NOT NULL
    AND encrypted_production_secret IS NOT NULL
    AND certificate IS NOT NULL
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Validated Trading Sandbox credential is not ready to activate'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.zatca_sandbox_credentials
  SET status = 'revoked', compliance_demo_status = 'disabled'
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
    AND status IN ('pending', 'compliance', 'active')
    AND id <> p_credential_id;

  UPDATE public.zatca_sandbox_credentials
  SET status = 'active',
      onboarding_status = 'active',
      last_successful_onboarding_status = 'active',
      compliance_demo_status = 'active',
      activated_at = now(),
      onboarding_operation = NULL,
      operation_started_at = NULL,
      failed_step = NULL,
      last_error = NULL,
      last_safe_response = jsonb_build_object('action', 'activate', 'completedAt', now())
  WHERE id = p_credential_id;

  RETURN p_credential_id;
END;
$function$;

ALTER FUNCTION public.create_zatca_sandbox_credential(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  timestamptz, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.activate_zatca_sandbox_credential(uuid, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_zatca_sandbox_credential(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  timestamptz, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.activate_zatca_sandbox_credential(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_zatca_sandbox_credential(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  timestamptz, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_zatca_sandbox_credential(uuid, uuid, uuid)
  TO service_role;

COMMIT;
