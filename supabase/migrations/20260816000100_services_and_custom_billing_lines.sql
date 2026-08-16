-- Services and custom billing lines.
--
-- This migration deliberately keeps the public checkout/session/classifier and
-- atomic ZATCA contracts in place.  It replaces only the internal commercial
-- delegate, preserving its OID so existing wrappers continue to call it.

BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS catalogue_billing_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS custom_lines_enabled boolean NOT NULL DEFAULT false;

-- A service is never an inventory-tracked item.  Preserve historical quantity
-- balances while making future service sales unambiguously non-stock.
UPDATE public.products
SET track_stock = false
WHERE is_service IS TRUE
  AND track_stock IS TRUE;

DO $service_stock_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_service_cannot_track_stock'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_service_cannot_track_stock
      CHECK (NOT (COALESCE(is_service, false) AND COALESCE(track_stock, false)));
  END IF;
END
$service_stock_constraint$;

CREATE OR REPLACE FUNCTION public.enforce_service_product_inventory_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.is_service IS TRUE THEN
    NEW.track_stock := false;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_enforce_service_product_inventory_v1 ON public.products;
CREATE TRIGGER trg_enforce_service_product_inventory_v1
BEFORE INSERT OR UPDATE OF is_service, track_stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.enforce_service_product_inventory_v1();

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS line_source text NOT NULL DEFAULT 'legacy';

DO $invoice_item_line_source_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoice_items'::regclass
      AND conname = 'invoice_items_line_source_check'
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_line_source_check
      CHECK (line_source IN ('catalogue', 'custom', 'legacy'));
  END IF;
END
$invoice_item_line_source_constraint$;

CREATE OR REPLACE FUNCTION public.apply_invoice_item_line_source_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source text := NULLIF(current_setting('app.checkout_line_source', true), '');
BEGIN
  -- Legacy writers do not know about provenance and remain explicitly legacy.
  -- The preserved catalogue checkout delegate sets a transaction-local source.
  IF v_source IN ('catalogue', 'custom')
     AND (NEW.line_source IS NULL OR NEW.line_source = 'legacy') THEN
    NEW.line_source := v_source;
  ELSIF NEW.line_source IS NULL THEN
    NEW.line_source := 'legacy';
  END IF;

  IF NEW.line_source = 'custom' THEN
    IF NEW.product_id IS NOT NULL THEN
      RAISE EXCEPTION 'Custom invoice items cannot reference a catalogue product'
        USING ERRCODE = '23514';
    END IF;
    NEW.stock_tracked_at_sale := false;
    NEW.service_item_at_sale := true;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_apply_invoice_item_line_source_v1 ON public.invoice_items;
CREATE TRIGGER trg_apply_invoice_item_line_source_v1
BEFORE INSERT ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.apply_invoice_item_line_source_v1();

