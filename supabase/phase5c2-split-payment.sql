-- ============================================================
-- Phase 5C-2 hotfix: Split Payment MVP
-- Apply manually after Phase 2B POS checkout and Phase 5B reporting hotfixes.
-- ============================================================
--
-- Goals:
--   - Add a branch-level Split Payment setting, default off.
--   - Keep existing single cash/card checkout behavior unchanged.
--   - Allow enabled branches to create one invoice with separate cash/card
--     payment rows.
--   - Keep ZATCA XML/signing/hash/QR/canonicalization untouched.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not add a new payment_method enum value.

BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS allow_split_payments BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.branches.allow_split_payments IS
  'Branch-level POS checkout setting. When true, POS may split one invoice across cash and card payment rows.';

CREATE OR REPLACE FUNCTION public.pos_checkout(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_customer RECORD;
  v_existing RECORD;
  v_product RECORD;
  v_item JSONB;
  v_line JSONB;
  v_payment JSONB;
  v_items JSONB := p_payload -> 'items';
  v_payments_json JSONB := p_payload -> 'payments';
  v_item_rows JSONB := '[]'::jsonb;
  v_existing_items JSONB := '[]'::jsonb;
  v_payment_rows JSONB := '[]'::jsonb;
  v_existing_payments JSONB := '[]'::jsonb;
  v_branch_id UUID;
  v_customer_id UUID;
  v_session_id UUID;
  v_product_id UUID;
  v_idempotency_key TEXT;
  v_payment_method TEXT;
  v_display_payment_method TEXT;
  v_note TEXT;
  v_invoice_id UUID := pg_catalog.gen_random_uuid();
  v_invoice_number TEXT;
  v_invoice_prefix TEXT;
  v_zatca_invoice_type public.invoice_type := 'simplified';
  v_qty NUMERIC(12, 3);
  v_amount_paid NUMERIC(12, 2);
  v_counter BIGINT;
  v_sort_order INT;
  v_vat_mode TEXT;
  v_vat_treatment TEXT;
  v_tax_category TEXT;
  v_rate_percent NUMERIC(5, 2);
  v_rate NUMERIC(8, 6);
  v_change_amount NUMERIC(12, 2) := 0;
  v_existing_amount_received NUMERIC(12, 2);
  v_existing_change_amount NUMERIC(12, 2);
  v_existing_payment_count INTEGER := 0;
  v_existing_cash_amount NUMERIC(12, 2) := 0;
  v_existing_card_amount NUMERIC(12, 2) := 0;
  v_line_amount NUMERIC(12, 4);
  v_line_subtotal NUMERIC(12, 2);
  v_line_tax NUMERIC(12, 2);
  v_line_total NUMERIC(12, 2);
  v_subtotal NUMERIC(12, 2) := 0;
  v_tax_amount NUMERIC(12, 2) := 0;
  v_total NUMERIC(12, 2) := 0;
  v_created_at TIMESTAMPTZ := NOW();
  v_is_split_payment BOOLEAN := FALSE;
  v_split_method TEXT;
  v_split_amount NUMERIC(12, 2);
  v_split_total NUMERIC(12, 2) := 0;
  v_split_cash_amount NUMERIC(12, 2) := 0;
  v_split_card_amount NUMERIC(12, 2) := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid checkout payload' USING ERRCODE = '22023';
  END IF;

  v_branch_id := NULLIF(TRIM(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;
  v_customer_id := NULLIF(TRIM(COALESCE(p_payload ->> 'customer_id', '')), '')::uuid;
  v_session_id := NULLIF(TRIM(COALESCE(p_payload ->> 'session_id', '')), '')::uuid;
  v_idempotency_key := NULLIF(TRIM(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  v_payment_method := COALESCE(NULLIF(TRIM(p_payload ->> 'payment_method'), ''), 'cash');
  v_note := NULLIF(TRIM(COALESCE(p_payload ->> 'note', '')), '');
  v_amount_paid := NULLIF(TRIM(COALESCE(p_payload ->> 'amount_paid', '')), '')::numeric;
  v_is_split_payment := v_payments_json IS NOT NULL;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
     OR length(v_idempotency_key) < 8
     OR length(v_idempotency_key) > 120
  THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  IF v_is_split_payment THEN
    IF jsonb_typeof(v_payments_json) <> 'array' OR jsonb_array_length(v_payments_json) <> 2 THEN
      RAISE EXCEPTION 'Split payment requires cash and card amounts' USING ERRCODE = '22023';
    END IF;

    v_payment_method := 'other';
    v_display_payment_method := 'split';
  ELSE
    IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
      RAISE EXCEPTION 'Unsupported payment method' USING ERRCODE = '22023';
    END IF;

    v_display_payment_method := v_payment_method;
  END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Checkout requires at least one item' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, name, invoice_prefix, vat_mode, is_active,
         COALESCE(allow_split_payments, FALSE) AS allow_split_payments
    INTO v_branch
  FROM public.branches
  WHERE id = v_branch_id;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_is_split_payment AND v_branch.allow_split_payments IS NOT TRUE THEN
    RAISE EXCEPTION 'Split Payment is not enabled for this branch' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent retries/double-clicks for the same branch/key so the
  -- second request returns the first invoice instead of racing the unique index.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch.id::text || ':' || v_idempotency_key, 0));

  SELECT id, invoice_number, created_at, subtotal, tax_amount, total_amount,
         payment_method, zatca_invoice_type, payment_status
    INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_branch_id
    AND checkout_idempotency_key = v_idempotency_key;

  IF FOUND THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'product_id', product_id,
          'name', name,
          'name_ar', name_ar,
          'unit', unit,
          'quantity', quantity,
          'unit_price', unit_price,
          'line_amount', round(unit_price * quantity, 2),
          'subtotal', subtotal,
          'tax_amount', tax_amount,
          'total', total
        )
        ORDER BY sort_order
      ),
      '[]'::jsonb
    )
      INTO v_existing_items
    FROM public.invoice_items
    WHERE invoice_id = v_existing.id;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'method', method::text,
          'amount', amount,
          'amount_received', amount_received,
          'change_amount', change_amount
        )
        ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST, id
      ),
      '[]'::jsonb
    )
      INTO v_existing_payments
    FROM public.payments
    WHERE invoice_id = v_existing.id;

    SELECT COUNT(*)::integer,
           COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN method = 'card' THEN amount ELSE 0 END), 0)
      INTO v_existing_payment_count, v_existing_cash_amount, v_existing_card_amount
    FROM public.payments
    WHERE invoice_id = v_existing.id;

    SELECT COALESCE(amount_received, amount, v_existing.total_amount),
           COALESCE(change_amount, 0)
      INTO v_existing_amount_received, v_existing_change_amount
    FROM public.payments
    WHERE invoice_id = v_existing.id
    ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      v_existing_amount_received := v_existing.total_amount;
      v_existing_change_amount := 0;
    END IF;

    v_display_payment_method := CASE
      WHEN v_existing_payment_count > 1
       AND v_existing_cash_amount > 0
       AND v_existing_card_amount > 0
        THEN 'split'
      ELSE COALESCE(v_existing.payment_method::text, 'cash')
    END;

    RETURN jsonb_build_object(
      'invoice_id', v_existing.id,
      'invoice_number', v_existing.invoice_number,
      'created_at', v_existing.created_at,
      'subtotal', v_existing.subtotal,
      'tax_amount', v_existing.tax_amount,
      'total', v_existing.total_amount,
      'payment_method', v_existing.payment_method,
      'display_payment_method', v_display_payment_method,
      'payment_status', v_existing.payment_status,
      'amount_received', v_existing_amount_received,
      'change_amount', v_existing_change_amount,
      'payments', v_existing_payments,
      'zatca_invoice_type', v_existing.zatca_invoice_type,
      'items', v_existing_items,
      'idempotent_replay', true
    );
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT id, customer_type, vat_number, is_active
      INTO v_customer
    FROM public.customers
    WHERE id = v_customer_id
      AND tenant_id = v_branch.tenant_id
      AND branch_id = v_branch.id;

    IF NOT FOUND OR v_customer.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Customer not found or inactive' USING ERRCODE = '42501';
    END IF;

    IF v_customer.customer_type = 'business'
       AND COALESCE(v_customer.vat_number, '') ~ '^3[0-9]{13}3$'
    THEN
      v_zatca_invoice_type := 'standard';
    END IF;
  END IF;

  IF v_session_id IS NOT NULL THEN
    PERFORM 1
    FROM public.pos_sessions
    WHERE id = v_session_id
      AND tenant_id = v_branch.tenant_id
      AND branch_id = v_branch.id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'POS session is not open for this branch' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_vat_mode := CASE
    WHEN COALESCE(v_branch.vat_mode, 'exclusive') IN ('exclusive', 'inclusive')
      THEN COALESCE(v_branch.vat_mode, 'exclusive')
    ELSE 'exclusive'
  END;

  FOR v_item, v_sort_order IN
    SELECT value, (ordinality - 1)::int
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(value, ordinality)
  LOOP
    v_product_id := NULLIF(TRIM(COALESCE(v_item ->> 'product_id', '')), '')::uuid;
    v_qty := NULLIF(TRIM(COALESCE(v_item ->> 'quantity', '')), '')::numeric;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid checkout item' USING ERRCODE = '22023';
    END IF;

    SELECT id, tenant_id, branch_id, name, name_ar, sku, unit, price, tax_rate,
           tax_category, is_taxable, vat_treatment, is_service, stock_quantity,
           track_stock, is_active, is_available
      INTO v_product
    FROM public.products
    WHERE id = v_product_id
      AND tenant_id = v_branch.tenant_id
      AND branch_id = v_branch.id
    FOR UPDATE;

    IF NOT FOUND OR v_product.is_active IS NOT TRUE OR v_product.is_available IS NOT TRUE THEN
      RAISE EXCEPTION 'Product is not available for checkout' USING ERRCODE = '42501';
    END IF;

    v_vat_treatment := COALESCE(v_product.vat_treatment, 'inherit');
    IF v_vat_treatment = 'inherit' THEN
      v_vat_treatment := v_vat_mode;
    END IF;

    IF v_vat_treatment = 'exempt' OR v_product.is_taxable IS FALSE THEN
      v_rate_percent := 0;
      v_tax_category := COALESCE(NULLIF(v_product.tax_category, ''), 'O');
      v_vat_treatment := 'exempt';
    ELSE
      v_rate_percent := COALESCE(v_product.tax_rate, 15);
      v_tax_category := COALESCE(NULLIF(v_product.tax_category, ''), 'S');
    END IF;

    v_rate := v_rate_percent / 100;
    v_line_amount := COALESCE(v_product.price, 0) * v_qty;

    IF v_vat_treatment = 'inclusive' AND v_rate > 0 THEN
      v_line_total := round(v_line_amount, 2);
      v_line_subtotal := round(v_line_total / (1 + v_rate), 2);
      v_line_tax := v_line_total - v_line_subtotal;
    ELSIF v_vat_treatment = 'exclusive' AND v_rate > 0 THEN
      v_line_subtotal := round(v_line_amount, 2);
      v_line_tax := round(v_line_subtotal * v_rate, 2);
      v_line_total := v_line_subtotal + v_line_tax;
    ELSE
      v_line_subtotal := round(v_line_amount, 2);
      v_line_tax := 0;
      v_line_total := v_line_subtotal;
    END IF;

    IF COALESCE(v_product.track_stock, FALSE) IS TRUE
       AND COALESCE(v_product.is_service, FALSE) IS FALSE
    THEN
      UPDATE public.products
      SET stock_quantity = stock_quantity - v_qty
      WHERE id = v_product.id
        AND COALESCE(stock_quantity, 0) >= v_qty;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_product.name
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total := v_total + v_line_total;

    v_item_rows := v_item_rows || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'name_ar', v_product.name_ar,
      'sku', v_product.sku,
      'unit', COALESCE(v_product.unit, 'pcs'),
      'quantity', v_qty,
      'unit_price', v_product.price,
      'line_amount', round(v_line_amount, 2),
      -- products.tax_rate is stored as a percentage, while invoice_items.tax_rate
      -- follows the existing ZATCA-facing convention of a decimal fraction.
      'tax_rate', v_rate,
      'tax_category', v_tax_category,
      'subtotal', v_line_subtotal,
      'tax_amount', v_line_tax,
      'total', v_line_total,
      'sort_order', v_sort_order,
      'track_stock', COALESCE(v_product.track_stock, FALSE)
    ));
  END LOOP;

  v_subtotal := round(v_subtotal, 2);
  v_tax_amount := round(v_tax_amount, 2);
  v_total := round(v_total, 2);

  IF v_is_split_payment THEN
    FOR v_payment IN
      SELECT value FROM jsonb_array_elements(v_payments_json) AS t(value)
    LOOP
      v_split_method := NULLIF(TRIM(COALESCE(v_payment ->> 'method', '')), '');
      v_split_amount := round(NULLIF(TRIM(COALESCE(v_payment ->> 'amount', '')), '')::numeric, 2);

      IF v_split_method NOT IN ('cash', 'card') THEN
        RAISE EXCEPTION 'Split Payment supports cash and card only' USING ERRCODE = '22023';
      END IF;

      IF v_split_amount IS NULL OR v_split_amount <= 0 THEN
        RAISE EXCEPTION 'Split Payment amounts must be greater than zero' USING ERRCODE = '22023';
      END IF;

      IF v_split_method = 'cash' THEN
        IF v_split_cash_amount > 0 THEN
          RAISE EXCEPTION 'Split Payment can include only one cash amount' USING ERRCODE = '22023';
        END IF;
        v_split_cash_amount := v_split_amount;
      ELSE
        IF v_split_card_amount > 0 THEN
          RAISE EXCEPTION 'Split Payment can include only one card amount' USING ERRCODE = '22023';
        END IF;
        v_split_card_amount := v_split_amount;
      END IF;

      v_split_total := v_split_total + v_split_amount;
    END LOOP;

    IF v_split_cash_amount <= 0 OR v_split_card_amount <= 0 THEN
      RAISE EXCEPTION 'Split Payment requires both cash and card amounts' USING ERRCODE = '22023';
    END IF;

    IF ABS(v_split_total - v_total) > 0.01 THEN
      RAISE EXCEPTION 'Split Payment amounts must equal invoice total' USING ERRCODE = '23514';
    END IF;

    v_payment_rows := jsonb_build_array(
      jsonb_build_object(
        'method', 'cash',
        'amount', v_split_cash_amount,
        'amount_received', v_split_cash_amount,
        'change_amount', 0
      ),
      jsonb_build_object(
        'method', 'card',
        'amount', v_split_card_amount,
        'amount_received', v_split_card_amount,
        'change_amount', 0
      )
    );
    v_amount_paid := v_total;
    v_change_amount := 0;
  ELSE
    IF v_amount_paid IS NULL OR v_payment_method IN ('card', 'bank_transfer') THEN
      v_amount_paid := v_total;
    END IF;

    IF v_payment_method = 'cash' AND COALESCE(v_amount_paid, 0) + 0.005 < v_total THEN
      RAISE EXCEPTION 'Amount paid is less than invoice total' USING ERRCODE = '23514';
    END IF;

    v_amount_paid := round(v_amount_paid, 2);
    v_change_amount := CASE
      WHEN v_payment_method = 'cash' THEN GREATEST(round(v_amount_paid - v_total, 2), 0)
      ELSE 0
    END;

    v_payment_rows := jsonb_build_array(jsonb_build_object(
      'method', v_payment_method,
      'amount', v_total,
      'amount_received', v_amount_paid,
      'change_amount', v_change_amount
    ));
  END IF;

  v_counter := public.get_next_invoice_counter(v_branch.id);
  v_invoice_prefix := COALESCE(NULLIF(TRIM(v_branch.invoice_prefix), ''), 'INV');
  v_invoice_number := v_invoice_prefix || '-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');

  INSERT INTO public.invoices (
    id,
    tenant_id,
    branch_id,
    customer_id,
    created_by,
    session_id,
    invoice_number,
    checkout_idempotency_key,
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
    v_invoice_id,
    v_branch.tenant_id,
    v_branch.id,
    v_customer_id,
    v_user_id,
    v_session_id,
    v_invoice_number,
    v_idempotency_key,
    v_zatca_invoice_type,
    '388',
    'pending',
    v_subtotal,
    0,
    v_subtotal,
    v_tax_amount,
    v_total,
    'SAR',
    (v_created_at AT TIME ZONE 'Asia/Riyadh')::date,
    v_payment_method::public.payment_method,
    'posted',
    'paid',
    v_note,
    v_created_at
  );

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(v_item_rows) AS t(value)
  LOOP
    INSERT INTO public.invoice_items (
      invoice_id,
      tenant_id,
      product_id,
      name,
      name_ar,
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
      v_invoice_id,
      v_branch.tenant_id,
      (v_line ->> 'product_id')::uuid,
      v_line ->> 'name',
      v_line ->> 'name_ar',
      v_line ->> 'sku',
      v_line ->> 'unit',
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price')::numeric,
      0,
      0,
      (v_line ->> 'subtotal')::numeric,
      (v_line ->> 'tax_rate')::numeric,
      v_line ->> 'tax_category',
      (v_line ->> 'tax_amount')::numeric,
      (v_line ->> 'total')::numeric,
      (v_line ->> 'sort_order')::int
    );

    IF (v_line ->> 'track_stock')::boolean IS TRUE THEN
      INSERT INTO public.pos_stock_movements (
        tenant_id,
        branch_id,
        product_id,
        invoice_id,
        quantity_delta,
        reason,
        created_by
      ) VALUES (
        v_branch.tenant_id,
        v_branch.id,
        (v_line ->> 'product_id')::uuid,
        v_invoice_id,
        -((v_line ->> 'quantity')::numeric),
        'pos_sale',
        v_user_id
      );
    END IF;
  END LOOP;

  FOR v_payment IN
    SELECT value FROM jsonb_array_elements(v_payment_rows) AS t(value)
  LOOP
    INSERT INTO public.payments (
      tenant_id,
      invoice_id,
      recorded_by,
      amount,
      amount_received,
      change_amount,
      method,
      paid_at
    ) VALUES (
      v_branch.tenant_id,
      v_invoice_id,
      v_user_id,
      (v_payment ->> 'amount')::numeric,
      (v_payment ->> 'amount_received')::numeric,
      (v_payment ->> 'change_amount')::numeric,
      (v_payment ->> 'method')::public.payment_method,
      v_created_at
    );
  END LOOP;

  IF v_is_split_payment
     AND to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL
  THEN
    PERFORM public.record_audit_event(
      'pos_split_payment_checkout',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_profile.role,
      'invoice',
      v_invoice_id,
      'info',
      'succeeded',
      jsonb_build_object(
        'payment_count', 2,
        'cash_amount', v_split_cash_amount,
        'card_amount', v_split_card_amount,
        'invoice_total', v_total
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'created_at', v_created_at,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total', v_total,
    'payment_method', v_payment_method,
    'display_payment_method', v_display_payment_method,
    'payment_status', 'paid',
    'amount_received', v_amount_paid,
    'change_amount', v_change_amount,
    'payments', v_payment_rows,
    'zatca_invoice_type', v_zatca_invoice_type,
    'items', v_item_rows,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_checkout(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_checkout(JSONB) TO authenticated;

COMMENT ON FUNCTION public.pos_checkout(JSONB) IS
  'POS checkout RPC. Supports legacy single payment checkout and branch-enabled Split Payment using separate cash/card rows. Does not call ZATCA.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm branch setting exists and defaults off:
--
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'branches'
--   AND column_name = 'allow_split_payments';
--
-- Expected:
--   column_default = false, is_nullable = NO.
--
-- 2) Confirm browser-facing checkout RPC remains callable:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.pos_checkout(jsonb)',
--   'EXECUTE'
-- ) AS can_checkout;
--
-- Expected: true.
--
-- 3) Split Payment app smoke test after enabling one pilot branch:
--
-- UPDATE public.branches
-- SET allow_split_payments = TRUE
-- WHERE id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid;
--
-- In the authenticated POS app:
--   invoice total 22.50, cash 10.00, card 12.50.
--
-- Then verify one invoice and two rows:
--
-- SELECT i.invoice_number, i.payment_method, p.method, p.amount
-- FROM public.invoices i
-- JOIN public.payments p ON p.invoice_id = i.id
-- WHERE i.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
-- ORDER BY i.created_at DESC, p.method
-- LIMIT 4;
--
-- Expected:
--   i.payment_method = other for split invoice fallback.
--   one cash row and one card row with the requested amounts.
