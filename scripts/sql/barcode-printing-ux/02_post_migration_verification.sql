BEGIN TRANSACTION READ ONLY;

SELECT
  to_regclass('public.branch_barcode_label_settings') IS NOT NULL AS settings_table_present,
  to_regprocedure('public.default_barcode_label_settings()') IS NOT NULL AS settings_default_present,
  to_regprocedure('public.validate_barcode_label_settings(jsonb)') IS NOT NULL AS settings_validator_present,
  to_regprocedure('public.barcode_label_settings_scope(uuid)') IS NOT NULL AS settings_scope_present,
  to_regprocedure('public.get_branch_barcode_label_settings(uuid)') IS NOT NULL AS settings_reader_present,
  to_regprocedure('public.update_branch_barcode_label_settings(jsonb)') IS NOT NULL AS settings_writer_present,
  to_regprocedure('public.get_product_barcode_print_status(uuid)') IS NOT NULL AS print_status_present,
  to_regprocedure('public.record_product_barcode_print_batch(jsonb)') IS NOT NULL AS batch_print_present;

SELECT
  c.relname,
  c.relrowsecurity,
  c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'branch_barcode_label_settings';

SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.conrelid = 'public.branch_barcode_label_settings'::regclass
ORDER BY con.conname;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    tablename = 'branch_barcode_label_settings'
    OR indexname = 'branches_id_tenant_id_barcode_settings_uidx'
  )
ORDER BY indexname;

SELECT
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'branch_barcode_label_settings';

SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'branch_barcode_label_settings'
ORDER BY grantee, privilege_type;

SELECT
  p.oid::regprocedure::text AS function_signature,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  EXISTS (
    SELECT 1
    FROM pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute
FROM pg_proc p
WHERE p.oid IN (
  'public.default_barcode_label_settings()'::regprocedure,
  'public.validate_barcode_label_settings(jsonb)'::regprocedure,
  'public.barcode_label_settings_scope(uuid)'::regprocedure,
  'public.get_branch_barcode_label_settings(uuid)'::regprocedure,
  'public.update_branch_barcode_label_settings(jsonb)'::regprocedure,
  'public.get_product_barcode_print_status(uuid)'::regprocedure,
  'public.record_product_barcode_print_batch(jsonb)'::regprocedure
)
ORDER BY 1;

SELECT
  public.validate_barcode_label_settings(
    public.default_barcode_label_settings()
  ) = public.default_barcode_label_settings() AS default_settings_valid;

SELECT
  count(*) AS settings_rows,
  count(*) FILTER (
    WHERE settings <> public.validate_barcode_label_settings(settings)
  ) AS invalid_settings_rows
FROM public.branch_barcode_label_settings;

SELECT
  count(*) AS orphaned_scope_rows
FROM public.branch_barcode_label_settings s
LEFT JOIN public.branches b
  ON b.id = s.branch_id
 AND b.tenant_id = s.tenant_id
WHERE b.id IS NULL;

SELECT
  count(*) AS barcode_rows,
  count(DISTINCT id) AS distinct_barcode_ids
FROM public.product_unit_barcodes;

SELECT
  count(*) AS print_event_rows,
  count(DISTINCT id) AS distinct_print_event_ids
FROM public.product_barcode_print_events;

SELECT
  (SELECT count(*) FROM public.branches) AS branch_count,
  (SELECT count(*) FROM public.branches WHERE presentation_settings IS NOT NULL)
    AS branches_with_presentation_settings,
  (
    SELECT md5(COALESCE(string_agg(
      id::text || ':' || md5(COALESCE(presentation_settings::text, 'null')),
      ',' ORDER BY id
    ), ''))
    FROM public.branches
  ) AS invoice_presentation_fingerprint,
  (SELECT count(*) FROM public.product_unit_barcodes) AS barcode_identity_count,
  (
    SELECT md5(COALESCE(string_agg(
      id::text || ':' || md5(normalized_barcode),
      ',' ORDER BY id
    ), ''))
    FROM public.product_unit_barcodes
  ) AS barcode_identity_fingerprint,
  (SELECT count(*) FROM public.product_barcode_print_events) AS print_event_count,
  (
    SELECT md5(COALESCE(string_agg(
      id::text || ':' || product_unit_barcode_id::text || ':' || print_kind || ':' || copies::text,
      ',' ORDER BY id
    ), ''))
    FROM public.product_barcode_print_events
  ) AS print_event_fingerprint;

ROLLBACK;
