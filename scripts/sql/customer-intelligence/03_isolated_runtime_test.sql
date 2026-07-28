BEGIN;

CREATE TEMP TABLE customer_intelligence_runtime_results (
  check_name text PRIMARY KEY,
  result text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $runtime$
DECLARE
  v_owner public.user_profiles%ROWTYPE;
  v_branch_user public.user_profiles%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_other_branch uuid;
  v_other_tenant_customer uuid;
  v_zero_customer public.customers%ROWTYPE;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_sample_date date;
  v_credit_customer_id uuid;
  v_start date := CURRENT_DATE - 365;
  v_end date := CURRENT_DATE;
  v_detail jsonb;
  v_history jsonb;
  v_list jsonb;
BEGIN
  SELECT * INTO v_owner
  FROM public.user_profiles
  WHERE role = 'owner'
    AND is_active IS TRUE
    AND tenant_id IS NOT NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_owner.id IS NULL THEN
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('fixture availability', 'SKIP', 'No active owner fixture is available.');
    RETURN;
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE tenant_id = v_owner.tenant_id
  ORDER BY created_at
  LIMIT 1;

  IF v_customer.id IS NULL THEN
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('fixture availability', 'SKIP', 'The owner tenant has no customer fixture.');
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner.id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_detail := public.get_customer_intelligence(jsonb_build_object(
    'customer_id', v_customer.id,
    'start_date', v_start,
    'end_date', v_end
  ));

  IF (v_detail #>> '{summary,netPurchases}')::numeric
      <> (v_detail #>> '{summary,grossPurchases}')::numeric
       - (v_detail #>> '{summary,creditedAmount}')::numeric THEN
    RAISE EXCEPTION 'Detail totals do not reconcile';
  END IF;
  INSERT INTO customer_intelligence_runtime_results
  VALUES ('owner scope and credit-note reconciliation', 'PASS', 'Gross less credited equals net.');

  SELECT ii.product_id, ii.product_unit_id, i.invoice_date
  INTO v_product_id, v_product_unit_id, v_sample_date
  FROM public.invoice_items ii
  JOIN public.invoices i
    ON i.id = ii.invoice_id
   AND i.tenant_id = ii.tenant_id
  WHERE i.customer_id = v_customer.id
    AND i.status = 'posted'
    AND i.zatca_invoice_type IN ('simplified', 'standard')
    AND ii.product_id IS NOT NULL
  ORDER BY i.invoice_date DESC, i.created_at DESC, ii.id
  LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    v_detail := public.get_customer_intelligence(jsonb_strip_nulls(jsonb_build_object(
      'customer_id', v_customer.id,
      'start_date', v_start,
      'end_date', v_end,
      'product_id', v_product_id,
      'product_unit_id', v_product_unit_id
    )));
    IF (v_detail #>> '{summary,netPurchases}')::numeric
        <> (v_detail #>> '{summary,grossPurchases}')::numeric
         - (v_detail #>> '{summary,creditedAmount}')::numeric THEN
      RAISE EXCEPTION 'Product-filtered totals do not reconcile';
    END IF;
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('product and unit filtering', 'PASS', 'Scoped product/unit filters execute and totals reconcile.');

    v_history := public.get_customer_intelligence_history(jsonb_build_object(
      'customer_id', v_customer.id,
      'start_date', v_sample_date,
      'end_date', v_sample_date,
      'page', 1,
      'page_size', 100
    ));
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_history -> 'rows') row_value
      WHERE (row_value ->> 'invoiceDate')::date <> v_sample_date
    ) THEN
      RAISE EXCEPTION 'Date filter returned an out-of-range document';
    END IF;
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('date filtering', 'PASS', 'One-day history contains only the selected invoice date.');
  ELSE
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('product and unit filtering', 'SKIP', 'No product-linked customer document fixture is available.');
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('date filtering', 'SKIP', 'No qualifying sales document fixture is available.');
  END IF;

  v_history := public.get_customer_intelligence_history(jsonb_build_object(
    'customer_id', v_customer.id,
    'start_date', v_start,
    'end_date', v_end,
    'page', 1,
    'page_size', 2
  ));
  IF jsonb_array_length(v_history -> 'rows') > 2 THEN
    RAISE EXCEPTION 'History page bound failed';
  END IF;
  INSERT INTO customer_intelligence_runtime_results
  VALUES ('history pagination', 'PASS', 'History returned no more than two rows.');

  v_list := public.list_customer_intelligence(jsonb_build_object(
    'start_date', v_start,
    'end_date', v_end,
    'page', 1,
    'page_size', 2,
    'sort', 'net_purchases',
    'direction', 'desc'
  ));
  IF jsonb_array_length(v_list -> 'rows') > 2 THEN
    RAISE EXCEPTION 'List page bound failed';
  END IF;
  IF (v_list #>> '{totals,netPurchases}')::numeric
      <> (v_list #>> '{totals,grossPurchases}')::numeric
       - (v_list #>> '{totals,creditedAmount}')::numeric THEN
    RAISE EXCEPTION 'List totals do not reconcile';
  END IF;
  INSERT INTO customer_intelligence_runtime_results
  VALUES ('report pagination and totals', 'PASS', 'Page is bounded and full-filter totals reconcile.');

  SELECT customer_id INTO v_credit_customer_id
  FROM public.invoices
  WHERE tenant_id = v_owner.tenant_id
    AND customer_id IS NOT NULL
    AND status = 'posted'
    AND zatca_invoice_type = 'credit_note'
    AND invoice_date BETWEEN v_start AND v_end
  ORDER BY invoice_date DESC, created_at DESC
  LIMIT 1;
  IF v_credit_customer_id IS NOT NULL THEN
    v_history := public.get_customer_intelligence_history(jsonb_build_object(
      'customer_id', v_credit_customer_id,
      'start_date', v_start,
      'end_date', v_end,
      'activity_type', 'credit_note',
      'page_size', 100
    ));
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_history -> 'rows') row_value
      WHERE row_value ->> 'documentType' <> 'credit_note'
         OR (row_value ->> 'creditedAmount')::numeric <= 0
         OR (row_value ->> 'netEffect')::numeric >= 0
    ) THEN
      RAISE EXCEPTION 'Credit-note history effect is inconsistent';
    END IF;
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('credit-note handling', 'PASS', 'Credit-only history has positive credited and negative net effects.');
  ELSE
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('credit-note handling', 'SKIP', 'No finalized credit-note fixture is available.');
  END IF;

  SELECT * INTO v_zero_customer
  FROM public.customers c
  WHERE c.tenant_id = v_owner.tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.customer_id = c.id
        AND i.status = 'posted'
        AND i.zatca_invoice_type IN ('simplified', 'standard', 'credit_note')
    )
  ORDER BY c.created_at
  LIMIT 1;
  IF v_zero_customer.id IS NOT NULL THEN
    v_detail := public.get_customer_intelligence(jsonb_build_object(
      'customer_id', v_zero_customer.id,
      'start_date', v_start,
      'end_date', v_end
    ));
    IF (v_detail #>> '{summary,grossPurchases}')::numeric <> 0
       OR (v_detail #>> '{summary,averageInvoiceValue}')::numeric <> 0 THEN
      RAISE EXCEPTION 'Zero-activity customer metrics are not zero';
    END IF;
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('zero-activity customer', 'PASS', 'Gross and average invoice are zero.');
  ELSE
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('zero-activity customer', 'SKIP', 'No zero-activity customer fixture is available.');
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
    v_list := public.list_customer_intelligence(jsonb_build_object(
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
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('branch-user scope', 'PASS', 'Rows remain in the assigned branch.');

    SELECT id INTO v_other_branch
    FROM public.branches
    WHERE tenant_id = v_branch_user.tenant_id
      AND id <> v_branch_user.branch_id
    LIMIT 1;
    IF v_other_branch IS NOT NULL THEN
      BEGIN
        PERFORM public.list_customer_intelligence(jsonb_build_object(
          'branch_id', v_other_branch,
          'start_date', v_start,
          'end_date', v_end
        ));
        RAISE EXCEPTION 'Cross-branch request unexpectedly succeeded';
      EXCEPTION WHEN insufficient_privilege THEN
        INSERT INTO customer_intelligence_runtime_results
        VALUES ('cross-branch rejection', 'PASS', 'Manipulated branch UUID was rejected.');
      END;
    ELSE
      INSERT INTO customer_intelligence_runtime_results
      VALUES ('cross-branch rejection', 'SKIP', 'No second branch fixture is available.');
    END IF;
  ELSE
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('branch-user scope', 'SKIP', 'No active branch-user fixture is available.');
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('cross-branch rejection', 'SKIP', 'No active branch-user fixture is available.');
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner.id::text, true);

  SELECT id INTO v_other_tenant_customer
  FROM public.customers
  WHERE tenant_id <> v_owner.tenant_id
  ORDER BY created_at
  LIMIT 1;
  IF v_other_tenant_customer IS NOT NULL THEN
    BEGIN
      PERFORM public.get_customer_intelligence(jsonb_build_object(
        'customer_id', v_other_tenant_customer,
        'start_date', v_start,
        'end_date', v_end
      ));
      RAISE EXCEPTION 'Cross-tenant request unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO customer_intelligence_runtime_results
      VALUES ('cross-tenant rejection', 'PASS', 'Manipulated customer UUID from another tenant was rejected.');
    END;
  ELSE
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('cross-tenant rejection', 'SKIP', 'No second-tenant customer fixture is available.');
  END IF;

  BEGIN
    PERFORM public.list_customer_intelligence(jsonb_build_object('page_size', 51));
    RAISE EXCEPTION 'Oversized page unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('invalid page rejection', 'PASS', 'Page size above 50 was rejected.');
  END;

  BEGIN
    PERFORM public.list_customer_intelligence(jsonb_build_object('sort', 'unsafe_sql'));
    RAISE EXCEPTION 'Invalid sort unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('invalid sort rejection', 'PASS', 'Unknown sort key was rejected.');
  END;

  BEGIN
    PERFORM public.get_customer_intelligence(jsonb_build_object(
      'customer_id', v_customer.id,
      'start_date', CURRENT_DATE,
      'end_date', CURRENT_DATE - 1
    ));
    RAISE EXCEPTION 'Invalid date range unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO customer_intelligence_runtime_results
    VALUES ('invalid date rejection', 'PASS', 'Reversed date range was rejected.');
  END;

END;
$runtime$;

SELECT check_name, result, detail
FROM customer_intelligence_runtime_results
ORDER BY check_name;

ROLLBACK;