CREATE OR REPLACE FUNCTION public.update_branch_billing_capabilities(
  p_branch_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_profile record;
  v_branch record;
  v_catalogue_enabled boolean;
  v_custom_enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_payload) key_name
       WHERE key_name NOT IN ('catalogue_billing_enabled', 'custom_lines_enabled')
     )
     OR NOT (p_payload ? 'catalogue_billing_enabled')
     OR NOT (p_payload ? 'custom_lines_enabled')
  THEN
    RAISE EXCEPTION 'Invalid billing capabilities payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_catalogue_enabled := (p_payload ->> 'catalogue_billing_enabled')::boolean;
    v_custom_enabled := (p_payload ->> 'custom_lines_enabled')::boolean;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid billing capability value' USING ERRCODE = '22023';
  END;

  SELECT id, role::text AS role, tenant_id, is_active
  INTO v_profile
  FROM public.user_profiles
  WHERE id = auth.uid();
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE
     OR v_profile.role NOT IN ('owner', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id
  INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND OR (
    v_profile.role <> 'super_admin'
    AND v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.branches
  SET catalogue_billing_enabled = v_catalogue_enabled,
      custom_lines_enabled = v_custom_enabled
  WHERE id = v_branch.id;

  IF to_regprocedure(
    'public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)'
  ) IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_billing_capabilities_updated',
      v_branch.tenant_id,
      v_branch.id,
      v_profile.id,
      v_profile.role,
      'branch',
      v_branch.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'catalogue_billing_enabled', v_catalogue_enabled,
        'custom_lines_enabled', v_custom_enabled
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'branch_id', v_branch.id,
    'catalogue_billing_enabled', v_catalogue_enabled,
    'custom_lines_enabled', v_custom_enabled
  );
END
$function$;

ALTER FUNCTION public.update_branch_billing_capabilities(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_branch_billing_capabilities(uuid, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_branch_billing_capabilities(uuid, jsonb)
  TO authenticated;

-- Retain the reviewed commercial dispatcher for every catalogue-only request,
-- including package-unit callers from other clients.  The new function below
-- remains at the existing capability delegate's OID.
DO $preserve_checkout_delegate$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.pos_checkout_capability_pre_billing_lines_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef(
      'public.pos_checkout_capability_base_v1(jsonb)'::regprocedure
    );
    v_definition := replace(
      v_definition,
      'FUNCTION public.pos_checkout_capability_base_v1(',
      'FUNCTION public.pos_checkout_capability_pre_billing_lines_v1('
    );
    IF v_definition NOT LIKE '%pos_checkout_capability_pre_billing_lines_v1%' THEN
      RAISE EXCEPTION 'BILLING_LINES_CHECKOUT_DELEGATE_UNREVIEWED';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$preserve_checkout_delegate$;

ALTER FUNCTION public.pos_checkout_capability_pre_billing_lines_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_capability_pre_billing_lines_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_checkout_capability_pre_billing_lines_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pos_checkout_custom_lines_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_branch record;
  v_customer record;
  v_existing record;
  v_product record;
  v_item jsonb;
  v_line jsonb;
  v_payment jsonb;
  v_items jsonb := p_payload -> 'items';
  v_payments_json jsonb := p_payload -> 'payments';
  v_item_rows jsonb := '[]'::jsonb;
  v_existing_items jsonb := '[]'::jsonb;
  v_payment_rows jsonb := '[]'::jsonb;
  v_existing_payments jsonb := '[]'::jsonb;
  v_branch_id uuid;
  v_customer_id uuid;
  v_session_id uuid;
  v_product_id uuid;
  v_idempotency_key text;
  v_request_fingerprint text;
  v_payment_method text;
  v_display_payment_method text;
  v_note text;
  v_source text;
  v_custom_name text;
  v_custom_name_ar text;
  v_custom_unit_price numeric(12, 2);
  v_line_sku text;
  v_line_unit text;
  v_stock_tracked_at_sale boolean;
  v_service_item_at_sale boolean;
  v_invoice_id uuid := pg_catalog.gen_random_uuid();
  v_invoice_number text;
  v_invoice_prefix text;
  v_zatca_invoice_type public.invoice_type := 'simplified';
  v_qty numeric(12, 3);
  v_amount_paid numeric(12, 2);
  v_counter bigint;
  v_sort_order integer;
  v_vat_mode text;
  v_vat_treatment text;
  v_tax_category text;
  v_rate_percent numeric(5, 2);
  v_rate numeric(8, 6);
  v_change_amount numeric(12, 2) := 0;
  v_existing_amount_received numeric(12, 2);
  v_existing_change_amount numeric(12, 2);
  v_existing_payment_count integer := 0;
  v_existing_cash_amount numeric(12, 2) := 0;
  v_existing_card_amount numeric(12, 2) := 0;
  v_line_amount numeric(16, 4);
  v_line_subtotal numeric(12, 2);
  v_line_tax numeric(12, 2);
  v_line_total numeric(12, 2);
  v_subtotal numeric(12, 2) := 0;
  v_tax_amount numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_created_at timestamptz := now();
  v_is_split_payment boolean := false;
  v_split_method text;
  v_split_amount numeric(12, 2);
  v_split_total numeric(12, 2) := 0;
  v_split_cash_amount numeric(12, 2) := 0;
  v_split_card_amount numeric(12, 2) := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_payload) key_name
       WHERE key_name NOT IN (
         'branch_id', 'customer_id', 'session_id', 'payment_method',
         'amount_paid', 'payments', 'note', 'idempotency_key', 'items'
       )
     )
  THEN
    RAISE EXCEPTION 'Invalid checkout payload' USING ERRCODE = '22023';
  END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array'
     OR jsonb_array_length(v_items) = 0
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_items) item
       WHERE jsonb_typeof(item) <> 'object'
     )
  THEN
    RAISE EXCEPTION 'Checkout requires at least one item' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'catalogue'
      AND EXISTS (
        SELECT 1 FROM jsonb_object_keys(item) key_name
        WHERE key_name NOT IN ('source', 'product_id', 'quantity')
      )
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'custom'
      AND EXISTS (
        SELECT 1 FROM jsonb_object_keys(item) key_name
        WHERE key_name NOT IN ('source', 'name', 'name_ar', 'quantity', 'unit_price', 'vat_treatment')
      )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') NOT IN ('catalogue', 'custom')
  ) THEN
    RAISE EXCEPTION 'Unsupported checkout item field' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_branch_id := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;
    v_customer_id := NULLIF(btrim(COALESCE(p_payload ->> 'customer_id', '')), '')::uuid;
    v_session_id := NULLIF(btrim(COALESCE(p_payload ->> 'session_id', '')), '')::uuid;
    v_amount_paid := NULLIF(btrim(COALESCE(p_payload ->> 'amount_paid', '')), '')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid checkout identifier or amount' USING ERRCODE = '22023';
  END;
  v_idempotency_key := NULLIF(btrim(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  v_payment_method := COALESCE(NULLIF(btrim(p_payload ->> 'payment_method'), ''), 'cash');
  v_note := NULLIF(btrim(COALESCE(p_payload ->> 'note', '')), '');
  v_is_split_payment := v_payments_json IS NOT NULL;
  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023'; END IF;
  IF v_idempotency_key IS NULL OR length(v_idempotency_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Checkout note is too long' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
  INTO v_profile FROM public.user_profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;
  SELECT id, tenant_id, name, invoice_prefix, vat_mode, is_active,
         COALESCE(allow_split_payments, false) AS allow_split_payments,
         catalogue_billing_enabled, custom_lines_enabled
  INTO v_branch FROM public.branches WHERE id = v_branch_id;
  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;
  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role NOT IN ('owner', 'admin', 'super_admin') OR (
    v_profile.role <> 'super_admin' AND v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'custom'
  ) AND v_branch.custom_lines_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Custom billing lines are not enabled for this branch' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'catalogue'
  ) AND v_branch.catalogue_billing_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Catalogue billing is not enabled for this branch' USING ERRCODE = '42501';
  END IF;
  IF v_is_split_payment THEN
    IF v_branch.allow_split_payments IS NOT TRUE
       OR jsonb_typeof(v_payments_json) <> 'array'
       OR jsonb_array_length(v_payments_json) <> 2 THEN
      RAISE EXCEPTION 'Split Payment is not enabled or is invalid for this branch' USING ERRCODE = '42501';
    END IF;
    v_payment_method := 'other'; v_display_payment_method := 'split';
  ELSE
    IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
      RAISE EXCEPTION 'Unsupported payment method' USING ERRCODE = '22023';
    END IF;
    v_display_payment_method := v_payment_method;
  END IF;

  -- Product locks use the same stable order as catalogue-only checkout.
  BEGIN
    PERFORM 1 FROM public.products p
    WHERE p.id IN (
      SELECT NULLIF(btrim(item ->> 'product_id'), '')::uuid
      FROM jsonb_array_elements(v_items) item
      WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'catalogue'
    )
    ORDER BY p.id FOR UPDATE;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid checkout item identifier' USING ERRCODE = '22023';
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_branch.id::text || ':' || v_idempotency_key, 0));
  v_request_fingerprint := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  SELECT id, invoice_number, created_at, subtotal, tax_amount, total_amount,
         payment_method, zatca_invoice_type, payment_status,
         checkout_request_fingerprint, document_language
  INTO v_existing FROM public.invoices
  WHERE branch_id = v_branch.id AND checkout_idempotency_key = v_idempotency_key;
  IF FOUND THEN
    IF v_existing.checkout_request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH' USING ERRCODE = '23505';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id, 'name', name, 'name_ar', name_ar, 'sku', sku,
      'unit', unit, 'quantity', quantity, 'unit_price', unit_price,
      'line_source', line_source, 'stock_tracked_at_sale', stock_tracked_at_sale,
      'line_amount', round(unit_price * quantity, 2), 'subtotal', subtotal,
      'tax_rate', tax_rate, 'tax_category', tax_category, 'tax_amount', tax_amount,
      'total', total, 'sort_order', sort_order
    ) ORDER BY sort_order, id), '[]'::jsonb)
    INTO v_existing_items FROM public.invoice_items WHERE invoice_id = v_existing.id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'method', method::text, 'amount', amount, 'amount_received', amount_received,
      'change_amount', change_amount
    ) ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST, id), '[]'::jsonb)
    INTO v_existing_payments FROM public.payments WHERE invoice_id = v_existing.id;
    SELECT COUNT(*)::integer,
      COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN method = 'card' THEN amount ELSE 0 END), 0)
    INTO v_existing_payment_count, v_existing_cash_amount, v_existing_card_amount
    FROM public.payments WHERE invoice_id = v_existing.id;
    SELECT COALESCE(amount_received, amount, v_existing.total_amount), COALESCE(change_amount, 0)
    INTO v_existing_amount_received, v_existing_change_amount
    FROM public.payments WHERE invoice_id = v_existing.id
    ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST LIMIT 1;
    IF NOT FOUND THEN v_existing_amount_received := v_existing.total_amount; v_existing_change_amount := 0; END IF;
    v_display_payment_method := CASE WHEN v_existing_payment_count > 1
      AND v_existing_cash_amount > 0 AND v_existing_card_amount > 0 THEN 'split'
      ELSE COALESCE(v_existing.payment_method::text, 'cash') END;
    RETURN jsonb_build_object(
      'invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number,
      'document_language', v_existing.document_language, 'created_at', v_existing.created_at,
      'subtotal', v_existing.subtotal, 'tax_amount', v_existing.tax_amount,
      'total', v_existing.total_amount, 'payment_method', v_existing.payment_method,
      'display_payment_method', v_display_payment_method, 'payment_status', v_existing.payment_status,
      'amount_received', v_existing_amount_received, 'change_amount', v_existing_change_amount,
      'payments', v_existing_payments, 'zatca_invoice_type', v_existing.zatca_invoice_type,
      'items', v_existing_items, 'idempotent_replay', true
    );
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_branch.tenant_id
    AND (COALESCE(t.is_active, true) IS NOT TRUE OR t.suspended_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Account is suspended. Please contact the business owner or Kubri support.' USING ERRCODE = '42501';
  END IF;
  -- A custom line cannot be used to avoid stock controls for an active tracked
  -- item with the same checkout identifier.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items) item
    JOIN public.products p ON p.tenant_id = v_branch.tenant_id
      AND p.branch_id = v_branch.id AND p.is_active IS TRUE
      AND p.is_available IS TRUE AND p.track_stock IS TRUE AND p.is_service IS NOT TRUE
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'custom'
      AND (
        lower(btrim(p.name)) = lower(btrim(item ->> 'name'))
        OR lower(COALESCE(btrim(p.sku), '')) = lower(btrim(item ->> 'name'))
        OR lower(COALESCE(btrim(p.barcode), '')) = lower(btrim(item ->> 'name'))
      )
  ) THEN
    RAISE EXCEPTION 'Custom line matches an active tracked catalogue product' USING ERRCODE = '23514';
  END IF;
  IF v_customer_id IS NOT NULL THEN
    SELECT id, customer_type, vat_number, is_active INTO v_customer
    FROM public.customers WHERE id = v_customer_id AND tenant_id = v_branch.tenant_id AND branch_id = v_branch.id;
    IF NOT FOUND OR v_customer.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Customer not found or inactive' USING ERRCODE = '42501';
    END IF;
    IF v_customer.customer_type = 'business' AND COALESCE(v_customer.vat_number, '') ~ '^3[0-9]{13}3$' THEN
      v_zatca_invoice_type := 'standard';
    END IF;
  END IF;
  IF v_session_id IS NOT NULL THEN
    PERFORM 1 FROM public.pos_sessions WHERE id = v_session_id AND tenant_id = v_branch.tenant_id
      AND branch_id = v_branch.id AND status = 'open';
    IF NOT FOUND THEN RAISE EXCEPTION 'POS session is not open for this branch' USING ERRCODE = '42501'; END IF;
  END IF;
  v_vat_mode := CASE WHEN COALESCE(v_branch.vat_mode, 'exclusive') IN ('exclusive', 'inclusive')
    THEN COALESCE(v_branch.vat_mode, 'exclusive') ELSE 'exclusive' END;

  FOR v_item, v_sort_order IN
    SELECT value, (ordinality - 1)::integer FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(value, ordinality)
  LOOP
    v_source := COALESCE(NULLIF(btrim(v_item ->> 'source'), ''), 'catalogue');
    BEGIN
      v_qty := NULLIF(btrim(COALESCE(v_item ->> 'quantity', '')), '')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid checkout item quantity' USING ERRCODE = '22023';
    END;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 1000000 OR round(v_qty, 3) <> v_qty THEN
      RAISE EXCEPTION 'Invalid checkout item quantity' USING ERRCODE = '22023';
    END IF;
    IF v_source = 'catalogue' THEN
      BEGIN v_product_id := NULLIF(btrim(COALESCE(v_item ->> 'product_id', '')), '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid checkout item' USING ERRCODE = '22023'; END;
      IF v_product_id IS NULL THEN RAISE EXCEPTION 'Invalid checkout item' USING ERRCODE = '22023'; END IF;
      SELECT id, tenant_id, branch_id, name, name_ar, sku, unit, price, tax_rate,
             tax_category, is_taxable, vat_treatment, is_service, stock_quantity,
             track_stock, is_active, is_available
      INTO v_product FROM public.products
      WHERE id = v_product_id AND tenant_id = v_branch.tenant_id AND branch_id = v_branch.id FOR UPDATE;
      IF NOT FOUND OR v_product.is_active IS NOT TRUE OR v_product.is_available IS NOT TRUE THEN
        RAISE EXCEPTION 'Product is not available for checkout' USING ERRCODE = '42501';
      END IF;
      v_vat_treatment := COALESCE(v_product.vat_treatment, 'inherit');
      IF v_vat_treatment = 'inherit' THEN v_vat_treatment := v_vat_mode; END IF;
      IF v_vat_treatment = 'exempt' OR v_product.is_taxable IS FALSE THEN
        v_rate_percent := 0; v_tax_category := COALESCE(NULLIF(v_product.tax_category, ''), 'O'); v_vat_treatment := 'exempt';
      ELSE
        v_rate_percent := COALESCE(v_product.tax_rate, 15); v_tax_category := COALESCE(NULLIF(v_product.tax_category, ''), 'S');
      END IF;
      v_custom_name := v_product.name; v_custom_name_ar := v_product.name_ar;
      v_custom_unit_price := v_product.price;
      v_line_sku := v_product.sku;
      v_line_unit := COALESCE(v_product.unit, 'pcs');
      v_stock_tracked_at_sale := public.branch_effective_stock_enabled(v_branch.tenant_id, v_branch.id)
        AND COALESCE(v_product.track_stock, false)
        AND COALESCE(v_product.is_service, false) IS FALSE;
      v_service_item_at_sale := COALESCE(v_product.is_service, false);
      v_line_amount := COALESCE(v_product.price, 0) * v_qty;
    ELSE
      v_product_id := NULL;
      v_custom_name := btrim(COALESCE(v_item ->> 'name', ''));
      v_custom_name_ar := NULLIF(btrim(COALESCE(v_item ->> 'name_ar', '')), '');
      BEGIN v_custom_unit_price := NULLIF(btrim(COALESCE(v_item ->> 'unit_price', '')), '')::numeric;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Invalid custom line price' USING ERRCODE = '22023';
      END;
      v_vat_treatment := COALESCE(NULLIF(btrim(v_item ->> 'vat_treatment'), ''), 'inherit');
      IF length(v_custom_name) NOT BETWEEN 1 AND 200 OR length(COALESCE(v_custom_name_ar, '')) > 200
         OR v_custom_unit_price IS NULL OR v_custom_unit_price < 0 OR v_custom_unit_price > 99999999.99
         OR round(v_custom_unit_price, 2) <> v_custom_unit_price
         -- The current ZATCA XML builder supports standard-rate lines only.
         -- Keep custom lines within that existing fiscal contract; catalogue
         -- products retain their historical VAT treatment behaviour.
         OR v_vat_treatment NOT IN ('inherit', 'exclusive', 'inclusive') THEN
        RAISE EXCEPTION 'Invalid custom billing line' USING ERRCODE = '22023';
      END IF;
      IF v_vat_treatment = 'inherit' THEN v_vat_treatment := v_vat_mode; END IF;
      v_rate_percent := 15;
      v_tax_category := 'S';
      v_line_sku := NULL;
      v_line_unit := 'pcs';
      v_stock_tracked_at_sale := false;
      v_service_item_at_sale := true;
      v_line_amount := v_custom_unit_price * v_qty;
    END IF;
    IF v_line_amount > 9999999999.99::numeric THEN RAISE EXCEPTION 'Checkout line amount is too large' USING ERRCODE = '22003'; END IF;
    v_rate := v_rate_percent / 100;
    IF v_vat_treatment = 'inclusive' AND v_rate > 0 THEN
      v_line_total := round(v_line_amount, 2); v_line_subtotal := round(v_line_total / (1 + v_rate), 2); v_line_tax := v_line_total - v_line_subtotal;
    ELSIF v_vat_treatment = 'exclusive' AND v_rate > 0 THEN
      v_line_subtotal := round(v_line_amount, 2); v_line_tax := round(v_line_subtotal * v_rate, 2); v_line_total := v_line_subtotal + v_line_tax;
    ELSE
      v_line_subtotal := round(v_line_amount, 2); v_line_tax := 0; v_line_total := v_line_subtotal;
    END IF;
    IF v_source = 'catalogue' AND v_stock_tracked_at_sale THEN
      UPDATE public.products SET stock_quantity = stock_quantity - v_qty
      WHERE id = v_product.id AND COALESCE(stock_quantity, 0) >= v_qty;
      IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for product %', v_product.name USING ERRCODE = '23514'; END IF;
    END IF;
    v_subtotal := v_subtotal + v_line_subtotal; v_tax_amount := v_tax_amount + v_line_tax; v_total := v_total + v_line_total;
    v_item_rows := v_item_rows || jsonb_build_array(jsonb_build_object(
      'line_source', v_source, 'product_id', v_product_id, 'name', v_custom_name,
      'name_ar', v_custom_name_ar, 'sku', v_line_sku,
      'unit', v_line_unit,
      'quantity', v_qty, 'unit_price', v_custom_unit_price, 'line_amount', round(v_line_amount, 2),
      'tax_rate', v_rate, 'tax_category', v_tax_category, 'subtotal', v_line_subtotal,
      'tax_amount', v_line_tax, 'total', v_line_total, 'sort_order', v_sort_order,
      'stock_tracked_at_sale', v_stock_tracked_at_sale,
      'service_item_at_sale', v_service_item_at_sale
    ));
  END LOOP;
  v_subtotal := round(v_subtotal, 2); v_tax_amount := round(v_tax_amount, 2); v_total := round(v_total, 2);
  IF v_is_split_payment THEN
    FOR v_payment IN SELECT value FROM jsonb_array_elements(v_payments_json) t(value) LOOP
      v_split_method := NULLIF(btrim(COALESCE(v_payment ->> 'method', '')), '');
      BEGIN v_split_amount := round(NULLIF(btrim(COALESCE(v_payment ->> 'amount', '')), '')::numeric, 2);
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid Split Payment amount' USING ERRCODE = '22023'; END;
      IF v_split_method NOT IN ('cash', 'card') OR v_split_amount IS NULL OR v_split_amount <= 0 THEN
        RAISE EXCEPTION 'Split Payment supports positive cash and card amounts only' USING ERRCODE = '22023';
      END IF;
      IF v_split_method = 'cash' THEN
        IF v_split_cash_amount > 0 THEN RAISE EXCEPTION 'Split Payment can include only one cash amount' USING ERRCODE = '22023'; END IF;
        v_split_cash_amount := v_split_amount;
      ELSE
        IF v_split_card_amount > 0 THEN RAISE EXCEPTION 'Split Payment can include only one card amount' USING ERRCODE = '22023'; END IF;
        v_split_card_amount := v_split_amount;
      END IF;
      v_split_total := v_split_total + v_split_amount;
    END LOOP;
    IF v_split_cash_amount <= 0 OR v_split_card_amount <= 0 OR abs(v_split_total - v_total) > 0.01 THEN
      RAISE EXCEPTION 'Split Payment amounts must equal invoice total' USING ERRCODE = '23514';
    END IF;
    v_payment_rows := jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', v_split_cash_amount, 'amount_received', v_split_cash_amount, 'change_amount', 0), jsonb_build_object('method', 'card', 'amount', v_split_card_amount, 'amount_received', v_split_card_amount, 'change_amount', 0));
    v_amount_paid := v_total; v_change_amount := 0;
  ELSE
    IF v_amount_paid IS NULL OR v_payment_method IN ('card', 'bank_transfer') THEN v_amount_paid := v_total; END IF;
    IF v_payment_method = 'cash' AND COALESCE(v_amount_paid, 0) + 0.005 < v_total THEN RAISE EXCEPTION 'Amount paid is less than invoice total' USING ERRCODE = '23514'; END IF;
    v_amount_paid := round(v_amount_paid, 2);
    v_change_amount := CASE WHEN v_payment_method = 'cash' THEN GREATEST(round(v_amount_paid - v_total, 2), 0) ELSE 0 END;
    v_payment_rows := jsonb_build_array(jsonb_build_object('method', v_payment_method, 'amount', v_total, 'amount_received', v_amount_paid, 'change_amount', v_change_amount));
  END IF;
  v_counter := public.get_next_invoice_counter(v_branch.id);
  v_invoice_prefix := COALESCE(NULLIF(btrim(v_branch.invoice_prefix), ''), 'INV');
  v_invoice_number := v_invoice_prefix || '-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');
  INSERT INTO public.invoices (
    id, tenant_id, branch_id, customer_id, created_by, session_id, invoice_number,
    checkout_idempotency_key, checkout_request_fingerprint, zatca_invoice_type, zatca_type_code,
    zatca_status, subtotal, discount_amount, taxable_amount, tax_amount, total_amount,
    currency_code, invoice_date, payment_method, status, payment_status, notes, created_at
  ) VALUES (
    v_invoice_id, v_branch.tenant_id, v_branch.id, v_customer_id, v_user_id, v_session_id,
    v_invoice_number, v_idempotency_key, v_request_fingerprint, v_zatca_invoice_type, '388',
    'pending', v_subtotal, 0, v_subtotal, v_tax_amount, v_total, 'SAR',
    (v_created_at AT TIME ZONE 'Asia/Riyadh')::date, v_payment_method::public.payment_method,
    'posted', 'paid', v_note, v_created_at
  );
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_item_rows) t(value) LOOP
    INSERT INTO public.invoice_items (
      invoice_id, tenant_id, product_id, name, name_ar, sku, unit, quantity, unit_price,
      discount_percent, discount_amount, subtotal, tax_rate, tax_category, tax_amount, total,
      sort_order, line_source, stock_tracked_at_sale, service_item_at_sale
    ) VALUES (
      v_invoice_id, v_branch.tenant_id, NULLIF(v_line ->> 'product_id', '')::uuid,
      v_line ->> 'name', v_line ->> 'name_ar', v_line ->> 'sku', v_line ->> 'unit',
      (v_line ->> 'quantity')::numeric, (v_line ->> 'unit_price')::numeric, 0, 0,
      (v_line ->> 'subtotal')::numeric, (v_line ->> 'tax_rate')::numeric, v_line ->> 'tax_category',
      (v_line ->> 'tax_amount')::numeric, (v_line ->> 'total')::numeric, (v_line ->> 'sort_order')::integer,
      v_line ->> 'line_source', (v_line ->> 'stock_tracked_at_sale')::boolean,
      (v_line ->> 'service_item_at_sale')::boolean
    );
    IF (v_line ->> 'stock_tracked_at_sale')::boolean IS TRUE THEN
      INSERT INTO public.pos_stock_movements (tenant_id, branch_id, product_id, invoice_id, quantity_delta, reason, created_by)
      VALUES (v_branch.tenant_id, v_branch.id, (v_line ->> 'product_id')::uuid, v_invoice_id,
        -((v_line ->> 'quantity')::numeric), 'pos_sale', v_user_id);
    END IF;
  END LOOP;
  FOR v_payment IN SELECT value FROM jsonb_array_elements(v_payment_rows) t(value) LOOP
    INSERT INTO public.payments (tenant_id, invoice_id, recorded_by, amount, amount_received, change_amount, method, paid_at)
    VALUES (v_branch.tenant_id, v_invoice_id, v_user_id, (v_payment ->> 'amount')::numeric,
      (v_payment ->> 'amount_received')::numeric, (v_payment ->> 'change_amount')::numeric,
      (v_payment ->> 'method')::public.payment_method, v_created_at);
  END LOOP;
  IF v_is_split_payment AND to_regprocedure('public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)') IS NOT NULL THEN
    PERFORM public.record_audit_event('pos_split_payment_checkout', v_branch.tenant_id, v_branch.id,
      v_user_id, v_profile.role, 'invoice', v_invoice_id, 'info', 'succeeded',
      jsonb_build_object('payment_count', 2, 'cash_amount', v_split_cash_amount,
        'card_amount', v_split_card_amount, 'invoice_total', v_total), NULL, NULL);
  END IF;
  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number,
    'document_language', (SELECT document_language FROM public.invoices WHERE id = v_invoice_id),
    'created_at', v_created_at, 'subtotal', v_subtotal, 'tax_amount', v_tax_amount, 'total', v_total,
    'payment_method', v_payment_method, 'display_payment_method', v_display_payment_method,
    'payment_status', 'paid', 'amount_received', v_amount_paid, 'change_amount', v_change_amount,
    'payments', v_payment_rows, 'zatca_invoice_type', v_zatca_invoice_type,
    'items', v_item_rows, 'idempotent_replay', false
  );
