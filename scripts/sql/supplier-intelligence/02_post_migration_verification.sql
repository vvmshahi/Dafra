BEGIN TRANSACTION READ ONLY;

WITH
expected_functions(signature) AS (
  VALUES
    ('public.get_supplier_intelligence(jsonb)'),
    ('public.get_supplier_intelligence_history(jsonb)'),
    ('public.list_supplier_intelligence(jsonb)')
),
function_observations AS (
  SELECT
    expected.signature,
    procedure.oid,
    procedure.prosecdef,
    procedure.provolatile,
    pg_get_function_result(procedure.oid) AS result_type,
    COALESCE(procedure.proconfig, ARRAY[]::text[]) AS config,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    END AS authenticated_execute,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    END AS service_role_execute,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege('anon', procedure.oid, 'EXECUTE')
    END AS anon_execute,
    CASE WHEN procedure.oid IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
        ) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      )
    END AS public_execute
  FROM expected_functions expected
  LEFT JOIN pg_proc procedure
    ON procedure.oid = to_regprocedure(expected.signature)
),
function_checks AS (
  SELECT
    'function contract: ' || signature AS check_name,
    jsonb_build_object(
      'present', oid IS NOT NULL,
      'result', result_type,
      'securityDefiner', prosecdef,
      'volatility', provolatile,
      'config', config,
      'authenticated', authenticated_execute,
      'serviceRole', service_role_execute,
      'anon', anon_execute,
      'public', public_execute
    )::text AS observed_value,
    '{"present":true,"result":"jsonb","securityDefiner":true,"volatility":"s","config":["search_path=public, pg_temp","row_security=off"],"authenticated":true,"serviceRole":false,"anon":false,"public":false}'::text AS expected_value,
    CASE WHEN
      oid IS NOT NULL
      AND result_type = 'jsonb'
      AND prosecdef IS TRUE
      AND provolatile = 's'
      AND config @> ARRAY['search_path=public, pg_temp', 'row_security=off']::text[]
      AND ARRAY['search_path=public, pg_temp', 'row_security=off']::text[] @> config
      AND authenticated_execute IS TRUE
      AND service_role_execute IS FALSE
      AND anon_execute IS FALSE
      AND public_execute IS FALSE
      THEN 'PASS' ELSE 'FAIL' END AS result
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
    'supplier reporting index exists exactly once',
    count(*)::text,
    '1',
    CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'supplier_intelligence_documents_scope_idx'

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
      'suppliers', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.suppliers'::regclass), false),
      'purchases', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.purchases'::regclass), false),
      'purchaseItems', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.purchase_items'::regclass), false)
    )::text,
    '{"suppliers":true,"purchases":true,"purchaseItems":true}',
    CASE WHEN
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.suppliers'::regclass)
      AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.purchases'::regclass)
      AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.purchase_items'::regclass)
      THEN 'PASS' ELSE 'FAIL' END

  UNION ALL

  SELECT
    'PUBLIC and anon receive no base-table privileges',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('suppliers', 'purchases', 'purchase_items')
    AND grantee IN ('PUBLIC', 'anon')

  UNION ALL

  SELECT
    'no new broad authenticated base-table privileges',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN ('suppliers', 'purchases', 'purchase_items')
    AND grantee = 'authenticated'
    AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')

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

  UNION ALL

  SELECT
    'migration recorded',
    count(*)::text,
    '1',
    CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260726000500'
),
fingerprint_checks AS (
  SELECT
    'supplier preservation fingerprint' AS check_name,
    md5(COALESCE(sum(hashtextextended(jsonb_build_array(
      s.id, s.tenant_id, s.branch_id, s.name, s.name_ar, s.vat_number,
      s.payment_terms, s.is_active, s.created_at, s.updated_at
    )::text, 0)::numeric)::text, '0')) AS observed_value,
    'must equal 01_preflight.sql output; migration also aborts on mismatch' AS expected_value,
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
    'must equal 01_preflight.sql output; migration also aborts on mismatch',
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
    'must equal 01_preflight.sql output; migration also aborts on mismatch',
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
    'must equal 01_preflight.sql output; migration also aborts on mismatch',
    'INFO'
  FROM public.purchase_stock_movements psm
),
all_checks AS (
  SELECT * FROM function_checks
  UNION ALL SELECT * FROM base_checks
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
      'info', count(*) FILTER (WHERE result = 'INFO')
    )::text,
    '0 FAIL and preservation hashes equal the preflight capture',
    CASE WHEN count(*) FILTER (WHERE result = 'FAIL') = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM all_checks
)
SELECT check_name, observed_value, expected_value, result
FROM results
ORDER BY CASE WHEN check_name = 'SUMMARY' THEN 1 ELSE 0 END, result, check_name;

ROLLBACK;
