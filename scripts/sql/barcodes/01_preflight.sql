-- Supabase SQL Editor compatible. This script is read-only and always rolls back.
BEGIN TRANSACTION READ ONLY;

SELECT current_database(), current_user, current_setting('transaction_read_only') AS transaction_read_only;

SELECT
  to_regclass('public.products') IS NOT NULL AS products_present,
  to_regclass('public.product_units') IS NOT NULL AS product_units_present,
  to_regprocedure('public.get_branch_selling_product_units(uuid)') IS NOT NULL AS selling_units_rpc_present,
  to_regprocedure('public.pos_checkout_with_product_units_v1(jsonb)') IS NOT NULL AS unit_checkout_present,
  to_regprocedure('public.branch_effective_stock_enabled(uuid,uuid)') IS NOT NULL AS stock_resolver_present;

SELECT c.function_signature, c.definition_md5 AS expected_md5,
  CASE WHEN to_regprocedure(c.function_signature) IS NULL THEN NULL
    ELSE md5(pg_get_functiondef(to_regprocedure(c.function_signature)::oid))
  END AS actual_md5,
  to_regprocedure(c.function_signature) IS NOT NULL
    AND md5(pg_get_functiondef(to_regprocedure(c.function_signature)::oid)) = c.definition_md5
    AS contract_matches
FROM public.product_units_commercial_function_contracts_v1 c
ORDER BY c.function_signature;

SELECT
  to_regclass('public.product_unit_barcodes') IS NOT NULL AS barcode_table_present,
  to_regclass('public.product_barcode_print_events') IS NOT NULL AS print_audit_table_present,
  to_regprocedure('public.resolve_product_unit_barcode(uuid,text)') IS NOT NULL AS resolver_present,
  to_regprocedure('public.product_barcode_scope(uuid)') IS NOT NULL AS scope_helper_present,
  to_regclass('public.barcode_function_contracts_v1') IS NULL AS new_contract_table_absent,
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260726000100'
  ) AS initial_migration_recorded,
  NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260726000200'
  ) AS follow_up_migration_history_clear;

SELECT
  pg_get_function_result(
    'public.product_barcode_scope(uuid)'::regprocedure
  ) AS scope_declared_result,
  md5(pg_get_functiondef(
    'public.product_barcode_scope(uuid)'::regprocedure
  )) AS current_scope_md5,
  position(
    'up.role::text'
    IN pg_get_functiondef('public.product_barcode_scope(uuid)'::regprocedure)
  ) > 0 AS correction_already_present;

SELECT
  pg_get_function_identity_arguments(p.oid) AS arguments,
  md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_product_units',
    'get_branch_selling_product_units',
    'pos_checkout_with_product_units_v1',
    'branch_effective_stock_enabled'
  )
ORDER BY p.proname, arguments;

SELECT
  count(*) AS products,
  pg_size_pretty(pg_total_relation_size('public.products')) AS products_size,
  (SELECT count(*) FROM public.product_units) AS product_units,
  pg_size_pretty(pg_total_relation_size('public.product_units')) AS product_units_size;

SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('products', 'product_units')
  AND (
    column_name ILIKE '%barcode%'
    OR column_name ILIKE '%gtin%'
    OR column_name ILIKE '%upc%'
    OR column_name ILIKE '%code%'
  )
ORDER BY table_name, ordinal_position;

SELECT branch_id, btrim(barcode) AS normalized_candidate, count(*) AS duplicate_count
FROM public.products
WHERE NULLIF(btrim(barcode), '') IS NOT NULL
GROUP BY branch_id, btrim(barcode)
HAVING count(*) > 1
ORDER BY duplicate_count DESC, branch_id
LIMIT 100;

SELECT count(*) AS malformed_legacy_candidates
FROM public.products
WHERE NULLIF(btrim(barcode), '') IS NOT NULL
  AND (
    length(btrim(barcode)) NOT BETWEEN 3 AND 128
    OR btrim(barcode) ~ '[[:cntrl:]]'
  );

SELECT count(*) AS product_scope_defects
FROM public.product_units pu
LEFT JOIN public.products p
  ON p.id = pu.product_id
 AND p.tenant_id = pu.tenant_id
 AND p.branch_id = pu.branch_id
WHERE p.id IS NULL;

SELECT pid, usename, state, wait_event_type, wait_event,
  age(clock_timestamp(), xact_start) AS transaction_age
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND (xact_start IS NOT NULL OR state <> 'idle')
ORDER BY xact_start NULLS LAST;

SELECT dependent_ns.nspname AS dependent_schema,
  dependent_view.relname AS dependent_object
FROM pg_depend
JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
JOIN pg_class dependent_view ON pg_rewrite.ev_class = dependent_view.oid
JOIN pg_namespace dependent_ns ON dependent_view.relnamespace = dependent_ns.oid
WHERE pg_depend.refobjid IN ('public.products'::regclass, 'public.product_units'::regclass)
ORDER BY 1, 2;

ROLLBACK;
