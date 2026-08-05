-- Credit-note receivables visibility and settlement guardrails.
-- This migration replaces the two existing RPC bodies without changing
-- invoice, payment, or historical ledger data.

CREATE OR REPLACE FUNCTION public.get_credit_note_receivables_context_v1(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_invoice record;
  v_scope record;
  v_source_has_credit_component boolean := false;
  v_scope_authorized boolean := false;
  v_outstanding numeric(12,2) := 0;
BEGIN
  SELECT i.id, i.tenant_id, i.branch_id, i.customer_id, i.total_amount,
         i.payment_method::text AS payment_method,
         c.customer_type::text AS customer_type, b.is_active AS branch_active
    INTO v_invoice
  FROM public.invoices i
  JOIN public.branches b ON b.id = i.branch_id
  LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id;

  IF NOT FOUND OR v_invoice.customer_id IS NULL OR NOT coalesce(v_invoice.branch_active, false) THEN
    RETURN jsonb_build_object('eligible', false, 'source_has_credit_component', false,
      'outstanding_amount', 0, 'total_amount', coalesce(v_invoice.total_amount, 0),
      'payment_method', v_invoice.payment_method, 'customer_type', v_invoice.customer_type,
      'scope_authorized', false);
  END IF;

  BEGIN
    SELECT * INTO v_scope
    FROM public.ar_assert_scope_v1(v_invoice.branch_id, v_invoice.customer_id);
    v_scope_authorized := true;
  EXCEPTION WHEN others THEN
    v_scope_authorized := false;
  END;

  SELECT EXISTS (
    SELECT 1 FROM public.customer_receivable_entries e
    WHERE e.tenant_id = v_invoice.tenant_id
      AND e.branch_id = v_invoice.branch_id
      AND e.customer_id = v_invoice.customer_id
      AND e.source_kind = 'invoice'
      AND e.source_id = v_invoice.id
      AND e.entry_type = 'invoice'
  ) INTO v_source_has_credit_component;

  v_outstanding := round(coalesce(public.ar_invoice_outstanding_v1(v_invoice.id), 0), 2);
  RETURN jsonb_build_object(
    'eligible', v_scope_authorized AND v_source_has_credit_component
      AND lower(coalesce(v_invoice.customer_type, '')) = 'business'
      AND v_outstanding > 0.009,
    'source_has_credit_component', v_source_has_credit_component,
    'outstanding_amount', v_outstanding,
    'total_amount', round(coalesce(v_invoice.total_amount, 0), 2),
    'payment_method', v_invoice.payment_method,
    'customer_type', v_invoice.customer_type,
    'scope_authorized', v_scope_authorized
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_credit_note_receivables_context_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_credit_note_receivables_context_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_partial_credit_note_with_refund(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_allocations jsonb := p_payload -> 'refund_allocations';
  v_legacy_payload jsonb;
  v_result jsonb;
  v_credit_note_id uuid;
  v_original_invoice_id uuid;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_reason text;
  v_total numeric(12,2);
  v_allocation_total numeric(12,2);
  v_allocation_count integer;
  v_method text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  IF lower(coalesce(p_payload ->> 'apply_receivables_settlement', 'false')) = 'true' THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_NOT_APPLICABLE' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR v_allocations IS NULL OR jsonb_typeof(v_allocations) <> 'array'
     OR jsonb_array_length(v_allocations) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'CREDIT_NOTE_REFUND_ALLOCATION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric)
    WHERE a.method NOT IN ('cash', 'bank_transfer') OR a.amount IS NULL OR a.amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric)
    GROUP BY a.method HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CREDIT_NOTE_REFUND_ALLOCATION_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), round(sum(a.amount), 2) INTO v_allocation_count, v_allocation_total
  FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric);
  v_method := CASE WHEN v_allocation_count = 1 THEN v_allocations -> 0 ->> 'method' ELSE 'other' END;
  v_legacy_payload := jsonb_set(p_payload - 'refund_allocations', '{refund_method}', to_jsonb(v_method), true);
  v_result := public.create_partial_credit_note(v_legacy_payload);
  v_credit_note_id := (v_result ->> 'credit_note_invoice_id')::uuid;
  v_total := round((v_result ->> 'total')::numeric, 2);
  IF abs(v_allocation_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'CREDIT_NOTE_REFUND_ALLOCATION_INVALID' USING ERRCODE = '23514';
  END IF;
  IF coalesce((v_result ->> 'idempotent_replay')::boolean, false) THEN RETURN v_result; END IF;

  SELECT cn.original_invoice_id, cn.tenant_id, cn.branch_id, cn.credit_reason
    INTO v_original_invoice_id, v_tenant_id, v_branch_id, v_reason
  FROM public.invoices cn WHERE cn.id = v_credit_note_id FOR UPDATE;
  DELETE FROM public.payment_refunds WHERE credit_note_invoice_id = v_credit_note_id;
  INSERT INTO public.payment_refunds (
    tenant_id, branch_id, original_invoice_id, credit_note_invoice_id, payment_id,
    method, amount, reason, status, created_by, created_at
  )
  SELECT v_tenant_id, v_branch_id, v_original_invoice_id, v_credit_note_id, NULL,
    a.method::public.payment_method, round(a.amount, 2), v_reason, 'completed', v_user_id, now()
  FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric);
  INSERT INTO public.payments (
    tenant_id, invoice_id, recorded_by, amount, amount_received, change_amount, method, paid_at
  )
  SELECT v_tenant_id, v_credit_note_id, v_user_id, round(a.amount, 2), round(a.amount, 2), 0,
    a.method::public.payment_method, now()
  FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric);
  UPDATE public.invoices SET payment_method = v_method::public.payment_method WHERE id = v_credit_note_id;
  RETURN v_result || jsonb_build_object(
    'refund_method', CASE WHEN v_allocation_count = 2 THEN 'split' ELSE v_method END,
    'refund_allocations', v_allocations
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_credit_note_settlement_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_original_invoice_id uuid;
  v_operation_id uuid;
  v_original record;
  v_scope record;
  v_existing_operation record;
  v_fingerprint text;
  v_base_payload jsonb;
  v_base_result jsonb;
  v_credit_note_id uuid;
  v_credit_total numeric(12,2);
  v_open numeric(12,2);
  v_applied numeric(12,2) := 0;
  v_refund_tenders jsonb;
  v_refund record;
  v_refund_total numeric(12,2) := 0;
  v_refund_id uuid;
  v_response jsonb;
  v_source_has_credit_component boolean;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_NOT_APPLICABLE' USING ERRCODE = '22023';
  END IF;
  IF lower(coalesce(p_payload ->> 'apply_receivables_settlement', 'false')) <> 'true' THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_NOT_APPLICABLE' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_original_invoice_id := nullif(btrim(p_payload ->> 'original_invoice_id'), '')::uuid;
    v_operation_id := nullif(btrim(p_payload ->> 'operation_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_AMOUNT_INVALID' USING ERRCODE = '22023';
  END;
  IF v_original_invoice_id IS NULL OR v_operation_id IS NULL THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_NOT_APPLICABLE' USING ERRCODE = '22023';
  END IF;
  SELECT i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number, i.currency_code,
         c.customer_type::text AS customer_type
    INTO v_original
  FROM public.invoices i LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.id = v_original_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_original.customer_id IS NULL OR lower(coalesce(v_original.customer_type, '')) <> 'business' THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_NOT_APPLICABLE' USING ERRCODE = '23514';
  END IF;
  BEGIN
    SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_original.branch_id, v_original.customer_id);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_SCOPE_DENIED' USING ERRCODE = '42501';
  END;
  SELECT EXISTS (
    SELECT 1 FROM public.customer_receivable_entries e
    WHERE e.tenant_id = v_original.tenant_id AND e.branch_id = v_original.branch_id
      AND e.customer_id = v_original.customer_id AND e.source_kind = 'invoice'
      AND e.source_id = v_original.id AND e.entry_type = 'invoice'
  ) INTO v_source_has_credit_component;
  IF NOT v_source_has_credit_component THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_NOT_APPLICABLE' USING ERRCODE = '23514';
  END IF;
  v_open := round(coalesce(public.ar_invoice_outstanding_v1(v_original_invoice_id), 0), 2);
  IF v_open <= 0.009 THEN RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_BALANCE_ZERO' USING ERRCODE = '23514'; END IF;

  v_refund_tenders := coalesce(p_payload -> 'refund_tenders', '[]'::jsonb);
  IF jsonb_typeof(v_refund_tenders) <> 'array' OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric)
    WHERE method NOT IN ('cash', 'bank_transfer', 'other') OR amount IS NULL OR amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric)
    GROUP BY method HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_AMOUNT_INVALID' USING ERRCODE = '22023';
  END IF;
  v_fingerprint := md5(p_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('ar-operation:' || v_scope.tenant_id::text || ':' || v_operation_id::text, 0));
  SELECT * INTO v_existing_operation FROM public.customer_receivable_operations o
  WHERE o.tenant_id = v_scope.tenant_id AND o.operation_id = v_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_operation.action <> 'credit_note_settlement' OR v_existing_operation.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'AR_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_operation.response;
  END IF;

  v_base_payload := p_payload - 'operation_id' - 'refund_tenders' - 'idempotency_key';
  v_base_payload := v_base_payload || jsonb_build_object('idempotency_key', v_operation_id::text);
  v_base_result := public.create_partial_credit_note(v_base_payload);
  IF coalesce((v_base_result ->> 'idempotent_replay')::boolean, false) THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_IDEMPOTENCY_COLLISION' USING ERRCODE = 'P0001';
  END IF;
  v_credit_note_id := (v_base_result ->> 'credit_note_invoice_id')::uuid;
  v_credit_total := round((v_base_result ->> 'total')::numeric, 2);
  DELETE FROM public.payment_refunds WHERE credit_note_invoice_id = v_credit_note_id;
  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type, source_kind,
    source_id, credit_amount, currency_code, description, created_by
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_scope.receivable_account_id, v_original.customer_id,
    'credit_note', 'credit_note', v_credit_note_id, v_credit_total, v_original.currency_code,
    'Credit note ' || coalesce(v_base_result ->> 'credit_note_invoice_number', v_credit_note_id::text), v_scope.actor_id
  );
  v_applied := least(v_open, v_credit_total);
  IF v_applied > 0 THEN
    INSERT INTO public.customer_payment_allocations (
      tenant_id, receivable_account_id, invoice_id, credit_note_invoice_id, amount, allocated_by
    ) VALUES (v_scope.tenant_id, v_scope.receivable_account_id, v_original_invoice_id, v_credit_note_id, v_applied, v_scope.actor_id);
    PERFORM public.ar_refresh_invoice_settlement_v1(v_original_invoice_id);
  END IF;
  SELECT coalesce(round(sum(amount), 2), 0) INTO v_refund_total
  FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric);
  IF abs(v_refund_total - (v_credit_total - v_applied)) > 0.01 THEN
    IF v_refund_total > 0 THEN
      RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_AMOUNT_INVALID' USING ERRCODE = '23514';
    ELSE
      RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_REFUND_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  FOR v_refund IN SELECT * FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric) LOOP
    INSERT INTO public.payment_refunds (
      tenant_id, branch_id, original_invoice_id, credit_note_invoice_id, method, amount, reason, status, created_by
    ) VALUES (
      v_scope.tenant_id, v_scope.branch_id, v_original_invoice_id, v_credit_note_id,
      v_refund.method::public.payment_method, round(v_refund.amount, 2),
      coalesce(nullif(btrim(p_payload ->> 'reason'), ''), 'Customer credit-note refund'), 'completed', v_scope.actor_id
    ) RETURNING id INTO v_refund_id;
    INSERT INTO public.customer_receivable_entries (
      tenant_id, branch_id, receivable_account_id, customer_id, entry_type, source_kind,
      source_id, debit_amount, currency_code, description, created_by
    ) VALUES (
      v_scope.tenant_id, v_scope.branch_id, v_scope.receivable_account_id, v_original.customer_id,
      'credit_note_refund', 'credit_note_refund', v_refund_id, round(v_refund.amount, 2), v_original.currency_code,
      'Refund from credit note ' || coalesce(v_base_result ->> 'credit_note_invoice_number', v_credit_note_id::text), v_scope.actor_id
    );
  END LOOP;
  UPDATE public.invoices SET payment_status = CASE
    WHEN v_refund_total >= v_credit_total - 0.01 THEN 'refunded'::public.payment_status
    WHEN v_refund_total > 0 THEN 'partial'::public.payment_status
    ELSE 'pending'::public.payment_status END, updated_at = now()
  WHERE id = v_credit_note_id;
  v_response := v_base_result || jsonb_build_object(
    'applied_to_original_invoice', v_applied, 'refunded_amount', v_refund_total,
    'unapplied_customer_credit', round(v_credit_total - v_applied - v_refund_total, 2),
    'receivable_account_id', v_scope.receivable_account_id
  );
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'credit_note_settlement', v_fingerprint, v_scope.actor_id, v_response);
  PERFORM public.record_audit_event(
    'customer_credit_note_settled', v_scope.tenant_id, v_scope.branch_id, v_scope.actor_id, v_scope.actor_role,
    'invoice', v_credit_note_id, 'info', 'succeeded',
    jsonb_build_object('original_invoice_id', v_original_invoice_id, 'credit_total', v_credit_total,
      'applied', v_applied, 'refund', v_refund_total, 'operation_id', v_operation_id), NULL, NULL
  );
  RETURN v_response;
END
$function$;

REVOKE ALL ON FUNCTION public.create_partial_credit_note_with_refund(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_with_refund(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_customer_credit_note_settlement_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_credit_note_settlement_v1(jsonb) TO authenticated;
