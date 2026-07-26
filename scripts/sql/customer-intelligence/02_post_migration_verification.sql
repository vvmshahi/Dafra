BEGIN TRANSACTION READ ONLY;

WITH
expected_functions (
  signature,
  expected_result,
  expected_config,
  authenticated_execute,
  service_role_execute,
  anon_execute,
  public_execute
) AS (
  VALUES
    (
      'public.get_customer_intelligence(jsonb)',
      'jsonb',
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      true, false, false, false
    ),
    (
      'public.get_customer_intelligence_history(jsonb)',
      'jsonb',
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      true, false, false, false
    ),
    (
      'public.list_customer_intelligence(jsonb)',
      'jsonb',
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      true, false, false, false
    )
),
function_observations AS (
  SELECT
    expected.*,
    procedure.oid,
    procedure.prosecdef,
    procedure.provolatile,
    COALESCE(procedure.proconfig, ARRAY[]::text[]) AS observed_config,
    pg_get_function_result(procedure.oid) AS observed_result,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    END AS observed_authenticated_execute,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    END AS observed_service_role_execute,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege('anon', procedure.oid, 'EXECUTE')
    END AS observed_anon_execute,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
        ) acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
    END AS observed_public_execute
  FROM expected_functions expected
  LEFT JOIN pg_proc procedure
    ON procedure.oid = to_regprocedure(expected.signature)
),
function_checks AS (
  SELECT
    'function: ' || signature AS check_name,
    jsonb_build_object(
      'present', oid IS NOT NULL,
      'securityDefiner', prosecdef,
      'volatility', provolatile,
      'result', observed_result,
      'config', observed_config,
      'authenticated', observed_authenticated_execute,
      'serviceRole', observed_service_role_execute,
      'anon', observed_anon_execute,
      'public', observed_public_execute
    )::text AS observed_value,
    jsonb_build_object(
      'present', true,
      'securityDefiner', true,
      'volatility', 's',
      'result', expected_result,
      'config', expected_config,
      'authenticated', authenticated_execute,
      'serviceRole', service_role_execute,
      'anon', anon_execute,
      'public', public_execute
    )::text AS expected_value,
    CASE
      WHEN oid IS NOT NULL
        AND prosecdef IS TRUE
        AND provolatile = 's'
        AND observed_result = expected_result
        AND observed_config @> expected_config
        AND expected_config @> observed_config
        AND observed_authenticated_execute = authenticated_execute
        AND observed_service_role_execute = service_role_execute
        AND observed_anon_execute = anon_execute
        AND observed_public_execute = public_execute
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result
  FROM function_observations
),
base_checks AS (
  SELECT
    'transaction is read-only' AS check_name,
    current_setting('transaction_read_only') AS observed_value,
    'on' AS expected_value,
    CASE WHEN current_setting('transaction_read_only') = 'on' THEN 'PASS' ELSE 'FAIL' END AS result

  UNION ALL

  SELECT
    'reporting index exists',
    COALESCE(to_regclass('public.customer_intelligence_documents_scope_idx')::text, '<missing>'),
    'customer_intelligence_documents_scope_idx',
    CASE WHEN to_regclass('public.customer_intelligence_documents_scope_idx') IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END

  UNION ALL

  SELECT
    'reporting index is not duplicated by name',
    count(*)::text,
    '1',
    CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'customer_intelligence_documents_scope_idx'

  UNION ALL

  SELECT
    'trusted scope resolver remains present',
    COALESCE(to_regprocedure('public.reporting_resolve_scope(uuid)')::text, '<missing>'),
    'reporting_resolve_scope(uuid)',
    CASE WHEN to_regprocedure('public.reporting_resolve_scope(uuid)') IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END

  UNION ALL

  SELECT
    'base reporting tables keep RLS enabled',
    jsonb_build_object(
      'customers', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customers'::regclass), false),
      'invoices', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoices'::regclass), false),
      'invoiceItems', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoice_items'::regclass), false)
    )::text,
    '{"customers": true, "invoices": true, "invoiceItems": true}',
    CASE WHEN
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.customers'::regclass)
      AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoices'::regclass)
      AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoice_items'::regclass)
      THEN 'PASS' ELSE 'FAIL' END

  UNION ALL

  SELECT
    'PUBLIC and anon receive no new base-table privileges',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('customers', 'invoices', 'invoice_items')
    AND grantee IN ('PUBLIC', 'anon')

  UNION ALL

  SELECT
    'no new authenticated table privileges',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('customers', 'invoices', 'invoice_items')
    AND grantee = 'authenticated'
    AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')

  UNION ALL

  SELECT
    'customer tenant and branch orphans',
    (
      count(*) FILTER (WHERE tenant.id IS NULL)
      + count(*) FILTER (WHERE branch.id IS NULL)
    )::text,
    '0',
    CASE WHEN
      count(*) FILTER (WHERE tenant.id IS NULL)
      + count(*) FILTER (WHERE branch.id IS NULL) = 0
      THEN 'PASS' ELSE 'FAIL' END
  FROM public.customers customer
  LEFT JOIN public.tenants tenant ON tenant.id = customer.tenant_id
  LEFT JOIN public.branches branch
    ON branch.id = customer.branch_id
   AND branch.tenant_id = customer.tenant_id

  UNION ALL

  SELECT
    'invoice customer orphans',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.invoices invoice
  LEFT JOIN public.customers customer
    ON customer.id = invoice.customer_id
   AND customer.tenant_id = invoice.tenant_id
  WHERE invoice.customer_id IS NOT NULL
    AND customer.id IS NULL

  UNION ALL

  SELECT
    'migration recorded',
    count(*)::text,
    '1',
    CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260726000400'
),
preservation_observations AS (
  SELECT 'customer preservation fingerprint' AS check_name,
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      c.id, c.tenant_id, c.branch_id, c.name, c.name_ar, c.customer_type,
      c.vat_number, c.is_active, c.created_at, c.updated_at
    )::text, 0)::numeric)::text, '0')) AS observed_value
  FROM public.customers c
  UNION ALL
  SELECT 'invoice preservation fingerprint',
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      i.id, i.tenant_id, i.branch_id, i.customer_id, i.invoice_number,
      i.zatca_invoice_type, i.status, i.subtotal, i.tax_amount, i.total_amount,
      i.invoice_date, i.created_at, i.updated_at
    )::text, 0)::numeric)::text, '0'))
  FROM public.invoices i
  UNION ALL
  SELECT 'invoice-item preservation fingerprint',
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      ii.id, ii.invoice_id, ii.tenant_id, ii.product_id, ii.name, ii.name_ar,
      ii.unit, ii.quantity, ii.unit_price, ii.subtotal, ii.tax_amount, ii.total,
      ii.product_unit_id, ii.package_quantity, ii.base_quantity
    )::text, 0)::numeric)::text, '0'))
  FROM public.invoice_items ii
  UNION ALL
  SELECT 'credit-note preservation fingerprint',
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      cn.id, cn.tenant_id, cn.branch_id, cn.customer_id, cn.invoice_number,
      cn.original_invoice_id, cn.status, cn.subtotal, cn.tax_amount,
      cn.total_amount, cn.invoice_date, cn.created_at, cn.updated_at
    )::text, 0)::numeric)::text, '0'))
  FROM public.invoices cn
  WHERE cn.zatca_invoice_type = 'credit_note'
),
preservation_checks AS (
  SELECT
    check_name,
    observed_value,
    'must match 01_preflight.sql output; migration also aborts on mismatch' AS expected_value,
    'INFO' AS result
  FROM preservation_observations
),
all_checks AS (
  SELECT * FROM function_checks
  UNION ALL
  SELECT * FROM base_checks
  UNION ALL
  SELECT * FROM preservation_checks
),
results AS (
  SELECT * FROM all_checks
  UNION ALL
  SELECT
    'SUMMARY',
    jsonb_build_object(
      'checks', count(*),
      'pass', count(*) FILTER (WHERE result = 'PASS'),
      'fail', count(*) FILTER (WHERE result = 'FAIL')
    )::text,
    'zero FAIL; compare preservation hashes with preflight capture',
    CASE WHEN count(*) FILTER (WHERE result = 'FAIL') = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM all_checks
)
SELECT check_name, observed_value, expected_value, result
FROM results
ORDER BY CASE WHEN check_name = 'SUMMARY' THEN 1 ELSE 0 END, check_name;

ROLLBACK;
