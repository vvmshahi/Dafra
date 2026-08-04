-- Customer receivables controls, legacy settlement synchronization, and
-- read/report contracts.
--
-- This migration is forward-only. It does not backfill existing invoices or
-- payments. New ordinary customer sales are mirrored into the AR ledger by
-- triggers; the credit-checkout RPC disables those triggers for its temporary
-- internal payment and writes its authoritative AR rows exactly once.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

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
STABLE
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

  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'manager', 'accountant', 'cashier', 'branch')
  THEN
    RAISE EXCEPTION 'AR_ACTOR_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE OR v_branch.suspended_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'AR_BRANCH_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  IF v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role IN ('branch', 'cashier', 'manager')
         AND v_actor.branch_id IS DISTINCT FROM v_branch.id)
  THEN
    RAISE EXCEPTION 'AR_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.tenant_id, c.branch_id, c.receivable_account_id, c.is_active
    INTO v_customer
    FROM public.customers c
    WHERE c.id = p_customer_id;

    IF NOT FOUND OR v_customer.tenant_id IS DISTINCT FROM v_branch.tenant_id
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

ALTER FUNCTION public.ar_assert_scope_v1(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ar_assert_scope_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ar_sync_posted_invoice_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer record;
  v_account_id uuid;
BEGIN
  IF current_setting('app.ar_skip_legacy_sync', true) = 'true'
     OR NEW.status::text <> 'posted'
     OR NEW.customer_id IS NULL
     OR NEW.zatca_invoice_type::text NOT IN ('simplified', 'standard')
  THEN
    RETURN NEW;
  END IF;

  SELECT c.* INTO v_customer
  FROM public.customers c
  WHERE c.id = NEW.customer_id
    AND c.tenant_id = NEW.tenant_id
    AND c.branch_id = NEW.branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_customer.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_account_id := v_customer.receivable_account_id;
  IF v_account_id IS NULL THEN
    INSERT INTO public.customer_receivable_accounts (
      tenant_id, account_number, display_name, display_name_ar,
      customer_type, vat_number, cr_number
    ) VALUES (
      NEW.tenant_id,
      'AR-' || upper(replace(v_customer.id::text, '-', '')),
      coalesce(nullif(btrim(v_customer.business_name), ''),
               nullif(btrim(v_customer.company_name), ''), v_customer.name),
      coalesce(nullif(btrim(v_customer.business_name_ar), ''),
               nullif(btrim(v_customer.name_ar), '')),
      CASE WHEN v_customer.customer_type IN ('business', 'individual')
           THEN v_customer.customer_type ELSE 'individual' END,
      v_customer.vat_number,
      v_customer.cr_number
    )
    ON CONFLICT (tenant_id, account_number) DO UPDATE
      SET updated_at = now()
    RETURNING id INTO v_account_id;

    UPDATE public.customers
    SET receivable_account_id = v_account_id, updated_at = now()
    WHERE id = v_customer.id;
  END IF;

  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
    source_kind, source_id, debit_amount, currency_code, effective_at,
    description, created_by
  ) VALUES (
    NEW.tenant_id, NEW.branch_id, v_account_id, NEW.customer_id, 'invoice',
    'invoice', NEW.id, round(NEW.total_amount, 2), NEW.currency_code,
    NEW.created_at, 'Invoice ' || NEW.invoice_number, coalesce(NEW.created_by, auth.uid())
  ) ON CONFLICT (tenant_id, source_kind, source_id) DO NOTHING;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.ar_sync_legacy_payment_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_invoice record;
  v_customer record;
  v_account_id uuid;
  v_receipt_id uuid := gen_random_uuid();
  v_open numeric(12,2);
  v_allocated numeric(12,2);
