BEGIN;

DO $runtime$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_original jsonb;
  v_saved jsonb;
  v_cross_branch uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_created_barcode jsonb;
  v_first_print jsonb;
  v_reprint jsonb;
BEGIN
  SELECT * INTO v_profile
  FROM public.user_profiles
  WHERE is_active IS TRUE
    AND role = 'branch'
    AND tenant_id IS NOT NULL
    AND branch_id IS NOT NULL
  ORDER BY created_at
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Runtime fixture requires one active branch profile';
  END IF;

  SELECT * INTO v_branch
  FROM public.branches
  WHERE id = v_profile.branch_id
    AND tenant_id = v_profile.tenant_id
    AND is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Runtime fixture branch is unavailable';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_profile.id, 'role', 'authenticated')::text,
    true
  );

  v_original := public.get_branch_barcode_label_settings(v_branch.id);
  IF v_original->>'branch_id' IS DISTINCT FROM v_branch.id::text THEN
    RAISE EXCEPTION 'Branch settings read returned the wrong branch';
  END IF;

  v_saved := public.update_branch_barcode_label_settings(jsonb_build_object(
    'branch_id', v_branch.id,
    'settings', public.default_barcode_label_settings()
      || jsonb_build_object('preset_id', 'compact_sticker')
  ));
  IF v_saved#>>'{settings,preset_id}' <> 'compact_sticker' THEN
    RAISE EXCEPTION 'Branch settings save did not round-trip';
  END IF;

  SELECT id INTO v_cross_branch
  FROM public.branches
  WHERE tenant_id <> v_profile.tenant_id
    AND is_active IS TRUE
  LIMIT 1;
  IF v_cross_branch IS NOT NULL THEN
    BEGIN
      PERFORM public.get_branch_barcode_label_settings(v_cross_branch);
      RAISE EXCEPTION 'Cross-tenant settings read unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END IF;

  BEGIN
    PERFORM public.validate_barcode_label_settings(
      public.default_barcode_label_settings()
      || jsonb_build_object('printer_password', 'not-allowed')
    );
    RAISE EXCEPTION 'Unknown settings key unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  SELECT p.id, pu.id
  INTO v_product_id, v_product_unit_id
  FROM public.products p
  JOIN public.product_units pu ON pu.product_id = p.id
  WHERE p.tenant_id = v_branch.tenant_id
    AND p.branch_id = v_branch.id
    AND p.is_active IS TRUE
    AND pu.is_active IS TRUE
  ORDER BY pu.is_base DESC, p.created_at, pu.created_at
  LIMIT 1;
  IF v_product_unit_id IS NULL THEN
    RAISE EXCEPTION 'Runtime fixture requires one active product unit';
  END IF;

  v_created_barcode := public.generate_internal_product_unit_barcode(
    v_product_unit_id,
    false
  );
  v_first_print := public.record_product_barcode_print_batch(jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'barcode_id', v_created_barcode->>'id',
      'copies', 1
    )),
    'label_template', 'runtime:standard',
    'reason', NULL
  ));
  v_reprint := public.record_product_barcode_print_batch(jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object(
      'barcode_id', v_created_barcode->>'id',
      'copies', 10
    )),
    'label_template', 'runtime:standard',
    'reason', NULL
  ));

  IF v_first_print#>>'{events,0,print_kind}' <> 'first_print'
     OR v_reprint#>>'{events,0,print_kind}' <> 'reprint'
     OR (v_first_print#>>'{events,0,barcode_id}')::uuid
        IS DISTINCT FROM (v_created_barcode->>'id')::uuid
     OR (v_reprint#>>'{events,0,barcode_id}')::uuid
        IS DISTINCT FROM (v_created_barcode->>'id')::uuid
     OR (v_reprint->>'total_labels')::integer <> 10
  THEN
    RAISE EXCEPTION 'First-print/reprint batch contract failed';
  END IF;

  IF (
    SELECT print_count
    FROM public.get_product_barcode_print_status(v_product_id)
    WHERE barcode_id = (v_created_barcode->>'id')::uuid
  ) <> 2 THEN
    RAISE EXCEPTION 'Print status did not return both recorded requests';
  END IF;

  BEGIN
    PERFORM public.record_product_barcode_print_batch(jsonb_build_object(
      'items', jsonb_build_array(jsonb_build_object(
        'barcode_id', v_created_barcode->>'id',
        'copies', 51
      )),
      'label_template', 'runtime:standard',
      'reason', NULL
    ));
    RAISE EXCEPTION 'Large print request without a reason unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  IF has_table_privilege('authenticated', 'public.branch_barcode_label_settings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.branch_barcode_label_settings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.branch_barcode_label_settings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.branch_barcode_label_settings', 'DELETE')
  THEN
    RAISE EXCEPTION 'Authenticated direct settings-table access unexpectedly exists';
  END IF;
END;
$runtime$;

ROLLBACK;
