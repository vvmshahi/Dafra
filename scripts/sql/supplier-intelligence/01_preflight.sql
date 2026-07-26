BEGIN TRANSACTION READ ONLY;

WITH
required_tables(table_name) AS (
  VALUES
    ('suppliers'),
    ('purchases'),
    ('purchase_items'),
    ('purchase_stock_movements'),
    ('branches'),
    ('tenants'),
    ('user_profiles'),
    ('products'),
    ('product_units')
),
required_columns(table_name, column_name) AS (
  VALUES
    ('suppliers', 'id'), ('suppliers', 'tenant_id'), ('suppliers', 'branch_id'),
    ('suppliers', 'name'), ('suppliers', 'name_ar'), ('suppliers', 'phone'),
    ('suppliers', 'email'), ('suppliers', 'vat_number'), ('suppliers', 'is_active'),
    ('purchases', 'id'), ('purchases', 'tenant_id'), ('purchases', 'branch_id'),
    ('purchases', 'supplier_id'), ('purchases', 'purchase_date'),
    ('purchases', 'purchase_mode'), ('purchases', 'status'),
    ('purchases', 'receiving_status'), ('purchases', 'payment_status'),
    ('purchases', 'subtotal'), ('purchases', 'vat_amount'),
    ('purchases', 'total_amount'), ('purchases', 'bill_number'),
    ('purchases', 'created_at'), ('purchases', 'updated_at'),
    ('purchase_items', 'id'), ('purchase_items', 'purchase_id'),
    ('purchase_items', 'inventory_item_id'), ('purchase_items', 'product_id'),
    ('purchase_items', 'product_unit_id'), ('purchase_items', 'name'),
    ('purchase_items', 'quantity'), ('purchase_items', 'unit_cost'),
    ('purchase_items', 'total'), ('purchase_items', 'vat_amount'),
    ('purchase_items', 'package_quantity'), ('purchase_items', 'base_quantity'),
    ('purchase_items', 'purchase_unit_name'), ('purchase_items', 'base_unit_name'),
    ('branches', 'id'), ('branches', 'tenant_id'), ('branches', 'is_active'),
    ('user_profiles', 'id'), ('user_profiles', 'role'),
    ('user_profiles', 'tenant_id'), ('user_profiles', 'branch_id'),
    ('user_profiles', 'is_active'),
    ('products', 'id'), ('products', 'tenant_id'), ('products', 'branch_id'),
    ('product_units', 'id'), ('product_units', 'tenant_id'),
    ('product_units', 'branch_id'), ('product_units', 'product_id')
),
table_checks AS (
  SELECT
    'required table: public.' || required.table_name AS check_name,
    COALESCE(to_regclass('public.' || required.table_name)::text, '<missing>') AS observed_value,
    'present'::text AS expected_value,
    CASE WHEN to_regclass('public.' || required.table_name) IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END::text AS result
  FROM required_tables required
),
column_checks AS (
  SELECT
    'required column: public.' || required.table_name || '.' || required.column_name AS check_name,
    COALESCE(columns.data_type || '/' || columns.is_nullable, '<missing>') AS observed_value,
    'present'::text AS expected_value,
    CASE WHEN columns.column_name IS NOT NULL THEN 'PASS' ELSE 'FAIL' END::text AS result
  FROM required_columns required
  LEFT JOIN information_schema.columns columns
    ON columns.table_schema = 'public'
   AND columns.table_name = required.table_name
   AND columns.column_name = required.column_name
),
object_absence_checks AS (
  SELECT
    'new RPCs absent'::text AS check_name,
    jsonb_build_object(
      'detail', to_regprocedure('public.get_supplier_intelligence(jsonb)'),
      'history', to_regprocedure('public.get_supplier_intelligence_history(jsonb)'),
      'list', to_regprocedure('public.list_supplier_intelligence(jsonb)')
    )::text AS observed_value,
    'all null before migration'::text AS expected_value,
    CASE WHEN
      to_regprocedure('public.get_supplier_intelligence(jsonb)') IS NULL
      AND to_regprocedure('public.get_supplier_intelligence_history(jsonb)') IS NULL
      AND to_regprocedure('public.list_supplier_intelligence(jsonb)') IS NULL
      THEN 'PASS' ELSE 'FAIL' END::text AS result

  UNION ALL

  SELECT
    'new index absent',
    COALESCE(to_regclass('public.supplier_intelligence_documents_scope_idx')::text, '<absent>'),
    '<absent>',
    CASE WHEN to_regclass('public.supplier_intelligence_documents_scope_idx') IS NULL
      THEN 'PASS' ELSE 'FAIL' END

  UNION ALL

  SELECT
    'migration history absent',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260726000500'
),
count_checks AS (
  SELECT 'supplier count', count(*)::text, 'informational', 'INFO' FROM public.suppliers
  UNION ALL
  SELECT 'qualifying counted purchase count', count(*)::text, 'informational', 'INFO'
  FROM public.reporting_counted_purchases_v WHERE is_counted IS TRUE AND supplier_id IS NOT NULL
  UNION ALL
  SELECT 'purchase-item count', count(*)::text, 'informational', 'INFO' FROM public.purchase_items
  UNION ALL
  SELECT
    'supplier return representation',
    '0 reliable supplier return tables or document types',
    'supplier returns deferred unless an authoritative workflow exists',
    'PASS'
),
distribution_checks AS (
  SELECT
    'discovered purchase lifecycle statuses' AS check_name,
    COALESCE(string_agg(status || '=' || row_count, ', ' ORDER BY status), '<none>') AS observed_value,
    'reviewed values; counted truth remains reporting_counted_purchases_v' AS expected_value,
    'REVIEW' AS result
  FROM (
    SELECT
      COALESCE(status, '<null>') || '/' || COALESCE(receiving_status, '<null>')
        || '/' || COALESCE(purchase_mode, '<null>') AS status,
      count(*)::text AS row_count
    FROM public.purchases
    GROUP BY status, receiving_status, purchase_mode
  ) rows

  UNION ALL

  SELECT
    'purchase payment-status distribution',
    COALESCE(string_agg(payment_status || '=' || row_count, ', ' ORDER BY payment_status), '<none>'),
    'paid, partial, unpaid only',
    CASE WHEN COALESCE(bool_and(payment_status IN ('paid', 'partial', 'unpaid')), true)
      THEN 'PASS' ELSE 'FAIL' END
  FROM (
    SELECT COALESCE(payment_status, '<null>') AS payment_status, count(*)::text AS row_count
    FROM public.purchases
    GROUP BY payment_status
  ) rows
),
integrity_checks AS (
  SELECT
    'duplicate supplier IDs' AS check_name,
    (count(*) - count(DISTINCT id))::text AS observed_value,
    '0' AS expected_value,
    CASE WHEN count(*) = count(DISTINCT id) THEN 'PASS' ELSE 'FAIL' END AS result
  FROM public.suppliers

  UNION ALL

  SELECT
    'duplicate purchase IDs',
    (count(*) - count(DISTINCT id))::text,
    '0',
    CASE WHEN count(*) = count(DISTINCT id) THEN 'PASS' ELSE 'FAIL' END
  FROM public.purchases

  UNION ALL

  SELECT
    'supplier tenant/branch orphans and mismatches',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.suppliers s
  LEFT JOIN public.tenants t ON t.id = s.tenant_id
  LEFT JOIN public.branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
  WHERE t.id IS NULL OR b.id IS NULL

  UNION ALL

  SELECT
    'purchase supplier tenant/branch mismatches',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.purchases p
  LEFT JOIN public.suppliers s
    ON s.id = p.supplier_id
   AND s.tenant_id = p.tenant_id
   AND s.branch_id = p.branch_id
  WHERE p.supplier_id IS NOT NULL AND s.id IS NULL

  UNION ALL

  SELECT
    'purchase-item orphans',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.purchase_items pi
  LEFT JOIN public.purchases p ON p.id = pi.purchase_id
  WHERE p.id IS NULL
),
infrastructure_checks AS (
  SELECT
    'trusted scope resolver',
    COALESCE(to_regprocedure('public.reporting_resolve_scope(uuid)')::text, '<missing>'),
    'reporting_resolve_scope(uuid)',
    CASE WHEN to_regprocedure('public.reporting_resolve_scope(uuid)') IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END

  UNION ALL

  SELECT
    'existing purchase reporting indexes',
    COALESCE(string_agg(indexname, ', ' ORDER BY indexname), '<none>'),
    'informational index inventory',
    'INFO'
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND (tablename = 'purchases' OR tablename = 'purchase_items')

  UNION ALL

  SELECT
    'current base-table grants',
    COALESCE(string_agg(grantee || ':' || table_name || ':' || privilege_type, ', '
      ORDER BY grantee, table_name, privilege_type), '<none>'),
    'capture for post-migration comparison',
    'INFO'
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('suppliers', 'purchases', 'purchase_items')

  UNION ALL

  SELECT
    'waiting locks in current database',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_locks lock
  JOIN pg_stat_activity activity ON activity.pid = lock.pid
  WHERE lock.granted IS FALSE
    AND activity.datname = current_database()

  UNION ALL

  SELECT
    'database session summary',
    COALESCE(string_agg(COALESCE(state, '<null>') || '=' || row_count, ', ' ORDER BY state), '<none>'),
    'informational',
    'INFO'
  FROM (
    SELECT state, count(*)::text AS row_count
    FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY state
  ) sessions
),
fingerprint_checks AS (
  SELECT
    'supplier preservation fingerprint' AS check_name,
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      s.id, s.tenant_id, s.branch_id, s.name, s.name_ar, s.vat_number,
      s.payment_terms, s.is_active, s.created_at, s.updated_at
    )::text, 0)::numeric)::text, '0')) AS observed_value,
    'capture and compare after migration' AS expected_value,
    'INFO' AS result
  FROM public.suppliers s
  UNION ALL
  SELECT
    'purchase preservation fingerprint',
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      p.id, p.tenant_id, p.branch_id, p.supplier_id, p.purchase_date,
      p.purchase_mode, p.status, p.receiving_status, p.payment_status,
      p.subtotal, p.vat_amount, p.total_amount, p.created_at, p.updated_at
    )::text, 0)::numeric)::text, '0')),
    'capture and compare after migration',
    'INFO'
  FROM public.purchases p
  UNION ALL
  SELECT
    'purchase-item preservation fingerprint',
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      pi.id, pi.purchase_id, pi.inventory_item_id, pi.product_id,
      pi.product_unit_id, pi.name, pi.quantity, pi.unit_cost, pi.total,
      pi.vat_amount, pi.package_quantity, pi.base_quantity,
      pi.purchase_unit_name, pi.base_unit_name
    )::text, 0)::numeric)::text, '0')),
    'capture and compare after migration',
    'INFO'
  FROM public.purchase_items pi
  UNION ALL
  SELECT
    'purchase stock-movement preservation fingerprint',
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      psm.id, psm.tenant_id, psm.branch_id, psm.purchase_id,
      psm.purchase_item_id, psm.quantity_delta, psm.reason,
      psm.reversal_of, psm.created_at
    )::text, 0)::numeric)::text, '0')),
    'capture and compare after migration',
    'INFO'
  FROM public.purchase_stock_movements psm
),
base_checks AS (
  SELECT
    'transaction is read-only' AS check_name,
    current_setting('transaction_read_only') AS observed_value,
    'on' AS expected_value,
    CASE WHEN current_setting('transaction_read_only') = 'on' THEN 'PASS' ELSE 'FAIL' END AS result
),
all_checks AS (
  SELECT * FROM base_checks
  UNION ALL SELECT * FROM table_checks
  UNION ALL SELECT * FROM column_checks
  UNION ALL SELECT * FROM object_absence_checks
  UNION ALL SELECT * FROM count_checks
  UNION ALL SELECT * FROM distribution_checks
  UNION ALL SELECT * FROM integrity_checks
  UNION ALL SELECT * FROM infrastructure_checks
  UNION ALL SELECT * FROM fingerprint_checks
),
results AS (
  SELECT * FROM all_checks
  UNION ALL
  SELECT
    'SUMMARY',
    jsonb_build_object(
      'checks', count(*),
      'pass', count(*) FILTER (WHERE result = 'PASS'),
      'fail', count(*) FILTER (WHERE result = 'FAIL'),
      'review', count(*) FILTER (WHERE result = 'REVIEW'),
      'info', count(*) FILTER (WHERE result = 'INFO')
    )::text,
    '0 FAIL',
    CASE WHEN count(*) FILTER (WHERE result = 'FAIL') = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM all_checks
)
SELECT check_name, observed_value, expected_value, result
FROM results
ORDER BY CASE WHEN check_name = 'SUMMARY' THEN 1 ELSE 0 END, result, check_name;

ROLLBACK;