BEGIN
  IF current_setting('app.ar_skip_legacy_sync', true) = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT i.* INTO v_invoice
  FROM public.invoices i
  WHERE i.id = NEW.invoice_id
    AND i.status::text = 'posted'
    AND i.customer_id IS NOT NULL
    AND i.zatca_invoice_type::text IN ('simplified', 'standard');
  IF NOT FOUND OR NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT c.* INTO v_customer
  FROM public.customers c
  WHERE c.id = v_invoice.customer_id
    AND c.tenant_id = v_invoice.tenant_id
    AND c.branch_id = v_invoice.branch_id
  FOR UPDATE;
  IF NOT FOUND OR v_customer.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_account_id := v_customer.receivable_account_id;
  IF v_account_id IS NULL THEN
    INSERT INTO public.customer_receivable_accounts (
      tenant_id, account_number, display_name, display_name_ar,
      customer_type, vat_number, cr_number
    ) VALUES (
      v_invoice.tenant_id,
      'AR-' || upper(replace(v_customer.id::text, '-', '')),
      coalesce(nullif(btrim(v_customer.business_name), ''),
               nullif(btrim(v_customer.company_name), ''), v_customer.name),
      coalesce(nullif(btrim(v_customer.business_name_ar), ''),
               nullif(btrim(v_customer.name_ar), '')),
      CASE WHEN v_customer.customer_type IN ('business', 'individual')
           THEN v_customer.customer_type ELSE 'individual' END,
      v_customer.vat_number,
      v_customer.cr_number
    )
    ON CONFLICT (tenant_id, account_number) DO UPDATE
      SET updated_at = now()
    RETURNING id INTO v_account_id;
    UPDATE public.customers
    SET receivable_account_id = v_account_id, updated_at = now()
    WHERE id = v_customer.id;
  END IF;

  INSERT INTO public.customer_payment_receipts (
    id, tenant_id, branch_id, receivable_account_id, customer_id,
    receipt_number, amount, currency_code, method, reference, notes, origin,
    operation_id, recorded_by, received_at
  ) VALUES (
    v_receipt_id, v_invoice.tenant_id, v_invoice.branch_id, v_account_id,
    v_invoice.customer_id, public.ar_receipt_number_v1(v_receipt_id),
    round(NEW.amount, 2), v_invoice.currency_code, NEW.method::text,
    NEW.reference, NEW.notes, 'legacy_invoice_payment', NEW.id,
    coalesce(NEW.recorded_by, auth.uid()), coalesce(NEW.paid_at, now())
  ) ON CONFLICT (tenant_id, operation_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.customer_payment_receipt_tenders (
    receipt_id, method, amount, reference
  ) VALUES (
    v_receipt_id, NEW.method::text, round(NEW.amount, 2), NEW.reference
  );

  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
    source_kind, source_id, credit_amount, currency_code, effective_at,
    description, created_by
  ) VALUES (
    v_invoice.tenant_id, v_invoice.branch_id, v_account_id,
    v_invoice.customer_id, 'payment_receipt', 'payment_receipt', v_receipt_id,
    round(NEW.amount, 2), v_invoice.currency_code, coalesce(NEW.paid_at, now()),
    'Payment for ' || v_invoice.invoice_number, coalesce(NEW.recorded_by, auth.uid())
  );

  v_open := public.ar_invoice_outstanding_v1(v_invoice.id);
  v_allocated := least(greatest(coalesce(v_open, 0), 0), round(NEW.amount, 2));
  IF v_allocated > 0 THEN
    INSERT INTO public.customer_payment_allocations (
      tenant_id, receivable_account_id, invoice_id, receipt_id, amount,
      allocated_by
    ) VALUES (
      v_invoice.tenant_id, v_account_id, v_invoice.id, v_receipt_id,
      v_allocated, coalesce(NEW.recorded_by, auth.uid())
    );
  END IF;

  PERFORM public.ar_refresh_invoice_settlement_v1(v_invoice.id);
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.ar_sync_posted_invoice_v1() OWNER TO postgres;
ALTER FUNCTION public.ar_sync_legacy_payment_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ar_sync_posted_invoice_v1() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ar_sync_legacy_payment_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS customer_receivable_invoice_sync_v1 ON public.invoices;
CREATE TRIGGER customer_receivable_invoice_sync_v1
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.ar_sync_posted_invoice_v1();

