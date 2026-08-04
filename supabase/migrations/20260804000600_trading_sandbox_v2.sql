-- Isolated Kubri Trading Demo Integration Sandbox onboarding V2.
-- This migration does not read, rewrite, or archive legacy Trading onboarding rows.
BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_v2_settings (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment = 'integration_sandbox'),
  sandbox_onboarding_version INTEGER NOT NULL CHECK (sandbox_onboarding_version = 2),
  functionality_map TEXT NOT NULL CHECK (functionality_map = '0100'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, branch_id)
);

INSERT INTO public.zatca_sandbox_v2_settings (
  tenant_id, branch_id, environment, sandbox_onboarding_version, functionality_map
) VALUES (
  'ebf1144b-55ed-472a-99c9-23b5ee915351'::UUID,
  '14271653-b404-44bf-9f39-7e9927569c02'::UUID,
  'integration_sandbox',
  2,
  '0100'
)
ON CONFLICT (tenant_id, branch_id) DO UPDATE SET
  environment = EXCLUDED.environment,
  sandbox_onboarding_version = EXCLUDED.sandbox_onboarding_version,
  functionality_map = EXCLUDED.functionality_map,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_v2_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment = 'integration_sandbox'),
  sandbox_onboarding_version INTEGER NOT NULL CHECK (sandbox_onboarding_version = 2),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'failed', 'completed')),
  stage TEXT NOT NULL DEFAULT 'v2_session_created',
  functionality_map TEXT NOT NULL CHECK (functionality_map = '0100'),
  encrypted_private_key TEXT NOT NULL,
  encrypted_csr TEXT NOT NULL,
  encrypted_public_key TEXT NOT NULL,
  csr_fingerprint TEXT NOT NULL,
  egs_serial_number TEXT,
  csr_common_name TEXT,
  csr_organization_name TEXT,
  csr_organizational_unit_name TEXT,
  csr_location TEXT,
  csr_industry TEXT,
  csr_generated_at TIMESTAMPTZ,
  compliance_request_id TEXT,
  encrypted_compliance_response TEXT,
  encrypted_compliance_csid TEXT,
  encrypted_compliance_secret TEXT,
  encrypted_production_response TEXT,
  encrypted_production_csid TEXT,
  encrypted_production_secret TEXT,
  encrypted_certificate TEXT,
  certificate_valid_from TIMESTAMPTZ,
  certificate_valid_to TIMESTAMPTZ,
  compliance_results JSONB NOT NULL DEFAULT '[]'::JSONB,
  compliance_csid_received_at TIMESTAMPTZ,
  compliance_checked_at TIMESTAMPTZ,
  sandbox_production_csid_received_at TIMESTAMPTZ,
  safe_http_status INTEGER,
  safe_response_fields JSONB NOT NULL DEFAULT '[]'::JSONB,
  safe_required_fields JSONB NOT NULL DEFAULT '{}'::JSONB,
  safe_error_code TEXT,
  safe_error_message TEXT,
  last_local_request_id UUID,
  upstream_correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS zatca_sandbox_v2_one_current_session_uidx
  ON public.zatca_sandbox_v2_sessions (tenant_id, branch_id)
  WHERE status IN ('in_progress', 'completed');

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_v2_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.zatca_sandbox_v2_sessions(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  http_status INTEGER,
  safe_code TEXT,
  safe_message TEXT,
  request_id UUID,
  non_secret_response_fields JSONB NOT NULL DEFAULT '[]'::JSONB,
  required_fields_present JSONB NOT NULL DEFAULT '{}'::JSONB,
  public_key_fingerprint_prefixes JSONB NOT NULL DEFAULT '{}'::JSONB
);

ALTER TABLE public.zatca_sandbox_v2_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_sandbox_v2_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_sandbox_v2_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zatca_sandbox_v2_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.zatca_sandbox_v2_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.zatca_sandbox_v2_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zatca_sandbox_v2_settings TO service_role;
GRANT ALL ON TABLE public.zatca_sandbox_v2_sessions TO service_role;
GRANT ALL ON TABLE public.zatca_sandbox_v2_events TO service_role;

