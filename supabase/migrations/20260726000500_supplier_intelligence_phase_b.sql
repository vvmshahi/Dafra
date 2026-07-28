BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TEMP TABLE supplier_intelligence_preservation_baseline
ON COMMIT DROP
AS
SELECT
  (SELECT count(*) FROM public.suppliers) AS supplier_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      s.id, s.tenant_id, s.branch_id, s.name, s.name_ar, s.vat_number,
      s.payment_terms, s.is_active, s.created_at, s.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.suppliers s
  ) AS supplier_fingerprint,
  (SELECT count(*) FROM public.purchases) AS purchase_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      p.id, p.tenant_id, p.branch_id, p.supplier_id, p.purchase_date,
      p.purchase_mode, p.status, p.receiving_status, p.payment_status,
      p.subtotal, p.vat_amount, p.total_amount, p.created_at, p.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.purchases p
  ) AS purchase_fingerprint,
  (SELECT count(*) FROM public.purchase_items) AS purchase_item_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      pi.id, pi.purchase_id, pi.inventory_item_id, pi.product_id,
      pi.product_unit_id, pi.name, pi.quantity, pi.unit_cost, pi.total,
      pi.vat_amount, pi.package_quantity, pi.base_quantity,
      pi.purchase_unit_name, pi.base_unit_name
    )::text, 0)::numeric)::text, '0'))
    FROM public.purchase_items pi
  ) AS purchase_item_fingerprint,
  (SELECT count(*) FROM public.purchase_stock_movements) AS stock_movement_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      psm.id, psm.tenant_id, psm.branch_id, psm.purchase_id,
      psm.purchase_item_id, psm.quantity_delta, psm.reason,
      psm.reversal_of, psm.created_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.purchase_stock_movements psm
  ) AS stock_movement_fingerprint;

-- Supplier intelligence reads document truth only. This index begins with the
-- trusted tenant/branch/supplier scope and preserves deterministic history
-- ordering. It does not index stock movements or duplicate the existing
-- purchase_items(purchase_id) index.
CREATE INDEX supplier_intelligence_documents_scope_idx
  ON public.purchases (
    tenant_id,
    branch_id,
    supplier_id,
    purchase_date DESC,
    created_at DESC,
    id DESC
  )
  INCLUDE (
    purchase_mode,
    status,
    receiving_status,
    payment_status,
    total_amount,
    bill_number
  )
  WHERE supplier_id IS NOT NULL
    AND status <> 'cancelled'
    AND receiving_status NOT IN ('cancelled', 'reversed');

COMMENT ON INDEX public.supplier_intelligence_documents_scope_idx IS
  'Supports scoped supplier activity reporting from stored counted purchase documents; stock events are intentionally excluded.';

