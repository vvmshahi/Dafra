-- Server-authoritative customer credit and receivables operations.
--
-- Fiscal invoice creation remains delegated to the reviewed POS and credit-note
-- engines. This migration only appends receivables settlement records and
-- updates the non-fiscal invoice payment_status field derived from them.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

DO $required_contracts$
BEGIN
  IF to_regclass('public.customers') IS NULL
     OR to_regclass('public.invoices') IS NULL
     OR to_regclass('public.payments') IS NULL
     OR to_regclass('public.payment_refunds') IS NULL
     OR to_regprocedure('public.pos_checkout_capability_base_v1(jsonb)') IS NULL
     OR to_regprocedure('public.create_partial_credit_note(jsonb)') IS NULL
     OR to_regprocedure('public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'AR_V1_REQUIRED_COMMERCIAL_CONTRACT_MISSING';
  END IF;
END
$required_contracts$;

CREATE OR REPLACE FUNCTION public.ar_assert_scope_v1(
  p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL
)
RETURNS TABLE(
  tenant_id uuid,
  actor_id uuid,
  actor_role text,
  branch_id uuid,
  customer_id uuid,
  receivable_account_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_branch record;
  v_customer record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AR_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor
  FROM public.user_profiles p
  WHERE p.id = auth.uid();

  IF NOT FOUND OR v_actor.is_active IS NOT TRUE OR v_actor.role NOT IN ('owner', 'branch') THEN
    RAISE EXCEPTION 'AR_ACTOR_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active, coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;

  IF NOT FOUND
     OR v_branch.is_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'AR_BRANCH_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  IF v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role = 'branch' AND v_actor.branch_id IS DISTINCT FROM v_branch.id)
  THEN
    RAISE EXCEPTION 'AR_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.tenant_id, c.branch_id, c.receivable_account_id, c.is_active
    INTO v_customer
    FROM public.customers c
    WHERE c.id = p_customer_id;

    IF NOT FOUND
       OR v_customer.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_customer.branch_id IS DISTINCT FROM v_branch.id
       OR v_customer.is_active IS NOT TRUE
    THEN
      RAISE EXCEPTION 'AR_CUSTOMER_NOT_ACTIVE_OR_OUT_OF_SCOPE' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_branch.tenant_id,
    v_actor.id,
    v_actor.role,
    v_branch.id,
    CASE WHEN p_customer_id IS NULL THEN NULL::uuid ELSE v_customer.id END,
    CASE WHEN p_customer_id IS NULL THEN NULL::uuid ELSE v_customer.receivable_account_id END;
END
$function$;

CREATE OR REPLACE FUNCTION public.ar_ensure_customer_account_v1(p_customer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer record;
  v_scope record;
  v_account_id uuid;
BEGIN
  SELECT c.* INTO v_customer
  FROM public.customers c
  WHERE c.id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope
  FROM public.ar_assert_scope_v1(v_customer.branch_id, v_customer.id);

  IF v_customer.receivable_account_id IS NOT NULL THEN
    RETURN v_customer.receivable_account_id;
  END IF;

  INSERT INTO public.customer_receivable_accounts (
    tenant_id, account_number, display_name, display_name_ar,
    customer_type, vat_number, cr_number
  ) VALUES (
    v_scope.tenant_id,
    'AR-' || upper(replace(v_customer.id::text, '-', '')),
    coalesce(nullif(btrim(v_customer.business_name), ''), nullif(btrim(v_customer.company_name), ''), v_customer.name),
    coalesce(nullif(btrim(v_customer.business_name_ar), ''), nullif(btrim(v_customer.name_ar), '')),
    coalesce(nullif(btrim(v_customer.customer_type), ''), 'individual'),
    v_customer.vat_number,
    v_customer.cr_number
  ) RETURNING id INTO v_account_id;

  UPDATE public.customers
  SET receivable_account_id = v_account_id,
      updated_at = now()
  WHERE id = v_customer.id;

  RETURN v_account_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.ar_account_balance_v1(
  p_receivable_account_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric
  FROM public.customer_receivable_entries e
  WHERE e.receivable_account_id = p_receivable_account_id
    AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
$function$;

CREATE OR REPLACE FUNCTION public.ar_invoice_outstanding_v1(p_invoice_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_debit numeric;
  v_allocated numeric;
BEGIN
  SELECT e.debit_amount INTO v_debit
  FROM public.customer_receivable_entries e
  WHERE e.source_kind = 'invoice'
    AND e.source_id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(a.amount), 0)::numeric INTO v_allocated
  FROM public.customer_payment_allocations a
  LEFT JOIN public.customer_payment_receipts r ON r.id = a.receipt_id
  WHERE a.invoice_id = p_invoice_id
    AND (a.credit_note_invoice_id IS NOT NULL OR r.status = 'completed');

  RETURN greatest(round(v_debit - v_allocated, 2), 0);
END
$function$;

CREATE OR REPLACE FUNCTION public.ar_refresh_invoice_settlement_v1(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_invoice record;
  v_open numeric;
BEGIN
  SELECT i.id, i.total_amount, i.status::text AS status, i.zatca_invoice_type::text AS document_type
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND OR v_invoice.status <> 'posted' OR v_invoice.document_type NOT IN ('simplified', 'standard') THEN
    RETURN;
  END IF;

  v_open := public.ar_invoice_outstanding_v1(p_invoice_id);
  IF v_open IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.invoices
  SET payment_status = CASE
      WHEN v_open <= 0.01 THEN 'paid'::public.payment_status
      WHEN v_open >= v_invoice.total_amount - 0.01 THEN 'pending'::public.payment_status
      ELSE 'partial'::public.payment_status
    END,
    updated_at = now()
  WHERE id = p_invoice_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.ar_receipt_number_v1(p_receipt_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT 'RCP-' || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYYMMDD-HH24MISS')
    || '-' || upper(substr(replace(p_receipt_id::text, '-', ''), 1, 8))
$function$;

CREATE OR REPLACE FUNCTION public.set_customer_credit_policy_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer_id uuid;
  v_scope record;
  v_account_id uuid;
  v_credit_enabled boolean;
  v_credit_limit numeric(12,2);
  v_terms text;
  v_hold boolean;
  v_hold_reason text;
  v_overdue_block boolean;
  v_warn_threshold_percent numeric(5,2);
  v_requires_owner_approval boolean;
  v_result jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_POLICY_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_customer_id := nullif(btrim(p_payload->>'customer_id'), '')::uuid;
    v_credit_limit := coalesce(nullif(btrim(p_payload->>'credit_limit'), '')::numeric, 0);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
  END;
  IF v_customer_id IS NULL OR v_credit_limit < 0 THEN
    RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope
  FROM public.ar_assert_scope_v1((SELECT branch_id FROM public.customers WHERE id = v_customer_id), v_customer_id);
  IF v_scope.actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'AR_CREDIT_POLICY_OWNER_ONLY' USING ERRCODE = '42501';
  END IF;

  v_account_id := public.ar_ensure_customer_account_v1(v_customer_id);
  v_credit_enabled := coalesce((p_payload->>'credit_enabled')::boolean, false);
  v_terms := nullif(btrim(p_payload->>'terms'), '');
  v_hold := coalesce((p_payload->>'hold')::boolean, false);
  v_hold_reason := nullif(btrim(p_payload->>'hold_reason'), '');
  v_overdue_block := coalesce((p_payload->>'overdue_block')::boolean, false);
  v_warn_threshold_percent := coalesce((p_payload->>'warn_threshold_percent')::numeric, 80);
  v_requires_owner_approval := coalesce((p_payload->>'requires_owner_approval')::boolean, false);
  IF v_hold AND v_hold_reason IS NULL THEN
    RAISE EXCEPTION 'AR_CREDIT_HOLD_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_warn_threshold_percent < 0 OR v_warn_threshold_percent > 100 THEN
    RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customer_credit_policies (
    tenant_id, receivable_account_id, credit_enabled, credit_limit, terms, hold,
    hold_reason, overdue_block, warn_threshold_percent, requires_owner_approval, updated_by
  ) VALUES (
    v_scope.tenant_id, v_account_id, v_credit_enabled, v_credit_limit, v_terms, v_hold,
    v_hold_reason, v_overdue_block, v_warn_threshold_percent, v_requires_owner_approval, v_scope.actor_id
  )
  ON CONFLICT (tenant_id, receivable_account_id) DO UPDATE
  SET credit_enabled = excluded.credit_enabled,
      credit_limit = excluded.credit_limit,
      terms = excluded.terms,
      hold = excluded.hold,
      hold_reason = excluded.hold_reason,
      overdue_block = excluded.overdue_block,
      warn_threshold_percent = excluded.warn_threshold_percent,
      requires_owner_approval = excluded.requires_owner_approval,
      updated_by = excluded.updated_by,
      updated_at = now();

  SELECT jsonb_build_object(
    'customer_id', v_customer_id,
    'receivable_account_id', v_account_id,
    'credit_enabled', p.credit_enabled,
    'credit_limit', p.credit_limit,
    'terms', p.terms,
    'hold', p.hold,
    'hold_reason', p.hold_reason,
    'overdue_block', p.overdue_block,
    'warn_threshold_percent', p.warn_threshold_percent,
    'requires_owner_approval', p.requires_owner_approval
  ) INTO v_result
  FROM public.customer_credit_policies p
  WHERE p.tenant_id = v_scope.tenant_id AND p.receivable_account_id = v_account_id;

  PERFORM public.record_audit_event(
    'customer_credit_policy_set', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer', v_customer_id,
    'info', 'succeeded', jsonb_build_object('credit_limit', v_credit_limit, 'enabled', v_credit_enabled, 'hold', v_hold), NULL, NULL
  );
  RETURN v_result;
END
$function$;

CREATE OR REPLACE FUNCTION public.post_customer_credit_checkout_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_operation_id uuid;
  v_scope record;
  v_policy record;
  v_existing_operation record;
  v_account_id uuid;
  v_fingerprint text;
  v_mode text;
  v_initial_tenders jsonb;
  v_tender record;
  v_tender_count integer;
  v_initial_total numeric(12,2);
  v_base_payload jsonb;
  v_base_result jsonb;
  v_invoice_id uuid;
  v_invoice record;
  v_receipt_id uuid;
  v_receipt_method text;
  v_balance_before numeric(12,2);
  v_outstanding numeric(12,2);
  v_overdue_amount numeric(12,2) := 0;
  v_override_reason text;
  v_due_date date;
  v_credit_warning boolean := false;
  v_document_decision jsonb;
  v_response jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_CHECKOUT_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
    v_customer_id := nullif(btrim(p_payload->>'customer_id'), '')::uuid;
    v_operation_id := nullif(btrim(p_payload->>'operation_id'), '')::uuid;
    v_due_date := nullif(btrim(p_payload->>'due_date'), '')::date;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_customer_id IS NULL OR v_operation_id IS NULL THEN
    RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIERS_REQUIRED' USING ERRCODE = '22023';
  END IF;

  v_mode := coalesce(nullif(btrim(p_payload->>'settlement_mode'), ''), 'credit');
  v_initial_tenders := coalesce(p_payload->'initial_payments', '[]'::jsonb);
  IF v_mode NOT IN ('credit', 'partial') OR jsonb_typeof(v_initial_tenders) <> 'array' THEN
    RAISE EXCEPTION 'AR_CHECKOUT_SETTLEMENT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_initial_tenders) AS tender(method text, amount numeric, reference text)
    WHERE method NOT IN ('cash', 'card', 'bank_transfer', 'other') OR amount IS NULL OR amount <= 0
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_initial_tenders) AS tender(method text, amount numeric, reference text)
    GROUP BY method HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AR_CHECKOUT_TENDER_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), coalesce(round(sum(amount), 2), 0)
  INTO v_tender_count, v_initial_total
  FROM jsonb_to_recordset(v_initial_tenders) AS tender(method text, amount numeric, reference text);
  IF (v_mode = 'credit' AND v_initial_total <> 0)
     OR (v_mode = 'partial' AND v_initial_total <= 0) THEN
    RAISE EXCEPTION 'AR_CHECKOUT_SETTLEMENT_MODE_MISMATCH' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  v_override_reason := nullif(btrim(p_payload->>'override_reason'), '');
  IF v_override_reason IS NOT NULL AND length(v_override_reason) > 500 THEN
    RAISE EXCEPTION 'AR_OVERRIDE_REASON_INVALID' USING ERRCODE = '22023';
  END IF;
  v_account_id := public.ar_ensure_customer_account_v1(v_customer_id);
  v_fingerprint := md5(p_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('ar-operation:' || v_scope.tenant_id::text || ':' || v_operation_id::text, 0));
  SELECT * INTO v_existing_operation
  FROM public.customer_receivable_operations o
  WHERE o.tenant_id = v_scope.tenant_id AND o.operation_id = v_operation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_operation.action <> 'credit_checkout' OR v_existing_operation.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'AR_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_operation.response;
  END IF;

  SELECT * INTO v_policy
  FROM public.customer_credit_policies p
  WHERE p.tenant_id = v_scope.tenant_id AND p.receivable_account_id = v_account_id
  FOR UPDATE;
  IF NOT FOUND OR v_policy.credit_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_CREDIT_DISABLED' USING ERRCODE = '42501';
  END IF;
  IF v_policy.hold IS TRUE
     AND (v_scope.actor_role NOT IN ('owner', 'admin', 'manager') OR v_override_reason IS NULL)
  THEN
    RAISE EXCEPTION 'AR_CREDIT_HOLD:%', v_policy.hold_reason USING ERRCODE = '42501';
  END IF;
  IF v_policy.requires_owner_approval IS TRUE AND v_scope.actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'AR_CREDIT_OWNER_APPROVAL_REQUIRED' USING ERRCODE = '42501';
  END IF;

  v_document_decision := public.resolve_pos_checkout_document_internal_v1(
    auth.uid(), v_branch_id, v_customer_id
  );
  IF v_document_decision->>'status' IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION '%', coalesce(v_document_decision->>'code', 'AR_CHECKOUT_DOCUMENT_BLOCKED')
      USING ERRCODE = 'P0001';
  END IF;

  -- The reviewed commercial checkout owns pricing, product snapshots, stock,
  -- invoice counters, invoice lines and fiscal identity. It is called with a
  -- temporary full bank-transfer tender inside this transaction; that tender is
  -- removed before commit and replaced by AR receipt/ledger records below.
  v_base_payload := p_payload - 'operation_id' - 'settlement_mode' - 'initial_payments'
    - 'payment_method' - 'amount_paid' - 'payments' - 'idempotency_key';
  v_base_payload := v_base_payload || jsonb_build_object(
    'idempotency_key', v_operation_id::text,
    'payment_method', 'bank_transfer',
    'amount_paid', NULL
  );
  -- The base function must not create a legacy payment/AR trigger side effect;
  -- this operation creates the authoritative receipt below instead.
  PERFORM set_config('app.ar_skip_legacy_sync', 'true', true);
  v_base_result := public.pos_checkout_capability_base_v1(v_base_payload);
  IF coalesce((v_base_result->>'idempotent_replay')::boolean, false) THEN
    RAISE EXCEPTION 'AR_CHECKOUT_IDEMPOTENCY_COLLISION' USING ERRCODE = 'P0001';
  END IF;
  v_invoice_id := (v_base_result->>'invoice_id')::uuid;
  SELECT i.* INTO v_invoice FROM public.invoices i WHERE i.id = v_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'AR_CHECKOUT_COMMERCIAL_RESULT_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF v_initial_total >= v_invoice.total_amount - 0.01 THEN
    RAISE EXCEPTION 'AR_CREDIT_NOT_REQUIRED_FOR_FULL_SETTLEMENT' USING ERRCODE = '23514';
  END IF;

  v_balance_before := public.ar_account_balance_v1(v_account_id);
  v_outstanding := round(v_invoice.total_amount - v_initial_total, 2);
  SELECT coalesce(sum(public.ar_invoice_outstanding_v1(i.id)), 0)
  INTO v_overdue_amount
  FROM public.invoices i
  WHERE i.tenant_id = v_scope.tenant_id
    AND i.customer_id = v_customer_id
    AND i.status = 'posted'
    AND i.zatca_invoice_type IN ('simplified', 'standard')
    AND i.due_date IS NOT NULL
    AND i.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date
    AND public.ar_invoice_outstanding_v1(i.id) > 0.01;

  v_credit_warning := v_policy.credit_limit > 0
    AND v_balance_before + v_outstanding >= v_policy.credit_limit
      * (v_policy.warn_threshold_percent / 100.0);

  IF v_balance_before + v_outstanding > v_policy.credit_limit + 0.01
     AND NOT (
       v_override_reason IS NOT NULL
       AND v_scope.actor_role IN ('owner', 'admin', 'manager')
       AND NOT (v_scope.actor_role = 'manager' AND v_policy.requires_owner_approval IS TRUE)
     )
  THEN
    RAISE EXCEPTION 'AR_CREDIT_LIMIT_EXCEEDED' USING ERRCODE = '23514';
  END IF;
  IF v_policy.overdue_block IS TRUE AND v_overdue_amount > 0.01
     AND NOT (
       v_override_reason IS NOT NULL
       AND v_scope.actor_role IN ('owner', 'admin', 'manager')
       AND NOT (v_scope.actor_role = 'manager' AND v_policy.requires_owner_approval IS TRUE)
     )
  THEN
    RAISE EXCEPTION 'AR_OVERDUE_CREDIT_BLOCKED' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.payments WHERE invoice_id = v_invoice_id;
  UPDATE public.invoices
  SET payment_method = CASE
        WHEN v_initial_total > 0 AND v_tender_count = 1
          THEN (v_initial_tenders->0->>'method')::public.payment_method
        ELSE 'other'::public.payment_method
      END,
      due_date = v_due_date,
      payment_status = CASE WHEN v_initial_total > 0 THEN 'partial'::public.payment_status ELSE 'pending'::public.payment_status END,
      updated_at = now()
  WHERE id = v_invoice_id;

  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
    source_kind, source_id, debit_amount, credit_amount, currency_code,
    effective_at, description, created_by
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_account_id, v_customer_id, 'invoice',
    'invoice', v_invoice_id, round(v_invoice.total_amount, 2), 0, v_invoice.currency_code,
    v_invoice.created_at, 'Invoice ' || v_invoice.invoice_number, v_scope.actor_id
  );

  IF v_initial_total > 0 THEN
    v_receipt_id := gen_random_uuid();
    v_receipt_method := CASE WHEN v_tender_count = 1 THEN (v_initial_tenders->0->>'method') ELSE 'split' END;
    INSERT INTO public.customer_payment_receipts (
      id, tenant_id, branch_id, receivable_account_id, customer_id, receipt_number,
      amount, currency_code, method, reference, origin, operation_id, recorded_by, received_at
    ) VALUES (
      v_receipt_id, v_scope.tenant_id, v_scope.branch_id, v_account_id, v_customer_id,
      public.ar_receipt_number_v1(v_receipt_id), v_initial_total, v_invoice.currency_code,
      v_receipt_method, nullif(btrim(v_initial_tenders->0->>'reference'), ''),
      'checkout_initial', v_operation_id, v_scope.actor_id, v_invoice.created_at
    );
    FOR v_tender IN
      SELECT * FROM jsonb_to_recordset(v_initial_tenders) AS tender(method text, amount numeric, reference text)
    LOOP
      INSERT INTO public.customer_payment_receipt_tenders (receipt_id, method, amount, reference)
      VALUES (v_receipt_id, v_tender.method, round(v_tender.amount, 2), nullif(btrim(v_tender.reference), ''));
    END LOOP;
    INSERT INTO public.customer_receivable_entries (
      tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
      source_kind, source_id, debit_amount, credit_amount, currency_code,
      effective_at, description, created_by
    ) VALUES (
      v_scope.tenant_id, v_scope.branch_id, v_account_id, v_customer_id, 'payment_receipt',
      'payment_receipt', v_receipt_id, 0, v_initial_total, v_invoice.currency_code,
      v_invoice.created_at, 'Initial payment for ' || v_invoice.invoice_number, v_scope.actor_id
    );
    INSERT INTO public.customer_payment_allocations (
      tenant_id, receivable_account_id, invoice_id, receipt_id, amount, allocated_by, allocated_at
    ) VALUES (
      v_scope.tenant_id, v_account_id, v_invoice_id, v_receipt_id, v_initial_total, v_scope.actor_id, v_invoice.created_at
    );
  END IF;
  PERFORM public.ar_refresh_invoice_settlement_v1(v_invoice_id);

  v_response := (v_base_result - 'payment_method' - 'display_payment_method' - 'payment_status' - 'payments' - 'amount_received' - 'change_amount')
    || jsonb_build_object(
      'payment_method', 'credit',
      'display_payment_method', CASE WHEN v_initial_total > 0 THEN 'partial_credit' ELSE 'credit' END,
      'payment_status', CASE WHEN v_initial_total > 0 THEN 'partial' ELSE 'pending' END,
      'amount_received', v_initial_total,
      'change_amount', 0,
      'payments', v_initial_tenders,
      'receivable_account_id', v_account_id,
      'outstanding_amount', v_outstanding,
      'credit_warning', v_credit_warning,
      'overdue_amount', v_overdue_amount,
      'override_reason', v_override_reason,
      'receipt_id', v_receipt_id,
      'checkout_path', 'receivables'
    );
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'credit_checkout', v_fingerprint, v_scope.actor_id, v_response
  );
  PERFORM public.record_audit_event(
    'customer_credit_checkout_posted', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'invoice', v_invoice_id, 'info', 'succeeded',
    jsonb_build_object('invoice_total', v_invoice.total_amount, 'initial_payment', v_initial_total, 'outstanding', v_outstanding, 'operation_id', v_operation_id), NULL, NULL
  );
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.record_customer_payment_receipt_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_operation_id uuid;
  v_scope record;
  v_existing_operation record;
  v_fingerprint text;
  v_amount numeric(12,2);
  v_tenders jsonb;
  v_allocations jsonb;
  v_auto_allocate boolean;
  v_tender record;
  v_allocation record;
  v_invoice record;
  v_receipt_id uuid := gen_random_uuid();
  v_method text;
  v_tender_count integer;
  v_tender_total numeric(12,2);
  v_allocated numeric(12,2) := 0;
  v_remaining numeric(12,2);
  v_open numeric(12,2);
  v_account_balance numeric(12,2);
  v_response jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_RECEIPT_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
    v_customer_id := nullif(btrim(p_payload->>'customer_id'), '')::uuid;
    v_operation_id := nullif(btrim(p_payload->>'operation_id'), '')::uuid;
    v_amount := nullif(btrim(p_payload->>'amount'), '')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'AR_RECEIPT_VALUE_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_customer_id IS NULL OR v_operation_id IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'AR_RECEIPT_FIELDS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  v_tenders := coalesce(p_payload->'tenders', '[]'::jsonb);
  v_allocations := coalesce(p_payload->'allocations', '[]'::jsonb);
  v_auto_allocate := coalesce((p_payload->>'auto_allocate')::boolean, true);
  IF jsonb_typeof(v_tenders) <> 'array' OR jsonb_array_length(v_tenders) = 0
     OR jsonb_typeof(v_allocations) <> 'array' THEN
    RAISE EXCEPTION 'AR_RECEIPT_COLLECTION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_tenders) AS tender(method text, amount numeric, reference text)
    WHERE method NOT IN ('cash', 'card', 'bank_transfer', 'other') OR amount IS NULL OR amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_tenders) AS tender(method text, amount numeric, reference text)
    GROUP BY method HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AR_RECEIPT_TENDER_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), coalesce(round(sum(amount), 2), 0)
  INTO v_tender_count, v_tender_total
  FROM jsonb_to_recordset(v_tenders) AS tender(method text, amount numeric, reference text);
  IF abs(v_tender_total - v_amount) > 0.01 THEN
    RAISE EXCEPTION 'AR_RECEIPT_TENDER_TOTAL_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NOT v_auto_allocate AND jsonb_array_length(v_allocations) = 0 THEN
    RAISE EXCEPTION 'AR_RECEIPT_MANUAL_ALLOCATION_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS allocation(invoice_id uuid, amount numeric)
    WHERE invoice_id IS NULL OR amount IS NULL OR amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS allocation(invoice_id uuid, amount numeric)
    GROUP BY invoice_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AR_RECEIPT_ALLOCATION_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  IF v_scope.receivable_account_id IS NULL THEN
    RAISE EXCEPTION 'AR_SETTLEMENT_UNKNOWN_FOR_HISTORICAL_CUSTOMER' USING ERRCODE = '23514';
  END IF;
  v_fingerprint := md5(p_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('ar-operation:' || v_scope.tenant_id::text || ':' || v_operation_id::text, 0));
  SELECT * INTO v_existing_operation FROM public.customer_receivable_operations o
  WHERE o.tenant_id = v_scope.tenant_id AND o.operation_id = v_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_operation.action <> 'payment_receipt' OR v_existing_operation.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'AR_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_operation.response;
  END IF;

  v_method := CASE WHEN v_tender_count = 1 THEN v_tenders->0->>'method' ELSE 'split' END;
  INSERT INTO public.customer_payment_receipts (
    id, tenant_id, branch_id, receivable_account_id, customer_id, receipt_number,
    amount, method, reference, notes, origin, operation_id, recorded_by
  ) VALUES (
    v_receipt_id, v_scope.tenant_id, v_scope.branch_id, v_scope.receivable_account_id,
    v_customer_id, public.ar_receipt_number_v1(v_receipt_id), v_amount, v_method,
    nullif(btrim(p_payload->>'reference'), ''), nullif(btrim(p_payload->>'notes'), ''),
    'receive_payment', v_operation_id, v_scope.actor_id
  );
  FOR v_tender IN SELECT * FROM jsonb_to_recordset(v_tenders) AS tender(method text, amount numeric, reference text)
  LOOP
    INSERT INTO public.customer_payment_receipt_tenders (receipt_id, method, amount, reference)
    VALUES (v_receipt_id, v_tender.method, round(v_tender.amount, 2), nullif(btrim(v_tender.reference), ''));
  END LOOP;
  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type, source_kind, source_id,
    credit_amount, description, created_by
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_scope.receivable_account_id, v_customer_id,
    'payment_receipt', 'payment_receipt', v_receipt_id, v_amount,
    'Payment receipt ' || public.ar_receipt_number_v1(v_receipt_id), v_scope.actor_id
  );

  v_remaining := v_amount;
  IF v_auto_allocate THEN
    FOR v_invoice IN
      SELECT i.id
      FROM public.invoices i
      JOIN public.customers c ON c.id = i.customer_id
      WHERE i.tenant_id = v_scope.tenant_id
        AND c.receivable_account_id = v_scope.receivable_account_id
        AND i.status = 'posted'
        AND i.zatca_invoice_type IN ('simplified', 'standard')
        AND EXISTS (SELECT 1 FROM public.customer_receivable_entries e WHERE e.source_kind = 'invoice' AND e.source_id = i.id)
        AND (v_scope.actor_role = 'owner' OR i.branch_id = v_scope.branch_id)
      ORDER BY i.invoice_date, i.created_at, i.id
      FOR UPDATE OF i
    LOOP
      EXIT WHEN v_remaining <= 0.01;
      v_open := public.ar_invoice_outstanding_v1(v_invoice.id);
      IF coalesce(v_open, 0) > 0.01 THEN
        v_open := least(v_open, v_remaining);
        INSERT INTO public.customer_payment_allocations (
          tenant_id, receivable_account_id, invoice_id, receipt_id, amount, allocated_by
        ) VALUES (
          v_scope.tenant_id, v_scope.receivable_account_id, v_invoice.id, v_receipt_id, v_open, v_scope.actor_id
        );
        v_remaining := round(v_remaining - v_open, 2);
        v_allocated := round(v_allocated + v_open, 2);
        PERFORM public.ar_refresh_invoice_settlement_v1(v_invoice.id);
      END IF;
    END LOOP;
  ELSE
    FOR v_allocation IN
      SELECT * FROM jsonb_to_recordset(v_allocations) AS allocation(invoice_id uuid, amount numeric)
    LOOP
      SELECT i.id INTO v_invoice
      FROM public.invoices i
      JOIN public.customers c ON c.id = i.customer_id
      WHERE i.id = v_allocation.invoice_id
        AND i.tenant_id = v_scope.tenant_id
        AND c.receivable_account_id = v_scope.receivable_account_id
        AND i.status = 'posted'
        AND i.zatca_invoice_type IN ('simplified', 'standard')
        AND EXISTS (SELECT 1 FROM public.customer_receivable_entries e WHERE e.source_kind = 'invoice' AND e.source_id = i.id)
        AND (v_scope.actor_role = 'owner' OR i.branch_id = v_scope.branch_id)
      FOR UPDATE OF i;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'AR_RECEIPT_INVOICE_NOT_SETTLABLE' USING ERRCODE = '42501';
      END IF;
      v_open := public.ar_invoice_outstanding_v1(v_invoice.id);
      IF v_allocation.amount > v_remaining + 0.01 OR v_allocation.amount > coalesce(v_open, 0) + 0.01 THEN
        RAISE EXCEPTION 'AR_RECEIPT_ALLOCATION_EXCEEDS_OUTSTANDING' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.customer_payment_allocations (
        tenant_id, receivable_account_id, invoice_id, receipt_id, amount, allocated_by
      ) VALUES (
        v_scope.tenant_id, v_scope.receivable_account_id, v_invoice.id, v_receipt_id, round(v_allocation.amount, 2), v_scope.actor_id
      );
      v_remaining := round(v_remaining - v_allocation.amount, 2);
      v_allocated := round(v_allocated + v_allocation.amount, 2);
      PERFORM public.ar_refresh_invoice_settlement_v1(v_invoice.id);
    END LOOP;
  END IF;

  v_account_balance := public.ar_account_balance_v1(v_scope.receivable_account_id);
  SELECT jsonb_build_object(
    'receipt_id', r.id, 'receipt_number', r.receipt_number, 'amount', r.amount,
    'allocated_amount', v_allocated, 'unapplied_amount', v_remaining,
    'status', r.status, 'customer_id', r.customer_id,
    'receivable_account_id', r.receivable_account_id, 'balance', v_account_balance
  ) INTO v_response
  FROM public.customer_payment_receipts r WHERE r.id = v_receipt_id;
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'payment_receipt', v_fingerprint, v_scope.actor_id, v_response
  );
  PERFORM public.record_audit_event(
    'customer_payment_receipt_recorded', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer_payment_receipt', v_receipt_id,
    'info', 'succeeded', jsonb_build_object('amount', v_amount, 'allocated_amount', v_allocated, 'unapplied_amount', v_remaining, 'operation_id', v_operation_id), NULL, NULL
  );
  RETURN v_response;
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
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_original_invoice_id := nullif(btrim(p_payload->>'original_invoice_id'), '')::uuid;
    v_operation_id := nullif(btrim(p_payload->>'operation_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;
  IF v_original_invoice_id IS NULL OR v_operation_id IS NULL THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_IDENTIFIERS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number, i.currency_code
  INTO v_original FROM public.invoices i WHERE i.id = v_original_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_original.customer_id IS NULL THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_CUSTOMER_REQUIRED' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_original.branch_id, v_original.customer_id);
  IF v_scope.receivable_account_id IS NULL
     OR public.ar_invoice_outstanding_v1(v_original_invoice_id) IS NULL THEN
    RAISE EXCEPTION 'AR_SETTLEMENT_UNKNOWN_FOR_HISTORICAL_INVOICE' USING ERRCODE = '23514';
  END IF;
  v_refund_tenders := coalesce(p_payload->'refund_tenders', '[]'::jsonb);
  IF jsonb_typeof(v_refund_tenders) <> 'array' OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric)
    WHERE method NOT IN ('cash', 'card', 'bank_transfer', 'other') OR amount IS NULL OR amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric)
    GROUP BY method HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_REFUND_INVALID' USING ERRCODE = '22023';
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

  -- Reuse the reviewed commercial credit-note engine, remove its assumed full
  -- refund record before commit, then settle the credit note against the AR
  -- ledger. Fiscal lines, totals, stock and ZATCA fields are never changed.
  v_base_payload := p_payload - 'operation_id' - 'refund_tenders' - 'idempotency_key';
  v_base_payload := v_base_payload || jsonb_build_object('idempotency_key', v_operation_id::text);
  v_base_result := public.create_partial_credit_note(v_base_payload);
  IF coalesce((v_base_result->>'idempotent_replay')::boolean, false) THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_IDEMPOTENCY_COLLISION' USING ERRCODE = 'P0001';
  END IF;
  v_credit_note_id := (v_base_result->>'credit_note_invoice_id')::uuid;
  v_credit_total := round((v_base_result->>'total')::numeric, 2);
  DELETE FROM public.payment_refunds WHERE credit_note_invoice_id = v_credit_note_id;

  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
    source_kind, source_id, credit_amount, currency_code, description, created_by
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_scope.receivable_account_id, v_original.customer_id,
    'credit_note', 'credit_note', v_credit_note_id, v_credit_total, v_original.currency_code,
    'Credit note ' || coalesce(v_base_result->>'credit_note_invoice_number', v_credit_note_id::text), v_scope.actor_id
  );
  v_open := public.ar_invoice_outstanding_v1(v_original_invoice_id);
  v_applied := least(coalesce(v_open, 0), v_credit_total);
  IF v_applied > 0 THEN
    INSERT INTO public.customer_payment_allocations (
      tenant_id, receivable_account_id, invoice_id, credit_note_invoice_id, amount, allocated_by
    ) VALUES (
      v_scope.tenant_id, v_scope.receivable_account_id, v_original_invoice_id, v_credit_note_id, v_applied, v_scope.actor_id
    );
    PERFORM public.ar_refresh_invoice_settlement_v1(v_original_invoice_id);
  END IF;
  SELECT coalesce(round(sum(amount), 2), 0) INTO v_refund_total
  FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric);
  IF v_refund_total > v_credit_total - v_applied + 0.01 THEN
    RAISE EXCEPTION 'AR_CREDIT_NOTE_REFUND_EXCEEDS_EXCESS_CREDIT' USING ERRCODE = '23514';
  END IF;
  FOR v_refund IN SELECT * FROM jsonb_to_recordset(v_refund_tenders) AS tender(method text, amount numeric)
  LOOP
    INSERT INTO public.payment_refunds (
      tenant_id, branch_id, original_invoice_id, credit_note_invoice_id, method,
      amount, reason, status, created_by
    ) VALUES (
      v_scope.tenant_id, v_scope.branch_id, v_original_invoice_id, v_credit_note_id,
      v_refund.method::public.payment_method, round(v_refund.amount, 2),
      coalesce(nullif(btrim(p_payload->>'reason'), ''), 'Customer credit-note refund'), 'completed', v_scope.actor_id
    ) RETURNING id INTO v_refund_id;
    INSERT INTO public.customer_receivable_entries (
      tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
      source_kind, source_id, debit_amount, currency_code, description, created_by
    ) VALUES (
      v_scope.tenant_id, v_scope.branch_id, v_scope.receivable_account_id, v_original.customer_id,
      'credit_note_refund', 'credit_note_refund', v_refund_id, round(v_refund.amount, 2), v_original.currency_code,
      'Refund from credit note ' || coalesce(v_base_result->>'credit_note_invoice_number', v_credit_note_id::text), v_scope.actor_id
    );
  END LOOP;
  UPDATE public.invoices
  SET payment_status = CASE
      WHEN v_refund_total >= v_credit_total - 0.01 THEN 'refunded'::public.payment_status
      WHEN v_refund_total > 0 THEN 'partial'::public.payment_status
      ELSE 'pending'::public.payment_status
    END,
    updated_at = now()
  WHERE id = v_credit_note_id;

  v_response := v_base_result || jsonb_build_object(
    'applied_to_original_invoice', v_applied,
    'refunded_amount', v_refund_total,
    'unapplied_customer_credit', round(v_credit_total - v_applied - v_refund_total, 2),
    'receivable_account_id', v_scope.receivable_account_id
  );
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'credit_note_settlement', v_fingerprint, v_scope.actor_id, v_response
  );
  PERFORM public.record_audit_event(
    'customer_credit_note_settled', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'invoice', v_credit_note_id, 'info', 'succeeded',
    jsonb_build_object('original_invoice_id', v_original_invoice_id, 'credit_total', v_credit_total, 'applied', v_applied, 'refund', v_refund_total, 'operation_id', v_operation_id), NULL, NULL
  );
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.reverse_customer_payment_receipt_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_receipt_id uuid;
  v_operation_id uuid;
  v_reason text;
  v_receipt record;
  v_scope record;
  v_existing_operation record;
  v_fingerprint text;
  v_invoice record;
  v_response jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_REVERSAL_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_receipt_id := nullif(btrim(p_payload->>'receipt_id'), '')::uuid;
    v_operation_id := nullif(btrim(p_payload->>'operation_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_REVERSAL_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;
  v_reason := nullif(btrim(p_payload->>'reason'), '');
  IF v_receipt_id IS NULL OR v_operation_id IS NULL OR v_reason IS NULL OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'AR_REVERSAL_FIELDS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_receipt FROM public.customer_payment_receipts r WHERE r.id = v_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_RECEIPT_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_receipt.branch_id, v_receipt.customer_id);
  IF v_scope.actor_role NOT IN ('owner', 'admin', 'accountant', 'manager') THEN
    RAISE EXCEPTION 'AR_RECEIPT_REVERSAL_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  v_fingerprint := md5(p_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('ar-operation:' || v_scope.tenant_id::text || ':' || v_operation_id::text, 0));
  SELECT * INTO v_existing_operation FROM public.customer_receivable_operations o
  WHERE o.tenant_id = v_scope.tenant_id AND o.operation_id = v_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing_operation.action <> 'payment_reversal' OR v_existing_operation.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'AR_OPERATION_CONFLICT' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing_operation.response;
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'AR_RECEIPT_NOT_REVERSIBLE' USING ERRCODE = '23514';
  END IF;
  UPDATE public.customer_payment_receipts
  SET status = 'reversed', reversed_at = now(), reversal_reason = v_reason, updated_at = now()
  WHERE id = v_receipt_id;
  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
    source_kind, source_id, debit_amount, currency_code, description, created_by
  ) VALUES (
    v_receipt.tenant_id, v_receipt.branch_id, v_receipt.receivable_account_id, v_receipt.customer_id,
    'payment_reversal', 'payment_reversal', v_receipt_id, v_receipt.amount, v_receipt.currency_code,
    'Reversal of receipt ' || v_receipt.receipt_number, v_scope.actor_id
  );
  FOR v_invoice IN
    SELECT i.id FROM public.invoices i
    JOIN public.customer_payment_allocations a ON a.invoice_id = i.id
    WHERE a.receipt_id = v_receipt_id
    FOR UPDATE OF i
  LOOP
    PERFORM public.ar_refresh_invoice_settlement_v1(v_invoice.id);
  END LOOP;
  v_response := jsonb_build_object(
    'receipt_id', v_receipt_id, 'receipt_number', v_receipt.receipt_number,
    'status', 'reversed', 'balance', public.ar_account_balance_v1(v_receipt.receivable_account_id)
  );
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'payment_reversal', v_fingerprint, v_scope.actor_id, v_response
  );
  PERFORM public.record_audit_event(
    'customer_payment_receipt_reversed', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer_payment_receipt', v_receipt_id,
    'warning', 'succeeded', jsonb_build_object('amount', v_receipt.amount, 'reason', v_reason, 'operation_id', v_operation_id), NULL, NULL
  );
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_receivable_workspace_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer_id uuid;
  v_requested_branch_id uuid;
  v_customer record;
  v_scope record;
  v_effective_branch_id uuid;
  v_account_id uuid;
  v_start_date date;
  v_end_date date;
  v_page integer;
  v_page_size integer;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_opening numeric(12,2);
  v_balance numeric(12,2);
  v_total_invoiced numeric(12,2) := 0;
  v_total_collected numeric(12,2) := 0;
  v_unpaid_amount numeric(12,2) := 0;
  v_partial_amount numeric(12,2) := 0;
  v_unapplied_receipts numeric(12,2) := 0;
  v_last_payment_at timestamptz;
  v_last_invoice_at date;
  v_ledger jsonb;
  v_open_invoices jsonb;
  v_aging jsonb;
  v_policy jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_WORKSPACE_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_customer_id := nullif(btrim(p_payload->>'customer_id'), '')::uuid;
    v_requested_branch_id := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
    v_start_date := coalesce(nullif(btrim(p_payload->>'start_date'), '')::date, v_today - 364);
    v_end_date := coalesce(nullif(btrim(p_payload->>'end_date'), '')::date, v_today);
    v_page := coalesce(nullif(btrim(p_payload->>'page'), '')::integer, 1);
    v_page_size := coalesce(nullif(btrim(p_payload->>'page_size'), '')::integer, 50);
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'AR_WORKSPACE_FILTER_INVALID' USING ERRCODE = '22023';
  END;
  IF v_customer_id IS NULL OR v_start_date > v_end_date OR v_end_date - v_start_date > 3653
     OR v_page < 1 OR v_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'AR_WORKSPACE_FILTER_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT c.* INTO v_customer FROM public.customers c WHERE c.id = v_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_customer.branch_id, v_customer_id);
  IF v_requested_branch_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = v_requested_branch_id AND b.tenant_id = v_scope.tenant_id) THEN
      RAISE EXCEPTION 'AR_WORKSPACE_BRANCH_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_scope.actor_role = 'branch' AND v_requested_branch_id IS DISTINCT FROM v_scope.branch_id THEN
      RAISE EXCEPTION 'AR_WORKSPACE_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_effective_branch_id := CASE
    WHEN v_scope.actor_role IN ('branch', 'cashier', 'manager') THEN v_scope.branch_id
    ELSE v_requested_branch_id
  END;
  v_account_id := v_scope.receivable_account_id;
  IF v_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'customer', jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'nameAr', v_customer.name_ar),
      'summary', jsonb_build_object(
        'balance', 0, 'totalInvoiced', 0, 'totalCollected', 0,
        'unpaidAmount', 0, 'partialAmount', 0, 'accountCredit', 0,
        'unappliedCredit', 0, 'unappliedReceipts', 0,
        'openInvoiceCount', 0, 'lastPaymentAt', NULL, 'lastInvoiceAt', NULL
      ),
      'policy', NULL, 'openInvoices', '[]'::jsonb, 'ledger', '[]'::jsonb,
      'aging', jsonb_build_object('current', 0, 'days1to30', 0, 'days31to60', 0, 'days61to90', 0, 'over90', 0, 'overdue', 0),
      'statement', jsonb_build_object('openingBalance', 0, 'closingBalance', 0, 'startDate', v_start_date, 'endDate', v_end_date),
      'scope', jsonb_build_object('tenantId', v_scope.tenant_id, 'branchId', v_effective_branch_id,
        'ownerConsolidated', v_scope.actor_role IN ('owner', 'admin', 'accountant') AND v_effective_branch_id IS NULL)
    );
  END IF;

  SELECT coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric INTO v_opening
  FROM public.customer_receivable_entries e
  WHERE e.receivable_account_id = v_account_id
    AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id)
    AND e.effective_at < v_start_date::timestamptz;
  v_balance := public.ar_account_balance_v1(v_account_id, v_effective_branch_id);
  SELECT coalesce(sum(e.debit_amount) FILTER (WHERE e.entry_type = 'invoice'), 0),
         max(e.effective_at::date) FILTER (WHERE e.entry_type = 'invoice')
  INTO v_total_invoiced, v_last_invoice_at
  FROM public.customer_receivable_entries e
  WHERE e.receivable_account_id = v_account_id
    AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id);

  SELECT coalesce(sum(r.amount) FILTER (WHERE r.status = 'completed'), 0),
         max(r.received_at) FILTER (WHERE r.status = 'completed')
  INTO v_total_collected, v_last_payment_at
  FROM public.customer_payment_receipts r
  WHERE r.receivable_account_id = v_account_id
    AND (v_effective_branch_id IS NULL OR r.branch_id = v_effective_branch_id);

  SELECT coalesce(sum(greatest(r.amount - coalesce(a.allocated, 0), 0)), 0)
  INTO v_unapplied_receipts
  FROM public.customer_payment_receipts r
  LEFT JOIN (
    SELECT receipt_id, sum(amount) AS allocated
    FROM public.customer_payment_allocations GROUP BY receipt_id
  ) a ON a.receipt_id = r.id
  WHERE r.receivable_account_id = v_account_id AND r.status = 'completed'
    AND (v_effective_branch_id IS NULL OR r.branch_id = v_effective_branch_id);

  SELECT coalesce(sum(x.outstanding) FILTER (WHERE x.outstanding >= x.total_amount - 0.01), 0),
         coalesce(sum(x.outstanding) FILTER (WHERE x.outstanding > 0.01
             AND x.outstanding < x.total_amount - 0.01), 0)
  INTO v_unpaid_amount, v_partial_amount
  FROM (
    SELECT i.total_amount, public.ar_invoice_outstanding_v1(i.id) AS outstanding
    FROM public.invoices i
    WHERE i.customer_id = v_customer_id AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND public.ar_invoice_outstanding_v1(i.id) IS NOT NULL
      AND (v_effective_branch_id IS NULL OR i.branch_id = v_effective_branch_id)
  ) x;

  SELECT jsonb_build_object(
    'creditEnabled', p.credit_enabled, 'creditLimit', p.credit_limit, 'terms', p.terms,
    'hold', p.hold, 'holdReason', p.hold_reason, 'overdueBlock', p.overdue_block,
    'warnThresholdPercent', p.warn_threshold_percent,
    'requiresOwnerApproval', p.requires_owner_approval
  )
  INTO v_policy FROM public.customer_credit_policies p
  WHERE p.tenant_id = v_scope.tenant_id AND p.receivable_account_id = v_account_id;

  WITH scoped AS (
    SELECT e.*, sum(e.debit_amount - e.credit_amount) OVER (ORDER BY e.effective_at, e.created_at, e.id) + v_opening AS running_balance
    FROM public.customer_receivable_entries e
    WHERE e.receivable_account_id = v_account_id
      AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id)
      AND e.effective_at >= v_start_date::timestamptz
      AND e.effective_at < (v_end_date + 1)::timestamptz
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'type', s.entry_type, 'sourceKind', s.source_kind, 'sourceId', s.source_id,
    'branchId', s.branch_id, 'debit', s.debit_amount, 'credit', s.credit_amount,
    'effectiveAt', s.effective_at, 'description', s.description, 'runningBalance', s.running_balance
  ) ORDER BY s.effective_at DESC, s.created_at DESC, s.id DESC), '[]'::jsonb)
  INTO v_ledger FROM (
    SELECT * FROM scoped
    ORDER BY effective_at DESC, created_at DESC, id DESC
    LIMIT v_page_size OFFSET ((v_page - 1) * v_page_size)
  ) s;

  WITH invoice_rows AS (
    SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.branch_id,
      public.ar_invoice_outstanding_v1(i.id) AS outstanding
    FROM public.invoices i
    JOIN public.customers c ON c.id = i.customer_id
    WHERE i.tenant_id = v_scope.tenant_id
      AND c.receivable_account_id = v_account_id
      AND i.status = 'posted' AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND EXISTS (SELECT 1 FROM public.customer_receivable_entries e WHERE e.source_kind = 'invoice' AND e.source_id = i.id)
      AND (v_effective_branch_id IS NULL OR i.branch_id = v_effective_branch_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'invoiceNumber', r.invoice_number, 'invoiceDate', r.invoice_date,
    'dueDate', r.due_date, 'total', r.total_amount, 'outstanding', r.outstanding,
    'branchId', r.branch_id, 'isOverdue', r.due_date IS NOT NULL AND r.due_date < v_today,
    'ageDays', greatest(v_today - coalesce(r.due_date, r.invoice_date), 0)
  ) ORDER BY r.invoice_date, r.id), '[]'::jsonb)
  INTO v_open_invoices FROM invoice_rows r WHERE r.outstanding > 0.01;

  WITH invoice_rows AS (
    SELECT i.invoice_date, i.due_date, public.ar_invoice_outstanding_v1(i.id) AS outstanding
    FROM public.invoices i JOIN public.customers c ON c.id = i.customer_id
    WHERE i.tenant_id = v_scope.tenant_id AND c.receivable_account_id = v_account_id
      AND i.status = 'posted' AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND EXISTS (SELECT 1 FROM public.customer_receivable_entries e WHERE e.source_kind = 'invoice' AND e.source_id = i.id)
      AND (v_effective_branch_id IS NULL OR i.branch_id = v_effective_branch_id)
  )
  SELECT jsonb_build_object(
    'current', coalesce(sum(outstanding) FILTER (WHERE v_today - coalesce(due_date, invoice_date) <= 0), 0),
    'days1to30', coalesce(sum(outstanding) FILTER (WHERE v_today - coalesce(due_date, invoice_date) BETWEEN 1 AND 30), 0),
    'days31to60', coalesce(sum(outstanding) FILTER (WHERE v_today - coalesce(due_date, invoice_date) BETWEEN 31 AND 60), 0),
    'days61to90', coalesce(sum(outstanding) FILTER (WHERE v_today - coalesce(due_date, invoice_date) BETWEEN 61 AND 90), 0),
    'over90', coalesce(sum(outstanding) FILTER (WHERE v_today - coalesce(due_date, invoice_date) > 90), 0),
    'overdue', coalesce(sum(outstanding) FILTER (WHERE due_date IS NOT NULL AND due_date < v_today), 0)
  ) INTO v_aging FROM invoice_rows WHERE outstanding > 0.01;

  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', v_customer.id, 'name', v_customer.name, 'nameAr', v_customer.name_ar, 'receivableAccountId', v_account_id),
    'summary', jsonb_build_object(
      'balance', v_balance,
      'totalInvoiced', v_total_invoiced,
      'totalCollected', v_total_collected,
      'unpaidAmount', v_unpaid_amount,
      'partialAmount', v_partial_amount,
      'accountCredit', greatest(-v_balance, 0),
      'unappliedCredit', greatest(-v_balance, 0),
      'unappliedReceipts', v_unapplied_receipts,
      'openInvoiceCount', jsonb_array_length(v_open_invoices),
      'lastPaymentAt', v_last_payment_at,
      'lastInvoiceAt', v_last_invoice_at
    ),
    'policy', v_policy, 'openInvoices', v_open_invoices, 'ledger', v_ledger, 'aging', v_aging,
    'statement', jsonb_build_object('openingBalance', v_opening, 'closingBalance', v_balance, 'startDate', v_start_date, 'endDate', v_end_date),
    'scope', jsonb_build_object('tenantId', v_scope.tenant_id, 'branchId', v_effective_branch_id,
      'ownerConsolidated', v_scope.actor_role IN ('owner', 'admin', 'accountant') AND v_effective_branch_id IS NULL)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_payment_receipt_document_v1(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_receipt record;
  v_scope record;
BEGIN
  SELECT r.* INTO v_receipt FROM public.customer_payment_receipts r WHERE r.id = p_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AR_RECEIPT_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_receipt.branch_id, v_receipt.customer_id);
  RETURN (
    SELECT jsonb_build_object(
      'receipt', jsonb_build_object(
        'id', r.id, 'number', r.receipt_number, 'customerId', r.customer_id,
        'amount', r.amount, 'currency', r.currency_code, 'method', r.method,
        'reference', r.reference, 'notes', r.notes, 'status', r.status,
        'receivedAt', r.received_at,
        'previousBalance', public.ar_account_balance_v1(r.receivable_account_id,
          CASE WHEN v_scope.actor_role IN ('owner', 'admin', 'accountant') THEN NULL ELSE v_scope.branch_id END)
          + CASE WHEN r.status = 'completed' THEN r.amount ELSE 0 END,
        'remainingBalance', public.ar_account_balance_v1(r.receivable_account_id,
          CASE WHEN v_scope.actor_role IN ('owner', 'admin', 'accountant') THEN NULL ELSE v_scope.branch_id END),
        'unappliedCredit', greatest(r.amount - coalesce((
          SELECT sum(a.amount) FROM public.customer_payment_allocations a
          WHERE a.receipt_id = r.id
        ), 0), 0),
        'cashier', coalesce((SELECT p.full_name FROM public.user_profiles p WHERE p.id = r.recorded_by), '—')
      ),
      'customer', jsonb_build_object('id', c.id, 'name', c.name, 'nameAr', c.name_ar, 'phone', c.phone, 'vatNumber', c.vat_number),
      'branch', jsonb_build_object('id', b.id, 'name', b.name, 'nameAr', b.name_ar),
      'company', jsonb_build_object('name', t.name, 'nameAr', t.name_ar, 'vatNumber', t.vat_number),
      'tenders', coalesce((SELECT jsonb_agg(jsonb_build_object('method', rt.method, 'amount', rt.amount, 'reference', rt.reference) ORDER BY rt.method) FROM public.customer_payment_receipt_tenders rt WHERE rt.receipt_id = r.id), '[]'::jsonb),
      'allocations', coalesce((SELECT jsonb_agg(jsonb_build_object('invoiceId', a.invoice_id, 'invoiceNumber', i.invoice_number, 'amount', a.amount) ORDER BY i.invoice_date, i.id) FROM public.customer_payment_allocations a JOIN public.invoices i ON i.id = a.invoice_id WHERE a.receipt_id = r.id), '[]'::jsonb)
    )
    FROM public.customer_payment_receipts r
    JOIN public.customers c ON c.id = r.customer_id
    JOIN public.branches b ON b.id = r.branch_id
    JOIN public.tenants t ON t.id = r.tenant_id
    WHERE r.id = v_receipt.id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.ar_assert_scope_v1(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ar_ensure_customer_account_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ar_account_balance_v1(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ar_invoice_outstanding_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ar_refresh_invoice_settlement_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ar_receipt_number_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_customer_credit_policy_v1(jsonb),
                       public.post_customer_credit_checkout_v1(jsonb),
                       public.record_customer_payment_receipt_v1(jsonb),
                       public.create_customer_credit_note_settlement_v1(jsonb),
                       public.reverse_customer_payment_receipt_v1(jsonb),
                       public.get_customer_receivable_workspace_v1(jsonb),
                       public.get_customer_payment_receipt_document_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_customer_credit_policy_v1(jsonb),
                          public.post_customer_credit_checkout_v1(jsonb),
                          public.record_customer_payment_receipt_v1(jsonb),
                          public.create_customer_credit_note_settlement_v1(jsonb),
                          public.reverse_customer_payment_receipt_v1(jsonb),
                          public.get_customer_receivable_workspace_v1(jsonb),
                          public.get_customer_payment_receipt_document_v1(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) IS
  'Creates an unpaid or partially settled customer invoice through the reviewed commercial checkout, then appends AR ledger/receipt records atomically. It does not alter fiscal totals, XML, QR, signature, clearance or reporting data.';
COMMENT ON FUNCTION public.record_customer_payment_receipt_v1(jsonb) IS
  'Records one idempotent payment receipt and allocates it oldest-first or by validated manual allocation. Unallocated remainder remains customer credit.';
COMMENT ON FUNCTION public.create_customer_credit_note_settlement_v1(jsonb) IS
  'Creates a fiscal credit note through the reviewed engine, then applies it to open AR balances, refunds only excess credit, and leaves residual excess as customer credit.';
