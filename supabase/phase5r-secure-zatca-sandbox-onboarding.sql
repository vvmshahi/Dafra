-- ============================================================
-- Phase 5R: Secure backend-only ZATCA Sandbox demo onboarding
-- Apply manually after Phase 5Q.
--
-- Adds onboarding metadata to the existing isolated Sandbox
-- credential table. Does not create tenants, branches, users,
-- credentials, or modify production ZATCA submission behavior.
-- ============================================================

BEGIN;

ALTER TABLE public.zatca_sandbox_credentials
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS last_successful_onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS failed_step TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_operation TEXT,
  ADD COLUMN IF NOT EXISTS operation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS reconciliation_decision TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_by TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_summary JSONB,
  ADD COLUMN IF NOT EXISTS functionality_map TEXT,
  ADD COLUMN IF NOT EXISTS egs_serial_number TEXT,
  ADD COLUMN IF NOT EXISTS csr_common_name TEXT,
  ADD COLUMN IF NOT EXISTS csr_organization_name TEXT,
  ADD COLUMN IF NOT EXISTS csr_organizational_unit_name TEXT,
  ADD COLUMN IF NOT EXISTS csr_location TEXT,
  ADD COLUMN IF NOT EXISTS csr_industry TEXT,
  ADD COLUMN IF NOT EXISTS csr_pem TEXT,
  ADD COLUMN IF NOT EXISTS public_key_pem TEXT,
  ADD COLUMN IF NOT EXISTS compliance_request_id TEXT,
  ADD COLUMN IF NOT EXISTS compliance_sample_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_safe_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS certificate_valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS csr_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compliance_csid_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compliance_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sandbox_production_csid_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

ALTER TABLE public.zatca_sandbox_credentials
  DROP CONSTRAINT IF EXISTS zatca_sandbox_onboarding_status_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_last_successful_status_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_failed_step_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_onboarding_operation_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_reconciliation_status_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_reconciliation_decision_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_reconciliation_state_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_functionality_map_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_compliance_results_shape_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_last_safe_response_shape_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_reconciliation_summary_shape_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_onboarding_csr_material_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_onboarding_compliance_material_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_onboarding_production_material_check,
  DROP CONSTRAINT IF EXISTS zatca_sandbox_onboarding_active_state_check;

