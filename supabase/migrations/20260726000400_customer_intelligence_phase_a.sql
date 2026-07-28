BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TEMP TABLE customer_intelligence_preservation_baseline
ON COMMIT DROP
AS
SELECT
  (SELECT count(*) FROM public.customers) AS customer_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      c.id, c.tenant_id, c.branch_id, c.name, c.name_ar, c.customer_type,
      c.vat_number, c.is_active, c.created_at, c.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.customers c
  ) AS customer_fingerprint,
  (SELECT count(*) FROM public.invoices) AS invoice_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
      i.zatca_invoice_type, i.status, i.subtotal, i.tax_amount, i.total_amount,
      i.invoice_date, i.created_at, i.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.invoices i
  ) AS invoice_fingerprint,
  (SELECT count(*) FROM public.invoice_items) AS invoice_item_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      ii.id, ii.invoice_id, ii.tenant_id, ii.product_id, ii.name, ii.name_ar,
      ii.unit, ii.quantity, ii.unit_price, ii.subtotal, ii.tax_amount, ii.total,
      ii.product_unit_id, ii.package_quantity, ii.base_quantity
    )::text, 0)::numeric)::text, '0'))
    FROM public.invoice_items ii
  ) AS invoice_item_fingerprint,
  (
    SELECT count(*)
    FROM public.invoices
    WHERE zatca_invoice_type = 'credit_note'
  ) AS credit_note_count,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      cn.id, cn.tenant_id, cn.branch_id, cn.customer_id, cn.invoice_number,
      cn.original_invoice_id, cn.status, cn.subtotal, cn.tax_amount,
      cn.total_amount, cn.invoice_date, cn.created_at, cn.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.invoices cn
    WHERE cn.zatca_invoice_type = 'credit_note'
  ) AS credit_note_fingerprint;

-- Customer intelligence is calculated from finalized commercial documents.
-- A posted simplified/standard invoice contributes to gross purchases; a
-- posted credit note contributes to credited purchases exactly once.
CREATE INDEX customer_intelligence_documents_scope_idx
  ON public.invoices (
    tenant_id,
    branch_id,
    customer_id,
    invoice_date DESC,
    created_at DESC,
    id DESC
  )
  INCLUDE (zatca_invoice_type, total_amount, invoice_number)
  WHERE status = 'posted'
    AND customer_id IS NOT NULL
    AND zatca_invoice_type IN ('simplified', 'standard', 'credit_note');

COMMENT ON INDEX public.customer_intelligence_documents_scope_idx IS
  'Supports scoped customer reporting without changing or recalculating historical commercial documents.';

