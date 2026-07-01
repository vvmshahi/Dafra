-- ============================================================
-- Phase 5C-3 hotfix: dashboard data recovery + credit note refund accounting
-- Apply manually after phase5c2b-dashboard-and-split-settings-hotfix.sql and
-- phase5b3d-business-type-reporting-mode.sql.
-- ============================================================
--
-- Goals:
--   - Keep dashboard totals on server-side reporting semantics.
--   - Add a branch-dashboard recent invoices RPC instead of fragile browser joins.
--   - Preserve ZATCA production status as safe summary metadata only.
--   - Make full credit note refunds follow original payment rows, including
--     split cash/card payments.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not disable RLS.

BEGIN;

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
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
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
      os.opened_at AS session_opened_at,
      CASE
        WHEN COALESCE(b.zatca_phase, 1) >= 2 THEN jsonb_build_object(
          'ok', COALESCE(ps.onboarding_status = 'production_connected', FALSE),
          'branchId', b.id,
          'environment', 'production',
          'onboardingStatus', COALESCE(ps.onboarding_status, 'not_started'),
          'connectedAt', ps.connected_at,
          'disconnectedAt', ps.disconnected_at,
          'updatedAt', ps.updated_at
        )
        ELSE NULL
      END AS production_status
    FROM scoped_branches b
    LEFT JOIN inv ON inv.branch_id = b.id
    LEFT JOIN payment_totals pt ON pt.branch_id = b.id
    LEFT JOIN open_sessions os ON os.branch_id = b.id
    LEFT JOIN production_status ps ON ps.branch_id = b.id
    GROUP BY
      b.id,
      b.name,
      b.logo_url,
      b.is_active,
      b.is_main_branch,
      b.zatca_phase,
      pt.today_cash,
      pt.today_card,
      os.opened_at,
      ps.onboarding_status,
      ps.connected_at,
      ps.disconnected_at,
      ps.updated_at
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
      'sessionOpenedAt', session_opened_at,
      'metricsAvailable', TRUE,
      'productionStatusReadable', TRUE,
      'productionStatus', production_status
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

