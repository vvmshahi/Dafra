-- Owner receivables oversight is a narrow, read-only contract.
--
-- It intentionally sits beside the existing operational customer-credit RPCs:
-- this migration neither creates fiscal documents nor changes receipts,
-- allocations, ledger entries, stock, checkout, register, day-close, or ZATCA
-- state.  Balances are always derived by the database from the append-only AR
-- ledger (debits minus credits); clients receive projections only.

SET lock_timeout = '5s';
SET statement_timeout = '5min';
DO $required_owner_receivables_contracts$
BEGIN
  IF to_regclass('public.user_profiles') IS NULL
     OR to_regclass('public.tenants') IS NULL
     OR to_regclass('public.branches') IS NULL
     OR to_regclass('public.customers') IS NULL
     OR to_regclass('public.customer_receivable_accounts') IS NULL
     OR to_regclass('public.customer_receivable_entries') IS NULL
     OR to_regclass('public.customer_payment_receipts') IS NULL
     OR to_regclass('public.customer_payment_allocations') IS NULL
     OR to_regclass('public.invoices') IS NULL
     OR to_regprocedure('public.ar_invoice_outstanding_v1(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$required_owner_receivables_contracts$;
-- The only scope authority for this contract.  It derives the tenant from the
-- authenticated, active owner profile and never accepts a tenant identifier
-- from a caller.  A requested branch must be active and belong to that tenant.
CREATE OR REPLACE FUNCTION public.owner_receivables_assert_scope_v1(
  p_requested_branch_id uuid DEFAULT NULL
)
RETURNS TABLE(
  tenant_id uuid,
  actor_id uuid,
  branch_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.tenant_id, p.role::text AS role, p.is_active,
         coalesce(t.is_active, false) AS tenant_active, t.suspended_at
    INTO v_actor
  FROM public.user_profiles p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = auth.uid();

  IF NOT FOUND
     OR v_actor.is_active IS NOT TRUE
     OR v_actor.tenant_active IS NOT TRUE
     OR v_actor.suspended_at IS NOT NULL
     OR v_actor.role IS DISTINCT FROM 'owner'
  THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_OWNER_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF p_requested_branch_id IS NOT NULL THEN
    SELECT b.id INTO v_branch_id
    FROM public.branches b
    WHERE b.id = p_requested_branch_id
      AND b.tenant_id = v_actor.tenant_id
      AND b.is_active IS TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'OWNER_RECEIVABLES_BRANCH_INVALID' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY SELECT v_actor.tenant_id, v_actor.id, v_branch_id;
END
$function$;
-- Supports the branch-filtered balance grouping used by the owner list and
-- detail views.  The existing tenant/account/effective index remains useful
-- for consolidated reads; this one avoids scanning another branch first.
CREATE INDEX IF NOT EXISTS customer_receivable_entries_owner_scope_idx
  ON public.customer_receivable_entries (
    tenant_id, branch_id, receivable_account_id, effective_at DESC, id DESC
  );
CREATE OR REPLACE FUNCTION public.get_owner_receivables_summary_v1(
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_requested_branch_id uuid;
  v_start_date date;
  v_end_date date;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_scope record;
  v_summary jsonb;
  v_branches jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_requested_branch_id := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
    v_start_date := coalesce(nullif(btrim(p_payload->>'start_date'), '')::date, v_today - 30);
    v_end_date := coalesce(nullif(btrim(p_payload->>'end_date'), '')::date, v_today);
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_FILTER_INVALID' USING ERRCODE = '22023';
  END;

  IF v_start_date > v_end_date OR v_end_date > v_today OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_DATE_RANGE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.owner_receivables_assert_scope_v1(v_requested_branch_id);

  WITH balances AS (
    SELECT e.receivable_account_id,
           coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric AS balance
    FROM public.customer_receivable_entries e
    WHERE e.tenant_id = v_scope.tenant_id
      AND (v_scope.branch_id IS NULL OR e.branch_id = v_scope.branch_id)
    GROUP BY e.receivable_account_id
  )
  SELECT jsonb_build_object(
    'totalReceivables', coalesce(sum(b.balance) FILTER (WHERE b.balance > 0), 0),
    'customerCredit', coalesce(sum(-b.balance) FILTER (WHERE b.balance < 0), 0),
    'customerCount', count(*) FILTER (WHERE b.balance <> 0),
    'paymentsReceived', coalesce((
      SELECT sum(r.amount)
      FROM public.customer_payment_receipts r
      WHERE r.tenant_id = v_scope.tenant_id
        AND r.status = 'completed'
        AND r.received_at::date BETWEEN v_start_date AND v_end_date
        AND (v_scope.branch_id IS NULL OR r.branch_id = v_scope.branch_id)
    ), 0),
    'overdueReceivables', coalesce((
      SELECT sum(public.ar_invoice_outstanding_v1(i.id))
      FROM public.invoices i
      WHERE i.tenant_id = v_scope.tenant_id
        AND i.status = 'posted'
        AND i.zatca_invoice_type IN ('simplified', 'standard')
        AND i.due_date IS NOT NULL
        AND i.due_date < v_today
        AND (v_scope.branch_id IS NULL OR i.branch_id = v_scope.branch_id)
        AND public.ar_invoice_outstanding_v1(i.id) > 0.01
    ), 0)
  )
  INTO v_summary
  FROM balances b;

  WITH account_branch_balances AS (
    SELECT e.branch_id, e.receivable_account_id,
           coalesce(sum(e.debit_amount), 0)::numeric AS debits,
           coalesce(sum(e.credit_amount), 0)::numeric AS credits
    FROM public.customer_receivable_entries e
    WHERE e.tenant_id = v_scope.tenant_id
      AND (v_scope.branch_id IS NULL OR e.branch_id = v_scope.branch_id)
    GROUP BY e.branch_id, e.receivable_account_id
  ), branch_balances AS (
    SELECT x.branch_id,
           coalesce(sum(x.debits - x.credits) FILTER (WHERE x.debits - x.credits > 0), 0)::numeric AS total_receivables,
           coalesce(sum(x.credits - x.debits) FILTER (WHERE x.debits - x.credits < 0), 0)::numeric AS customer_credit,
           count(*) FILTER (WHERE x.debits - x.credits <> 0) AS customer_count
    FROM account_branch_balances x
    GROUP BY x.branch_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'branchId', b.id,
    'name', b.name,
    'nameAr', b.name_ar,
    'totalReceivables', coalesce(x.total_receivables, 0),
    'customerCredit', coalesce(x.customer_credit, 0),
    'customerCount', coalesce(x.customer_count, 0),
    'paymentsReceived', coalesce((
      SELECT sum(r.amount)
      FROM public.customer_payment_receipts r
      WHERE r.tenant_id = v_scope.tenant_id
        AND r.branch_id = b.id
        AND r.status = 'completed'
        AND r.received_at::date BETWEEN v_start_date AND v_end_date
    ), 0)
  ) ORDER BY b.name, b.id), '[]'::jsonb)
  INTO v_branches
  FROM public.branches b
  LEFT JOIN branch_balances x ON x.branch_id = b.id
  WHERE b.tenant_id = v_scope.tenant_id
    AND b.is_active IS TRUE
    AND (v_scope.branch_id IS NULL OR b.id = v_scope.branch_id);

  RETURN jsonb_build_object(
    'summary', v_summary,
    'branches', v_branches,
    'filters', jsonb_build_object(
      'branchId', v_scope.branch_id,
      'startDate', v_start_date,
      'endDate', v_end_date,
      'ownerConsolidated', v_scope.branch_id IS NULL
    )
  );
END
$function$;
CREATE OR REPLACE FUNCTION public.list_owner_receivable_customers_v1(
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_requested_branch_id uuid;
  v_search text;
  v_positive_balance boolean := true;
  v_page integer := 1;
  v_page_size integer := 50;
  v_scope record;
  v_rows jsonb;
  v_total_count integer := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_requested_branch_id := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
    v_search := nullif(btrim(p_payload->>'search'), '');
    v_page := coalesce(nullif(btrim(p_payload->>'page'), '')::integer, 1);
    v_page_size := coalesce(nullif(btrim(p_payload->>'page_size'), '')::integer, 50);
    IF p_payload ? 'positive_balance' THEN
      IF lower(coalesce(p_payload->>'positive_balance', '')) NOT IN ('true', 'false') THEN
        RAISE EXCEPTION 'OWNER_RECEIVABLES_FILTER_INVALID' USING ERRCODE = '22023';
      END IF;
      v_positive_balance := (p_payload->>'positive_balance')::boolean;
    END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_FILTER_INVALID' USING ERRCODE = '22023';
  END;

  IF v_page < 1 OR v_page_size NOT BETWEEN 1 AND 100 OR length(coalesce(v_search, '')) > 100 THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_FILTER_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.owner_receivables_assert_scope_v1(v_requested_branch_id);

  WITH balances AS (
    SELECT c.id AS customer_id,
           c.branch_id AS customer_branch_id,
           c.name,
           c.name_ar,
           c.receivable_account_id,
           coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric AS balance,
           max(e.effective_at) AS last_activity_at
    FROM public.customers c
    JOIN public.customer_receivable_accounts a
      ON a.id = c.receivable_account_id AND a.tenant_id = v_scope.tenant_id
    JOIN public.customer_receivable_entries e
      ON e.receivable_account_id = a.id
     AND e.tenant_id = v_scope.tenant_id
     AND (v_scope.branch_id IS NULL OR e.branch_id = v_scope.branch_id)
    WHERE c.tenant_id = v_scope.tenant_id
      AND (v_search IS NULL OR c.name ILIKE '%' || v_search || '%'
        OR coalesce(c.name_ar, '') ILIKE '%' || v_search || '%'
        OR a.display_name ILIKE '%' || v_search || '%'
        OR coalesce(a.display_name_ar, '') ILIKE '%' || v_search || '%')
    GROUP BY c.id, c.branch_id, c.name, c.name_ar, c.receivable_account_id
  ), filtered AS (
    SELECT * FROM balances
    WHERE (v_positive_balance AND balance > 0)
       OR (NOT v_positive_balance AND balance <> 0)
  ), numbered AS (
    SELECT f.*, count(*) OVER () AS total_count
    FROM filtered f
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'customerId', r.customer_id,
    'branchId', r.customer_branch_id,
    'name', r.name,
    'nameAr', r.name_ar,
    'receivableAccountId', r.receivable_account_id,
    'balance', r.balance,
    'lastActivityAt', r.last_activity_at
  ) ORDER BY r.balance DESC, r.name, r.customer_id), '[]'::jsonb),
  coalesce(max(r.total_count), 0)::integer
  INTO v_rows, v_total_count
  FROM (
    SELECT * FROM numbered
    ORDER BY balance DESC, name, customer_id
    LIMIT v_page_size OFFSET ((v_page - 1) * v_page_size)
  ) r;

  RETURN jsonb_build_object(
    'customers', v_rows,
    'pagination', jsonb_build_object(
      'page', v_page,
      'pageSize', v_page_size,
      'totalCount', v_total_count,
      'hasMore', v_page * v_page_size < v_total_count
    ),
    'filters', jsonb_build_object(
      'branchId', v_scope.branch_id,
      'search', v_search,
      'positiveBalance', v_positive_balance
    )
  );