DROP TRIGGER IF EXISTS customer_receivable_payment_sync_v1 ON public.payments;
CREATE TRIGGER customer_receivable_payment_sync_v1
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.ar_sync_legacy_payment_v1();

CREATE OR REPLACE FUNCTION public.reallocate_customer_payment_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_receipt_id uuid;
  v_operation_id uuid;
  v_receipt record;
  v_scope record;
  v_existing record;
  v_fingerprint text;
  v_allocations jsonb;
  v_allocation record;
  v_invoice record;
  v_existing_for_receipt numeric(12,2);
  v_total numeric(12,2) := 0;
  v_old_invoice_id uuid;
  v_old_invoice_ids uuid[];
  v_response jsonb;
BEGIN
  v_receipt_id := nullif(btrim(p_payload->>'receipt_id'), '')::uuid;
  v_operation_id := nullif(btrim(p_payload->>'operation_id'), '')::uuid;
  v_allocations := coalesce(p_payload->'allocations', '[]'::jsonb);
  IF v_receipt_id IS NULL OR v_operation_id IS NULL
     OR jsonb_typeof(v_allocations) <> 'array'
  THEN
    RAISE EXCEPTION 'AR_REALLOCATION_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT r.* INTO v_receipt
  FROM public.customer_payment_receipts r
  WHERE r.id = v_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AR_RECEIPT_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope
  FROM public.ar_assert_scope_v1(v_receipt.branch_id, v_receipt.customer_id);
  IF v_scope.actor_role NOT IN ('owner', 'admin', 'accountant', 'manager') THEN
    RAISE EXCEPTION 'AR_REALLOCATION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'AR_RECEIPT_NOT_REALLOCATABLE' USING ERRCODE = '23514';
  END IF;

  v_fingerprint := md5(p_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'ar-operation:' || v_scope.tenant_id::text || ':' || v_operation_id::text, 0));
  SELECT * INTO v_existing
  FROM public.customer_receivable_operations o
  WHERE o.tenant_id = v_scope.tenant_id AND o.operation_id = v_operation_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.action <> 'payment_reallocation'
       OR v_existing.payload_fingerprint <> v_fingerprint
    THEN RAISE EXCEPTION 'AR_OPERATION_CONFLICT' USING ERRCODE = 'P0001'; END IF;
    RETURN v_existing.response;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(invoice_id uuid, amount numeric)
    WHERE a.invoice_id IS NULL OR a.amount IS NULL OR a.amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(invoice_id uuid, amount numeric)
    GROUP BY a.invoice_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AR_REALLOCATION_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Validate and lock in invoice-id order before replacing explanation rows.
  FOR v_allocation IN
    SELECT * FROM jsonb_to_recordset(v_allocations) AS a(invoice_id uuid, amount numeric)
    ORDER BY a.invoice_id
  LOOP
    SELECT i.id INTO v_invoice
    FROM public.invoices i
    JOIN public.customers c ON c.id = i.customer_id
    WHERE i.id = v_allocation.invoice_id
      AND i.tenant_id = v_scope.tenant_id
      AND c.receivable_account_id = v_receipt.receivable_account_id
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND EXISTS (SELECT 1 FROM public.customer_receivable_entries e
                  WHERE e.source_kind = 'invoice' AND e.source_id = i.id)
      AND (v_scope.actor_role IN ('owner', 'admin', 'accountant')
           OR i.branch_id = v_scope.branch_id)
    FOR UPDATE OF i;
    IF NOT FOUND THEN RAISE EXCEPTION 'AR_RECEIPT_INVOICE_NOT_SETTLABLE' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(sum(a.amount), 0) INTO v_existing_for_receipt
    FROM public.customer_payment_allocations a
    WHERE a.receipt_id = v_receipt_id AND a.invoice_id = v_invoice.id;
    IF v_allocation.amount > public.ar_invoice_outstanding_v1(v_invoice.id)
       + v_existing_for_receipt + 0.01
    THEN RAISE EXCEPTION 'AR_REALLOCATION_EXCEEDS_OUTSTANDING' USING ERRCODE = '23514'; END IF;
    v_total := round(v_total + v_allocation.amount, 2);
  END LOOP;
  IF v_total > v_receipt.amount + 0.01 THEN
    RAISE EXCEPTION 'AR_REALLOCATION_EXCEEDS_RECEIPT' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(array_agg(DISTINCT invoice_id), ARRAY[]::uuid[])
  INTO v_old_invoice_ids
  FROM public.customer_payment_allocations
  WHERE receipt_id = v_receipt_id;
  DELETE FROM public.customer_payment_allocations WHERE receipt_id = v_receipt_id;
  INSERT INTO public.customer_payment_allocations (
    tenant_id, receivable_account_id, invoice_id, receipt_id, amount, allocated_by
  )
  SELECT v_scope.tenant_id, v_receipt.receivable_account_id, a.invoice_id,
         v_receipt_id, round(a.amount, 2), v_scope.actor_id
  FROM jsonb_to_recordset(v_allocations) AS a(invoice_id uuid, amount numeric);

  FOR v_old_invoice_id IN
    SELECT unnest(v_old_invoice_ids)
    UNION
    SELECT (a->>'invoice_id')::uuid FROM jsonb_array_elements(v_allocations) a
  LOOP
    PERFORM public.ar_refresh_invoice_settlement_v1(v_old_invoice_id);
  END LOOP;

  v_response := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'allocated_amount', v_total,
    'unapplied_amount', round(v_receipt.amount - v_total, 2),
    'status', 'completed'
  );
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'payment_reallocation',
    v_fingerprint, v_scope.actor_id, v_response
  );
  PERFORM public.record_audit_event(
    'customer_payment_reallocated', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer_payment_receipt', v_receipt_id,
    'info', 'succeeded', jsonb_build_object('allocated_amount', v_total,
    'unapplied_amount', round(v_receipt.amount - v_total, 2),
    'operation_id', v_operation_id), NULL, NULL);
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.post_customer_receivable_adjustment_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
  v_customer_id uuid := nullif(btrim(p_payload->>'customer_id'), '')::uuid;
  v_operation_id uuid := nullif(btrim(p_payload->>'operation_id'), '')::uuid;
  v_amount numeric(12,2) := nullif(btrim(p_payload->>'amount'), '')::numeric;
  v_direction text := nullif(btrim(p_payload->>'direction'), '');
  v_reason text := nullif(btrim(p_payload->>'reason'), '');
  v_reference text := nullif(btrim(p_payload->>'reference'), '');
  v_scope record;
  v_existing record;
  v_account_id uuid;
  v_adjustment_id uuid := gen_random_uuid();
  v_fingerprint text;
  v_response jsonb;
