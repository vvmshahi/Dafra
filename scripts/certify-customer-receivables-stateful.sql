-- Disposable three-branch AR certification. All fixture data is rolled back.
DO $certification$
DECLARE
  t uuid := '10000000-0000-4000-8000-000000000001';
  owner_id uuid := '20000000-0000-4000-8000-000000000001';
  branch_a_user uuid := '20000000-0000-4000-8000-000000000002';
  branch_b_user uuid := '20000000-0000-4000-8000-000000000003';
  branch_a uuid := '30000000-0000-4000-8000-000000000001';
  branch_b uuid := '30000000-0000-4000-8000-000000000002';
  branch_c uuid := '30000000-0000-4000-8000-000000000003';
  customer_a uuid := '40000000-0000-4000-8000-000000000001';
  customer_b uuid := '40000000-0000-4000-8000-000000000002';
  customer_c uuid := '40000000-0000-4000-8000-000000000003';
  invoice_a1 uuid := '50000000-0000-4000-8000-000000000001';
  invoice_a2 uuid := '50000000-0000-4000-8000-000000000002';
  invoice_b uuid := '50000000-0000-4000-8000-000000000003';
  invoice_c uuid := '50000000-0000-4000-8000-000000000004';
  payment_op uuid := '60000000-0000-4000-8000-000000000001';
  reallocation_op uuid := '60000000-0000-4000-8000-000000000002';
  reversal_op uuid := '60000000-0000-4000-8000-000000000003';
  rejected_op uuid := '60000000-0000-4000-8000-000000000004';
  receipt jsonb;
  replay jsonb;
  report jsonb;
  v_receipt_id uuid;
  account_a uuid;
  count_value integer;
  amount_value numeric;
  status_value text;
