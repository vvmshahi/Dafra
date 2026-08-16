-- Phase 6: server-authoritative Custom Line checkout.
--
-- This migration is deliberately additive at the public boundary: existing
-- product-backed requests retain the reviewed commercial delegate, while an
-- explicit Custom Line source uses the same invoice, payment, classifier, and
-- finalization path with server-derived fiscal values.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $phase6_required_contracts$
BEGIN
  IF to_regclass('public.branches') IS NULL
     OR to_regclass('public.invoice_items') IS NULL
     OR to_regclass('public.invoices') IS NULL
     OR to_regclass('public.product_units') IS NULL
     OR to_regprocedure('public.pos_checkout_capability_base_v1(jsonb)') IS NULL
     OR to_regprocedure('public.pos_checkout_with_product_units_v1(jsonb)') IS NULL
     OR to_regprocedure('public.resolve_product_commercial_unit(uuid,uuid,numeric,integer,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.invoice_items'::regclass
         AND attribute.attname = 'line_source'
         AND attribute.attisdropped IS FALSE
     )
  THEN
    RAISE EXCEPTION 'PHASE6_CUSTOM_LINE_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$phase6_required_contracts$;

-- The current checkout body is preserved under a new private name for every
-- catalogue-only request. This avoids rewriting the reviewed package and
-- legacy paths simply to introduce a second discriminated source.
DO $preserve_catalogue_checkout_delegate$
DECLARE
  v_definition text;
BEGIN
  IF to_regprocedure('public.pos_checkout_capability_catalogue_base_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef(
      'public.pos_checkout_capability_base_v1(jsonb)'::regprocedure
    );
    v_definition := replace(
      v_definition,
      'FUNCTION public.pos_checkout_capability_base_v1(',
      'FUNCTION public.pos_checkout_capability_catalogue_base_v1('
    );
    IF v_definition NOT LIKE '%pos_checkout_capability_catalogue_base_v1%' THEN
      RAISE EXCEPTION 'PHASE6_CATALOGUE_CHECKOUT_DELEGATE_UNREVIEWED';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$preserve_catalogue_checkout_delegate$;

