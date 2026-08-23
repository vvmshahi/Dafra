-- Stage B2: isolated Generation invoice finalizer.
-- Source-only. This operation never uses the Phase 2 atomic checkout intent,
-- counters, previous hashes, signatures, Reporting, or Clearance.
-- Transaction boundary: the Edge function derives the server snapshot/QR;
-- this RPC locks branch and invoice, rechecks policy and snapshot equality,
-- then commits the operation row and immutable invoice artifacts together.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fiscal_document_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS fiscal_document_snapshot_hash text;

CREATE TABLE IF NOT EXISTS public.generation_fiscal_operations_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  checkout_idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  expected_policy_revision bigint NOT NULL,
  policy_revision_at_issue bigint,
  state text NOT NULL DEFAULT 'started',
  error_code text,
  fiscal_result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  issued_at timestamptz,
  CONSTRAINT generation_fiscal_operations_v1_state_check
    CHECK (state IN ('started', 'issued', 'failed')),
  CONSTRAINT generation_fiscal_operations_v1_key_check
    CHECK (length(trim(checkout_idempotency_key)) BETWEEN 8 AND 200),
  CONSTRAINT generation_fiscal_operations_v1_revision_check
    CHECK (expected_policy_revision > 0),
  UNIQUE (branch_id, checkout_idempotency_key),
  UNIQUE (invoice_id)
);

CREATE INDEX IF NOT EXISTS generation_fiscal_operations_v1_tenant_created_idx
  ON public.generation_fiscal_operations_v1 (tenant_id, created_at DESC);

ALTER TABLE public.generation_fiscal_operations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.generation_fiscal_operations_v1 FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.generation_fiscal_operations_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_fiscal_issue_metadata_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'posted' OR OLD.fiscal_issued_at IS NOT NULL THEN
    IF NEW.fiscal_regime_at_issue IS DISTINCT FROM OLD.fiscal_regime_at_issue
       OR NEW.fiscal_policy_revision_at_issue IS DISTINCT FROM OLD.fiscal_policy_revision_at_issue
       OR NEW.fiscal_policy_snapshot IS DISTINCT FROM OLD.fiscal_policy_snapshot
       OR NEW.fiscal_document_snapshot IS DISTINCT FROM OLD.fiscal_document_snapshot
       OR NEW.fiscal_document_snapshot_hash IS DISTINCT FROM OLD.fiscal_document_snapshot_hash
       OR NEW.fiscal_qr_payload IS DISTINCT FROM OLD.fiscal_qr_payload
       OR NEW.fiscal_issued_at IS DISTINCT FROM OLD.fiscal_issued_at THEN
      RAISE EXCEPTION 'Fiscal issue metadata is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_generation_invoice_v1(
  p_invoice_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_checkout_idempotency_key text,
  p_expected_policy_revision bigint,
  p_document_snapshot jsonb,
  p_snapshot_hash text,
  p_qr_payload text,
  p_request_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_operation public.generation_fiscal_operations_v1%ROWTYPE;
  v_result jsonb;
  v_issued_at timestamptz;
