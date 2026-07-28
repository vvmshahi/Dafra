BEGIN;

CREATE TEMP TABLE supplier_intelligence_runtime_results (
  check_name text PRIMARY KEY,
  result text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $runtime$
DECLARE
  v_owner public.user_profiles%ROWTYPE;
  v_branch_user public.user_profiles%ROWTYPE;
  v_supplier public.suppliers%ROWTYPE;
  v_zero_supplier public.suppliers%ROWTYPE;
  v_other_branch uuid;
  v_other_tenant_supplier uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_sample_date date;
  v_start date := CURRENT_DATE - 365;
  v_end date := CURRENT_DATE;
  v_detail jsonb;
  v_history jsonb;
  v_list jsonb;
  v_list_repeat jsonb;
  v_timeline_total numeric;
BEGIN
  SELECT * INTO v_owner
  FROM public.user_profiles
  WHERE role = 'owner'
    AND is_active IS TRUE
    AND tenant_id IS NOT NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_owner.id IS NULL THEN
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('fixture availability', 'SKIP', 'No active owner fixture is available.');
    RETURN;
  END IF;

  SELECT * INTO v_supplier
  FROM public.suppliers
  WHERE tenant_id = v_owner.tenant_id
  ORDER BY created_at
  LIMIT 1;

  IF v_supplier.id IS NULL THEN
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('fixture availability', 'SKIP', 'The owner tenant has no supplier fixture.');
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner.id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_detail := public.get_supplier_intelligence(jsonb_build_object(
    'supplier_id', v_supplier.id,
    'start_date', v_start,
    'end_date', v_end
  ));

  SELECT COALESCE(sum((point ->> 'grossPurchases')::numeric), 0)
  INTO v_timeline_total
  FROM jsonb_array_elements(v_detail -> 'timeline') point;

  IF abs(
    v_timeline_total - (v_detail #>> '{summary,grossPurchases}')::numeric
  ) > 0.005 THEN
    RAISE EXCEPTION 'Timeline and supplier summary totals do not reconcile';
  END IF;
  INSERT INTO supplier_intelligence_runtime_results
  VALUES ('owner scope and totals reconciliation', 'PASS', 'Timeline gross equals the full selected summary gross.');

  SELECT pi.product_id, pi.product_unit_id, p.purchase_date
  INTO v_product_id, v_product_unit_id, v_sample_date
  FROM public.purchase_items pi
  JOIN public.reporting_counted_purchases_v counted ON counted.id = pi.purchase_id
  JOIN public.purchases p ON p.id = counted.id
  WHERE counted.tenant_id = v_owner.tenant_id
    AND counted.supplier_id = v_supplier.id
    AND counted.is_counted IS TRUE
    AND pi.product_id IS NOT NULL
  ORDER BY p.purchase_date DESC, p.created_at DESC, pi.id
  LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    v_detail := public.get_supplier_intelligence(jsonb_strip_nulls(jsonb_build_object(
      'supplier_id', v_supplier.id,
      'start_date', v_start,
      'end_date', v_end,
      'product_id', v_product_id,
      'product_unit_id', v_product_unit_id
    )));
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_detail -> 'topProducts') product
      WHERE product ->> 'productId' <> v_product_id::text
         OR (
           v_product_unit_id IS NOT NULL
           AND product ->> 'productUnitId' <> v_product_unit_id::text
         )
    ) THEN
      RAISE EXCEPTION 'Product or unit filter returned an unrelated item';
    END IF;
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('product and unit filtering', 'PASS', 'Top products remain within the selected product/unit snapshot.');

    v_history := public.get_supplier_intelligence_history(jsonb_build_object(
      'supplier_id', v_supplier.id,
      'start_date', v_sample_date,
      'end_date', v_sample_date,
      'page', 1,
      'page_size', 100
    ));
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_history -> 'rows') row_value
      WHERE (row_value ->> 'purchaseDate')::date <> v_sample_date
    ) THEN
      RAISE EXCEPTION 'Date filter returned an out-of-range purchase';
    END IF;
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('date filtering', 'PASS', 'One-day history contains only the selected purchase date.');
  ELSE
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('product and unit filtering', 'SKIP', 'No product-linked counted purchase fixture is available.');
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('date filtering', 'SKIP', 'No product-linked counted purchase fixture is available.');
  END IF;

  v_history := public.get_supplier_intelligence_history(jsonb_build_object(
    'supplier_id', v_supplier.id,
    'start_date', v_start,
    'end_date', v_end,
    'page', 1,
    'page_size', 2
  ));
  IF jsonb_array_length(v_history -> 'rows') > 2 THEN
    RAISE EXCEPTION 'History page bound failed';
  END IF;
  INSERT INTO supplier_intelligence_runtime_results
  VALUES ('history pagination', 'PASS', 'History returned no more than two rows.');

  v_list := public.list_supplier_intelligence(jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'page', 1,
    'page_size', 2,
    'sort', 'gross_purchases',
    'direction', 'desc'
  ));
  v_list_repeat := public.list_supplier_intelligence(jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'page', 1,
    'page_size', 2,
    'sort', 'gross_purchases',
    'direction', 'desc'
  ));
  IF jsonb_array_length(v_list -> 'rows') > 2 THEN
    RAISE EXCEPTION 'List page bound failed';
  END IF;
  IF v_list -> 'rows' IS DISTINCT FROM v_list_repeat -> 'rows' THEN
    RAISE EXCEPTION 'Stable sort repeated call returned a different page';
  END IF;
  INSERT INTO supplier_intelligence_runtime_results
  VALUES ('report pagination and stable sorting', 'PASS', 'Page is bounded and repeated stable sort returned the same rows.');

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_detail -> 'paymentStatusSummary') row_value
    WHERE row_value ->> 'status' NOT IN ('paid', 'partial', 'unpaid')
  ) THEN
    RAISE EXCEPTION 'Unexpected payment status returned';
  END IF;
  INSERT INTO supplier_intelligence_runtime_results
  VALUES ('informational payment status', 'PASS', 'Only recorded paid/partial/unpaid states are summarized.');

  SELECT * INTO v_zero_supplier
  FROM public.suppliers s
  WHERE s.tenant_id = v_owner.tenant_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.reporting_counted_purchases_v p
      WHERE p.supplier_id = s.id AND p.is_counted IS TRUE
    )
  ORDER BY s.created_at
  LIMIT 1;
  IF v_zero_supplier.id IS NOT NULL THEN
    v_detail := public.get_supplier_intelligence(jsonb_build_object(
      'supplier_id', v_zero_supplier.id,
      'start_date', v_start,
      'end_date', v_end
    ));
    IF (v_detail #>> '{summary,grossPurchases}')::numeric <> 0
       OR (v_detail #>> '{summary,averagePurchaseValue}')::numeric <> 0
    THEN
      RAISE EXCEPTION 'Zero-activity supplier metrics are not zero';
    END IF;
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('zero-activity supplier', 'PASS', 'Gross and average purchase are zero.');
  ELSE
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('zero-activity supplier', 'SKIP', 'No zero-activity supplier fixture is available.');
  END IF;

  SELECT * INTO v_branch_user
  FROM public.user_profiles
  WHERE role = 'branch'
    AND is_active IS TRUE
    AND tenant_id = v_owner.tenant_id
    AND branch_id IS NOT NULL
  ORDER BY created_at
  LIMIT 1;
  IF v_branch_user.id IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_branch_user.id::text, true);
    v_list := public.list_supplier_intelligence(jsonb_build_object(
      'start_date', v_start,
      'end_date', v_end,
      'page_size', 5
    ));
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_list -> 'rows') row_value
      WHERE row_value ->> 'branchId' <> v_branch_user.branch_id::text
    ) THEN
      RAISE EXCEPTION 'Branch-user result escaped assigned branch';
    END IF;
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('branch-user scope', 'PASS', 'Rows remain in the assigned branch.');

    SELECT id INTO v_other_branch
    FROM public.branches
    WHERE tenant_id = v_branch_user.tenant_id
      AND id <> v_branch_user.branch_id
    LIMIT 1;
    IF v_other_branch IS NOT NULL THEN
      BEGIN
        PERFORM public.list_supplier_intelligence(jsonb_build_object(
          'branch_id', v_other_branch,
          'start_date', v_start,
          'end_date', v_end
        ));
        RAISE EXCEPTION 'Cross-branch request unexpectedly succeeded';
      EXCEPTION WHEN insufficient_privilege THEN
        INSERT INTO supplier_intelligence_runtime_results
        VALUES ('cross-branch rejection', 'PASS', 'Manipulated branch UUID was rejected.');
      END;
    ELSE
      INSERT INTO supplier_intelligence_runtime_results
      VALUES ('cross-branch rejection', 'SKIP', 'No second branch fixture is available.');
    END IF;
  ELSE
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('branch-user scope', 'SKIP', 'No active branch-user fixture is available.');
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('cross-branch rejection', 'SKIP', 'No active branch-user fixture is available.');
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner.id::text, true);
  SELECT id INTO v_other_tenant_supplier
  FROM public.suppliers
  WHERE tenant_id <> v_owner.tenant_id
  ORDER BY created_at
  LIMIT 1;
  IF v_other_tenant_supplier IS NOT NULL THEN
    BEGIN
      PERFORM public.get_supplier_intelligence(jsonb_build_object(
        'supplier_id', v_other_tenant_supplier,
        'start_date', v_start,
        'end_date', v_end
      ));
      RAISE EXCEPTION 'Cross-tenant request unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO supplier_intelligence_runtime_results
      VALUES ('cross-tenant rejection', 'PASS', 'Manipulated supplier UUID from another tenant was rejected.');
    END;
  ELSE
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('cross-tenant rejection', 'SKIP', 'No second-tenant supplier fixture is available.');
  END IF;

  BEGIN
    PERFORM public.list_supplier_intelligence(jsonb_build_object('page_size', 51));
    RAISE EXCEPTION 'Oversized page unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('invalid page rejection', 'PASS', 'Page size above 50 was rejected.');
  END;

  BEGIN
    PERFORM public.list_supplier_intelligence(jsonb_build_object('sort', 'unsafe_sql'));
    RAISE EXCEPTION 'Invalid sort unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('invalid sort rejection', 'PASS', 'Unknown sort key was rejected.');
  END;

  BEGIN
    PERFORM public.get_supplier_intelligence(jsonb_build_object(
      'supplier_id', v_supplier.id,
      'payment_status', 'overdue'
    ));
    RAISE EXCEPTION 'Invalid payment status unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('invalid payment-status rejection', 'PASS', 'Unknown payment status was rejected.');
  END;

  BEGIN
    PERFORM public.get_supplier_intelligence(jsonb_build_object(
      'supplier_id', v_supplier.id,
      'start_date', CURRENT_DATE,
      'end_date', CURRENT_DATE - 1
    ));
    RAISE EXCEPTION 'Invalid date range unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO supplier_intelligence_runtime_results
    VALUES ('invalid date rejection', 'PASS', 'Reversed date range was rejected.');
  END;
END;
$runtime$;

SELECT check_name, result, detail
FROM supplier_intelligence_runtime_results
ORDER BY check_name;

ROLLBACK;