CREATE OR REPLACE FUNCTION public.get_supplier_intelligence(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_supplier_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_payment_status text;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_start_date date;
  v_end_date date;
  v_days integer;
  v_bucket text;
  v_supplier jsonb;
  v_summary jsonb;
  v_recent jsonb;
  v_payment_summary jsonb;
  v_top_products jsonb;
  v_timeline jsonb;
  v_most_active_branch jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'supplier_id', 'branch_id', 'start_date', 'end_date',
      'product_id', 'product_unit_id', 'payment_status'
    )
  ) THEN
    RAISE EXCEPTION 'Payload contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(p_payload ->> 'supplier_id'), '') IS NULL THEN
    RAISE EXCEPTION 'supplier_id is required' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_supplier_id := (p_payload ->> 'supplier_id')::uuid;
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_product_id := NULLIF(btrim(p_payload ->> 'product_id'), '')::uuid;
    v_product_unit_id := NULLIF(btrim(p_payload ->> 'product_unit_id'), '')::uuid;
    v_start_date := COALESCE(NULLIF(btrim(p_payload ->> 'start_date'), '')::date, v_today - 29);
    v_end_date := COALESCE(NULLIF(btrim(p_payload ->> 'end_date'), '')::date, v_today);
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Invalid supplier intelligence identifier or date' USING ERRCODE = '22023';
  END;

  v_payment_status := NULLIF(btrim(p_payload ->> 'payment_status'), '');

  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'Date range must be valid and no longer than 10 years' USING ERRCODE = '22023';
  END IF;
  IF v_payment_status IS NOT NULL
     AND v_payment_status NOT IN ('paid', 'partial', 'unpaid')
  THEN
    RAISE EXCEPTION 'Invalid payment status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT v_scope
  FROM public.reporting_resolve_scope(v_branch_id);

  SELECT jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'nameAr', s.name_ar,
    'phone', s.phone,
    'email', s.email,
    'vatNumber', s.vat_number,
    'crNumber', s.cr_number,
    'contactPerson', s.contact_person,
    'paymentTerms', s.payment_terms,
    'isActive', s.is_active,
    'branchId', s.branch_id
  )
  INTO v_supplier
  FROM public.suppliers s
  WHERE s.id = v_supplier_id
    AND s.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR s.branch_id = v_scope.scope_branch_id);

  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'Supplier not found in report scope' USING ERRCODE = '42501';
  END IF;

  IF v_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = v_product_id
      AND p.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
  ) THEN
    RAISE EXCEPTION 'Product not found in report scope' USING ERRCODE = '42501';
  END IF;

  IF v_product_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.product_units pu
    WHERE pu.id = v_product_unit_id
      AND pu.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR pu.branch_id = v_scope.scope_branch_id)
      AND (v_product_id IS NULL OR pu.product_id = v_product_id)
  ) THEN
    RAISE EXCEPTION 'Product unit not found in report scope' USING ERRCODE = '42501';
  END IF;

  WITH documents AS (
    SELECT p.*, cp.is_counted
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id = v_supplier_id
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_start_date AND v_end_date
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.purchase_items pi
          WHERE pi.purchase_id = cp.id
            AND (v_product_id IS NULL OR pi.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
        )
      )
  ),
  purchase_gaps AS (
    SELECT
      purchase_date,
      purchase_date - lag(purchase_date) OVER (
        ORDER BY purchase_date, created_at, id
      ) AS days_between
    FROM documents
  ),
  totals AS (
    SELECT
      COALESCE(sum(total_amount), 0)::numeric AS gross,
      count(*)::integer AS purchase_count,
      (
        SELECT round(avg(days_between)::numeric, 1)
        FROM purchase_gaps
        WHERE days_between IS NOT NULL
      ) AS average_days_between,
      max(purchase_date) AS last_purchase_date
    FROM documents
  ),
  last_purchase AS (
    SELECT jsonb_build_object(
      'id', d.id,
      'reference', NULLIF(btrim(d.bill_number), ''),
      'purchaseDate', d.purchase_date,
      'createdAt', d.created_at,
      'branchId', d.branch_id,
      'branchName', b.name,
      'branchNameAr', b.name_ar,
      'total', d.total_amount,
      'paymentStatus', d.payment_status,
      'status', d.status,
      'receivingStatus', d.receiving_status
    ) AS value
    FROM documents d
    JOIN public.branches b ON b.id = d.branch_id
    ORDER BY d.purchase_date DESC, d.created_at DESC, d.id DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'grossPurchases', t.gross,
    'purchaseCount', t.purchase_count,
    'averagePurchaseValue', CASE
      WHEN t.purchase_count = 0 THEN 0
      ELSE round(t.gross / t.purchase_count, 2)
    END,
    'averageDaysBetweenPurchases', t.average_days_between,
    'purchasesLast30Days', 0,
    'purchasesPrevious30Days', 0,
    'daysSinceLastPurchase', CASE
      WHEN t.last_purchase_date IS NULL THEN NULL
      ELSE v_today - t.last_purchase_date
    END,
    'lastPurchase', (SELECT value FROM last_purchase)
  )
  INTO v_summary
  FROM totals t;

  WITH comparison_documents AS (
    SELECT p.*
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id = v_supplier_id
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_today - 59 AND v_today
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.purchase_items pi
          WHERE pi.purchase_id = cp.id
            AND (v_product_id IS NULL OR pi.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
        )
      )
  ),
  comparison AS (
    SELECT
      COALESCE(sum(total_amount) FILTER (
        WHERE purchase_date BETWEEN v_today - 29 AND v_today
      ), 0)::numeric AS recent_gross,
      count(*) FILTER (
        WHERE purchase_date BETWEEN v_today - 29 AND v_today
      )::integer AS recent_count,
      COALESCE(sum(total_amount) FILTER (
        WHERE purchase_date BETWEEN v_today - 59 AND v_today - 30
      ), 0)::numeric AS previous_gross,
      count(*) FILTER (
        WHERE purchase_date BETWEEN v_today - 59 AND v_today - 30
      )::integer AS previous_count
    FROM comparison_documents
  )
  SELECT jsonb_build_object(
    'recentGross', recent_gross,
    'recentPurchaseCount', recent_count,
    'previousGross', previous_gross,
    'previousPurchaseCount', previous_count,
    'grossPercentChange', CASE
      WHEN previous_gross = 0 THEN NULL
      ELSE round(((recent_gross - previous_gross) / previous_gross) * 100, 1)
    END,
    'purchasePercentChange', CASE
      WHEN previous_count = 0 THEN NULL
      ELSE round(((recent_count - previous_count)::numeric / previous_count) * 100, 1)
    END
  )
  INTO v_recent
  FROM comparison;

  v_summary := jsonb_set(
    jsonb_set(
      v_summary,
      '{purchasesLast30Days}',
      COALESCE(v_recent -> 'recentPurchaseCount', '0'::jsonb)
    ),
    '{purchasesPrevious30Days}',
    COALESCE(v_recent -> 'previousPurchaseCount', '0'::jsonb)
  );

  WITH documents AS (
    SELECT p.*
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id = v_supplier_id
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_start_date AND v_end_date
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.purchase_items pi
          WHERE pi.purchase_id = cp.id
            AND (v_product_id IS NULL OR pi.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
        )
      )
  ),
  rows AS (
    SELECT
      payment_status,
      count(*)::integer AS purchase_count,
      COALESCE(sum(total_amount), 0)::numeric AS gross
    FROM documents
    GROUP BY payment_status
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'status', payment_status,
    'purchaseCount', purchase_count,
    'grossPurchases', gross
  ) ORDER BY CASE payment_status WHEN 'paid' THEN 1 WHEN 'partial' THEN 2 ELSE 3 END), '[]'::jsonb)
  INTO v_payment_summary
  FROM rows;

  WITH documents AS (
    SELECT p.*
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id = v_supplier_id
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_start_date AND v_end_date
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
  ),
  item_rows AS (
    SELECT
      pi.product_id,
      pi.product_unit_id,
      COALESCE(NULLIF(btrim(pi.name), ''), pr.name, 'Unknown item') AS item_name,
      pr.name_ar AS item_name_ar,
      COALESCE(
        NULLIF(btrim(pi.purchase_unit_name), ''),
        NULLIF(btrim(pi.base_unit_name), ''),
        NULLIF(btrim(pi.package_unit_code), ''),
        'Unit'
      ) AS unit_name,
      pu.name_ar AS unit_name_ar,
      COALESCE(NULLIF(btrim(pi.package_unit_code), ''), pu.unit_code) AS unit_code,
      COALESCE(pi.package_quantity, pi.quantity, 0)::numeric AS package_quantity,
      pi.base_quantity,
      NULLIF(btrim(pi.base_unit_name), '') AS base_unit_name,
      COALESCE(pi.total, 0)::numeric AS line_total,
      COALESCE(pi.package_unit_cost, pi.unit_cost)::numeric AS stored_unit_cost,
      d.id AS purchase_id,
      d.purchase_date
    FROM documents d
    JOIN public.purchase_items pi ON pi.purchase_id = d.id
    LEFT JOIN public.products pr ON pr.id = pi.product_id
    LEFT JOIN public.product_units pu ON pu.id = pi.product_unit_id
    WHERE (v_product_id IS NULL OR pi.product_id = v_product_id)
      AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
  ),
  aggregated AS (
    SELECT
      product_id,
      product_unit_id,
      item_name,
      item_name_ar,
      unit_name,
      unit_name_ar,
      unit_code,
      sum(package_quantity)::numeric AS quantity,
      CASE
        WHEN count(*) FILTER (WHERE base_quantity IS NOT NULL) = count(*)
          THEN sum(base_quantity)::numeric
        ELSE NULL
      END AS base_quantity,
      max(base_unit_name) AS base_unit_name,
      sum(line_total)::numeric AS gross_amount,
      count(DISTINCT purchase_id)::integer AS purchase_count,
      max(purchase_date) AS last_purchased,
      CASE
        WHEN sum(package_quantity) = 0 THEN NULL
        ELSE round(
          sum(stored_unit_cost * package_quantity)
          / NULLIF(sum(package_quantity), 0),
          2
        )
      END AS average_unit_cost
    FROM item_rows
    GROUP BY
      product_id, product_unit_id, item_name, item_name_ar,
      unit_name, unit_name_ar, unit_code
  ),
  top_rows AS (
    SELECT *
    FROM aggregated
    ORDER BY gross_amount DESC, quantity DESC, lower(item_name), lower(unit_name)
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', product_id,
    'productUnitId', product_unit_id,
    'name', item_name,
    'nameAr', item_name_ar,
    'unitName', unit_name,
    'unitNameAr', unit_name_ar,
    'unitCode', unit_code,
    'quantity', quantity,
    'baseQuantity', base_quantity,
    'baseUnitName', base_unit_name,
    'grossAmount', gross_amount,
    'purchaseCount', purchase_count,
    'lastPurchased', last_purchased,
    'averageUnitCost', average_unit_cost
  ) ORDER BY gross_amount DESC, quantity DESC, lower(item_name), lower(unit_name)), '[]'::jsonb)
  INTO v_top_products
  FROM top_rows;

  v_days := v_end_date - v_start_date + 1;
  v_bucket := CASE
    WHEN v_days <= 62 THEN 'day'
    WHEN v_days <= 730 THEN 'week'
    ELSE 'month'
  END;

  WITH documents AS (
    SELECT p.*
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id = v_supplier_id
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_start_date AND v_end_date
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.purchase_items pi
          WHERE pi.purchase_id = cp.id
            AND (v_product_id IS NULL OR pi.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
        )
      )
  ),
  buckets AS (
    SELECT
      CASE v_bucket
        WHEN 'day' THEN purchase_date
        WHEN 'week' THEN date_trunc('week', purchase_date::timestamp)::date
        ELSE date_trunc('month', purchase_date::timestamp)::date
      END AS bucket_start,
      sum(total_amount)::numeric AS gross,
      count(*)::integer AS purchase_count
    FROM documents
    GROUP BY 1
    ORDER BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucketStart', bucket_start,
    'grossPurchases', gross,
    'purchaseCount', purchase_count
  ) ORDER BY bucket_start), '[]'::jsonb)
  INTO v_timeline
  FROM buckets;

  WITH documents AS (
    SELECT p.*
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id = v_supplier_id
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_start_date AND v_end_date
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.purchase_items pi
          WHERE pi.purchase_id = cp.id
            AND (v_product_id IS NULL OR pi.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
        )
      )
  ),
  branch_rows AS (
    SELECT
      d.branch_id,
      b.name,
      b.name_ar,
      count(*)::integer AS purchase_count,
      sum(d.total_amount)::numeric AS gross
    FROM documents d
    JOIN public.branches b ON b.id = d.branch_id
    GROUP BY d.branch_id, b.name, b.name_ar
    ORDER BY purchase_count DESC, gross DESC, d.branch_id
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'branchId', branch_id,
    'branchName', name,
    'branchNameAr', name_ar,
    'purchaseCount', purchase_count,
    'grossPurchases', gross
  )
  INTO v_most_active_branch
  FROM branch_rows;

  RETURN jsonb_build_object(
    'supplier', v_supplier,
    'summary', v_summary,
    'recentComparison', v_recent,
    'paymentStatusSummary', v_payment_summary,
    'topProducts', v_top_products,
    'timeline', v_timeline,
    'timelineGranularity', v_bucket,
    'mostActiveBranch', v_most_active_branch,
    'filters', jsonb_build_object(
      'startDate', v_start_date,
      'endDate', v_end_date,
      'branchId', v_scope.scope_branch_id,
      'productId', v_product_id,
      'productUnitId', v_product_unit_id,
      'paymentStatus', COALESCE(v_payment_status, 'all')
    ),
    'scope', jsonb_build_object(
      'tenantId', v_scope.scope_tenant_id,
      'branchId', v_scope.scope_branch_id,
      'tenantScope', v_scope.tenant_scope,
      'callerRole', v_scope.caller_role
    )
  );