END
$function$;

ALTER FUNCTION public.pos_checkout_custom_lines_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_custom_lines_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_checkout_custom_lines_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.pos_checkout_capability_base_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_branch record;
  v_items jsonb;
  v_catalogue_items jsonb;
  v_has_custom boolean := false;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid checkout payload' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid checkout identifier' USING ERRCODE = '22023';
  END;
  v_items := p_payload -> 'items';
  IF v_branch_id IS NULL OR v_items IS NULL OR jsonb_typeof(v_items) <> 'array'
     OR jsonb_array_length(v_items) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) item WHERE jsonb_typeof(item) <> 'object') THEN
    RAISE EXCEPTION 'Invalid checkout payload' USING ERRCODE = '22023';
  END IF;
  SELECT id, catalogue_billing_enabled, custom_lines_enabled INTO v_branch
  FROM public.branches WHERE id = v_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') NOT IN ('catalogue', 'custom')) THEN
    RAISE EXCEPTION 'Unsupported checkout item source' USING ERRCODE = '22023';
  END IF;
  v_has_custom := EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'custom');
  IF v_has_custom AND v_branch.custom_lines_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Custom billing lines are not enabled for this branch' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) item
    WHERE COALESCE(NULLIF(btrim(item ->> 'source'), ''), 'catalogue') = 'catalogue')
    AND v_branch.catalogue_billing_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Catalogue billing is not enabled for this branch' USING ERRCODE = '42501';
  END IF;
  IF v_has_custom THEN
    RETURN public.pos_checkout_custom_lines_v1(p_payload);
  END IF;
  SELECT jsonb_agg(item - 'source') INTO v_catalogue_items FROM jsonb_array_elements(v_items) item;
  PERFORM set_config('app.checkout_line_source', 'catalogue', true);
  RETURN public.pos_checkout_capability_pre_billing_lines_v1(
    jsonb_set(p_payload, '{items}', v_catalogue_items, true)
  );