CREATE OR REPLACE FUNCTION public.create_zatca_sandbox_v2_session(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_session_id UUID
)
RETURNS TABLE(session_id UUID, idempotent BOOLEAN, functionality_map TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_setting public.zatca_sandbox_v2_settings%ROWTYPE;
  v_existing public.zatca_sandbox_v2_sessions%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS DISTINCT FROM 'ebf1144b-55ed-472a-99c9-23b5ee915351'::UUID
     OR p_branch_id IS DISTINCT FROM '14271653-b404-44bf-9f39-7e9927569c02'::UUID THEN
    RAISE EXCEPTION 'Trading Sandbox V2 scope is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_setting
  FROM public.zatca_sandbox_v2_settings
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND environment = 'integration_sandbox'
    AND sandbox_onboarding_version = 2
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trading Sandbox V2 setting is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.zatca_sandbox_v2_sessions
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND status IN ('in_progress', 'completed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, TRUE, v_existing.functionality_map;
    RETURN;
  END IF;

  INSERT INTO public.zatca_sandbox_v2_sessions (
    id, tenant_id, branch_id, environment, sandbox_onboarding_version,
    status, stage, functionality_map,
    encrypted_private_key, encrypted_csr, encrypted_public_key, csr_fingerprint
  ) VALUES (
    p_session_id, p_tenant_id, p_branch_id, v_setting.environment,
    v_setting.sandbox_onboarding_version, 'in_progress', 'v2_session_created',
    v_setting.functionality_map, 'pending', 'pending', 'pending', 'pending'
  );

  RETURN QUERY SELECT p_session_id, FALSE, v_setting.functionality_map;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_zatca_sandbox_v2_session(p_session_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_session public.zatca_sandbox_v2_sessions%ROWTYPE;
  v_existing_active UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session
  FROM public.zatca_sandbox_v2_sessions
  WHERE id = p_session_id
    AND tenant_id = 'ebf1144b-55ed-472a-99c9-23b5ee915351'::UUID
    AND branch_id = '14271653-b404-44bf-9f39-7e9927569c02'::UUID
    AND environment = 'integration_sandbox'
    AND sandbox_onboarding_version = 2
    AND status = 'in_progress'
    AND stage = 'certificate_key_match_verified'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V2 session is not ready for activation' USING ERRCODE = '23514';
  END IF;

  SELECT id INTO v_existing_active
  FROM public.zatca_sandbox_credentials
  WHERE tenant_id = v_session.tenant_id
    AND branch_id = v_session.branch_id
    AND environment = 'sandbox'
    AND status = 'active'
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'A Trading Sandbox credential is already active' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.zatca_sandbox_credentials (
    tenant_id, branch_id, environment, device_id, status,
    onboarding_status, last_successful_onboarding_status,
    functionality_map, egs_serial_number, csr_common_name,
    csr_organization_name, csr_organizational_unit_name, csr_location,
    csr_industry, csr_pem, public_key_pem, encrypted_private_key,
    csr_generated_at, compliance_request_id, compliance_sample_results,
    encrypted_compliance_csid, encrypted_compliance_secret,
    encrypted_production_csid, encrypted_production_secret,
    certificate, certificate_valid_from, expires_at,
    compliance_csid_received_at, compliance_checked_at,
    sandbox_production_csid_received_at,
    compliance_demo_status, last_safe_response
  ) VALUES (
    v_session.tenant_id, v_session.branch_id, 'sandbox', v_session.id, 'active',
    'active', 'active', v_session.functionality_map,
    v_session.egs_serial_number, v_session.csr_common_name,
    v_session.csr_organization_name, v_session.csr_organizational_unit_name,
    v_session.csr_location, v_session.csr_industry,
    v_session.encrypted_csr, v_session.encrypted_public_key,
    v_session.encrypted_private_key, v_session.csr_generated_at,
    v_session.compliance_request_id,
    v_session.compliance_results,
    v_session.encrypted_compliance_csid, v_session.encrypted_compliance_secret,
    v_session.encrypted_production_csid,
    v_session.encrypted_production_secret, v_session.encrypted_certificate,
    v_session.certificate_valid_from, v_session.certificate_valid_to,
    v_session.compliance_csid_received_at, v_session.compliance_checked_at,
    v_session.sandbox_production_csid_received_at,
    'active', jsonb_build_object('action', 'activate_v2', 'completedAt', NOW())
  );

  UPDATE public.zatca_sandbox_v2_sessions
  SET status = 'completed', stage = 'onboarding_completed', completed_at = NOW(), updated_at = NOW(),
      safe_error_code = NULL, safe_error_message = NULL
  WHERE id = v_session.id;

  RETURN v_session.id;
END;
$function$;

ALTER FUNCTION public.create_zatca_sandbox_v2_session(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.activate_zatca_sandbox_v2_session(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_zatca_sandbox_v2_session(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_zatca_sandbox_v2_session(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_zatca_sandbox_v2_session(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_zatca_sandbox_v2_session(UUID) TO service_role;

COMMIT;