END;
$function$;

ALTER FUNCTION public.get_supplier_intelligence(jsonb) OWNER TO postgres;
COMMENT ON FUNCTION public.get_supplier_intelligence(jsonb) IS
  'Server-authoritative completed supplier purchase activity. Gross purchases use stored counted document totals. Payment status is informational; supplier returns and payables are not represented.';

CREATE OR REPLACE FUNCTION public.get_supplier_intelligence_history(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_supplier_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_payment_status text;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_start_date date;
  v_end_date date;
  v_page integer;
  v_page_size integer;
  v_total_count integer;
  v_rows jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'supplier_id', 'branch_id', 'start_date', 'end_date',
      'product_id', 'product_unit_id', 'payment_status', 'page', 'page_size'
    )
  ) THEN
    RAISE EXCEPTION 'Payload contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_supplier_id := NULLIF(btrim(p_payload ->> 'supplier_id'), '')::uuid;
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_product_id := NULLIF(btrim(p_payload ->> 'product_id'), '')::uuid;
    v_product_unit_id := NULLIF(btrim(p_payload ->> 'product_unit_id'), '')::uuid;
    v_start_date := COALESCE(NULLIF(btrim(p_payload ->> 'start_date'), '')::date, v_today - 29);
    v_end_date := COALESCE(NULLIF(btrim(p_payload ->> 'end_date'), '')::date, v_today);
    v_page := COALESCE(NULLIF(btrim(p_payload ->> 'page'), '')::integer, 1);
    v_page_size := COALESCE(NULLIF(btrim(p_payload ->> 'page_size'), '')::integer, 20);
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid history identifier, date or page' USING ERRCODE = '22023';
  END;

  v_payment_status := NULLIF(btrim(p_payload ->> 'payment_status'), '');

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'Date range must be valid and no longer than 10 years' USING ERRCODE = '22023';
  END IF;
  IF v_page < 1 OR v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'page must be positive and page_size must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF v_payment_status IS NOT NULL
     AND v_payment_status NOT IN ('paid', 'partial', 'unpaid')
  THEN
    RAISE EXCEPTION 'Invalid payment status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT v_scope
  FROM public.reporting_resolve_scope(v_branch_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = v_supplier_id
      AND s.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR s.branch_id = v_scope.scope_branch_id)
  ) THEN
    RAISE EXCEPTION 'Supplier not found in report scope' USING ERRCODE = '42501';
  END IF;

  IF v_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_product_id
      AND p.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
  ) THEN
    RAISE EXCEPTION 'Product not found in report scope' USING ERRCODE = '42501';
  END IF;

  IF v_product_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_units pu
    WHERE pu.id = v_product_unit_id
      AND pu.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR pu.branch_id = v_scope.scope_branch_id)
      AND (v_product_id IS NULL OR pu.product_id = v_product_id)
  ) THEN
    RAISE EXCEPTION 'Product unit not found in report scope' USING ERRCODE = '42501';
  END IF;

  WITH documents AS (
    SELECT p.*
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id = v_supplier_id
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_start_date AND v_end_date
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.purchase_items pi
          WHERE pi.purchase_id = cp.id
            AND (v_product_id IS NULL OR pi.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
        )
      )
  ),
  counted AS (
    SELECT count(*)::integer AS value FROM documents
  ),
  page_rows AS (
    SELECT
      d.*,
      COALESCE((
        SELECT count(*)::integer
        FROM public.purchase_items pi
        WHERE pi.purchase_id = d.id
      ), 0) AS item_count
    FROM documents d
    ORDER BY d.purchase_date DESC, d.created_at DESC, d.id DESC
    LIMIT v_page_size
    OFFSET (v_page - 1) * v_page_size
  ),
  page_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', pr.id,
      'reference', NULLIF(btrim(pr.bill_number), ''),
      'purchaseDate', pr.purchase_date,
      'createdAt', pr.created_at,
      'branchId', pr.branch_id,
      'branchName', b.name,
      'branchNameAr', b.name_ar,
      'itemCount', pr.item_count,
      'grossAmount', pr.total_amount,
      'paymentStatus', pr.payment_status,
      'paymentMethod', pr.payment_method,
      'status', pr.status,
      'receivingStatus', pr.receiving_status,
      'purchaseMode', pr.purchase_mode
    ) ORDER BY pr.purchase_date DESC, pr.created_at DESC, pr.id DESC), '[]'::jsonb) AS value
    FROM page_rows pr
    JOIN public.branches b ON b.id = pr.branch_id
  )
  SELECT counted.value, page_json.value
  INTO v_total_count, v_rows
  FROM counted
  CROSS JOIN page_json;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'page', v_page,
    'pageSize', v_page_size,
    'totalCount', v_total_count,
    'totalPages', CASE
      WHEN v_total_count = 0 THEN 0
      ELSE ceil(v_total_count::numeric / v_page_size)::integer
    END
  );