BEGIN
  IF p_invoice_id IS NULL OR p_branch_id IS NULL OR p_actor_user_id IS NULL
     OR length(trim(COALESCE(p_checkout_idempotency_key, ''))) < 8
     OR p_expected_policy_revision IS NULL OR p_expected_policy_revision < 1
     OR length(trim(COALESCE(p_snapshot_hash, ''))) < 32
     OR length(trim(COALESCE(p_request_fingerprint, ''))) < 32
     OR length(trim(COALESCE(p_qr_payload, ''))) = 0 THEN
    RAISE EXCEPTION 'GENERATION_FINALIZATION_FAILED' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile FROM public.user_profiles WHERE id = p_actor_user_id;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id FOR UPDATE;
  IF v_profile.id IS NULL OR v_profile.is_active IS NOT TRUE
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR NOT (v_profile.role::text = 'super_admin'
       OR (v_profile.role::text = 'owner' AND v_profile.branch_id IS NULL)
       OR v_profile.branch_id = p_branch_id) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  IF v_branch.fiscal_regime <> 'generation'
     OR v_branch.fiscal_activation_state <> 'generation_active' THEN
    RAISE EXCEPTION 'GENERATION_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_branch.fiscal_policy_revision <> p_expected_policy_revision THEN
    RAISE EXCEPTION 'FISCAL_POLICY_CHANGED' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_operation
  FROM public.generation_fiscal_operations_v1
  WHERE branch_id = p_branch_id AND checkout_idempotency_key = p_checkout_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_operation.request_fingerprint <> p_request_fingerprint
       OR v_operation.invoice_id <> p_invoice_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    IF v_operation.state = 'issued' AND v_operation.fiscal_result IS NOT NULL THEN
      RETURN v_operation.fiscal_result || jsonb_build_object('idempotentReplay', true);
    END IF;
  ELSE
    INSERT INTO public.generation_fiscal_operations_v1 (
      tenant_id, branch_id, actor_user_id, invoice_id,
      checkout_idempotency_key, request_fingerprint, expected_policy_revision
    ) VALUES (
      v_branch.tenant_id, p_branch_id, p_actor_user_id, p_invoice_id,
      p_checkout_idempotency_key, p_request_fingerprint, p_expected_policy_revision
    ) RETURNING * INTO v_operation;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL OR v_invoice.branch_id <> p_branch_id
     OR v_invoice.tenant_id <> v_branch.tenant_id
     OR v_invoice.status <> 'posted'
     OR v_invoice.zatca_invoice_type::text NOT IN ('simplified', 'standard')
     OR v_invoice.original_invoice_id IS NOT NULL THEN
    UPDATE public.generation_fiscal_operations_v1 SET state = 'failed', error_code = 'GENERATION_VALIDATION_FAILED', updated_at = clock_timestamp() WHERE id = v_operation.id;
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;

  IF public.build_zatca_atomic_receipt_snapshot_v2(v_invoice.id)
       IS DISTINCT FROM (p_document_snapshot - 'tenant_id' - 'branch_id') THEN
    UPDATE public.generation_fiscal_operations_v1 SET state = 'failed', error_code = 'GENERATION_VALIDATION_FAILED', updated_at = clock_timestamp() WHERE id = v_operation.id;
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;

  IF v_invoice.fiscal_lifecycle_state = 'generation_issued' THEN
    IF v_invoice.fiscal_document_snapshot IS NOT NULL
       AND v_invoice.fiscal_document_snapshot_hash IS NOT DISTINCT FROM p_snapshot_hash THEN
      v_result := jsonb_build_object(
        'invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
        'documentKind', v_invoice.zatca_invoice_type::text, 'fiscalRegime', 'generation',
        'lifecycleState', 'generation_issued', 'artifactStage', 'generation_final',
        'qrCode', v_invoice.fiscal_qr_payload, 'canPrint', true, 'canShare', true,
        'policyRevision', v_invoice.fiscal_policy_revision_at_issue, 'idempotentReplay', true
      );
      UPDATE public.generation_fiscal_operations_v1 SET state = 'issued', fiscal_result = v_result - 'idempotentReplay', policy_revision_at_issue = v_invoice.fiscal_policy_revision_at_issue, updated_at = clock_timestamp() WHERE id = v_operation.id;
      RETURN v_result;
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
  END IF;

  v_issued_at := clock_timestamp();
  UPDATE public.invoices
  SET fiscal_regime_at_issue = 'generation',
      fiscal_policy_revision_at_issue = v_branch.fiscal_policy_revision,
      fiscal_policy_snapshot = jsonb_build_object('regime', 'generation', 'policyRevision', v_branch.fiscal_policy_revision, 'activationState', v_branch.fiscal_activation_state),
      fiscal_document_snapshot = p_document_snapshot,
      fiscal_document_snapshot_hash = p_snapshot_hash,
      fiscal_lifecycle_state = 'generation_issued', fiscal_artifact_stage = 'generation_final',
      fiscal_qr_payload = p_qr_payload, fiscal_issued_at = v_issued_at
  WHERE id = v_invoice.id;

  v_result := jsonb_build_object(
    'invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
    'documentKind', v_invoice.zatca_invoice_type::text, 'fiscalRegime', 'generation',
    'lifecycleState', 'generation_issued', 'artifactStage', 'generation_final',
    'qrCode', p_qr_payload, 'canPrint', true, 'canShare', true,
    'policyRevision', v_branch.fiscal_policy_revision, 'idempotentReplay', false
  );
  UPDATE public.generation_fiscal_operations_v1
  SET state = 'issued', fiscal_result = v_result, policy_revision_at_issue = v_branch.fiscal_policy_revision,
      issued_at = v_issued_at, updated_at = v_issued_at WHERE id = v_operation.id;
  PERFORM public.record_audit_event('generation_invoice_issued', v_branch.tenant_id, p_branch_id, p_actor_user_id, NULL, 'invoice', p_invoice_id, 'info', 'succeeded', jsonb_build_object('fiscalRegime', 'generation', 'policyRevision', v_branch.fiscal_policy_revision, 'idempotencyKey', p_checkout_idempotency_key), NULL, NULL);
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_generation_invoice_v1(uuid, uuid, uuid, text, bigint, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_generation_invoice_v1(uuid, uuid, uuid, text, bigint, jsonb, text, text, text) TO service_role;
