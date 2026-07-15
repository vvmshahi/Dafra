-- ============================================================
-- Phase 5N: Credit Note Session Linkage
-- Apply manually after Phase 5J partial item credit notes.
-- ============================================================
--
-- Goals:
--   - Ensure new credit-note invoices inherit original_invoice.session_id.
--   - Keep partial and full credit-note behavior otherwise unchanged.
--   - Preserve register/session summary net sales, VAT, and expected cash.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not change historical rows in this migration.
--   - Do not attach credit notes to the current open session.
--   - Do not invent a session when the original invoice has none.
--   - Do not change credit-note totals, VAT, payments, stock returns,
--     ZATCA, invoice numbering, authorization, purchases, or POS checkout.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_partial_credit_note(p_payload jsonb)
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
  v_branch_prefix TEXT;
  v_counter BIGINT;
  v_credit_note_id UUID := pg_catalog.gen_random_uuid();
  v_credit_note_number TEXT;
  v_original_invoice_id UUID;
  v_idempotency_key TEXT;
  v_reason TEXT;
  v_refund_method TEXT;
  v_payment_id UUID;
  v_payment_method TEXT;
  v_return_stock BOOLEAN := FALSE;
  v_effective_return_stock BOOLEAN := FALSE;
  v_tenant_business_type TEXT := 'trading';
  v_items JSONB;
  v_item_count INTEGER := 0;
  v_invalid_count INTEGER := 0;
  v_conflict_name TEXT;
  v_created_at TIMESTAMPTZ := NOW();
  v_subtotal NUMERIC(12, 2) := 0;
  v_discount_amount NUMERIC(12, 2) := 0;
  v_tax_amount NUMERIC(12, 2) := 0;
  v_total_amount NUMERIC(12, 2) := 0;
  v_paid_total NUMERIC(12, 2) := 0;
  v_existing_refund_total NUMERIC(12, 2) := 0;
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
  v_refund_method := NULLIF(TRIM(COALESCE(p_payload ->> 'refund_method', '')), '');
  v_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, FALSE);
  v_items := p_payload -> 'items';

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

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one item to credit' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.tenant_id, i.branch_id, i.session_id, i.customer_id, i.invoice_number,
         i.zatca_invoice_type::text AS zatca_invoice_type,
         i.zatca_status::text AS zatca_status,
         i.status::text AS status,
         i.payment_status::text AS payment_status,
         i.payment_method::text AS payment_method,
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
    RAISE EXCEPTION 'You do not have permission to create credit notes' USING ERRCODE = '42501';
  END IF;

  IF v_original.zatca_invoice_type NOT IN ('simplified', 'standard') THEN
    RAISE EXCEPTION 'Only original invoices can be credited' USING ERRCODE = '22023';
  END IF;

  IF v_original.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled invoices cannot be credited' USING ERRCODE = '23514';
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

  PERFORM pg_advisory_xact_lock(hashtextextended('partial-credit-note:' || v_original.id::text, 0));

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
      'refund_status', COALESCE(v_existing.payment_status, 'refunded'),
      'zatca_status', v_existing.zatca_status,
      'idempotent_replay', true
    );
  END IF;

  DROP TABLE IF EXISTS pg_temp.partial_credit_request;
  CREATE TEMP TABLE pg_temp.partial_credit_request (
    original_invoice_item_id UUID,
    quantity NUMERIC(12, 3)
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.partial_credit_request (original_invoice_item_id, quantity)
  SELECT
    NULLIF(TRIM(item.original_invoice_item_id), '')::uuid,
    NULLIF(TRIM(item.quantity), '')::numeric
  FROM jsonb_to_recordset(v_items) AS item(
    original_invoice_item_id TEXT,
    quantity TEXT
  );

  SELECT COUNT(*) INTO v_item_count FROM pg_temp.partial_credit_request;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Select at least one item to credit' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.partial_credit_request
    WHERE original_invoice_item_id IS NULL
       OR quantity IS NULL
       OR quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Invalid returned quantity' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.partial_credit_request
    GROUP BY original_invoice_item_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate return item' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM pg_temp.partial_credit_request r
  LEFT JOIN public.invoice_items oi
    ON oi.id = r.original_invoice_item_id
   AND oi.invoice_id = v_original.id
  WHERE oi.id IS NULL;

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Returned item does not belong to the original invoice' USING ERRCODE = '42501';
  END IF;

  DROP TABLE IF EXISTS pg_temp.partial_credit_lines;
  CREATE TEMP TABLE pg_temp.partial_credit_lines ON COMMIT DROP AS
  WITH credited AS (
    SELECT
      ci.original_invoice_item_id,
      COALESCE(SUM(ci.quantity), 0) AS credited_quantity,
      COALESCE(SUM(ci.subtotal), 0) AS credited_subtotal,
      COALESCE(SUM(ci.discount_amount), 0) AS credited_discount_amount,
      COALESCE(SUM(ci.tax_amount), 0) AS credited_tax_amount,
      COALESCE(SUM(ci.total), 0) AS credited_total
    FROM public.invoice_items ci
    JOIN public.invoices cn ON cn.id = ci.invoice_id
    WHERE cn.original_invoice_id = v_original.id
      AND cn.zatca_invoice_type = 'credit_note'
      AND cn.status <> 'cancelled'
      AND ci.original_invoice_item_id IS NOT NULL
    GROUP BY ci.original_invoice_item_id
  ),
  base AS (
    SELECT
      oi.id AS original_invoice_item_id,
      oi.product_id,
      oi.name,
      oi.name_ar,
      oi.description,
      oi.sku,
      oi.unit,
      oi.quantity AS original_quantity,
      r.quantity AS return_quantity,
      oi.unit_price,
      oi.discount_percent,
      oi.discount_amount,
      oi.subtotal,
      oi.tax_rate,
      oi.tax_category,
      oi.tax_amount,
      oi.total,
      oi.sort_order,
      COALESCE(c.credited_quantity, 0) AS credited_quantity,
      GREATEST(oi.quantity - COALESCE(c.credited_quantity, 0), 0) AS remaining_quantity,
      GREATEST(oi.subtotal - COALESCE(c.credited_subtotal, 0), 0) AS remaining_subtotal,
      GREATEST(oi.discount_amount - COALESCE(c.credited_discount_amount, 0), 0) AS remaining_discount_amount,
      GREATEST(oi.tax_amount - COALESCE(c.credited_tax_amount, 0), 0) AS remaining_tax_amount,
      GREATEST(oi.total - COALESCE(c.credited_total, 0), 0) AS remaining_total,
      COALESCE(p.track_stock, FALSE) AS track_stock,
      COALESCE(p.is_service, FALSE) AS is_service
    FROM pg_temp.partial_credit_request r
    JOIN public.invoice_items oi
      ON oi.id = r.original_invoice_item_id
     AND oi.invoice_id = v_original.id
    LEFT JOIN credited c ON c.original_invoice_item_id = oi.id
    LEFT JOIN public.products p
      ON p.id = oi.product_id
     AND p.tenant_id = v_original.tenant_id
     AND p.branch_id = v_original.branch_id
  )
  SELECT
    base.*,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_subtotal
      ELSE LEAST(round(base.subtotal * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_subtotal)
    END AS return_subtotal,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_discount_amount
      ELSE LEAST(round(base.discount_amount * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_discount_amount)
    END AS return_discount_amount,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_tax_amount
      ELSE LEAST(round(base.tax_amount * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_tax_amount)
    END AS return_tax_amount,
    CASE
      WHEN ABS(base.return_quantity - base.remaining_quantity) <= 0.0005 THEN base.remaining_total
      ELSE LEAST(round(base.total * (base.return_quantity / NULLIF(base.original_quantity, 0)), 2), base.remaining_total)
    END AS return_total
  FROM base;

  SELECT name INTO v_conflict_name
  FROM pg_temp.partial_credit_lines
  WHERE return_quantity > remaining_quantity + 0.0005
     OR remaining_quantity <= 0
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Return quantity exceeds remaining refundable quantity for %', v_conflict_name
      USING ERRCODE = '23514';
  END IF;

  SELECT
    COALESCE(round(SUM(return_subtotal), 2), 0),
    COALESCE(round(SUM(return_discount_amount), 2), 0),
    COALESCE(round(SUM(return_tax_amount), 2), 0),
    COALESCE(round(SUM(return_total), 2), 0)
    INTO v_subtotal, v_discount_amount, v_tax_amount, v_total_amount
  FROM pg_temp.partial_credit_lines;

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'Credit note total must be greater than zero' USING ERRCODE = '23514';
  END IF;

  IF v_refund_method IS NULL THEN
    SELECT id, method::text
      INTO v_payment_id, v_payment_method
    FROM public.payments
    WHERE invoice_id = v_original.id
    ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST
    LIMIT 1;

    v_refund_method := COALESCE(v_payment_method, v_original.payment_method, 'cash');
  ELSE
    SELECT id, method::text
      INTO v_payment_id, v_payment_method
    FROM public.payments
    WHERE invoice_id = v_original.id
    ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  IF v_refund_method NOT IN ('cash', 'card', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Unsupported refund method' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(round(SUM(amount), 2), 0)
    INTO v_paid_total
  FROM public.payments
  WHERE invoice_id = v_original.id;

  IF v_paid_total <= 0 THEN
    v_paid_total := COALESCE(v_original.total_amount, 0);
  END IF;

  SELECT COALESCE(round(SUM(amount), 2), 0)
    INTO v_existing_refund_total
  FROM public.payment_refunds
  WHERE original_invoice_id = v_original.id
    AND status <> 'failed';

  IF v_existing_refund_total + v_total_amount > v_paid_total + 0.01 THEN
    RAISE EXCEPTION 'Cumulative refunds cannot exceed the original payment total' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(t.business_type, 'trading')
    INTO v_tenant_business_type
  FROM public.tenants t
  WHERE t.id = v_original.tenant_id;

  v_effective_return_stock := v_return_stock AND COALESCE(v_tenant_business_type, 'trading') <> 'service';

  v_counter := public.get_next_credit_note_counter(v_original.branch_id);
  v_branch_prefix := COALESCE(NULLIF(TRIM(v_original.invoice_prefix), ''), 'INV');
  v_credit_note_number := v_branch_prefix || '-CN-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');

  INSERT INTO public.invoices (
    id,
    tenant_id,
    branch_id,
    session_id,
    customer_id,
    created_by,
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
    v_original.session_id,
    v_original.customer_id,
    v_user_id,
    v_credit_note_number,
    v_original.invoice_number,
    v_original.id,
    v_reason,
    v_idempotency_key,
    'credit_note',
    '381',
    'pending',
    v_subtotal,
    v_discount_amount,
    v_subtotal,
    v_tax_amount,
    v_total_amount,
    COALESCE(v_original.currency_code, 'SAR'),
    (v_created_at AT TIME ZONE 'Asia/Riyadh')::date,
    v_refund_method::public.payment_method,
    'posted',
    'refunded',
    v_reason,
    v_created_at
  );

  FOR v_line IN
    SELECT * FROM pg_temp.partial_credit_lines
    ORDER BY sort_order, original_invoice_item_id
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
      v_line.original_invoice_item_id,
      v_line.name,
      v_line.name_ar,
      v_line.description,
      v_line.sku,
      v_line.unit,
      v_line.return_quantity,
      v_line.unit_price,
      v_line.discount_percent,
      v_line.return_discount_amount,
      v_line.return_subtotal,
      v_line.tax_rate,
      v_line.tax_category,
      v_line.return_tax_amount,
      v_line.return_total,
      v_line.sort_order
    );

    IF v_effective_return_stock IS TRUE
       AND v_line.product_id IS NOT NULL
       AND COALESCE(v_line.track_stock, FALSE) IS TRUE
       AND COALESCE(v_line.is_service, FALSE) IS FALSE
    THEN
      UPDATE public.products
      SET stock_quantity = COALESCE(stock_quantity, 0) + v_line.return_quantity
      WHERE id = v_line.product_id
        AND tenant_id = v_original.tenant_id
        AND branch_id = v_original.branch_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock return failed for credited item' USING ERRCODE = '23514';
      END IF;

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
        v_line.return_quantity,
        'refund_return',
        v_user_id
      );
    END IF;
  END LOOP;

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
    v_payment_id,
    v_refund_method::public.payment_method,
    v_total_amount,
    v_reason,
    'completed',
    v_user_id,
    v_created_at
  );

  RETURN jsonb_build_object(
    'credit_note_invoice_id', v_credit_note_id,
    'credit_note_invoice_number', v_credit_note_number,
    'created_at', v_created_at,
    'total', v_total_amount,
    'refund_status', 'completed',
    'refund_method', v_refund_method,
    'zatca_status', 'pending',
    'line_count', v_item_count,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_partial_credit_note(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(JSONB) TO authenticated;
ALTER FUNCTION public.create_partial_credit_note(JSONB) SET row_security = off;

COMMENT ON FUNCTION public.create_partial_credit_note(JSONB) IS
  'Creates a partial item-level credit note for selected original invoice items. Backend-controlled, idempotent, tenant/branch scoped, concurrency-safe, and linked to the original register session.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- OPTIONAL MANUAL BACKFILL - DO NOT RUN WITH THE MIGRATION
-- ============================================================
--
-- Purpose:
--   Repair only historical credit notes that are missing session_id while
--   their original invoice already has a session_id.
--
-- Safety:
--   - Does not overwrite non-null credit-note session_id.
--   - Requires original and credit-note invoices to share tenant and branch.
--   - Does not repair SESSION_MISMATCH rows automatically.
--
-- Preview candidates:
--
-- SELECT
--   cn.id AS credit_note_invoice_id,
--   cn.invoice_number AS credit_note_invoice_number,
--   cn.created_at AS credit_note_created_at,
--   cn.tenant_id,
--   cn.branch_id,
--   cn.session_id AS current_credit_note_session_id,
--   oi.id AS original_invoice_id,
--   oi.invoice_number AS original_invoice_number,
--   oi.session_id AS original_invoice_session_id,
--   cn.total_amount AS credit_note_total_amount,
--   cn.tax_amount AS credit_note_tax_amount
-- FROM public.invoices cn
-- JOIN public.invoices oi
--   ON oi.id = cn.original_invoice_id
-- WHERE cn.zatca_invoice_type = 'credit_note'
--   AND cn.status <> 'cancelled'
--   AND cn.session_id IS NULL
--   AND oi.session_id IS NOT NULL
--   AND cn.tenant_id = oi.tenant_id
--   AND cn.branch_id = oi.branch_id
-- ORDER BY cn.created_at DESC;
--
-- Manual update:
--
-- WITH candidates AS (
--   SELECT
--     cn.id AS credit_note_invoice_id,
--     oi.session_id AS original_invoice_session_id
--   FROM public.invoices cn
--   JOIN public.invoices oi
--     ON oi.id = cn.original_invoice_id
--   WHERE cn.zatca_invoice_type = 'credit_note'
--     AND cn.status <> 'cancelled'
--     AND cn.session_id IS NULL
--     AND oi.session_id IS NOT NULL
--     AND cn.tenant_id = oi.tenant_id
--     AND cn.branch_id = oi.branch_id
-- )
-- UPDATE public.invoices cn
-- SET session_id = candidates.original_invoice_session_id
-- FROM candidates
-- WHERE cn.id = candidates.credit_note_invoice_id
--   AND cn.session_id IS NULL
-- RETURNING
--   cn.id AS credit_note_invoice_id,
--   cn.invoice_number AS credit_note_invoice_number,
--   cn.original_invoice_id,
--   cn.session_id AS linked_session_id,
--   cn.total_amount,
--   cn.tax_amount;
--
-- Manual count review:
--
-- WITH candidates AS (
--   SELECT cn.id
--   FROM public.invoices cn
--   JOIN public.invoices oi
--     ON oi.id = cn.original_invoice_id
--   WHERE cn.zatca_invoice_type = 'credit_note'
--     AND cn.status <> 'cancelled'
--     AND cn.session_id IS NULL
--     AND oi.session_id IS NOT NULL
--     AND cn.tenant_id = oi.tenant_id
--     AND cn.branch_id = oi.branch_id
-- )
-- SELECT COUNT(*) AS rows_that_would_be_backfilled
-- FROM candidates;