-- ============================================================
-- Branch dashboard recent invoices
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_branch_dashboard_recent_invoices(
  p_branch_id UUID,
  p_limit INTEGER DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 6), 1), 50);
  v_rows JSONB := '[]'::jsonb;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  IF v_scope.scope_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '42501';
  END IF;

  WITH rows AS (
    SELECT
      i.id,
      i.invoice_number,
      COALESCE(c.name, 'Walk-in Customer') AS customer_name,
      i.total_amount,
      CASE
        WHEN i.zatca_invoice_type::text = 'credit_note'
          THEN -1 * COALESCE(i.total_amount, 0)
        ELSE COALESCE(i.total_amount, 0)
      END AS display_total,
      i.status::text AS status,
      i.invoice_date,
      i.zatca_invoice_type::text AS document_type,
      i.created_at
    FROM public.invoices i
    LEFT JOIN public.customers c ON c.id = i.customer_id
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.branch_id = v_scope.scope_branch_id
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
    ORDER BY i.created_at DESC
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'invoiceNumber', invoice_number,
      'customerName', customer_name,
      'totalAmount', total_amount,
      'displayTotal', display_total,
      'status', status,
      'invoiceDate', invoice_date,
      'documentType', document_type,
      'createdAt', created_at
    )
    ORDER BY created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM rows;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_branch_dashboard_recent_invoices(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_dashboard_recent_invoices(UUID, INTEGER) TO authenticated;

-- ============================================================
-- Credit note refund source preservation
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.create_full_credit_note_unchecked(jsonb)') IS NULL
     AND to_regprocedure('public.create_full_credit_note(jsonb)') IS NOT NULL
  THEN
    ALTER FUNCTION public.create_full_credit_note(JSONB)
      RENAME TO create_full_credit_note_unchecked;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_full_credit_note_unchecked(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_original RECORD;
  v_existing RECORD;
  v_line RECORD;
  v_payment RECORD;
  v_branch_prefix TEXT;
  v_counter BIGINT;
  v_credit_note_id UUID := pg_catalog.gen_random_uuid();
  v_credit_note_number TEXT;
  v_original_invoice_id UUID;
  v_idempotency_key TEXT;
  v_reason TEXT;
  v_invoice_refund_method TEXT := 'other';
  v_payment_count INTEGER := 0;
  v_distinct_payment_methods INTEGER := 0;
  v_return_stock BOOLEAN := FALSE;
  v_open_session_id UUID;
  v_credit_payment_id UUID;
  v_created_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid credit note payload' USING ERRCODE = '22023';
  END IF;

  v_original_invoice_id := NULLIF(TRIM(COALESCE(p_payload ->> 'original_invoice_id', '')), '')::uuid;
  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  v_reason := NULLIF(TRIM(COALESCE(p_payload ->> 'reason', '')), '');
  v_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, FALSE);

  IF v_original_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Missing original invoice' USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
     OR length(v_idempotency_key) < 8
     OR length(v_idempotency_key) > 120
  THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'Credit note reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
         i.zatca_invoice_type::text AS zatca_invoice_type,
         i.zatca_status::text AS zatca_status,
         i.status::text AS status,
         i.payment_status::text AS payment_status,
         i.payment_method::text AS payment_method,
         i.subtotal, i.discount_amount, i.taxable_amount, i.tax_amount,
         i.total_amount, i.currency_code, b.invoice_prefix, b.is_active AS branch_is_active
    INTO v_original
  FROM public.invoices i
  JOIN public.branches b ON b.id = i.branch_id
  WHERE i.id = v_original_invoice_id
  FOR UPDATE OF i;

  IF NOT FOUND OR v_original.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Original invoice not found or branch inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_original.branch_id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_original.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_original.zatca_invoice_type NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'Only original invoices can be credited' USING ERRCODE = '22023';
  END IF;

  IF v_original.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted invoices can be credited' USING ERRCODE = '23514';
  END IF;

  IF v_original.zatca_status NOT IN ('reported', 'cleared') THEN
    RAISE EXCEPTION 'Only reported or cleared invoices can be credited' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_original.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Original invoice total must be greater than zero' USING ERRCODE = '23514';
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(DISTINCT method)::integer,
    CASE WHEN COUNT(DISTINCT method) = 1 THEN MIN(method::text) ELSE 'other' END
    INTO v_payment_count, v_distinct_payment_methods, v_invoice_refund_method
  FROM public.payments
  WHERE invoice_id = v_original.id
    AND COALESCE(amount, 0) > 0;

  IF v_payment_count = 0 THEN
    v_invoice_refund_method := 'other';
  END IF;

  IF v_invoice_refund_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
    v_invoice_refund_method := 'other';
  END IF;

  SELECT id
    INTO v_open_session_id
  FROM public.pos_sessions
  WHERE tenant_id = v_original.tenant_id
    AND branch_id = v_original.branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  PERFORM pg_advisory_xact_lock(hashtextextended('full-credit-note:' || v_original.id::text, 0));

  SELECT id, invoice_number, created_at, total_amount, zatca_status, payment_status
    INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_original.branch_id
    AND credit_note_idempotency_key = v_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'credit_note_invoice_id', v_existing.id,
      'credit_note_invoice_number', v_existing.invoice_number,
      'created_at', v_existing.created_at,
      'total', v_existing.total_amount,
      'refund_status', 'completed',
      'zatca_status', v_existing.zatca_status,
      'refund_method', v_invoice_refund_method,
      'idempotent_replay', true
    );
  END IF;

  SELECT id, invoice_number, created_at, total_amount, zatca_status, payment_status
    INTO v_existing
  FROM public.invoices
  WHERE original_invoice_id = v_original.id
    AND zatca_invoice_type = 'credit_note'
    AND status <> 'cancelled'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Invoice has already been fully credited' USING ERRCODE = '23514';
  END IF;

  v_counter := public.get_next_credit_note_counter(v_original.branch_id);
  v_branch_prefix := COALESCE(NULLIF(TRIM(v_original.invoice_prefix), ''), 'INV');
  v_credit_note_number := v_branch_prefix || '-CN-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');

  INSERT INTO public.invoices (
    id,
    tenant_id,
    branch_id,
    customer_id,
    created_by,
    session_id,
    invoice_number,
    invoice_reference,
    original_invoice_id,
    credit_reason,
    credit_note_idempotency_key,
    zatca_invoice_type,
    zatca_type_code,
    zatca_status,
    subtotal,
    discount_amount,
    taxable_amount,
    tax_amount,
    total_amount,
    currency_code,
    invoice_date,
    payment_method,
    status,
    payment_status,
    notes,
    created_at
  ) VALUES (
    v_credit_note_id,
    v_original.tenant_id,
    v_original.branch_id,
    v_original.customer_id,
    v_user_id,
    v_open_session_id,
    v_credit_note_number,
    v_original.invoice_number,
    v_original.id,
    v_reason,
    v_idempotency_key,
    'credit_note',
    '381',
    'pending',
    v_original.subtotal,
    v_original.discount_amount,
    v_original.taxable_amount,
    v_original.tax_amount,
    v_original.total_amount,
    COALESCE(v_original.currency_code, 'SAR'),
    (v_created_at AT TIME ZONE 'Asia/Riyadh')::date,
    v_invoice_refund_method::public.payment_method,
    'posted',
    'refunded',
    v_reason,
    v_created_at
  );

  FOR v_line IN
    SELECT oi.*, p.track_stock, p.is_service
    FROM public.invoice_items oi
    LEFT JOIN public.products p
      ON p.id = oi.product_id
     AND p.tenant_id = v_original.tenant_id
     AND p.branch_id = v_original.branch_id
    WHERE oi.invoice_id = v_original.id
    ORDER BY oi.sort_order, oi.created_at, oi.id
  LOOP
    INSERT INTO public.invoice_items (
      invoice_id,
      tenant_id,
      product_id,
      original_invoice_item_id,
      name,
      name_ar,
      description,
      sku,
      unit,
      quantity,
      unit_price,
      discount_percent,
      discount_amount,
      subtotal,
      tax_rate,
      tax_category,
      tax_amount,
      total,
      sort_order
    ) VALUES (
      v_credit_note_id,
      v_original.tenant_id,
      v_line.product_id,
      v_line.id,
      v_line.name,
      v_line.name_ar,
      v_line.description,
      v_line.sku,
      v_line.unit,
      v_line.quantity,
      v_line.unit_price,
      v_line.discount_percent,
      v_line.discount_amount,
      v_line.subtotal,
      v_line.tax_rate,
      v_line.tax_category,
      v_line.tax_amount,
      v_line.total,
      v_line.sort_order
    );

    IF v_return_stock IS TRUE
       AND v_line.product_id IS NOT NULL
       AND COALESCE(v_line.track_stock, FALSE) IS TRUE
       AND COALESCE(v_line.is_service, FALSE) IS FALSE
    THEN
      UPDATE public.products
      SET stock_quantity = COALESCE(stock_quantity, 0) + v_line.quantity
      WHERE id = v_line.product_id
        AND tenant_id = v_original.tenant_id
        AND branch_id = v_original.branch_id;

      INSERT INTO public.pos_stock_movements (
        tenant_id,
        branch_id,
        product_id,
        invoice_id,
        quantity_delta,
        reason,
        created_by
      ) VALUES (
        v_original.tenant_id,
        v_original.branch_id,
        v_line.product_id,
        v_credit_note_id,
        v_line.quantity,
        'refund_return',
        v_user_id
      );
    END IF;
  END LOOP;

  IF v_payment_count > 0 THEN
    FOR v_payment IN
      SELECT id, method::text AS method, amount
      FROM public.payments
      WHERE invoice_id = v_original.id
        AND COALESCE(amount, 0) > 0
      ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
    LOOP
      INSERT INTO public.payments (
        tenant_id,
        invoice_id,
        recorded_by,
        amount,
        amount_received,
        change_amount,
        method,
        notes,
        paid_at
      ) VALUES (
        v_original.tenant_id,
        v_credit_note_id,
        v_user_id,
        v_payment.amount,
        NULL,
        0,
        v_payment.method::public.payment_method,
        'Credit note refund reversal',
        v_created_at
      )
      RETURNING id INTO v_credit_payment_id;

      INSERT INTO public.payment_refunds (
        tenant_id,
        branch_id,
        original_invoice_id,
        credit_note_invoice_id,
        payment_id,
        method,
        amount,
        reason,
        status,
        created_by,
        created_at
      ) VALUES (
        v_original.tenant_id,
        v_original.branch_id,
        v_original.id,
        v_credit_note_id,
        v_payment.id,
        v_payment.method::public.payment_method,
        v_payment.amount,
        v_reason,
        'completed',
        v_user_id,
        v_created_at
      );
    END LOOP;
  ELSE
    INSERT INTO public.payments (
      tenant_id,
      invoice_id,
      recorded_by,
      amount,
      amount_received,
      change_amount,
      method,
      notes,
      paid_at
    ) VALUES (
      v_original.tenant_id,
      v_credit_note_id,
      v_user_id,
      v_original.total_amount,
      NULL,
      0,
      'other',
      'Credit note refund reversal; original payment details unavailable',
      v_created_at
    )
    RETURNING id INTO v_credit_payment_id;

    INSERT INTO public.payment_refunds (
      tenant_id,
      branch_id,
      original_invoice_id,
      credit_note_invoice_id,
      payment_id,
      method,
      amount,
      reason,
      status,
      created_by,
      created_at
    ) VALUES (
      v_original.tenant_id,
      v_original.branch_id,
      v_original.id,
      v_credit_note_id,
      NULL,
      'other',
      v_original.total_amount,
      v_reason,
      'completed',
      v_user_id,
      v_created_at
    );
  END IF;

  RETURN jsonb_build_object(
    'credit_note_invoice_id', v_credit_note_id,
    'credit_note_invoice_number', v_credit_note_number,
    'created_at', v_created_at,
    'total', v_original.total_amount,
    'refund_status', 'completed',
    'zatca_status', 'pending',
    'refund_method', v_invoice_refund_method,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_full_credit_note(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_original_invoice_id UUID;
  v_tenant_business_type TEXT := 'trading';
  v_payload JSONB := p_payload;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid credit note payload' USING ERRCODE = '22023';
  END IF;

  v_original_invoice_id := NULLIF(TRIM(COALESCE(p_payload ->> 'original_invoice_id', '')), '')::uuid;

  IF v_original_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Missing original invoice' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(t.business_type, 'trading')
    INTO v_tenant_business_type
  FROM public.invoices i
  JOIN public.tenants t ON t.id = i.tenant_id
  WHERE i.id = v_original_invoice_id;

  IF v_tenant_business_type = 'service' THEN
    v_payload := jsonb_set(v_payload, '{return_stock}', 'false'::jsonb, TRUE);
  END IF;

  RETURN public.create_full_credit_note_unchecked(v_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.create_full_credit_note_unchecked(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_full_credit_note_unchecked(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.create_full_credit_note(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_full_credit_note(JSONB) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) IS
  'Safe dashboard summary where posted credit notes reduce totals and branch cards include safe production ZATCA status.';
COMMENT ON FUNCTION public.get_branch_dashboard_recent_invoices(UUID, INTEGER) IS
  'Safe branch dashboard recent posted invoices and credit notes.';
COMMENT ON FUNCTION public.create_full_credit_note(JSONB) IS
  'User-facing full credit note RPC. Refunds follow original payment rows and service tenants cannot return stock.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm callable RPCs:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.get_dashboard_summary(uuid, date, date)', 'EXECUTE') AS can_dashboard,
--   has_function_privilege('authenticated', 'public.get_branch_dashboard_recent_invoices(uuid, integer)', 'EXECUTE') AS can_recent,
--   has_function_privilege('authenticated', 'public.create_full_credit_note(jsonb)', 'EXECUTE') AS can_credit_note;
--
-- 2) Dashboard smoke in authenticated owner/admin context:
--
-- SELECT public.get_dashboard_summary(NULL, CURRENT_DATE, CURRENT_DATE);
--
-- 3) Branch recent invoices smoke in authenticated branch/owner/admin context:
--
-- SELECT public.get_branch_dashboard_recent_invoices('<branch-id>'::uuid, 6);
--
-- 4) Credit note payment reversal check after creating a credit note:
--
-- SELECT i.invoice_number, i.zatca_invoice_type, p.method, p.amount
-- FROM public.invoices i
-- JOIN public.payments p ON p.invoice_id = i.id
-- WHERE i.original_invoice_id = '<original-invoice-id>'::uuid
-- ORDER BY p.created_at;
--
-- Expected:
--   Cash originals create cash credit-note payment rows.
--   Card originals create card credit-note payment rows.
--   Split originals create matching cash/card credit-note payment rows.
--   Legacy invoices without payment rows create one Other row.