ALTER FUNCTION public.pos_checkout_capability_catalogue_base_v1(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_capability_catalogue_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout_capability_catalogue_base_v1(jsonb)
  TO service_role;

-- Provenance is immutable checkout data. Catalogue-only delegated requests
-- set a transaction-local source; the Custom helper writes it explicitly and
-- this trigger rejects any attempt to combine Custom provenance with product
-- or stock/package identity.
CREATE OR REPLACE FUNCTION public.apply_checkout_invoice_item_provenance_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_source text := NULLIF(current_setting('app.checkout_line_source', true), '');
BEGIN
  IF v_source IN ('catalogue', 'custom') THEN
    NEW.line_source := v_source;
  ELSIF NEW.line_source IS NULL THEN
    NEW.line_source := 'legacy';
  END IF;

  IF NEW.line_source = 'custom' THEN
    IF NEW.product_id IS NOT NULL OR NEW.product_unit_id IS NOT NULL THEN
      RAISE EXCEPTION 'CUSTOM_LINE_PRODUCT_IDENTITY_FORBIDDEN'
        USING ERRCODE = '23514';
    END IF;
    NEW.stock_tracked_at_sale := false;
    NEW.service_item_at_sale := true;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.apply_checkout_invoice_item_provenance_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_checkout_invoice_item_provenance_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_checkout_invoice_item_provenance_v1()
  TO service_role;

DROP TRIGGER IF EXISTS trg_apply_checkout_invoice_item_provenance_v1
  ON public.invoice_items;
CREATE TRIGGER trg_apply_checkout_invoice_item_provenance_v1
BEFORE INSERT ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.apply_checkout_invoice_item_provenance_v1();

-- Build the mixed-cart helper from the current, contract-checked package
-- checkout function. The replacement keeps every catalogue calculation,
-- product-unit resolution, stock lock, payment, idempotency, and parent-ID
-- safeguard intact; only source validation, Custom calculation, and immutable
-- provenance writes are made source-aware.
DO $phase6_install_custom_checkout_helper$
DECLARE
  v_definition text;
  v_registered_hash text;
  v_loop_start integer;
  v_loop_end integer;
  v_item_field_contract text := $item_fields$
      'product_id', 'product_unit_id', 'package_quantity',
      'expected_product_unit_version'
$item_fields$;
  v_custom_loop text := $custom_loop$
  FOR v_item, v_sort_order IN
    SELECT value, (ordinality - 1)::integer
    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(value, ordinality)
  LOOP
    IF v_item ? 'source' THEN
      IF jsonb_typeof(v_item -> 'source') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'INVALID_CHECKOUT_ITEM_SOURCE' USING ERRCODE = '22023';
      END IF;
      v_source := NULLIF(btrim(v_item ->> 'source'), '');
    ELSE
      v_source := 'catalogue';
    END IF;

    IF v_source IS NULL OR v_source NOT IN ('catalogue', 'custom') THEN
      RAISE EXCEPTION 'INVALID_CHECKOUT_ITEM_SOURCE' USING ERRCODE = '22023';
    END IF;

    IF v_source = 'catalogue' THEN
      IF v_item ? 'name' OR v_item ? 'name_ar'
         OR v_item ? 'unit_price' OR v_item ? 'vat_treatment'
      THEN
        RAISE EXCEPTION 'CATALOGUE_PRICE_OR_DESCRIPTION_OVERRIDE_FORBIDDEN'
          USING ERRCODE = '22023';
      END IF;

      BEGIN
        v_product_id := NULLIF(btrim(COALESCE(v_item ->> 'product_id', '')), '')::uuid;
        v_product_unit_id := NULLIF(btrim(COALESCE(v_item ->> 'product_unit_id', '')), '')::uuid;
        v_qty := NULLIF(btrim(COALESCE(v_item ->> 'package_quantity', v_item ->> 'quantity', '')), '')::numeric;
        v_expected_version := NULLIF(
          btrim(COALESCE(v_item ->> 'expected_product_unit_version', '')),
          ''
        )::integer;
      EXCEPTION
        WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'INVALID_CATALOGUE_CHECKOUT_ITEM' USING ERRCODE = '22023';
      END;

      IF v_product_id IS NULL OR v_qty IS NULL
         OR (v_item ? 'package_quantity' AND v_item ? 'quantity')
      THEN
        RAISE EXCEPTION 'CATALOGUE_PRODUCT_AND_SINGLE_QUANTITY_REQUIRED'
          USING ERRCODE = '22023';
      END IF;

      IF v_product_unit_id IS NOT NULL THEN
        IF NOT (v_item ? 'package_quantity') OR v_expected_version IS NULL THEN
          RAISE EXCEPTION 'PACKAGE_CHECKOUT_REQUIRES_QUANTITY_AND_VERSION'
            USING ERRCODE = '22023';
        END IF;
      ELSE
        -- A legacy product_id + quantity payload is still catalogue. Resolve
        -- its active base unit server-side so it can coexist with a Custom
        -- Line without accepting a browser price or weakening package checks.
        SELECT pu.id, pu.version
        INTO v_product_unit_id, v_expected_version
        FROM public.product_units pu
        WHERE pu.product_id = v_product_id
          AND pu.is_base IS TRUE
          AND pu.is_active IS TRUE
          AND pu.selling_enabled IS TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'CATALOGUE_BASE_UNIT_UNAVAILABLE'
            USING ERRCODE = '55000';
        END IF;
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
        RAISE EXCEPTION 'PRODUCT_BRANCH_SCOPE_MISMATCH' USING ERRCODE = '42501';
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
        RAISE EXCEPTION 'CHECKOUT_LINE_AMOUNT_TOO_LARGE' USING ERRCODE = '22003';
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
          RAISE EXCEPTION 'INSUFFICIENT_STOCK_FOR_PRODUCT:%', v_product.name
            USING ERRCODE = '23514';
        END IF;
      END IF;
      v_item_rows := v_item_rows || jsonb_build_array(jsonb_build_object(
        'line_source', 'catalogue',
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
    ELSE
      IF (v_item ? 'product_id' AND jsonb_typeof(v_item -> 'product_id') <> 'null')
         OR (v_item ? 'product_unit_id' AND jsonb_typeof(v_item -> 'product_unit_id') <> 'null')
         OR v_item ? 'package_quantity'
         OR v_item ? 'expected_product_unit_version'
      THEN
        RAISE EXCEPTION 'CUSTOM_LINE_PRODUCT_OR_PACKAGE_IDENTITY_FORBIDDEN'
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_item -> 'name') IS DISTINCT FROM 'string'
         OR (v_item ? 'name_ar' AND jsonb_typeof(v_item -> 'name_ar') NOT IN ('string', 'null'))
         OR jsonb_typeof(v_item -> 'vat_treatment') IS DISTINCT FROM 'string'
      THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_TEXT' USING ERRCODE = '22023';
      END IF;

      v_custom_name := btrim(v_item ->> 'name');
      v_custom_name_ar := NULLIF(btrim(COALESCE(v_item ->> 'name_ar', '')), '');
      IF v_custom_name IS NULL OR length(v_custom_name) > 255
         OR v_custom_name ~ '^[[:space:][:cntrl:]]*$'
         OR length(COALESCE(v_custom_name_ar, '')) > 255
         OR (v_custom_name_ar IS NOT NULL AND v_custom_name_ar ~ '^[[:space:][:cntrl:]]*$')
      THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_DESCRIPTION' USING ERRCODE = '22023';
      END IF;

      BEGIN
        v_qty := NULLIF(btrim(COALESCE(v_item ->> 'quantity', '')), '')::numeric;
        v_custom_unit_price_input := NULLIF(
          btrim(COALESCE(v_item ->> 'unit_price', '')), ''
        )::numeric;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_NUMBER' USING ERRCODE = '22023';
      END;

      IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 999999999.999::numeric
         OR v_qty::text IN ('NaN', 'Infinity', '-Infinity')
         OR round(v_qty, 3) <> v_qty
      THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_QUANTITY' USING ERRCODE = '22023';
      END IF;
      IF v_custom_unit_price_input IS NULL OR v_custom_unit_price_input <= 0
         OR v_custom_unit_price_input > 9999999999.99::numeric
         OR v_custom_unit_price_input::text IN ('NaN', 'Infinity', '-Infinity')
         OR round(v_custom_unit_price_input, 2) <> v_custom_unit_price_input
      THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_UNIT_PRICE' USING ERRCODE = '22023';
      END IF;
      v_custom_unit_price := v_custom_unit_price_input;

      v_vat_treatment := btrim(v_item ->> 'vat_treatment');
      IF v_vat_treatment IS NULL
         OR v_vat_treatment NOT IN ('inherit', 'exclusive', 'inclusive') THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_VAT_TREATMENT' USING ERRCODE = '22023';
      END IF;
      IF v_vat_treatment = 'inherit' THEN
        v_vat_treatment := v_vat_mode;
      END IF;
      -- v_vat_mode is already constrained to the supported taxable modes.
      v_rate := 0.15::numeric;
      v_tax_category := 'S';
      v_line_amount := v_custom_unit_price * v_qty;
      IF v_line_amount > 9999999999.99::numeric THEN
        RAISE EXCEPTION 'CHECKOUT_LINE_AMOUNT_TOO_LARGE' USING ERRCODE = '22003';
      END IF;
      IF v_vat_treatment = 'inclusive' THEN
        v_line_total := round(v_line_amount, 2);
        v_line_subtotal := round(v_line_total / (1 + v_rate), 2);
        v_line_tax := v_line_total - v_line_subtotal;
      ELSE
        v_line_subtotal := round(v_line_amount, 2);
        v_line_tax := round(v_line_subtotal * v_rate, 2);
        v_line_total := v_line_subtotal + v_line_tax;
      END IF;

      v_item_rows := v_item_rows || jsonb_build_array(jsonb_build_object(
        'line_source', 'custom',
        'product_id', NULL,
        'product_unit_id', NULL,
        'product_unit_version', NULL,
        'name', v_custom_name,
        'name_ar', v_custom_name_ar,
        'sku', NULL,
        'unit', 'PCE',
        'selling_unit_name', 'PCE',
        'selling_unit_name_ar', NULL,
        'selling_unit_code', 'PCE',
        'package_quantity', v_qty,
        'package_quantity_scale', 3,
        'conversion_to_base', 1,
        'base_quantity', v_qty,
        'base_unit_name', 'PCE',
        'base_unit_name_ar', NULL,
        'base_unit_code', 'PCE',
        'base_quantity_scale', 3,
        'package_pricing_method', 'custom',
        'base_unit_price', v_custom_unit_price,
        'package_unit_price', v_custom_unit_price,
        'stock_tracked_at_sale', false,
        'service_item_at_sale', true,
        'quantity', v_qty,
        'unit_price', v_custom_unit_price,
        'line_amount', round(v_line_amount, 2),
        'tax_rate', v_rate,
        'tax_category', v_tax_category,
        'subtotal', v_line_subtotal,
        'tax_amount', v_line_tax,
        'total', v_line_total,
        'sort_order', v_sort_order
      ));
    END IF;

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total := v_total + v_line_total;
  END LOOP;

$custom_loop$;
BEGIN
  SELECT definition_md5
  INTO v_registered_hash
  FROM public.product_units_commercial_function_contracts_v1
  WHERE function_signature = 'public.pos_checkout_with_product_units_v1(jsonb)';

  v_definition := pg_get_functiondef(
    'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure
  );
  IF v_registered_hash IS NULL
     OR md5(v_definition) IS DISTINCT FROM v_registered_hash
     OR v_definition NOT LIKE '%INSERT INTO public.invoice_items%'
     OR v_definition NOT LIKE '%INSERT INTO public.pos_stock_movements%'
     OR v_definition NOT LIKE '%resolve_product_commercial_unit%'
     OR v_definition NOT LIKE '%checkout_request_fingerprint%'
  THEN
    RAISE EXCEPTION 'PHASE6_PACKAGE_CHECKOUT_DEFINITION_UNREVIEWED';
  END IF;

  v_definition := replace(
    v_definition,
    'FUNCTION public.pos_checkout_with_product_units_v1(',
    'FUNCTION public.pos_checkout_custom_lines_v1('
  );
  v_definition := replace(
    v_definition,
    '  v_expected_version integer;',
    '  v_expected_version integer;' || E'\n'
    || '  v_source text;' || E'\n'
    || '  v_custom_name text;' || E'\n'
    || '  v_custom_name_ar text;' || E'\n'
    || '  v_custom_unit_price numeric(12, 2);' || E'\n'
    || '  v_custom_unit_price_input numeric;'
  );
  IF position('v_custom_unit_price_input numeric;' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'PHASE6_PACKAGE_DECLARATION_TARGET_UNREVIEWED';
  END IF;
  IF position(v_item_field_contract IN v_definition) = 0 THEN
    RAISE EXCEPTION 'PHASE6_PACKAGE_ITEM_CONTRACT_UNREVIEWED';
  END IF;
  v_definition := replace(
    v_definition,
    v_item_field_contract,
    $custom_item_fields$
      'source', 'product_id', 'product_unit_id', 'package_quantity',
      'expected_product_unit_version', 'quantity', 'name', 'name_ar',
      'unit_price', 'vat_treatment'
$custom_item_fields$
  );
  v_definition := replace(
    v_definition,
    E'  v_vat_mode := CASE\n',
    $capability_guard$
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_items) AS item(value)
    WHERE item.value ? 'source'
      AND jsonb_typeof(item.value -> 'source') = 'string'
      AND btrim(item.value ->> 'source') = 'custom'
  ) THEN
    IF COALESCE((SELECT b.custom_lines_enabled FROM public.branches b WHERE b.id = v_branch.id), false)
       IS NOT TRUE THEN
      RAISE EXCEPTION 'CUSTOM_LINES_DISABLED_FOR_BRANCH' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_vat_mode := CASE
$capability_guard$
  );
  IF position('CUSTOM_LINES_DISABLED_FOR_BRANCH' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'PHASE6_CUSTOM_CAPABILITY_TARGET_UNREVIEWED';
  END IF;
  v_definition := replace(
    v_definition,
    E'      \'stock_tracked_at_sale\', stock_tracked_at_sale,\n',
    E'      \'line_source\', COALESCE(line_source, \'legacy\'),\n      \'stock_tracked_at_sale\', stock_tracked_at_sale,\n'
  );
  v_definition := replace(
    v_definition,
    '      package_unit_price, stock_tracked_at_sale, service_item_at_sale' ,
    '      package_unit_price, stock_tracked_at_sale, service_item_at_sale, line_source'
  );
  v_definition := replace(
    v_definition,
    E'      (v_line ->> \'stock_tracked_at_sale\')::boolean,\n      (v_line ->> \'service_item_at_sale\')::boolean\n    );',
    E'      (v_line ->> \'stock_tracked_at_sale\')::boolean,\n      (v_line ->> \'service_item_at_sale\')::boolean,\n      v_line ->> \'line_source\'\n    );'
  );
  v_definition := replace(
    v_definition,
    $mark_unit$
    PERFORM public.mark_product_unit_used(
      (v_line ->> 'product_unit_id')::uuid
    );
$mark_unit$,
    $mark_unit_guard$
    IF NULLIF(v_line ->> 'product_unit_id', '') IS NOT NULL THEN
      PERFORM public.mark_product_unit_used(
        (v_line ->> 'product_unit_id')::uuid
      );
    END IF;
$mark_unit_guard$
  );

  v_loop_start := position(
    E'  FOR v_item, v_sort_order IN\n    SELECT value, (ordinality - 1)::integer\n    FROM jsonb_array_elements(v_items) WITH ORDINALITY AS t(value, ordinality)\n  LOOP'
    IN v_definition
  );
  v_loop_end := position(
    E'  v_subtotal := round(v_subtotal, 2);\n'
    IN substring(v_definition FROM v_loop_start)
  );
  IF v_loop_start = 0 OR v_loop_end = 0
     OR position('FUNCTION public.pos_checkout_custom_lines_v1(' IN v_definition) = 0
     OR position($existing_line_source$'line_source', COALESCE(line_source, 'legacy')$existing_line_source$ IN v_definition) = 0
     OR position('service_item_at_sale, line_source' IN v_definition) = 0
     OR position($line_source_value$v_line ->> 'line_source'$line_source_value$ IN v_definition) = 0
     OR position('IF NULLIF(v_line ->> ''product_unit_id'', '''') IS NOT NULL THEN' IN v_definition) = 0
     OR position('RETURNING id INTO v_invoice_id' IN v_definition) = 0
  THEN
    RAISE EXCEPTION 'PHASE6_CUSTOM_CHECKOUT_PATCH_TARGET_MISSING';
  END IF;
  v_definition := substring(v_definition FROM 1 FOR v_loop_start - 1)
    || v_custom_loop
    || substring(v_definition FROM v_loop_start + v_loop_end - 1);

  EXECUTE v_definition;
END
$phase6_install_custom_checkout_helper$;

ALTER FUNCTION public.pos_checkout_custom_lines_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_custom_lines_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout_custom_lines_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pos_checkout_capability_base_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_items jsonb;
  v_item jsonb;
  v_source text;
  v_has_custom boolean := false;
  v_catalogue_items jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_PAYLOAD' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(COALESCE(p_payload ->> 'branch_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_IDENTIFIER' USING ERRCODE = '22023';
  END;
  v_items := p_payload -> 'items';
  IF v_branch_id IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS t(value)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_CHECKOUT_ITEM' USING ERRCODE = '22023';
    END IF;
    IF v_item ? 'source' THEN
      IF jsonb_typeof(v_item -> 'source') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'INVALID_CHECKOUT_ITEM_SOURCE' USING ERRCODE = '22023';
      END IF;
      v_source := NULLIF(btrim(v_item ->> 'source'), '');
    ELSE
      v_source := 'catalogue';
    END IF;
    IF v_source IS NULL OR v_source NOT IN ('catalogue', 'custom') THEN
      RAISE EXCEPTION 'INVALID_CHECKOUT_ITEM_SOURCE' USING ERRCODE = '22023';
    END IF;
    IF v_source = 'catalogue' THEN
      IF NULLIF(btrim(COALESCE(v_item ->> 'product_id', '')), '') IS NULL THEN
        RAISE EXCEPTION 'CATALOGUE_PRODUCT_ID_REQUIRED' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF (v_item ? 'product_id' AND jsonb_typeof(v_item -> 'product_id') <> 'null')
         OR (v_item ? 'product_unit_id' AND jsonb_typeof(v_item -> 'product_unit_id') <> 'null')
      THEN
        RAISE EXCEPTION 'CUSTOM_LINE_PRODUCT_IDENTITY_FORBIDDEN' USING ERRCODE = '22023';
      END IF;
      v_has_custom := true;
    END IF;
  END LOOP;

  IF v_has_custom THEN
    RETURN public.pos_checkout_custom_lines_v1(p_payload);
  END IF;

  SELECT jsonb_agg(item.value - 'source' ORDER BY item.ordinality)
  INTO v_catalogue_items
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS item(value, ordinality);
  PERFORM set_config('app.checkout_line_source', 'catalogue', true);
  RETURN public.pos_checkout_capability_catalogue_base_v1(
    jsonb_set(p_payload, '{items}', COALESCE(v_catalogue_items, '[]'::jsonb), true)
  );
END
$function$;

ALTER FUNCTION public.pos_checkout_capability_base_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_capability_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout_capability_base_v1(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.pos_checkout_capability_base_v1(jsonb) IS
  'Phase 6 source-aware commercial checkout dispatcher. Legacy product_id payloads remain catalogue; explicit Custom Lines use server-authoritative validation and the existing invoice/output pipeline.';

NOTIFY pgrst, 'reload schema';

COMMIT;
