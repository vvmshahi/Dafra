-- Stateful local validation for 20260731000100_purchase_posting_idempotency.
-- Run only against a disposable Supabase database that has completed a clean reset.

DO $stateful$
DECLARE
  v_tenant_a uuid := '00000000-0000-4000-8000-000000000001';
  v_branch_a uuid := '00000000-0000-4000-8000-000000000002';
  v_user_a uuid := '00000000-0000-4000-8000-000000000003';
  v_supplier_a uuid := '00000000-0000-4000-8000-000000000004';
  v_supplier_inactive uuid := '00000000-0000-4000-8000-000000000005';
  v_stock_product uuid := '00000000-0000-4000-8000-000000000006';
  v_stock_base_unit uuid;
  v_stock_package_unit uuid := '00000000-0000-4000-8000-000000000008';
  v_service_product uuid := '00000000-0000-4000-8000-000000000009';
  v_service_base_unit uuid;
  v_tenant_b uuid := '00000000-0000-4000-8000-00000000000b';
  v_branch_b uuid := '00000000-0000-4000-8000-00000000000c';
  v_user_b uuid := '00000000-0000-4000-8000-00000000000d';
  v_supplier_b uuid := '00000000-0000-4000-8000-00000000000e';
  v_owner_a uuid := '00000000-0000-4000-8000-00000000000f';
  v_op_base uuid := '10000000-0000-4000-8000-000000000001';
  v_op_package uuid := '10000000-0000-4000-8000-000000000002';
  v_op_multi uuid := '10000000-0000-4000-8000-000000000003';
  v_op_rollback uuid := '10000000-0000-4000-8000-000000000004';
  v_op_zero uuid := '10000000-0000-4000-8000-000000000005';
  v_op_inactive uuid := '10000000-0000-4000-8000-000000000006';
  v_op_cross_supplier uuid := '10000000-0000-4000-8000-000000000007';
  v_op_cross_user uuid := '10000000-0000-4000-8000-000000000008';
  v_op_bad_unit uuid := '10000000-0000-4000-8000-000000000009';
  v_op_owner uuid := '10000000-0000-4000-8000-00000000000a';
  v_result jsonb;
  v_base_purchase_id uuid;
  v_count integer;
  v_stock numeric;