BEGIN
  BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at) VALUES
    (owner_id, 'authenticated', 'authenticated', 'ar-owner@example.test', now(), now()),
    (branch_a_user, 'authenticated', 'authenticated', 'ar-a@example.test', now(), now()),
    (branch_b_user, 'authenticated', 'authenticated', 'ar-b@example.test', now(), now());
  INSERT INTO public.tenants (id, name, vat_number) VALUES (t, 'AR certification fixture', '300000000000003');
  INSERT INTO public.branches (id, tenant_id, name, branch_code, is_main_branch) VALUES
    (branch_a, t, 'AR branch A', 'AR-A', true), (branch_b, t, 'AR branch B', 'AR-B', false), (branch_c, t, 'AR branch C', 'AR-C', false);
  INSERT INTO public.user_profiles (id, tenant_id, branch_id, role, full_name, is_active) VALUES
    (owner_id, t, NULL, 'owner', 'AR Owner', true),
    (branch_a_user, t, branch_a, 'branch', 'AR Branch A', true),
    (branch_b_user, t, branch_b, 'branch', 'AR Branch B', true);
  INSERT INTO public.customers (id, tenant_id, branch_id, name, is_active) VALUES
    (customer_a, t, branch_a, 'Customer A', true), (customer_b, t, branch_b, 'Customer B', true), (customer_c, t, branch_c, 'Customer C', true);

  -- Posted-invoice trigger establishes AR accounts and append-only debits.
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  INSERT INTO public.invoices (id, tenant_id, branch_id, customer_id, created_by, invoice_number, subtotal, taxable_amount, tax_amount, total_amount, status, zatca_invoice_type, payment_status, invoice_date, due_date) VALUES
    (invoice_a1, t, branch_a, customer_a, owner_id, 'AR-A-001', 100, 100, 0, 100, 'posted', 'simplified', 'pending', current_date - 2, current_date + 30),
    (invoice_a2, t, branch_a, customer_a, owner_id, 'AR-A-002', 60, 60, 0, 60, 'posted', 'simplified', 'pending', current_date - 5, current_date - 1),
    (invoice_b, t, branch_b, customer_b, owner_id, 'AR-B-001', 200, 200, 0, 200, 'posted', 'simplified', 'pending', current_date - 2, current_date + 30),
    (invoice_c, t, branch_c, customer_c, owner_id, 'AR-C-001', 300, 300, 0, 300, 'posted', 'simplified', 'pending', current_date - 2, current_date + 30);
  SELECT receivable_account_id INTO account_a FROM public.customers WHERE id = customer_a;
  IF account_a IS NULL THEN RAISE EXCEPTION 'AR fixture: invoice trigger did not establish account'; END IF;
  SELECT count(*) INTO count_value FROM public.customer_receivable_entries WHERE tenant_id = t AND source_kind = 'invoice';
  IF count_value <> 4 THEN RAISE EXCEPTION 'AR fixture: expected 4 invoice ledger rows, got %', count_value; END IF;

  -- Branch A: split tender, manual allocation, then an exact idempotent replay.
  PERFORM set_config('request.jwt.claim.sub', branch_a_user::text, true);
  SELECT public.record_customer_payment_receipt_v1(jsonb_build_object(
    'operation_id', payment_op, 'branch_id', branch_a, 'customer_id', customer_a, 'amount', 70, 'auto_allocate', false,
    'tenders', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 40), jsonb_build_object('method', 'card', 'amount', 30)),
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', invoice_a1, 'amount', 10), jsonb_build_object('invoice_id', invoice_a2, 'amount', 60))
  )) INTO receipt;
  SELECT public.record_customer_payment_receipt_v1(jsonb_build_object(
    'operation_id', payment_op, 'branch_id', branch_a, 'customer_id', customer_a, 'amount', 70, 'auto_allocate', false,
    'tenders', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 40), jsonb_build_object('method', 'card', 'amount', 30)),
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', invoice_a1, 'amount', 10), jsonb_build_object('invoice_id', invoice_a2, 'amount', 60))
  )) INTO replay;
  IF receipt IS DISTINCT FROM replay THEN RAISE EXCEPTION 'AR fixture: replay response changed'; END IF;
  v_receipt_id := (receipt->>'receipt_id')::uuid;
  SELECT count(*) INTO count_value FROM public.customer_payment_receipts WHERE operation_id = payment_op;
  IF count_value <> 1 THEN RAISE EXCEPTION 'AR fixture: replay duplicated receipt'; END IF;
  SELECT count(*) INTO count_value FROM public.customer_payment_receipt_tenders t WHERE t.receipt_id = v_receipt_id;
  IF count_value <> 2 THEN RAISE EXCEPTION 'AR fixture: split tender count mismatch'; END IF;
  SELECT public.ar_invoice_outstanding_v1(invoice_a1) INTO amount_value;
  IF amount_value <> 90 THEN RAISE EXCEPTION 'AR fixture: A1 outstanding expected 90, got %', amount_value; END IF;
  SELECT public.ar_invoice_outstanding_v1(invoice_a2) INTO amount_value;
  IF amount_value <> 0 THEN RAISE EXCEPTION 'AR fixture: A2 outstanding expected 0, got %', amount_value; END IF;

  -- Branch B is forbidden from changing Branch A's customer or receipts.
  PERFORM set_config('request.jwt.claim.sub', branch_b_user::text, true);
  BEGIN
    PERFORM public.record_customer_payment_receipt_v1(jsonb_build_object(
      'operation_id', rejected_op, 'branch_id', branch_a, 'customer_id', customer_a, 'amount', 1, 'auto_allocate', true,
      'tenders', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1)), 'allocations', '[]'::jsonb
    ));
    RAISE EXCEPTION 'AR fixture: cross-branch receipt unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'AR_BRANCH_FORBIDDEN%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO count_value FROM public.customer_payment_receipts WHERE tenant_id = t;
  IF count_value <> 1 THEN RAISE EXCEPTION 'AR fixture: rejected cross-branch request wrote a receipt'; END IF;

  -- Owner can reallocate but this does not change the AR ledger balance.
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  PERFORM public.reallocate_customer_payment_v1(jsonb_build_object(
    'operation_id', reallocation_op, 'receipt_id', v_receipt_id,
    'allocations', jsonb_build_array(jsonb_build_object('invoice_id', invoice_a1, 'amount', 70))
  ));
  SELECT public.ar_invoice_outstanding_v1(invoice_a1) INTO amount_value;
  IF amount_value <> 30 THEN RAISE EXCEPTION 'AR fixture: reallocation A1 expected 30, got %', amount_value; END IF;
  SELECT public.ar_invoice_outstanding_v1(invoice_a2) INTO amount_value;
  IF amount_value <> 60 THEN RAISE EXCEPTION 'AR fixture: reallocation A2 expected 60, got %', amount_value; END IF;
  SELECT public.ar_account_balance_v1(account_a) INTO amount_value;
  IF amount_value <> 90 THEN RAISE EXCEPTION 'AR fixture: reallocation changed balance'; END IF;

  -- Reversal retains the receipt, restores invoice settlement, and appends its offset.
  PERFORM public.reverse_customer_payment_receipt_v1(jsonb_build_object('operation_id', reversal_op, 'receipt_id', v_receipt_id, 'reason', 'Disposable certification reversal'));
  SELECT status INTO status_value FROM public.customer_payment_receipts WHERE id = v_receipt_id;
  IF status_value <> 'reversed' THEN RAISE EXCEPTION 'AR fixture: receipt not reversed'; END IF;
  SELECT public.ar_invoice_outstanding_v1(invoice_a1) INTO amount_value;
  IF amount_value <> 100 THEN RAISE EXCEPTION 'AR fixture: reversal did not restore A1'; END IF;
  SELECT public.ar_invoice_outstanding_v1(invoice_a2) INTO amount_value;
  IF amount_value <> 60 THEN RAISE EXCEPTION 'AR fixture: reversal did not restore A2'; END IF;
  SELECT public.ar_account_balance_v1(account_a) INTO amount_value;
  IF amount_value <> 160 THEN RAISE EXCEPTION 'AR fixture: reversal did not restore ledger balance'; END IF;

  -- The owner report is tenant-consolidated across all three branches.
  SELECT public.get_customer_receivables_report_v1(jsonb_build_object('start_date', current_date - 30, 'end_date', current_date, 'page_size', 50)) INTO report;
  IF (report->'summary'->>'totalReceivables')::numeric <> 660 THEN RAISE EXCEPTION 'AR fixture: report total mismatch'; END IF;
  IF (report->'summary'->>'overdueReceivables')::numeric <> 60 THEN RAISE EXCEPTION 'AR fixture: report overdue mismatch'; END IF;
  IF jsonb_array_length(report->'branchComparison') <> 3 THEN RAISE EXCEPTION 'AR fixture: report branch comparison mismatch'; END IF;
  RAISE EXCEPTION 'AR_CERTIFICATION_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'AR_CERTIFICATION_ROLLBACK' THEN RAISE; END IF;
  END;
END
$certification$;