END
$function$;

ALTER FUNCTION public.pos_checkout_capability_base_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_capability_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_checkout_capability_base_v1(jsonb) TO service_role;

-- Preserve the existing public credit-note dispatcher under a private name and
-- keep the public OID for refund wrappers and atomic checkout callers.
DO $preserve_credit_delegate$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.create_partial_credit_note_pre_billing_lines_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef('public.create_partial_credit_note(jsonb)'::regprocedure);
    v_definition := replace(v_definition,
      'FUNCTION public.create_partial_credit_note(',
      'FUNCTION public.create_partial_credit_note_pre_billing_lines_v1(');
    IF v_definition NOT LIKE '%create_partial_credit_note_pre_billing_lines_v1%' THEN
      RAISE EXCEPTION 'BILLING_LINES_CREDIT_DELEGATE_UNREVIEWED';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$preserve_credit_delegate$;

ALTER FUNCTION public.create_partial_credit_note_pre_billing_lines_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_pre_billing_lines_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_pre_billing_lines_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_partial_credit_note(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_result jsonb;
  v_credit_note_id uuid;
  v_original record;
  v_request_return_stock boolean;
  v_credit_item record;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid credit note payload' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_request_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, false);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid return stock flag' USING ERRCODE = '22023';
  END;
  v_result := public.create_partial_credit_note_pre_billing_lines_v1(
    jsonb_set(p_payload, '{return_stock}', 'false'::jsonb, true)
  );
  IF COALESCE((v_result ->> 'idempotent_replay')::boolean, false) OR NOT v_request_return_stock THEN
    RETURN v_result;
  END IF;
  v_credit_note_id := NULLIF(v_result ->> 'credit_note_invoice_id', '')::uuid;
  SELECT original_invoice_id, tenant_id, branch_id INTO v_original
  FROM public.invoices WHERE id = v_credit_note_id FOR UPDATE;
  IF NOT FOUND OR v_original.original_invoice_id IS NULL
     OR public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id) IS NOT TRUE THEN
    RETURN v_result;
  END IF;
  PERFORM 1 FROM public.products p
  JOIN public.invoice_items ci ON ci.product_id = p.id AND ci.invoice_id = v_credit_note_id
  JOIN public.invoice_items oi ON oi.id = ci.original_invoice_item_id
    AND oi.invoice_id = v_original.original_invoice_id
  WHERE oi.line_source <> 'custom'
    AND COALESCE(oi.stock_tracked_at_sale, p.track_stock, false)
    AND COALESCE(oi.service_item_at_sale, p.is_service, false) IS FALSE
  ORDER BY p.id FOR UPDATE OF p;
  FOR v_credit_item IN
    SELECT ci.id AS credit_item_id, ci.product_id,
      COALESCE(ci.base_quantity, ci.quantity) AS restore_quantity,
      ci.product_unit_id, ci.product_unit_version, ci.package_quantity,
      ci.conversion_to_base, ci.selling_unit_name, ci.base_unit_name,
      oi.line_source, oi.stock_tracked_at_sale, oi.service_item_at_sale,
      p.track_stock, p.is_service
    FROM public.invoice_items ci
    JOIN public.invoice_items oi ON oi.id = ci.original_invoice_item_id
      AND oi.invoice_id = v_original.original_invoice_id
    LEFT JOIN public.products p ON p.id = ci.product_id
      AND p.tenant_id = v_original.tenant_id AND p.branch_id = v_original.branch_id
    WHERE ci.invoice_id = v_credit_note_id
    ORDER BY ci.id
  LOOP
    UPDATE public.invoice_items
    SET line_source = COALESCE(v_credit_item.line_source, 'legacy'),
        stock_tracked_at_sale = CASE WHEN v_credit_item.line_source = 'custom' THEN false
          ELSE COALESCE(v_credit_item.stock_tracked_at_sale, v_credit_item.track_stock, false) END,
        service_item_at_sale = CASE WHEN v_credit_item.line_source = 'custom' THEN true
          ELSE COALESCE(v_credit_item.service_item_at_sale, v_credit_item.is_service, false) END
    WHERE id = v_credit_item.credit_item_id;
    IF v_credit_item.product_id IS NOT NULL
       AND COALESCE(v_credit_item.line_source, 'legacy') <> 'custom'
       AND COALESCE(v_credit_item.stock_tracked_at_sale, v_credit_item.track_stock, false)
       AND COALESCE(v_credit_item.service_item_at_sale, v_credit_item.is_service, false) IS FALSE
    THEN
      UPDATE public.products SET stock_quantity = COALESCE(stock_quantity, 0) + v_credit_item.restore_quantity
      WHERE id = v_credit_item.product_id AND tenant_id = v_original.tenant_id AND branch_id = v_original.branch_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Stock return failed for credited item' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.pos_stock_movements (
        tenant_id, branch_id, product_id, invoice_id, quantity_delta, reason, created_by,
        product_unit_id, product_unit_version, package_quantity, conversion_to_base,
        base_quantity, selling_unit_name, base_unit_name
      ) VALUES (
        v_original.tenant_id, v_original.branch_id, v_credit_item.product_id, v_credit_note_id,
        v_credit_item.restore_quantity, 'refund_return', auth.uid(),
        v_credit_item.product_unit_id, v_credit_item.product_unit_version,
        v_credit_item.package_quantity, v_credit_item.conversion_to_base,
        v_credit_item.restore_quantity, v_credit_item.selling_unit_name,
        v_credit_item.base_unit_name
      );
    END IF;
  END LOOP;
  RETURN v_result;
