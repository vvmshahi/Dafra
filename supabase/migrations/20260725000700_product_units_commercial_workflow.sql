BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Package-aware calls keep an exact, server-computed request fingerprint on
-- the commercial document. Legacy rows remain NULL and are not rewritten.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS checkout_request_fingerprint text,
  ADD COLUMN IF NOT EXISTS credit_note_request_fingerprint text;

-- Phase 1 permits a selling-unit quantity scale up to six decimals. Widen only
-- the customer-facing commercial quantity column so a valid package fraction
-- is never rounded to the legacy three-decimal typmod. Existing numeric values
-- remain numerically identical; no historical package snapshot is backfilled.
DO $invoice_quantity_precision$
DECLARE
  v_precision integer;
  v_scale integer;
BEGIN
  SELECT numeric_precision, numeric_scale
  INTO v_precision, v_scale
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'invoice_items'
    AND column_name = 'quantity';

  IF v_precision = 12 AND v_scale = 3 THEN
    ALTER TABLE public.invoice_items
      ALTER COLUMN quantity TYPE numeric(18, 6);
  ELSIF v_precision IS DISTINCT FROM 18 OR v_scale IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'PRODUCT_UNITS_INVOICE_QUANTITY_TYPE_UNREVIEWED';
  END IF;
END
$invoice_quantity_precision$;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_checkout_request_fingerprint_format'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_checkout_request_fingerprint_format
      CHECK (
        checkout_request_fingerprint IS NULL
        OR checkout_request_fingerprint ~ '^[a-f0-9]{64}$'
      )
      NOT VALID;
  END IF;
END
$constraint$;

DO $credit_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_credit_note_request_fingerprint_format'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_credit_note_request_fingerprint_format
      CHECK (
        credit_note_request_fingerprint IS NULL
        OR credit_note_request_fingerprint ~ '^[a-f0-9]{64}$'
      )
      NOT VALID;
  END IF;
END
$credit_constraint$;

COMMENT ON COLUMN public.invoices.checkout_request_fingerprint IS
  'Server-side SHA-256 fingerprint for package-aware commercial request replay protection. NULL preserves legacy checkout behavior.';

COMMENT ON COLUMN public.invoices.credit_note_request_fingerprint IS
  'Server-side SHA-256 fingerprint for package-aware historical-return replay protection. NULL preserves legacy credit-note behavior.';

