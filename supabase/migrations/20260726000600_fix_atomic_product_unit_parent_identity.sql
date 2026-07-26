BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- Product Units commercial workflow v1 was installed after atomic simplified
-- checkout v2. Its package-aware helper generated a local candidate invoice ID,
-- while the atomic BEFORE INSERT trigger persisted the intent-reserved ID.
-- Capture the ID that invoices actually persisted before any child write.
DO $fix_atomic_product_unit_parent_identity$
DECLARE
  v_signature constant text :=
    'public.pos_checkout_with_product_units_v1(jsonb)';
  v_function regprocedure;
  v_definition text;
  v_corrected_definition text;
  v_registered_hash text;
  v_corrected_hash text;
  v_before text := $before$    v_note, v_created_at
  );

  FOR v_line IN
$before$;
  v_after text := $after$    v_note, v_created_at
  )
  RETURNING id INTO v_invoice_id;

  IF v_invoice_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.invoices AS persisted_invoice
       WHERE persisted_invoice.id = v_invoice_id
         AND persisted_invoice.tenant_id = v_branch.tenant_id
         AND persisted_invoice.branch_id = v_branch.id
     )
  THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_COMMERCIAL_PARENT_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_line IN
$after$;
  v_before_count integer;
  v_after_count integer;
BEGIN
  v_function := to_regprocedure(v_signature);
  IF v_function IS NULL
     OR to_regclass(
       'public.product_units_commercial_function_contracts_v1'
     ) IS NULL
  THEN
    RAISE EXCEPTION
      'PRODUCT_UNITS_ATOMIC_PARENT_DEFINITION_UNREVIEWED:%',
      v_signature;
  END IF;

  SELECT contract.definition_md5
  INTO v_registered_hash
  FROM public.product_units_commercial_function_contracts_v1 AS contract
  WHERE contract.function_signature = v_signature
  FOR UPDATE;

  v_definition := pg_get_functiondef(v_function);
  IF v_registered_hash IS NULL
     OR md5(v_definition) IS DISTINCT FROM v_registered_hash
     OR v_definition NOT LIKE '%v_invoice_id uuid := pg_catalog.gen_random_uuid();%'
     OR v_definition NOT LIKE '%INSERT INTO public.invoice_items%'
     OR v_definition NOT LIKE '%INSERT INTO public.payments%'
     OR v_definition NOT LIKE '%RETURN jsonb_build_object(%'
  THEN
    RAISE EXCEPTION
      'PRODUCT_UNITS_ATOMIC_PARENT_DEFINITION_UNREVIEWED:%',
      v_signature;
  END IF;

  v_before_count := (
    length(v_definition) - length(replace(v_definition, v_before, ''))
  ) / length(v_before);
  v_after_count := (
    length(v_definition) - length(replace(v_definition, v_after, ''))
  ) / length(v_after);

  IF v_after_count = 1 AND v_before_count = 0 THEN
    v_corrected_definition := v_definition;
  ELSIF v_before_count = 1 AND v_after_count = 0 THEN
    v_corrected_definition := replace(v_definition, v_before, v_after);
    EXECUTE v_corrected_definition;
    v_corrected_definition := pg_get_functiondef(v_function);
    v_corrected_hash := md5(v_corrected_definition);

    UPDATE public.product_units_commercial_function_contracts_v1 AS contract
    SET definition_md5 = v_corrected_hash,
        registered_at = clock_timestamp()
    WHERE contract.function_signature = v_signature
      AND contract.definition_md5 = v_registered_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'PRODUCT_UNITS_ATOMIC_PARENT_CONTRACT_UPDATE_FAILED:%',
        v_signature;
    END IF;
  ELSE
    RAISE EXCEPTION
      'PRODUCT_UNITS_ATOMIC_PARENT_PATCH_AMBIGUOUS:%',
      v_signature;
  END IF;

  v_corrected_definition := pg_get_functiondef(v_function);
  v_corrected_hash := md5(v_corrected_definition);
  SELECT contract.definition_md5
  INTO v_registered_hash
  FROM public.product_units_commercial_function_contracts_v1 AS contract
  WHERE contract.function_signature = v_signature;

  IF (
       length(v_corrected_definition)
       - length(replace(v_corrected_definition, v_after, ''))
     ) / length(v_after) <> 1
     OR v_corrected_definition NOT LIKE '%INSERT INTO public.invoice_items%'
     OR v_corrected_definition NOT LIKE '%VALUES (
      v_invoice_id,%'
     OR v_corrected_definition NOT LIKE '%INSERT INTO public.payments%'
     OR v_corrected_hash IS DISTINCT FROM v_registered_hash
  THEN
    RAISE EXCEPTION
      'PRODUCT_UNITS_ATOMIC_PARENT_POSTCONDITION_FAILED:%',
      v_signature;
  END IF;
END
$fix_atomic_product_unit_parent_identity$;

ALTER FUNCTION public.pos_checkout_with_product_units_v1(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout_with_product_units_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout_with_product_units_v1(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.pos_checkout_with_product_units_v1(jsonb) IS
  'Package-aware POS checkout. Captures and verifies the persisted invoice parent ID before all item, stock-movement, and payment children.';

COMMIT;
