-- Phase 7: source-aware reporting and immutable credit/restock authority.
--
-- Invoice snapshots remain the source of truth. This migration does not
-- change checkout, fiscal calculation, ZATCA, or issued historical rows.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $phase7_required_contracts$
BEGIN
  IF to_regclass('public.invoice_items') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.pos_stock_movements') IS NULL
     OR to_regclass('public.product_units_commercial_function_contracts_v1') IS NULL
     OR to_regprocedure('public.create_partial_credit_note_legacy_base_v1(jsonb)') IS NULL
     OR to_regprocedure('public.create_partial_credit_note_with_product_units_v1(jsonb)') IS NULL
     OR to_regprocedure('public.branch_effective_stock_enabled(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_sales_report_summary(date,date,uuid)') IS NULL
     OR to_regprocedure('public.get_customer_intelligence(jsonb)') IS NULL
     OR to_regprocedure('public.reporting_resolve_scope(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'PHASE7_SOURCE_AWARE_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$phase7_required_contracts$;

-- Preserve the existing financial-credit implementation under private names.
-- The clones retain its request fingerprint and cumulative-credit validation,
-- but deliberately suppress its old mutable-product restock pass. The public
-- wrapper below restores inventory from the original immutable sale snapshot.
DO $phase7_preserve_legacy_credit_delegate$
DECLARE
  v_definition text;
  v_function_anchor text :=
    'FUNCTION public.create_partial_credit_note_legacy_base_v1(';
  v_legacy_stock_anchor text := $anchor$  v_effective_return_stock :=
    v_return_stock
    AND COALESCE(v_tenant_business_type, 'trading') <> 'service'
    AND public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id);$anchor$;
  v_capability_stock_anchor text := $anchor$  v_effective_return_stock :=
    v_return_stock
    AND public.branch_effective_stock_enabled(v_original.tenant_id, v_original.branch_id);$anchor$;
  v_recognized_stock_anchor text;
BEGIN
  IF to_regprocedure('public.create_partial_credit_note_legacy_phase7_base_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef(
      'public.create_partial_credit_note_legacy_base_v1(jsonb)'::regprocedure
    );

    -- Only two reviewed predecessors are accepted: the historical
    -- tenant-business-type form and the capability form installed by
    -- 20260813000100. Both retain the established security-definer credit
    -- transaction; Phase 7 replaces only their inherited restock decision.
    IF position(v_function_anchor IN v_definition) = 0
       OR position('SECURITY DEFINER' IN v_definition) = 0
       OR position('SET search_path TO ''public''' IN v_definition) = 0
       OR position('SET row_security TO ''off''' IN v_definition) = 0
       OR position('auth.uid()' IN v_definition) = 0
       OR position('idempotency' IN v_definition) = 0
       OR position('FOR UPDATE' IN v_definition) = 0
    THEN
      RAISE EXCEPTION 'PHASE7_LEGACY_CREDIT_DEFINITION_UNREVIEWED';
    END IF;

    IF position(v_legacy_stock_anchor IN v_definition) > 0
       AND position(v_capability_stock_anchor IN v_definition) = 0
    THEN
      v_recognized_stock_anchor := v_legacy_stock_anchor;
    ELSIF position(v_capability_stock_anchor IN v_definition) > 0
       AND position(v_legacy_stock_anchor IN v_definition) = 0
    THEN
      v_recognized_stock_anchor := v_capability_stock_anchor;
    ELSE
      RAISE EXCEPTION 'PHASE7_LEGACY_CREDIT_DEFINITION_UNREVIEWED';
    END IF;

    v_definition := replace(
      v_definition,
      v_function_anchor,
      'FUNCTION public.create_partial_credit_note_legacy_phase7_base_v1('
    );
    v_definition := replace(
      v_definition,
      v_recognized_stock_anchor,
      '  v_effective_return_stock := false;'
    );
    IF position('create_partial_credit_note_legacy_phase7_base_v1' IN v_definition) = 0
       OR position(v_recognized_stock_anchor IN v_definition) <> 0
    THEN
      RAISE EXCEPTION 'PHASE7_LEGACY_CREDIT_PATCH_TARGET_MISSING';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$phase7_preserve_legacy_credit_delegate$;

