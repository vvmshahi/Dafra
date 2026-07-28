-- Supabase SQL Editor compatible. Run after 20260726000200; this script is
-- read-only and always rolls back.
BEGIN TRANSACTION READ ONLY;

SELECT current_database(), current_user, current_setting('transaction_read_only') AS transaction_read_only;

SELECT
  to_regclass('public.product_unit_barcodes') IS NOT NULL AS barcode_table_present,
  to_regclass('public.product_barcode_print_events') IS NOT NULL AS print_audit_present,
  to_regclass('public.barcode_function_contracts_v1') IS NOT NULL AS function_contract_present,
  to_regprocedure('public.resolve_product_unit_barcode(uuid,text)') IS NOT NULL AS resolver_present,
  to_regprocedure('public.product_barcode_scope(uuid)') IS NOT NULL AS corrected_scope_present;

SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
  coalesce(array_to_string(c.relacl, ','), '') AS acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'product_unit_barcodes',
    'product_barcode_print_events',
    'barcode_function_contracts_v1'
  )
ORDER BY c.relname;

SELECT p.oid::regprocedure::text AS function_signature,
  p.prosecdef,
  p.proconfig,
  pg_get_function_result(p.oid) AS declared_result,
  coalesce(array_to_string(p.proacl, ','), '') AS acl,
  md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'product_barcode_scope',
    'create_product_unit_barcode', 'update_product_unit_barcode',
    'disable_product_unit_barcode', 'reactivate_product_unit_barcode',
    'set_primary_product_unit_barcode', 'list_product_unit_barcodes',
    'resolve_product_unit_barcode', 'generate_internal_product_unit_barcode',
    'record_product_barcode_print'
  )
ORDER BY function_signature;

SELECT
  bool_and(p.prosecdef) AS all_barcode_functions_security_definer,
  bool_and(p.proconfig @> ARRAY['search_path=public, pg_temp']) AS all_search_paths_safe,
  bool_and(p.proconfig @> ARRAY['row_security=off']) AS all_row_security_off
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'product_barcode_scope',
    'create_product_unit_barcode', 'update_product_unit_barcode',
    'disable_product_unit_barcode', 'reactivate_product_unit_barcode',
    'set_primary_product_unit_barcode', 'list_product_unit_barcodes',
    'resolve_product_unit_barcode', 'generate_internal_product_unit_barcode',
    'record_product_barcode_print'
  );

SELECT
  c.function_signature,
  c.definition_md5 AS expected_md5,
  md5(pg_get_functiondef(to_regprocedure(c.function_signature)::oid)) AS actual_md5,
  md5(pg_get_functiondef(to_regprocedure(c.function_signature)::oid))
    = c.definition_md5 AS contract_matches
FROM public.barcode_function_contracts_v1 c
ORDER BY c.function_signature;

SELECT
  pg_get_function_result(
    'public.product_barcode_scope(uuid)'::regprocedure
  ) AS scope_declared_result,
  p.proargnames,
  p.proargmodes,
  format_type(p.proallargtypes[3], NULL) AS actor_role_declared_type
FROM pg_proc p
WHERE p.oid = 'public.product_barcode_scope(uuid)'::regprocedure;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('product_unit_barcodes', 'product_barcode_print_events')
ORDER BY tablename, indexname;

SELECT branch_id, normalized_barcode, count(*) AS active_duplicates
FROM public.product_unit_barcodes
WHERE is_active
GROUP BY branch_id, normalized_barcode
HAVING count(*) > 1;

SELECT product_unit_id, count(*) AS active_primaries
FROM public.product_unit_barcodes
WHERE is_active AND is_primary
GROUP BY product_unit_id
HAVING count(*) > 1;

SELECT count(*) AS orphan_or_scope_mismatch
FROM public.product_unit_barcodes b
LEFT JOIN public.product_units pu
  ON pu.id = b.product_unit_id
 AND pu.product_id = b.product_id
LEFT JOIN public.products p
  ON p.id = b.product_id
 AND p.tenant_id = b.tenant_id
 AND p.branch_id = b.branch_id
WHERE pu.id IS NULL OR p.id IS NULL
  OR pu.tenant_id IS DISTINCT FROM b.tenant_id
  OR pu.branch_id IS DISTINCT FROM b.branch_id;

SELECT count(*) AS malformed_internal_identifiers
FROM public.product_unit_barcodes
WHERE source = 'internal'
  AND (barcode_type <> 'code128' OR normalized_barcode !~ '^DF[0-9A-F]{18}$');

SELECT
  has_table_privilege('authenticated', 'public.product_unit_barcodes', 'SELECT') AS authenticated_table_select,
  has_table_privilege('authenticated', 'public.product_unit_barcodes', 'INSERT') AS authenticated_table_insert,
  has_table_privilege('authenticated', 'public.product_barcode_print_events', 'SELECT') AS authenticated_audit_select,
  has_table_privilege('authenticated', 'public.barcode_function_contracts_v1', 'SELECT') AS authenticated_contract_select,
  has_function_privilege('authenticated', 'public.product_barcode_scope(uuid)', 'EXECUTE') AS authenticated_private_scope_execute,
  has_function_privilege('anon', 'public.resolve_product_unit_barcode(uuid,text)', 'EXECUTE') AS anon_resolve,
  has_function_privilege('authenticated', 'public.resolve_product_unit_barcode(uuid,text)', 'EXECUTE') AS authenticated_resolve,
  has_function_privilege('service_role', 'public.resolve_product_unit_barcode(uuid,text)', 'EXECUTE') AS service_role_resolve;

SELECT
  (SELECT count(*) FROM public.products) AS products,
  (SELECT count(*) FROM public.product_unit_barcodes WHERE source = 'imported') AS migrated_legacy_barcodes,
  (SELECT count(*) FROM public.products WHERE NULLIF(btrim(barcode), '') IS NOT NULL) AS legacy_barcode_products,
  (SELECT count(*) FROM public.product_unit_barcodes WHERE source = 'internal') AS generated_during_migration;

ROLLBACK;