END
$function$;
CREATE OR REPLACE FUNCTION public.get_owner_receivable_detail_v1(
  p_payload jsonb
)
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
  v_page integer := 1;
  v_page_size integer := 50;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_scope record;
  v_customer record;
  v_balance numeric := 0;
  v_open_invoice_count integer := 0;
  v_overdue_amount numeric := 0;
  v_last_payment_at timestamptz;
  v_ledger jsonb;
  v_ledger_total integer := 0;
  v_open_invoices jsonb;
  v_recent_payments jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_customer_id := nullif(btrim(p_payload->>'customer_id'), '')::uuid;
    v_requested_branch_id := nullif(btrim(p_payload->>'branch_id'), '')::uuid;
    v_page := coalesce(nullif(btrim(p_payload->>'page'), '')::integer, 1);
    v_page_size := coalesce(nullif(btrim(p_payload->>'page_size'), '')::integer, 50);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_FILTER_INVALID' USING ERRCODE = '22023';
  END;

  IF v_customer_id IS NULL OR v_page < 1 OR v_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_FILTER_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.owner_receivables_assert_scope_v1(v_requested_branch_id);

  SELECT c.id, c.branch_id, c.name, c.name_ar, c.phone, c.receivable_account_id,
         a.display_name, a.display_name_ar
    INTO v_customer
  FROM public.customers c
  LEFT JOIN public.customer_receivable_accounts a
    ON a.id = c.receivable_account_id AND a.tenant_id = c.tenant_id
  WHERE c.id = v_customer_id
    AND c.tenant_id = v_scope.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECEIVABLES_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  IF v_customer.receivable_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'customer', jsonb_build_object(
        'id', v_customer.id,
        'branchId', v_customer.branch_id,
        'name', v_customer.name,
        'nameAr', v_customer.name_ar,
        'phone', v_customer.phone,
        'receivableAccountId', NULL
      ),
      'summary', jsonb_build_object('balance', 0, 'openInvoiceCount', 0,
        'overdueAmount', 0, 'lastPaymentAt', NULL),
      'ledger', '[]'::jsonb,
      'openInvoices', '[]'::jsonb,
      'recentPayments', '[]'::jsonb,
      'pagination', jsonb_build_object('page', v_page, 'pageSize', v_page_size,
        'totalCount', 0, 'hasMore', false),
      'scope', jsonb_build_object('branchId', v_scope.branch_id,
        'ownerConsolidated', v_scope.branch_id IS NULL)
    );
  END IF;

  SELECT coalesce(sum(e.debit_amount - e.credit_amount), 0)::numeric
    INTO v_balance
  FROM public.customer_receivable_entries e
  WHERE e.tenant_id = v_scope.tenant_id
    AND e.receivable_account_id = v_customer.receivable_account_id
    AND (v_scope.branch_id IS NULL OR e.branch_id = v_scope.branch_id);

  WITH invoice_rows AS (
    SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.branch_id,
           public.ar_invoice_outstanding_v1(i.id) AS outstanding
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.tenant_id
      AND i.customer_id = v_customer.id
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND EXISTS (
        SELECT 1 FROM public.customer_receivable_entries e
        WHERE e.tenant_id = v_scope.tenant_id
          AND e.source_kind = 'invoice'
          AND e.source_id = i.id
          AND e.receivable_account_id = v_customer.receivable_account_id
      )
      AND (v_scope.branch_id IS NULL OR i.branch_id = v_scope.branch_id)
  )
  SELECT count(*) FILTER (WHERE r.outstanding > 0.01)::integer,
         coalesce(sum(r.outstanding) FILTER (
           WHERE r.outstanding > 0.01 AND r.due_date IS NOT NULL AND r.due_date < v_today
         ), 0)
    INTO v_open_invoice_count, v_overdue_amount
  FROM invoice_rows r;

  SELECT max(r.received_at) INTO v_last_payment_at
  FROM public.customer_payment_receipts r
  WHERE r.tenant_id = v_scope.tenant_id
    AND r.receivable_account_id = v_customer.receivable_account_id
    AND r.status = 'completed'
    AND (v_scope.branch_id IS NULL OR r.branch_id = v_scope.branch_id);

  WITH ledger_rows AS (
    SELECT e.id, e.entry_type, e.source_kind, e.source_id, e.branch_id,
           e.debit_amount, e.credit_amount, e.effective_at, e.description,
           count(*) OVER () AS total_count
    FROM public.customer_receivable_entries e
    WHERE e.tenant_id = v_scope.tenant_id
      AND e.receivable_account_id = v_customer.receivable_account_id
      AND (v_scope.branch_id IS NULL OR e.branch_id = v_scope.branch_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'entryType', r.entry_type,
    'sourceKind', r.source_kind,
    'sourceId', r.source_id,
    'branchId', r.branch_id,
    'debit', r.debit_amount,
    'credit', r.credit_amount,
    'effectiveAt', r.effective_at,
    'description', r.description
  ) ORDER BY r.effective_at DESC, r.id DESC), '[]'::jsonb),
  coalesce(max(r.total_count), 0)::integer
    INTO v_ledger, v_ledger_total
  FROM (
    SELECT * FROM ledger_rows
    ORDER BY effective_at DESC, id DESC
    LIMIT v_page_size OFFSET ((v_page - 1) * v_page_size)
  ) r;

  WITH invoice_rows AS (
    SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.branch_id,
           public.ar_invoice_outstanding_v1(i.id) AS outstanding
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.tenant_id
      AND i.customer_id = v_customer.id
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND EXISTS (
        SELECT 1 FROM public.customer_receivable_entries e
        WHERE e.tenant_id = v_scope.tenant_id
          AND e.source_kind = 'invoice'
          AND e.source_id = i.id
          AND e.receivable_account_id = v_customer.receivable_account_id
      )
      AND (v_scope.branch_id IS NULL OR i.branch_id = v_scope.branch_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'invoiceNumber', r.invoice_number,
    'invoiceDate', r.invoice_date,
    'dueDate', r.due_date,
    'total', r.total_amount,
    'outstanding', r.outstanding,
    'branchId', r.branch_id,
    'isOverdue', r.due_date IS NOT NULL AND r.due_date < v_today
  ) ORDER BY r.due_date NULLS LAST, r.invoice_date, r.id), '[]'::jsonb)
    INTO v_open_invoices
  FROM (
    SELECT * FROM invoice_rows
    WHERE outstanding > 0.01
    ORDER BY due_date NULLS LAST, invoice_date, id
    LIMIT 50
  ) r;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'receiptNumber', r.receipt_number,
    'amount', r.amount,
    'method', r.method,
    'receivedAt', r.received_at,
    'branchId', r.branch_id
  ) ORDER BY r.received_at DESC, r.id DESC), '[]'::jsonb)
    INTO v_recent_payments
  FROM (
    SELECT r.id, r.receipt_number, r.amount, r.method, r.received_at, r.branch_id
    FROM public.customer_payment_receipts r
    WHERE r.tenant_id = v_scope.tenant_id
      AND r.receivable_account_id = v_customer.receivable_account_id
      AND r.status = 'completed'
      AND (v_scope.branch_id IS NULL OR r.branch_id = v_scope.branch_id)
    ORDER BY r.received_at DESC, r.id DESC
    LIMIT 25
  ) r;

  RETURN jsonb_build_object(
    'customer', jsonb_build_object(
      'id', v_customer.id,
      'branchId', v_customer.branch_id,
      'name', v_customer.name,
      'nameAr', v_customer.name_ar,
      'phone', v_customer.phone,
      'receivableAccountId', v_customer.receivable_account_id
    ),
    'summary', jsonb_build_object(
      'balance', v_balance,
      'openInvoiceCount', v_open_invoice_count,
      'overdueAmount', v_overdue_amount,
      'lastPaymentAt', v_last_payment_at
    ),
    'ledger', v_ledger,
    'openInvoices', v_open_invoices,
    'recentPayments', v_recent_payments,
    'pagination', jsonb_build_object(
      'page', v_page,
      'pageSize', v_page_size,
      'totalCount', v_ledger_total,
      'hasMore', v_page * v_page_size < v_ledger_total
    ),
    'scope', jsonb_build_object(
      'branchId', v_scope.branch_id,
      'ownerConsolidated', v_scope.branch_id IS NULL
    )
  );
