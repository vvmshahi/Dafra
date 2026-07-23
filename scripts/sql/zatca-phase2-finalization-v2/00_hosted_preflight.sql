-- ZATCA Phase 2 immutable finalization v2
-- 00_hosted_preflight.sql
-- READ ONLY. Capture and review this output before executing 01-06.
-- Intended for psql because conditional reporting uses \gset and \if.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS executing_role,
  clock_timestamp() AS captured_at,
  current_setting('server_version') AS postgres_version;

-- Exact policy contract inputs used by 04_lock_compliance_fields.sql.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'invoices'
ORDER BY policyname;

-- Expected before 04: no browser table UPDATE grant and either no protected
-- column UPDATE grant or authenticated UPDATE(zatca_qr_code) only.
SELECT grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'invoices'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT grantee, column_name, privilege_type, is_grantable
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name = 'invoices'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, column_name, privilege_type;

-- Effective privileges, including grants inherited through roles or PUBLIC.
-- The reviewed pre-04a state is authenticated table SELECT=true, anon=false,
-- service_role=true. A rerun after 04a has authenticated table SELECT=false.
SELECT
  role_name,
  has_table_privilege(role_name, 'public.invoices', 'SELECT') AS effective_table_select
FROM unnest(ARRAY['anon', 'authenticated', 'service_role']::text[]) role_name
ORDER BY role_name;

WITH safe_columns(column_name) AS (
  SELECT unnest(ARRAY[
    'id', 'tenant_id', 'branch_id', 'customer_id', 'created_by',
    'invoice_number', 'invoice_reference', 'zatca_invoice_type',
    'zatca_status', 'zatca_submitted_at', 'subtotal', 'discount_amount',
    'taxable_amount', 'tax_amount', 'total_amount', 'currency_code',
    'invoice_date', 'supply_date', 'due_date', 'status', 'payment_status',
    'notes', 'notes_ar', 'cancelled_at', 'cancellation_reason',
    'created_at', 'updated_at', 'session_id', 'payment_method',
    'original_invoice_id', 'credit_reason', 'document_language'
  ]::text[])
), roles(role_name) AS (
  SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']::text[])
)
SELECT
  'safe'::text AS contract_class,
  c.column_name,
  a.attname IS NOT NULL AS column_exists,
  r.role_name,
  CASE WHEN a.attname IS NULL THEN NULL ELSE
    has_column_privilege(r.role_name, 'public.invoices', c.column_name, 'SELECT')
  END AS effective_column_select
FROM safe_columns c
CROSS JOIN roles r
LEFT JOIN pg_attribute a
  ON a.attrelid = 'public.invoices'::regclass
 AND a.attname = c.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
ORDER BY c.column_name, r.role_name;

WITH server_only_columns(column_name) AS (
  SELECT unnest(ARRAY[
    'zatca_uuid', 'zatca_type_code', 'zatca_counter_number',
    'zatca_prev_invoice_hash', 'zatca_xml', 'zatca_xml_hash',
    'zatca_signature', 'zatca_qr_code', 'zatca_submission_id',
    'zatca_clearance_status', 'zatca_clearance_response',
    'zatca_reporting_response', 'zatca_warnings',
    'checkout_idempotency_key', 'credit_note_idempotency_key',
    'zatca_finalization_version', 'zatca_artifact_provenance',
    'zatca_document_kind', 'zatca_lifecycle_state', 'zatca_artifact_stage',
    'zatca_finalized_at_v2', 'zatca_finalization_error_v2',
    'zatca_simplified_xml', 'zatca_simplified_xml_hash',
    'zatca_simplified_signature', 'zatca_simplified_qr',
    'zatca_provisional_xml', 'zatca_provisional_xml_hash',
    'zatca_provisional_signature', 'zatca_provisional_qr',
    'zatca_cleared_xml', 'zatca_cleared_xml_hash',
    'zatca_cleared_signature', 'zatca_cleared_qr',
    'zatca_clearance_metadata_v2', 'zatca_network_response_v2',
    'zatca_finalization_claim_token_v2', 'zatca_finalization_claimed_at_v2',
    'zatca_finalization_lease_expires_at_v2', 'zatca_finalization_claimed_by_v2',
    'zatca_finalization_attempt_v2', 'zatca_network_claim_token_v2',
    'zatca_network_claimed_at_v2', 'zatca_network_lease_expires_at_v2',
    'zatca_network_claimed_by_v2', 'zatca_network_operation_v2',
    'zatca_network_attempt_v2', 'zatca_network_idempotency_key_v2',
    'zatca_network_request_hash_v2', 'zatca_network_request_started_at_v2',
    'zatca_network_ack_state_v2', 'zatca_reconciliation_reason_v2'
  ]::text[])
), roles(role_name) AS (
  SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']::text[])
)
SELECT
  'server_only'::text AS contract_class,
  c.column_name,
  a.attname IS NOT NULL AS column_exists,
  r.role_name,
  CASE WHEN a.attname IS NULL THEN NULL ELSE
    has_column_privilege(r.role_name, 'public.invoices', c.column_name, 'SELECT')
  END AS effective_column_select