-- This is the only authoritative resolver for a current selling or receiving
-- unit. Browser callers supply identity, expected version and quantity only.
CREATE OR REPLACE FUNCTION public.resolve_product_commercial_unit(
  p_product_id uuid,
  p_product_unit_id uuid,
  p_package_quantity numeric,
  p_expected_product_unit_version integer,
  p_operation text
)
RETURNS TABLE (
  product_id uuid,
  tenant_id uuid,
  branch_id uuid,
  product_unit_id uuid,
  product_unit_version integer,
  is_base boolean,
  selling_unit_name text,
  selling_unit_name_ar text,
  selling_unit_code text,
  package_quantity_scale smallint,
  conversion_to_base numeric,
  package_quantity numeric,
  base_quantity numeric,
  pricing_method text,
  base_unit_price numeric,
  package_unit_price numeric,
  base_unit_name text,
  base_unit_name_ar text,
  base_unit_code text,
  base_quantity_scale smallint,
  selling_enabled boolean,
  receiving_enabled boolean,
  unit_active boolean,
  effective_stock_enabled boolean,
  stock_tracked boolean,
  service_item boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_product record;
  v_unit public.product_units%ROWTYPE;
  v_base public.product_units%ROWTYPE;
  v_quantity numeric;
  v_base_quantity numeric;
  v_package_price numeric;
BEGIN
  IF p_product_id IS NULL
     OR p_package_quantity IS NULL
     OR p_package_quantity <= 0
     OR p_operation NOT IN ('sell', 'receive')
  THEN
    RAISE EXCEPTION 'Invalid product unit request'
      USING ERRCODE = '22023';
  END IF;

  IF p_package_quantity > 999999999999::numeric THEN
    RAISE EXCEPTION 'Package quantity is too large'
      USING ERRCODE = '22003';
  END IF;

  SELECT
    p.id,
    p.tenant_id,
    p.branch_id,
    p.price,
    p.track_stock,
    p.is_service,
    p.is_active,
    p.is_available,
    b.is_active AS branch_is_active,
    t.is_active AS tenant_is_active,
    COALESCE(t.business_type, 'trading') AS business_type
  INTO v_product
  FROM public.products p
  JOIN public.branches b
    ON b.id = p.branch_id
   AND b.tenant_id = p.tenant_id
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = p_product_id;

  IF NOT FOUND
     OR v_product.is_active IS NOT TRUE
     OR v_product.branch_is_active IS NOT TRUE
     OR v_product.tenant_is_active IS NOT TRUE
  THEN
    RAISE EXCEPTION 'Product not found or inactive'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation = 'sell' AND v_product.is_available IS NOT TRUE THEN
    RAISE EXCEPTION 'Product is not available for checkout'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_base
  FROM public.product_units pu
  WHERE pu.product_id = v_product.id
    AND pu.tenant_id = v_product.tenant_id
    AND pu.branch_id = v_product.branch_id
    AND pu.is_base IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product base unit is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF p_product_unit_id IS NULL THEN
    v_unit := v_base;
  ELSE
    SELECT *
    INTO v_unit
    FROM public.product_units pu
    WHERE pu.id = p_product_unit_id
      AND pu.product_id = v_product.id
      AND pu.tenant_id = v_product.tenant_id
      AND pu.branch_id = v_product.branch_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product unit does not belong to this product and branch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_unit.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Product unit is inactive'
      USING ERRCODE = '23514';
  END IF;

  IF p_expected_product_unit_version IS NOT NULL
     AND p_expected_product_unit_version <> v_unit.version
  THEN
    RAISE EXCEPTION 'Product unit changed; reload the unit'
      USING ERRCODE = '40001';
  END IF;

  IF p_operation = 'sell' AND v_unit.selling_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Product unit is not enabled for selling'
      USING ERRCODE = '23514';
  END IF;

  IF p_operation = 'receive' AND v_unit.receiving_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Product unit is not enabled for receiving'
      USING ERRCODE = '23514';
  END IF;

  IF p_operation = 'receive'
     AND (
       v_product.business_type = 'service'
       OR COALESCE(v_product.is_service, false)
     )
  THEN
    RAISE EXCEPTION 'Service products cannot receive stock'
      USING ERRCODE = '23514';
  END IF;

  v_quantity := p_package_quantity;
  IF round(v_quantity, v_unit.quantity_scale) <> v_quantity THEN
    RAISE EXCEPTION 'Package quantity has unsupported decimal precision'
      USING ERRCODE = '22023';
  END IF;

  v_base_quantity := v_quantity * v_unit.conversion_to_base;
  IF v_base_quantity <= 0
     OR v_base_quantity > 999999999.999::numeric
     OR round(
       v_base_quantity,
       LEAST(v_base.quantity_scale, 3)
     ) <> v_base_quantity
  THEN
    RAISE EXCEPTION 'Package quantity does not produce an exact valid base quantity'
      USING ERRCODE = '22023';
  END IF;

  v_package_price := CASE
    WHEN v_unit.pricing_method = 'custom'
      THEN v_unit.custom_selling_price
    ELSE round(COALESCE(v_product.price, 0) * v_unit.conversion_to_base, 2)
  END;

  IF v_package_price IS NULL
     OR v_package_price < 0
     OR v_package_price > 999999999999.99::numeric
  THEN
    RAISE EXCEPTION 'Product unit price is invalid'
      USING ERRCODE = '22003';
  END IF;

  RETURN QUERY SELECT
    v_product.id,
    v_product.tenant_id,
    v_product.branch_id,
    v_unit.id,
    v_unit.version,
    v_unit.is_base,
    v_unit.name::text,
    v_unit.name_ar::text,
    v_unit.unit_code::text,
    v_unit.quantity_scale,
    v_unit.conversion_to_base,
    v_quantity,
    v_base_quantity,
    v_unit.pricing_method,
    COALESCE(v_product.price, 0)::numeric,
    v_package_price,
    v_base.name::text,
    v_base.name_ar::text,
    v_base.unit_code::text,
    LEAST(v_base.quantity_scale, 3)::smallint,
    v_unit.selling_enabled,
    v_unit.receiving_enabled,
    v_unit.is_active,
    public.branch_effective_stock_enabled(v_product.tenant_id, v_product.branch_id),
    COALESCE(v_product.track_stock, false),
    COALESCE(v_product.is_service, false);
END
$function$;

ALTER FUNCTION public.resolve_product_commercial_unit(
  uuid, uuid, numeric, integer, text
) OWNER TO postgres;

COMMENT ON FUNCTION public.resolve_product_commercial_unit(
  uuid, uuid, numeric, integer, text
) IS
  'Private authoritative unit resolver. Derives price, conversion, base quantity, scope, eligibility and stock policy from locked database state.';

REVOKE ALL ON FUNCTION public.resolve_product_commercial_unit(
  uuid, uuid, numeric, integer, text
) FROM PUBLIC, anon, authenticated, service_role;

-- POS loads all eligible selling units in one scoped request. The current
-- price is informational; checkout resolves it again under row locks.
CREATE OR REPLACE FUNCTION public.get_branch_selling_product_units(
  p_branch_id uuid
)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  name text,
  name_ar text,
  unit_code text,
  conversion_to_base numeric,
  quantity_scale smallint,
  pricing_method text,
  resolved_selling_price numeric,
  is_base boolean,
  sort_order integer,
  version integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope
  FROM public.assert_product_write_access(p_branch_id);

  RETURN QUERY
  SELECT
    pu.id,
    pu.product_id,
    pu.name::text,
    pu.name_ar::text,
    pu.unit_code::text,
    pu.conversion_to_base,
    pu.quantity_scale,
    pu.pricing_method,
    CASE
      WHEN pu.pricing_method = 'custom' THEN pu.custom_selling_price
      ELSE round(COALESCE(p.price, 0) * pu.conversion_to_base, 2)
    END,
    pu.is_base,
    pu.sort_order,
    pu.version
  FROM public.products p
  JOIN public.product_units pu
    ON pu.product_id = p.id
   AND pu.tenant_id = p.tenant_id
   AND pu.branch_id = p.branch_id
  WHERE p.tenant_id = v_scope.tenant_id
    AND p.branch_id = v_scope.branch_id
    AND p.is_active IS TRUE
    AND p.is_available IS TRUE
    AND pu.is_active IS TRUE
    AND pu.selling_enabled IS TRUE
  ORDER BY p.sort_order, p.name, pu.is_base DESC, pu.sort_order, pu.id;
END
$function$;

ALTER FUNCTION public.get_branch_selling_product_units(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_branch_selling_product_units(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_branch_selling_product_units(uuid)
  TO authenticated, service_role;

-- Keep the reviewed legacy checkout definition byte-for-byte under a private
-- name. The public wrapper below delegates every quantity-only request to it.
DO $preserve_legacy_checkout$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.pos_checkout_legacy_base_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure);
    IF md5(v_definition) <> '0db582cb8451ab6a6a69bb9d9d662de6'
       OR v_definition NOT LIKE '%branch_effective_stock_enabled(v_branch.tenant_id, v_branch.id)%'
       OR v_definition NOT LIKE '%Reviewed atomic compatibility%'
       OR v_definition NOT LIKE '%''document_language''%'
    THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_POS_LEGACY_DEFINITION_UNREVIEWED';
    END IF;
    ALTER FUNCTION public.pos_checkout(jsonb)
      RENAME TO pos_checkout_legacy_base_v1;
  END IF;
END
$preserve_legacy_checkout$;

ALTER FUNCTION public.pos_checkout_legacy_base_v1(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_legacy_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_checkout_legacy_base_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pos_checkout_with_product_units_v1(
  p_payload jsonb
)
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
  v_resolved record;
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
  v_product_unit_id uuid;
  v_expected_version integer;
  v_idempotency_key text;
  v_request_fingerprint text;
  v_payment_method text;
  v_display_payment_method text;
  v_note text;
  v_invoice_id uuid := pg_catalog.gen_random_uuid();
  v_invoice_number text;
  v_invoice_prefix text;
  v_zatca_invoice_type public.invoice_type := 'simplified';
  v_qty numeric;
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
  v_line_amount numeric;
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

  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid checkout payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) key_name
    WHERE key_name NOT IN (
      'branch_id', 'customer_id', 'session_id', 'payment_method',
      'amount_paid', 'payments', 'note', 'idempotency_key', 'items'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported checkout field' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_branch_id := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;
    v_customer_id := NULLIF(btrim(COALESCE(p_payload ->> 'customer_id', '')), '')::uuid;
    v_session_id := NULLIF(btrim(COALESCE(p_payload ->> 'session_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid checkout identifier' USING ERRCODE = '22023';
  END;

  v_idempotency_key := NULLIF(btrim(COALESCE(p_payload ->> 'idempotency_key', '')), '');
  v_payment_method := COALESCE(NULLIF(btrim(p_payload ->> 'payment_method'), ''), 'cash');
  v_note := NULLIF(btrim(COALESCE(p_payload ->> 'note', '')), '');
  BEGIN
    v_amount_paid := NULLIF(btrim(COALESCE(p_payload ->> 'amount_paid', '')), '')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid amount paid' USING ERRCODE = '22023';
  END;
  v_is_split_payment := v_payments_json IS NOT NULL;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023';
  END IF;
  IF v_idempotency_key IS NULL OR length(v_idempotency_key) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Checkout note is too long' USING ERRCODE = '22023';
  END IF;
  IF v_items IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Checkout requires at least one item' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items) item
    CROSS JOIN LATERAL jsonb_object_keys(item) key_name
    WHERE key_name NOT IN (
      'product_id', 'product_unit_id', 'package_quantity',
      'expected_product_unit_version'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported checkout item field' USING ERRCODE = '22023';
  END IF;

  v_request_fingerprint := encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT id, role::text AS role, tenant_id, branch_id, full_name, is_active
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT
    id, tenant_id, name, invoice_prefix, vat_mode, is_active,
    COALESCE(allow_split_payments, false) AS allow_split_payments
  INTO v_branch
  FROM public.branches
  WHERE id = v_branch_id;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_is_split_payment THEN
    IF v_branch.allow_split_payments IS NOT TRUE
       OR jsonb_typeof(v_payments_json) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_payments_json) <> 2
    THEN
      RAISE EXCEPTION 'Split Payment is not enabled or is invalid for this branch'
        USING ERRCODE = '42501';
    END IF;
    v_payment_method := 'other';
    v_display_payment_method := 'split';
  ELSE
    IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
      RAISE EXCEPTION 'Unsupported payment method' USING ERRCODE = '22023';
    END IF;
    v_display_payment_method := v_payment_method;
  END IF;

  -- Same lock order for Piece/Carton and competing carts prevents lost stock
  -- updates and avoids unit/product lock inversions.
  BEGIN
    PERFORM 1
    FROM public.products p
    WHERE p.id IN (
      SELECT NULLIF(btrim(item ->> 'product_id'), '')::uuid
      FROM jsonb_array_elements(v_items) item
    )
    ORDER BY p.id
    FOR UPDATE;

    PERFORM 1
    FROM public.product_units pu
    WHERE pu.id IN (
      SELECT COALESCE(
        NULLIF(btrim(item ->> 'product_unit_id'), '')::uuid,
        (
          SELECT base.id
          FROM public.product_units base
          WHERE base.product_id = NULLIF(btrim(item ->> 'product_id'), '')::uuid
            AND base.is_base IS TRUE
        )
      )
      FROM jsonb_array_elements(v_items) item
    )
    ORDER BY pu.id
    FOR UPDATE;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid checkout item identifier' USING ERRCODE = '22023';
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_branch.id::text || ':' || v_idempotency_key, 0)
  );

  SELECT
    id, invoice_number, created_at, subtotal, tax_amount, total_amount,
    payment_method, zatca_invoice_type, payment_status,
    checkout_request_fingerprint, document_language
  INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_branch.id
    AND checkout_idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing.checkout_request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH'
        USING ERRCODE = '23505';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', product_id,
      'product_unit_id', product_unit_id,
      'product_unit_version', product_unit_version,
      'name', name,
      'name_ar', name_ar,
      'sku', sku,
      'unit', unit,
      'selling_unit_name', selling_unit_name,
      'selling_unit_name_ar', selling_unit_name_ar,
      'selling_unit_code', selling_unit_code,
      'quantity', quantity,
      'package_quantity', package_quantity,
      'package_quantity_scale', package_quantity_scale,
      'conversion_to_base', conversion_to_base,
      'base_quantity', base_quantity,
      'base_unit_name', base_unit_name,
      'base_unit_name_ar', base_unit_name_ar,
      'base_unit_code', base_unit_code,
      'base_quantity_scale', base_quantity_scale,
      'package_pricing_method', package_pricing_method,
      'base_unit_price', base_unit_price,
      'package_unit_price', package_unit_price,
      'stock_tracked_at_sale', stock_tracked_at_sale,
      'service_item_at_sale', service_item_at_sale,
      'unit_price', unit_price,
      'line_amount', round(unit_price * quantity, 2),
      'subtotal', subtotal,
      'tax_rate', tax_rate,
      'tax_category', tax_category,
      'tax_amount', tax_amount,
      'total', total,
      'sort_order', sort_order
    ) ORDER BY sort_order, id), '[]'::jsonb)
    INTO v_existing_items
    FROM public.invoice_items
    WHERE invoice_id = v_existing.id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'method', method::text,
      'amount', amount,
      'amount_received', amount_received,
      'change_amount', change_amount
    ) ORDER BY paid_at ASC NULLS LAST, created_at ASC NULLS LAST, id), '[]'::jsonb)
    INTO v_existing_payments
    FROM public.payments
    WHERE invoice_id = v_existing.id;

    SELECT
      COUNT(*)::integer,
      COALESCE(SUM(CASE WHEN method = 'cash' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN method = 'card' THEN amount ELSE 0 END), 0)
    INTO
      v_existing_payment_count,
      v_existing_cash_amount,
      v_existing_card_amount
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
       AND v_existing_card_amount > 0 THEN 'split'
      ELSE COALESCE(v_existing.payment_method::text, 'cash')
    END;

    RETURN jsonb_build_object(
      'invoice_id', v_existing.id,
      'invoice_number', v_existing.invoice_number,
      'document_language', v_existing.document_language,
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

  IF EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = v_branch.tenant_id
      AND (
        COALESCE(t.is_active, true) IS NOT TRUE
        OR t.suspended_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Account is suspended. Please contact the business owner or Kubri support.'
      USING ERRCODE = '42501';
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
      RAISE EXCEPTION 'POS session is not open for this branch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_vat_mode := CASE
    WHEN COALESCE(v_branch.vat_mode, 'exclusive') IN ('exclusive', 'inclusive')
      THEN COALESCE(v_branch.vat_mode, 'exclusive')
    ELSE 'exclusive'
  END;

  FOR v_item, v_sort_order IN
    SELECT value, (ordinality - 1)::integer
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(value, ordinality)
  LOOP
    BEGIN
      v_product_id := NULLIF(btrim(COALESCE(v_item ->> 'product_id', '')), '')::uuid;
      v_product_unit_id := NULLIF(btrim(COALESCE(v_item ->> 'product_unit_id', '')), '')::uuid;
      v_qty := NULLIF(btrim(COALESCE(v_item ->> 'package_quantity', '')), '')::numeric;
      v_expected_version := NULLIF(
        btrim(COALESCE(v_item ->> 'expected_product_unit_version', '')),
        ''
      )::integer;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Invalid checkout item' USING ERRCODE = '22023';
    END;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_expected_version IS NULL THEN
      RAISE EXCEPTION 'Package-aware checkout requires product, unit quantity and version'
        USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_resolved
    FROM public.resolve_product_commercial_unit(
      v_product_id,
      v_product_unit_id,
      v_qty,
      v_expected_version,
      'sell'
    );

    IF v_resolved.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_resolved.branch_id IS DISTINCT FROM v_branch.id
    THEN
      RAISE EXCEPTION 'Product belongs to another branch'
        USING ERRCODE = '42501';
    END IF;

    SELECT
      p.name, p.name_ar, p.sku, p.tax_rate, p.tax_category,
      p.is_taxable, p.vat_treatment
    INTO v_product
    FROM public.products p
    WHERE p.id = v_resolved.product_id
      AND p.tenant_id = v_resolved.tenant_id
      AND p.branch_id = v_resolved.branch_id;

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
    v_line_amount := v_resolved.package_unit_price * v_resolved.package_quantity;
    IF v_line_amount > 9999999999.99::numeric THEN
      RAISE EXCEPTION 'Checkout line amount is too large' USING ERRCODE = '22003';
    END IF;

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

    IF v_resolved.effective_stock_enabled
       AND v_resolved.stock_tracked
       AND NOT v_resolved.service_item
    THEN
      UPDATE public.products
      SET stock_quantity = stock_quantity - v_resolved.base_quantity
      WHERE id = v_resolved.product_id
        AND tenant_id = v_resolved.tenant_id
        AND branch_id = v_resolved.branch_id
        AND COALESCE(stock_quantity, 0) >= v_resolved.base_quantity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for product %', v_product.name
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total := v_total + v_line_total;

    v_item_rows := v_item_rows || jsonb_build_array(jsonb_build_object(
      'product_id', v_resolved.product_id,
      'product_unit_id', v_resolved.product_unit_id,
      'product_unit_version', v_resolved.product_unit_version,
      'name', v_product.name,
      'name_ar', v_product.name_ar,
      'sku', v_product.sku,
      'unit', v_resolved.selling_unit_name,
      'selling_unit_name', v_resolved.selling_unit_name,
      'selling_unit_name_ar', v_resolved.selling_unit_name_ar,
      'selling_unit_code', v_resolved.selling_unit_code,
      'package_quantity', v_resolved.package_quantity,
      'package_quantity_scale', v_resolved.package_quantity_scale,
      'conversion_to_base', v_resolved.conversion_to_base,
      'base_quantity', v_resolved.base_quantity,
      'base_unit_name', v_resolved.base_unit_name,
      'base_unit_name_ar', v_resolved.base_unit_name_ar,
      'base_unit_code', v_resolved.base_unit_code,
      'base_quantity_scale', v_resolved.base_quantity_scale,
      'package_pricing_method', v_resolved.pricing_method,
      'base_unit_price', v_resolved.base_unit_price,
      'package_unit_price', v_resolved.package_unit_price,
      'stock_tracked_at_sale', (
        v_resolved.effective_stock_enabled
        AND v_resolved.stock_tracked
        AND NOT v_resolved.service_item
      ),
      'service_item_at_sale', v_resolved.service_item,
      'quantity', v_resolved.package_quantity,
      'unit_price', v_resolved.package_unit_price,
      'line_amount', round(v_line_amount, 2),
      'tax_rate', v_rate,
      'tax_category', v_tax_category,
      'subtotal', v_line_subtotal,
      'tax_amount', v_line_tax,
      'total', v_line_total,
      'sort_order', v_sort_order
    ));
  END LOOP;

  v_subtotal := round(v_subtotal, 2);
  v_tax_amount := round(v_tax_amount, 2);
  v_total := round(v_total, 2);

  IF v_is_split_payment THEN
    FOR v_payment IN
      SELECT value FROM jsonb_array_elements(v_payments_json) t(value)
    LOOP
      v_split_method := NULLIF(btrim(COALESCE(v_payment ->> 'method', '')), '');
      BEGIN
        v_split_amount := round(
          NULLIF(btrim(COALESCE(v_payment ->> 'amount', '')), '')::numeric,
          2
        );
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Invalid Split Payment amount' USING ERRCODE = '22023';
      END;
      IF v_split_method NOT IN ('cash', 'card')
         OR v_split_amount IS NULL OR v_split_amount <= 0 THEN
        RAISE EXCEPTION 'Split Payment supports positive cash and card amounts only'
          USING ERRCODE = '22023';
      END IF;
      IF v_split_method = 'cash' THEN
        IF v_split_cash_amount > 0 THEN
          RAISE EXCEPTION 'Split Payment can include only one cash amount'
            USING ERRCODE = '22023';
        END IF;
        v_split_cash_amount := v_split_amount;
      ELSE
        IF v_split_card_amount > 0 THEN
          RAISE EXCEPTION 'Split Payment can include only one card amount'
            USING ERRCODE = '22023';
        END IF;
        v_split_card_amount := v_split_amount;
      END IF;
      v_split_total := v_split_total + v_split_amount;
    END LOOP;

    IF v_split_cash_amount <= 0 OR v_split_card_amount <= 0
       OR abs(v_split_total - v_total) > 0.01 THEN
      RAISE EXCEPTION 'Split Payment amounts must equal invoice total'
        USING ERRCODE = '23514';
    END IF;
    v_payment_rows := jsonb_build_array(
      jsonb_build_object(
        'method', 'cash', 'amount', v_split_cash_amount,
        'amount_received', v_split_cash_amount, 'change_amount', 0
      ),
      jsonb_build_object(
        'method', 'card', 'amount', v_split_card_amount,
        'amount_received', v_split_card_amount, 'change_amount', 0
      )
    );
    v_amount_paid := v_total;
    v_change_amount := 0;
  ELSE
    IF v_amount_paid IS NULL OR v_payment_method IN ('card', 'bank_transfer') THEN
      v_amount_paid := v_total;
    END IF;
    IF v_payment_method = 'cash' AND COALESCE(v_amount_paid, 0) + 0.005 < v_total THEN
      RAISE EXCEPTION 'Amount paid is less than invoice total'
        USING ERRCODE = '23514';
    END IF;
    v_amount_paid := round(v_amount_paid, 2);
    v_change_amount := CASE
      WHEN v_payment_method = 'cash'
        THEN GREATEST(round(v_amount_paid - v_total, 2), 0)
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
  v_invoice_prefix := COALESCE(NULLIF(btrim(v_branch.invoice_prefix), ''), 'INV');
  v_invoice_number := v_invoice_prefix || '-' || lpad(COALESCE(v_counter, 1)::text, 4, '0');

  INSERT INTO public.invoices (
    id, tenant_id, branch_id, customer_id, created_by, session_id,
    invoice_number, checkout_idempotency_key, checkout_request_fingerprint,
    zatca_invoice_type, zatca_type_code, zatca_status,
    subtotal, discount_amount, taxable_amount, tax_amount, total_amount,
    currency_code, invoice_date, payment_method, status, payment_status,
    notes, created_at
  ) VALUES (
    v_invoice_id, v_branch.tenant_id, v_branch.id, v_customer_id, v_user_id,
    v_session_id, v_invoice_number, v_idempotency_key, v_request_fingerprint,
    v_zatca_invoice_type, '388', 'pending',
    v_subtotal, 0, v_subtotal, v_tax_amount, v_total,
    'SAR', (v_created_at AT TIME ZONE 'Asia/Riyadh')::date,
    v_payment_method::public.payment_method, 'posted', 'paid',
    v_note, v_created_at
  );

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(v_item_rows) t(value)
  LOOP
    INSERT INTO public.invoice_items (
      invoice_id, tenant_id, product_id, name, name_ar, sku, unit,
      quantity, unit_price, discount_percent, discount_amount,
      subtotal, tax_rate, tax_category, tax_amount, total, sort_order,
      product_unit_id, product_unit_version,
      selling_unit_name, selling_unit_name_ar, selling_unit_code,
      package_quantity, package_quantity_scale, conversion_to_base,
      base_quantity, base_unit_name, base_unit_name_ar, base_unit_code,
      base_quantity_scale, package_pricing_method, base_unit_price,
      package_unit_price, stock_tracked_at_sale, service_item_at_sale
    ) VALUES (
      v_invoice_id, v_branch.tenant_id,
      (v_line ->> 'product_id')::uuid,
      v_line ->> 'name', v_line ->> 'name_ar', v_line ->> 'sku',
      v_line ->> 'selling_unit_name',
      (v_line ->> 'package_quantity')::numeric,
      (v_line ->> 'package_unit_price')::numeric,
      0, 0,
      (v_line ->> 'subtotal')::numeric,
      (v_line ->> 'tax_rate')::numeric,
      v_line ->> 'tax_category',
      (v_line ->> 'tax_amount')::numeric,
      (v_line ->> 'total')::numeric,
      (v_line ->> 'sort_order')::integer,
      (v_line ->> 'product_unit_id')::uuid,
      (v_line ->> 'product_unit_version')::integer,
      v_line ->> 'selling_unit_name',
      v_line ->> 'selling_unit_name_ar',
      v_line ->> 'selling_unit_code',
      (v_line ->> 'package_quantity')::numeric,
      (v_line ->> 'package_quantity_scale')::smallint,
      (v_line ->> 'conversion_to_base')::numeric,
      (v_line ->> 'base_quantity')::numeric,
      v_line ->> 'base_unit_name',
      v_line ->> 'base_unit_name_ar',
      v_line ->> 'base_unit_code',
      (v_line ->> 'base_quantity_scale')::smallint,
      v_line ->> 'package_pricing_method',
      (v_line ->> 'base_unit_price')::numeric,
      (v_line ->> 'package_unit_price')::numeric,
      (v_line ->> 'stock_tracked_at_sale')::boolean,
      (v_line ->> 'service_item_at_sale')::boolean
    );

    PERFORM public.mark_product_unit_used(
      (v_line ->> 'product_unit_id')::uuid
    );

    IF (v_line ->> 'stock_tracked_at_sale')::boolean IS TRUE THEN
      INSERT INTO public.pos_stock_movements (
        tenant_id, branch_id, product_id, invoice_id,
        quantity_delta, reason, created_by,
        product_unit_id, product_unit_version, package_quantity,
        conversion_to_base, base_quantity, selling_unit_name, base_unit_name
      ) VALUES (
        v_branch.tenant_id, v_branch.id,
        (v_line ->> 'product_id')::uuid,
        v_invoice_id,
        -((v_line ->> 'base_quantity')::numeric),
        'pos_sale', v_user_id,
        (v_line ->> 'product_unit_id')::uuid,
        (v_line ->> 'product_unit_version')::integer,
        (v_line ->> 'package_quantity')::numeric,
        (v_line ->> 'conversion_to_base')::numeric,
        (v_line ->> 'base_quantity')::numeric,
        v_line ->> 'selling_unit_name',
        v_line ->> 'base_unit_name'
      );
    END IF;
  END LOOP;

  FOR v_payment IN
    SELECT value FROM jsonb_array_elements(v_payment_rows) t(value)
  LOOP
    INSERT INTO public.payments (
      tenant_id, invoice_id, recorded_by, amount, amount_received,
      change_amount, method, paid_at
    ) VALUES (
      v_branch.tenant_id, v_invoice_id, v_user_id,
      (v_payment ->> 'amount')::numeric,
      (v_payment ->> 'amount_received')::numeric,
      (v_payment ->> 'change_amount')::numeric,
      (v_payment ->> 'method')::public.payment_method,
      v_created_at
    );
  END LOOP;

  IF v_is_split_payment
     AND to_regprocedure(
       'public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)'
     ) IS NOT NULL
  THEN
    PERFORM public.record_audit_event(
      'pos_split_payment_checkout',
      v_branch.tenant_id, v_branch.id, v_user_id, v_profile.role,
      'invoice', v_invoice_id, 'info', 'succeeded',
      jsonb_build_object(
        'payment_count', 2,
        'cash_amount', v_split_cash_amount,
        'card_amount', v_split_card_amount,
        'invoice_total', v_total
      ),
      NULL, NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'document_language', (
      SELECT document_language FROM public.invoices WHERE id = v_invoice_id
    ),
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
END
$function$;

ALTER FUNCTION public.pos_checkout_with_product_units_v1(jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.pos_checkout_with_product_units_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_checkout(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF p_payload IS NOT NULL
     AND jsonb_typeof(p_payload -> 'items') = 'array'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_payload -> 'items') item
       WHERE item ? 'product_unit_id'
          OR item ? 'package_quantity'
          OR item ? 'expected_product_unit_version'
     )
  THEN
    RETURN public.pos_checkout_with_product_units_v1(p_payload);
  END IF;

  RETURN public.pos_checkout_legacy_base_v1(p_payload);
END
$function$;

ALTER FUNCTION public.pos_checkout(jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.pos_checkout(jsonb) IS
  'Package-aware POS checkout dispatcher. Legacy quantity-only requests retain the reviewed base-unit implementation; explicit unit requests use authoritative server-side unit resolution.';

REVOKE ALL ON FUNCTION public.pos_checkout(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb)
  TO authenticated, service_role;

-- Preserve the reviewed historical credit-note implementation. Package credit
-- notes use it with stock restoration forced off, then add immutable package
-- snapshots and one authoritative base-unit restoration in the same database
-- transaction.
DO $preserve_legacy_credit$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.create_partial_credit_note_legacy_base_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef(
      'public.create_partial_credit_note(jsonb)'::regprocedure
    );
    IF md5(v_definition) <> '9d9b05d14a501ebfb887e9172b9c1fe2'
       OR v_definition NOT LIKE '%branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id)%'
       OR v_definition NOT LIKE '%Reviewed atomic compatibility%'
       OR v_definition NOT LIKE '%sandbox_validated_with_warnings%'
    THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_CREDIT_LEGACY_DEFINITION_UNREVIEWED';
    END IF;
    ALTER FUNCTION public.create_partial_credit_note(jsonb)
      RENAME TO create_partial_credit_note_legacy_base_v1;
  END IF;
END
$preserve_legacy_credit$;

ALTER FUNCTION public.create_partial_credit_note_legacy_base_v1(jsonb)
  OWNER TO postgres;

-- The reviewed credit-note body remains authoritative. Its temporary request
-- quantity must match the widened invoice quantity so a six-decimal package
-- return is not rounded before cumulative/refund calculations. Values at the
-- legacy three-decimal precision behave identically.
DO $widen_legacy_credit_request_quantity$
DECLARE
  v_definition text;
  v_widened text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.create_partial_credit_note_legacy_base_v1(jsonb)'::regprocedure
  );
  v_widened := v_definition;
  IF v_definition ~* 'quantity[[:space:]]+numeric\(12,[[:space:]]*3\)' THEN
    v_widened := regexp_replace(
      v_widened,
      'quantity[[:space:]]+numeric\(12,[[:space:]]*3\)',
      'quantity NUMERIC(18, 6)',
      'i'
    );
    IF v_widened ~* 'quantity[[:space:]]+numeric\(12,[[:space:]]*3\)' THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_CREDIT_QUANTITY_PRECISION_AMBIGUOUS';
    END IF;
  ELSIF v_definition !~* 'quantity[[:space:]]+numeric\(18,[[:space:]]*6\)' THEN
    RAISE EXCEPTION 'PRODUCT_UNITS_CREDIT_QUANTITY_PRECISION_UNREVIEWED';
  END IF;

  IF strpos(v_widened, '0.0005') > 0 THEN
    v_widened := replace(v_widened, '0.0005', '0.0000005');
  ELSIF strpos(v_widened, '0.0000005') = 0 THEN
    RAISE EXCEPTION 'PRODUCT_UNITS_CREDIT_QUANTITY_TOLERANCE_UNREVIEWED';
  END IF;

  IF v_widened IS DISTINCT FROM v_definition THEN
    EXECUTE v_widened;
  END IF;
END
$widen_legacy_credit_request_quantity$;

-- The split-refund wrapper validates refund_allocations before it removes that
-- field for the legacy commercial call. Preserve the validated allocation
-- intent in the internal payload so package replay fingerprints distinguish a
-- changed cash/card allocation without trusting a browser-computed hash.
DO $include_refund_allocation_in_package_fingerprint$
DECLARE
  v_definition text;
  v_anchor text :=
    'v_legacy_payload := jsonb_set(p_payload - ''refund_allocations'', ''{refund_method}'', to_jsonb(v_method), TRUE);';
  v_replacement text := $replacement$v_legacy_payload := jsonb_set(
    jsonb_set(
      p_payload - 'refund_allocations',
      '{refund_method}',
      to_jsonb(v_method),
      TRUE
    ),
    '{refund_allocation_intent}',
    v_allocations,
    TRUE
  );$replacement$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.create_partial_credit_note_with_refund(jsonb)'::regprocedure
  );
  -- pg_get_functiondef preserves the text[] path with braces. Match that
  -- normalized expression so a second manual execution recognizes the patch
  -- and does not look for the pre-patch single-line anchor again.
  IF v_definition NOT LIKE '%''{refund_allocation_intent}''%' THEN
    IF md5(v_definition) <> '3e0c27664ae59b78ab51066a612ca6e5' THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_REFUND_DEFINITION_UNREVIEWED';
    END IF;
    IF strpos(v_definition, v_anchor) = 0 THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_REFUND_FINGERPRINT_ANCHOR_MISSING';
    END IF;
    v_definition := replace(v_definition, v_anchor, v_replacement);
    EXECUTE v_definition;
  END IF;
END
$include_refund_allocation_in_package_fingerprint$;

ALTER FUNCTION public.create_partial_credit_note_with_refund(jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_partial_credit_note_legacy_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_legacy_base_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_partial_credit_note_with_product_units_v1(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_original_id uuid;
  v_idempotency_key text;
  v_return_stock boolean;
  v_items jsonb;
  v_fingerprint text;
  v_original record;
  v_existing record;
  v_request record;
  v_result jsonb;
  v_credit_note_id uuid;
  v_replay boolean;
  v_effective_return_stock boolean;
  v_mismatch_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid credit note payload' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_original_id := NULLIF(
      btrim(COALESCE(p_payload ->> 'original_invoice_id', '')),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid original invoice' USING ERRCODE = '22023';
  END;
  v_idempotency_key := NULLIF(
    btrim(COALESCE(p_payload ->> 'idempotency_key', '')),
    ''
  );
  v_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, false);
  v_items := p_payload -> 'items';

  IF v_original_id IS NULL
     OR v_idempotency_key IS NULL
     OR length(v_idempotency_key) NOT BETWEEN 8 AND 120
     OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) = 0
  THEN
    RAISE EXCEPTION 'Invalid package credit note request'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items) item
    CROSS JOIN LATERAL jsonb_object_keys(item) key_name
    WHERE key_name NOT IN ('original_invoice_item_id', 'quantity')
  ) THEN
    RAISE EXCEPTION 'Unsupported credit note item field'
      USING ERRCODE = '22023';
  END IF;

  v_fingerprint := encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT
    i.id, i.tenant_id, i.branch_id, i.zatca_invoice_type::text AS invoice_type,
    i.status::text AS status, b.is_active AS branch_is_active
  INTO v_original
  FROM public.invoices i
  JOIN public.branches b
    ON b.id = i.branch_id
   AND b.tenant_id = i.tenant_id
  WHERE i.id = v_original_id
  FOR UPDATE OF i;

  IF NOT FOUND OR v_original.branch_is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Original invoice not found or branch inactive'
      USING ERRCODE = '42501';
  END IF;

  -- Match the established lock domain before any cumulative-return decision.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('partial-credit-note:' || v_original.id::text, 0)
  );

  SELECT id, credit_note_request_fingerprint
  INTO v_existing
  FROM public.invoices
  WHERE branch_id = v_original.branch_id
    AND credit_note_idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND
     AND v_existing.credit_note_request_fingerprint IS DISTINCT FROM v_fingerprint
  THEN
    RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH'
      USING ERRCODE = '23505';
  END IF;

  DROP TABLE IF EXISTS pg_temp.package_credit_request;
  CREATE TEMP TABLE pg_temp.package_credit_request (
    original_invoice_item_id uuid PRIMARY KEY,
    return_quantity numeric NOT NULL
  ) ON COMMIT DROP;

  BEGIN
    INSERT INTO pg_temp.package_credit_request (
      original_invoice_item_id,
      return_quantity
    )
    SELECT
      NULLIF(btrim(item ->> 'original_invoice_item_id'), '')::uuid,
      NULLIF(btrim(item ->> 'quantity'), '')::numeric
    FROM jsonb_array_elements(v_items) item;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range
      OR not_null_violation OR unique_violation THEN
      RAISE EXCEPTION 'Invalid or duplicate returned item'
        USING ERRCODE = '22023';
  END;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.package_credit_request r
    LEFT JOIN public.invoice_items oi
      ON oi.id = r.original_invoice_item_id
     AND oi.invoice_id = v_original.id
    WHERE oi.id IS NULL
       OR r.return_quantity <= 0
       OR (
         oi.product_unit_id IS NOT NULL
         AND (
           oi.package_quantity IS NULL
           OR oi.package_quantity_scale IS NULL
           OR oi.conversion_to_base IS NULL
           OR oi.base_quantity_scale IS NULL
           OR round(
             r.return_quantity,
             oi.package_quantity_scale
           ) <> r.return_quantity
           OR round(
             r.return_quantity * oi.conversion_to_base,
             oi.base_quantity_scale
           ) <> r.return_quantity * oi.conversion_to_base
         )
       )
  ) THEN
    RAISE EXCEPTION 'Invalid fractional package return'
      USING ERRCODE = '22023';
  END IF;

  -- The reviewed legacy implementation remains authoritative for locking,
  -- cumulative quantities, proportional tax/discount, numbering, payments,
  -- demo eligibility and refund limits. It cannot restore package stock.
  v_result := public.create_partial_credit_note_legacy_base_v1(
    jsonb_set(p_payload, '{return_stock}', 'false'::jsonb, true)
  );
  v_credit_note_id := (v_result ->> 'credit_note_invoice_id')::uuid;
  v_replay := COALESCE((v_result ->> 'idempotent_replay')::boolean, false);

  IF v_replay THEN
    RETURN v_result;
  END IF;

  UPDATE public.invoices
  SET credit_note_request_fingerprint = v_fingerprint
  WHERE id = v_credit_note_id
    AND original_invoice_id = v_original.id
    AND tenant_id = v_original.tenant_id
    AND branch_id = v_original.branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Package credit note identity mismatch'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.invoice_items ci
  SET product_unit_id = oi.product_unit_id,
      product_unit_version = oi.product_unit_version,
      selling_unit_name = oi.selling_unit_name,
      selling_unit_name_ar = oi.selling_unit_name_ar,
      selling_unit_code = oi.selling_unit_code,
      package_quantity = ci.quantity,
      package_quantity_scale = oi.package_quantity_scale,
      conversion_to_base = oi.conversion_to_base,
      base_quantity = ci.quantity * oi.conversion_to_base,
      base_unit_name = oi.base_unit_name,
      base_unit_name_ar = oi.base_unit_name_ar,
      base_unit_code = oi.base_unit_code,
      base_quantity_scale = oi.base_quantity_scale,
      package_pricing_method = oi.package_pricing_method,
      base_unit_price = oi.base_unit_price,
      package_unit_price = oi.package_unit_price,
      stock_tracked_at_sale = oi.stock_tracked_at_sale,
      service_item_at_sale = oi.service_item_at_sale,
      unit = COALESCE(oi.selling_unit_name, oi.unit),
      unit_price = COALESCE(oi.package_unit_price, oi.unit_price)
  FROM public.invoice_items oi
  WHERE ci.invoice_id = v_credit_note_id
    AND ci.original_invoice_item_id = oi.id
    AND oi.invoice_id = v_original.id
    AND oi.product_unit_id IS NOT NULL;

  v_effective_return_stock :=
    v_return_stock
    AND public.branch_effective_stock_enabled(
      v_original.tenant_id,
      v_original.branch_id
    );

  IF v_effective_return_stock THEN
    -- The legacy function did not lock products because stock restoration was
    -- deliberately suppressed. Lock every selected physical product in a
    -- stable order before restoring either package or legacy lines.
    PERFORM 1
    FROM public.products p
    JOIN public.invoice_items ci
      ON ci.product_id = p.id
     AND ci.invoice_id = v_credit_note_id
    WHERE p.tenant_id = v_original.tenant_id
      AND p.branch_id = v_original.branch_id
    ORDER BY p.id
    FOR UPDATE OF p;

    FOR v_request IN
      SELECT
        ci.product_id,
        ci.product_unit_id,
        ci.product_unit_version,
        ci.package_quantity,
        ci.conversion_to_base,
        COALESCE(ci.base_quantity, ci.quantity) AS base_quantity,
        ci.selling_unit_name,
        ci.base_unit_name,
        (
          COALESCE(ci.stock_tracked_at_sale, p.track_stock, false)
          AND COALESCE(p.track_stock, false)
        )
          AS stock_tracked_at_sale,
        (
          COALESCE(ci.service_item_at_sale, false)
          OR COALESCE(p.is_service, false)
        )
          AS service_item_at_sale
      FROM public.invoice_items ci
      LEFT JOIN public.products p
        ON p.id = ci.product_id
       AND p.tenant_id = v_original.tenant_id
       AND p.branch_id = v_original.branch_id
      WHERE ci.invoice_id = v_credit_note_id
      ORDER BY ci.product_id, ci.id
    LOOP
      IF v_request.product_id IS NOT NULL
         AND COALESCE(v_request.stock_tracked_at_sale, false)
         AND NOT COALESCE(v_request.service_item_at_sale, false)
      THEN
        UPDATE public.products
        SET stock_quantity = COALESCE(stock_quantity, 0) + v_request.base_quantity
        WHERE id = v_request.product_id
          AND tenant_id = v_original.tenant_id
          AND branch_id = v_original.branch_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Stock return failed for credited item'
            USING ERRCODE = '23514';
        END IF;

        INSERT INTO public.pos_stock_movements (
          tenant_id, branch_id, product_id, invoice_id,
          quantity_delta, reason, created_by,
          product_unit_id, product_unit_version, package_quantity,
          conversion_to_base, base_quantity, selling_unit_name, base_unit_name
        ) VALUES (
          v_original.tenant_id, v_original.branch_id,
          v_request.product_id, v_credit_note_id,
          v_request.base_quantity, 'refund_return', auth.uid(),
          v_request.product_unit_id, v_request.product_unit_version,
          v_request.package_quantity, v_request.conversion_to_base,
          v_request.base_quantity, v_request.selling_unit_name,
          v_request.base_unit_name
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END
$function$;

ALTER FUNCTION public.create_partial_credit_note_with_product_units_v1(jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_partial_credit_note_with_product_units_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_partial_credit_note(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF p_payload IS NOT NULL
     AND jsonb_typeof(p_payload -> 'items') = 'array'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_payload -> 'items') requested
       JOIN public.invoice_items original_item
         ON original_item.id = NULLIF(
           btrim(requested ->> 'original_invoice_item_id'),
           ''
         )::uuid
       WHERE original_item.product_unit_id IS NOT NULL
     )
  THEN
    RETURN public.create_partial_credit_note_with_product_units_v1(p_payload);
  END IF;

  RETURN public.create_partial_credit_note_legacy_base_v1(p_payload);
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid returned item identifier'
    USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.create_partial_credit_note(jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.create_partial_credit_note(jsonb) IS
  'Package-aware partial credit-note dispatcher. Historical package snapshots govern package returns; legacy rows retain the reviewed implementation.';

REVOKE ALL ON FUNCTION public.create_partial_credit_note(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_invoice_refundable_items_v2(
  p_invoice_id uuid
)
RETURNS TABLE (
  original_invoice_item_id uuid,
  name text,
  name_ar text,
  sku text,
  unit text,
  product_id uuid,
  original_quantity numeric,
  credited_quantity numeric,
  remaining_quantity numeric,
  unit_price numeric,
  subtotal numeric,
  discount_amount numeric,
  tax_rate numeric,
  tax_amount numeric,
  total numeric,
  credited_subtotal numeric,
  credited_discount_amount numeric,
  credited_tax_amount numeric,
  credited_total numeric,
  remaining_subtotal numeric,
  remaining_discount_amount numeric,
  remaining_tax_amount numeric,
  remaining_total numeric,
  track_stock boolean,
  is_service boolean,
  product_unit_id uuid,
  product_unit_version integer,
  selling_unit_name text,
  selling_unit_name_ar text,
  selling_unit_code text,
  package_quantity numeric,
  package_quantity_scale smallint,
  conversion_to_base numeric,
  base_quantity numeric,
  base_unit_name text,
  base_unit_name_ar text,
  base_unit_code text,
  base_quantity_scale smallint,
  package_unit_price numeric,
  base_unit_price numeric,
  stock_tracked_at_sale boolean,
  service_item_at_sale boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT
    r.original_invoice_item_id,
    r.name,
    r.name_ar,
    r.sku,
    COALESCE(oi.selling_unit_name, r.unit) AS unit,
    r.product_id,
    r.original_quantity,
    r.credited_quantity,
    r.remaining_quantity,
    r.unit_price,
    r.subtotal,
    r.discount_amount,
    r.tax_rate,
    r.tax_amount,
    r.total,
    r.credited_subtotal,
    r.credited_discount_amount,
    r.credited_tax_amount,
    r.credited_total,
    r.remaining_subtotal,
    r.remaining_discount_amount,
    r.remaining_tax_amount,
    r.remaining_total,
    (
      r.track_stock
      AND COALESCE(oi.stock_tracked_at_sale, r.track_stock)
    ) AS track_stock,
    (
      COALESCE(oi.service_item_at_sale, false)
      OR r.is_service
    ) AS is_service,
    oi.product_unit_id,
    oi.product_unit_version,
    oi.selling_unit_name::text,
    oi.selling_unit_name_ar::text,
    oi.selling_unit_code::text,
    COALESCE(oi.package_quantity, oi.quantity),
    oi.package_quantity_scale,
    oi.conversion_to_base,
    oi.base_quantity,
    oi.base_unit_name::text,
    oi.base_unit_name_ar::text,
    oi.base_unit_code::text,
    oi.base_quantity_scale,
    COALESCE(oi.package_unit_price, oi.unit_price),
    oi.base_unit_price,
    oi.stock_tracked_at_sale,
    oi.service_item_at_sale
  FROM public.get_invoice_refundable_items(p_invoice_id) r
  JOIN public.invoice_items oi
    ON oi.id = r.original_invoice_item_id
   AND oi.invoice_id = p_invoice_id
  ORDER BY oi.sort_order, oi.created_at, oi.id
$function$;

ALTER FUNCTION public.get_invoice_refundable_items_v2(uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_invoice_refundable_items_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_refundable_items_v2(uuid)
  TO authenticated, service_role;

ALTER TABLE public.product_stock_receipts
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

DO $receipt_fingerprint_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.product_stock_receipts'::regclass
      AND conname = 'product_stock_receipts_request_fingerprint_format'
  ) THEN
    ALTER TABLE public.product_stock_receipts
      ADD CONSTRAINT product_stock_receipts_request_fingerprint_format
      CHECK (
        request_fingerprint IS NULL
        OR request_fingerprint ~ '^[a-f0-9]{64}$'
      )
      NOT VALID;
  END IF;
END
$receipt_fingerprint_constraint$;

COMMENT ON COLUMN public.product_stock_receipts.request_fingerprint IS
  'Server-side SHA-256 fingerprint for package-aware product stock receipt replay protection.';

DO $preserve_legacy_receiving$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.receive_product_stock_legacy_base_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef(
      'public.receive_product_stock(jsonb)'::regprocedure
    );
    IF md5(v_definition) <> '78c5524f0f0ccef32740ca5453aaaa68'
       OR v_definition NOT LIKE '%Stock module is disabled for this branch%'
    THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_RECEIVING_LEGACY_DEFINITION_UNREVIEWED';
    END IF;
    ALTER FUNCTION public.receive_product_stock(jsonb)
      RENAME TO receive_product_stock_legacy_base_v1;
  END IF;
END
$preserve_legacy_receiving$;

ALTER FUNCTION public.receive_product_stock_legacy_base_v1(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.receive_product_stock_legacy_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_product_stock_legacy_base_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.receive_product_stock_with_units_v1(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_resolved record;
  v_product record;
  v_supplier record;
  v_existing public.product_stock_receipts%ROWTYPE;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_expected_version integer;
  v_supplier_id uuid;
  v_package_quantity numeric;
  v_package_unit_cost numeric(14, 2);
  v_base_unit_cost numeric(18, 6);
  v_total_cost numeric(14, 2);
  v_idempotency_key text;
  v_request_fingerprint text;
  v_note text;
  v_reference text;
  v_before numeric;
  v_after numeric;
  v_receipt_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := now();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid product stock receipt payload'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) key_name
    WHERE key_name NOT IN (
      'product_id', 'product_unit_id', 'package_quantity',
      'expected_product_unit_version', 'supplier_id', 'unit_cost',
      'idempotency_key', 'note', 'reference'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported product stock receipt field'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (p_payload ? 'package_quantity')
     OR jsonb_typeof(p_payload -> 'package_quantity') <> 'number'
  THEN
    RAISE EXCEPTION 'Quantity received must be a number'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (p_payload ? 'unit_cost')
     OR jsonb_typeof(p_payload -> 'unit_cost') <> 'number'
  THEN
    RAISE EXCEPTION 'Unit purchase cost must be a number'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (p_payload ? 'expected_product_unit_version')
     OR jsonb_typeof(p_payload -> 'expected_product_unit_version') <> 'number'
  THEN
    RAISE EXCEPTION 'Product unit version must be a number'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_product_id := NULLIF(btrim(COALESCE(p_payload ->> 'product_id', '')), '')::uuid;
    v_product_unit_id := NULLIF(
      btrim(COALESCE(p_payload ->> 'product_unit_id', '')),
      ''
    )::uuid;
    v_expected_version := NULLIF(
      btrim(COALESCE(p_payload ->> 'expected_product_unit_version', '')),
      ''
    )::integer;
    v_supplier_id := NULLIF(
      btrim(COALESCE(p_payload ->> 'supplier_id', '')),
      ''
    )::uuid;
    v_package_quantity := NULLIF(
      btrim(COALESCE(p_payload ->> 'package_quantity', '')),
      ''
    )::numeric;
    v_package_unit_cost := NULLIF(
      btrim(COALESCE(p_payload ->> 'unit_cost', '')),
      ''
    )::numeric(14, 2);
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid product stock receipt value'
        USING ERRCODE = '22023';
  END;

  v_idempotency_key := NULLIF(
    btrim(COALESCE(p_payload ->> 'idempotency_key', '')),
    ''
  );
  v_note := NULLIF(btrim(COALESCE(p_payload ->> 'note', '')), '');
  v_reference := NULLIF(btrim(COALESCE(p_payload ->> 'reference', '')), '');

  IF v_product_id IS NULL
     OR v_package_quantity IS NULL
     OR v_expected_version IS NULL
     OR v_package_unit_cost IS NULL
     OR v_package_unit_cost < 0
     OR v_idempotency_key IS NULL
     OR length(v_idempotency_key) NOT BETWEEN 8 AND 120
  THEN
    RAISE EXCEPTION 'Invalid package stock receipt request'
      USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023';
  END IF;
  IF v_reference IS NOT NULL AND length(v_reference) > 120 THEN
    RAISE EXCEPTION 'Reference is too long' USING ERRCODE = '22023';
  END IF;

  v_request_fingerprint := encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive'
      USING ERRCODE = '42501';
  END IF;

  -- Product then unit is the same lock order used by checkout.
  PERFORM 1 FROM public.products
  WHERE id = v_product_id
  FOR UPDATE;
  IF v_product_unit_id IS NOT NULL THEN
    PERFORM 1 FROM public.product_units
    WHERE id = v_product_unit_id
    FOR UPDATE;
  END IF;

  SELECT *
  INTO v_resolved
  FROM public.resolve_product_commercial_unit(
    v_product_id,
    v_product_unit_id,
    v_package_quantity,
    v_expected_version,
    'receive'
  );

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_resolved.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN (
    'branch', 'manager', 'cashier', 'accountant'
  ) THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_resolved.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_resolved.branch_id THEN
      RAISE EXCEPTION 'Product belongs to another branch'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Insufficient permission to receive product stock'
      USING ERRCODE = '42501';
  END IF;

  IF v_resolved.effective_stock_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Stock module is disabled for this branch'
      USING ERRCODE = '23514';
  END IF;
  IF v_resolved.stock_tracked IS NOT TRUE THEN
    RAISE EXCEPTION 'Product must track stock before receiving stock'
      USING ERRCODE = '23514';
  END IF;

  IF v_supplier_id IS NOT NULL THEN
    SELECT id, tenant_id, branch_id, is_active
    INTO v_supplier
    FROM public.suppliers
    WHERE id = v_supplier_id;
    IF NOT FOUND OR v_supplier.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Supplier not found or inactive'
        USING ERRCODE = '42501';
    END IF;
    IF v_supplier.tenant_id IS DISTINCT FROM v_resolved.tenant_id
       OR v_supplier.branch_id IS DISTINCT FROM v_resolved.branch_id THEN
      RAISE EXCEPTION 'Supplier belongs to another branch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Serialize the first request and every concurrent replay before checking
  -- the receipt row. The waiting request then observes and returns the exact
  -- committed receipt instead of racing the unique idempotency constraint.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_resolved.branch_id::text
      || ':' || v_resolved.product_id::text
      || ':' || v_idempotency_key,
      0
    )
  );

  SELECT *
  INTO v_existing
  FROM public.product_stock_receipts
  WHERE tenant_id = v_resolved.tenant_id
    AND branch_id = v_resolved.branch_id
    AND product_id = v_resolved.product_id
    AND idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_FINGERPRINT_MISMATCH'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'receipt_id', v_existing.id,
      'product_id', v_existing.product_id,
      'product_unit_id', v_existing.product_unit_id,
      'product_unit_version', v_existing.product_unit_version,
      'supplier_id', v_existing.supplier_id,
      'package_quantity', v_existing.package_quantity,
      'base_quantity', v_existing.base_quantity,
      'package_unit_cost', v_existing.package_unit_cost,
      'base_unit_cost', v_existing.base_unit_cost,
      'total_cost', v_existing.total_cost,
      'stock_quantity', (
        SELECT stock_quantity
        FROM public.products
        WHERE id = v_existing.product_id
      ),
      'idempotency_key', v_existing.idempotency_key,
      'idempotent_replay', true,
      'created_at', v_existing.created_at
    );
  END IF;

  SELECT stock_quantity
  INTO v_before
  FROM public.products
  WHERE id = v_resolved.product_id;

  v_before := COALESCE(v_before, 0);
  v_after := v_before + v_resolved.base_quantity;
  v_base_unit_cost := round(
    v_package_unit_cost / v_resolved.conversion_to_base,
    6
  );
  v_total_cost := round(
    v_package_unit_cost * v_resolved.package_quantity,
    2
  );

  UPDATE public.products
  SET stock_quantity = v_after,
      cost = round(v_base_unit_cost, 2),
      updated_at = v_now
  WHERE id = v_resolved.product_id
    AND tenant_id = v_resolved.tenant_id
    AND branch_id = v_resolved.branch_id;

  INSERT INTO public.product_stock_receipts (
    id, tenant_id, branch_id, product_id, supplier_id,
    quantity, unit_cost, total_cost, idempotency_key,
    note, reference, created_by, created_at,
    product_unit_id, product_unit_version, package_quantity,
    conversion_to_base, base_quantity,
    package_unit_name, base_unit_name, package_unit_code, base_unit_code,
    package_unit_cost, base_unit_cost, request_fingerprint
  ) VALUES (
    v_receipt_id, v_resolved.tenant_id, v_resolved.branch_id,
    v_resolved.product_id, v_supplier_id,
    v_resolved.base_quantity, round(v_base_unit_cost, 2), v_total_cost,
    v_idempotency_key, v_note, v_reference, v_user_id, v_now,
    v_resolved.product_unit_id, v_resolved.product_unit_version,
    v_resolved.package_quantity, v_resolved.conversion_to_base,
    v_resolved.base_quantity, v_resolved.selling_unit_name,
    v_resolved.base_unit_name, v_resolved.selling_unit_code,
    v_resolved.base_unit_code, v_package_unit_cost, v_base_unit_cost,
    v_request_fingerprint
  );

  INSERT INTO public.pos_stock_movements (
    tenant_id, branch_id, product_id, invoice_id,
    quantity_delta, reason, created_by, created_at, idempotency_key,
    product_unit_id, product_unit_version, package_quantity,
    conversion_to_base, base_quantity, selling_unit_name, base_unit_name
  ) VALUES (
    v_resolved.tenant_id, v_resolved.branch_id, v_resolved.product_id,
    NULL, v_resolved.base_quantity, 'stock_receipt', v_user_id, v_now,
    v_idempotency_key, v_resolved.product_unit_id,
    v_resolved.product_unit_version, v_resolved.package_quantity,
    v_resolved.conversion_to_base, v_resolved.base_quantity,
    v_resolved.selling_unit_name, v_resolved.base_unit_name
  );

  PERFORM public.mark_product_unit_used(v_resolved.product_unit_id);

  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id', v_receipt_id,
    'product_id', v_resolved.product_id,
    'product_unit_id', v_resolved.product_unit_id,
    'product_unit_version', v_resolved.product_unit_version,
    'supplier_id', v_supplier_id,
    'package_quantity', v_resolved.package_quantity,
    'base_quantity', v_resolved.base_quantity,
    'package_unit_cost', v_package_unit_cost,
    'base_unit_cost', v_base_unit_cost,
    'total_cost', v_total_cost,
    'stock_quantity_before', v_before,
    'stock_quantity', v_after,
    'idempotency_key', v_idempotency_key,
    'idempotent_replay', false,
    'created_at', v_now
  );
END
$function$;

ALTER FUNCTION public.receive_product_stock_with_units_v1(jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.receive_product_stock_with_units_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receive_product_stock(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF p_payload IS NOT NULL
     AND (
       p_payload ? 'product_unit_id'
       OR p_payload ? 'package_quantity'
       OR p_payload ? 'expected_product_unit_version'
     )
  THEN
    RETURN public.receive_product_stock_with_units_v1(p_payload);
  END IF;
  RETURN public.receive_product_stock_legacy_base_v1(p_payload);
END
$function$;

ALTER FUNCTION public.receive_product_stock(jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.receive_product_stock(jsonb) IS
  'Package-aware product-stock receiving dispatcher. Explicit units are converted authoritatively to base stock; legacy quantity-only calls retain the reviewed implementation.';

REVOKE ALL ON FUNCTION public.receive_product_stock(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_product_stock(jsonb)
  TO authenticated, service_role;

-- New package snapshots are all-or-nothing and arithmetically coherent.
-- NOT VALID avoids rewriting historical rows while enforcing every new row.
DO $snapshot_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoice_items'::regclass
      AND conname = 'invoice_items_product_unit_snapshot_contract'
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_product_unit_snapshot_contract
      CHECK (
        product_unit_id IS NULL
        OR (
          product_unit_version IS NOT NULL
          AND selling_unit_name IS NOT NULL
          AND selling_unit_code IS NOT NULL
          AND package_quantity IS NOT NULL
          AND package_quantity_scale IS NOT NULL
          AND conversion_to_base IS NOT NULL
          AND base_quantity IS NOT NULL
          AND base_unit_name IS NOT NULL
          AND base_unit_code IS NOT NULL
          AND base_quantity_scale IS NOT NULL
          AND package_pricing_method IS NOT NULL
          AND base_unit_price IS NOT NULL
          AND package_unit_price IS NOT NULL
          AND stock_tracked_at_sale IS NOT NULL
          AND service_item_at_sale IS NOT NULL
          AND package_quantity > 0
          AND conversion_to_base > 0
          AND base_quantity > 0
          AND package_quantity_scale BETWEEN 0 AND 6
          AND base_quantity_scale BETWEEN 0 AND 3
          AND round(package_quantity, package_quantity_scale) = package_quantity
          AND round(base_quantity, base_quantity_scale) = base_quantity
          AND base_unit_price >= 0
          AND package_unit_price >= 0
          AND quantity = package_quantity
          AND unit_price = package_unit_price
          AND base_quantity = package_quantity * conversion_to_base
        )
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.pos_stock_movements'::regclass
      AND conname = 'pos_stock_movements_product_unit_snapshot_contract'
  ) THEN
    ALTER TABLE public.pos_stock_movements
      ADD CONSTRAINT pos_stock_movements_product_unit_snapshot_contract
      CHECK (
        product_unit_id IS NULL
        OR (
          product_unit_version IS NOT NULL
          AND package_quantity IS NOT NULL
          AND conversion_to_base IS NOT NULL
          AND base_quantity IS NOT NULL
          AND selling_unit_name IS NOT NULL
          AND base_unit_name IS NOT NULL
          AND package_quantity > 0
          AND conversion_to_base > 0
          AND base_quantity > 0
          AND base_quantity = package_quantity * conversion_to_base
          AND abs(quantity_delta) = base_quantity
        )
      )
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_stock_receipts'::regclass
      AND conname = 'product_stock_receipts_product_unit_snapshot_contract'
  ) THEN
    ALTER TABLE public.product_stock_receipts
      ADD CONSTRAINT product_stock_receipts_product_unit_snapshot_contract
      CHECK (
        product_unit_id IS NULL
        OR (
          product_unit_version IS NOT NULL
          AND package_quantity IS NOT NULL
          AND conversion_to_base IS NOT NULL
          AND base_quantity IS NOT NULL
          AND package_unit_name IS NOT NULL
          AND base_unit_name IS NOT NULL
          AND package_unit_code IS NOT NULL
          AND base_unit_code IS NOT NULL
          AND package_unit_cost IS NOT NULL
          AND base_unit_cost IS NOT NULL
          AND package_quantity > 0
          AND conversion_to_base > 0
          AND base_quantity > 0
          AND package_unit_cost >= 0
          AND base_unit_cost >= 0
          AND quantity = base_quantity
          AND base_quantity = package_quantity * conversion_to_base
          AND total_cost = round(package_quantity * package_unit_cost, 2)
        )
      )
      NOT VALID;
  END IF;
END
$snapshot_constraints$;

-- Atomic preview and final commit compare this complete immutable item JSON.
-- Extending the existing builder makes unit/version/quantity/price changes
-- between preparation and commit fail with ATOMIC_CHECKOUT_SNAPSHOT_CHANGED.
DO $patch_atomic_receipt_snapshot$
DECLARE
  v_definition text;
  v_anchor text := $anchor$        'unit', ii.unit,
        'quantity', ii.quantity,$anchor$;
  v_replacement text := $replacement$        'unit', ii.unit,
        'product_unit_id', ii.product_unit_id,
        'product_unit_version', ii.product_unit_version,
        'selling_unit_name', ii.selling_unit_name,
        'selling_unit_name_ar', ii.selling_unit_name_ar,
        'selling_unit_code', ii.selling_unit_code,
        'package_quantity', ii.package_quantity,
        'package_quantity_scale', ii.package_quantity_scale,
        'conversion_to_base', ii.conversion_to_base,
        'base_quantity', ii.base_quantity,
        'base_unit_name', ii.base_unit_name,
        'base_unit_name_ar', ii.base_unit_name_ar,
        'base_unit_code', ii.base_unit_code,
        'base_quantity_scale', ii.base_quantity_scale,
        'package_pricing_method', ii.package_pricing_method,
        'base_unit_price', ii.base_unit_price,
        'package_unit_price', ii.package_unit_price,
        'stock_tracked_at_sale', ii.stock_tracked_at_sale,
        'service_item_at_sale', ii.service_item_at_sale,
        'quantity', ii.quantity,$replacement$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.build_zatca_atomic_receipt_snapshot_v2(uuid)'::regprocedure
  );
  IF v_definition NOT LIKE '%''product_unit_version'', ii.product_unit_version%' THEN
    IF md5(v_definition) <> '00022982d7619aefb65fc1e6f3125108' THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_ATOMIC_SNAPSHOT_DEFINITION_UNREVIEWED';
    END IF;
    IF strpos(v_definition, v_anchor) = 0 THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_ATOMIC_SNAPSHOT_ANCHOR_MISSING';
    END IF;
    v_definition := replace(v_definition, v_anchor, v_replacement);
    EXECUTE v_definition;
  END IF;
END
$patch_atomic_receipt_snapshot$;

ALTER FUNCTION public.build_zatca_atomic_receipt_snapshot_v2(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.build_zatca_atomic_receipt_snapshot_v2(uuid)
  SET row_security = off;

-- Package-aware sales reporting keeps one row per stable product, normalizes
-- the headline quantity to base stock units, and supplies an explicit selling
-- unit breakdown so Piece and Carton quantities are never added together.
CREATE OR REPLACE FUNCTION public.get_sales_report_summary_v2(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_summary jsonb;
  v_top_products jsonb := '[]'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_total_revenue numeric := 0;
BEGIN
  v_summary := public.get_sales_report_summary(
    p_start_date,
    p_end_date,
    p_branch_id
  );
  v_total_revenue := COALESCE((v_summary ->> 'totalRevenue')::numeric, 0);
  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH inv_doc AS (
    SELECT i.id AS invoice_id, i.tenant_id, i.accounting_sign
    FROM public.reporting_invoice_documents_v i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (
        v_scope.scope_branch_id IS NULL
        OR i.branch_id = v_scope.scope_branch_id
      )
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  line_rows AS (
    SELECT
      COALESCE(
        ii.product_id::text,
        'legacy:' || lower(COALESCE(NULLIF(btrim(ii.name), ''), 'unknown item'))
      ) AS product_key,
      ii.product_id,
      ii.product_unit_id,
      ii.product_unit_version,
      COALESCE(NULLIF(btrim(ii.name), ''), 'Unknown item') AS item_name,
      COALESCE(NULLIF(btrim(ii.selling_unit_name), ''), NULLIF(btrim(ii.unit), ''), 'Unit') AS unit_name,
      COALESCE(NULLIF(btrim(ii.selling_unit_code), ''), 'PCE') AS unit_code,
      COALESCE(ii.conversion_to_base, 1) AS conversion_to_base,
      COALESCE(ii.package_unit_price, ii.unit_price, 0) AS package_unit_price,
      inv_doc.accounting_sign * COALESCE(ii.package_quantity, ii.quantity, 0) AS package_quantity,
      inv_doc.accounting_sign * COALESCE(ii.base_quantity, ii.quantity, 0) AS base_quantity,
      inv_doc.accounting_sign * COALESCE(ii.total, 0) AS revenue
    FROM inv_doc
    JOIN public.invoice_items ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
  ),
  product_totals AS (
    SELECT
      product_key,
      min(product_id) AS product_id,
      min(item_name) AS item_name,
      sum(base_quantity) AS base_quantity,
      sum(revenue) AS revenue
    FROM line_rows
    GROUP BY product_key
    ORDER BY sum(revenue) DESC, min(item_name)
    LIMIT 10
  ),
  package_totals AS (
    SELECT
      lr.product_key,
      lr.product_unit_id,
      lr.product_unit_version,
      lr.unit_name,
      lr.unit_code,
      lr.conversion_to_base,
      lr.package_unit_price,
      sum(lr.package_quantity) AS package_quantity,
      sum(lr.base_quantity) AS base_quantity,
      sum(lr.revenue) AS revenue
    FROM line_rows lr
    JOIN product_totals pt ON pt.product_key = lr.product_key
    GROUP BY
      lr.product_key,
      lr.product_unit_id,
      lr.product_unit_version,
      lr.unit_name,
      lr.unit_code,
      lr.conversion_to_base,
      lr.package_unit_price
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', pt.product_id,
    'name', pt.item_name,
    'quantity', pt.base_quantity,
    'baseQuantity', pt.base_quantity,
    'revenue', pt.revenue,
    'pct', CASE
      WHEN v_total_revenue <> 0
        THEN round((pt.revenue / v_total_revenue) * 100, 2)
      ELSE 0
    END,
    'packageBreakdown', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sellingUnit', packages.unit_name,
        'unitCode', packages.unit_code,
        'productUnitId', packages.product_unit_id,
        'productUnitVersion', packages.product_unit_version,
        'conversionToBase', packages.conversion_to_base,
        'packageUnitPrice', packages.package_unit_price,
        'packageQuantity', packages.package_quantity,
        'baseQuantity', packages.base_quantity,
        'revenue', packages.revenue
      ) ORDER BY
        packages.unit_name,
        packages.unit_code,
        packages.product_unit_version,
        packages.package_unit_price)
      FROM package_totals packages
      WHERE packages.product_key = pt.product_key
    ), '[]'::jsonb)
  ) ORDER BY pt.revenue DESC, pt.item_name), '[]'::jsonb)
  INTO v_top_products
  FROM product_totals pt;

  WITH inv_doc AS (
    SELECT i.id AS invoice_id, i.tenant_id, i.accounting_sign
    FROM public.reporting_invoice_documents_v i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND (
        v_scope.scope_branch_id IS NULL
        OR i.branch_id = v_scope.scope_branch_id
      )
      AND i.invoice_date BETWEEN p_start_date AND p_end_date
      AND i.is_counted IS TRUE
  ),
  category_rows AS (
    SELECT
      COALESCE(c.name, 'Uncategorized') AS category_name,
      sum(
        inv_doc.accounting_sign * COALESCE(ii.base_quantity, ii.quantity, 0)
      ) AS base_quantity,
      sum(inv_doc.accounting_sign * COALESCE(ii.total, 0)) AS revenue
    FROM inv_doc
    JOIN public.invoice_items ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
    LEFT JOIN public.products p
      ON p.id = ii.product_id
     AND p.tenant_id = inv_doc.tenant_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    GROUP BY COALESCE(c.name, 'Uncategorized')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', category_name,
    'items', base_quantity,
    'baseQuantity', base_quantity,
    'revenue', revenue,
    'pct', CASE
      WHEN v_total_revenue <> 0
        THEN round((revenue / v_total_revenue) * 100, 2)
      ELSE 0
    END
  ) ORDER BY revenue DESC, category_name), '[]'::jsonb)
  INTO v_categories
  FROM category_rows;

  RETURN v_summary || jsonb_build_object(
    'quantityBasis', 'base_quantity',
    'topProducts', v_top_products,
    'catPerformance', v_categories,
    'categoryBreakdown', v_categories
  );