END;
$function$;

ALTER FUNCTION public.get_supplier_intelligence_history(jsonb) OWNER TO postgres;
COMMENT ON FUNCTION public.get_supplier_intelligence_history(jsonb) IS
  'Stable, bounded history of counted supplier purchase documents. No stock movement or payable rows are returned.';

CREATE OR REPLACE FUNCTION public.list_supplier_intelligence(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_branch_id uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_payment_status text;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_start_date date;
  v_end_date date;
  v_search text;
  v_activity text;
  v_sort text;
  v_direction text;
  v_min_gross numeric;
  v_page integer;
  v_page_size integer;
  v_rows jsonb;
  v_totals jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'branch_id', 'start_date', 'end_date', 'product_id', 'product_unit_id',
      'payment_status', 'search', 'activity', 'min_gross',
      'sort', 'direction', 'page', 'page_size'
    )
  ) THEN
    RAISE EXCEPTION 'Payload contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_product_id := NULLIF(btrim(p_payload ->> 'product_id'), '')::uuid;
    v_product_unit_id := NULLIF(btrim(p_payload ->> 'product_unit_id'), '')::uuid;
    v_start_date := COALESCE(NULLIF(btrim(p_payload ->> 'start_date'), '')::date, v_today - 29);
    v_end_date := COALESCE(NULLIF(btrim(p_payload ->> 'end_date'), '')::date, v_today);
    v_min_gross := NULLIF(btrim(p_payload ->> 'min_gross'), '')::numeric;
    v_page := COALESCE(NULLIF(btrim(p_payload ->> 'page'), '')::integer, 1);
    v_page_size := COALESCE(NULLIF(btrim(p_payload ->> 'page_size'), '')::integer, 25);
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid report identifier, date, amount or page' USING ERRCODE = '22023';
  END;

  v_payment_status := NULLIF(btrim(p_payload ->> 'payment_status'), '');
  v_search := left(COALESCE(NULLIF(btrim(p_payload ->> 'search'), ''), ''), 100);
  v_activity := COALESCE(NULLIF(btrim(p_payload ->> 'activity'), ''), 'all');
  v_sort := COALESCE(NULLIF(btrim(p_payload ->> 'sort'), ''), 'gross_purchases');
  v_direction := lower(COALESCE(NULLIF(btrim(p_payload ->> 'direction'), ''), 'desc'));

  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'Date range must be valid and no longer than 10 years' USING ERRCODE = '22023';
  END IF;
  IF v_page < 1 OR v_page_size < 1 OR v_page_size > 50 THEN
    RAISE EXCEPTION 'page must be positive and page_size must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;
  IF v_min_gross IS NOT NULL AND (v_min_gross < 0 OR v_min_gross > 999999999999) THEN
    RAISE EXCEPTION 'min_gross must be between zero and the supported reporting limit'
      USING ERRCODE = '22023';
  END IF;
  IF v_activity NOT IN ('all', 'active', 'no_activity') THEN
    RAISE EXCEPTION 'Invalid activity filter' USING ERRCODE = '22023';
  END IF;
  IF v_payment_status IS NOT NULL
     AND v_payment_status NOT IN ('paid', 'partial', 'unpaid')
  THEN
    RAISE EXCEPTION 'Invalid payment status' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN (
    'supplier_name', 'gross_purchases', 'purchase_count',
    'average_purchase', 'last_purchase', 'days_since_last_purchase'
  ) THEN
    RAISE EXCEPTION 'Invalid sort key' USING ERRCODE = '22023';
  END IF;
  IF v_direction NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'Invalid sort direction' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT v_scope
  FROM public.reporting_resolve_scope(v_branch_id);

  IF v_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_product_id
      AND p.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR p.branch_id = v_scope.scope_branch_id)
  ) THEN
    RAISE EXCEPTION 'Product not found in report scope' USING ERRCODE = '42501';
  END IF;

  IF v_product_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_units pu
    WHERE pu.id = v_product_unit_id
      AND pu.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR pu.branch_id = v_scope.scope_branch_id)
      AND (v_product_id IS NULL OR pu.product_id = v_product_id)
  ) THEN
    RAISE EXCEPTION 'Product unit not found in report scope' USING ERRCODE = '42501';
  END IF;

  WITH scoped_suppliers AS (
    SELECT s.*
    FROM public.suppliers s
    WHERE s.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR s.branch_id = v_scope.scope_branch_id)
      AND (
        v_search = ''
        OR s.name ILIKE '%' || v_search || '%'
        OR COALESCE(s.name_ar, '') ILIKE '%' || v_search || '%'
        OR COALESCE(s.phone, '') ILIKE '%' || v_search || '%'
        OR COALESCE(s.vat_number, '') ILIKE '%' || v_search || '%'
        OR COALESCE(s.email, '') ILIKE '%' || v_search || '%'
      )
  ),
  documents AS (
    SELECT p.*
    FROM public.reporting_counted_purchases_v cp
    JOIN public.purchases p ON p.id = cp.id
    WHERE cp.tenant_id = v_scope.scope_tenant_id
      AND cp.supplier_id IS NOT NULL
      AND (v_scope.scope_branch_id IS NULL OR cp.branch_id = v_scope.scope_branch_id)
      AND cp.purchase_date BETWEEN v_start_date AND v_end_date
      AND cp.is_counted IS TRUE
      AND (v_payment_status IS NULL OR p.payment_status = v_payment_status)
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.purchase_items pi
          WHERE pi.purchase_id = cp.id
            AND (v_product_id IS NULL OR pi.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
        )
      )
  ),
  document_gaps AS (
    SELECT
      supplier_id,
      purchase_date - lag(purchase_date) OVER (
        PARTITION BY supplier_id
        ORDER BY purchase_date, created_at, id
      ) AS days_between
    FROM documents
  ),
  gap_averages AS (
    SELECT supplier_id, round(avg(days_between)::numeric, 1) AS average_days_between
    FROM document_gaps
    WHERE days_between IS NOT NULL
    GROUP BY supplier_id
  ),
  product_rows AS (
    SELECT
      d.supplier_id,
      pi.product_id,
      pi.product_unit_id,
      COALESCE(NULLIF(btrim(pi.name), ''), pr.name, 'Unknown item') AS item_name,
      pr.name_ar AS item_name_ar,
      COALESCE(
        NULLIF(btrim(pi.purchase_unit_name), ''),
        NULLIF(btrim(pi.base_unit_name), ''),
        NULLIF(btrim(pi.package_unit_code), ''),
        'Unit'
      ) AS unit_name,
      pu.name_ar AS unit_name_ar,
      sum(COALESCE(pi.total, 0))::numeric AS gross_amount
    FROM documents d
    JOIN public.purchase_items pi ON pi.purchase_id = d.id
    LEFT JOIN public.products pr ON pr.id = pi.product_id
    LEFT JOIN public.product_units pu ON pu.id = pi.product_unit_id
    WHERE (v_product_id IS NULL OR pi.product_id = v_product_id)
      AND (v_product_unit_id IS NULL OR pi.product_unit_id = v_product_unit_id)
    GROUP BY
      d.supplier_id, pi.product_id, pi.product_unit_id,
      COALESCE(NULLIF(btrim(pi.name), ''), pr.name, 'Unknown item'),
      pr.name_ar,
      COALESCE(
        NULLIF(btrim(pi.purchase_unit_name), ''),
        NULLIF(btrim(pi.base_unit_name), ''),
        NULLIF(btrim(pi.package_unit_code), ''),
        'Unit'
      ),
      pu.name_ar
  ),
  ranked_products AS (
    SELECT
      *,
      row_number() OVER (
        PARTITION BY supplier_id
        ORDER BY gross_amount DESC, lower(item_name), lower(unit_name),
          COALESCE(product_id::text, ''), COALESCE(product_unit_id::text, '')
      ) AS rank,
      count(*) OVER (PARTITION BY supplier_id)::integer AS product_count
    FROM product_rows
  ),
  top_products AS (
    SELECT *
    FROM ranked_products
    WHERE rank = 1
  ),
  aggregates AS (
    SELECT
      s.id,
      s.name,
      s.name_ar,
      s.phone,
      s.email,
      s.vat_number,
      s.is_active,
      s.branch_id,
      b.name AS branch_name,
      b.name_ar AS branch_name_ar,
      COALESCE(sum(d.total_amount), 0)::numeric AS gross,
      count(d.id)::integer AS purchase_count,
      max(d.purchase_date) AS last_purchase,
      ga.average_days_between,
      tp.item_name AS top_product_name,
      tp.item_name_ar AS top_product_name_ar,
      tp.unit_name AS top_unit_name,
      tp.unit_name_ar AS top_unit_name_ar,
      COALESCE(tp.product_count, 0)::integer AS product_count
    FROM scoped_suppliers s
    JOIN public.branches b ON b.id = s.branch_id
    LEFT JOIN documents d ON d.supplier_id = s.id
    LEFT JOIN gap_averages ga ON ga.supplier_id = s.id
    LEFT JOIN top_products tp ON tp.supplier_id = s.id
    GROUP BY
      s.id, s.name, s.name_ar, s.phone, s.email, s.vat_number,
      s.is_active, s.branch_id, b.name, b.name_ar,
      ga.average_days_between, tp.item_name, tp.item_name_ar,
      tp.unit_name, tp.unit_name_ar, tp.product_count
  ),
  filtered AS (
    SELECT
      *,
      CASE WHEN purchase_count = 0 THEN 0 ELSE round(gross / purchase_count, 2) END
        AS average_purchase,
      CASE WHEN last_purchase IS NULL THEN NULL ELSE v_today - last_purchase END
        AS days_since_last_purchase
    FROM aggregates
    WHERE (v_min_gross IS NULL OR gross >= v_min_gross)
      AND (
        v_activity = 'all'
        OR (v_activity = 'active' AND purchase_count > 0)
        OR (v_activity = 'no_activity' AND purchase_count = 0)
      )
  ),
  sorted AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN v_sort = 'supplier_name' AND v_direction = 'asc' THEN lower(name) END ASC NULLS LAST,
      CASE WHEN v_sort = 'supplier_name' AND v_direction = 'desc' THEN lower(name) END DESC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'asc' THEN gross END ASC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'desc' THEN gross END DESC NULLS LAST,
      CASE WHEN v_sort = 'purchase_count' AND v_direction = 'asc' THEN purchase_count END ASC NULLS LAST,
      CASE WHEN v_sort = 'purchase_count' AND v_direction = 'desc' THEN purchase_count END DESC NULLS LAST,
      CASE WHEN v_sort = 'average_purchase' AND v_direction = 'asc' THEN average_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'average_purchase' AND v_direction = 'desc' THEN average_purchase END DESC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'asc' THEN last_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'desc' THEN last_purchase END DESC NULLS LAST,
      CASE WHEN v_sort = 'days_since_last_purchase' AND v_direction = 'asc' THEN days_since_last_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'days_since_last_purchase' AND v_direction = 'desc' THEN days_since_last_purchase END DESC NULLS LAST,
      id ASC
    LIMIT v_page_size
    OFFSET (v_page - 1) * v_page_size
  ),
  totals AS (
    SELECT jsonb_build_object(
      'supplierCount', count(*)::integer,
      'activeSupplierCount', count(*) FILTER (WHERE purchase_count > 0)::integer,
      'grossPurchases', COALESCE(sum(gross), 0),
      'purchaseCount', COALESCE(sum(purchase_count), 0)::integer,
      'averagePerActiveSupplier', CASE
        WHEN count(*) FILTER (WHERE purchase_count > 0) = 0 THEN 0
        ELSE round(
          COALESCE(sum(gross), 0)
          / count(*) FILTER (WHERE purchase_count > 0),
          2
        )
      END
    ) AS value
    FROM filtered
  ),
  page_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'supplierId', id,
      'name', name,
      'nameAr', name_ar,
      'phone', phone,
      'email', email,
      'vatNumber', vat_number,
      'isActive', is_active,
      'branchId', branch_id,
      'branchName', branch_name,
      'branchNameAr', branch_name_ar,
      'grossPurchases', gross,
      'purchaseCount', purchase_count,
      'averagePurchaseValue', average_purchase,
      'lastPurchase', last_purchase,
      'daysSinceLastPurchase', days_since_last_purchase,
      'averageDaysBetweenPurchases', average_days_between,
      'topProductName', top_product_name,
      'topProductNameAr', top_product_name_ar,
      'topUnitName', top_unit_name,
      'topUnitNameAr', top_unit_name_ar,
      'productCount', product_count
    ) ORDER BY
      CASE WHEN v_sort = 'supplier_name' AND v_direction = 'asc' THEN lower(name) END ASC NULLS LAST,
      CASE WHEN v_sort = 'supplier_name' AND v_direction = 'desc' THEN lower(name) END DESC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'asc' THEN gross END ASC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'desc' THEN gross END DESC NULLS LAST,
      CASE WHEN v_sort = 'purchase_count' AND v_direction = 'asc' THEN purchase_count END ASC NULLS LAST,
      CASE WHEN v_sort = 'purchase_count' AND v_direction = 'desc' THEN purchase_count END DESC NULLS LAST,
      CASE WHEN v_sort = 'average_purchase' AND v_direction = 'asc' THEN average_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'average_purchase' AND v_direction = 'desc' THEN average_purchase END DESC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'asc' THEN last_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'desc' THEN last_purchase END DESC NULLS LAST,
      CASE WHEN v_sort = 'days_since_last_purchase' AND v_direction = 'asc' THEN days_since_last_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'days_since_last_purchase' AND v_direction = 'desc' THEN days_since_last_purchase END DESC NULLS LAST,
      id ASC
    ), '[]'::jsonb) AS value
    FROM sorted
  )
  SELECT totals.value, page_json.value
  INTO v_totals, v_rows
  FROM totals
  CROSS JOIN page_json;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'totals', v_totals,
    'page', v_page,
    'pageSize', v_page_size,
    'totalCount', COALESCE((v_totals ->> 'supplierCount')::integer, 0),
    'totalPages', CASE
      WHEN COALESCE((v_totals ->> 'supplierCount')::integer, 0) = 0 THEN 0
      ELSE ceil((v_totals ->> 'supplierCount')::numeric / v_page_size)::integer
    END
  );