END
$function$;
ALTER FUNCTION public.owner_receivables_assert_scope_v1(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_owner_receivables_summary_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.list_owner_receivable_customers_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_owner_receivable_detail_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owner_receivables_assert_scope_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_owner_receivables_summary_v1(jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_owner_receivable_customers_v1(jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_owner_receivable_detail_v1(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_receivables_summary_v1(jsonb),
  public.list_owner_receivable_customers_v1(jsonb),
  public.get_owner_receivable_detail_v1(jsonb)
  TO authenticated;
COMMENT ON FUNCTION public.owner_receivables_assert_scope_v1(uuid) IS
  'Internal owner-only scope assertion. Tenant context is derived from auth.uid() and an active owner profile.';
COMMENT ON FUNCTION public.get_owner_receivables_summary_v1(jsonb) IS
  'Owner-only, read-only AR oversight summary. Outstanding is ledger debits less credits; overdue uses explicit invoice due dates only.';
COMMENT ON FUNCTION public.list_owner_receivable_customers_v1(jsonb) IS
  'Owner-only, read-only paginated customer receivables list. Positive-balance filtering is server enforced.';
COMMENT ON FUNCTION public.get_owner_receivable_detail_v1(jsonb) IS
  'Owner-only, read-only customer AR detail with bounded ledger, open invoices, and recent completed receipts. No adjustment or reversal action is exposed.';
