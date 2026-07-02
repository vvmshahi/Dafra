-- ============================================================
-- Phase 5C-5A: Register Session reporting foundation
-- Apply manually after phase5c3a-dashboard-kpi-pipeline-hotfix.sql.
-- ============================================================
--
-- Goals:
--   - Keep calendar/date reports unchanged.
--   - Add server-side Register Session summaries based on actual
--     Open Register / Close Register sessions.
--   - Prevent duplicate open sessions per branch.
--   - Move open/close register writes behind narrow SECURITY DEFINER RPCs.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not disable RLS.

BEGIN;

ALTER TABLE public.pos_sessions
  ADD COLUMN IF NOT EXISTS closing_checks JSONB;

-- Fail with a clear instruction instead of silently choosing one open session.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.pos_sessions
    WHERE status = 'open'
    GROUP BY branch_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate open register sessions exist. Review the verification query at the bottom of this patch, close or merge duplicates manually, then re-run Phase 5C-5A.'
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pos_sessions_one_open_per_branch_idx
  ON public.pos_sessions (branch_id)
  WHERE status = 'open';

-- ============================================================
-- Register session summary RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_register_session_summary(
  p_branch_id UUID DEFAULT NULL,
  p_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_session_branch_id UUID;
  v_branch_summaries JSONB := '[]'::jsonb;
  v_session JSONB := NULL;
  v_long_open_threshold_hours NUMERIC := 18;
BEGIN
  IF p_session_id IS NOT NULL THEN
    SELECT branch_id
      INTO v_session_branch_id
    FROM public.pos_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Register session not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_scope
  FROM public.reporting_resolve_scope(COALESCE(p_branch_id, v_session_branch_id));

  WITH candidate_branches AS (
    SELECT b.id, b.tenant_id, b.name, b.logo_url, b.is_active, b.is_main_branch, b.created_at
    FROM public.branches b
    WHERE b.tenant_id = v_scope.scope_tenant_id
      AND b.is_active IS TRUE
      AND (
        CASE
          WHEN p_session_id IS NOT NULL THEN b.id = v_session_branch_id
          WHEN v_scope.scope_branch_id IS NOT NULL THEN b.id = v_scope.scope_branch_id
          ELSE TRUE
        END
      )
  ),
  selected_sessions AS (
    SELECT
      b.id AS branch_id,
      b.tenant_id,
      b.name AS branch_name,
      b.logo_url,
      b.is_main_branch,
      b.created_at AS branch_created_at,
      s.id AS session_id,
      s.opened_at,
      s.closed_at,
      s.opening_cash,
      s.closing_cash_actual,
      s.closing_cash_difference,
      s.status,
      s.closing_checks,
      CASE WHEN s.status = 'open' THEN TRUE ELSE FALSE END AS is_current_session,
      CASE WHEN s.status = 'closed' AND p_session_id IS NULL THEN TRUE ELSE FALSE END AS is_last_session
    FROM candidate_branches b
    LEFT JOIN LATERAL (
      SELECT ps.*
      FROM public.pos_sessions ps
      WHERE ps.tenant_id = b.tenant_id
        AND ps.branch_id = b.id
        AND (p_session_id IS NULL OR ps.id = p_session_id)
      ORDER BY
        CASE
          WHEN p_session_id IS NOT NULL THEN 0
          WHEN ps.status = 'open' THEN 0
          ELSE 1
        END,
        CASE
          WHEN ps.status = 'open' THEN ps.opened_at
          ELSE COALESCE(ps.closed_at, ps.opened_at)
        END DESC
      LIMIT 1
    ) s ON TRUE
    WHERE p_session_id IS NULL OR s.id = p_session_id
  ),
  inv AS (
    SELECT
      s.session_id,
      i.id,
      i.invoice_number,
      i.customer_id,
      i.invoice_date,
      i.created_at,
      i.status::text AS status,
      i.zatca_invoice_type::text AS document_type,
      COALESCE(i.payment_method::text, 'other') AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount,
      COALESCE(i.tax_amount, 0) AS tax_amount
    FROM selected_sessions s
    JOIN public.invoices i ON i.session_id = s.session_id
    WHERE i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  invoice_totals AS (
    SELECT
      session_id,
      COALESCE(SUM(accounting_sign * total_amount), 0) AS total_sales,
      COUNT(*)::integer AS invoice_count,
      COALESCE(SUM(accounting_sign * tax_amount), 0) AS vat_total,
      COALESCE(SUM(CASE WHEN document_type = 'credit_note' THEN total_amount ELSE 0 END), 0) AS credit_note_total
    FROM inv
    GROUP BY session_id
  ),
  payment_rows AS (
    SELECT
      inv.session_id,
      COALESCE(p.method::text, inv.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
        ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
      END AS signed_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  ),
  payment_totals AS (
    SELECT
      session_id,
      COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_amount ELSE 0 END), 0) AS cash_total,
      COALESCE(SUM(CASE WHEN method = 'card' THEN signed_amount ELSE 0 END), 0) AS card_total,
      COALESCE(SUM(CASE WHEN method = 'bank_transfer' THEN signed_amount ELSE 0 END), 0) AS bank_transfer_total,
      COALESCE(SUM(CASE WHEN method NOT IN ('cash', 'card', 'bank_transfer') THEN signed_amount ELSE 0 END), 0) AS other_total
    FROM payment_rows
    GROUP BY session_id
  ),
  expense_totals AS (
    SELECT
      s.session_id,
      COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0) AS expenses_total,
      COALESCE(SUM(CASE WHEN e.payment_method::text = 'cash' THEN COALESCE(e.total_paid, e.amount, 0) ELSE 0 END), 0) AS cash_expenses
    FROM selected_sessions s
    LEFT JOIN public.expenses e ON e.session_id = s.session_id
    GROUP BY s.session_id
  ),
  rows AS (
    SELECT
      s.branch_id,
      s.branch_name,
      s.logo_url,
      s.is_main_branch,
      s.branch_created_at,
      s.session_id,
      s.status,
      s.opened_at,
      s.closed_at,
      COALESCE(s.opening_cash, 0) AS opening_cash,
      s.closing_cash_actual,
      s.closing_checks,
      s.is_current_session,
      s.is_last_session,
      (
        s.status = 'open'
        AND s.opened_at IS NOT NULL
        AND s.opened_at < NOW() - (v_long_open_threshold_hours || ' hours')::interval
      ) AS is_long_open,
      CASE
        WHEN s.status = 'open' AND s.opened_at IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM (NOW() - s.opened_at)) / 3600.0, 1)
        ELSE NULL
      END AS long_open_hours,
      COALESCE(it.total_sales, 0) AS total_sales,
      COALESCE(it.invoice_count, 0) AS invoice_count,
      COALESCE(it.credit_note_total, 0) AS credit_note_total,
      COALESCE(it.vat_total, 0) AS vat_total,
      COALESCE(pt.cash_total, 0) AS cash_total,
      COALESCE(pt.card_total, 0) AS card_total,
      COALESCE(pt.bank_transfer_total, 0) AS bank_transfer_total,
      COALESCE(pt.other_total, 0) AS other_total,
      COALESCE(et.expenses_total, 0) AS expenses_total,
      COALESCE(et.cash_expenses, 0) AS cash_expenses,
      COALESCE(s.opening_cash, 0) + COALESCE(pt.cash_total, 0) - COALESCE(et.cash_expenses, 0) AS expected_cash
    FROM selected_sessions s
    LEFT JOIN invoice_totals it ON it.session_id = s.session_id
    LEFT JOIN payment_totals pt ON pt.session_id = s.session_id
    LEFT JOIN expense_totals et ON et.session_id = s.session_id
  ),
  summaries AS (
    SELECT
      jsonb_build_object(
        'session_id', session_id,
        'sessionId', session_id,
        'branch_id', branch_id,
        'branchId', branch_id,
        'branch_name', branch_name,
        'branchName', branch_name,
        'logo_url', logo_url,
        'logoUrl', logo_url,
        'status', status,
        'opened_at', opened_at,
        'openedAt', opened_at,
        'closed_at', closed_at,
        'closedAt', closed_at,
        'is_current_session', is_current_session,
        'isCurrentSession', is_current_session,
        'is_last_session', is_last_session,
        'isLastSession', is_last_session,
        'is_long_open', is_long_open,
        'isLongOpen', is_long_open,
        'long_open_hours', long_open_hours,
        'longOpenHours', long_open_hours,
        'total_sales', total_sales,
        'totalSales', total_sales,
        'invoice_count', invoice_count,
        'invoiceCount', invoice_count,
        'credit_note_total', credit_note_total,
        'creditNoteTotal', credit_note_total,
        'cash_total', cash_total,
        'cashTotal', cash_total,
        'card_total', card_total,
        'cardTotal', card_total,
        'other_total', other_total,
        'otherTotal', other_total,
        'bank_transfer_total', bank_transfer_total,
        'bankTransferTotal', bank_transfer_total,
        'vat_total', vat_total,
        'vatTotal', vat_total,
        'expenses_total', expenses_total,
        'expensesTotal', expenses_total,
        'cash_expenses', cash_expenses,
        'cashExpenses', cash_expenses,
        'expected_cash', expected_cash,
        'expectedCash', expected_cash,
        'actual_cash', closing_cash_actual,
        'actualCash', closing_cash_actual,
        'cash_difference',
          CASE WHEN closing_cash_actual IS NULL THEN NULL ELSE closing_cash_actual - expected_cash END,
        'cashDifference',
          CASE WHEN closing_cash_actual IS NULL THEN NULL ELSE closing_cash_actual - expected_cash END,
        'opening_cash', opening_cash,
        'openingCash', opening_cash,
        'closing_checks', COALESCE(closing_checks, '{}'::jsonb),
        'closingChecks', COALESCE(closing_checks, '{}'::jsonb),
        'recent_invoices', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', recent.id,
              'invoice_number', recent.invoice_number,
              'invoiceNumber', recent.invoice_number,
              'customer_name', recent.customer_name,
              'customerName', recent.customer_name,
              'total_amount', recent.total_amount,
              'totalAmount', recent.total_amount,
              'display_total', recent.display_total,
              'displayTotal', recent.display_total,
              'status', recent.status,
              'invoice_date', recent.invoice_date,
              'invoiceDate', recent.invoice_date,
              'document_type', recent.document_type,
              'documentType', recent.document_type,
              'created_at', recent.created_at,
              'createdAt', recent.created_at
            )
            ORDER BY recent.created_at DESC
          )
          FROM (
            SELECT
              i.id,
              i.invoice_number,
              COALESCE(c.name, 'Walk-in Customer') AS customer_name,
              COALESCE(i.total_amount, 0) AS total_amount,
              CASE
                WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 * COALESCE(i.total_amount, 0)
                ELSE COALESCE(i.total_amount, 0)
              END AS display_total,
              i.status::text AS status,
              i.invoice_date,
              i.zatca_invoice_type::text AS document_type,
              i.created_at
            FROM public.invoices i
            LEFT JOIN public.customers c ON c.id = i.customer_id
            WHERE i.session_id = rows.session_id
              AND i.status::text = 'posted'
              AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
            ORDER BY i.created_at DESC
            LIMIT 6
          ) recent
        ), '[]'::jsonb),
        'recentInvoices', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', recent.id,
              'invoiceNumber', recent.invoice_number,
              'customerName', recent.customer_name,
              'totalAmount', recent.total_amount,
              'displayTotal', recent.display_total,
              'status', recent.status,
              'invoiceDate', recent.invoice_date,
              'documentType', recent.document_type,
              'createdAt', recent.created_at
            )
            ORDER BY recent.created_at DESC
          )
          FROM (
            SELECT
              i.id,
              i.invoice_number,
              COALESCE(c.name, 'Walk-in Customer') AS customer_name,
              COALESCE(i.total_amount, 0) AS total_amount,
              CASE
                WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 * COALESCE(i.total_amount, 0)
                ELSE COALESCE(i.total_amount, 0)
              END AS display_total,
              i.status::text AS status,
              i.invoice_date,
              i.zatca_invoice_type::text AS document_type,
              i.created_at
            FROM public.invoices i
            LEFT JOIN public.customers c ON c.id = i.customer_id
            WHERE i.session_id = rows.session_id
              AND i.status::text = 'posted'
              AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
            ORDER BY i.created_at DESC
            LIMIT 6
          ) recent
        ), '[]'::jsonb)
      ) AS summary,
      is_main_branch,
      branch_created_at,
      branch_name
    FROM rows
  )
  SELECT COALESCE(jsonb_agg(summary ORDER BY is_main_branch DESC, branch_created_at ASC, branch_name), '[]'::jsonb)
    INTO v_branch_summaries
  FROM summaries;

  IF jsonb_array_length(v_branch_summaries) = 1 THEN
    v_session := v_branch_summaries -> 0;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'long_open_threshold_hours', v_long_open_threshold_hours,
    'longOpenThresholdHours', v_long_open_threshold_hours,
    'session', v_session,
    'branch_summaries', v_branch_summaries,
    'branchSummaries', v_branch_summaries
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_register_session_summary(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_session_summary(UUID, UUID) TO authenticated;

-- ============================================================
-- Register session list RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_register_sessions(
  p_branch_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_row RECORD;
  v_sessions JSONB := '[]'::jsonb;
  v_summary JSONB;
BEGIN
  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  FOR v_row IN
    SELECT s.id
    FROM public.pos_sessions s
    WHERE s.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR s.branch_id = v_scope.scope_branch_id)
    ORDER BY
      CASE WHEN s.status = 'open' THEN 0 ELSE 1 END,
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

REVOKE ALL ON FUNCTION public.get_register_sessions(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_register_sessions(UUID, INTEGER) TO authenticated;

-- ============================================================
-- Server-side open/close register RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.open_register_session(
  p_branch_id UUID,
  p_opening_cash NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_scope RECORD;
  v_existing RECORD;
  v_session_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_opening_cash, 0) < 0 THEN
    RAISE EXCEPTION 'Opening cash cannot be negative' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  IF v_scope.scope_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, opened_at
    INTO v_existing
  FROM public.pos_sessions
  WHERE tenant_id = v_scope.scope_tenant_id
    AND branch_id = v_scope.scope_branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Register is already open for this branch since %', v_existing.opened_at
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.pos_sessions (
    tenant_id,
    branch_id,
    opened_by,
    opening_cash,
    status
  ) VALUES (
    v_scope.scope_tenant_id,
    v_scope.scope_branch_id,
    v_user_id,
    ROUND(COALESCE(p_opening_cash, 0), 2),
    'open'
  )
  RETURNING id INTO v_session_id;

  RETURN public.get_register_session_summary(v_scope.scope_branch_id, v_session_id) -> 'session';
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Register is already open for this branch. Close the existing register before opening a new one.'
      USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.open_register_session(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_register_session(UUID, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_register_session(
  p_session_id UUID,
  p_actual_cash NUMERIC,
  p_closing_checks JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT *
    INTO v_session
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

  WITH inv AS (
    SELECT
      i.id,
      COALESCE(i.payment_method::text, 'other') AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.session_id = v_session.id
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  payment_rows AS (
    SELECT
      COALESCE(p.method::text, inv.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
        ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
      END AS signed_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0) AS total_expenses,
      COALESCE(SUM(CASE WHEN e.payment_method::text = 'cash' THEN COALESCE(e.total_paid, e.amount, 0) ELSE 0 END), 0) AS cash_expenses
    FROM public.expenses e
    WHERE e.session_id = v_session.id
  )
  SELECT
    COALESCE((SELECT COUNT(*)::integer FROM inv), 0),
    COALESCE((SELECT SUM(CASE WHEN method = 'cash' THEN signed_amount ELSE 0 END) FROM payment_rows), 0),
    COALESCE((SELECT SUM(CASE WHEN method = 'card' THEN signed_amount ELSE 0 END) FROM payment_rows), 0),
    COALESCE(exp.total_expenses, 0),
    COALESCE(exp.cash_expenses, 0)
  INTO
    v_invoice_count,
    v_cash_total,
    v_card_total,
    v_total_expenses,
    v_cash_expenses
  FROM exp;

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

COMMENT ON FUNCTION public.get_register_session_summary(UUID, UUID) IS
  'Returns Current Register Session or Last Register Session summaries using session_id-linked invoices, payments, and expenses.';
COMMENT ON FUNCTION public.get_register_sessions(UUID, INTEGER) IS
  'Lists Register Sessions for the caller scope with server-calculated totals.';
COMMENT ON FUNCTION public.open_register_session(UUID, NUMERIC) IS
  'Opens one Register Session per branch and blocks duplicate open sessions.';
COMMENT ON FUNCTION public.close_register_session(UUID, NUMERIC, JSONB, TEXT) IS
  'Closes a Register Session with server-side expected cash recalculation.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Duplicate-open preflight:
--
-- SELECT branch_id, COUNT(*) AS open_sessions, ARRAY_AGG(id ORDER BY opened_at) AS session_ids
-- FROM public.pos_sessions
-- WHERE status = 'open'
-- GROUP BY branch_id
-- HAVING COUNT(*) > 1;
--
-- Expected before applying: no rows. If rows appear, manually review/close
-- duplicate sessions before applying this patch.
--
-- 2) Confirm callable RPCs:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.get_register_session_summary(uuid, uuid)', 'EXECUTE') AS can_summary,
--   has_function_privilege('authenticated', 'public.get_register_sessions(uuid, integer)', 'EXECUTE') AS can_list,
--   has_function_privilege('authenticated', 'public.open_register_session(uuid, numeric)', 'EXECUTE') AS can_open,
--   has_function_privilege('authenticated', 'public.close_register_session(uuid, numeric, jsonb, text)', 'EXECUTE') AS can_close;
--
-- 3) Branch summary smoke:
--
-- SELECT public.get_register_session_summary('<branch-id>'::uuid, NULL);
--
-- Expected: session is current open session if one exists, otherwise last closed
-- session. Session totals use invoices.session_id and expenses.session_id.
--
-- 4) Tenant dashboard smoke in owner/admin context:
--
-- SELECT public.get_register_session_summary(NULL, NULL);
--
-- Expected: branchSummaries contains active tenant branches with current/last
-- register session data.
--
-- 5) Register sessions report smoke:
--
-- SELECT public.get_register_sessions('<branch-id>'::uuid, 20);
--
-- 6) Close math check after closing a test session:
--
-- Expected cash = opening_cash + net cash payments - POS cash expenses.
-- Credit-note cash payments should reduce net cash payments because the credit
-- note invoice type applies a negative sign.