BEGIN
  INSERT INTO public.tenants (id, name, vat_number, is_active, business_type)
  VALUES
    (v_tenant_a, 'Purchase Test Tenant A', '310000000000003', true, 'trading'),
    (v_tenant_b, 'Purchase Test Tenant B', '310000000000004', true, 'trading');

  INSERT INTO public.branches (id, tenant_id, name, is_active, stock_enabled)
  VALUES
    (v_branch_a, v_tenant_a, 'Purchase Test Branch A', true, true),
    (v_branch_b, v_tenant_b, 'Purchase Test Branch B', true, true);

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_user_a, 'authenticated', 'authenticated', 'purchase-test-branch-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_b, 'authenticated', 'authenticated', 'purchase-test-branch-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_owner_a, 'authenticated', 'authenticated', 'purchase-test-owner-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  INSERT INTO public.user_profiles (id, tenant_id, branch_id, role, full_name, email, is_active)
  VALUES
    (v_user_a, v_tenant_a, v_branch_a, 'branch', 'Purchase Test Branch User', 'purchase-test-branch-a@example.test', true),
    (v_user_b, v_tenant_b, v_branch_b, 'branch', 'Purchase Test Branch User B', 'purchase-test-branch-b@example.test', true),
    (v_owner_a, v_tenant_a, NULL, 'owner', 'Purchase Test Owner', 'purchase-test-owner-a@example.test', true);

  INSERT INTO public.suppliers (id, tenant_id, branch_id, name, is_active)
  VALUES
    (v_supplier_a, v_tenant_a, v_branch_a, 'Purchase Test Supplier', true),
    (v_supplier_inactive, v_tenant_a, v_branch_a, 'Inactive Purchase Test Supplier', false),
    (v_supplier_b, v_tenant_b, v_branch_b, 'Cross Tenant Purchase Test Supplier', true);

  INSERT INTO public.products (
    id, tenant_id, branch_id, name, sku, unit, price, cost,
    tax_rate, stock_quantity, is_active, is_service, is_available, track_stock
  ) VALUES
    (v_stock_product, v_tenant_a, v_branch_a, 'Purchase Test Stock Product', 'TEST-STOCK-001', 'Each', 0, 0, 15, 10, true, false, true, true),
    (v_service_product, v_tenant_a, v_branch_a, 'Purchase Test Service Product', 'TEST-SERVICE-001', 'Hour', 0, 0, 15, 0, true, true, true, false);

  -- Product inserts create lifecycle-managed base units. Keep their generated
  -- IDs and use them in the request payloads rather than rewriting a unit.
  SELECT id INTO v_stock_base_unit
  FROM public.product_units
  WHERE product_id = v_stock_product AND is_base IS TRUE;

  SELECT id INTO v_service_base_unit
  FROM public.product_units
  WHERE product_id = v_service_product AND is_base IS TRUE;

  INSERT INTO public.product_units (
    id, tenant_id, branch_id, product_id, name, unit_code,
    conversion_to_base, quantity_scale, receiving_enabled, is_base,
    is_active, version
  ) VALUES (
    v_stock_package_unit, v_tenant_a, v_branch_a, v_stock_product, 'Dozen', 'DOZ',
    12, 3, true, false, true, 1
  );

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);

  v_result := public.post_purchase_receiving_v1(jsonb_build_object(
    'operation_id', v_op_base::text,
    'branch_id', v_branch_a::text,
    'supplier_id', v_supplier_a::text,
    'purchase_date', '2026-07-31',
    'action', 'receive',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_stock_product::text,
      'product_unit_id', v_stock_base_unit::text,
      'expected_product_unit_version', 1,
      'quantity', 2,
      'unit_cost', 10
    ))
  ));
  IF (v_result ->> 'success')::boolean IS NOT TRUE
     OR (v_result ->> 'idempotent_replay')::boolean IS NOT FALSE
     OR (v_result ->> 'stock_lines_confirmed')::integer <> 1 THEN
    RAISE EXCEPTION 'base-unit posting response was invalid: %', v_result;
  END IF;
  v_base_purchase_id := (v_result ->> 'purchase_id')::uuid;

  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_stock_product;
  IF v_stock <> 12 THEN
    RAISE EXCEPTION 'base-unit stock delta expected 12, got %', v_stock;
  END IF;
  SELECT count(*) INTO v_count FROM public.purchases WHERE id = v_base_purchase_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'base purchase header was not persisted'; END IF;
  SELECT count(*) INTO v_count FROM public.purchase_items WHERE purchase_id = v_base_purchase_id;
  IF v_count <> 1 THEN RAISE EXCEPTION 'base purchase item count expected 1, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.product_stock_receipts WHERE product_id = v_stock_product;
  IF v_count <> 1 THEN RAISE EXCEPTION 'base receipt count expected 1, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.pos_stock_movements WHERE product_id = v_stock_product AND reason = 'stock_receipt';
  IF v_count <> 1 THEN RAISE EXCEPTION 'base POS movement count expected 1, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.purchase_stock_movements WHERE purchase_id = v_base_purchase_id AND stock_target_type = 'saleable_product';
  IF v_count <> 1 THEN RAISE EXCEPTION 'base purchase movement count expected 1, got %', v_count; END IF;

  v_result := public.post_purchase_receiving_v1(jsonb_build_object(
    'operation_id', v_op_base::text, 'branch_id', v_branch_a::text,
    'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
      'expected_product_unit_version', 1, 'quantity', 2, 'unit_cost', 10
    ))
  ));
  IF (v_result ->> 'idempotent_replay')::boolean IS NOT TRUE
     OR (v_result ->> 'purchase_id')::uuid IS DISTINCT FROM v_base_purchase_id THEN
    RAISE EXCEPTION 'identical retry did not return the stored result: %', v_result;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_stock_product;
  IF v_stock <> 12 THEN RAISE EXCEPTION 'identical retry changed stock to %', v_stock; END IF;

  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_base::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 3, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'conflicting retry unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC06' THEN NULL;
  END;
  SELECT count(*) INTO v_count FROM public.purchases;
  IF v_count <> 1 THEN RAISE EXCEPTION 'conflicting retry created % purchases', v_count; END IF;

  v_result := public.post_purchase_receiving_v1(jsonb_build_object(
    'operation_id', v_op_package::text, 'branch_id', v_branch_a::text,
    'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_stock_product::text, 'product_unit_id', v_stock_package_unit::text,
      'expected_product_unit_version', 1, 'quantity', 2, 'unit_cost', 120
    ))
  ));
  IF (v_result ->> 'stock_lines_confirmed')::integer <> 1 THEN
    RAISE EXCEPTION 'package posting did not confirm stock: %', v_result;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_stock_product;
  IF v_stock <> 36 THEN RAISE EXCEPTION 'package conversion expected stock 36, got %', v_stock; END IF;
  SELECT count(*) INTO v_count
  FROM public.purchase_stock_movements
  WHERE product_id = v_stock_product
    AND product_unit_id = v_stock_package_unit
    AND conversion_to_base = 12
    AND base_quantity = 24
    AND quantity_delta = 24;
  IF v_count <> 1 THEN RAISE EXCEPTION 'package movement snapshot was not exact'; END IF;

  v_result := public.post_purchase_receiving_v1(jsonb_build_object(
    'operation_id', v_op_multi::text, 'branch_id', v_branch_a::text,
    'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 11),
      jsonb_build_object('product_id', v_service_product::text, 'product_unit_id', v_service_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 3, 'unit_cost', 50)
    )
  ));
  IF (v_result ->> 'line_count')::integer <> 2
     OR (v_result ->> 'stock_lines_confirmed')::integer <> 1
     OR (v_result ->> 'lines_skipped')::integer <> 1 THEN
    RAISE EXCEPTION 'mixed stock/service result was invalid: %', v_result;
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_stock_product;
  IF v_stock <> 37 THEN RAISE EXCEPTION 'mixed posting stock expected 37, got %', v_stock; END IF;
  SELECT count(*) INTO v_count FROM public.product_stock_receipts WHERE product_id = v_stock_product;
  IF v_count <> 3 THEN RAISE EXCEPTION 'stock receipt ledger expected 3, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.purchase_stock_movements WHERE product_id = v_stock_product;
  IF v_count <> 3 THEN RAISE EXCEPTION 'purchase stock ledger expected 3, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.purchase_items WHERE product_id = v_service_product AND receiving_status = 'skipped';
  IF v_count <> 1 THEN RAISE EXCEPTION 'service line was not skipped'; END IF;

  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_rollback::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(
        jsonb_build_object('product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
          'expected_product_unit_version', 1, 'quantity', 5, 'unit_cost', 10),
        jsonb_build_object('product_id', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'product_unit_id', NULL,
          'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 10)
      )
    ));
    RAISE EXCEPTION 'rollback payload unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC05' THEN NULL;
  END;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_stock_product;
  IF v_stock <> 37 THEN RAISE EXCEPTION 'failed multi-line posting changed stock to %', v_stock; END IF;
  SELECT count(*) INTO v_count FROM public.purchases;
  IF v_count <> 3 THEN RAISE EXCEPTION 'failed multi-line posting persisted a header'; END IF;
  SELECT count(*) INTO v_count FROM public.purchase_posting_operations WHERE operation_id = v_op_rollback;
  IF v_count <> 0 THEN RAISE EXCEPTION 'failed multi-line posting persisted an operation'; END IF;

  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_zero::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 0, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'zero quantity unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC09' THEN NULL;
  END;

  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_inactive::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_inactive::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'inactive supplier unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC04' THEN NULL;
  END;

  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_cross_supplier::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_b::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'cross-tenant supplier unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC04' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_cross_user::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'cross-tenant branch user unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC03' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_bad_unit::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action',
      'receive', 'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'unauthenticated request unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC02' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', v_op_bad_unit::text, 'branch_id', v_branch_a::text,
      'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 2, 'quantity', 1, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'stale product-unit version unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PPC05' THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_result := public.post_purchase_receiving_v1(jsonb_build_object(
    'operation_id', v_op_owner::text, 'branch_id', v_branch_a::text,
    'supplier_id', v_supplier_a::text, 'purchase_date', '2026-07-31', 'action', 'receive',
    'lines', jsonb_build_array(jsonb_build_object(
      'product_id', v_service_product::text, 'product_unit_id', v_service_base_unit::text,
      'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 10
    ))
  ));
  IF (v_result ->> 'success')::boolean IS NOT TRUE OR (v_result ->> 'stock_applied')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'same-tenant owner request failed: %', v_result;
  END IF;
  BEGIN
    PERFORM public.post_purchase_receiving_v1(jsonb_build_object(
      'operation_id', '10000000-0000-4000-8000-00000000000b', 'branch_id', v_branch_b::text,
      'supplier_id', v_supplier_b::text, 'purchase_date', '2026-07-31', 'action', 'receive',
      'lines', jsonb_build_array(jsonb_build_object(
        'product_id', v_stock_product::text, 'product_unit_id', v_stock_base_unit::text,
        'expected_product_unit_version', 1, 'quantity', 1, 'unit_cost', 10
      ))
    ));
    RAISE EXCEPTION 'owner crossed tenant boundary';
  EXCEPTION WHEN SQLSTATE 'PPC03' THEN NULL;
  END;

  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_stock_product;
  IF v_stock <> 37 THEN RAISE EXCEPTION 'security failures changed stock to %', v_stock; END IF;
  SELECT count(*) INTO v_count FROM public.purchases;
  IF v_count <> 4 THEN RAISE EXCEPTION 'unexpected purchase count after failures: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.purchase_posting_operations WHERE state = 'completed';
  IF v_count <> 4 THEN RAISE EXCEPTION 'completed operation count expected 4, got %', v_count; END IF;

  RAISE NOTICE 'purchase posting stateful fixture, retry, rollback, stock, ledger, and scope tests passed';
END;
$stateful$;
