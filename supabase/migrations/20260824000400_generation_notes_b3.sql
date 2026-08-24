-- Stage B3: Generation credit/debit note creation and finalization support.
-- Source-only. Generation notes use the existing invoice, item, refund, and
-- stock ledgers; they never enter the Integration/ZATCA submission pipeline.

CREATE TABLE IF NOT EXISTS public.generation_note_counters_v1 (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0)
);

ALTER TABLE public.generation_note_counters_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.generation_note_counters_v1 FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.generation_note_counters_v1 TO service_role;

-- B2's issue metadata is mutable until fiscal_issued_at is written. A posted
-- provisional note/invoice must be able to receive its first immutable artifact.
CREATE OR REPLACE FUNCTION public.prevent_fiscal_issue_metadata_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.fiscal_issued_at IS NOT NULL THEN
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

CREATE OR REPLACE FUNCTION public.create_generation_note_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile record;
  v_policy jsonb;
  v_parent record;
  v_existing record;
  v_line record;
  v_note_id uuid := gen_random_uuid();
  v_note_number text;
  v_kind text;
  v_reason text;
  v_key text;
  v_return_stock boolean := false;
  v_counter bigint;
  v_now timestamptz := clock_timestamp();
  v_payment_method text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'FISCAL_POLICY_UNAUTHORIZED' USING ERRCODE = '42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;
  v_kind := NULLIF(btrim(p_payload ->> 'note_type'), '');
  v_reason := NULLIF(btrim(p_payload ->> 'reason'), '');
  v_key := NULLIF(btrim(p_payload ->> 'idempotency_key'), '');
  v_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, false);
  IF v_kind NOT IN ('credit_note', 'debit_note') OR v_reason IS NULL
     OR length(v_reason) < 3 OR length(v_reason) > 500
     OR v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 200
     OR COALESCE((p_payload ->> 'expected_policy_revision')::bigint, 0) < 1
     OR NULLIF(btrim(p_payload ->> 'branch_id'), '') IS NULL
     OR NULLIF(btrim(p_payload ->> 'parent_invoice_id'), '') IS NULL THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;

  SELECT id, tenant_id, branch_id, role::text AS role, is_active INTO v_profile
  FROM public.user_profiles WHERE id = v_user;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;
  v_policy := public.resolve_fiscal_policy((p_payload ->> 'branch_id')::uuid);
  IF v_policy ->> 'regime' <> 'generation' THEN
    RAISE EXCEPTION 'CROSS_REGIME_NOTE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  IF (v_policy ->> 'policyRevision')::bigint <> (p_payload ->> 'expected_policy_revision')::bigint THEN
    RAISE EXCEPTION 'FISCAL_POLICY_CHANGED' USING ERRCODE = '40001';
  END IF;

  SELECT i.* INTO v_parent
  FROM public.invoices i
  WHERE i.id = (p_payload ->> 'parent_invoice_id')::uuid
  FOR UPDATE;
  IF NOT FOUND OR v_parent.tenant_id IS DISTINCT FROM (v_policy ->> 'tenantId')::uuid
     OR v_parent.branch_id IS DISTINCT FROM (p_payload ->> 'branch_id')::uuid THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '42501';
  END IF;
  IF v_parent.fiscal_regime_at_issue = 'integration' THEN
    RAISE EXCEPTION 'CROSS_REGIME_NOTE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  IF v_parent.fiscal_regime_at_issue IS DISTINCT FROM 'generation'
     OR v_parent.fiscal_lifecycle_state IS DISTINCT FROM 'generation_issued'
     OR v_parent.status::text <> 'posted'
     OR v_parent.zatca_invoice_type::text NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '23514';
  END IF;
  IF v_kind = 'credit_note' AND EXISTS (
    SELECT 1 FROM public.invoices
    WHERE original_invoice_id = v_parent.id
      AND zatca_invoice_type = 'credit_note'
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'GENERATION_CREDIT_LIMIT_EXCEEDED' USING ERRCODE = '23514';
  END IF;

  SELECT id, invoice_number, created_at, total_amount, fiscal_lifecycle_state,
         fiscal_qr_payload, credit_reason, zatca_invoice_type
    INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_parent.branch_id AND credit_note_idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.original_invoice_id IS DISTINCT FROM v_parent.id
       OR v_existing.zatca_invoice_type::text IS DISTINCT FROM v_kind
       OR v_existing.credit_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number, 'idempotent_replay', true);
  END IF;

  INSERT INTO public.generation_note_counters_v1(branch_id) VALUES (v_parent.branch_id) ON CONFLICT DO NOTHING;
  UPDATE public.generation_note_counters_v1 SET next_number = next_number + 1
   WHERE branch_id = v_parent.branch_id RETURNING next_number - 1 INTO v_counter;
  SELECT COALESCE(NULLIF(btrim(b.invoice_prefix), ''), 'INV') INTO v_note_number FROM public.branches b WHERE b.id = v_parent.branch_id;
  v_note_number := v_note_number || CASE WHEN v_kind = 'credit_note' THEN '-CN-' ELSE '-DN-' END || lpad(v_counter::text, 6, '0');
  v_payment_method := COALESCE(v_parent.payment_method::text, 'cash');

  INSERT INTO public.invoices (
    id, tenant_id, branch_id, customer_id, created_by, invoice_number, invoice_reference,
    original_invoice_id, credit_reason, credit_note_idempotency_key, zatca_invoice_type,
    zatca_type_code, zatca_status, subtotal, discount_amount, taxable_amount, tax_amount,
    total_amount, currency_code, invoice_date, payment_method, status, payment_status,
    notes, fiscal_regime_at_issue, fiscal_policy_revision_at_issue, fiscal_policy_snapshot,
    fiscal_lifecycle_state, fiscal_artifact_stage, created_at
  ) VALUES (
    v_note_id, v_parent.tenant_id, v_parent.branch_id, v_parent.customer_id, v_user,
    v_note_number, v_parent.invoice_number, v_parent.id, v_reason, v_key, v_kind,
    CASE WHEN v_kind = 'credit_note' THEN '381' ELSE '383' END, 'pending',
    v_parent.subtotal, v_parent.discount_amount, v_parent.taxable_amount, v_parent.tax_amount,
    v_parent.total_amount, COALESCE(v_parent.currency_code, 'SAR'), (v_now AT TIME ZONE 'Asia/Riyadh')::date,
    v_payment_method::public.payment_method, 'posted', CASE WHEN v_kind = 'credit_note' THEN 'refunded' ELSE 'pending' END,
    v_reason, 'generation', (v_policy ->> 'policyRevision')::bigint, v_policy,
    'not_submitted', 'none', v_now
  );

  FOR v_line IN SELECT * FROM public.invoice_items WHERE invoice_id = v_parent.id ORDER BY sort_order, id LOOP
    INSERT INTO public.invoice_items (
      invoice_id, tenant_id, product_id, original_invoice_item_id, name, name_ar, description, sku,
      unit, quantity, unit_price, discount_percent, discount_amount, subtotal, tax_rate, tax_category,
      tax_amount, total, sort_order, line_source, stock_tracked_at_sale, service_item_at_sale
    ) VALUES (
      v_note_id, v_parent.tenant_id, v_line.product_id, v_line.id, v_line.name, v_line.name_ar,
      v_line.description, v_line.sku, v_line.unit, v_line.quantity, v_line.unit_price,
      v_line.discount_percent, v_line.discount_amount, v_line.subtotal, v_line.tax_rate, v_line.tax_category,
      v_line.tax_amount, v_line.total, v_line.sort_order, v_line.line_source,
      v_line.stock_tracked_at_sale, v_line.service_item_at_sale
    );
    IF v_kind = 'credit_note' AND v_return_stock AND v_line.product_id IS NOT NULL
       AND COALESCE(v_line.stock_tracked_at_sale, false) IS TRUE
       AND COALESCE(v_line.service_item_at_sale, false) IS FALSE THEN
      UPDATE public.products SET stock_quantity = COALESCE(stock_quantity, 0) + v_line.quantity
       WHERE id = v_line.product_id AND tenant_id = v_parent.tenant_id AND branch_id = v_parent.branch_id;
      INSERT INTO public.pos_stock_movements(tenant_id, branch_id, product_id, invoice_id, quantity_delta, reason, created_by)
      VALUES (v_parent.tenant_id, v_parent.branch_id, v_line.product_id, v_note_id, v_line.quantity, 'refund_return', v_user);
    END IF;
  END LOOP;

  IF v_kind = 'credit_note' THEN
    INSERT INTO public.payment_refunds(tenant_id, branch_id, original_invoice_id, credit_note_invoice_id, method, amount, reason, status, created_by, created_at)
    VALUES (v_parent.tenant_id, v_parent.branch_id, v_parent.id, v_note_id, v_payment_method::public.payment_method, v_parent.total_amount, v_reason, 'completed', v_user, v_now);
  END IF;
  RETURN jsonb_build_object('invoice_id', v_note_id, 'invoice_number', v_note_number, 'idempotent_replay', false);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.create_generation_note_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_generation_note_v1(jsonb) TO authenticated;

