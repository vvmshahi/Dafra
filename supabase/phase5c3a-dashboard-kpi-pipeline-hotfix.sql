-- ============================================================
-- Phase 5C-3A hotfix: dashboard KPI pipeline repair
-- Apply manually after phase5c3-dashboard-and-credit-note-hotfix.sql.
-- ============================================================
--
-- Goals:
--   - Keep the existing get_dashboard_summary(uuid, date, date) RPC signature.
--   - Repair owner and branch dashboard KPI cards with direct base-table
--     aggregation instead of the reporting view pipeline.
--   - Return both existing camelCase keys and stable snake_case keys.
--   - Keep recent invoices on the existing narrow RPC.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not disable RLS.

BEGIN;

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
    SELECT
      i.id,
      i.branch_id,
      i.payment_method::text AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount,
      COALESCE(i.tax_amount, 0) AS tax_amount
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  )
  SELECT
    COALESCE(SUM(accounting_sign * total_amount), 0),
    COUNT(*)::integer,
    COALESCE(SUM(accounting_sign * tax_amount), 0)
  INTO v_total_sales, v_total_count, v_total_vat
  FROM inv;

  WITH inv AS (
    SELECT
      i.id,
      i.payment_method::text AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  payment_rows AS (
    SELECT
      COALESCE(p.method::text, inv.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
        ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
      END AS signed_payment_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  )
  SELECT
    COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_payment_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'card' THEN signed_payment_amount ELSE 0 END), 0)
  INTO v_total_cash, v_total_card
  FROM payment_rows;

  SELECT COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0)
    INTO v_total_expenses
  FROM public.expenses e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN v_start_date AND v_end_date;

  WITH days AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval)::date AS day
  ),
  rows AS (
    SELECT
      d.day::text AS report_date,
      COALESCE(SUM(
        CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END
        * COALESCE(i.total_amount, 0)
      ), 0) AS sales_amount
    FROM days d
    LEFT JOIN public.invoices i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date = d.day
     AND i.status::text = 'posted'
     AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
    GROUP BY d.day
    ORDER BY d.day
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', report_date,
      'sales', sales_amount,
      'report_date', report_date,
      'sales_amount', sales_amount
    )
    ORDER BY report_date
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
    SELECT
      i.id,
      i.branch_id,
      i.payment_method::text AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  branch_invoice_totals AS (
    SELECT
      branch_id,
      COALESCE(SUM(accounting_sign * total_amount), 0) AS today_sales,
      COUNT(*)::integer AS invoice_count
    FROM inv
    GROUP BY branch_id
  ),
  branch_payment_totals AS (
    SELECT
      inv.branch_id,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.invoice_payment_method, 'other') = 'cash'
          THEN CASE
            WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
            ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
          END
        ELSE 0
      END), 0) AS cash_total,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.invoice_payment_method, 'other') = 'card'
          THEN CASE
            WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
            ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
          END
        ELSE 0
      END), 0) AS card_total
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
  production_status AS (
    SELECT DISTINCT ON (branch_id)
      branch_id,
      onboarding_status,
      connected_at,
      disconnected_at,
      updated_at
    FROM public.zatca_production_credentials
    WHERE tenant_id = v_scope.scope_tenant_id
      AND environment = 'production'
    ORDER BY branch_id, updated_at DESC NULLS LAST
  ),
  rows AS (
    SELECT
      b.id AS branch_id,
      b.name AS branch_name,
      b.logo_url,
      b.is_active,
      b.is_main_branch,
      COALESCE(b.zatca_phase, 1) AS zatca_phase,
      COALESCE(bit.today_sales, 0) AS today_sales,
      COALESCE(bit.invoice_count, 0) AS invoice_count,
      COALESCE(bpt.cash_total, 0) AS cash_total,
      COALESCE(bpt.card_total, 0) AS card_total,
      os.opened_at IS NOT NULL AS session_open,
      os.opened_at AS session_opened_at,
      CASE
        WHEN COALESCE(b.zatca_phase, 1) >= 2 THEN jsonb_build_object(
          'ok', COALESCE(ps.onboarding_status = 'production_connected', FALSE),
          'branchId', b.id,
          'branch_id', b.id,
          'environment', 'production',
          'onboardingStatus', COALESCE(ps.onboarding_status, 'not_started'),
          'onboarding_status', COALESCE(ps.onboarding_status, 'not_started'),
          'connectedAt', ps.connected_at,
          'connected_at', ps.connected_at,
          'disconnectedAt', ps.disconnected_at,
          'disconnected_at', ps.disconnected_at,
          'updatedAt', ps.updated_at,
          'updated_at', ps.updated_at
        )
        ELSE NULL
      END AS production_status
    FROM scoped_branches b
    LEFT JOIN branch_invoice_totals bit ON bit.branch_id = b.id
    LEFT JOIN branch_payment_totals bpt ON bpt.branch_id = b.id
    LEFT JOIN open_sessions os ON os.branch_id = b.id
    LEFT JOIN production_status ps ON ps.branch_id = b.id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', branch_id,
      'branch_id', branch_id,
      'name', branch_name,
      'branch_name', branch_name,
      'logo_url', logo_url,
      'is_active', is_active,
      'is_main_branch', is_main_branch,
      'zatca_phase', zatca_phase,
      'todaySales', today_sales,
      'today_sales', today_sales,
      'todayCount', invoice_count,
      'invoice_count', invoice_count,
      'todayCash', cash_total,
      'cash_total', cash_total,
      'todayCard', card_total,
      'card_total', card_total,
      'sessionOpen', session_open,
      'session_open', session_open,
      'sessionOpenedAt', session_opened_at,
      'session_opened_at', session_opened_at,
      'metricsAvailable', TRUE,
      'metrics_available', TRUE,
      'productionStatusReadable', TRUE,
      'production_status_readable', TRUE,
      'productionStatus', production_status,
      'production_status', production_status
    )
    ORDER BY is_main_branch DESC, branch_name
  ), '[]'::jsonb)
  INTO v_branch_stats
  FROM rows;

  RETURN jsonb_build_object(
    'totalSales', v_total_sales,
    'total_sales', v_total_sales,
    'totalCount', v_total_count,
    'total_invoices', v_total_count,
    'totalCash', v_total_cash,
    'cash_total', v_total_cash,
    'totalCard', v_total_card,
    'card_total', v_total_card,
    'totalVat', v_total_vat,
    'vat_collected', v_total_vat,
    'totalExpenses', v_total_expenses,
    'expenses_total', v_total_expenses,
    'dailySales', v_daily_sales,
    'daily_sales', v_daily_sales,
    'branchStats', v_branch_stats,
    'branch_stats', v_branch_stats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) IS
  'Dashboard KPI summary using direct posted invoice/payment/expense aggregation. Credit notes are signed negative; payment rows use ABS(amount) with invoice sign to avoid double-negative reversals.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm callable RPC:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.get_dashboard_summary(uuid, date, date)',
