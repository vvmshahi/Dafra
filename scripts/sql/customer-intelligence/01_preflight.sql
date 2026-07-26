BEGIN TRANSACTION READ ONLY;

SELECT
  current_database() AS database_name,
  current_user AS database_user,
  current_setting('transaction_read_only') AS transaction_read_only;

WITH required_columns(table_name, column_name) AS (
  VALUES
    ('customers', 'id'),
    ('customers', 'tenant_id'),
    ('customers', 'branch_id'),
    ('customers', 'is_active'),
    ('invoices', 'customer_id'),
    ('invoices', 'branch_id'),
    ('invoices', 'invoice_date'),
    ('invoices', 'created_at'),
    ('invoices', 'status'),
    ('invoices', 'zatca_invoice_type'),
    ('invoices', 'total_amount'),
    ('invoice_items', 'product_id'),
    ('invoice_items', 'product_unit_id'),
    ('invoice_items', 'package_quantity'),
    ('invoice_items', 'selling_unit_name')
)
SELECT
  required.table_name,
  required.column_name,
  columns.data_type,
  columns.udt_name,
  columns.is_nullable,
  columns.column_default,
  (columns.column_name IS NOT NULL) AS present
FROM required_columns required
LEFT JOIN information_schema.columns columns
  ON columns.table_schema = 'public'
 AND columns.table_name = required.table_name
 AND columns.column_name = required.column_name
ORDER BY required.table_name, required.column_name;

SELECT
  to_regprocedure('public.reporting_resolve_scope(uuid)') IS NOT NULL
    AS trusted_scope_resolver_present,
  to_regprocedure('public.get_customer_intelligence(jsonb)') IS NULL
    AS detail_rpc_absent,
  to_regprocedure('public.get_customer_intelligence_history(jsonb)') IS NULL
    AS history_rpc_absent,
  to_regprocedure('public.list_customer_intelligence(jsonb)') IS NULL
    AS report_list_rpc_absent,
  to_regclass('public.customer_intelligence_documents_scope_idx') IS NULL
    AS reporting_index_absent;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('customers', 'invoices', 'invoice_items')
ORDER BY tablename, indexname;

SELECT
  p.oid::regprocedure::text AS function_signature,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  p.proacl AS function_acl,
  md5(pg_get_functiondef(p.oid)) AS definition_fingerprint
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.reporting_resolve_scope(uuid)');

SELECT
  grantee,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('customers', 'invoices', 'invoice_items')
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT
  (SELECT count(*) FROM public.customers) AS customer_count,
  (
    SELECT count(*)
    FROM public.invoices
    WHERE status = 'posted'
      AND zatca_invoice_type IN ('simplified', 'standard')
  ) AS qualifying_sales_invoice_count,
  (
    SELECT count(*)
    FROM public.invoices
    WHERE status = 'posted'
      AND zatca_invoice_type = 'credit_note'
  ) AS qualifying_credit_note_count,
  (SELECT count(*) FROM public.invoice_items) AS invoice_item_count;

SELECT
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      c.id, c.tenant_id, c.branch_id, c.name, c.name_ar, c.customer_type,
      c.vat_number, c.is_active, c.created_at, c.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.customers c
  ) AS customer_fingerprint,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
      i.zatca_invoice_type, i.status, i.subtotal, i.tax_amount, i.total_amount,
      i.invoice_date, i.created_at, i.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.invoices i
  ) AS invoice_fingerprint,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      ii.id, ii.invoice_id, ii.tenant_id, ii.product_id, ii.name, ii.name_ar,
      ii.unit, ii.quantity, ii.unit_price, ii.subtotal, ii.tax_amount, ii.total,
      ii.product_unit_id, ii.package_quantity, ii.base_quantity
    )::text, 0)::numeric)::text, '0'))
    FROM public.invoice_items ii
  ) AS invoice_item_fingerprint,
  (
    SELECT md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      cn.id, cn.tenant_id, cn.branch_id, cn.customer_id, cn.invoice_number,
      cn.original_invoice_id, cn.status, cn.subtotal, cn.tax_amount,
      cn.total_amount, cn.invoice_date, cn.created_at, cn.updated_at
    )::text, 0)::numeric)::text, '0'))
    FROM public.invoices cn
    WHERE cn.zatca_invoice_type = 'credit_note'
  ) AS credit_note_fingerprint;

SELECT
  count(*) FILTER (WHERE tenant.id IS NULL) AS customer_tenant_orphans,
  count(*) FILTER (WHERE branch.id IS NULL) AS customer_branch_orphans
FROM public.customers customer
LEFT JOIN public.tenants tenant ON tenant.id = customer.tenant_id
LEFT JOIN public.branches branch
  ON branch.id = customer.branch_id
 AND branch.tenant_id = customer.tenant_id;

SELECT
  count(*) FILTER (WHERE customer.id IS NULL AND invoice.customer_id IS NOT NULL)
    AS invoice_customer_orphans,
  count(*) FILTER (WHERE branch.id IS NULL)
    AS invoice_branch_orphans
FROM public.invoices invoice
LEFT JOIN public.customers customer
  ON customer.id = invoice.customer_id
 AND customer.tenant_id = invoice.tenant_id
LEFT JOIN public.branches branch
  ON branch.id = invoice.branch_id
 AND branch.tenant_id = invoice.tenant_id;

SELECT
  count(*) AS duplicate_invoice_ids
FROM (
  SELECT id
  FROM public.invoices
  GROUP BY id
  HAVING count(*) > 1
) duplicates;

SELECT
  state,
  wait_event_type,
  wait_event,
  count(*) AS session_count
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
GROUP BY state, wait_event_type, wait_event
ORDER BY state, wait_event_type, wait_event;

SELECT
  locktype,
  mode,
  granted,
  count(*) AS lock_count
FROM pg_locks
WHERE relation IN (
  'public.customers'::regclass,
  'public.invoices'::regclass,
  'public.invoice_items'::regclass
)
GROUP BY locktype, mode, granted
ORDER BY locktype, mode, granted;

SELECT
  version
FROM supabase_migrations.schema_migrations
WHERE version = '20260726000400';

ROLLBACK;