CREATE OR REPLACE FUNCTION public.get_customer_intelligence(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_customer_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_start_date date;
  v_end_date date;
  v_days integer;
  v_bucket text;
  v_customer jsonb;
  v_summary jsonb;
  v_recent jsonb;
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
      'customer_id', 'branch_id', 'start_date', 'end_date',
      'product_id', 'product_unit_id'
    )
  ) THEN
    RAISE EXCEPTION 'Payload contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(p_payload ->> 'customer_id'), '') IS NULL THEN
    RAISE EXCEPTION 'customer_id is required' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_customer_id := (p_payload ->> 'customer_id')::uuid;
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_product_id := NULLIF(btrim(p_payload ->> 'product_id'), '')::uuid;
    v_product_unit_id := NULLIF(btrim(p_payload ->> 'product_unit_id'), '')::uuid;
    v_start_date := COALESCE(NULLIF(btrim(p_payload ->> 'start_date'), '')::date, v_today - 364);
    v_end_date := COALESCE(NULLIF(btrim(p_payload ->> 'end_date'), '')::date, v_today);
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Invalid customer intelligence identifier or date' USING ERRCODE = '22023';
  END;

  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'Date range must be valid and no longer than 10 years' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT v_scope
  FROM public.reporting_resolve_scope(v_branch_id);

  SELECT jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'nameAr', c.name_ar,
    'customerType', c.customer_type,
    'businessName', COALESCE(c.business_name, c.company_name),
    'businessNameAr', c.business_name_ar,
    'phone', c.phone,
    'email', c.email,
    'vatNumber', c.vat_number,
    'isActive', c.is_active,
    'branchId', c.branch_id
  )
  INTO v_customer
  FROM public.customers c
  WHERE c.id = v_customer_id
    AND c.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR c.branch_id = v_scope.scope_branch_id);

  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'Customer not found in report scope' USING ERRCODE = '42501';
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
    SELECT i.*
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id = v_customer_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard', 'credit_note')
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR ii.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
        )
      )
  ),
  sales AS (
    SELECT *
    FROM documents
    WHERE zatca_invoice_type IN ('simplified', 'standard')
  ),
  credits AS (
    SELECT *
    FROM documents
    WHERE zatca_invoice_type = 'credit_note'
  ),
  sales_gaps AS (
    SELECT
      invoice_date,
      invoice_date - lag(invoice_date) OVER (
        ORDER BY invoice_date, created_at, id
      ) AS days_between
    FROM sales
  ),
  totals AS (
    SELECT
      COALESCE((SELECT sum(total_amount) FROM sales), 0)::numeric AS gross,
      COALESCE((SELECT sum(total_amount) FROM credits), 0)::numeric AS credited,
      (SELECT count(*)::integer FROM sales) AS invoice_count,
      (SELECT count(*)::integer FROM credits) AS credit_count,
      (SELECT round(avg(days_between)::numeric, 1) FROM sales_gaps WHERE days_between IS NOT NULL)
        AS average_days_between
  ),
  last_purchase AS (
    SELECT jsonb_build_object(
      'id', s.id,
      'reference', s.invoice_number,
      'invoiceDate', s.invoice_date,
      'createdAt', s.created_at,
      'branchId', s.branch_id,
      'branchName', b.name,
      'branchNameAr', b.name_ar,
      'total', s.total_amount
    ) AS value
    FROM sales s
    JOIN public.branches b ON b.id = s.branch_id
    ORDER BY s.invoice_date DESC, s.created_at DESC, s.id DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'grossPurchases', totals.gross,
    'creditedAmount', totals.credited,
    'netPurchases', totals.gross - totals.credited,
    'invoiceCount', totals.invoice_count,
    'creditNoteCount', totals.credit_count,
    'averageInvoiceValue', CASE
      WHEN totals.invoice_count = 0 THEN 0
      ELSE round(totals.gross / totals.invoice_count, 2)
    END,
    'averageDaysBetweenPurchases', totals.average_days_between,
    'lastPurchase', (SELECT value FROM last_purchase)
  )
  INTO v_summary
  FROM totals;

  WITH period_documents AS (
    SELECT i.*
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id = v_customer_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_today - 59 AND v_today
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR ii.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
        )
      )
  ),
  totals AS (
    SELECT
      COALESCE(sum(total_amount) FILTER (
        WHERE invoice_date BETWEEN v_today - 29 AND v_today
      ), 0)::numeric AS recent_gross,
      count(*) FILTER (
        WHERE invoice_date BETWEEN v_today - 29 AND v_today
      )::integer AS recent_count,
      COALESCE(sum(total_amount) FILTER (
        WHERE invoice_date BETWEEN v_today - 59 AND v_today - 30
      ), 0)::numeric AS previous_gross,
      count(*) FILTER (
        WHERE invoice_date BETWEEN v_today - 59 AND v_today - 30
      )::integer AS previous_count
    FROM period_documents
  )
  SELECT jsonb_build_object(
    'recentGross', recent_gross,
    'recentInvoiceCount', recent_count,
    'previousGross', previous_gross,
    'previousInvoiceCount', previous_count,
    'grossPercentChange', CASE
      WHEN previous_gross = 0 THEN NULL
      ELSE round(((recent_gross - previous_gross) / previous_gross) * 100, 1)
    END,
    'invoicePercentChange', CASE
      WHEN previous_count = 0 THEN NULL
      ELSE round(((recent_count - previous_count)::numeric / previous_count) * 100, 1)
    END
  )
  INTO v_recent
  FROM totals;

  WITH sales AS (
    SELECT i.id, i.tenant_id, i.invoice_date
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id = v_customer_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.invoice_items filter_item
          WHERE filter_item.invoice_id = i.id
            AND filter_item.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR filter_item.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR filter_item.product_unit_id = v_product_unit_id)
        )
      )
  ),
  product_rows AS (
    SELECT
      ii.product_id,
      ii.product_unit_id,
      COALESCE(NULLIF(btrim(ii.name), ''), '—') AS name,
      NULLIF(btrim(ii.name_ar), '') AS name_ar,
      COALESCE(
        NULLIF(btrim(ii.selling_unit_name), ''),
        NULLIF(btrim(ii.unit), ''),
        '—'
      ) AS unit_name,
      NULLIF(btrim(ii.selling_unit_name_ar), '') AS unit_name_ar,
      NULLIF(btrim(ii.selling_unit_code), '') AS unit_code,
      COALESCE(sum(COALESCE(ii.package_quantity, ii.quantity, 0)), 0)::numeric AS quantity,
      COALESCE(sum(ii.total), 0)::numeric AS gross_amount,
      count(DISTINCT sales.id)::integer AS invoice_count,
      max(sales.invoice_date) AS last_purchased
    FROM sales
    JOIN public.invoice_items ii
      ON ii.invoice_id = sales.id
     AND ii.tenant_id = sales.tenant_id
    WHERE (v_product_id IS NULL OR ii.product_id = v_product_id)
      AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
    GROUP BY
      ii.product_id,
      ii.product_unit_id,
      COALESCE(NULLIF(btrim(ii.name), ''), '—'),
      NULLIF(btrim(ii.name_ar), ''),
      COALESCE(NULLIF(btrim(ii.selling_unit_name), ''), NULLIF(btrim(ii.unit), ''), '—'),
      NULLIF(btrim(ii.selling_unit_name_ar), ''),
      NULLIF(btrim(ii.selling_unit_code), '')
    ORDER BY gross_amount DESC, quantity DESC, name, unit_name
    LIMIT 12
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'productId', product_id,
    'productUnitId', product_unit_id,
    'name', name,
    'nameAr', name_ar,
    'unitName', unit_name,
    'unitNameAr', unit_name_ar,
    'unitCode', unit_code,
    'quantity', quantity,
    'grossAmount', gross_amount,
    'invoiceCount', invoice_count,
    'lastPurchased', last_purchased
  ) ORDER BY gross_amount DESC, quantity DESC, name, unit_name), '[]'::jsonb)
  INTO v_top_products
  FROM product_rows;

  v_days := v_end_date - v_start_date + 1;
  v_bucket := CASE
    WHEN v_days <= 62 THEN 'day'
    WHEN v_days <= 366 THEN 'week'
    ELSE 'month'
  END;

  WITH documents AS (
    SELECT i.*
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id = v_customer_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard', 'credit_note')
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR ii.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
        )
      )
  ),
  buckets AS (
    SELECT
      CASE v_bucket
        WHEN 'day' THEN invoice_date
        WHEN 'week' THEN date_trunc('week', invoice_date::timestamp)::date
        ELSE date_trunc('month', invoice_date::timestamp)::date
      END AS bucket_start,
      COALESCE(sum(total_amount) FILTER (
        WHERE zatca_invoice_type IN ('simplified', 'standard')
      ), 0)::numeric AS gross,
      COALESCE(sum(total_amount) FILTER (
        WHERE zatca_invoice_type = 'credit_note'
      ), 0)::numeric AS credited,
      count(*) FILTER (
        WHERE zatca_invoice_type IN ('simplified', 'standard')
      )::integer AS invoice_count,
      count(*) FILTER (
        WHERE zatca_invoice_type = 'credit_note'
      )::integer AS credit_count
    FROM documents
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucketStart', bucket_start,
    'grossPurchases', gross,
    'creditedAmount', credited,
    'netPurchases', gross - credited,
    'invoiceCount', invoice_count,
    'creditNoteCount', credit_count
  ) ORDER BY bucket_start), '[]'::jsonb)
  INTO v_timeline
  FROM buckets;

  WITH branch_rows AS (
    SELECT
      b.id,
      b.name,
      b.name_ar,
      count(*) FILTER (
        WHERE i.zatca_invoice_type IN ('simplified', 'standard')
      )::integer AS invoice_count,
      COALESCE(sum(i.total_amount) FILTER (
        WHERE i.zatca_invoice_type IN ('simplified', 'standard')
      ), 0)::numeric AS gross
    FROM public.invoices i
    JOIN public.branches b ON b.id = i.branch_id
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id = v_customer_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1
          FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR ii.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
        )
      )
    GROUP BY b.id, b.name, b.name_ar
    ORDER BY invoice_count DESC, gross DESC, b.id
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'branchId', id,
    'branchName', name,
    'branchNameAr', name_ar,
    'invoiceCount', invoice_count,
    'grossPurchases', gross
  )
  INTO v_most_active_branch
  FROM branch_rows;

  RETURN jsonb_build_object(
    'customer', v_customer,
    'summary', v_summary,
    'recentComparison', v_recent,
    'topProducts', v_top_products,
    'timeline', v_timeline,
    'timelineGranularity', v_bucket,
    'mostActiveBranch', v_most_active_branch,
    'filters', jsonb_build_object(
      'startDate', v_start_date,
      'endDate', v_end_date,
      'branchId', v_scope.scope_branch_id,
      'productId', v_product_id,
      'productUnitId', v_product_unit_id
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

ALTER FUNCTION public.get_customer_intelligence(jsonb) OWNER TO postgres;
COMMENT ON FUNCTION public.get_customer_intelligence(jsonb) IS
  'Server-authoritative customer commercial summary. Net purchases are gross posted sales less posted credit notes; never an accounts-receivable balance.';

CREATE OR REPLACE FUNCTION public.get_customer_intelligence_history(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_customer_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_start_date date;
  v_end_date date;
  v_activity_type text;
  v_page integer;
  v_page_size integer;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'customer_id', 'branch_id', 'start_date', 'end_date',
      'product_id', 'product_unit_id', 'activity_type', 'page', 'page_size'
    )
  ) THEN
    RAISE EXCEPTION 'Payload contains unsupported fields' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_customer_id := NULLIF(btrim(p_payload ->> 'customer_id'), '')::uuid;
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_product_id := NULLIF(btrim(p_payload ->> 'product_id'), '')::uuid;
    v_product_unit_id := NULLIF(btrim(p_payload ->> 'product_unit_id'), '')::uuid;
    v_start_date := COALESCE(NULLIF(btrim(p_payload ->> 'start_date'), '')::date, v_today - 364);
    v_end_date := COALESCE(NULLIF(btrim(p_payload ->> 'end_date'), '')::date, v_today);
    v_page := COALESCE(NULLIF(btrim(p_payload ->> 'page'), '')::integer, 1);
    v_page_size := COALESCE(NULLIF(btrim(p_payload ->> 'page_size'), '')::integer, 20);
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid history identifier, date or page' USING ERRCODE = '22023';
  END;

  v_activity_type := COALESCE(NULLIF(btrim(p_payload ->> 'activity_type'), ''), 'all');

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'Date range must be valid and no longer than 10 years' USING ERRCODE = '22023';
  END IF;
  IF v_page < 1 OR v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'page must be positive and page_size must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF v_activity_type NOT IN ('all', 'invoice', 'credit_note') THEN
    RAISE EXCEPTION 'Invalid activity_type' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT v_scope
  FROM public.reporting_resolve_scope(v_branch_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = v_customer_id
      AND c.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR c.branch_id = v_scope.scope_branch_id)
  ) THEN
    RAISE EXCEPTION 'Customer not found in report scope' USING ERRCODE = '42501';
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
    SELECT i.*
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id = v_customer_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard', 'credit_note')
      AND (
        v_activity_type = 'all'
        OR (v_activity_type = 'invoice' AND i.zatca_invoice_type IN ('simplified', 'standard'))
        OR (v_activity_type = 'credit_note' AND i.zatca_invoice_type = 'credit_note')
      )
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR ii.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
        )
      )
  )
  SELECT count(*)::integer INTO v_total FROM documents;

  WITH documents AS (
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      i.created_at,
      i.zatca_invoice_type::text AS document_type,
      i.status::text AS status,
      i.zatca_status::text AS zatca_status,
      i.total_amount,
      i.branch_id
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id = v_customer_id
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard', 'credit_note')
      AND (
        v_activity_type = 'all'
        OR (v_activity_type = 'invoice' AND i.zatca_invoice_type IN ('simplified', 'standard'))
        OR (v_activity_type = 'credit_note' AND i.zatca_invoice_type = 'credit_note')
      )
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR ii.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
        )
      )
    ORDER BY i.invoice_date DESC, i.created_at DESC, i.id DESC
    LIMIT v_page_size
    OFFSET (v_page - 1) * v_page_size
  ),
  page_rows AS (
    SELECT
      d.*,
      b.name AS branch_name,
      b.name_ar AS branch_name_ar,
      (
        SELECT count(*)::integer
        FROM public.invoice_items ii
        WHERE ii.invoice_id = d.id
      ) AS item_count
    FROM documents d
    JOIN public.branches b ON b.id = d.branch_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'reference', invoice_number,
    'invoiceDate', invoice_date,
    'createdAt', created_at,
    'documentType', document_type,
    'status', status,
    'zatcaStatus', zatca_status,
    'branchId', branch_id,
    'branchName', branch_name,
    'branchNameAr', branch_name_ar,
    'itemCount', item_count,
    'grossAmount', CASE WHEN document_type IN ('simplified', 'standard') THEN total_amount ELSE 0 END,
    'creditedAmount', CASE WHEN document_type = 'credit_note' THEN total_amount ELSE 0 END,
    'netEffect', CASE WHEN document_type = 'credit_note' THEN -total_amount ELSE total_amount END
  ) ORDER BY invoice_date DESC, created_at DESC, id DESC), '[]'::jsonb)
  INTO v_rows
  FROM page_rows;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'page', v_page,
    'pageSize', v_page_size,
    'totalCount', v_total,
    'totalPages', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / v_page_size)::integer END
  );