END;
$function$;

ALTER FUNCTION public.list_supplier_intelligence(jsonb) OWNER TO postgres;
COMMENT ON FUNCTION public.list_supplier_intelligence(jsonb) IS
  'Bounded supplier activity list with server-side filters, stable sorting, pagination and full-filter gross totals.';

REVOKE ALL ON FUNCTION public.get_supplier_intelligence(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_supplier_intelligence_history(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_supplier_intelligence(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_supplier_intelligence(jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_intelligence_history(jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_supplier_intelligence(jsonb)
  TO authenticated;

DO $preservation$
DECLARE
  v_before supplier_intelligence_preservation_baseline%ROWTYPE;
  v_after supplier_intelligence_preservation_baseline%ROWTYPE;
BEGIN
  SELECT * INTO v_before
  FROM supplier_intelligence_preservation_baseline;

  SELECT
    (SELECT count(*) FROM public.suppliers),
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        s.id, s.tenant_id, s.branch_id, s.name, s.name_ar, s.vat_number,
        s.payment_terms, s.is_active, s.created_at, s.updated_at
      )::text, 0)::numeric)::text, '0'))
      FROM public.suppliers s
    ),
    (SELECT count(*) FROM public.purchases),
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        p.id, p.tenant_id, p.branch_id, p.supplier_id, p.purchase_date,
        p.purchase_mode, p.status, p.receiving_status, p.payment_status,
        p.subtotal, p.vat_amount, p.total_amount, p.created_at, p.updated_at
      )::text, 0)::numeric)::text, '0'))
      FROM public.purchases p
    ),
    (SELECT count(*) FROM public.purchase_items),
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        pi.id, pi.purchase_id, pi.inventory_item_id, pi.product_id,
        pi.product_unit_id, pi.name, pi.quantity, pi.unit_cost, pi.total,
        pi.vat_amount, pi.package_quantity, pi.base_quantity,
        pi.purchase_unit_name, pi.base_unit_name
      )::text, 0)::numeric)::text, '0'))
      FROM public.purchase_items pi
    ),
    (SELECT count(*) FROM public.purchase_stock_movements),
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        psm.id, psm.tenant_id, psm.branch_id, psm.purchase_id,
        psm.purchase_item_id, psm.quantity_delta, psm.reason,
        psm.reversal_of, psm.created_at
      )::text, 0)::numeric)::text, '0'))
      FROM public.purchase_stock_movements psm
    )
  INTO v_after;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Supplier intelligence migration changed protected commercial data';
  END IF;
END;
$preservation$;

COMMIT;
