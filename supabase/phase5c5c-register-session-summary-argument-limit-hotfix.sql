-- ============================================================
-- Phase 5C-5C hotfix: Register Session summary JSON argument limit
-- Apply manually after phase5c5b-register-session-rpc-availability-hotfix.sql.
-- ============================================================
--
-- Goals:
--   - Fix PostgreSQL error 54023:
--     "cannot pass more than 100 arguments to a function".
--   - Keep Register Session RPC signatures and business rules unchanged.
--   - Keep frontend JSON compatibility.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not disable or weaken RLS/security.

BEGIN;

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
      -- Keep every jsonb_build_object under PostgreSQL's 100-argument limit.
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
        'longOpenHours', long_open_hours
      )
      ||
      jsonb_build_object(
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
        'expectedCash', expected_cash
      )
      ||
      jsonb_build_object(
        'actual_cash', closing_cash_actual,
        'actualCash', closing_cash_actual,
        'cash_difference',
          CASE WHEN closing_cash_actual IS NULL THEN NULL ELSE closing_cash_actual - expected_cash END,
        'cashDifference',
          CASE WHEN closing_cash_actual IS NULL THEN NULL ELSE closing_cash_actual - expected_cash END,
        'opening_cash', opening_cash,
        'openingCash', opening_cash,
        'closing_checks', COALESCE(closing_checks, '{}'::jsonb),
        'closingChecks', COALESCE(closing_checks, '{}'::jsonb)
      )
      ||
      jsonb_build_object(
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

COMMENT ON FUNCTION public.get_register_session_summary(UUID, UUID) IS
  'Phase 5C-5C fixed Register Session summary RPC. Summary JSON is built in smaller jsonb_build_object blocks to avoid PostgreSQL 100-argument limit.';

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
--   'public.get_register_session_summary(uuid, uuid)',
--   'EXECUTE'
-- ) AS can_summary;
--
-- Expected: true.
--
-- 2) Branch no-session smoke in authenticated branch context:
--
-- SELECT public.get_register_session_summary('<branch-id>'::uuid, NULL);
--
-- Expected:
--   ok=true; session object exists with branch metadata and session_id may be
--   null when no open or closed register session exists.
--
-- 3) Branch current/last session smoke:
--
-- SELECT public.get_register_session_summary('<branch-id>'::uuid, NULL);
--
-- Expected:
--   Current open session is returned when one exists; otherwise last closed
--   session is returned. No 54023 error should occur.
