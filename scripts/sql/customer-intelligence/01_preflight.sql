BEGIN TRANSACTION READ ONLY;

WITH
required_tables(table_name) AS (
  VALUES
    ('customers'),
    ('invoices'),
    ('invoice_items'),
    ('branches'),
    ('tenants'),
    ('user_profiles'),
    ('products'),
    ('product_units')
),
required_columns(table_name, column_name) AS (
  VALUES
    ('customers', 'id'),
    ('customers', 'tenant_id'),
    ('customers', 'branch_id'),
    ('customers', 'name'),
    ('customers', 'name_ar'),
    ('customers', 'customer_type'),
    ('customers', 'business_name'),
    ('customers', 'business_name_ar'),
    ('customers', 'company_name'),
    ('customers', 'phone'),
    ('customers', 'email'),
    ('customers', 'vat_number'),
    ('customers', 'is_active'),
    ('customers', 'created_at'),
    ('customers', 'updated_at'),
    ('invoices', 'id'),
    ('invoices', 'tenant_id'),
    ('invoices', 'branch_id'),
    ('invoices', 'customer_id'),
    ('invoices', 'invoice_number'),
    ('invoices', 'invoice_date'),
    ('invoices', 'created_at'),
    ('invoices', 'updated_at'),
    ('invoices', 'status'),
    ('invoices', 'zatca_status'),
    ('invoices', 'zatca_invoice_type'),
    ('invoices', 'subtotal'),
    ('invoices', 'tax_amount'),
    ('invoices', 'total_amount'),
    ('invoices', 'original_invoice_id'),
    ('invoice_items', 'id'),
    ('invoice_items', 'invoice_id'),
    ('invoice_items', 'tenant_id'),
    ('invoice_items', 'product_id'),
    ('invoice_items', 'product_unit_id'),
    ('invoice_items', 'name'),
    ('invoice_items', 'name_ar'),
    ('invoice_items', 'unit'),
    ('invoice_items', 'selling_unit_name'),
    ('invoice_items', 'selling_unit_name_ar'),
    ('invoice_items', 'selling_unit_code'),
    ('invoice_items', 'quantity'),
    ('invoice_items', 'package_quantity'),
    ('invoice_items', 'base_quantity'),
    ('invoice_items', 'unit_price'),
    ('invoice_items', 'subtotal'),
    ('invoice_items', 'tax_amount'),
    ('invoice_items', 'total'),
    ('branches', 'id'),
    ('branches', 'tenant_id'),
    ('branches', 'name'),
    ('branches', 'name_ar'),
    ('branches', 'is_active'),
    ('tenants', 'id'),
    ('user_profiles', 'id'),
    ('user_profiles', 'role'),
    ('user_profiles', 'tenant_id'),
    ('user_profiles', 'branch_id'),
    ('user_profiles', 'is_active'),
    ('products', 'id'),
    ('products', 'tenant_id'),
    ('products', 'branch_id'),
    ('product_units', 'id'),
    ('product_units', 'tenant_id'),
    ('product_units', 'branch_id'),
    ('product_units', 'product_id')
),
table_observations AS (
  SELECT
    required.table_name,
    relation.oid AS relation_oid,
    relation.relkind,
    relation.relkind IN ('r', 'p') AS is_table
  FROM required_tables required
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', required.table_name))
),
column_observations AS (
  SELECT
    required.table_name,
    required.column_name,
    columns.data_type,
    columns.udt_name,
    columns.is_nullable,
    columns.column_default,
    columns.column_name IS NOT NULL AS present
  FROM required_columns required
  LEFT JOIN information_schema.columns columns
    ON columns.table_schema = 'public'
   AND columns.table_name = required.table_name
   AND columns.column_name = required.column_name
),
schema_readiness AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM table_observations
      WHERE is_table IS NOT TRUE
    )
    AND NOT EXISTS (
      SELECT 1
      FROM column_observations
      WHERE present IS NOT TRUE
    ) AS ready
),
transaction_check AS (
  SELECT
    'transaction is read-only'::text AS check_name,
    current_setting('transaction_read_only')::text AS observed_value,
    'on'::text AS expected_value,
    CASE
      WHEN current_setting('transaction_read_only') = 'on' THEN 'PASS'
      ELSE 'FAIL'
    END::text AS result
),
table_checks AS (
  SELECT
    'required table: public.' || table_name AS check_name,
    CASE
      WHEN relation_oid IS NULL THEN '<missing>'
      ELSE jsonb_build_object('oid', relation_oid, 'relkind', relkind)::text
    END AS observed_value,
    'ordinary or partitioned table' AS expected_value,
    CASE WHEN is_table THEN 'PASS' ELSE 'FAIL' END AS result
  FROM table_observations
),
column_checks AS (
  SELECT
    'required column: public.' || table_name || '.' || column_name AS check_name,
    CASE
      WHEN present THEN jsonb_build_object(
        'dataType', data_type,
        'udtName', udt_name,
        'nullable', is_nullable,
        'default', column_default
      )::text
      ELSE '<missing>'
    END AS observed_value,
    'present' AS expected_value,
    CASE WHEN present THEN 'PASS' ELSE 'FAIL' END AS result
  FROM column_observations
),
new_object_expectations(check_name, object_kind, object_name, object_oid) AS (
  VALUES
    (
      'new object absent: get_customer_intelligence(jsonb) [detail_rpc_absent]',
      'function',
      'public.get_customer_intelligence(jsonb)',
      to_regprocedure('public.get_customer_intelligence(jsonb)')::oid
    ),
    (
      'new object absent: get_customer_intelligence_history(jsonb)',
      'function',
      'public.get_customer_intelligence_history(jsonb)',
      to_regprocedure('public.get_customer_intelligence_history(jsonb)')::oid
    ),
    (
      'new object absent: list_customer_intelligence(jsonb)',
      'function',
      'public.list_customer_intelligence(jsonb)',
      to_regprocedure('public.list_customer_intelligence(jsonb)')::oid
    ),
    (
      'new object absent: customer intelligence reporting index',
      'index',
      'public.customer_intelligence_documents_scope_idx',
      to_regclass('public.customer_intelligence_documents_scope_idx')::oid
    )
),
new_object_checks AS (
  SELECT
    check_name,
    CASE
      WHEN object_oid IS NULL THEN '<absent>'
      ELSE object_kind || ' oid=' || object_oid::text
    END AS observed_value,
    'absent before migration' AS expected_value,
    CASE WHEN object_oid IS NULL THEN 'PASS' ELSE 'FAIL' END AS result
  FROM new_object_expectations
),
migration_history_query AS (
  SELECT
    'migration history: 20260726000400 is absent'::text AS check_name,
    $sql$
      SELECT count(*)::text AS preflight_value
      FROM supabase_migrations.schema_migrations
      WHERE version = '20260726000400'
    $sql$::text AS query_text,
    to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ready,
    '0'::text AS expected_value,
    'FAIL_NONZERO'::text AS result_mode
),
data_queries(check_name, query_text, expected_value, result_mode) AS (
  VALUES
    (
      'count: customers',
      $sql$SELECT count(*)::text AS preflight_value FROM public.customers$sql$,
      'informational baseline',
      'INFO'
    ),
    (
      'count: invoices',
      $sql$SELECT count(*)::text AS preflight_value FROM public.invoices$sql$,
      'informational baseline',
      'INFO'
    ),
    (
      'count: qualifying posted sales [qualifying_sales_invoice_count]',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices
        WHERE status = 'posted'
          AND zatca_invoice_type IN ('simplified', 'standard')
      $sql$,
      'at least one where commercial history exists',
      'REVIEW_ZERO'
    ),
    (
      'count: qualifying posted credit notes [qualifying_credit_note_count]',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices
        WHERE status = 'posted'
          AND zatca_invoice_type = 'credit_note'
      $sql$,
      'at least one where credit-note history exists',
      'REVIEW_ZERO'
    ),
    (
      'count: invoice items',
      $sql$SELECT count(*)::text AS preflight_value FROM public.invoice_items$sql$,
      'informational baseline',
      'INFO'
    ),
    (
      'count: branches',
      $sql$SELECT count(*)::text AS preflight_value FROM public.branches$sql$,
      'informational baseline',
      'INFO'
    ),
    (
      'document state: draft or cancelled rows are distinguishable',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices
        WHERE status IN ('draft', 'cancelled')
      $sql$,
      'at least one row when non-commercial examples exist',
      'REVIEW_ZERO'
    ),
    (
      'document state inventory',
      $sql$
        SELECT COALESCE(
          string_agg(status::text || '=' || row_count::text, ', ' ORDER BY status::text),
          '<none>'
        ) AS preflight_value
        FROM (
          SELECT status, count(*) AS row_count
          FROM public.invoices
          GROUP BY status
        ) states
      $sql$,
      'informational status distribution',
      'INFO'
    ),
    (
      'integrity: invoices with missing customers',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices invoice
        LEFT JOIN public.customers customer
          ON customer.id = invoice.customer_id
        WHERE invoice.customer_id IS NOT NULL
          AND customer.id IS NULL
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: invoice items with missing invoices',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoice_items item
        LEFT JOIN public.invoices invoice ON invoice.id = item.invoice_id
        WHERE invoice.id IS NULL
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: customer and invoice tenant mismatch',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices invoice
        JOIN public.customers customer ON customer.id = invoice.customer_id
        WHERE invoice.tenant_id IS DISTINCT FROM customer.tenant_id
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: customer and invoice branch mismatch',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices invoice
        JOIN public.customers customer ON customer.id = invoice.customer_id
        WHERE invoice.branch_id IS DISTINCT FROM customer.branch_id
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: invoice item and invoice tenant mismatch',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoice_items item
        JOIN public.invoices invoice ON invoice.id = item.invoice_id
        WHERE item.tenant_id IS DISTINCT FROM invoice.tenant_id
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: customers with invalid tenant or branch scope',
      $sql$
        SELECT (
          count(*) FILTER (WHERE tenant.id IS NULL)
          + count(*) FILTER (WHERE branch.id IS NULL)
        )::text AS preflight_value
        FROM public.customers customer
        LEFT JOIN public.tenants tenant ON tenant.id = customer.tenant_id
        LEFT JOIN public.branches branch
          ON branch.id = customer.branch_id
         AND branch.tenant_id = customer.tenant_id
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: orphaned product-unit references',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoice_items item
        LEFT JOIN public.product_units unit ON unit.id = item.product_unit_id
        WHERE item.product_unit_id IS NOT NULL
          AND unit.id IS NULL
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: product-unit and product mismatch',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoice_items item
        JOIN public.product_units unit ON unit.id = item.product_unit_id
        WHERE item.product_unit_id IS NOT NULL
          AND item.product_id IS DISTINCT FROM unit.product_id
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: duplicate customer identifiers',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM (
          SELECT id FROM public.customers GROUP BY id HAVING count(*) > 1
        ) duplicates
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: duplicate invoice identifiers',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM (
          SELECT id FROM public.invoices GROUP BY id HAVING count(*) > 1
        ) duplicates
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: duplicate invoice-item identifiers',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM (
          SELECT id FROM public.invoice_items GROUP BY id HAVING count(*) > 1
        ) duplicates
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'integrity: duplicate product-unit identifiers',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM (
          SELECT id FROM public.product_units GROUP BY id HAVING count(*) > 1
        ) duplicates
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'data quality: unsupported invoice statuses',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices
        WHERE status::text NOT IN ('draft', 'posted', 'cancelled')
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'data quality: qualifying documents missing required date or amount',
      $sql$
        SELECT count(*)::text AS preflight_value
        FROM public.invoices
        WHERE status = 'posted'
          AND zatca_invoice_type IN ('simplified', 'standard', 'credit_note')
          AND (
            invoice_date IS NULL
            OR created_at IS NULL
            OR total_amount IS NULL
          )
      $sql$,
      '0',
      'FAIL_NONZERO'
    ),
    (
      'data quality: invoice date range',
      $sql$
        SELECT jsonb_build_object(
          'minimum', min(invoice_date),
          'maximum', max(invoice_date),
          'nullCount', count(*) FILTER (WHERE invoice_date IS NULL)
        )::text AS preflight_value
        FROM public.invoices
      $sql$,
      'informational date baseline',
      'INFO'
    ),
    (
      'preservation fingerprint: customers',
      $sql$
        SELECT jsonb_build_object(
          'verification', md5(COALESCE(sum(hashtextextended(jsonb_build_array(
            c.id, c.tenant_id, c.branch_id, c.name, c.name_ar, c.customer_type,
            c.vat_number, c.is_active, c.created_at, c.updated_at
          )::text, 0)::numeric)::text, '0')),
          'ordered', md5(COALESCE(string_agg(
            md5(jsonb_build_array(
              c.id, c.tenant_id, c.branch_id, c.name, c.name_ar, c.customer_type,
              c.vat_number, c.is_active, c.created_at, c.updated_at
            )::text),
            ',' ORDER BY c.id
          ), ''))
        )::text AS preflight_value
        FROM public.customers c
      $sql$,
      'verification must match post-migration output and ordered is an additional deterministic baseline',
      'INFO'
    ),
    (
      'preservation fingerprint: invoices',
      $sql$
        SELECT jsonb_build_object(
          'verification', md5(COALESCE(sum(hashtextextended(jsonb_build_array(
            i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
            i.zatca_invoice_type, i.status, i.subtotal, i.tax_amount,
            i.total_amount, i.invoice_date, i.created_at, i.updated_at
          )::text, 0)::numeric)::text, '0')),
          'ordered', md5(COALESCE(string_agg(
            md5(jsonb_build_array(
              i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
              i.zatca_invoice_type, i.status, i.subtotal, i.tax_amount,
              i.total_amount, i.invoice_date, i.created_at, i.updated_at
            )::text),
            ',' ORDER BY i.id
          ), ''))
        )::text AS preflight_value
        FROM public.invoices i
      $sql$,
      'verification must match post-migration output and ordered is an additional deterministic baseline',
      'INFO'
    ),
    (
      'preservation fingerprint: invoice_items',
      $sql$
        SELECT jsonb_build_object(
          'verification', md5(COALESCE(sum(hashtextextended(jsonb_build_array(
            item.id, item.invoice_id, item.tenant_id, item.product_id,
            item.name, item.name_ar, item.unit, item.quantity, item.unit_price,
            item.subtotal, item.tax_amount, item.total, item.product_unit_id,
            item.package_quantity, item.base_quantity
          )::text, 0)::numeric)::text, '0')),
          'ordered', md5(COALESCE(string_agg(
            md5(jsonb_build_array(
              item.id, item.invoice_id, item.tenant_id, item.product_id,
              item.name, item.name_ar, item.unit, item.quantity, item.unit_price,
              item.subtotal, item.tax_amount, item.total, item.product_unit_id,
              item.package_quantity, item.base_quantity
            )::text),
            ',' ORDER BY item.id
          ), ''))
        )::text AS preflight_value
        FROM public.invoice_items item
      $sql$,
      'verification must match post-migration output and ordered is an additional deterministic baseline',
      'INFO'
    ),
    (
      'preservation fingerprint: posted credit notes',
      $sql$
        SELECT jsonb_build_object(
          'verification', md5(COALESCE(sum(hashtextextended(jsonb_build_array(
            credit.id, credit.tenant_id, credit.branch_id, credit.customer_id,
            credit.invoice_number, credit.original_invoice_id, credit.status,
            credit.subtotal, credit.tax_amount, credit.total_amount,
            credit.invoice_date, credit.created_at, credit.updated_at
          )::text, 0)::numeric)::text, '0')),
          'ordered', md5(COALESCE(string_agg(
            md5(jsonb_build_array(
              credit.id, credit.tenant_id, credit.branch_id, credit.customer_id,
              credit.invoice_number, credit.original_invoice_id, credit.status,
              credit.subtotal, credit.tax_amount, credit.total_amount,
              credit.invoice_date, credit.created_at, credit.updated_at
            )::text),
            ',' ORDER BY credit.id
          ), ''))
        )::text AS preflight_value
        FROM public.invoices credit
        WHERE credit.status = 'posted'
          AND credit.zatca_invoice_type = 'credit_note'
      $sql$,
      'verification must match post-migration output and ordered is an additional deterministic baseline',
      'INFO'
    )
),
prepared_data_queries AS (
  SELECT
    query.check_name,
    query.query_text,
    readiness.ready,
    query.expected_value,
    query.result_mode
  FROM data_queries query
  CROSS JOIN schema_readiness readiness
),
all_dynamic_queries AS (
  SELECT * FROM migration_history_query
  UNION ALL
  SELECT * FROM prepared_data_queries
),
dynamic_observations AS (
  SELECT
    query.check_name,
    CASE
      WHEN query.ready IS NOT TRUE THEN '<prerequisite unavailable>'
      ELSE COALESCE(
        (
          xpath(
            '/table/row/preflight_value/text()',
            query_to_xml(query.query_text, false, false, '')
          )
        )[1]::text,
        '<empty>'
      )
    END AS observed_value,
    query.expected_value,
    query.result_mode,
    query.ready
  FROM all_dynamic_queries query
),
dynamic_checks AS (
  SELECT
    check_name,
    observed_value,
    expected_value,
    CASE
      WHEN ready IS NOT TRUE THEN 'REVIEW'
      WHEN result_mode = 'INFO' THEN 'INFO'
      WHEN result_mode = 'FAIL_NONZERO' AND observed_value ~ '^[0-9]+$'
        THEN CASE WHEN observed_value::numeric = 0 THEN 'PASS' ELSE 'FAIL' END
      WHEN result_mode = 'REVIEW_ZERO' AND observed_value ~ '^[0-9]+$'
        THEN CASE WHEN observed_value::numeric = 0 THEN 'REVIEW' ELSE 'PASS' END
      ELSE 'FAIL'
    END AS result
  FROM dynamic_observations
),
index_inventory_check AS (
  SELECT
    'existing relevant index inventory'::text AS check_name,
    COALESCE(
      string_agg(
        indexname || ': ' || regexp_replace(indexdef, '\s+', ' ', 'g'),
        E'\n' ORDER BY tablename, indexname
      ),
      '<none>'
    ) AS observed_value,
    'review existing customers, invoices and invoice_items indexes'::text AS expected_value,
    'INFO'::text AS result
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('customers', 'invoices', 'invoice_items')
),
similar_index_check AS (
  SELECT
    'new reporting index is not a structural duplicate'::text AS check_name,
    COALESCE(
      string_agg(indexname, ', ' ORDER BY indexname),
      '<none>'
    ) AS observed_value,
    'no existing index with the same customer-reporting key sequence'::text AS expected_value,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'REVIEW' END::text AS result
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'invoices'
    AND indexname <> 'customer_intelligence_documents_scope_idx'
    AND regexp_replace(indexdef, '\s+', ' ', 'g') ILIKE
      '%(tenant_id, branch_id, customer_id, invoice_date DESC, created_at DESC, id DESC)%'
),
table_grant_check AS (
  SELECT
    'current customer and invoice table grants'::text AS check_name,
    COALESCE(
      string_agg(
        grantee || ':' || table_name || ':' || privilege_type,
        ', ' ORDER BY table_name, grantee, privilege_type
      ),
      '<none>'
    ) AS observed_value,
    'informational grant baseline and migration must add no table grants'::text AS expected_value,
    'INFO'::text AS result
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('customers', 'invoices', 'invoice_items')
    AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
),
function_grant_check AS (
  SELECT
    'current customer and invoice function grants'::text AS check_name,
    COALESCE(
      string_agg(
        routine_name || ':' || grantee || ':' || privilege_type,
        ', ' ORDER BY routine_name, grantee, privilege_type
      ),
      '<none>'
    ) AS observed_value,
    'informational grant baseline for relevant reporting/read functions'::text AS expected_value,
    'INFO'::text AS result
  FROM information_schema.role_routine_grants
  WHERE specific_schema = 'public'
    AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
    AND (
      routine_name = 'reporting_resolve_scope'
      OR routine_name ILIKE '%customer%'
      OR routine_name ILIKE '%invoice%report%'
    )
),
resolver_observation AS (
  SELECT
    procedure.oid,
    procedure.prosecdef,
    procedure.proowner,
    owner_role.rolname AS owner_name,
    COALESCE(procedure.proconfig, ARRAY[]::text[]) AS proconfig,
    COALESCE(
      jsonb_object_agg(
        COALESCE(grantee_role.rolname, 'PUBLIC'),
        acl.privilege_type
        ORDER BY COALESCE(grantee_role.rolname, 'PUBLIC')
      ) FILTER (WHERE acl.privilege_type IS NOT NULL),
      '{}'::jsonb
    ) AS grants
  FROM pg_proc procedure
  LEFT JOIN pg_roles owner_role ON owner_role.oid = procedure.proowner
  LEFT JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )
  ) acl ON true
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE procedure.oid = to_regprocedure('public.reporting_resolve_scope(uuid)')
  GROUP BY
    procedure.oid,
    procedure.prosecdef,
    procedure.proowner,
    owner_role.rolname,
    procedure.proconfig
),
resolver_checks AS (
  SELECT
    'trusted scope resolver exists'::text AS check_name,
    COALESCE(oid::regprocedure::text, '<missing>') AS observed_value,
    'public.reporting_resolve_scope(uuid)'::text AS expected_value,
    CASE WHEN oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END::text AS result
  FROM (SELECT true) seed
  LEFT JOIN resolver_observation ON true

  UNION ALL

  SELECT
    'trusted scope resolver security and grants',
    CASE
      WHEN oid IS NULL THEN '<missing>'
      ELSE jsonb_build_object(
        'securityDefiner', prosecdef,
        'owner', owner_name,
        'config', proconfig,
        'grants', grants
      )::text
    END,
    jsonb_build_object(
      'securityDefiner', true,
      'owner', 'postgres',
      'config', ARRAY['search_path=public']::text[],
      'serviceRoleExecute', true,
      'publicExecute', false,
      'anonExecute', false,
      'authenticatedExecute', false
    )::text,
    CASE
      WHEN oid IS NOT NULL
        AND prosecdef IS TRUE
        AND owner_name = 'postgres'
        AND proconfig = ARRAY['search_path=public']::text[]
        AND grants ? 'service_role'
        AND NOT (grants ? 'PUBLIC')
        AND NOT (grants ? 'anon')
        AND NOT (grants ? 'authenticated')
      THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM (SELECT true) seed
  LEFT JOIN resolver_observation ON true
),
session_check AS (
  SELECT
    'database session summary'::text AS check_name,
    COALESCE(
      string_agg(
        COALESCE(state, '<null>') || '/'
          || COALESCE(wait_event_type, '<none>') || '/'
          || COALESCE(wait_event, '<none>') || '=' || session_count::text,
        ', ' ORDER BY state, wait_event_type, wait_event
      ),
      '<no other visible sessions>'
    ) AS observed_value,
    'informational active/idle session baseline'::text AS expected_value,
    'INFO'::text AS result
  FROM (
    SELECT state, wait_event_type, wait_event, count(*) AS session_count
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
    GROUP BY state, wait_event_type, wait_event
  ) sessions
),
waiting_lock_check AS (
  SELECT
    'waiting or ungranted locks in current database'::text AS check_name,
    count(*)::text AS observed_value,
    '0'::text AS expected_value,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text AS result
  FROM pg_locks lock
  JOIN pg_stat_activity activity ON activity.pid = lock.pid
  WHERE lock.granted IS FALSE
    AND activity.datname = current_database()
),
granted_lock_check AS (
  SELECT
    'granted relevant lock summary'::text AS check_name,
    COALESCE(
      string_agg(
        COALESCE(relation::regclass::text, '<none>') || ':' || mode || '=' || lock_count::text,
        ', ' ORDER BY relation::regclass::text, mode
      ),
      '<none>'
    ) AS observed_value,
    'informational because granted AccessShareLock is expected for this preflight'::text AS expected_value,
    'INFO'::text AS result
  FROM (
    SELECT relation, mode, count(*) AS lock_count
    FROM pg_locks
    WHERE granted IS TRUE
      AND relation IN (
        to_regclass('public.customers'),
        to_regclass('public.invoices'),
        to_regclass('public.invoice_items'),
        to_regclass('public.branches'),
        to_regclass('public.products'),
        to_regclass('public.product_units')
      )
    GROUP BY relation, mode
  ) locks
),
all_checks AS (
  SELECT * FROM transaction_check
  UNION ALL SELECT * FROM table_checks
  UNION ALL SELECT * FROM column_checks
  UNION ALL SELECT * FROM new_object_checks
  UNION ALL SELECT * FROM dynamic_checks
  UNION ALL SELECT * FROM index_inventory_check
  UNION ALL SELECT * FROM similar_index_check
  UNION ALL SELECT * FROM table_grant_check
  UNION ALL SELECT * FROM function_grant_check
  UNION ALL SELECT * FROM resolver_checks
  UNION ALL SELECT * FROM session_check
  UNION ALL SELECT * FROM waiting_lock_check
  UNION ALL SELECT * FROM granted_lock_check
),
final_results AS (
  SELECT check_name, observed_value, expected_value, result
  FROM all_checks

  UNION ALL

  SELECT
    'SUMMARY',
    jsonb_build_object(
      'fail', count(*) FILTER (WHERE result = 'FAIL'),
      'pass', count(*) FILTER (WHERE result = 'PASS'),
      'review', count(*) FILTER (WHERE result = 'REVIEW'),
      'info', count(*) FILTER (WHERE result = 'INFO')
    )::text,
    '0 FAIL',
    CASE
      WHEN count(*) FILTER (WHERE result = 'FAIL') = 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM all_checks
)
SELECT check_name, observed_value, expected_value, result
FROM final_results
ORDER BY
  CASE WHEN check_name = 'SUMMARY' THEN 1 ELSE 0 END,
  CASE result
    WHEN 'FAIL' THEN 1
    WHEN 'REVIEW' THEN 2
    WHEN 'PASS' THEN 3
    ELSE 4
  END,
  check_name;

ROLLBACK;
