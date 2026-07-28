BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS database_user,
  current_setting('transaction_read_only') AS transaction_read_only;

SELECT
  to_regclass('public.product_unit_barcodes') IS NOT NULL AS barcode_registry_present,
  to_regclass('public.product_barcode_print_events') IS NOT NULL AS print_events_present,
  to_regprocedure('public.record_product_barcode_print(jsonb)') IS NOT NULL AS print_rpc_present,
  to_regprocedure('public.list_product_unit_barcodes(uuid)') IS NOT NULL AS list_rpc_present,
  to_regclass('public.branch_barcode_label_settings') IS NULL AS settings_table_absent,
  to_regclass('public.branches_id_tenant_id_barcode_settings_uidx') IS NULL AS settings_scope_index_absent,
  to_regprocedure('public.default_barcode_label_settings()') IS NULL AS settings_default_absent,
  to_regprocedure('public.validate_barcode_label_settings(jsonb)') IS NULL AS settings_validator_absent,
  to_regprocedure('public.barcode_label_settings_scope(uuid)') IS NULL AS settings_scope_absent,
  to_regprocedure('public.get_branch_barcode_label_settings(uuid)') IS NULL AS settings_reader_absent,
  to_regprocedure('public.update_branch_barcode_label_settings(jsonb)') IS NULL AS settings_writer_absent,
  to_regprocedure('public.get_product_barcode_print_status(uuid)') IS NULL AS print_status_absent,
  to_regprocedure('public.record_product_barcode_print_batch(jsonb)') IS NULL AS batch_rpc_absent;

SELECT
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'branches'
      AND column_name = 'presentation_settings'
      AND data_type = 'jsonb'
  ) AS invoice_presentation_settings_model_present;

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

SELECT
  p.oid::regprocedure::text AS function_signature,
  md5(pg_get_functiondef(p.oid)) AS definition_md5,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config
FROM pg_proc p
WHERE p.oid IN (
  to_regprocedure('public.record_product_barcode_print(jsonb)'),
  to_regprocedure('public.list_product_unit_barcodes(uuid)')
)
ORDER BY 1;

SELECT
  grantee,
  privilege_type
FROM information_schema.role_routine_grants
WHERE specific_schema = 'public'
  AND routine_name IN (
    'record_product_barcode_print',
    'list_product_unit_barcodes'
  )
ORDER BY routine_name, grantee, privilege_type;

SELECT
  version
FROM supabase_migrations.schema_migrations
WHERE version = '20260726000300';

SELECT
  locktype,
  mode,
  granted,
  count(*) AS lock_count
FROM pg_locks
WHERE relation IN (
  'public.branches'::regclass,
  'public.product_unit_barcodes'::regclass,
  'public.product_barcode_print_events'::regclass
)
GROUP BY locktype, mode, granted
ORDER BY locktype, mode, granted;

SELECT
  state,
  wait_event_type,
  wait_event,
  count(*) AS sessions
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
GROUP BY state, wait_event_type, wait_event
ORDER BY state, wait_event_type, wait_event;

ROLLBACK;
