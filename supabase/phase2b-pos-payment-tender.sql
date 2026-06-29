-- ============================================================
-- Phase 2B POS payment tender/change persistence
-- Apply manually in Supabase SQL editor after the Phase 2 checkout RPC fixes.
-- ============================================================
--
-- This patch re-applies the backend checkout schema/function idempotently and
-- keeps all Phase 2 checkout fixes while adding Phase 2B receipt persistence:
--   1. Avoid unqualified uuid_generate_v4() by using pg_catalog.gen_random_uuid().
--   2. Treat missing amount_paid as full payment for cash/card/bank checkout,
--      while still rejecting explicit short cash tender.
--   3. Store invoice_items.tax_rate as a decimal fraction for ZATCA compatibility
--      (0.15 for 15% VAT), matching the existing invoice convention.
--   4. Preserve cash amount received and change returned on payments so POS
--      receipts can be reprinted accurately.
--
-- New payment columns:
--   payments.amount_received stores the customer tendered amount.
--   payments.change_amount stores change returned for cash payments.
--
-- The migration moves POS checkout writes behind a SECURITY DEFINER RPC:
--   public.pos_checkout(p_payload jsonb)
--
-- The RPC validates the authenticated caller, recalculates totals from DB
-- product/branch/customer rows, creates invoice/items/payment in one database
-- transaction, supports idempotency, and optionally decrements stock for
-- products where track_stock = true.
--
-- It intentionally does not call ZATCA. The existing zatca-submit Edge Function
-- remains the post-checkout submission path.

BEGIN;

-- Existing POS code already writes this column in production. Keep the migration
-- idempotent for environments where it was not captured in older schema files.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_method public.payment_method DEFAULT 'cash';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.pos_sessions(id);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC(12, 2);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS change_amount NUMERIC(12, 2);

COMMENT ON COLUMN public.payments.amount_received IS
  'Customer tendered amount captured at POS checkout. For card/bank payments this normally equals the invoice total.';

COMMENT ON COLUMN public.payments.change_amount IS
  'Cash change returned to the customer at POS checkout. For non-cash payments this is normally zero.';

CREATE UNIQUE INDEX IF NOT EXISTS invoices_branch_checkout_idempotency_key_idx
  ON public.invoices (branch_id, checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pos_stock_movements (
  id             UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id      UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES public.products(id) ON DELETE SET NULL,
  invoice_id     UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  quantity_delta NUMERIC(12, 3) NOT NULL,
  reason         TEXT NOT NULL DEFAULT 'pos_sale',
  created_by     UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pos_stock_movements_branch_created_idx
  ON public.pos_stock_movements (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pos_stock_movements_invoice_idx
  ON public.pos_stock_movements (invoice_id);

ALTER TABLE public.pos_stock_movements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_items_quantity_positive'
      AND conrelid = 'public.invoice_items'::regclass
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_quantity_positive
      CHECK (quantity > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_amount_positive'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_positive
      CHECK (amount > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_amount_received_nonnegative'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_received_nonnegative
      CHECK (amount_received IS NULL OR amount_received >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_change_amount_nonnegative'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_change_amount_nonnegative
      CHECK (change_amount IS NULL OR change_amount >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_tracked_stock_nonnegative'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_tracked_stock_nonnegative
      CHECK (track_stock = FALSE OR stock_quantity >= 0) NOT VALID;
  END IF;
END $$;

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
  v_items JSONB := p_payload -> 'items';
  v_item_rows JSONB := '[]'::jsonb;
  v_existing_items JSONB := '[]'::jsonb;
  v_branch_id UUID;
  v_customer_id UUID;
  v_session_id UUID;
  v_product_id UUID;
  v_idempotency_key TEXT;
  v_payment_method TEXT;
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
  v_line_amount NUMERIC(12, 4);
  v_line_subtotal NUMERIC(12, 2);
  v_line_tax NUMERIC(12, 2);
  v_line_total NUMERIC(12, 2);
  v_subtotal NUMERIC(12, 2) := 0;
  v_tax_amount NUMERIC(12, 2) := 0;
  v_total NUMERIC(12, 2) := 0;
  v_created_at TIMESTAMPTZ := NOW();
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

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023';
  END IF;

  IF v_idempotency_key IS NULL
     OR length(v_idempotency_key) < 8
     OR length(v_idempotency_key) > 120
  THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;

  IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Unsupported payment method' USING ERRCODE = '22023';
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

  SELECT id, tenant_id, name, invoice_prefix, vat_mode, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = v_branch_id;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
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

    RETURN jsonb_build_object(
      'invoice_id', v_existing.id,
      'invoice_number', v_existing.invoice_number,
      'created_at', v_existing.created_at,
      'subtotal', v_existing.subtotal,
      'tax_amount', v_existing.tax_amount,
      'total', v_existing.total_amount,
      'payment_method', v_existing.payment_method,
      'payment_status', v_existing.payment_status,
      'amount_received', v_existing_amount_received,
      'change_amount', v_existing_change_amount,
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
    v_total,
    v_amount_paid,
    v_change_amount,
    v_payment_method::public.payment_method,
    v_created_at
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'created_at', v_created_at,
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total', v_total,
    'payment_method', v_payment_method,
    'payment_status', 'paid',
    'amount_received', v_amount_paid,
    'change_amount', v_change_amount,
    'zatca_invoice_type', v_zatca_invoice_type,
    'items', v_item_rows,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_checkout(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb) TO authenticated;

COMMENT ON FUNCTION public.pos_checkout(jsonb) IS
  'Backend-controlled POS checkout. Recalculates totals, writes invoice/items/payment transactionally, supports idempotency, and optionally decrements tracked product stock.';

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm payment tender/change columns exist:
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'payments'
--   AND column_name IN ('amount_received', 'change_amount')
-- ORDER BY column_name;
--
-- 2) Confirm checkout hardening columns/index exist:
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'invoices'
--   AND column_name IN ('payment_method', 'checkout_idempotency_key');
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname = 'invoices_branch_checkout_idempotency_key_idx';
--
-- 3) Confirm stock opt-in exists:
--
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'products'
--   AND column_name = 'track_stock';
--
-- 4) Confirm RPC is executable by authenticated users:
--
-- SELECT has_function_privilege('authenticated', 'public.pos_checkout(jsonb)', 'EXECUTE') AS authenticated_can_execute;
--
-- 5) Dry auth probe from an authenticated SQL session should fail cleanly if
--    branch/items are not supplied. Replace the JWT/user context in Supabase SQL
--    tooling as needed:
--
-- SELECT public.pos_checkout('{}'::jsonb);
