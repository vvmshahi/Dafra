-- Product Units commercial workflow post-migration verification.
-- Run immediately after manually applying migration 20260725000700.
-- Every probe is read-only and returns metadata, counts, or safe hashes only.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '2s';

WITH
expected_functions(
  signature,
  authenticated_execute,
  service_role_execute
) AS (
  VALUES
    ('public.resolve_product_commercial_unit(uuid,uuid,numeric,integer,text)', false, false),
    ('public.get_branch_selling_product_units(uuid)', true, true),
    ('public.pos_checkout_legacy_base_v1(jsonb)', false, true),
    ('public.pos_checkout_with_product_units_v1(jsonb)', false, false),
    ('public.pos_checkout(jsonb)', true, true),
    ('public.create_partial_credit_note_legacy_base_v1(jsonb)', false, true),
    ('public.create_partial_credit_note_with_product_units_v1(jsonb)', false, false),
    ('public.create_partial_credit_note(jsonb)', true, true),
    ('public.create_partial_credit_note_with_refund(jsonb)', true, true),
    ('public.get_invoice_refundable_items_v2(uuid)', true, true),
    ('public.receive_product_stock_legacy_base_v1(jsonb)', false, true),
    ('public.receive_product_stock_with_units_v1(jsonb)', false, false),
    ('public.receive_product_stock(jsonb)', true, true),
    ('public.build_zatca_atomic_receipt_snapshot_v2(uuid)', false, false),
    ('public.get_sales_report_summary_v2(date,date,uuid)', true, true)
),
function_matrix AS (
  SELECT
    expected.*,
    procedure.oid,
    CASE WHEN procedure.oid IS NULL
      THEN NULL ELSE pg_get_userbyid(procedure.proowner) END AS owner,
    procedure.prosecdef AS security_definer,
    procedure.proconfig AS config,
    COALESCE((
      SELECT bool_or(
        privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
      )
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
    ), false) AS public_execute,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE has_function_privilege('anon', procedure.oid, 'EXECUTE')
    END AS anon_execute,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    END AS actual_authenticated_execute,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE has_function_privilege('service_role', procedure.oid, 'EXECUTE')
    END AS actual_service_role_execute,
    CASE WHEN procedure.oid IS NULL THEN NULL
      ELSE has_function_privilege('postgres', procedure.oid, 'EXECUTE')
    END AS postgres_execute
  FROM expected_functions expected
  LEFT JOIN pg_proc procedure
    ON procedure.oid = to_regprocedure(expected.signature)
),
function_matrix_summary AS (
  SELECT
    count(*) FILTER (
      WHERE oid IS NULL
        OR owner <> 'postgres'
        OR security_definer IS NOT TRUE
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(config, ARRAY[]::text[])) setting
          WHERE setting LIKE 'search_path=public%'
        )
        OR 'row_security=off' <> ALL(COALESCE(config, ARRAY[]::text[]))
        OR public_execute
        OR anon_execute
        OR actual_authenticated_execute
          IS DISTINCT FROM authenticated_execute
        OR actual_service_role_execute
          IS DISTINCT FROM service_role_execute
        OR postgres_execute IS NOT TRUE
    ) AS mismatch_count,
    jsonb_agg(jsonb_build_object(
      'signature', signature,
      'owner', owner,
      'securityDefiner', security_definer,
      'config', config,
      'publicExecute', public_execute,
      'anonExecute', anon_execute,
      'authenticatedExecute', actual_authenticated_execute,
      'serviceRoleExecute', actual_service_role_execute,
      'postgresExecute', postgres_execute
    ) ORDER BY signature)::text AS matrix
  FROM function_matrix
),
contract_state AS (
  SELECT
    count(*) AS contract_count,
    count(*) FILTER (
      WHERE to_regprocedure(contract.function_signature) IS NULL
         OR md5(pg_get_functiondef(
           to_regprocedure(contract.function_signature)::oid
         )) IS DISTINCT FROM contract.definition_md5
    ) AS mismatch_count,
    min(registered_at) AS registered_at
  FROM public.product_units_commercial_function_contracts_v1 contract
),
quantity_type AS (
  SELECT numeric_precision, numeric_scale
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'invoice_items'
    AND column_name = 'quantity'
),
base_unit_state AS (
  SELECT count(*) AS invalid_products
  FROM public.products product
  LEFT JOIN LATERAL (
    SELECT count(*) AS base_count
    FROM public.product_units unit
    WHERE unit.product_id = product.id
      AND unit.tenant_id = product.tenant_id
      AND unit.branch_id = product.branch_id
      AND unit.is_base IS TRUE
  ) base ON true
  WHERE base.base_count <> 1
),
unit_scope_state AS (
  SELECT count(*) AS invalid_units
  FROM public.product_units unit
  LEFT JOIN public.products product
    ON product.id = unit.product_id
   AND product.tenant_id = unit.tenant_id
   AND product.branch_id = unit.branch_id
  WHERE product.id IS NULL
),
checks(check_name, observed_value, expected_value, result) AS (
  SELECT
    'transaction_is_read_only',
    current_setting('transaction_read_only'),
    'on',
    CASE WHEN current_setting('transaction_read_only') = 'on'
      THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT
    'invoice_items_quantity_type',
    format('numeric(%s,%s)', numeric_precision, numeric_scale),
    'numeric(18,6)',
    CASE WHEN numeric_precision = 18 AND numeric_scale = 6
      THEN 'PASS' ELSE 'FAIL' END
  FROM quantity_type
  UNION ALL
  SELECT
    'fingerprint_columns_exist',
    count(*)::text,
    '3',
    CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (
        table_name = 'invoices'
        AND column_name IN (
          'checkout_request_fingerprint',
          'credit_note_request_fingerprint'
        )
      )
      OR (
        table_name = 'product_stock_receipts'
        AND column_name = 'request_fingerprint'
      )
    )
  UNION ALL
  SELECT
    'migration_constraints_exist',
    count(*)::text,
    '6',
    CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL' END
  FROM pg_constraint
  WHERE conname IN (
    'invoices_checkout_request_fingerprint_format',
    'invoices_credit_note_request_fingerprint_format',
    'product_stock_receipts_request_fingerprint_format',
    'invoice_items_product_unit_snapshot_contract',
    'pos_stock_movements_product_unit_snapshot_contract',
    'product_stock_receipts_product_unit_snapshot_contract'
  )
  UNION ALL
  SELECT
    'migration_constraints_intentionally_not_valid',
    count(*) FILTER (WHERE convalidated)::text,
    '0 validated during lock-bounded rollout',
    CASE WHEN count(*) = 6
      AND count(*) FILTER (WHERE convalidated) = 0
      THEN 'PASS' ELSE 'FAIL' END
  FROM pg_constraint
  WHERE conname IN (
    'invoices_checkout_request_fingerprint_format',
    'invoices_credit_note_request_fingerprint_format',
    'product_stock_receipts_request_fingerprint_format',
    'invoice_items_product_unit_snapshot_contract',
    'pos_stock_movements_product_unit_snapshot_contract',
    'product_stock_receipts_product_unit_snapshot_contract'
  )
  UNION ALL
  SELECT
    'function_privilege_matrix',
    matrix,
    'owner postgres; SECURITY DEFINER; safe path; row_security off; exact ACLs',
    CASE WHEN mismatch_count = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM function_matrix_summary
  UNION ALL
  SELECT
    'function_contract_registry_count',
    contract_count::text,
    '11',
    CASE WHEN contract_count = 11 THEN 'PASS' ELSE 'FAIL' END
  FROM contract_state
  UNION ALL
  SELECT
    'function_contract_registry_hashes',
    mismatch_count::text,
    '0 mismatches',
    CASE WHEN mismatch_count = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM contract_state
  UNION ALL
  SELECT
    'checkout_dispatch_paths',
    CASE WHEN pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)
        LIKE '%pos_checkout_with_product_units_v1%'
      AND pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)
        LIKE '%pos_checkout_legacy_base_v1%'
      THEN 'legacy and package paths present' ELSE 'path missing' END,
    'legacy and package paths present',
    CASE WHEN pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)
        LIKE '%pos_checkout_with_product_units_v1%'
      AND pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)
        LIKE '%pos_checkout_legacy_base_v1%'
      THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT
    'no_products_lost_base_units',
    invalid_products::text,
    '0',
    CASE WHEN invalid_products = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM base_unit_state
  UNION ALL
  SELECT
    'no_invalid_product_unit_scope',
    invalid_units::text,
    '0',
    CASE WHEN invalid_units = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM unit_scope_state
  UNION ALL
  SELECT
    'no_invalid_invoice_package_snapshots',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.invoice_items item
  WHERE item.product_unit_id IS NOT NULL
    AND (
      item.product_unit_version IS NULL
      OR item.selling_unit_name IS NULL
      OR item.selling_unit_code IS NULL
      OR item.package_quantity IS NULL
      OR item.package_quantity_scale IS NULL
      OR item.conversion_to_base IS NULL
      OR item.base_quantity IS NULL
      OR item.base_unit_name IS NULL
      OR item.base_unit_code IS NULL
      OR item.base_quantity_scale IS NULL
      OR item.package_pricing_method IS NULL
      OR item.base_unit_price IS NULL
      OR item.package_unit_price IS NULL
      OR item.stock_tracked_at_sale IS NULL
      OR item.service_item_at_sale IS NULL
      OR item.quantity IS DISTINCT FROM item.package_quantity
      OR item.unit_price IS DISTINCT FROM item.package_unit_price
      OR item.base_quantity IS DISTINCT FROM
        item.package_quantity * item.conversion_to_base
    )
  UNION ALL
  SELECT
    'no_orphan_product_unit_references',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.invoice_items item
  LEFT JOIN public.product_units unit
    ON unit.id = item.product_unit_id
   AND unit.product_id = item.product_id
  WHERE item.product_unit_id IS NOT NULL
    AND unit.id IS NULL
  UNION ALL
  SELECT
    'no_duplicate_request_fingerprints',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM (
    SELECT checkout_request_fingerprint
    FROM public.invoices
    WHERE checkout_request_fingerprint IS NOT NULL
    GROUP BY checkout_request_fingerprint
    HAVING count(*) > 1
    UNION ALL
    SELECT credit_note_request_fingerprint
    FROM public.invoices
    WHERE credit_note_request_fingerprint IS NOT NULL
    GROUP BY credit_note_request_fingerprint
    HAVING count(*) > 1
    UNION ALL
    SELECT request_fingerprint
    FROM public.product_stock_receipts
    WHERE request_fingerprint IS NOT NULL
    GROUP BY request_fingerprint
    HAVING count(*) > 1
  ) duplicate
  UNION ALL
  SELECT
    'no_negative_tracked_stock',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.products
  WHERE track_stock IS TRUE
    AND stock_quantity < 0
  UNION ALL
  SELECT
    'historical_rows_not_backfilled',
    (
      (SELECT count(*)
       FROM public.invoice_items
       WHERE created_at < contract.registered_at
         AND product_unit_id IS NOT NULL)
      + (SELECT count(*)
         FROM public.invoices
         WHERE created_at < contract.registered_at
           AND (
             checkout_request_fingerprint IS NOT NULL
             OR credit_note_request_fingerprint IS NOT NULL
           ))
      + (SELECT count(*)
         FROM public.product_stock_receipts
         WHERE created_at < contract.registered_at
           AND request_fingerprint IS NOT NULL)
    )::text,
    '0',
    CASE WHEN (
      (SELECT count(*)
       FROM public.invoice_items
       WHERE created_at < contract.registered_at
         AND product_unit_id IS NOT NULL)
      + (SELECT count(*)
         FROM public.invoices
         WHERE created_at < contract.registered_at
           AND (
             checkout_request_fingerprint IS NOT NULL
             OR credit_note_request_fingerprint IS NOT NULL
           ))
      + (SELECT count(*)
         FROM public.product_stock_receipts
         WHERE created_at < contract.registered_at
           AND request_fingerprint IS NOT NULL)
    ) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM contract_state contract
  UNION ALL
  SELECT
    'contract_registry_not_browser_readable',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'product_units_commercial_function_contracts_v1'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  UNION ALL
  SELECT
    'affected_table_postflight_counts',
    jsonb_build_object(
      'invoices', (SELECT count(*) FROM public.invoices),
      'invoice_items', (SELECT count(*) FROM public.invoice_items),
      'invoice_items_bytes', pg_total_relation_size('public.invoice_items'),
      'products', (SELECT count(*) FROM public.products),
      'product_units', (SELECT count(*) FROM public.product_units),
      'pos_stock_movements', (SELECT count(*) FROM public.pos_stock_movements),
      'product_stock_receipts', (
        SELECT count(*) FROM public.product_stock_receipts
      )
    )::text,
    'compare with preflight; only registry rows are migration-created',
    'REVIEW'
),
output AS (
  SELECT check_name, observed_value, expected_value, result
  FROM checks
  UNION ALL
  SELECT
    'SUMMARY',
    jsonb_build_object(
      'pass', count(*) FILTER (WHERE result = 'PASS'),
      'review', count(*) FILTER (WHERE result = 'REVIEW'),
      'fail', count(*) FILTER (WHERE result = 'FAIL')
    )::text,
    '0 FAIL; compare counts and run controlled runtime smoke tests',
    CASE WHEN count(*) FILTER (WHERE result = 'FAIL') = 0
      THEN 'REVIEW' ELSE 'FAIL' END
  FROM checks
)
SELECT check_name, observed_value, expected_value, result
FROM output
ORDER BY CASE result WHEN 'FAIL' THEN 1 WHEN 'REVIEW' THEN 2 ELSE 3 END,
  check_name;

ROLLBACK;
