-- Non-mutating payload-compatibility certification. All calls must reject
-- before an authenticated financial operation can append a business row.
DO $rejections$
DECLARE
  v_before bigint;
  v_after bigint;
BEGIN
  SELECT count(*) INTO v_before
  FROM (
    SELECT id FROM public.customer_receivable_accounts
    UNION ALL SELECT id FROM public.customer_credit_policies
    UNION ALL SELECT tenant_id FROM public.tenant_customer_credit_policies
    UNION ALL SELECT id FROM public.customer_receivable_operations
    UNION ALL SELECT id FROM public.customer_payment_receipts
    UNION ALL SELECT id FROM public.customer_receivable_entries
    UNION ALL SELECT id FROM public.customer_payment_allocations
    UNION ALL SELECT id FROM public.customer_receivable_adjustments
  ) ar_rows;

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
    RAISE EXCEPTION 'AR rejection fixture: invalid credit-policy payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.set_tenant_customer_credit_policy_v1('[]'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid tenant credit-policy payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.ensure_customer_receivable_account_v1('{"customer_id":"not-a-uuid"}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: malformed account setup payload unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.post_customer_credit_checkout_v1('{"customer_id":"","branch_id":" ","initial_payment":null,"tenders":{}}'::jsonb);
    RAISE EXCEPTION 'AR rejection fixture: invalid credit checkout unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM !~ '^AR_' THEN RAISE; END IF;
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
    SELECT id FROM public.customer_receivable_accounts
    UNION ALL SELECT id FROM public.customer_credit_policies
    UNION ALL SELECT tenant_id FROM public.tenant_customer_credit_policies
    UNION ALL SELECT id FROM public.customer_receivable_operations
    UNION ALL SELECT id FROM public.customer_payment_receipts
    UNION ALL SELECT id FROM public.customer_receivable_entries
    UNION ALL SELECT id FROM public.customer_payment_allocations
    UNION ALL SELECT id FROM public.customer_receivable_adjustments
  ) ar_rows;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'AR rejection fixture: invalid payloads changed AR rows (% -> %)', v_before, v_after;
  END IF;
END
$rejections$;
