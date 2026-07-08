-- ============================================================
-- Phase Reports-B2: Date Filters and Supplier Purchase Totals
-- Apply manually after Phase 5B reporting and Phase 5C register sessions.
-- ============================================================
--
-- Goals:
--   - Add server-side date filtering for register session reports.
--   - Add supplier purchase totals using counted purchase reporting rules.
--   - Preserve POS, purchase receiving, stock, invoice, VAT, and ZATCA logic.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data directly.

BEGIN;

-- ============================================================
-- Date-aware Register Sessions list RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_register_sessions_filtered(
  p_branch_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 80,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 80), 1), 200);
  v_has_date_filter BOOLEAN := p_start_date IS NOT NULL OR p_end_date IS NOT NULL;
  v_row RECORD;
  v_sessions JSONB := '[]'::jsonb;
  v_summary JSONB;
BEGIN
  IF (p_start_date IS NULL) <> (p_end_date IS NULL)
     OR (p_start_date IS NOT NULL AND p_start_date > p_end_date)
  THEN
    RAISE EXCEPTION 'Invalid register session date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  FOR v_row IN
    SELECT s.id
    FROM public.pos_sessions s
    WHERE s.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR s.branch_id = v_scope.scope_branch_id)
      AND (
        v_has_date_filter IS FALSE
        OR (
          ((COALESCE(s.closed_at, s.opened_at) AT TIME ZONE 'Asia/Riyadh')::date)
            BETWEEN p_start_date AND p_end_date
        )
      )
    ORDER BY
      CASE WHEN v_has_date_filter IS FALSE AND s.status = 'open' THEN 0 ELSE 1 END,
      COALESCE(s.closed_at, s.opened_at) DESC
    LIMIT v_limit
  LOOP
    v_summary := public.get_register_session_summary(NULL, v_row.id) -> 'session';
    IF v_summary IS NOT NULL THEN
      v_sessions := v_sessions || jsonb_build_array(v_summary);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sessions', v_sessions,
    'register_sessions', v_sessions,
    'registerSessions', v_sessions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_register_sessions_filtered(UUID, INTEGER, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_sessions_filtered(UUID, INTEGER, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_register_sessions_filtered(UUID, INTEGER, DATE, DATE) IS
  'Lists register session summaries with optional server-side date filtering before LIMIT is applied.';

-- ============================================================
-- Supplier purchase totals for date-filtered branch Suppliers UI
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_supplier_purchase_totals(
  p_branch_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_rows JSONB := '[]'::jsonb;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required for supplier purchase totals' USING ERRCODE = '22023';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Invalid supplier purchase date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH rows AS (
    SELECT
      p.supplier_id,
      COUNT(*)::integer AS purchase_count,
      COALESCE(SUM(p.total_amount), 0) AS total_purchased,
      COALESCE(SUM(p.vat_amount), 0) AS total_vat,
      MAX(p.purchase_date)::text AS last_purchase_date
    FROM public.reporting_counted_purchases_v p
    WHERE p.tenant_id = v_scope.scope_tenant_id
      AND p.branch_id = v_scope.scope_branch_id
      AND p.purchase_date BETWEEN p_start_date AND p_end_date
      AND p.is_counted IS TRUE
      AND p.supplier_id IS NOT NULL
    GROUP BY p.supplier_id
    ORDER BY total_purchased DESC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'supplier_id', supplier_id,
      'supplierId', supplier_id,
      'purchase_count', purchase_count,
      'purchaseCount', purchase_count,
      'total_purchased', total_purchased,
      'totalPurchased', total_purchased,
      'total_vat', total_vat,
      'totalVat', total_vat,
      'last_purchase_date', last_purchase_date,
      'lastPurchaseDate', last_purchase_date
    )
    ORDER BY total_purchased DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM rows;

  RETURN jsonb_build_object(
    'ok', true,
    'supplier_totals', v_rows,
    'supplierTotals', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_purchase_totals(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_supplier_purchase_totals(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_supplier_purchase_totals(UUID, DATE, DATE) IS
  'Returns per-supplier purchase totals for one branch and date range using counted purchase reporting rules.';

NOTIFY pgrst, 'reload schema';

COMMIT;
