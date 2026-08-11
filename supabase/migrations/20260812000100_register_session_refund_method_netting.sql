-- Keep register/session tender totals tied to the actual refund payout method.
-- This routine-only patch makes completed payment_refunds authoritative for
-- credit notes. It deliberately does not change invoices, stock, VAT, ZATCA,
-- numbering, payment storage, or presentation labels.

BEGIN;

-- One shared tender calculation for register sessions and daily dashboard
-- summaries. Sales retain their recorded tender bucket. For a credit note with
-- completed payment_refunds, those payout rows replace the mirrored payments
-- rows so an allocation is never counted twice. Card and bank-transfer payout
-- refunds both reduce the register's non-cash/card bucket; cash payouts reduce
-- cash only. Credit notes without a completed refund row keep the previous
-- payment-row fallback for historical compatibility.
CREATE OR REPLACE FUNCTION public.get_register_tender_netting(
  p_invoice_ids UUID[]
)
RETURNS TABLE (
  branch_id UUID,
  session_id UUID,
  gross_cash_sales NUMERIC,
  cash_refund_total NUMERIC,
  net_cash_sales NUMERIC,
  gross_card_sales NUMERIC,
  noncash_refund_total NUMERIC,
  net_card_sales NUMERIC,
  bank_transfer_total NUMERIC,
  other_total NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(array_length(p_invoice_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH invoice_scope AS (
    SELECT
      i.id,
      i.branch_id,
      i.session_id,
      i.zatca_invoice_type::text AS document_type,
      COALESCE(i.payment_method::text, 'other') AS invoice_payment_method,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.id = ANY (p_invoice_ids)
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  sale_payment_events AS (
    SELECT
      i.branch_id,
      i.session_id,
      COALESCE(p.method::text, i.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN ABS(i.total_amount)
        ELSE ABS(COALESCE(p.amount, 0))
      END AS signed_amount,
      'sale'::text AS event_kind
    FROM invoice_scope i
    LEFT JOIN public.payments p ON p.invoice_id = i.id
    WHERE i.document_type IN ('simplified', 'standard')
  ),
  recorded_refund_events AS (
    SELECT
      i.branch_id,
      i.session_id,
      r.method::text AS method,
      -ABS(COALESCE(r.amount, 0)) AS signed_amount,
      'refund'::text AS event_kind
    FROM invoice_scope i
    JOIN public.payment_refunds r ON r.credit_note_invoice_id = i.id
    WHERE i.document_type = 'credit_note'
      AND r.status = 'completed'
  ),
  legacy_credit_payment_events AS (
    SELECT
      i.branch_id,
      i.session_id,
      COALESCE(p.method::text, i.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN -ABS(i.total_amount)
        ELSE -ABS(COALESCE(p.amount, 0))
      END AS signed_amount,
      'refund'::text AS event_kind
    FROM invoice_scope i
    LEFT JOIN public.payments p ON p.invoice_id = i.id
    WHERE i.document_type = 'credit_note'
      AND NOT EXISTS (
        SELECT 1
        FROM public.payment_refunds r
        WHERE r.credit_note_invoice_id = i.id
          AND r.status = 'completed'
      )
  ),
  tender_events AS (
    SELECT * FROM sale_payment_events
    UNION ALL
    SELECT * FROM recorded_refund_events
    UNION ALL
    SELECT * FROM legacy_credit_payment_events
  )
  SELECT
    e.branch_id,
    e.session_id,
    ROUND(COALESCE(SUM(CASE
      WHEN e.event_kind = 'sale' AND e.method = 'cash' THEN e.signed_amount
      ELSE 0
    END), 0), 2) AS gross_cash_sales,
    ROUND(COALESCE(SUM(CASE
      WHEN e.event_kind = 'refund' AND e.method = 'cash' THEN ABS(e.signed_amount)
      ELSE 0
    END), 0), 2) AS cash_refund_total,
    ROUND(COALESCE(SUM(CASE
      WHEN e.method = 'cash' THEN e.signed_amount
      ELSE 0
    END), 0), 2) AS net_cash_sales,
    ROUND(COALESCE(SUM(CASE
      WHEN e.event_kind = 'sale' AND e.method = 'card' THEN e.signed_amount
      ELSE 0
    END), 0), 2) AS gross_card_sales,
    ROUND(COALESCE(SUM(CASE
      WHEN e.event_kind = 'refund' AND e.method IN ('card', 'bank_transfer') THEN ABS(e.signed_amount)
      ELSE 0
    END), 0), 2) AS noncash_refund_total,
    ROUND(COALESCE(SUM(CASE
      WHEN (e.event_kind = 'sale' AND e.method = 'card')
        OR (e.event_kind = 'refund' AND e.method IN ('card', 'bank_transfer'))
        THEN e.signed_amount
      ELSE 0
    END), 0), 2) AS net_card_sales,
    ROUND(COALESCE(SUM(CASE
      WHEN e.event_kind = 'sale' AND e.method = 'bank_transfer' THEN e.signed_amount
      ELSE 0
    END), 0), 2) AS bank_transfer_total,
    ROUND(COALESCE(SUM(CASE
      WHEN e.method NOT IN ('cash', 'card', 'bank_transfer') THEN e.signed_amount
      ELSE 0
    END), 0), 2) AS other_total
  FROM tender_events e
  GROUP BY e.branch_id, e.session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_register_tender_netting(UUID[]) FROM PUBLIC, anon, authenticated, service_role;

-- Keep the proven summary shape and all of its authorization checks. The
-- replacement only overlays tender values with the shared payout-aware result.
ALTER FUNCTION public.get_register_session_summary(UUID, UUID)
  RENAME TO get_register_session_summary_before_refund_netting;

CREATE FUNCTION public.get_register_session_summary(
  p_branch_id UUID DEFAULT NULL,
  p_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_legacy JSONB;
  v_branch_summaries JSONB := '[]'::jsonb;
  v_session JSONB := NULL;
BEGIN
  v_legacy := public.get_register_session_summary_before_refund_netting(p_branch_id, p_session_id);

  WITH legacy_branches AS (
    SELECT branch_summary, position
    FROM jsonb_array_elements(COALESCE(v_legacy -> 'branch_summaries', '[]'::jsonb))
      WITH ORDINALITY AS summaries(branch_summary, position)
  ),
  repaired AS (
    SELECT
      lb.position,
      lb.branch_summary || jsonb_build_object(
        'cash_total', COALESCE(n.net_cash_sales, 0),
        'cashTotal', COALESCE(n.net_cash_sales, 0),
        'card_total', COALESCE(n.net_card_sales, 0),
        'cardTotal', COALESCE(n.net_card_sales, 0),
        'bank_transfer_total', COALESCE(n.bank_transfer_total, 0),
        'bankTransferTotal', COALESCE(n.bank_transfer_total, 0),
        'other_total', COALESCE(n.other_total, 0),
        'otherTotal', COALESCE(n.other_total, 0),
        'gross_cash_sales', COALESCE(n.gross_cash_sales, 0),
        'grossCashSales', COALESCE(n.gross_cash_sales, 0),
        'cash_refund_total', COALESCE(n.cash_refund_total, 0),
        'cashRefundTotal', COALESCE(n.cash_refund_total, 0),
        'gross_card_sales', COALESCE(n.gross_card_sales, 0),
        'grossCardSales', COALESCE(n.gross_card_sales, 0),
        'noncash_refund_total', COALESCE(n.noncash_refund_total, 0),
        'noncashRefundTotal', COALESCE(n.noncash_refund_total, 0),
        'expected_cash', ROUND(
          COALESCE((lb.branch_summary ->> 'opening_cash')::numeric, 0)
          + COALESCE(n.net_cash_sales, 0)
          - COALESCE((lb.branch_summary ->> 'cash_expenses')::numeric, 0),
          2
        ),
        'expectedCash', ROUND(
          COALESCE((lb.branch_summary ->> 'opening_cash')::numeric, 0)
          + COALESCE(n.net_cash_sales, 0)
          - COALESCE((lb.branch_summary ->> 'cash_expenses')::numeric, 0),
          2
        ),
        'cash_difference', CASE
          WHEN lb.branch_summary ->> 'actual_cash' IS NULL THEN NULL
          ELSE ROUND(
            (lb.branch_summary ->> 'actual_cash')::numeric
            - (
              COALESCE((lb.branch_summary ->> 'opening_cash')::numeric, 0)
              + COALESCE(n.net_cash_sales, 0)
              - COALESCE((lb.branch_summary ->> 'cash_expenses')::numeric, 0)
            ),
            2
          )
        END,
        'cashDifference', CASE
          WHEN lb.branch_summary ->> 'actual_cash' IS NULL THEN NULL
          ELSE ROUND(
            (lb.branch_summary ->> 'actual_cash')::numeric
            - (
              COALESCE((lb.branch_summary ->> 'opening_cash')::numeric, 0)
              + COALESCE(n.net_cash_sales, 0)
              - COALESCE((lb.branch_summary ->> 'cash_expenses')::numeric, 0)
            ),
            2
          )
        END
      ) AS summary
    FROM legacy_branches lb
    LEFT JOIN LATERAL public.get_register_tender_netting(
      ARRAY(
        SELECT i.id
        FROM public.invoices i
        WHERE i.session_id = NULLIF(lb.branch_summary ->> 'session_id', '')::uuid
          AND i.status::text = 'posted'
          AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
      )
    ) AS n ON TRUE
  )
  SELECT COALESCE(jsonb_agg(summary ORDER BY position), '[]'::jsonb)
    INTO v_branch_summaries
  FROM repaired;

  IF jsonb_array_length(v_branch_summaries) = 1 THEN
    v_session := v_branch_summaries -> 0;
  END IF;

  RETURN (v_legacy - 'session' - 'branch_summaries' - 'branchSummaries')
    || jsonb_build_object(
      'session', v_session,
      'branch_summaries', v_branch_summaries,
      'branchSummaries', v_branch_summaries
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_register_session_summary_before_refund_netting(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_register_session_summary(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_session_summary(UUID, UUID) TO authenticated;

-- Recalculate and store the corrected totals at close time. This remains the
-- existing close workflow and validation contract; only tender netting changes.
CREATE OR REPLACE FUNCTION public.close_register_session(
  p_session_id UUID,
  p_actual_cash NUMERIC,
  p_closing_checks JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_scope RECORD;
  v_session RECORD;
  v_cash_total NUMERIC := 0;
  v_card_total NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_cash_expenses NUMERIC := 0;
  v_invoice_count INTEGER := 0;
  v_expected_cash NUMERIC := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Register session is required' USING ERRCODE = '22023';
  END IF;

  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Actual cash must be zero or greater' USING ERRCODE = '22023';
  END IF;

  IF p_closing_checks IS NOT NULL AND jsonb_typeof(p_closing_checks) <> 'object' THEN
    RAISE EXCEPTION 'Closing checks must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.pos_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register session not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(v_session.branch_id);

  IF v_session.tenant_id IS DISTINCT FROM v_scope.scope_tenant_id
     OR v_session.branch_id IS DISTINCT FROM v_scope.scope_branch_id
  THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Register session is already closed' USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::integer
    INTO v_invoice_count
  FROM public.invoices i
  WHERE i.session_id = v_session.id
    AND i.status::text = 'posted'
    AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note');

  SELECT
    COALESCE(SUM(n.net_cash_sales), 0),
    COALESCE(SUM(n.net_card_sales), 0)
  INTO v_cash_total, v_card_total
  FROM public.get_register_tender_netting(
    ARRAY(
      SELECT i.id
      FROM public.invoices i
      WHERE i.session_id = v_session.id
        AND i.status::text = 'posted'
        AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
    )
  ) AS n;

  SELECT
    COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0),
    COALESCE(SUM(CASE WHEN e.payment_method::text = 'cash'
      THEN COALESCE(e.total_paid, e.amount, 0) ELSE 0 END), 0)
  INTO v_total_expenses, v_cash_expenses
  FROM public.expenses e
  WHERE e.session_id = v_session.id;

  v_expected_cash := ROUND(COALESCE(v_session.opening_cash, 0) + v_cash_total - v_cash_expenses, 2);

  UPDATE public.pos_sessions
  SET
    closed_by = v_user_id,
    closed_at = NOW(),
    closing_cash_expected = v_expected_cash,
    closing_cash_actual = ROUND(p_actual_cash, 2),
    closing_cash_difference = ROUND(p_actual_cash, 2) - v_expected_cash,
    total_cash_sales = ROUND(v_cash_total, 2),
    total_card_sales = ROUND(v_card_total, 2),
    total_expenses = ROUND(v_total_expenses, 2),
    total_invoices = v_invoice_count,
    closing_checks = COALESCE(p_closing_checks, '{}'::jsonb),
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    status = 'closed'
  WHERE id = v_session.id;

  RETURN public.get_register_session_summary(v_session.branch_id, v_session.id) -> 'session';
END;
$$;

REVOKE ALL ON FUNCTION public.close_register_session(UUID, NUMERIC, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_register_session(UUID, NUMERIC, JSONB, TEXT) TO authenticated;

-- Dashboard and day-close cards use the same tender contract for the selected
-- invoice date range, while preserving every other existing dashboard field.
ALTER FUNCTION public.get_dashboard_summary(UUID, DATE, DATE)
  RENAME TO get_dashboard_summary_before_refund_netting;

CREATE FUNCTION public.get_dashboard_summary(
  p_branch_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scope RECORD;
  v_start_date DATE := COALESCE(p_start_date, CURRENT_DATE);
  v_end_date DATE := COALESCE(p_end_date, COALESCE(p_start_date, CURRENT_DATE));
  v_legacy JSONB;
  v_total_cash NUMERIC := 0;
  v_total_card NUMERIC := 0;
  v_branch_stats JSONB := '[]'::jsonb;
BEGIN
  v_legacy := public.get_dashboard_summary_before_refund_netting(p_branch_id, p_start_date, p_end_date);
  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  SELECT
    COALESCE(SUM(n.net_cash_sales), 0),
    COALESCE(SUM(n.net_card_sales), 0)
  INTO v_total_cash, v_total_card
  FROM public.get_register_tender_netting(
    ARRAY(
      SELECT i.id
      FROM public.invoices i
      WHERE i.tenant_id = v_scope.scope_tenant_id
        AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
        AND i.invoice_date BETWEEN v_start_date AND v_end_date
        AND i.status::text = 'posted'
        AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
    )
  ) AS n;

  WITH netting_by_branch AS (
    SELECT
      n.branch_id,
      COALESCE(SUM(n.net_cash_sales), 0) AS cash_total,
      COALESCE(SUM(n.net_card_sales), 0) AS card_total
    FROM public.get_register_tender_netting(
      ARRAY(
        SELECT i.id
        FROM public.invoices i
        WHERE i.tenant_id = v_scope.scope_tenant_id
          AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
          AND i.invoice_date BETWEEN v_start_date AND v_end_date
          AND i.status::text = 'posted'
          AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
      )
    ) AS n
    GROUP BY n.branch_id
  ),
  legacy_branches AS (
    SELECT branch_summary, position
    FROM jsonb_array_elements(COALESCE(v_legacy -> 'branch_stats', '[]'::jsonb))
      WITH ORDINALITY AS summaries(branch_summary, position)
  )
  SELECT COALESCE(jsonb_agg(
    lb.branch_summary || jsonb_build_object(
      'todayCash', COALESCE(nbb.cash_total, 0),
      'cash_total', COALESCE(nbb.cash_total, 0),
      'todayCard', COALESCE(nbb.card_total, 0),
      'card_total', COALESCE(nbb.card_total, 0)
    )
    ORDER BY lb.position
  ), '[]'::jsonb)
  INTO v_branch_stats
  FROM legacy_branches lb
  LEFT JOIN netting_by_branch nbb
    ON nbb.branch_id = NULLIF(lb.branch_summary ->> 'id', '')::uuid;

  RETURN (v_legacy - 'totalCash' - 'cash_total' - 'totalCard' - 'card_total' - 'branchStats' - 'branch_stats')
    || jsonb_build_object(
      'totalCash', ROUND(v_total_cash, 2),
      'cash_total', ROUND(v_total_cash, 2),
      'totalCard', ROUND(v_total_card, 2),
      'card_total', ROUND(v_total_card, 2),
      'branchStats', v_branch_stats,
      'branch_stats', v_branch_stats
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary_before_refund_netting(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_register_tender_netting(UUID[]) IS
  'Shared register tender aggregation. Completed payment_refunds are authoritative; cash refunds net cash and card/bank-transfer refunds net the card bucket.';
COMMENT ON FUNCTION public.get_register_session_summary(UUID, UUID) IS
  'Register Session summary with payout-method-aware refund netting.';
COMMENT ON FUNCTION public.close_register_session(UUID, NUMERIC, JSONB, TEXT) IS
  'Closes a Register Session using payout-method-aware tender netting.';
COMMENT ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) IS
  'Dashboard KPI summary with the same payout-method-aware tender netting as Register Sessions.';

NOTIFY pgrst, 'reload schema';

COMMIT;