ALTER FUNCTION public.create_partial_credit_note_legacy_phase7_base_v1(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_legacy_phase7_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_legacy_phase7_base_v1(jsonb)
  TO service_role;

DO $phase7_preserve_package_credit_delegate$
DECLARE
  v_definition text;
  v_function_anchor text :=
    'FUNCTION public.create_partial_credit_note_with_product_units_v1(';
  v_stock_anchor text := $anchor$  v_effective_return_stock :=
    v_return_stock
    AND public.branch_effective_stock_enabled(
      v_original.tenant_id,
      v_original.branch_id
    );$anchor$;
BEGIN
  IF to_regprocedure('public.create_partial_credit_note_with_product_units_phase7_base_v1(jsonb)') IS NULL THEN
    v_definition := pg_get_functiondef(
      'public.create_partial_credit_note_with_product_units_v1(jsonb)'::regprocedure
    );
    IF position(v_function_anchor IN v_definition) = 0
       OR position(v_stock_anchor IN v_definition) = 0
    THEN
      RAISE EXCEPTION 'PHASE7_PACKAGE_CREDIT_DEFINITION_UNREVIEWED';
    END IF;

    v_definition := replace(
      v_definition,
      v_function_anchor,
      'FUNCTION public.create_partial_credit_note_with_product_units_phase7_base_v1('
    );
    v_definition := replace(
      v_definition,
      v_stock_anchor,
      '  v_effective_return_stock := false;'
    );
    IF position('create_partial_credit_note_with_product_units_phase7_base_v1' IN v_definition) = 0
       OR position(v_stock_anchor IN v_definition) <> 0
    THEN
      RAISE EXCEPTION 'PHASE7_PACKAGE_CREDIT_PATCH_TARGET_MISSING';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$phase7_preserve_package_credit_delegate$;

ALTER FUNCTION public.create_partial_credit_note_with_product_units_phase7_base_v1(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_with_product_units_phase7_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- This dispatcher preserves the former package/legacy choice and every input
-- byte used for its existing credit-note fingerprint. It is private because
-- the public function adds the snapshot-authoritative restock pass below.
CREATE OR REPLACE FUNCTION public.create_partial_credit_note_phase7_base_v1(
  p_payload jsonb
)
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
    RETURN public.create_partial_credit_note_with_product_units_phase7_base_v1(
      p_payload
    );
  END IF;

  RETURN public.create_partial_credit_note_legacy_phase7_base_v1(p_payload);
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid returned item identifier'
    USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.create_partial_credit_note_phase7_base_v1(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_phase7_base_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_phase7_base_v1(jsonb)
  TO service_role;

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
  v_return_stock boolean;
  v_effective_return_stock boolean;
  v_request record;
BEGIN
  -- The delegated financial path validates authorization, payload shape,
  -- cumulative quantities, idempotency, refund limits, and document state.
  v_result := public.create_partial_credit_note_phase7_base_v1(p_payload);
  IF COALESCE((v_result ->> 'idempotent_replay')::boolean, false) THEN
    RETURN v_result;
  END IF;

  v_credit_note_id := (v_result ->> 'credit_note_invoice_id')::uuid;
  IF v_credit_note_id IS NULL THEN
    RAISE EXCEPTION 'PHASE7_CREDIT_NOTE_ID_MISSING' USING ERRCODE = '23514';
  END IF;

  SELECT
    original.id,
    original.tenant_id,
    original.branch_id
  INTO v_original
  FROM public.invoices credit_note
  JOIN public.invoices original
    ON original.id = credit_note.original_invoice_id
   AND original.tenant_id = credit_note.tenant_id
   AND original.branch_id = credit_note.branch_id
  WHERE credit_note.id = v_credit_note_id
  FOR UPDATE OF credit_note, original;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHASE7_CREDIT_NOTE_ORIGINAL_MISSING' USING ERRCODE = '23514';
  END IF;

  -- A new credit line inherits immutable provenance from the original issued
  -- line. This is intentionally prospective: historical documents are not
  -- rewritten, including documents created before Phase 7.
  UPDATE public.invoice_items credit_item
  SET line_source = original_item.line_source,
      stock_tracked_at_sale = original_item.stock_tracked_at_sale,
      service_item_at_sale = original_item.service_item_at_sale
  FROM public.invoice_items original_item
  WHERE credit_item.invoice_id = v_credit_note_id
    AND credit_item.original_invoice_item_id = original_item.id
    AND original_item.invoice_id = v_original.id
    AND original_item.tenant_id = v_original.tenant_id;

  v_return_stock := COALESCE((p_payload ->> 'return_stock')::boolean, false);
  v_effective_return_stock := v_return_stock
    AND public.branch_effective_stock_enabled(
      v_original.tenant_id,
      v_original.branch_id
    );

  IF NOT v_effective_return_stock THEN
    RETURN v_result;
  END IF;

  -- Eligibility is strictly immutable: the source and sale-time flags on the
  -- original invoice item decide whether a credit can restore stock. Current
  -- product settings are never read for this decision.
  IF EXISTS (
    SELECT 1
    FROM public.invoice_items credit_item
    JOIN public.invoice_items original_item
      ON original_item.id = credit_item.original_invoice_item_id
     AND original_item.invoice_id = v_original.id
     AND original_item.tenant_id = v_original.tenant_id
    LEFT JOIN public.products product
      ON product.id = original_item.product_id
     AND product.tenant_id = v_original.tenant_id
     AND product.branch_id = v_original.branch_id
    WHERE credit_item.invoice_id = v_credit_note_id
      AND original_item.line_source IS DISTINCT FROM 'custom'
      AND COALESCE(original_item.stock_tracked_at_sale, false) IS TRUE
      AND COALESCE(original_item.service_item_at_sale, false) IS FALSE
      AND product.id IS NULL
  ) THEN
    -- A deleted/unavailable product cannot receive a physical stock mutation.
    -- Raising here rolls back the delegated financial credit and refund too.
    RAISE EXCEPTION 'CREDIT_RESTOCK_TARGET_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;

  -- Lock still-existing targets in a stable order. Active/archived/name/stock
  -- fields are deliberately irrelevant; the row is required only to apply a
  -- physical balance change after immutable eligibility has been established.
  PERFORM product.id
  FROM public.products product
  JOIN (
    SELECT DISTINCT original_item.product_id
    FROM public.invoice_items credit_item
    JOIN public.invoice_items original_item
      ON original_item.id = credit_item.original_invoice_item_id
     AND original_item.invoice_id = v_original.id
     AND original_item.tenant_id = v_original.tenant_id
    WHERE credit_item.invoice_id = v_credit_note_id
      AND original_item.line_source IS DISTINCT FROM 'custom'
      AND COALESCE(original_item.stock_tracked_at_sale, false) IS TRUE
      AND COALESCE(original_item.service_item_at_sale, false) IS FALSE
  ) target ON target.product_id = product.id
  WHERE product.tenant_id = v_original.tenant_id
    AND product.branch_id = v_original.branch_id
  ORDER BY product.id
  FOR UPDATE OF product;

  FOR v_request IN
    SELECT
      original_item.product_id,
      credit_item.product_unit_id,
      credit_item.product_unit_version,
      credit_item.package_quantity,
      credit_item.conversion_to_base,
      COALESCE(credit_item.base_quantity, credit_item.quantity) AS base_quantity,
      credit_item.selling_unit_name,
      credit_item.base_unit_name
    FROM public.invoice_items credit_item
    JOIN public.invoice_items original_item
      ON original_item.id = credit_item.original_invoice_item_id
     AND original_item.invoice_id = v_original.id
     AND original_item.tenant_id = v_original.tenant_id
    WHERE credit_item.invoice_id = v_credit_note_id
      AND original_item.line_source IS DISTINCT FROM 'custom'
      AND COALESCE(original_item.stock_tracked_at_sale, false) IS TRUE
      AND COALESCE(original_item.service_item_at_sale, false) IS FALSE
    ORDER BY original_item.product_id, credit_item.id
  LOOP
    UPDATE public.products
    SET stock_quantity = COALESCE(stock_quantity, 0) + v_request.base_quantity
    WHERE id = v_request.product_id
      AND tenant_id = v_original.tenant_id
      AND branch_id = v_original.branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_RESTOCK_TARGET_UNAVAILABLE' USING ERRCODE = '23514';
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
  END LOOP;

  RETURN v_result;
END
$function$;

ALTER FUNCTION public.create_partial_credit_note(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_partial_credit_note(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.create_partial_credit_note(jsonb) IS
  'Snapshot-authoritative partial credit notes. Financial validation remains delegated; stock restores only immutable eligible original sale quantities.';

-- The modal's stock affordance now reports the same immutable decision as the
-- server. Legacy rows without a sale-time stock snapshot fail closed instead
-- of borrowing mutable current-product configuration.
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
    CASE
      WHEN oi.line_source = 'custom' THEN false
      ELSE COALESCE(oi.stock_tracked_at_sale, false)
    END AS track_stock,
    CASE
      WHEN oi.line_source = 'custom' THEN true
      ELSE COALESCE(oi.service_item_at_sale, false)
    END AS is_service,
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

ALTER FUNCTION public.get_invoice_refundable_items_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_invoice_refundable_items_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_refundable_items_v2(uuid)
  TO authenticated, service_role;

-- Customer intelligence has a separately named Top Products panel. Its
-- financial customer totals remain invoice-based, while this product-only
-- breakdown must not turn a null-product Custom Line into a product row.
DO $phase7_customer_top_products_exclude_custom$
DECLARE
  v_definition text;
  v_anchor text := $anchor$    FROM sales
    JOIN public.invoice_items ii
      ON ii.invoice_id = sales.id
     AND ii.tenant_id = sales.tenant_id
    WHERE (v_product_id IS NULL OR ii.product_id = v_product_id)
      AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
    GROUP BY$anchor$;
  v_replacement text := $replacement$    FROM sales
    JOIN public.invoice_items ii
      ON ii.invoice_id = sales.id
     AND ii.tenant_id = sales.tenant_id
    WHERE ii.line_source IS DISTINCT FROM 'custom'
      AND (v_product_id IS NULL OR ii.product_id = v_product_id)
      AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
    GROUP BY$replacement$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.get_customer_intelligence(jsonb)'::regprocedure
  );
  IF position('ii.line_source IS DISTINCT FROM ''custom''' IN v_definition) = 0 THEN
    IF length(v_definition) - length(replace(v_definition, v_anchor, ''))
       <> length(v_anchor)
    THEN
      RAISE EXCEPTION 'PHASE7_CUSTOMER_PRODUCT_REPORT_DEFINITION_UNREVIEWED';
    END IF;
    v_definition := replace(v_definition, v_anchor, v_replacement);
    IF position(v_replacement IN v_definition) = 0 THEN
      RAISE EXCEPTION 'PHASE7_CUSTOMER_PRODUCT_REPORT_PATCH_TARGET_MISSING';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$phase7_customer_top_products_exclude_custom$;

ALTER FUNCTION public.get_customer_intelligence(jsonb) OWNER TO postgres;

-- Keep canonical financial totals from get_sales_report_summary, but classify
-- item rows from immutable invoice snapshots. Custom lines remain explicit
-- line rows (never a name-derived product) and category reporting stays
-- catalogue-oriented.
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
  v_top_items jsonb := '[]'::jsonb;
  v_top_products jsonb := '[]'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_source_summary jsonb := '[]'::jsonb;
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
      CASE
        WHEN ii.line_source = 'custom' THEN 'custom'
        WHEN COALESCE(ii.service_item_at_sale, false) THEN 'service'
        WHEN ii.product_id IS NOT NULL THEN 'product'
        ELSE 'legacy'
      END AS line_type,
      CASE
        WHEN ii.line_source = 'custom' THEN 'custom:' || ii.id::text
        WHEN ii.product_id IS NOT NULL THEN ii.product_id::text
        ELSE 'legacy:' || ii.id::text
      END AS item_key,
      ii.product_id,
      ii.product_unit_id,
      ii.product_unit_version,
      COALESCE(NULLIF(btrim(ii.name), ''), 'Unknown item') AS item_name,
      NULLIF(btrim(ii.name_ar), '') AS item_name_ar,
      COALESCE(NULLIF(btrim(ii.selling_unit_name), ''), NULLIF(btrim(ii.unit), ''), 'Unit') AS unit_name,
      COALESCE(NULLIF(btrim(ii.selling_unit_code), ''), 'PCE') AS unit_code,
      COALESCE(ii.conversion_to_base, 1) AS conversion_to_base,
      COALESCE(ii.package_unit_price, ii.unit_price, 0) AS package_unit_price,
      inv_doc.accounting_sign * COALESCE(ii.package_quantity, ii.quantity, 0) AS package_quantity,
      inv_doc.accounting_sign * COALESCE(ii.base_quantity, ii.quantity, 0) AS base_quantity,
      inv_doc.accounting_sign * COALESCE(ii.tax_amount, 0) AS vat_amount,
      inv_doc.accounting_sign * COALESCE(ii.total, 0) AS revenue
    FROM inv_doc
    JOIN public.invoice_items ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
  ),
  item_totals AS (
    SELECT
      item_key,
      line_type,
      min(product_id::text)::uuid AS product_id,
      min(item_name) AS item_name,
      min(item_name_ar) AS item_name_ar,
      sum(base_quantity) AS base_quantity,
      sum(vat_amount) AS vat_amount,
      sum(revenue) AS revenue
    FROM line_rows
    GROUP BY item_key, line_type
    ORDER BY sum(revenue) DESC, min(item_name)
    LIMIT 10
  ),
  package_totals AS (
    SELECT
      lr.item_key,
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
    JOIN item_totals item ON item.item_key = lr.item_key
    WHERE lr.line_type <> 'custom'
    GROUP BY
      lr.item_key,
      lr.product_unit_id,
      lr.product_unit_version,
      lr.unit_name,
      lr.unit_code,
      lr.conversion_to_base,
      lr.package_unit_price
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'itemKey', item.item_key,
    'productId', item.product_id,
    'lineType', item.line_type,
    'name', item.item_name,
    'nameAr', item.item_name_ar,
    'quantity', item.base_quantity,
    'baseQuantity', item.base_quantity,
    'vat', item.vat_amount,
    'revenue', item.revenue,
    'pct', CASE
      WHEN v_total_revenue <> 0
        THEN round((item.revenue / v_total_revenue) * 100, 2)
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
      WHERE packages.item_key = item.item_key
    ), '[]'::jsonb)
  ) ORDER BY item.revenue DESC, item.item_name), '[]'::jsonb)
  INTO v_top_items
  FROM item_totals item;

  -- Keep the legacy field semantically honest for consumers still titled
  -- "Products". The current Sales UI uses topItems, where Custom is explicit.
  SELECT COALESCE(jsonb_agg(entry.item ORDER BY entry.ordinality), '[]'::jsonb)
  INTO v_top_products
  FROM jsonb_array_elements(v_top_items) WITH ORDINALITY AS entry(item, ordinality)
  WHERE entry.item ->> 'lineType' <> 'custom';

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
    WHERE ii.line_source IS DISTINCT FROM 'custom'
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
  classified_rows AS (
    SELECT
      CASE
        WHEN ii.line_source = 'custom' THEN 'custom'
        WHEN COALESCE(ii.service_item_at_sale, false) THEN 'service'
        WHEN ii.product_id IS NOT NULL THEN 'product'
        ELSE 'legacy'
      END AS line_type,
      inv_doc.accounting_sign * COALESCE(ii.base_quantity, ii.quantity, 0) AS quantity,
      inv_doc.accounting_sign * COALESCE(ii.subtotal, 0) AS subtotal,
      inv_doc.accounting_sign * COALESCE(ii.tax_amount, 0) AS vat,
      inv_doc.accounting_sign * COALESCE(ii.total, 0) AS revenue
    FROM inv_doc
    JOIN public.invoice_items ii
      ON ii.invoice_id = inv_doc.invoice_id
     AND ii.tenant_id = inv_doc.tenant_id
  ),
  source_rows AS (
    SELECT
      line_type,
      sum(quantity) AS quantity,
      sum(subtotal) AS subtotal,
      sum(vat) AS vat,
      sum(revenue) AS revenue
    FROM classified_rows
    GROUP BY line_type
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineType', line_type,
    'quantity', quantity,
    'subtotal', subtotal,
    'vat', vat,
    'revenue', revenue
  ) ORDER BY line_type), '[]'::jsonb)
  INTO v_source_summary
  FROM source_rows;

  RETURN v_summary || jsonb_build_object(
    'quantityBasis', 'base_quantity',
    'topProducts', v_top_products,
    'topItems', v_top_items,
    'catPerformance', v_categories,
    'categoryBreakdown', v_categories,
    'lineSourceSummary', v_source_summary
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
  'Source-aware sales report: immutable Product, Service, Custom, and legacy item classifications with financial totals retained from canonical reporting.';

-- Product Units has an intentional definition-fingerprint registry. Refresh
-- only the public credit dispatcher entry after this reviewed replacement so
-- later strict verification still detects unrelated drift.
UPDATE public.product_units_commercial_function_contracts_v1
SET definition_md5 = md5(pg_get_functiondef(
  'public.create_partial_credit_note(jsonb)'::regprocedure
))
WHERE function_signature = 'public.create_partial_credit_note(jsonb)';

COMMIT;