END;
$function$;

ALTER FUNCTION public.get_customer_intelligence_history(jsonb) OWNER TO postgres;
COMMENT ON FUNCTION public.get_customer_intelligence_history(jsonb) IS
  'Stable, bounded customer commercial document history with separate gross and credited effects.';

CREATE OR REPLACE FUNCTION public.list_customer_intelligence(p_payload jsonb)
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
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_start_date date;
  v_end_date date;
  v_search text;
  v_activity text;
  v_sort text;
  v_direction text;
  v_min_net numeric;
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
      'search', 'activity', 'min_net', 'sort', 'direction', 'page', 'page_size'
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
    v_min_net := NULLIF(btrim(p_payload ->> 'min_net'), '')::numeric;
    v_page := COALESCE(NULLIF(btrim(p_payload ->> 'page'), '')::integer, 1);
    v_page_size := COALESCE(NULLIF(btrim(p_payload ->> 'page_size'), '')::integer, 25);
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid report identifier, date, amount or page' USING ERRCODE = '22023';
  END;

  v_search := left(COALESCE(NULLIF(btrim(p_payload ->> 'search'), ''), ''), 100);
  v_activity := COALESCE(NULLIF(btrim(p_payload ->> 'activity'), ''), 'all');
  v_sort := COALESCE(NULLIF(btrim(p_payload ->> 'sort'), ''), 'net_purchases');
  v_direction := lower(COALESCE(NULLIF(btrim(p_payload ->> 'direction'), ''), 'desc'));

  IF v_start_date > v_end_date OR v_end_date - v_start_date > 3653 THEN
    RAISE EXCEPTION 'Date range must be valid and no longer than 10 years' USING ERRCODE = '22023';
  END IF;
  IF v_page < 1 OR v_page_size < 1 OR v_page_size > 50 THEN
    RAISE EXCEPTION 'page must be positive and page_size must be between 1 and 50' USING ERRCODE = '22023';
  END IF;
  IF v_min_net IS NOT NULL AND (v_min_net < 0 OR v_min_net > 999999999999) THEN
    RAISE EXCEPTION 'min_net must be between zero and the supported reporting limit' USING ERRCODE = '22023';
  END IF;
  IF v_activity NOT IN ('all', 'active', 'no_activity') THEN
    RAISE EXCEPTION 'Invalid activity filter' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN (
    'customer_name', 'gross_purchases', 'net_purchases',
    'invoice_count', 'last_purchase', 'average_invoice'
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

  WITH scoped_customers AS (
    SELECT c.*
    FROM public.customers c
    WHERE c.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR c.branch_id = v_scope.scope_branch_id)
      AND (
        v_search = ''
        OR c.name ILIKE '%' || v_search || '%'
        OR COALESCE(c.name_ar, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.business_name, c.company_name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.business_name_ar, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.phone, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.vat_number, '') ILIKE '%' || v_search || '%'
      )
  ),
  documents AS (
    SELECT i.*
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.scope_tenant_id
      AND i.customer_id IS NOT NULL
      AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
      AND i.invoice_date BETWEEN v_start_date AND v_end_date
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard', 'credit_note')
      AND (
        (v_product_id IS NULL AND v_product_unit_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
            AND ii.tenant_id = i.tenant_id
            AND (v_product_id IS NULL OR ii.product_id = v_product_id)
            AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)
        )
      )
  ),
  aggregates AS (
    SELECT
      c.id,
      c.name,
      c.name_ar,
      c.customer_type,
      COALESCE(c.business_name, c.company_name) AS business_name,
      c.business_name_ar,
      c.phone,
      c.vat_number,
      c.is_active,
      c.branch_id,
      b.name AS branch_name,
      b.name_ar AS branch_name_ar,
      COALESCE(sum(d.total_amount) FILTER (
        WHERE d.zatca_invoice_type IN ('simplified', 'standard')
      ), 0)::numeric AS gross,
      COALESCE(sum(d.total_amount) FILTER (
        WHERE d.zatca_invoice_type = 'credit_note'
      ), 0)::numeric AS credited,
      count(d.id) FILTER (
        WHERE d.zatca_invoice_type IN ('simplified', 'standard')
      )::integer AS invoice_count,
      count(d.id) FILTER (
        WHERE d.zatca_invoice_type = 'credit_note'
      )::integer AS credit_count,
      max(d.invoice_date) FILTER (
        WHERE d.zatca_invoice_type IN ('simplified', 'standard')
      ) AS last_purchase
    FROM scoped_customers c
    JOIN public.branches b ON b.id = c.branch_id
    LEFT JOIN documents d ON d.customer_id = c.id
    GROUP BY
      c.id, c.name, c.name_ar, c.customer_type,
      c.business_name, c.company_name, c.business_name_ar,
      c.phone, c.vat_number, c.is_active, c.branch_id, b.name, b.name_ar
  ),
  filtered AS (
    SELECT
      *,
      gross - credited AS net,
      CASE WHEN invoice_count = 0 THEN 0 ELSE round(gross / invoice_count, 2) END AS average_invoice
    FROM aggregates
    WHERE (v_min_net IS NULL OR gross - credited >= v_min_net)
      AND (
        v_activity = 'all'
        OR (v_activity = 'active' AND invoice_count + credit_count > 0)
        OR (v_activity = 'no_activity' AND invoice_count + credit_count = 0)
      )
  ),
  sorted AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE WHEN v_sort = 'customer_name' AND v_direction = 'asc' THEN lower(name) END ASC NULLS LAST,
      CASE WHEN v_sort = 'customer_name' AND v_direction = 'desc' THEN lower(name) END DESC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'asc' THEN gross END ASC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'desc' THEN gross END DESC NULLS LAST,
      CASE WHEN v_sort = 'net_purchases' AND v_direction = 'asc' THEN net END ASC NULLS LAST,
      CASE WHEN v_sort = 'net_purchases' AND v_direction = 'desc' THEN net END DESC NULLS LAST,
      CASE WHEN v_sort = 'invoice_count' AND v_direction = 'asc' THEN invoice_count END ASC NULLS LAST,
      CASE WHEN v_sort = 'invoice_count' AND v_direction = 'desc' THEN invoice_count END DESC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'asc' THEN last_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'desc' THEN last_purchase END DESC NULLS LAST,
      CASE WHEN v_sort = 'average_invoice' AND v_direction = 'asc' THEN average_invoice END ASC NULLS LAST,
      CASE WHEN v_sort = 'average_invoice' AND v_direction = 'desc' THEN average_invoice END DESC NULLS LAST,
      id ASC
    LIMIT v_page_size
    OFFSET (v_page - 1) * v_page_size
  ),
  totals AS (
    SELECT jsonb_build_object(
      'customerCount', count(*)::integer,
      'activeCustomerCount', count(*) FILTER (
        WHERE invoice_count + credit_count > 0
      )::integer,
      'grossPurchases', COALESCE(sum(gross), 0),
      'creditedAmount', COALESCE(sum(credited), 0),
      'netPurchases', COALESCE(sum(net), 0),
      'invoiceCount', COALESCE(sum(invoice_count), 0)::integer,
      'averagePerActiveCustomer', CASE
        WHEN count(*) FILTER (WHERE invoice_count + credit_count > 0) = 0 THEN 0
        ELSE round(
          COALESCE(sum(net), 0)
          / count(*) FILTER (WHERE invoice_count + credit_count > 0),
          2
        )
      END
    ) AS value
    FROM filtered
  ),
  page_json AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'customerId', id,
      'name', name,
      'nameAr', name_ar,
      'customerType', customer_type,
      'businessName', business_name,
      'businessNameAr', business_name_ar,
      'phone', phone,
      'vatNumber', vat_number,
      'isActive', is_active,
      'branchId', branch_id,
      'branchName', branch_name,
      'branchNameAr', branch_name_ar,
      'grossPurchases', gross,
      'creditedAmount', credited,
      'netPurchases', net,
      'invoiceCount', invoice_count,
      'creditNoteCount', credit_count,
      'averageInvoiceValue', average_invoice,
      'lastPurchase', last_purchase,
      'daysSinceLastPurchase', CASE
        WHEN last_purchase IS NULL THEN NULL
        ELSE v_today - last_purchase
      END
    ) ORDER BY
      CASE WHEN v_sort = 'customer_name' AND v_direction = 'asc' THEN lower(name) END ASC NULLS LAST,
      CASE WHEN v_sort = 'customer_name' AND v_direction = 'desc' THEN lower(name) END DESC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'asc' THEN gross END ASC NULLS LAST,
      CASE WHEN v_sort = 'gross_purchases' AND v_direction = 'desc' THEN gross END DESC NULLS LAST,
      CASE WHEN v_sort = 'net_purchases' AND v_direction = 'asc' THEN net END ASC NULLS LAST,
      CASE WHEN v_sort = 'net_purchases' AND v_direction = 'desc' THEN net END DESC NULLS LAST,
      CASE WHEN v_sort = 'invoice_count' AND v_direction = 'asc' THEN invoice_count END ASC NULLS LAST,
      CASE WHEN v_sort = 'invoice_count' AND v_direction = 'desc' THEN invoice_count END DESC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'asc' THEN last_purchase END ASC NULLS LAST,
      CASE WHEN v_sort = 'last_purchase' AND v_direction = 'desc' THEN last_purchase END DESC NULLS LAST,
      CASE WHEN v_sort = 'average_invoice' AND v_direction = 'asc' THEN average_invoice END ASC NULLS LAST,
      CASE WHEN v_sort = 'average_invoice' AND v_direction = 'desc' THEN average_invoice END DESC NULLS LAST,
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
    'totalCount', COALESCE((v_totals ->> 'customerCount')::integer, 0),
    'totalPages', CASE
      WHEN COALESCE((v_totals ->> 'customerCount')::integer, 0) = 0 THEN 0
      ELSE ceil((v_totals ->> 'customerCount')::numeric / v_page_size)::integer
    END
  );