-- Extend the B2 finalizer for already-created Generation notes. The operation
-- table, QR construction, and immutable result shape remain the B2 contract.
CREATE OR REPLACE FUNCTION public.finalize_generation_invoice_v1(
  p_invoice_id uuid, p_branch_id uuid, p_actor_user_id uuid,
  p_checkout_idempotency_key text, p_expected_policy_revision bigint,
  p_document_snapshot jsonb, p_snapshot_hash text, p_qr_payload text,
  p_request_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET row_security = off AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_profile public.user_profiles%ROWTYPE;
  v_parent public.invoices%ROWTYPE;
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
  IF v_branch.fiscal_regime <> 'generation' OR v_branch.fiscal_activation_state <> 'generation_active' THEN
    RAISE EXCEPTION 'GENERATION_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_branch.fiscal_policy_revision <> p_expected_policy_revision THEN
    RAISE EXCEPTION 'FISCAL_POLICY_CHANGED' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_operation FROM public.generation_fiscal_operations_v1
  WHERE branch_id = p_branch_id AND checkout_idempotency_key = p_checkout_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_operation.request_fingerprint <> p_request_fingerprint OR v_operation.invoice_id <> p_invoice_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
    END IF;
    IF v_operation.state = 'issued' AND v_operation.fiscal_result IS NOT NULL THEN
      RETURN v_operation.fiscal_result || jsonb_build_object('idempotentReplay', true);
    END IF;
  ELSE
    INSERT INTO public.generation_fiscal_operations_v1 (
      tenant_id, branch_id, actor_user_id, invoice_id, checkout_idempotency_key,
      request_fingerprint, expected_policy_revision
    ) VALUES (
      v_branch.tenant_id, p_branch_id, p_actor_user_id, p_invoice_id,
      p_checkout_idempotency_key, p_request_fingerprint, p_expected_policy_revision
    ) RETURNING * INTO v_operation;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL OR v_invoice.branch_id <> p_branch_id
     OR v_invoice.tenant_id <> v_branch.tenant_id OR v_invoice.status <> 'posted'
     OR v_invoice.zatca_invoice_type::text NOT IN ('simplified', 'standard', 'credit_note', 'debit_note') THEN
    UPDATE public.generation_fiscal_operations_v1 SET state = 'failed', error_code = 'GENERATION_VALIDATION_FAILED', updated_at = clock_timestamp() WHERE id = v_operation.id;
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.zatca_invoice_type::text IN ('credit_note', 'debit_note') THEN
    SELECT * INTO v_parent FROM public.invoices WHERE id = v_invoice.original_invoice_id FOR SHARE;
    IF v_parent.id IS NULL OR v_parent.tenant_id <> v_invoice.tenant_id OR v_parent.branch_id <> v_invoice.branch_id
       OR v_parent.fiscal_regime_at_issue <> 'generation' OR v_parent.fiscal_lifecycle_state <> 'generation_issued'
       OR v_parent.status <> 'posted' THEN
      UPDATE public.generation_fiscal_operations_v1 SET state = 'failed', error_code = 'GENERATION_VALIDATION_FAILED', updated_at = clock_timestamp() WHERE id = v_operation.id;
      RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
    END IF;
    IF (p_document_snapshot -> 'parentSnapshot' ->> 'id')::uuid IS DISTINCT FROM v_parent.id THEN
      RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_invoice.original_invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF public.build_zatca_atomic_receipt_snapshot_v2(v_invoice.id)
       IS DISTINCT FROM (p_document_snapshot - 'tenant_id' - 'branch_id' - 'parentSnapshot') THEN
    UPDATE public.generation_fiscal_operations_v1 SET state = 'failed', error_code = 'GENERATION_VALIDATION_FAILED', updated_at = clock_timestamp() WHERE id = v_operation.id;
    RAISE EXCEPTION 'GENERATION_VALIDATION_FAILED' USING ERRCODE = '22023';
  END IF;
  IF v_invoice.fiscal_lifecycle_state = 'generation_issued' THEN
    IF v_invoice.fiscal_document_snapshot IS NOT NULL AND v_invoice.fiscal_document_snapshot_hash IS NOT DISTINCT FROM p_snapshot_hash THEN
      v_result := jsonb_build_object('invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
        'documentKind', v_invoice.zatca_invoice_type::text, 'fiscalRegime', 'generation',
        'lifecycleState', 'generation_issued', 'artifactStage', 'generation_final',
        'qrCode', v_invoice.fiscal_qr_payload, 'canPrint', true, 'canShare', true,
        'policyRevision', v_invoice.fiscal_policy_revision_at_issue, 'idempotentReplay', true);
      UPDATE public.generation_fiscal_operations_v1 SET state = 'issued', fiscal_result = v_result - 'idempotentReplay', policy_revision_at_issue = v_invoice.fiscal_policy_revision_at_issue, updated_at = clock_timestamp() WHERE id = v_operation.id;
      RETURN v_result;
    END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
  END IF;
  v_issued_at := clock_timestamp();
  UPDATE public.invoices SET
    fiscal_regime_at_issue = 'generation', fiscal_policy_revision_at_issue = v_branch.fiscal_policy_revision,
    fiscal_policy_snapshot = jsonb_build_object('regime', 'generation', 'policyRevision', v_branch.fiscal_policy_revision, 'activationState', v_branch.fiscal_activation_state),
    fiscal_document_snapshot = p_document_snapshot, fiscal_document_snapshot_hash = p_snapshot_hash,
    fiscal_lifecycle_state = 'generation_issued', fiscal_artifact_stage = 'generation_final',
    fiscal_qr_payload = p_qr_payload, fiscal_issued_at = v_issued_at WHERE id = v_invoice.id;
  v_result := jsonb_build_object('invoiceId', v_invoice.id, 'invoiceNumber', v_invoice.invoice_number,
    'documentKind', v_invoice.zatca_invoice_type::text, 'fiscalRegime', 'generation',
    'lifecycleState', 'generation_issued', 'artifactStage', 'generation_final',
    'qrCode', p_qr_payload, 'canPrint', true, 'canShare', true,
    'policyRevision', v_branch.fiscal_policy_revision, 'idempotentReplay', false);
  UPDATE public.generation_fiscal_operations_v1 SET state = 'issued', fiscal_result = v_result,
    policy_revision_at_issue = v_branch.fiscal_policy_revision, issued_at = v_issued_at, updated_at = v_issued_at WHERE id = v_operation.id;
  PERFORM public.record_audit_event('generation_note_issued', v_branch.tenant_id, p_branch_id, p_actor_user_id, NULL, 'invoice', p_invoice_id, 'info', 'succeeded', jsonb_build_object('fiscalRegime', 'generation', 'documentKind', v_invoice.zatca_invoice_type::text, 'policyRevision', v_branch.fiscal_policy_revision, 'idempotencyKey', p_checkout_idempotency_key), NULL, NULL);
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE = '23505';
END;
$$;