BEGIN
  IF v_branch_id IS NULL OR v_customer_id IS NULL OR v_operation_id IS NULL
     OR v_amount IS NULL OR v_amount <= 0
     OR v_direction NOT IN ('debit', 'credit')
     OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'AR_ADJUSTMENT_PAYLOAD_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  IF v_scope.actor_role NOT IN ('owner', 'admin', 'accountant') THEN
    RAISE EXCEPTION 'AR_ADJUSTMENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  v_fingerprint := md5(p_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'ar-operation:' || v_scope.tenant_id::text || ':' || v_operation_id::text, 0));
  SELECT * INTO v_existing FROM public.customer_receivable_operations
  WHERE tenant_id = v_scope.tenant_id AND operation_id = v_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.action <> 'receivable_adjustment'
       OR v_existing.payload_fingerprint <> v_fingerprint
    THEN RAISE EXCEPTION 'AR_OPERATION_CONFLICT' USING ERRCODE = 'P0001'; END IF;
    RETURN v_existing.response;
  END IF;

  v_account_id := public.ar_ensure_customer_account_v1(v_customer_id);
  INSERT INTO public.customer_receivable_adjustments (
    id, tenant_id, branch_id, receivable_account_id, customer_id,
    direction, amount, reason, reference, approved_by
  ) VALUES (
    v_adjustment_id, v_scope.tenant_id, v_scope.branch_id, v_account_id,
    v_customer_id, v_direction, round(v_amount, 2), v_reason, v_reference,
    v_scope.actor_id
  );
  INSERT INTO public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, customer_id, entry_type,
    source_kind, source_id, debit_amount, credit_amount, description, created_by
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_account_id, v_customer_id,
    'adjustment', 'adjustment', v_adjustment_id,
    CASE WHEN v_direction = 'debit' THEN round(v_amount, 2) ELSE 0 END,
    CASE WHEN v_direction = 'credit' THEN round(v_amount, 2) ELSE 0 END,
    'Approved AR adjustment: ' || v_reason, v_scope.actor_id
  );
  v_response := jsonb_build_object(
    'adjustment_id', v_adjustment_id, 'direction', v_direction,
    'amount', round(v_amount, 2), 'balance', public.ar_account_balance_v1(v_account_id)
  );
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (
    v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'receivable_adjustment',
    v_fingerprint, v_scope.actor_id, v_response
  );
  PERFORM public.record_audit_event(
    'customer_receivable_adjustment_posted', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer_receivable_adjustment',
    v_adjustment_id, 'warning', 'succeeded',
    jsonb_build_object('direction', v_direction, 'amount', v_amount,
    'reason', v_reason, 'operation_id', v_operation_id), NULL, NULL);
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.link_customer_receivable_account_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer_id uuid := nullif(btrim(p_payload->>'customer_id'), '')::uuid;
  v_account_id uuid := nullif(btrim(p_payload->>'receivable_account_id'), '')::uuid;
  v_operation_id uuid := nullif(btrim(p_payload->>'operation_id'), '')::uuid;
  v_customer record;
  v_account record;
  v_scope record;
  v_existing record;
  v_fingerprint text;
  v_response jsonb;