END;
$function$;

ALTER FUNCTION public.list_customer_intelligence(jsonb) OWNER TO postgres;
COMMENT ON FUNCTION public.list_customer_intelligence(jsonb) IS
  'Bounded customer report list with server-side filters, stable sorting, pagination and full-filter totals.';

REVOKE ALL ON FUNCTION public.get_customer_intelligence(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_customer_intelligence_history(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_customer_intelligence(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_customer_intelligence(jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_intelligence_history(jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_customer_intelligence(jsonb)
  TO authenticated;

DO $preservation$
DECLARE
  v_before customer_intelligence_preservation_baseline%ROWTYPE;
  v_after record;
BEGIN
  SELECT * INTO STRICT v_before
  FROM customer_intelligence_preservation_baseline;

  SELECT
    (SELECT count(*) FROM public.customers) AS customer_count,
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        c.id, c.tenant_id, c.branch_id, c.name, c.name_ar, c.customer_type,
        c.vat_number, c.is_active, c.created_at, c.updated_at
      )::text, 0)::numeric)::text, '0'))
      FROM public.customers c
    ) AS customer_fingerprint,
    (SELECT count(*) FROM public.invoices) AS invoice_count,
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
        i.zatca_invoice_type, i.status, i.subtotal, i.tax_amount, i.total_amount,
        i.invoice_date, i.created_at, i.updated_at
      )::text, 0)::numeric)::text, '0'))
      FROM public.invoices i
    ) AS invoice_fingerprint,
    (SELECT count(*) FROM public.invoice_items) AS invoice_item_count,
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        ii.id, ii.invoice_id, ii.tenant_id, ii.product_id, ii.name, ii.name_ar,
        ii.unit, ii.quantity, ii.unit_price, ii.subtotal, ii.tax_amount, ii.total,
        ii.product_unit_id, ii.package_quantity, ii.base_quantity
      )::text, 0)::numeric)::text, '0'))
      FROM public.invoice_items ii
    ) AS invoice_item_fingerprint,
    (
      SELECT count(*)
      FROM public.invoices
      WHERE zatca_invoice_type = 'credit_note'
    ) AS credit_note_count,
    (
      SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
        cn.id, cn.tenant_id, cn.branch_id, cn.customer_id, cn.invoice_number,
        cn.original_invoice_id, cn.status, cn.subtotal, cn.tax_amount,
        cn.total_amount, cn.invoice_date, cn.created_at, cn.updated_at
      )::text, 0)::numeric)::text, '0'))
      FROM public.invoices cn
      WHERE cn.zatca_invoice_type = 'credit_note'
    ) AS credit_note_fingerprint
  INTO STRICT v_after;

  IF row_to_json(v_before)::jsonb IS DISTINCT FROM row_to_json(v_after)::jsonb THEN
    RAISE EXCEPTION 'CUSTOMER_INTELLIGENCE_PRESERVATION_MISMATCH';
  END IF;
END;
$preservation$;

COMMIT;
