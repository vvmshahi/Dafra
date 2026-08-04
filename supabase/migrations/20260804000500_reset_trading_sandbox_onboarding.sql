-- Temporary, owner-authorized restart of the permanent Trading Sandbox demo.
-- This archives the current incomplete row; it never deletes credentials or
-- changes Service Demo or production ZATCA records.
BEGIN;

ALTER TABLE public.zatca_sandbox_credentials
  DROP CONSTRAINT IF EXISTS zatca_sandbox_reconciliation_decision_check;

ALTER TABLE public.zatca_sandbox_credentials
  ADD CONSTRAINT zatca_sandbox_reconciliation_decision_check CHECK (
    reconciliation_decision IS NULL OR reconciliation_decision IN (
      'mark_verified_success',
      'mark_verified_failure',
      'revoke_and_restart_device',
      'abandoned_by_owner_reset'
    )
  );

CREATE OR REPLACE FUNCTION public.reset_zatca_sandbox_onboarding(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_credential public.zatca_sandbox_credentials%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_previous_stage TEXT;
  v_previous_operation TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS DISTINCT FROM 'ebf1144b-55ed-472a-99c9-23b5ee915351'::UUID
     OR p_branch_id IS DISTINCT FROM '14271653-b404-44bf-9f39-7e9927569c02'::UUID
     OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Exact Trading Sandbox reset scope is required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.branches b ON b.tenant_id = t.id
    WHERE t.id = p_tenant_id
      AND t.is_demo IS TRUE
      AND t.is_active IS TRUE
      AND t.suspended_at IS NULL
      AND b.id = p_branch_id
      AND b.is_active IS TRUE
      AND b.zatca_environment = 'sandbox'
  ) THEN
    RAISE EXCEPTION 'Active Trading Sandbox scope required' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.branches WHERE id = p_branch_id FOR UPDATE;

  SELECT * INTO v_credential
  FROM public.zatca_sandbox_credentials
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
    AND status IN ('pending', 'compliance', 'active')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'reset', FALSE,
      'already_reset', TRUE,
      'status', 'not_started',
      'reason', 'owner_requested_clean_sandbox_restart'
    );
  END IF;

  IF v_credential.status = 'active' OR v_credential.onboarding_status = 'active' THEN
    RAISE EXCEPTION 'Active Trading Sandbox credential cannot be reset' USING ERRCODE = '23514';
  END IF;

  v_previous_stage := COALESCE(v_credential.onboarding_status, 'not_started');
  v_previous_operation := v_credential.onboarding_operation;

  UPDATE public.zatca_sandbox_credentials
  SET status = 'revoked',
      compliance_demo_status = 'disabled',
      onboarding_status = COALESCE(v_credential.last_successful_onboarding_status, 'not_started'),
      failed_step = NULL,
      last_error = 'Sandbox onboarding was abandoned by owner reset.',
      onboarding_operation = NULL,
      operation_started_at = NULL,
      reconciliation_status = 'resolved',
      reconciliation_decision = 'abandoned_by_owner_reset',
      reconciled_at = v_now,
      reconciled_by = p_actor_id::TEXT,
      reconciliation_summary = jsonb_build_object(
        'decision', 'abandoned_by_owner_reset',
        'reason', 'owner_requested_clean_sandbox_restart',
        'previousStage', v_previous_stage,
        'previousOperation', v_previous_operation,
        'resetAt', v_now
      ),
      last_safe_response = jsonb_build_object(
        'action', 'reset_sandbox_onboarding',
        'decision', 'abandoned_by_owner_reset',
        'reason', 'owner_requested_clean_sandbox_restart',
        'completedAt', v_now
      ),
      updated_at = v_now
  WHERE id = v_credential.id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reset', TRUE,
    'already_reset', FALSE,
    'credential_id', v_credential.id,
    'onboarding_uid', v_credential.device_id,
    'previous_stage', v_previous_stage,
    'previous_operation', v_previous_operation,
    'status', 'revoked',
    'reason', 'owner_requested_clean_sandbox_restart',
    'reset_at', v_now
  );
END;
$function$;

ALTER FUNCTION public.reset_zatca_sandbox_onboarding(UUID, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reset_zatca_sandbox_onboarding(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_zatca_sandbox_onboarding(UUID, UUID, UUID)
  TO service_role;

COMMIT;
