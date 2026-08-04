-- Fix the V2 session-create RPC's PL/pgSQL output-column ambiguity.
BEGIN;

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
  FROM public.zatca_sandbox_v2_settings AS s
  WHERE s.tenant_id = p_tenant_id AND s.branch_id = p_branch_id
    AND s.environment = 'integration_sandbox'
    AND s.sandbox_onboarding_version = 2
    AND s.functionality_map = '0100'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trading Sandbox V2 setting is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing
  FROM public.zatca_sandbox_v2_sessions AS s
  WHERE s.tenant_id = p_tenant_id AND s.branch_id = p_branch_id
    AND s.status IN ('in_progress', 'completed')
  ORDER BY s.created_at DESC
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

ALTER FUNCTION public.create_zatca_sandbox_v2_session(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.create_zatca_sandbox_v2_session(UUID, UUID, UUID) RESET row_security;

COMMIT;