--   'EXECUTE'
-- ) AS can_dashboard;
--
-- 2) Smoke test in an authenticated owner/admin request context:
--
-- SELECT public.get_dashboard_summary(NULL, CURRENT_DATE, CURRENT_DATE);
--
-- 3) Smoke test in an authenticated branch request context:
--
-- SELECT public.get_dashboard_summary('<branch-id>'::uuid, CURRENT_DATE, CURRENT_DATE);
--
-- 4) Compare direct branch totals for one branch/date:
--
-- WITH inv AS (
--   SELECT *,
--     CASE WHEN zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS sign
--   FROM public.invoices
--   WHERE branch_id = '<branch-id>'::uuid
--     AND invoice_date = CURRENT_DATE
--     AND status::text = 'posted'
-- )
-- SELECT
--   SUM(sign * total_amount) AS sales,
--   COUNT(*) AS invoices,
--   SUM(sign * tax_amount) AS vat
-- FROM inv;
--
-- 5) Compare direct payment totals for one branch/date:
--
-- WITH inv AS (
--   SELECT id,
--     CASE WHEN zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS sign
--   FROM public.invoices
--   WHERE branch_id = '<branch-id>'::uuid
--     AND invoice_date = CURRENT_DATE
--     AND status::text = 'posted'
-- )
-- SELECT
--   SUM(CASE WHEN p.method::text = 'cash' THEN inv.sign * ABS(p.amount) ELSE 0 END) AS cash,
--   SUM(CASE WHEN p.method::text = 'card' THEN inv.sign * ABS(p.amount) ELSE 0 END) AS card
-- FROM inv
-- JOIN public.payments p ON p.invoice_id = inv.id;
