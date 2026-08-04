-- Customer Credit Balance As Of repair.
-- Additive read-contract change only: no rows, invoices, payments, stock, or
-- fiscal/ZATCA records are rewritten.

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
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_start_date date := coalesce(nullif(btrim(p_payload->>'start_date'), '')::date, v_today - 30);
  v_end_date date := coalesce(nullif(btrim(p_payload->>'end_date'), '')::date, v_today);
  v_as_of_date date := coalesce(nullif(btrim(p_payload->>'as_of_date'), '')::date, v_today);
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
  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653
     OR v_as_of_date > v_today
  THEN RAISE EXCEPTION 'AR_REPORT_DATE_RANGE_INVALID' USING ERRCODE = '22023'; END IF;

  WITH balances AS (
    SELECT a.id, a.display_name, a.display_name_ar,
           coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric AS balance
    FROM public.customer_receivable_accounts a
    JOIN public.customer_receivable_entries e ON e.receivable_account_id = a.id
    WHERE a.tenant_id = v_tenant_id
      AND e.effective_at < (v_as_of_date + 1)::timestamptz
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
        AND r.received_at::date <= v_as_of_date
        AND (v_effective_branch_id IS NULL OR r.branch_id = v_effective_branch_id)
    ), 0),
    'overdueReceivables', coalesce((
      SELECT sum(public.ar_invoice_outstanding_v1(i.id))
      FROM public.invoices i
      WHERE i.tenant_id = v_tenant_id AND i.status = 'posted'
        AND i.zatca_invoice_type IN ('simplified', 'standard')
        AND i.due_date IS NOT NULL AND i.due_date < v_as_of_date
        AND i.invoice_date <= v_as_of_date
        AND (v_effective_branch_id IS NULL OR i.branch_id = v_effective_branch_id)
        AND public.ar_invoice_outstanding_v1(i.id) > 0.01
    ), 0)
  ) INTO v_summary
  FROM (
    SELECT a.id, coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric AS balance
    FROM public.customer_receivable_accounts a
    JOIN public.customer_receivable_entries e ON e.receivable_account_id = a.id
    WHERE a.tenant_id = v_tenant_id
      AND e.effective_at < (v_as_of_date + 1)::timestamptz
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
      'startDate', v_start_date, 'endDate', v_end_date, 'asOfDate', v_as_of_date,
      'page', v_page, 'pageSize', v_page_size,
      'ownerConsolidated', v_effective_branch_id IS NULL)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_customer_receivables_report_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_receivables_report_v1(jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_customer_receivables_report_v1(jsonb) IS
  'Read-only tenant/branch-scoped receivables report with separate activity period and balance-as-of cutoff.';