END
$function$;

ALTER FUNCTION public.create_partial_credit_note(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_partial_credit_note(jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_invoice_refundable_items_v3(p_invoice_id uuid)
RETURNS TABLE (
  original_invoice_item_id uuid, name text, name_ar text, sku text, unit text,
  product_id uuid, original_quantity numeric, credited_quantity numeric,
  remaining_quantity numeric, unit_price numeric, subtotal numeric,
  discount_amount numeric, tax_rate numeric, tax_amount numeric, total numeric,
  credited_subtotal numeric, credited_discount_amount numeric,
  credited_tax_amount numeric, credited_total numeric, remaining_subtotal numeric,
  remaining_discount_amount numeric, remaining_tax_amount numeric, remaining_total numeric,
  track_stock boolean, is_service boolean, line_source text,
  stock_tracked_at_sale boolean, restock_eligible boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT r.original_invoice_item_id, r.name, r.name_ar, r.sku, r.unit,
    r.product_id, r.original_quantity, r.credited_quantity, r.remaining_quantity,
    r.unit_price, r.subtotal, r.discount_amount, r.tax_rate, r.tax_amount, r.total,
    r.credited_subtotal, r.credited_discount_amount, r.credited_tax_amount,
    r.credited_total, r.remaining_subtotal, r.remaining_discount_amount,
    r.remaining_tax_amount, r.remaining_total,
    r.track_stock, r.is_service, COALESCE(oi.line_source, 'legacy'),
    COALESCE(oi.stock_tracked_at_sale, r.track_stock),
    (
      COALESCE(oi.line_source, 'legacy') <> 'custom'
      AND COALESCE(oi.stock_tracked_at_sale, r.track_stock, false)
      AND COALESCE(oi.service_item_at_sale, r.is_service, false) IS FALSE
    ) AS restock_eligible
  FROM public.get_invoice_refundable_items(p_invoice_id) r
  JOIN public.invoice_items oi ON oi.id = r.original_invoice_item_id
    AND oi.invoice_id = p_invoice_id
  ORDER BY oi.sort_order, oi.created_at, oi.id
$function$;

ALTER FUNCTION public.get_invoice_refundable_items_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_invoice_refundable_items_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_refundable_items_v3(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