FROM server_only_columns c
CROSS JOIN roles r
LEFT JOIN pg_attribute a
  ON a.attrelid = 'public.invoices'::regclass
 AND a.attname = c.column_name
 AND a.attnum > 0
 AND NOT a.attisdropped
ORDER BY c.column_name, r.role_name;

SELECT
  'authenticated_invoice_source_audit'::text AS review_item,
  'REVIEW'::text AS result,
  'Repository audit must prove no authenticated invoices select(*) and no direct server-only column selectors.'::text AS required_evidence;

SELECT
  t.tgname AS trigger_name,
  CASE t.tgenabled
    WHEN 'O' THEN 'enabled'
    WHEN 'D' THEN 'disabled'
    WHEN 'R' THEN 'replica'
    WHEN 'A' THEN 'always'
    ELSE t.tgenabled::text
  END AS enabled_state,
  t.tgfoid::regprocedure AS function_signature,
  pg_get_triggerdef(t.oid, true) AS trigger_definition
FROM pg_trigger t
WHERE t.tgrelid = 'public.invoices'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Protected definitions must match the reviewed release values before any DDL.
WITH expected(signature, expected_hash) AS (
  VALUES
    ('public.pos_checkout(jsonb)', 'bdc4ee5a02be05aa8b1d7378ebb84c0f'),
    ('public.snapshot_invoice_document_language()', '7f9b093d4a68d315868dadc9ce1f2c58')
)
SELECT
  e.signature,
  e.expected_hash,
  CASE WHEN p.oid IS NULL THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END AS observed_hash,
  CASE
    WHEN p.oid IS NULL THEN 'MISSING'
    WHEN md5(pg_get_functiondef(p.oid)) = e.expected_hash THEN 'MATCH'
    ELSE 'DRIFT'
  END AS review_result,
  CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_functiondef(p.oid) END AS hosted_definition
FROM expected e
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
ORDER BY e.signature;

-- Report any partial or previous v2 installation without assuming it is valid.
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname LIKE 'zatca%v2%'
ORDER BY c.relname;

SELECT p.oid::regprocedure AS function_signature,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  md5(pg_get_functiondef(p.oid)) AS definition_hash
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE '%zatca%v2%'
ORDER BY p.oid::regprocedure::text;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invoices'
  AND (
    column_name LIKE 'zatca%v2'
    OR column_name IN (
      'zatca_finalization_version', 'zatca_artifact_provenance',
      'zatca_document_kind', 'zatca_lifecycle_state', 'zatca_artifact_stage',
      'zatca_simplified_xml', 'zatca_simplified_xml_hash',
      'zatca_simplified_signature', 'zatca_simplified_qr',
      'zatca_provisional_xml', 'zatca_provisional_xml_hash',
      'zatca_provisional_signature', 'zatca_provisional_qr',
      'zatca_cleared_xml', 'zatca_cleared_xml_hash',
      'zatca_cleared_signature', 'zatca_cleared_qr'
    )
  )
ORDER BY ordinal_position;

SELECT CASE WHEN to_regclass('public.zatca_finalization_runtime') IS NULL
  THEN 'false' ELSE 'true' END AS runtime_table_exists \gset
SELECT CASE WHEN count(*) = 7 THEN 'true' ELSE 'false' END AS runtime_shape_ok
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'zatca_finalization_runtime'
  AND column_name IN (
    'singleton', 'immutable_finalization_enabled', 'simplified_enabled',
    'standard_enabled', 'schema_version', 'minimum_edge_version',
    'minimum_client_version'
  ) \gset

\if :runtime_table_exists
\if :runtime_shape_ok
SELECT
  count(*) AS runtime_row_count,
  count(*) FILTER (WHERE singleton = true) AS singleton_true_count,
  bool_or(immutable_finalization_enabled) AS immutable_finalization_enabled,
  bool_or(simplified_enabled) AS simplified_enabled,
  bool_or(standard_enabled) AS standard_enabled,
  min(schema_version) AS minimum_schema_version,
  max(schema_version) AS maximum_schema_version,
  min(minimum_edge_version) AS minimum_edge_version,
  min(minimum_client_version) AS minimum_client_version
FROM public.zatca_finalization_runtime;
\else
SELECT
  'INVALID_SHAPE'::text AS runtime_table_state,
  'Stop: the existing runtime table does not have the reviewed v2 columns.'::text AS required_review;
\endif
\else
SELECT
  'MISSING'::text AS runtime_table_state,
  'Schema may be fresh; after 01 there must be exactly one all-false singleton row.'::text AS required_review;
\endif

-- This fingerprint is a review marker, not a write lock. Capture it again after
-- migration and explain any concurrent application changes before proceeding.
SELECT
  count(*) AS invoice_count,
  min(created_at) AS oldest_invoice_created_at,
  max(created_at) AS newest_invoice_created_at,
  max(updated_at) AS latest_invoice_updated_at,
  md5(COALESCE(string_agg(
    id::text || ':' || COALESCE(updated_at::text, ''), ',' ORDER BY id
  ), '')) AS invoice_id_update_fingerprint
FROM public.invoices;

ROLLBACK;