ALTER TABLE public.zatca_sandbox_credentials
  ADD CONSTRAINT zatca_sandbox_onboarding_status_check CHECK (
    onboarding_status IN (
      'not_started',
      'csr_ready',
      'compliance_csid_ready',
      'compliance_checks_pending',
      'compliance_passed',
      'sandbox_production_csid_ready',
      'active',
      'failed',
      'expired'
    )
  ),
  ADD CONSTRAINT zatca_sandbox_last_successful_status_check CHECK (
    last_successful_onboarding_status IN (
      'not_started',
      'csr_ready',
      'compliance_csid_ready',
      'compliance_passed',
      'sandbox_production_csid_ready',
      'active'
    )
  ),
  ADD CONSTRAINT zatca_sandbox_failed_step_check CHECK (
    failed_step IS NULL OR failed_step IN (
      'request_compliance_csid',
      'submit_compliance_documents',
      'request_sandbox_production_csid',
      'activate'
    )
  ),
  ADD CONSTRAINT zatca_sandbox_onboarding_operation_check CHECK (
    (onboarding_operation IS NULL AND operation_started_at IS NULL)
    OR (
      onboarding_operation IN (
        'request_compliance_csid',
        'submit_compliance_documents',
        'request_sandbox_production_csid',
        'activate'
      )
      AND operation_started_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT zatca_sandbox_reconciliation_status_check CHECK (
    reconciliation_status IN ('not_required', 'required', 'resolved')
  ),
  ADD CONSTRAINT zatca_sandbox_reconciliation_decision_check CHECK (
    reconciliation_decision IS NULL OR reconciliation_decision IN (
      'mark_verified_success',
      'mark_verified_failure',
      'revoke_and_restart_device'
    )
  ),
  ADD CONSTRAINT zatca_sandbox_reconciliation_state_check CHECK (
    (reconciliation_status = 'not_required'
      AND reconciliation_decision IS NULL
      AND reconciled_at IS NULL
      AND reconciled_by IS NULL
      AND reconciliation_summary IS NULL)
    OR (reconciliation_status = 'required'
      AND onboarding_operation IS NOT NULL
      AND reconciliation_decision IS NULL
      AND reconciled_at IS NULL
      AND reconciled_by IS NULL
      AND reconciliation_summary IS NULL)
    OR (reconciliation_status = 'resolved'
      AND onboarding_operation IS NULL
      AND reconciliation_decision IS NOT NULL
      AND reconciled_at IS NOT NULL
      AND reconciled_by IS NOT NULL
      AND reconciliation_summary IS NOT NULL)
  ),
  ADD CONSTRAINT zatca_sandbox_functionality_map_check CHECK (
    functionality_map IS NULL OR functionality_map IN ('0100', '1000', '1100')
  ),
  ADD CONSTRAINT zatca_sandbox_compliance_results_shape_check CHECK (
    jsonb_typeof(compliance_sample_results) = 'array'
  ),
  ADD CONSTRAINT zatca_sandbox_last_safe_response_shape_check CHECK (
    jsonb_typeof(last_safe_response) = 'object'
  ),
  ADD CONSTRAINT zatca_sandbox_reconciliation_summary_shape_check CHECK (
    reconciliation_summary IS NULL OR jsonb_typeof(reconciliation_summary) = 'object'
  ),
  ADD CONSTRAINT zatca_sandbox_onboarding_csr_material_check CHECK (
    onboarding_status IN ('not_started')
    OR (
      functionality_map IS NOT NULL
      AND egs_serial_number IS NOT NULL
      AND csr_pem IS NOT NULL
      AND public_key_pem IS NOT NULL
      AND encrypted_private_key IS NOT NULL
    )
  ),
  ADD CONSTRAINT zatca_sandbox_onboarding_compliance_material_check CHECK (
    onboarding_status NOT IN (
      'compliance_csid_ready',
      'compliance_checks_pending',
      'compliance_passed',
      'sandbox_production_csid_ready',
      'active'
    )
    OR (
      compliance_request_id IS NOT NULL
      AND encrypted_compliance_csid IS NOT NULL
      AND encrypted_compliance_secret IS NOT NULL
    )
  ),
  ADD CONSTRAINT zatca_sandbox_onboarding_production_material_check CHECK (
    onboarding_status NOT IN ('sandbox_production_csid_ready', 'active')
    OR (
      encrypted_production_csid IS NOT NULL
      AND encrypted_production_secret IS NOT NULL
      AND certificate IS NOT NULL
    )
  ),
  ADD CONSTRAINT zatca_sandbox_onboarding_active_state_check CHECK (
    (status = 'active') = (onboarding_status = 'active')
  );

CREATE UNIQUE INDEX IF NOT EXISTS zatca_sandbox_credentials_one_current_onboarding_uidx
  ON public.zatca_sandbox_credentials (tenant_id, branch_id, environment)
  WHERE status IN ('pending', 'compliance', 'active', 'failed');

COMMENT ON COLUMN public.zatca_sandbox_credentials.onboarding_status IS
  'Backend-only Phase 5R onboarding state. Never controlled by browser callers.';
COMMENT ON COLUMN public.zatca_sandbox_credentials.last_safe_response IS
  'Redacted status/HTTP metadata only. Must never contain credentials, OTPs, CSR XML, or authorization headers.';
COMMENT ON COLUMN public.zatca_sandbox_credentials.last_error IS
  'Redacted onboarding failure summary safe for internal status display.';
COMMENT ON COLUMN public.zatca_sandbox_credentials.reconciliation_summary IS
  'Safe reconciliation metadata only. Never contains credentials, OTPs, CSR, XML, private keys, or authorization data.';

-- Extend the Phase 5Q trigger with Phase 5R active-state validation while
-- preserving the original service-role and demo/Sandbox scope boundary.
CREATE OR REPLACE FUNCTION public.validate_zatca_sandbox_credential_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    JOIN public.tenants t ON t.id = b.tenant_id
    WHERE b.id = NEW.branch_id
      AND b.tenant_id = NEW.tenant_id
      AND b.zatca_environment = 'sandbox'
      AND t.is_demo IS TRUE
  ) THEN
    RAISE EXCEPTION 'Sandbox credentials require the demo Sandbox branch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.onboarding_status = 'failed' AND NEW.failed_step IS NULL THEN
    RAISE EXCEPTION 'Failed Sandbox onboarding requires a retryable failed step'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.onboarding_status <> 'failed' THEN
    NEW.failed_step := NULL;
  END IF;

  IF NEW.status = 'active' AND (
    NEW.onboarding_status <> 'active'
    OR NEW.encrypted_private_key IS NULL
    OR NEW.encrypted_production_csid IS NULL
    OR NEW.encrypted_production_secret IS NULL
    OR NEW.certificate IS NULL
    OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NOW())
  ) THEN
    RAISE EXCEPTION 'Active Sandbox credentials are incomplete, expired, or not activated'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_zatca_sandbox_credential_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.reconcile_zatca_sandbox_onboarding(
  p_credential_id UUID,
  p_tenant_id UUID,
  p_branch_id UUID,
  p_expected_operation TEXT,
  p_decision TEXT,
  p_reconciled_by TEXT,
  p_summary TEXT,
  p_verified_result JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_credential public.zatca_sandbox_credentials%ROWTYPE;
  v_required_sample_count INTEGER;
  v_target_status TEXT;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_credential_id IS NULL OR p_tenant_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Exact reconciliation scope is required' USING ERRCODE = '22023';
  END IF;
  IF p_expected_operation IS NULL OR p_expected_operation NOT IN (
    'request_compliance_csid',
    'submit_compliance_documents',
    'request_sandbox_production_csid',
    'activate'
  ) THEN
    RAISE EXCEPTION 'Invalid expected onboarding operation' USING ERRCODE = '22023';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN (
    'mark_verified_success',
    'mark_verified_failure',
    'revoke_and_restart_device'
  ) THEN
    RAISE EXCEPTION 'Invalid reconciliation decision' USING ERRCODE = '22023';
  END IF;
  IF p_reconciled_by IS NULL
     OR btrim(p_reconciled_by) !~ '^[A-Za-z0-9@._:-]{3,100}$' THEN
    RAISE EXCEPTION 'A safe internal reconciler identifier is required' USING ERRCODE = '22023';
  END IF;
  IF p_summary IS NULL OR length(btrim(p_summary)) < 10 OR length(btrim(p_summary)) > 500
     OR p_summary ~* '(otp|secret|csid|token|certificate|private[ _-]?key|authorization|csr|xml)' THEN
    RAISE EXCEPTION 'A safe non-sensitive reconciliation summary is required' USING ERRCODE = '22023';
  END IF;
  IF p_verified_result IS NULL OR jsonb_typeof(p_verified_result) <> 'object' THEN
    RAISE EXCEPTION 'Verified result must be an object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_verified_result) AS key_name
    WHERE key_name <> 'resulting_status'
  ) THEN
    RAISE EXCEPTION 'Verified result contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.branches b ON b.tenant_id = t.id
    WHERE t.id = p_tenant_id
      AND t.is_demo IS TRUE
      AND t.is_active IS TRUE
      AND b.id = p_branch_id
      AND b.is_active IS TRUE
      AND b.zatca_environment = 'sandbox'
  ) THEN
    RAISE EXCEPTION 'Active demo Sandbox scope required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_credential
  FROM public.zatca_sandbox_credentials
  WHERE id = p_credential_id
    AND tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND environment = 'sandbox'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exact Sandbox onboarding record not found' USING ERRCODE = '42501';
  END IF;
  IF v_credential.onboarding_operation IS NULL
     OR v_credential.operation_started_at IS NULL
     OR v_credential.onboarding_operation <> p_expected_operation THEN
    RAISE EXCEPTION 'Locked onboarding operation does not match the reconciliation request'
      USING ERRCODE = '23514';
  END IF;
  IF v_credential.reconciliation_status = 'resolved' THEN
    RAISE EXCEPTION 'Onboarding operation was already reconciled' USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'mark_verified_success' THEN
    v_target_status := NULLIF(btrim(p_verified_result ->> 'resulting_status'), '');

    IF p_expected_operation = 'request_compliance_csid' THEN
      IF v_target_status IS DISTINCT FROM 'compliance_csid_ready'
         OR v_credential.compliance_request_id IS NULL
         OR public.is_valid_zatca_encrypted_envelope(v_credential.encrypted_compliance_csid) IS NOT TRUE
         OR public.is_valid_zatca_encrypted_envelope(v_credential.encrypted_compliance_secret) IS NOT TRUE THEN
        RAISE EXCEPTION 'Verified compliance result lacks safely persisted encrypted material'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public.zatca_sandbox_credentials
      SET status = 'compliance',
          onboarding_status = 'compliance_csid_ready',
          last_successful_onboarding_status = 'compliance_csid_ready',
          compliance_csid_received_at = COALESCE(compliance_csid_received_at, v_now),
          failed_step = NULL,
          last_error = NULL,
          onboarding_operation = NULL,
          operation_started_at = NULL,
          reconciliation_status = 'resolved',
          reconciliation_decision = p_decision,
          reconciled_at = v_now,
          reconciled_by = btrim(p_reconciled_by),
          reconciliation_summary = jsonb_build_object(
            'operation', p_expected_operation,
            'decision', p_decision,
            'summary', btrim(p_summary),
            'resultingStatus', v_target_status,
            'reconciledAt', v_now
          ),
          last_safe_response = jsonb_build_object(
            'action', 'reconcile_uncertain_operation',
            'operation', p_expected_operation,
            'decision', p_decision,
            'resultingStatus', v_target_status,
            'completedAt', v_now
          )
      WHERE id = v_credential.id;

    ELSIF p_expected_operation = 'submit_compliance_documents' THEN
      v_required_sample_count := CASE v_credential.functionality_map
        WHEN '0100' THEN 3
        WHEN '1000' THEN 3
        WHEN '1100' THEN 6
        ELSE 0
      END;
      IF v_target_status IS DISTINCT FROM 'compliance_passed'
         OR v_required_sample_count = 0
         OR jsonb_array_length(v_credential.compliance_sample_results) <> v_required_sample_count
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(v_credential.compliance_sample_results) AS sample
           WHERE jsonb_typeof(sample) <> 'object'
              OR sample ->> 'status' <> 'accepted'
              OR sample ->> 'type' NOT IN (
                'simplified_invoice', 'simplified_credit_note', 'simplified_debit_note',
                'standard_invoice', 'standard_credit_note', 'standard_debit_note'
              )
              OR (v_credential.functionality_map = '0100' AND sample ->> 'type' NOT LIKE 'simplified_%')
              OR (v_credential.functionality_map = '1000' AND sample ->> 'type' NOT LIKE 'standard_%')
         )
         OR (
           SELECT COUNT(DISTINCT sample ->> 'type')
           FROM jsonb_array_elements(v_credential.compliance_sample_results) AS sample
         ) <> v_required_sample_count THEN
        RAISE EXCEPTION 'Verified compliance checks lack all deterministic accepted results'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public.zatca_sandbox_credentials
      SET status = 'compliance',
          onboarding_status = 'compliance_passed',
          last_successful_onboarding_status = 'compliance_passed',
          compliance_checked_at = COALESCE(compliance_checked_at, v_now),
          failed_step = NULL,
          last_error = NULL,
          onboarding_operation = NULL,
          operation_started_at = NULL,
          reconciliation_status = 'resolved',
          reconciliation_decision = p_decision,
          reconciled_at = v_now,
          reconciled_by = btrim(p_reconciled_by),
          reconciliation_summary = jsonb_build_object(
            'operation', p_expected_operation,
            'decision', p_decision,
            'summary', btrim(p_summary),
            'resultingStatus', v_target_status,
            'reconciledAt', v_now
          ),
          last_safe_response = jsonb_build_object(
            'action', 'reconcile_uncertain_operation',
            'operation', p_expected_operation,
            'decision', p_decision,
            'resultingStatus', v_target_status,
            'completedAt', v_now
          )
      WHERE id = v_credential.id;

    ELSIF p_expected_operation = 'request_sandbox_production_csid' THEN
      IF v_target_status IS DISTINCT FROM 'sandbox_production_csid_ready'
         OR public.is_valid_zatca_encrypted_envelope(v_credential.encrypted_production_csid) IS NOT TRUE
         OR public.is_valid_zatca_encrypted_envelope(v_credential.encrypted_production_secret) IS NOT TRUE
         OR v_credential.certificate IS NULL
         OR (v_credential.expires_at IS NOT NULL AND v_credential.expires_at <= v_now) THEN
        RAISE EXCEPTION 'Verified Sandbox Production result lacks safely persisted encrypted material'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public.zatca_sandbox_credentials
      SET status = 'compliance',
          onboarding_status = 'sandbox_production_csid_ready',
          last_successful_onboarding_status = 'sandbox_production_csid_ready',
          sandbox_production_csid_received_at = COALESCE(sandbox_production_csid_received_at, v_now),
          failed_step = NULL,
          last_error = NULL,
          onboarding_operation = NULL,
          operation_started_at = NULL,
          reconciliation_status = 'resolved',
          reconciliation_decision = p_decision,
          reconciled_at = v_now,
          reconciled_by = btrim(p_reconciled_by),
          reconciliation_summary = jsonb_build_object(
            'operation', p_expected_operation,
            'decision', p_decision,
            'summary', btrim(p_summary),
            'resultingStatus', v_target_status,
            'reconciledAt', v_now
          ),
          last_safe_response = jsonb_build_object(
            'action', 'reconcile_uncertain_operation',
            'operation', p_expected_operation,
            'decision', p_decision,
            'resultingStatus', v_target_status,
            'completedAt', v_now
          )
      WHERE id = v_credential.id;

    ELSIF p_expected_operation = 'activate' THEN
      IF v_target_status IS DISTINCT FROM 'active'
         OR public.is_valid_zatca_encrypted_envelope(v_credential.encrypted_private_key) IS NOT TRUE
         OR public.is_valid_zatca_encrypted_envelope(v_credential.encrypted_production_csid) IS NOT TRUE
         OR public.is_valid_zatca_encrypted_envelope(v_credential.encrypted_production_secret) IS NOT TRUE
         OR v_credential.certificate IS NULL
         OR (v_credential.expires_at IS NOT NULL AND v_credential.expires_at <= v_now) THEN
        RAISE EXCEPTION 'Verified activation lacks valid persisted Sandbox credential material'
          USING ERRCODE = '23514';
      END IF;
      UPDATE public.zatca_sandbox_credentials
      SET status = 'active',
          onboarding_status = 'active',
          last_successful_onboarding_status = 'active',
          activated_at = COALESCE(activated_at, v_now),
          failed_step = NULL,
          last_error = NULL,
          onboarding_operation = NULL,
          operation_started_at = NULL,
          reconciliation_status = 'resolved',
          reconciliation_decision = p_decision,
          reconciled_at = v_now,
          reconciled_by = btrim(p_reconciled_by),
          reconciliation_summary = jsonb_build_object(
            'operation', p_expected_operation,
            'decision', p_decision,
            'summary', btrim(p_summary),
            'resultingStatus', v_target_status,
            'reconciledAt', v_now
          ),
          last_safe_response = jsonb_build_object(
            'action', 'reconcile_uncertain_operation',
            'operation', p_expected_operation,
            'decision', p_decision,
            'resultingStatus', v_target_status,
            'completedAt', v_now
          )
      WHERE id = v_credential.id;
    END IF;

  ELSIF p_decision = 'mark_verified_failure' THEN
    IF p_verified_result <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Verified failure does not accept result material' USING ERRCODE = '22023';
    END IF;
    UPDATE public.zatca_sandbox_credentials
    SET status = 'failed',
        onboarding_status = 'failed',
        last_successful_onboarding_status = CASE p_expected_operation
          WHEN 'request_compliance_csid' THEN 'csr_ready'
          WHEN 'submit_compliance_documents' THEN 'compliance_csid_ready'
          WHEN 'request_sandbox_production_csid' THEN 'compliance_passed'
          WHEN 'activate' THEN 'sandbox_production_csid_ready'
        END,
        failed_step = p_expected_operation,
        last_error = 'An internal administrator verified that the uncertain operation did not complete.',
        onboarding_operation = NULL,
        operation_started_at = NULL,
        reconciliation_status = 'resolved',
        reconciliation_decision = p_decision,
        reconciled_at = v_now,
        reconciled_by = btrim(p_reconciled_by),
        reconciliation_summary = jsonb_build_object(
          'operation', p_expected_operation,
          'decision', p_decision,
          'summary', btrim(p_summary),
          'reconciledAt', v_now
        ),
        last_safe_response = jsonb_build_object(
          'action', 'reconcile_uncertain_operation',
          'operation', p_expected_operation,
          'decision', p_decision,
          'resultingStatus', 'failed',
          'completedAt', v_now
        )
    WHERE id = v_credential.id;

  ELSE
    IF p_verified_result <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Device revocation does not accept result material' USING ERRCODE = '22023';
    END IF;
    UPDATE public.zatca_sandbox_credentials
    SET status = 'revoked',
        onboarding_status = v_credential.last_successful_onboarding_status,
        failed_step = NULL,
        last_error = 'Uncertain onboarding device was revoked and must not be reused.',
        onboarding_operation = NULL,
        operation_started_at = NULL,
        reconciliation_status = 'resolved',
        reconciliation_decision = p_decision,
        reconciled_at = v_now,
        reconciled_by = btrim(p_reconciled_by),
        reconciliation_summary = jsonb_build_object(
          'operation', p_expected_operation,
          'decision', p_decision,
          'summary', btrim(p_summary),
          'restartRequired', TRUE,
          'reconciledAt', v_now
        ),
        last_safe_response = jsonb_build_object(
          'action', 'reconcile_uncertain_operation',
          'operation', p_expected_operation,
          'decision', p_decision,
          'resultingStatus', 'revoked',
          'restartRequired', TRUE,
          'completedAt', v_now
        )
    WHERE id = v_credential.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'credential_id', v_credential.id,
    'tenant_id', p_tenant_id,
    'branch_id', p_branch_id,
    'operation', p_expected_operation,
    'decision', p_decision,
    'reconciled_at', v_now,
    'restart_required', p_decision = 'revoke_and_restart_device'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_zatca_sandbox_onboarding(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_zatca_sandbox_onboarding(
  UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