END
$function$;

ALTER FUNCTION public.get_sales_report_summary_v2(date, date, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_sales_report_summary_v2(date, date, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary_v2(date, date, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sales_report_summary_v2(date, date, uuid) IS
  'Package-aware sales report: stable product grouping, base-quantity totals, and explicit selling-unit breakdown with signed returns.';

-- Versioned full-definition fingerprints keep the atomic verification gate
-- strict after these intentional dispatchers are installed. INSERT-only
-- registration means rerunning this file cannot bless later function drift.
CREATE TABLE IF NOT EXISTS public.product_units_commercial_function_contracts_v1 (
  function_signature text PRIMARY KEY,
  definition_md5 text NOT NULL
    CHECK (definition_md5 ~ '^[a-f0-9]{32}$'),
  registered_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_units_commercial_function_contracts_v1
  OWNER TO postgres;

COMMENT ON TABLE public.product_units_commercial_function_contracts_v1 IS
  'Immutable full pg_get_functiondef fingerprints registered by Product Units commercial workflow v1 for strict atomic/release verification.';

REVOKE ALL ON TABLE public.product_units_commercial_function_contracts_v1
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_units_commercial_function_contracts_v1
  TO service_role;

INSERT INTO public.product_units_commercial_function_contracts_v1 (
  function_signature,
  definition_md5
)
SELECT
  contract.signature,
  md5(pg_get_functiondef(to_regprocedure(contract.signature)::oid))
FROM (VALUES
  ('public.pos_checkout(jsonb)'),
  ('public.pos_checkout_legacy_base_v1(jsonb)'),
  ('public.pos_checkout_with_product_units_v1(jsonb)'),
  ('public.create_partial_credit_note(jsonb)'),
  ('public.create_partial_credit_note_legacy_base_v1(jsonb)'),
  ('public.create_partial_credit_note_with_product_units_v1(jsonb)'),
  ('public.create_partial_credit_note_with_refund(jsonb)'),
  ('public.receive_product_stock(jsonb)'),
  ('public.receive_product_stock_legacy_base_v1(jsonb)'),
  ('public.receive_product_stock_with_units_v1(jsonb)'),
  ('public.build_zatca_atomic_receipt_snapshot_v2(uuid)')
) AS contract(signature)
ON CONFLICT (function_signature) DO NOTHING;

DO $assert_product_unit_commercial_contracts$
DECLARE
  v_contract record;
BEGIN
  FOR v_contract IN
    SELECT function_signature, definition_md5
    FROM public.product_units_commercial_function_contracts_v1
  LOOP
    IF to_regprocedure(v_contract.function_signature) IS NULL
       OR md5(pg_get_functiondef(
         to_regprocedure(v_contract.function_signature)::oid
       )) <> v_contract.definition_md5
    THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_FUNCTION_CONTRACT_MISMATCH:%',
        v_contract.function_signature;
    END IF;
  END LOOP;
END
$assert_product_unit_commercial_contracts$;

-- Reassert all public/private execution boundaries deterministically.
REVOKE ALL ON FUNCTION public.resolve_product_commercial_unit(
  uuid, uuid, numeric, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pos_checkout_with_product_units_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_with_product_units_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.receive_product_stock_with_units_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.pos_checkout(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_partial_credit_note(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_with_refund(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_with_refund(jsonb)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_invoice_refundable_items_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_refundable_items_v2(uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.receive_product_stock(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_product_stock(jsonb)
  TO authenticated, service_role;

DO $assert_product_unit_commercial_security$
DECLARE
  v_signature regprocedure;
  v_private regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.pos_checkout(jsonb)'::regprocedure,
    'public.create_partial_credit_note(jsonb)'::regprocedure,
    'public.create_partial_credit_note_with_refund(jsonb)'::regprocedure,
    'public.get_invoice_refundable_items_v2(uuid)'::regprocedure,
    'public.receive_product_stock(jsonb)'::regprocedure,
    'public.get_branch_selling_product_units(uuid)'::regprocedure,
    'public.get_sales_report_summary_v2(date,date,uuid)'::regprocedure
  ]
  LOOP
    IF EXISTS (
         SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(
           COALESCE(p.proacl, acldefault('f', p.proowner))
         ) privilege
         WHERE p.oid = v_signature::oid
           AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         WHERE p.oid = v_signature::oid
           AND p.prosecdef
           AND EXISTS (
             SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) setting
             WHERE setting LIKE 'search_path=public%'
           )
           AND 'row_security=off' = ANY(
             COALESCE(p.proconfig, ARRAY[]::text[])
           )
       )
    THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_PUBLIC_GRANT_MISMATCH:%', v_signature;
    END IF;
  END LOOP;

  FOREACH v_private IN ARRAY ARRAY[
    'public.resolve_product_commercial_unit(uuid,uuid,numeric,integer,text)'::regprocedure,
    'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure,
    'public.create_partial_credit_note_with_product_units_v1(jsonb)'::regprocedure,
    'public.receive_product_stock_with_units_v1(jsonb)'::regprocedure,
    'public.pos_checkout_legacy_base_v1(jsonb)'::regprocedure,
    'public.create_partial_credit_note_legacy_base_v1(jsonb)'::regprocedure,
    'public.receive_product_stock_legacy_base_v1(jsonb)'::regprocedure
  ]
  LOOP
    IF EXISTS (
         SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(
           COALESCE(p.proacl, acldefault('f', p.proowner))
         ) privilege
         WHERE p.oid = v_private::oid
           AND privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', v_private, 'EXECUTE')
       OR has_function_privilege('authenticated', v_private, 'EXECUTE')
       OR NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         WHERE p.oid = v_private::oid
           AND p.prosecdef
           AND EXISTS (
             SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) setting
             WHERE setting LIKE 'search_path=public%'
           )
           AND 'row_security=off' = ANY(
             COALESCE(p.proconfig, ARRAY[]::text[])
           )
       )
    THEN
      RAISE EXCEPTION 'PRODUCT_UNITS_PRIVATE_GRANT_MISMATCH:%', v_private;
    END IF;
  END LOOP;
END
$assert_product_unit_commercial_security$;

NOTIFY pgrst, 'reload schema';

COMMIT;