BEGIN
  IF v_customer_id IS NULL OR v_account_id IS NULL OR v_operation_id IS NULL THEN
    RAISE EXCEPTION 'AR_ACCOUNT_LINK_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT c.* INTO v_customer FROM public.customers c WHERE c.id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  SELECT a.* INTO v_account FROM public.customer_receivable_accounts a WHERE a.id = v_account_id FOR UPDATE;
  IF NOT FOUND OR v_account.tenant_id IS DISTINCT FROM v_customer.tenant_id THEN
    RAISE EXCEPTION 'AR_ACCOUNT_LINK_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_customer.branch_id, v_customer.id);
  IF v_scope.actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'AR_ACCOUNT_LINK_OWNER_ONLY' USING ERRCODE = '42501';
  END IF;
  v_fingerprint := md5(p_payload::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'ar-operation:' || v_scope.tenant_id::text || ':' || v_operation_id::text, 0));
  SELECT * INTO v_existing FROM public.customer_receivable_operations
  WHERE tenant_id = v_scope.tenant_id AND operation_id = v_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.action <> 'account_link'
       OR v_existing.payload_fingerprint <> v_fingerprint
    THEN RAISE EXCEPTION 'AR_OPERATION_CONFLICT' USING ERRCODE = 'P0001'; END IF;
    RETURN v_existing.response;
  END IF;
  UPDATE public.customers SET receivable_account_id = v_account_id, updated_at = now()
  WHERE id = v_customer_id;
  v_response := jsonb_build_object('customer_id', v_customer_id,
    'receivable_account_id', v_account_id, 'linked', true);
  INSERT INTO public.customer_receivable_operations (
    tenant_id, branch_id, operation_id, action, payload_fingerprint, actor_id, response
  ) VALUES (v_scope.tenant_id, v_scope.branch_id, v_operation_id, 'account_link',
    v_fingerprint, v_scope.actor_id, v_response);
  PERFORM public.record_audit_event(
    'customer_receivable_account_linked', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer', v_customer_id,
    'warning', 'succeeded', jsonb_build_object('receivable_account_id', v_account_id), NULL, NULL);
  RETURN v_response;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_receivables_report_v1(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_requested_branch_id uuid := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
  v_start_date date := coalesce(nullif(btrim(p_payload->>'start_date'), '')::date,
                                (now() AT TIME ZONE 'Asia/Riyadh')::date - 30);
  v_end_date date := coalesce(nullif(btrim(p_payload->>'end_date'), '')::date,
                              (now() AT TIME ZONE 'Asia/Riyadh')::date);
  v_page integer := greatest(coalesce(nullif(btrim(p_payload->>'page'), '')::integer, 1), 1);
  v_page_size integer := least(greatest(coalesce(nullif(btrim(p_payload->>'page_size'), '')::integer, 50), 1), 100);
  v_effective_branch_id uuid;
  v_balances jsonb;
  v_branch_comparison jsonb;
  v_summary jsonb;
BEGIN
  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor FROM public.user_profiles p WHERE p.id = auth.uid();
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'manager', 'accountant', 'cashier', 'branch')
  THEN RAISE EXCEPTION 'AR_ACTOR_NOT_ACTIVE' USING ERRCODE = '42501'; END IF;
  v_tenant_id := v_actor.tenant_id;
  IF v_requested_branch_id IS NOT NULL THEN
    SELECT b.id INTO v_branch_id FROM public.branches b
    WHERE b.id = v_requested_branch_id AND b.tenant_id = v_tenant_id AND b.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'AR_REPORT_BRANCH_INVALID' USING ERRCODE = '42501'; END IF;
  ELSE
    v_branch_id := v_actor.branch_id;
  END IF;
  IF v_actor.role IN ('branch', 'cashier', 'manager')
     AND v_actor.branch_id IS DISTINCT FROM v_branch_id
  THEN RAISE EXCEPTION 'AR_REPORT_BRANCH_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  v_effective_branch_id := v_branch_id;
  IF v_actor.role IN ('owner', 'admin', 'accountant') AND v_requested_branch_id IS NULL THEN
    v_effective_branch_id := NULL;
  END IF;
  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'AR_REPORT_DATE_RANGE_INVALID' USING ERRCODE = '22023';
  END IF;

  WITH balances AS (
    SELECT a.id, a.display_name, a.display_name_ar,
           coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric AS balance
    FROM public.customer_receivable_accounts a
    JOIN public.customer_receivable_entries e ON e.receivable_account_id = a.id
    WHERE a.tenant_id = v_tenant_id
      AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id)
    GROUP BY a.id, a.display_name, a.display_name_ar
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'receivableAccountId', b.id, 'name', b.display_name, 'nameAr', b.display_name_ar,
    'balance', b.balance
  ) ORDER BY b.balance DESC, b.display_name
  ), '[]'::jsonb)
  INTO v_balances
  FROM (SELECT * FROM balances ORDER BY balance DESC, display_name
        LIMIT v_page_size OFFSET ((v_page - 1) * v_page_size)) b;

  SELECT jsonb_build_object(
    'totalReceivables', coalesce(sum(b.balance) FILTER (WHERE b.balance > 0), 0),
    'customerCredit', coalesce(sum(-b.balance) FILTER (WHERE b.balance < 0), 0),
    'customerCount', count(*) FILTER (WHERE b.balance <> 0),
    'paymentsReceived', coalesce((
      SELECT sum(r.amount) FROM public.customer_payment_receipts r
      WHERE r.tenant_id = v_tenant_id AND r.status = 'completed'
        AND r.received_at::date BETWEEN v_start_date AND v_end_date
        AND (v_effective_branch_id IS NULL OR r.branch_id = v_effective_branch_id)
    ), 0),
    'unappliedCredit', coalesce((
      SELECT sum(greatest(r.amount - coalesce(a.allocated, 0), 0))
      FROM public.customer_payment_receipts r
      LEFT JOIN (
        SELECT receipt_id, sum(amount) AS allocated
        FROM public.customer_payment_allocations GROUP BY receipt_id
      ) a ON a.receipt_id = r.id
      WHERE r.tenant_id = v_tenant_id AND r.status = 'completed'
        AND (v_effective_branch_id IS NULL OR r.branch_id = v_effective_branch_id)
    ), 0),
    'overdueReceivables', coalesce((
      SELECT sum(public.ar_invoice_outstanding_v1(i.id))
      FROM public.invoices i
      WHERE i.tenant_id = v_tenant_id AND i.status = 'posted'
        AND i.zatca_invoice_type IN ('simplified', 'standard')
        AND i.due_date IS NOT NULL AND i.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date
        AND (v_effective_branch_id IS NULL OR i.branch_id = v_effective_branch_id)
        AND public.ar_invoice_outstanding_v1(i.id) > 0.01
    ), 0)
  ) INTO v_summary
  FROM (
    SELECT a.id, coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric AS balance
    FROM public.customer_receivable_accounts a
    JOIN public.customer_receivable_entries e ON e.receivable_account_id = a.id
    WHERE a.tenant_id = v_tenant_id
      AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id)
    GROUP BY a.id
  ) b;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'branchId', x.branch_id, 'debits', x.debits, 'credits', x.credits,
    'balance', x.debits - x.credits
  ) ORDER BY x.branch_id), '[]'::jsonb)
  INTO v_branch_comparison
  FROM (
    SELECT e.branch_id, sum(e.debit_amount) AS debits, sum(e.credit_amount) AS credits
    FROM public.customer_receivable_entries e
    WHERE e.tenant_id = v_tenant_id
      AND e.effective_at::date BETWEEN v_start_date AND v_end_date
      AND (v_effective_branch_id IS NULL OR e.branch_id = v_effective_branch_id)
    GROUP BY e.branch_id
  ) x;

  RETURN jsonb_build_object(
    'summary', v_summary, 'balances', v_balances,
    'branchComparison', v_branch_comparison,
    'filters', jsonb_build_object('branchId', v_effective_branch_id,
      'startDate', v_start_date, 'endDate', v_end_date,
      'page', v_page, 'pageSize', v_page_size,
      'ownerConsolidated', v_effective_branch_id IS NULL)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.reallocate_customer_payment_v1(jsonb),
  public.post_customer_receivable_adjustment_v1(jsonb),
  public.link_customer_receivable_account_v1(jsonb),
  public.get_customer_receivables_report_v1(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reallocate_customer_payment_v1(jsonb),
  public.post_customer_receivable_adjustment_v1(jsonb),
  public.link_customer_receivable_account_v1(jsonb),
  public.get_customer_receivables_report_v1(jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.reallocate_customer_payment_v1(jsonb) IS
  'Replaces a completed receipt allocation set transactionally. The receipt and customer balance remain immutable; allocation rows only explain settlement.';
COMMENT ON FUNCTION public.post_customer_receivable_adjustment_v1(jsonb) IS
  'Posts an explicitly approved non-fiscal customer adjustment. It cannot create or alter a tax invoice.';
COMMENT ON FUNCTION public.get_customer_receivables_report_v1(jsonb) IS
  'Read-only, tenant/branch-scoped receivables summary, customer balance, unapplied-credit, aging and branch-comparison report.';
