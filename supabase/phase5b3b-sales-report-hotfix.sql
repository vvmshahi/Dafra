-- ============================================================
-- Phase 5B-3B sales report hotfix
-- Apply manually after the Phase 5B-3B reporting foundation and later
-- reporting hotfixes.
-- ============================================================
--
-- Goals:
--   - Fix Sales Report RPC load failures without changing other reports.
--   - Keep posted invoices positive and posted credit notes negative.
--   - Exclude cancelled/non-posted invoices.
--   - Keep invoice_date inclusive range filtering.
--   - Do not filter accounting totals by ZATCA submission status.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data.
--   - Do not call ZATCA.
--   - Do not modify ZATCA XML/signing/hash/QR/canonicalization.

BEGIN;

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
  v_recent_invoices JSONB := '[]'::jsonb;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid report date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT
    COALESCE(SUM(i.gross_total_amount), 0),
    COALESCE(SUM(i.credited_total_amount), 0),
    COALESCE(SUM(i.signed_total_amount), 0),
    COALESCE(SUM(i.gross_tax_amount), 0),
    COALESCE(SUM(i.credited_tax_amount), 0),
    COALESCE(SUM(i.signed_tax_amount), 0),
    COUNT(*)::integer
  INTO
    v_gross_sales,
    v_credit_notes,
    v_total_revenue,
    v_vat_on_sales,
    v_vat_credited,
    v_vat_collected,
    v_invoice_count
  FROM public.reporting_invoice_documents_v AS i
  WHERE i.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
    AND i.invoice_date BETWEEN p_start_date AND p_end_date
    AND i.is_counted IS TRUE;

  WITH daily_rows AS (
    SELECT
      i.invoice_date::text AS report_date,
      COALESCE(SUM(i.signed_total_amount), 0) AS revenue_amount,
      COUNT(*)::integer AS invoice_total
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
    GROUP BY i.invoice_date
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', daily_rows.report_date,
      'revenue', daily_rows.revenue_amount,
      'invoices', daily_rows.invoice_total
    )
    ORDER BY daily_rows.report_date
  ), '[]'::jsonb)
  INTO v_daily_sales
  FROM daily_rows;

  WITH inv_doc AS (
    SELECT
      i.id AS invoice_id,
      i.accounting_sign,
      COALESCE(i.payment_method, 'cash') AS invoice_payment_method,
      i.signed_total_amount
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  payment_rows AS (
    SELECT
      COALESCE(pay.method::text, inv_doc.invoice_payment_method, 'cash') AS method_key,
      CASE
        WHEN pay.id IS NULL THEN inv_doc.signed_total_amount
        ELSE inv_doc.accounting_sign * COALESCE(pay.amount, 0)
      END AS signed_payment_amount
    FROM inv_doc
    LEFT JOIN public.payments AS pay
      ON pay.invoice_id = inv_doc.invoice_id
  ),
  method_rows AS (
    SELECT
      CASE payment_rows.method_key
        WHEN 'cash' THEN 'Cash'
        WHEN 'card' THEN 'Card'
        WHEN 'bank_transfer' THEN 'Bank Transfer'
        ELSE INITCAP(COALESCE(payment_rows.method_key, 'other'))
      END AS method_name,
      COALESCE(SUM(payment_rows.signed_payment_amount), 0) AS method_value
    FROM payment_rows
    GROUP BY payment_rows.method_key
    HAVING COALESCE(SUM(payment_rows.signed_payment_amount), 0) <> 0
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('name', method_rows.method_name, 'value', method_rows.method_value)
    ORDER BY method_rows.method_value DESC, method_rows.method_name
  ), '[]'::jsonb)
  INTO v_by_method
  FROM method_rows;

  WITH inv_doc AS (
    SELECT
      i.id AS invoice_id,
      i.tenant_id,
      i.accounting_sign
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  product_rows AS (
    SELECT
      COALESCE(NULLIF(TRIM(ii.name), ''), 'Unknown item') AS item_name,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.quantity, 0)), 0) AS quantity_sold,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.total, 0)), 0) AS revenue_amount
    FROM inv_doc
    JOIN public.invoice_items AS ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
    GROUP BY COALESCE(NULLIF(TRIM(ii.name), ''), 'Unknown item')
    ORDER BY revenue_amount DESC, item_name
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', product_rows.item_name,
      'quantity', product_rows.quantity_sold,
      'revenue', product_rows.revenue_amount,
      'pct', CASE
        WHEN v_total_revenue <> 0 THEN ROUND((product_rows.revenue_amount / v_total_revenue) * 100, 2)
        ELSE 0
      END
    )
    ORDER BY product_rows.revenue_amount DESC, product_rows.item_name
  ), '[]'::jsonb)
  INTO v_top_products
  FROM product_rows;

  WITH inv_doc AS (
    SELECT
      i.id AS invoice_id,
      i.tenant_id,
      i.accounting_sign
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  category_rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS category_name,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.quantity, 0)), 0) AS item_count,
      COALESCE(SUM(inv_doc.accounting_sign * COALESCE(ii.total, 0)), 0) AS revenue_amount
    FROM inv_doc
    JOIN public.invoice_items AS ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
    LEFT JOIN public.products AS pr
      ON pr.id = ii.product_id
     AND pr.tenant_id = inv_doc.tenant_id
    LEFT JOIN public.categories AS c
      ON c.id = pr.category_id
    GROUP BY COALESCE(c.name, 'Uncategorized')
    ORDER BY revenue_amount DESC, category_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', category_rows.category_name,
      'items', category_rows.item_count,
      'revenue', category_rows.revenue_amount,
      'pct', CASE
        WHEN v_total_revenue <> 0 THEN ROUND((category_rows.revenue_amount / v_total_revenue) * 100, 2)
        ELSE 0
      END
    )
    ORDER BY category_rows.revenue_amount DESC, category_rows.category_name
  ), '[]'::jsonb)
  INTO v_cat_performance
  FROM category_rows;

  WITH recent_rows AS (
    SELECT
      i.invoice_number,
      i.zatca_invoice_type,
      i.invoice_date::text AS invoice_date_text,
      i.signed_total_amount,
      i.signed_tax_amount
    FROM public.reporting_invoice_documents_v AS i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
    ORDER BY i.invoice_date DESC, i.created_at DESC, i.invoice_number DESC
    LIMIT 20
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'invoiceNumber', recent_rows.invoice_number,
      'type', recent_rows.zatca_invoice_type,
      'date', recent_rows.invoice_date_text,
      'total', recent_rows.signed_total_amount,
      'vat', recent_rows.signed_tax_amount
    )
    ORDER BY recent_rows.invoice_date_text DESC, recent_rows.invoice_number DESC
  ), '[]'::jsonb)
  INTO v_recent_invoices
  FROM recent_rows;

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
    'paymentBreakdown', v_by_method,
    'topProducts', v_top_products,
    'catPerformance', v_cat_performance,
    'categoryBreakdown', v_cat_performance,
    'recentInvoices', v_recent_invoices
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_report_summary(DATE, DATE, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary(DATE, DATE, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- SQL Editor note:
--   SELECT auth.uid();
--   In Supabase SQL Editor this is normally NULL, so direct RPC calls that
--   depend on auth.uid() are expected to raise Unauthorized unless an
--   authenticated request context is provided.
--
-- 1) Confirm the browser-facing function grant:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.get_sales_report_summary(date, date, uuid)',
--   'EXECUTE'
-- ) AS can_sales_report;
--
-- Expected: true.
--
-- 2) Authenticated app/RPC smoke test:
--
-- SELECT public.get_sales_report_summary(
--   '2026-07-01'::date,
--   '2026-07-01'::date,
--   '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
-- );
--
-- Expected in an authenticated request context:
--   - JSON object returns successfully.
--   - INV-0018 contributes positive totals.
--   - INV-CN-0010 contributes negative signed totals.
