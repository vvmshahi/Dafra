-- Non-mutating rejection-path certification. These calls intentionally use
-- malformed or incomplete payloads and must fail before any business row is
-- appended. This fixture never creates a tenant, customer, invoice, or
-- inventory row.
DO $rejections$
DECLARE
  v_before bigint;
  v_after bigint;
BEGIN
  SELECT count(*) INTO v_before
  FROM (
    SELECT id FROM public.purchases
    UNION ALL SELECT id FROM public.purchase_items
    UNION ALL SELECT id FROM public.purchase_stock_movements
    UNION ALL SELECT id FROM public.pos_stock_movements
    UNION ALL SELECT id FROM public.invoices
    UNION ALL SELECT id FROM public.invoice_items
    UNION ALL SELECT id FROM public.customer_receivable_accounts
    UNION ALL SELECT id FROM public.customer_credit_policies
    UNION ALL SELECT tenant_id FROM public.tenant_customer_credit_policies
    UNION ALL SELECT id FROM public.customer_receivable_operations
    UNION ALL SELECT id FROM public.customer_payment_receipts
    UNION ALL SELECT id FROM public.customer_receivable_entries
    UNION ALL SELECT id FROM public.customer_payment_allocations
    UNION ALL SELECT id FROM public.customer_receivable_adjustments
  ) rows_before;

  BEGIN
    PERFORM public.get_customer_receivable_workspace_v1('[]'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: array workspace payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_customer_receivable_workspace_v1('{"customer_id":"not-a-uuid"}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: malformed workspace UUID unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_customer_credit_policy_v1('[]'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid legacy customer policy payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_tenant_customer_credit_policy_v1('[]'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid legacy tenant policy payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_branch_customer_credit_policy_v1('[]'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid Branch credit payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_customer_credit_access_v1('[]'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid legacy customer access payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.ensure_customer_credit_account_v1('{"customer_id":"not-a-uuid"}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: malformed automatic account payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_customer_credit_checkout_eligibility_v1('{"branch_id":"not-a-uuid","customer_id":"not-a-uuid"}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: malformed Branch/B2B preflight unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.post_customer_credit_checkout_v1('{"customer_id":"","branch_id":"","initial_payment":null,"tenders":{}}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: incomplete credit checkout unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'CUSTOMER_NOT_FOUND' AND SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_customer_payment_receipt_v1('{"operation_id":"","branch_id":"not-a-uuid","customer_id":"","amount":"zero","tenders":{}}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid payment receipt unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reallocate_customer_payment_v1('{"operation_id":"","receipt_id":"not-a-uuid","allocations":{}}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid reallocation unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reverse_customer_payment_receipt_v1('{"operation_id":"","receipt_id":"","reason":" "}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid reversal unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.create_customer_credit_note_settlement_v1('{"operation_id":"","original_invoice_id":"not-a-uuid","reason":"","items":{}}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid credit-note settlement unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.post_customer_receivable_adjustment_v1('{"operation_id":"","branch_id":"","customer_id":"","amount":0,"direction":"unknown","reason":" "}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid adjustment unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.get_customer_receivables_report_v1('[]'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid report payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;

  SELECT count(*) INTO v_after
  FROM (
    SELECT id FROM public.purchases
    UNION ALL SELECT id FROM public.purchase_items
    UNION ALL SELECT id FROM public.purchase_stock_movements
    UNION ALL SELECT id FROM public.pos_stock_movements
    UNION ALL SELECT id FROM public.invoices
    UNION ALL SELECT id FROM public.invoice_items
    UNION ALL SELECT id FROM public.customer_receivable_accounts
    UNION ALL SELECT id FROM public.customer_credit_policies
    UNION ALL SELECT tenant_id FROM public.tenant_customer_credit_policies
    UNION ALL SELECT id FROM public.customer_receivable_operations
    UNION ALL SELECT id FROM public.customer_payment_receipts
    UNION ALL SELECT id FROM public.customer_receivable_entries
    UNION ALL SELECT id FROM public.customer_payment_allocations
    UNION ALL SELECT id FROM public.customer_receivable_adjustments
  ) rows_after;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'AR rejection fixture: invalid payloads changed business rows (% -> %)', v_before, v_after;
  END IF;
END
$rejections$;
