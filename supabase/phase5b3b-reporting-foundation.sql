-- ============================================================
-- Phase 5B-3B: server-side reporting foundation
-- Apply manually after Phase 5B / Phase 4 purchase migrations.
-- ============================================================
--
-- Goals:
--   - Centralize counted-document rules for reports and dashboards.
--   - Keep reports scalable enough for pilot / early multi-tenant use.
--   - Keep VAT output as a support estimate, not tax/legal advice.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not expose raw ZATCA XML, API payloads, keys, CSIDs, or secrets.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - This patch creates read-only reporting views and SECURITY DEFINER RPCs.
-- ============================================================

BEGIN;

-- ============================================================
-- Internal scope helper
-- ============================================================

CREATE OR REPLACE FUNCTION public.reporting_resolve_scope(p_branch_id UUID DEFAULT NULL)
RETURNS TABLE (
  caller_id UUID,
  caller_role TEXT,
  scope_tenant_id UUID,
  profile_branch_id UUID,
  scope_branch_id UUID,
  tenant_scope BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NOT NULL THEN
    SELECT b.id, b.tenant_id
      INTO v_branch
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active IS TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  caller_id := v_profile.id;
  caller_role := v_profile.role;
  profile_branch_id := v_profile.branch_id;

  IF v_profile.role = 'super_admin' THEN
    IF p_branch_id IS NULL THEN
      IF v_profile.tenant_id IS NULL THEN
        RAISE EXCEPTION 'Branch is required for this report scope' USING ERRCODE = '42501';
      END IF;

      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := NULL;
      tenant_scope := TRUE;
    ELSE
      scope_tenant_id := v_branch.tenant_id;
      scope_branch_id := v_branch.id;
      tenant_scope := FALSE;
    END IF;

    RETURN NEXT;
    RETURN;
  END IF;

  IF v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Caller tenant not found' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    IF v_profile.role IN ('owner', 'admin') THEN
      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := NULL;
      tenant_scope := TRUE;
    ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
      IF v_profile.branch_id IS NULL THEN
        RAISE EXCEPTION 'Caller branch not found' USING ERRCODE = '42501';
      END IF;

      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := v_profile.branch_id;
      tenant_scope := FALSE;
    ELSE
      RAISE EXCEPTION 'You do not have permission to view this report.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_profile.role IN ('owner', 'admin') THEN
      IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
        RAISE EXCEPTION 'You do not have permission to view this branch report.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
      IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
         OR v_profile.branch_id IS DISTINCT FROM v_branch.id
      THEN
        RAISE EXCEPTION 'You do not have permission to view this branch report.'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'You do not have permission to view this branch report.'
        USING ERRCODE = '42501';
    END IF;

    scope_tenant_id := v_branch.tenant_id;
    scope_branch_id := v_branch.id;
    tenant_scope := FALSE;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_resolve_scope(UUID) FROM PUBLIC;

-- ============================================================
-- Internal reporting views
-- ============================================================

CREATE OR REPLACE VIEW public.reporting_invoice_documents_v AS
SELECT
  i.id,
  i.tenant_id,
  i.branch_id,
  i.customer_id,
  i.invoice_number,
  i.invoice_date,
  i.created_at,
  i.zatca_invoice_type::text AS zatca_invoice_type,
  i.status::text AS status,
  COALESCE(i.payment_method::text, 'cash') AS payment_method,
  (i.status::text = 'posted') AS is_counted,
  CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
  CASE
    WHEN i.status::text = 'posted' AND i.zatca_invoice_type::text <> 'credit_note'
      THEN COALESCE(i.total_amount, 0)
    ELSE 0
  END AS gross_total_amount,
  CASE
    WHEN i.status::text = 'posted' AND i.zatca_invoice_type::text = 'credit_note'
      THEN COALESCE(i.total_amount, 0)
    ELSE 0
  END AS credited_total_amount,
  CASE
    WHEN i.status::text = 'posted'
      THEN (CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END) * COALESCE(i.total_amount, 0)
    ELSE 0
  END AS signed_total_amount,
  CASE
    WHEN i.status::text = 'posted' AND i.zatca_invoice_type::text <> 'credit_note'
      THEN COALESCE(i.tax_amount, 0)
    ELSE 0
  END AS gross_tax_amount,
  CASE
    WHEN i.status::text = 'posted' AND i.zatca_invoice_type::text = 'credit_note'
      THEN COALESCE(i.tax_amount, 0)
    ELSE 0
  END AS credited_tax_amount,
  CASE
    WHEN i.status::text = 'posted'
      THEN (CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END) * COALESCE(i.tax_amount, 0)
    ELSE 0
  END AS signed_tax_amount
FROM public.invoices i;

REVOKE ALL ON TABLE public.reporting_invoice_documents_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reporting_invoice_documents_v TO service_role;

CREATE OR REPLACE VIEW public.reporting_counted_purchases_v AS
SELECT
  p.id,
  p.tenant_id,
  p.branch_id,
  p.supplier_id,
  p.purchase_date,
  COALESCE(p.purchase_mode, 'detailed_receiving') AS purchase_mode,
  COALESCE(p.status, 'posted') AS status,
  COALESCE(p.receiving_status, 'not_applicable') AS receiving_status,
  COALESCE(p.subtotal, 0) AS subtotal,
  COALESCE(p.vat_amount, 0) AS vat_amount,
  COALESCE(p.total_amount, 0) AS total_amount,
  (
    COALESCE(p.status, 'posted') = 'cancelled'
    OR COALESCE(p.receiving_status, 'not_applicable') IN ('cancelled', 'reversed')
  ) AS is_deleted_or_reversed,
  (
    COALESCE(p.status, 'posted') <> 'cancelled'
    AND COALESCE(p.receiving_status, 'not_applicable') NOT IN ('cancelled', 'reversed')
    AND (
      (
        COALESCE(p.purchase_mode, 'detailed_receiving') IN ('simple_bill', 'bill_only')
        AND COALESCE(p.status, 'posted') = 'posted'
      )
      OR (
        COALESCE(p.purchase_mode, 'detailed_receiving') IN ('detailed_receiving', 'receive_stock')
        AND COALESCE(p.receiving_status, 'not_applicable') IN ('confirmed', 'confirmed_legacy')
      )
      OR (
        COALESCE(p.receiving_status, 'not_applicable') = 'not_applicable'
        AND COALESCE(p.status, 'posted') = 'posted'
      )
    )
  ) AS is_counted
FROM public.purchases p;

REVOKE ALL ON TABLE public.reporting_counted_purchases_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reporting_counted_purchases_v TO service_role;

CREATE OR REPLACE VIEW public.reporting_expenses_v AS
SELECT
  e.id,
  e.tenant_id,
  e.branch_id,
  e.category_id,
  e.expense_date,
  e.description,
  COALESCE(e.payment_method, 'cash') AS payment_method,
  COALESCE(e.vat_treatment, 'no_vat') AS vat_treatment,
  COALESCE(e.amount, 0) AS amount,
  COALESCE(e.vat_amount, 0) AS vat_amount,
  COALESCE(e.total_paid, e.amount, 0) AS total_paid,
  CASE
    WHEN COALESCE(e.vat_treatment, 'no_vat') <> 'no_vat'
      THEN COALESCE(e.vat_amount, 0)
    ELSE 0
  END AS input_vat_amount,
  GREATEST(
    COALESCE(e.total_paid, e.amount, 0)
    - CASE
        WHEN COALESCE(e.vat_treatment, 'no_vat') <> 'no_vat'
          THEN COALESCE(e.vat_amount, 0)
        ELSE 0
      END,
    0
  ) AS profit_expense_amount,
  e.created_at
FROM public.expenses e;

REVOKE ALL ON TABLE public.reporting_expenses_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reporting_expenses_v TO service_role;

-- ============================================================
-- Sales report
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_sales_report_summary(
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_gross_sales NUMERIC := 0;
  v_credit_notes NUMERIC := 0;
  v_total_revenue NUMERIC := 0;
  v_vat_on_sales NUMERIC := 0;
  v_vat_credited NUMERIC := 0;
  v_vat_collected NUMERIC := 0;
  v_invoice_count INTEGER := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  v_by_method JSONB := '[]'::jsonb;
  v_top_products JSONB := '[]'::jsonb;
  v_cat_performance JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  )
  SELECT
    COALESCE(SUM(gross_total_amount), 0),
    COALESCE(SUM(credited_total_amount), 0),
    COALESCE(SUM(signed_total_amount), 0),
    COALESCE(SUM(gross_tax_amount), 0),
    COALESCE(SUM(credited_tax_amount), 0),
    COALESCE(SUM(signed_tax_amount), 0),
    COUNT(*)::integer
  INTO
    v_gross_sales,
    v_credit_notes,
    v_total_revenue,
    v_vat_on_sales,
    v_vat_credited,
    v_vat_collected,
    v_invoice_count
  FROM inv;

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  rows AS (
    SELECT
      invoice_date::text AS date,
      COALESCE(SUM(signed_total_amount), 0) AS revenue,
      COUNT(*)::integer AS invoices
    FROM inv
    GROUP BY invoice_date
    ORDER BY invoice_date
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', date, 'revenue', revenue, 'invoices', invoices)
    ORDER BY date
  ), '[]'::jsonb)
  INTO v_daily_sales
  FROM rows;

  WITH inv AS (
    SELECT id, accounting_sign, payment_method, signed_total_amount
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  payment_rows AS (
    SELECT
      COALESCE(p.method::text, inv.payment_method) AS method,
      CASE
        WHEN p.id IS NULL THEN inv.signed_total_amount
        ELSE inv.accounting_sign * COALESCE(p.amount, 0)
      END AS signed_payment_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  ),
  rows AS (
    SELECT
      CASE COALESCE(method, 'cash')
        WHEN 'cash' THEN 'Cash'
        WHEN 'card' THEN 'Card'
        WHEN 'bank_transfer' THEN 'Bank Transfer'
        ELSE INITCAP(COALESCE(method, 'other'))
      END AS name,
      COALESCE(SUM(signed_payment_amount), 0) AS value
    FROM payment_rows
    GROUP BY COALESCE(method, 'cash')
    ORDER BY value DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'value', value)
    ORDER BY value DESC
  ), '[]'::jsonb)
  INTO v_by_method
  FROM rows;

  WITH inv AS (
    SELECT id, accounting_sign
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  rows AS (
    SELECT
      ii.name,
      COALESCE(SUM(inv.accounting_sign * COALESCE(ii.quantity, 0)), 0) AS quantity,
      COALESCE(SUM(inv.accounting_sign * COALESCE(ii.total, 0)), 0) AS revenue
    FROM inv
    JOIN public.invoice_items ii ON ii.invoice_id = inv.id
    GROUP BY ii.name
    ORDER BY revenue DESC
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', name,
      'quantity', quantity,
      'revenue', revenue,
      'pct', CASE WHEN v_total_revenue <> 0 THEN ROUND((revenue / v_total_revenue) * 100, 2) ELSE 0 END
    )
    ORDER BY revenue DESC
  ), '[]'::jsonb)
  INTO v_top_products
  FROM rows;

  WITH inv AS (
    SELECT id, accounting_sign
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS name,
      COALESCE(SUM(inv.accounting_sign * COALESCE(ii.quantity, 0)), 0) AS items,
      COALESCE(SUM(inv.accounting_sign * COALESCE(ii.total, 0)), 0) AS revenue
    FROM inv
    JOIN public.invoice_items ii ON ii.invoice_id = inv.id
    LEFT JOIN public.products pr ON pr.id = ii.product_id
    LEFT JOIN public.categories c ON c.id = pr.category_id
    GROUP BY COALESCE(c.name, 'Uncategorized')
    ORDER BY revenue DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', name,
      'items', items,
      'revenue', revenue,
      'pct', CASE WHEN v_total_revenue <> 0 THEN ROUND((revenue / v_total_revenue) * 100, 2) ELSE 0 END
    )
    ORDER BY revenue DESC
  ), '[]'::jsonb)
  INTO v_cat_performance
  FROM rows;

  RETURN jsonb_build_object(
    'grossSales', v_gross_sales,
    'creditNotes', v_credit_notes,
    'totalRevenue', v_total_revenue,
    'invoiceCount', v_invoice_count,
    'avgOrderValue', CASE WHEN v_invoice_count > 0 THEN ROUND(v_total_revenue / v_invoice_count, 2) ELSE 0 END,
    'vatOnSales', v_vat_on_sales,
    'vatCredited', v_vat_credited,
    'vatCollected', v_vat_collected,
    'dailySales', v_daily_sales,
    'byMethod', v_by_method,
    'topProducts', v_top_products,
    'catPerformance', v_cat_performance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_report_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- VAT support report
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_vat_support_summary(
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_gross_sales NUMERIC := 0;
  v_credit_notes NUMERIC := 0;
  v_vat_on_sales NUMERIC := 0;
  v_vat_credited NUMERIC := 0;
  v_vat_collected NUMERIC := 0;
  v_vat_paid_purchases NUMERIC := 0;
  v_vat_paid_expenses NUMERIC := 0;
  v_sales_total NUMERIC := 0;
  v_monthly_rows JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  pur AS (
    SELECT *
    FROM public.reporting_counted_purchases_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND purchase_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  exp AS (
    SELECT *
    FROM public.reporting_expenses_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND expense_date BETWEEN p_start_date AND p_end_date
  )
  SELECT
    COALESCE((SELECT SUM(gross_total_amount) FROM inv), 0),
    COALESCE((SELECT SUM(credited_total_amount) FROM inv), 0),
    COALESCE((SELECT SUM(gross_tax_amount) FROM inv), 0),
    COALESCE((SELECT SUM(credited_tax_amount) FROM inv), 0),
    COALESCE((SELECT SUM(signed_tax_amount) FROM inv), 0),
    COALESCE((SELECT SUM(signed_total_amount) FROM inv), 0),
    COALESCE((SELECT SUM(vat_amount) FROM pur), 0),
    COALESCE((SELECT SUM(input_vat_amount) FROM exp), 0)
  INTO
    v_gross_sales,
    v_credit_notes,
    v_vat_on_sales,
    v_vat_credited,
    v_vat_collected,
    v_sales_total,
    v_vat_paid_purchases,
    v_vat_paid_expenses;

  WITH months AS (
    SELECT generate_series(
      date_trunc('month', p_start_date)::date,
      date_trunc('month', p_end_date)::date,
      '1 month'::interval
    )::date AS month_start
  ),
  rows AS (
    SELECT
      to_char(m.month_start, 'YYYY-MM') AS month,
      COALESCE(SUM(i.gross_total_amount), 0) AS gross_sales,
      COALESCE(SUM(i.credited_total_amount), 0) AS credit_notes,
      COALESCE(SUM(i.signed_total_amount), 0) AS sales_amount,
      COALESCE(SUM(i.gross_tax_amount), 0) AS vat_on_sales,
      COALESCE(SUM(i.credited_tax_amount), 0) AS vat_credited,
      COALESCE(SUM(i.signed_tax_amount), 0) AS vat_collected,
      COALESCE((
        SELECT SUM(p.total_amount)
        FROM public.reporting_counted_purchases_v p
        WHERE p.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
          AND p.purchase_date >= m.month_start
          AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
          AND p.is_counted IS TRUE
      ), 0) AS purchase_amount,
      COALESCE((
        SELECT SUM(p.vat_amount)
        FROM public.reporting_counted_purchases_v p
        WHERE p.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
          AND p.purchase_date >= m.month_start
          AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
          AND p.is_counted IS TRUE
      ), 0) AS vat_paid_pur,
      COALESCE((
        SELECT SUM(e.total_paid)
        FROM public.reporting_expenses_v e
        WHERE e.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
          AND e.expense_date >= m.month_start
          AND e.expense_date < (m.month_start + INTERVAL '1 month')::date
      ), 0) AS expense_amount,
      COALESCE((
        SELECT SUM(e.input_vat_amount)
        FROM public.reporting_expenses_v e
        WHERE e.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
          AND e.expense_date >= m.month_start
          AND e.expense_date < (m.month_start + INTERVAL '1 month')::date
      ), 0) AS vat_paid_exp
    FROM months m
    LEFT JOIN public.reporting_invoice_documents_v i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date >= m.month_start
     AND i.invoice_date < (m.month_start + INTERVAL '1 month')::date
     AND i.invoice_date BETWEEN p_start_date AND p_end_date
     AND i.is_counted IS TRUE
    GROUP BY m.month_start
    ORDER BY m.month_start
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', month,
      'grossSales', gross_sales,
      'creditNotes', credit_notes,
      'salesAmount', sales_amount,
      'vatOnSales', vat_on_sales,
      'vatCredited', vat_credited,
      'vatCollected', vat_collected,
      'purchaseAmount', purchase_amount,
      'vatPaidPur', vat_paid_pur,
      'expenseAmount', expense_amount,
      'vatPaidExp', vat_paid_exp,
      'netPayable', vat_collected - vat_paid_pur - vat_paid_exp
    )
    ORDER BY month
  ), '[]'::jsonb)
  INTO v_monthly_rows
  FROM rows;

  RETURN jsonb_build_object(
    'grossSales', v_gross_sales,
    'creditNotes', v_credit_notes,
    'vatOnSales', v_vat_on_sales,
    'vatCredited', v_vat_credited,
    'vatCollected', v_vat_collected,
    'vatPaidTotal', v_vat_paid_purchases + v_vat_paid_expenses,
    'netPayable', v_vat_collected - v_vat_paid_purchases - v_vat_paid_expenses,
    'salesTotal', v_sales_total,
    'monthlyRows', v_monthly_rows,
    'reportLabel', 'VAT Support Report',
    'accountantReviewRequired', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_vat_support_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vat_support_summary(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- Purchase report
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_purchase_report_summary(
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_total_purchased NUMERIC := 0;
  v_total_vat NUMERIC := 0;
  v_supplier_count INTEGER := 0;
  v_by_supplier JSONB := '[]'::jsonb;
  v_top_items JSONB := '[]'::jsonb;
  v_monthly_bars JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH pur AS (
    SELECT *
    FROM public.reporting_counted_purchases_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND purchase_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  )
  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(vat_amount), 0),
    COUNT(DISTINCT supplier_id)::integer
  INTO v_total_purchased, v_total_vat, v_supplier_count
  FROM pur;

  WITH pur AS (
    SELECT p.*, COALESCE(s.name, 'No Supplier') AS supplier_name
    FROM public.reporting_counted_purchases_v p
    LEFT JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE p.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
      AND p.purchase_date BETWEEN p_start_date AND p_end_date
      AND p.is_counted IS TRUE
  ),
  rows AS (
    SELECT
      supplier_name AS name,
      COALESCE(SUM(total_amount), 0) AS total,
      COUNT(*)::integer AS count,
      MAX(purchase_date)::text AS last_date
    FROM pur
    GROUP BY supplier_id, supplier_name
    ORDER BY total DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'total', total, 'count', count, 'lastDate', last_date)
    ORDER BY total DESC
  ), '[]'::jsonb)
  INTO v_by_supplier
  FROM rows;

  WITH pur AS (
    SELECT id
    FROM public.reporting_counted_purchases_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND purchase_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
  ),
  rows AS (
    SELECT
      pi.name,
      COALESCE(SUM(pi.quantity), 0) AS quantity,
      COALESCE(SUM(pi.total), 0) AS total
    FROM pur
    JOIN public.purchase_items pi ON pi.purchase_id = pur.id
    GROUP BY pi.name
    ORDER BY total DESC
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'quantity', quantity, 'total', total)
    ORDER BY total DESC
  ), '[]'::jsonb)
  INTO v_top_items
  FROM rows;

  WITH months AS (
    SELECT generate_series(
      date_trunc('month', p_start_date)::date,
      date_trunc('month', p_end_date)::date,
      '1 month'::interval
    )::date AS month_start
  ),
  rows AS (
    SELECT
      to_char(m.month_start, 'YYYY-MM') AS month,
      COALESCE(SUM(p.total_amount), 0) AS purchases
    FROM months m
    LEFT JOIN public.reporting_counted_purchases_v p
      ON p.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
     AND p.purchase_date >= m.month_start
     AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
     AND p.purchase_date BETWEEN p_start_date AND p_end_date
     AND p.is_counted IS TRUE
    GROUP BY m.month_start
    ORDER BY m.month_start
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('month', month, 'Purchases', purchases)
    ORDER BY month
  ), '[]'::jsonb)
  INTO v_monthly_bars
  FROM rows;

  RETURN jsonb_build_object(
    'totalPurchased', v_total_purchased,
    'totalVat', v_total_vat,
    'supplierCount', v_supplier_count,
    'bySupplier', v_by_supplier,
    'topItems', v_top_items,
    'monthlyBars', v_monthly_bars,
    'countedRule', 'posted simple bills and confirmed receive-stock purchases only'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_purchase_report_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_purchase_report_summary(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- Expense report
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_expense_report_summary(
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_month_count INTEGER := 0;
  v_monthly_fixed NUMERIC := 0;
  v_total_fixed NUMERIC := 0;
  v_total_variable NUMERIC := 0;
  v_cat_bars JSONB := '[]'::jsonb;
  v_log JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT COUNT(*)::integer
    INTO v_month_count
  FROM generate_series(
    date_trunc('month', p_start_date)::date,
    date_trunc('month', p_end_date)::date,
    '1 month'::interval
  );

  SELECT COALESCE(SUM(monthly_amount), 0)
    INTO v_monthly_fixed
  FROM public.fixed_expenses f
  WHERE f.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR f.branch_id = v_scope.scope_branch_id)
    AND f.is_active IS TRUE;

  v_total_fixed := v_monthly_fixed * GREATEST(v_month_count, 0);

  SELECT COALESCE(SUM(total_paid), 0)
    INTO v_total_variable
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN p_start_date AND p_end_date;

  WITH rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS name,
      COALESCE(SUM(e.total_paid), 0) AS value,
      COALESCE(c.color, '#6b7280') AS color
    FROM public.reporting_expenses_v e
    LEFT JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    GROUP BY COALESCE(c.name, 'Uncategorized'), COALESCE(c.color, '#6b7280')
    UNION ALL
    SELECT 'Fixed Costs', v_total_fixed, '#6366f1'
    WHERE v_total_fixed > 0
  ),
  ranked AS (
    SELECT * FROM rows ORDER BY value DESC LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'value', value, 'color', color)
    ORDER BY value DESC
  ), '[]'::jsonb)
  INTO v_cat_bars
  FROM ranked;

  WITH rows AS (
    SELECT
      e.expense_date::text AS date,
      e.description,
      COALESCE(c.name, '—') AS category,
      e.total_paid AS amount,
      e.payment_method AS method
    FROM public.reporting_expenses_v e
    LEFT JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    ORDER BY e.expense_date DESC, e.created_at DESC
    LIMIT 200
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', date,
      'description', description,
      'category', category,
      'amount', amount,
      'method', method
    )
    ORDER BY date DESC
  ), '[]'::jsonb)
  INTO v_log
  FROM rows;

  RETURN jsonb_build_object(
    'totalVariable', v_total_variable,
    'totalFixed', v_total_fixed,
    'grandTotal', v_total_variable + v_total_fixed,
    'catBars', v_cat_bars,
    'log', v_log,
    'monthlyFixed', v_monthly_fixed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_expense_report_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expense_report_summary(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- Simple profit estimate
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_profit_report_summary(
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_month_count INTEGER := 0;
  v_monthly_fixed NUMERIC := 0;
  v_fixed_total NUMERIC := 0;
  v_gross_sales NUMERIC := 0;
  v_credit_notes NUMERIC := 0;
  v_total_revenue NUMERIC := 0;
  v_purchase_costs NUMERIC := 0;
  v_variable_expenses NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_monthly_rows JSONB := '[]'::jsonb;
  v_expense_by_cat JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT COUNT(*)::integer
    INTO v_month_count
  FROM generate_series(
    date_trunc('month', p_start_date)::date,
    date_trunc('month', p_end_date)::date,
    '1 month'::interval
  );

  SELECT COALESCE(SUM(monthly_amount), 0)
    INTO v_monthly_fixed
  FROM public.fixed_expenses f
  WHERE f.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR f.branch_id = v_scope.scope_branch_id)
    AND f.is_active IS TRUE;

  v_fixed_total := v_monthly_fixed * GREATEST(v_month_count, 0);

  SELECT
    COALESCE(SUM(gross_total_amount), 0),
    COALESCE(SUM(credited_total_amount), 0),
    COALESCE(SUM(signed_total_amount), 0)
  INTO v_gross_sales, v_credit_notes, v_total_revenue
  FROM public.reporting_invoice_documents_v i
  WHERE i.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
    AND i.invoice_date BETWEEN p_start_date AND p_end_date
    AND i.is_counted IS TRUE;

  SELECT COALESCE(SUM(subtotal), 0)
    INTO v_purchase_costs
  FROM public.reporting_counted_purchases_v p
  WHERE p.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
    AND p.purchase_date BETWEEN p_start_date AND p_end_date
    AND p.is_counted IS TRUE;

  SELECT COALESCE(SUM(profit_expense_amount), 0)
    INTO v_variable_expenses
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN p_start_date AND p_end_date;

  v_total_expenses := v_variable_expenses + v_fixed_total;

  WITH months AS (
    SELECT generate_series(
      date_trunc('month', p_start_date)::date,
      date_trunc('month', p_end_date)::date,
      '1 month'::interval
    )::date AS month_start
  ),
  rows AS (
    SELECT
      to_char(m.month_start, 'YYYY-MM') AS month,
      COALESCE(SUM(i.gross_total_amount), 0) AS gross_sales,
      COALESCE(SUM(i.credited_total_amount), 0) AS credit_notes,
      COALESCE(SUM(i.signed_total_amount), 0) AS revenue,
      COALESCE((
        SELECT SUM(p.subtotal)
        FROM public.reporting_counted_purchases_v p
        WHERE p.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
          AND p.purchase_date >= m.month_start
          AND p.purchase_date < (m.month_start + INTERVAL '1 month')::date
          AND p.purchase_date BETWEEN p_start_date AND p_end_date
          AND p.is_counted IS TRUE
      ), 0) AS purchase_cost,
      COALESCE((
        SELECT SUM(e.profit_expense_amount)
        FROM public.reporting_expenses_v e
        WHERE e.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
          AND e.expense_date >= m.month_start
          AND e.expense_date < (m.month_start + INTERVAL '1 month')::date
          AND e.expense_date BETWEEN p_start_date AND p_end_date
      ), 0) + v_monthly_fixed AS expenses
    FROM months m
    LEFT JOIN public.reporting_invoice_documents_v i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date >= m.month_start
     AND i.invoice_date < (m.month_start + INTERVAL '1 month')::date
     AND i.invoice_date BETWEEN p_start_date AND p_end_date
     AND i.is_counted IS TRUE
    GROUP BY m.month_start
    ORDER BY m.month_start
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', month,
      'grossSales', gross_sales,
      'creditNotes', credit_notes,
      'revenue', revenue,
      'cogs', purchase_cost,
      'grossProfit', revenue - purchase_cost,
      'expenses', expenses,
      'netProfit', revenue - purchase_cost - expenses
    )
    ORDER BY month
  ), '[]'::jsonb)
  INTO v_monthly_rows
  FROM rows;

  WITH rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS name,
      COALESCE(SUM(e.profit_expense_amount), 0) AS value
    FROM public.reporting_expenses_v e
    LEFT JOIN public.expense_categories c ON c.id = e.category_id
    WHERE e.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
      AND e.expense_date BETWEEN p_start_date AND p_end_date
    GROUP BY COALESCE(c.name, 'Uncategorized')
    UNION ALL
    SELECT 'Fixed Costs', v_fixed_total
    WHERE v_fixed_total > 0
  ),
  ranked AS (
    SELECT * FROM rows ORDER BY value DESC LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', name, 'value', value)
    ORDER BY value DESC
  ), '[]'::jsonb)
  INTO v_expense_by_cat
  FROM ranked;

  RETURN jsonb_build_object(
    'reportLabel', 'Simple Profit Estimate',
    'grossSales', v_gross_sales,
    'creditNotes', v_credit_notes,
    'totalRevenue', v_total_revenue,
    'totalCOGS', v_purchase_costs,
    'grossProfit', v_total_revenue - v_purchase_costs,
    'totalExpenses', v_total_expenses,
    'netProfit', v_total_revenue - v_purchase_costs - v_total_expenses,
    'margin', CASE WHEN v_total_revenue <> 0 THEN ROUND(((v_total_revenue - v_purchase_costs - v_total_expenses) / v_total_revenue) * 100, 2) ELSE 0 END,
    'monthlyRows', v_monthly_rows,
    'expenseByCat', v_expense_by_cat,
    'purchaseCostLabel', 'Purchase-period cost estimate'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_profit_report_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profit_report_summary(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- Customer report
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_customer_report_summary(
  p_start_date DATE,
  p_end_date DATE,
  p_branch_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_total_count INTEGER := 0;
  v_new_this_period INTEGER := 0;
  v_individual_count INTEGER := 0;
  v_business_count INTEGER := 0;
  v_total_revenue NUMERIC := 0;
  v_top_customers JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE c.created_at::date BETWEEN p_start_date AND p_end_date)::integer,
    COUNT(*) FILTER (WHERE COALESCE(c.customer_type, 'individual') = 'individual')::integer,
    COUNT(*) FILTER (WHERE COALESCE(c.customer_type, 'individual') = 'business')::integer
  INTO v_total_count, v_new_this_period, v_individual_count, v_business_count
  FROM public.customers c
  WHERE c.tenant_id = v_scope.scope_tenant_id
    AND c.is_active IS TRUE;

  SELECT COALESCE(SUM(i.signed_total_amount), 0)
    INTO v_total_revenue
  FROM public.reporting_invoice_documents_v i
  WHERE i.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
    AND i.invoice_date BETWEEN p_start_date AND p_end_date
    AND i.is_counted IS TRUE;

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN p_start_date AND p_end_date
      AND is_counted IS TRUE
      AND customer_id IS NOT NULL
  ),
  rows AS (
    SELECT
      c.id,
      COALESCE(c.name, 'Unknown') AS name,
      COALESCE(c.customer_type, 'individual') AS type,
      COALESCE(SUM(inv.signed_total_amount), 0) AS total_spent,
      COUNT(*)::integer AS order_count,
      MAX(inv.invoice_date)::text AS last_purchase
    FROM inv
    JOIN public.customers c ON c.id = inv.customer_id
    GROUP BY c.id, c.name, c.customer_type
    ORDER BY total_spent DESC
    LIMIT 15
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'type', type,
      'totalSpent', total_spent,
      'orderCount', order_count,
      'lastPurchase', last_purchase
    )
    ORDER BY total_spent DESC
  ), '[]'::jsonb)
  INTO v_top_customers
  FROM rows;

  RETURN jsonb_build_object(
    'totalCount', v_total_count,
    'newThisPeriod', v_new_this_period,
    'individualCount', v_individual_count,
    'businessCount', v_business_count,
    'totalRevenue', v_total_revenue,
    'topCustomers', v_top_customers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_report_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_report_summary(DATE, DATE, UUID) TO authenticated;

-- ============================================================
-- Dashboard summary
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(
  p_branch_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_start_date DATE := COALESCE(p_start_date, CURRENT_DATE);
  v_end_date DATE := COALESCE(p_end_date, COALESCE(p_start_date, CURRENT_DATE));
  v_total_sales NUMERIC := 0;
  v_total_count INTEGER := 0;
  v_total_cash NUMERIC := 0;
  v_total_card NUMERIC := 0;
  v_total_vat NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  v_branch_stats JSONB := '[]'::jsonb;
BEGIN
  IF v_start_date > v_end_date THEN
    RAISE EXCEPTION 'Invalid dashboard date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN v_start_date AND v_end_date
      AND is_counted IS TRUE
  )
  SELECT
    COALESCE(SUM(signed_total_amount), 0),
    COUNT(*)::integer,
    COALESCE(SUM(signed_tax_amount), 0)
  INTO v_total_sales, v_total_count, v_total_vat
  FROM inv;

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN v_start_date AND v_end_date
      AND is_counted IS TRUE
  ),
  rows AS (
    SELECT
      COALESCE(p.method::text, inv.payment_method) AS method,
      CASE
        WHEN p.id IS NULL THEN inv.signed_total_amount
        ELSE inv.accounting_sign * COALESCE(p.amount, 0)
      END AS signed_payment_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  )
  SELECT
    COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_payment_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'card' THEN signed_payment_amount ELSE 0 END), 0)
  INTO v_total_cash, v_total_card
  FROM rows;

  SELECT COALESCE(SUM(total_paid), 0)
    INTO v_total_expenses
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN v_start_date AND v_end_date;

  WITH days AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval)::date AS day
  ),
  rows AS (
    SELECT
      d.day::text AS date,
      COALESCE(SUM(i.signed_total_amount), 0) AS sales
    FROM days d
    LEFT JOIN public.reporting_invoice_documents_v i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date = d.day
     AND i.is_counted IS TRUE
    GROUP BY d.day
    ORDER BY d.day
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', date, 'sales', sales)
    ORDER BY date
  ), '[]'::jsonb)
  INTO v_daily_sales
  FROM rows;

  WITH scoped_branches AS (
    SELECT b.*
    FROM public.branches b
    WHERE b.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR b.id = v_scope.scope_branch_id)
  ),
  inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND invoice_date BETWEEN v_start_date AND v_end_date
      AND is_counted IS TRUE
  ),
  payment_totals AS (
    SELECT
      inv.branch_id,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.payment_method) = 'cash'
          THEN CASE
            WHEN p.id IS NULL THEN inv.signed_total_amount
            ELSE inv.accounting_sign * COALESCE(p.amount, 0)
          END
        ELSE 0
      END), 0) AS today_cash,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.payment_method) = 'card'
          THEN CASE
            WHEN p.id IS NULL THEN inv.signed_total_amount
            ELSE inv.accounting_sign * COALESCE(p.amount, 0)
          END
        ELSE 0
      END), 0) AS today_card
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
    GROUP BY inv.branch_id
  ),
  open_sessions AS (
    SELECT branch_id, MIN(opened_at) AS opened_at
    FROM public.pos_sessions
    WHERE tenant_id = v_scope.scope_tenant_id
      AND status = 'open'
    GROUP BY branch_id
  ),
  rows AS (
    SELECT
      b.id,
      b.name,
      b.logo_url,
      b.is_active,
      b.is_main_branch,
      COALESCE(b.zatca_phase, 1) AS zatca_phase,
      COALESCE(SUM(inv.signed_total_amount), 0) AS today_sales,
      COUNT(inv.id)::integer AS today_count,
      COALESCE(pt.today_cash, 0) AS today_cash,
      COALESCE(pt.today_card, 0) AS today_card,
      os.opened_at IS NOT NULL AS session_open,
      os.opened_at AS session_opened_at
    FROM scoped_branches b
    LEFT JOIN inv ON inv.branch_id = b.id
    LEFT JOIN payment_totals pt ON pt.branch_id = b.id
    LEFT JOIN open_sessions os ON os.branch_id = b.id
    GROUP BY b.id, b.name, b.logo_url, b.is_active, b.is_main_branch, b.zatca_phase, pt.today_cash, pt.today_card, os.opened_at
    ORDER BY b.is_main_branch DESC, b.created_at ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'logo_url', logo_url,
      'is_active', is_active,
      'is_main_branch', is_main_branch,
      'zatca_phase', zatca_phase,
      'todaySales', today_sales,
      'todayCount', today_count,
      'todayCash', today_cash,
      'todayCard', today_card,
      'sessionOpen', session_open,
      'sessionOpenedAt', session_opened_at
    )
    ORDER BY is_main_branch DESC, name
  ), '[]'::jsonb)
  INTO v_branch_stats
  FROM rows;

  RETURN jsonb_build_object(
    'totalSales', v_total_sales,
    'totalCount', v_total_count,
    'totalCash', v_total_cash,
    'totalCard', v_total_card,
    'totalVat', v_total_vat,
    'totalExpenses', v_total_expenses,
    'dailySales', v_daily_sales,
    'branchStats', v_branch_stats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_sales_report_summary(DATE, DATE, UUID) IS
  'Safe server-side sales summary using posted invoice documents only; credit notes reduce totals.';
COMMENT ON FUNCTION public.get_vat_support_summary(DATE, DATE, UUID) IS
  'Safe VAT support summary. Excludes pending/reversed purchases and treats existing expense VAT fields as support data, not tax advice.';
COMMENT ON FUNCTION public.get_purchase_report_summary(DATE, DATE, UUID) IS
  'Safe purchase summary using posted simple bills and confirmed receive-stock purchases only.';
COMMENT ON FUNCTION public.get_expense_report_summary(DATE, DATE, UUID) IS
  'Safe expense summary using total_paid as actual cash/bank/card movement.';
COMMENT ON FUNCTION public.get_profit_report_summary(DATE, DATE, UUID) IS
  'Simple profit estimate using net sales, counted purchase subtotal, and expense estimates. Not true inventory COGS.';
COMMENT ON FUNCTION public.get_customer_report_summary(DATE, DATE, UUID) IS
  'Safe customer summary where credit notes reduce customer spend.';
COMMENT ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) IS
  'Safe dashboard summary where cancelled invoices are excluded, credit notes reduce totals, and expenses use total_paid.';

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm RPC privileges:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.get_sales_report_summary(date, date, uuid)', 'EXECUTE') AS can_sales,
--   has_function_privilege('authenticated', 'public.get_vat_support_summary(date, date, uuid)', 'EXECUTE') AS can_vat,
--   has_function_privilege('authenticated', 'public.get_purchase_report_summary(date, date, uuid)', 'EXECUTE') AS can_purchase,
--   has_function_privilege('authenticated', 'public.get_expense_report_summary(date, date, uuid)', 'EXECUTE') AS can_expense,
--   has_function_privilege('authenticated', 'public.get_profit_report_summary(date, date, uuid)', 'EXECUTE') AS can_profit,
--   has_function_privilege('authenticated', 'public.get_customer_report_summary(date, date, uuid)', 'EXECUTE') AS can_customer,
--   has_function_privilege('authenticated', 'public.get_dashboard_summary(uuid, date, date)', 'EXECUTE') AS can_dashboard;
--
-- 2) Confirm internal views are not directly exposed to browser roles:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'reporting_invoice_documents_v',
--     'reporting_counted_purchases_v',
--     'reporting_expenses_v'
--   )
--   AND grantee IN ('anon', 'authenticated')
-- ORDER BY table_name, grantee, privilege_type;
--
-- Expected: zero rows.
--
-- 3) Manual authenticated RPC smoke examples:
--
-- SELECT public.get_sales_report_summary(CURRENT_DATE - 30, CURRENT_DATE, NULL);
-- SELECT public.get_vat_support_summary(CURRENT_DATE - 30, CURRENT_DATE, NULL);
-- SELECT public.get_dashboard_summary(NULL, CURRENT_DATE, CURRENT_DATE);
