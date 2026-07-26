-- Product Units commercial workflow production preflight.
-- Run immediately before manually applying migration 20260725000700.
-- Every probe is read-only and returns metadata, counts, or safe hashes only.

BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '2s';

WITH
expected_prerequisites(signature, expected_md5) AS (
  VALUES
    ('public.pos_checkout(jsonb)', '0db582cb8451ab6a6a69bb9d9d662de6'),
    ('public.create_partial_credit_note(jsonb)', '9d9b05d14a501ebfb887e9172b9c1fe2'),
    ('public.create_partial_credit_note_with_refund(jsonb)', '3e0c27664ae59b78ab51066a612ca6e5'),
    ('public.receive_product_stock(jsonb)', '20676b116d9001c6eedf7179e5e9ba64'),
    ('public.build_zatca_atomic_receipt_snapshot_v2(uuid)', '00022982d7619aefb65fc1e6f3125108')
),
prerequisite_results AS (
  SELECT
    'prerequisite_hash:' || expected.signature AS check_name,
    COALESCE(
      md5(pg_get_functiondef(to_regprocedure(expected.signature)::oid)),
      'missing'
    ) AS observed_value,
    expected.expected_md5 AS expected_value,
    CASE WHEN md5(pg_get_functiondef(
      to_regprocedure(expected.signature)::oid
    )) = expected.expected_md5 THEN 'PASS' ELSE 'FAIL' END AS result
  FROM expected_prerequisites expected
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
quantity_type AS (
  SELECT numeric_precision, numeric_scale
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'invoice_items'
    AND column_name = 'quantity'
),
target_collision AS (
  SELECT
    (
      SELECT count(*)
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
    )
    + CASE WHEN to_regclass(
        'public.product_units_commercial_function_contracts_v1'
      ) IS NULL THEN 0 ELSE 1 END
    + (
      SELECT count(*)
      FROM pg_constraint
      WHERE conname IN (
        'invoices_checkout_request_fingerprint_format',
        'invoices_credit_note_request_fingerprint_format',
        'product_stock_receipts_request_fingerprint_format',
        'invoice_items_product_unit_snapshot_contract',
        'pos_stock_movements_product_unit_snapshot_contract',
        'product_stock_receipts_product_unit_snapshot_contract'
      )
    )
    + (
      SELECT count(*)
      FROM unnest(ARRAY[
        'public.resolve_product_commercial_unit(uuid,uuid,numeric,integer,text)',
        'public.get_branch_selling_product_units(uuid)',
        'public.pos_checkout_legacy_base_v1(jsonb)',
        'public.pos_checkout_with_product_units_v1(jsonb)',
        'public.create_partial_credit_note_legacy_base_v1(jsonb)',
        'public.create_partial_credit_note_with_product_units_v1(jsonb)',
        'public.get_invoice_refundable_items_v2(uuid)',
        'public.receive_product_stock_legacy_base_v1(jsonb)',
        'public.receive_product_stock_with_units_v1(jsonb)',
        'public.get_sales_report_summary_v2(date,date,uuid)'
      ]) signature
      WHERE to_regprocedure(signature) IS NOT NULL
    ) AS collision_count
),
snapshot_columns AS (
  SELECT count(*) AS column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (
        table_name = 'invoice_items'
        AND column_name IN (
          'product_unit_id', 'product_unit_version', 'selling_unit_name',
          'selling_unit_name_ar', 'selling_unit_code', 'package_quantity',
          'package_quantity_scale', 'conversion_to_base', 'base_quantity',
          'base_unit_name', 'base_unit_name_ar', 'base_unit_code',
          'base_quantity_scale', 'package_pricing_method', 'base_unit_price',
          'package_unit_price', 'stock_tracked_at_sale', 'service_item_at_sale'
        )
      )
      OR (
        table_name = 'pos_stock_movements'
        AND column_name IN (
          'product_unit_id', 'product_unit_version', 'package_quantity',
          'conversion_to_base', 'base_quantity', 'selling_unit_name',
          'base_unit_name'
        )
      )
      OR (
        table_name = 'product_stock_receipts'
        AND column_name IN (
          'product_unit_id', 'product_unit_version', 'package_quantity',
          'conversion_to_base', 'base_quantity', 'package_unit_name',
          'base_unit_name', 'package_unit_code', 'base_unit_code',
          'package_unit_cost', 'base_unit_cost'
        )
      )
    )
),
required_functions AS (
  SELECT count(*) AS missing_count
  FROM unnest(ARRAY[
    'public.branch_effective_stock_enabled(uuid,uuid)',
    'public.mark_product_unit_used(uuid)',
    'public.get_invoice_refundable_items(uuid)',
    'public.reporting_resolve_scope(uuid)',
    'public.get_sales_report_summary(date,date,uuid)',
    'public.build_zatca_atomic_receipt_snapshot_v2(uuid)',
    'public.prepare_zatca_atomic_checkout_v2(uuid,text,jsonb,text,integer)',
    'public.commit_zatca_atomic_checkout_v2(uuid,uuid)'
  ]) signature
  WHERE to_regprocedure(signature) IS NULL
),
quantity_dependents AS (
  SELECT COALESCE(
    jsonb_agg(dependency_name ORDER BY dependency_name),
    '[]'::jsonb
  )::text AS dependencies
  FROM (
    SELECT DISTINCT
      'view:' || namespace.nspname || '.' || dependent.relname
        AS dependency_name
    FROM pg_attribute target
    JOIN pg_depend dependency
      ON dependency.refobjid = target.attrelid
     AND dependency.refobjsubid = target.attnum
    JOIN pg_rewrite rewrite ON rewrite.oid = dependency.objid
    JOIN pg_class dependent ON dependent.oid = rewrite.ev_class
    JOIN pg_namespace namespace ON namespace.oid = dependent.relnamespace
    WHERE target.attrelid = 'public.invoice_items'::regclass
      AND target.attname = 'quantity'
    UNION
    SELECT 'function:' || procedure.oid::regprocedure::text
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prokind = 'f'
      AND pg_get_functiondef(procedure.oid) ILIKE '%invoice_items%'
      AND pg_get_functiondef(procedure.oid) ILIKE '%quantity%'
  ) found
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
    'phase1_product_units_exists',
    COALESCE(to_regclass('public.product_units')::text, 'missing'),
    'product_units',
    CASE WHEN to_regclass('public.product_units') IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT
    'phase1_exactly_one_base_per_product',
    invalid_products::text,
    '0',
    CASE WHEN invalid_products = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM base_unit_state
  UNION ALL
  SELECT
    'phase1_product_unit_scope_valid',
    invalid_units::text,
    '0',
    CASE WHEN invalid_units = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM unit_scope_state
  UNION ALL
  SELECT
    'invoice_items_quantity_type',
    format('numeric(%s,%s)', numeric_precision, numeric_scale),
    'numeric(12,3)',
    CASE WHEN numeric_precision = 12 AND numeric_scale = 3
      THEN 'PASS' ELSE 'FAIL' END
  FROM quantity_type
  UNION ALL
  SELECT
    'target_migration_objects_absent',
    collision_count::text,
    '0',
    CASE WHEN collision_count = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM target_collision
  UNION ALL
  SELECT
    'target_migration_history_collision',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM supabase_migrations.schema_migrations
  WHERE version = '20260725000700'
  UNION ALL
  SELECT
    'phase1_snapshot_and_movement_columns',
    column_count::text,
    '36',
    CASE WHEN column_count = 36 THEN 'PASS' ELSE 'FAIL' END
  FROM snapshot_columns
  UNION ALL
  SELECT
    'required_function_signatures',
    missing_count::text,
    '0 missing',
    CASE WHEN missing_count = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM required_functions
  UNION ALL
  SELECT
    'affected_table_baseline_counts',
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
    'capture for post-migration comparison',
    'REVIEW'
  UNION ALL
  SELECT
    'active_checkout_traffic',
    jsonb_build_object(
      'open_pos_sessions', (
        SELECT count(*) FROM public.pos_sessions WHERE status = 'open'
      ),
      'invoices_last_5_minutes', (
        SELECT count(*) FROM public.invoices
        WHERE created_at >= clock_timestamp() - interval '5 minutes'
      ),
      'active_pos_checkout_queries', (
        SELECT count(*)
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND state <> 'idle'
          AND query ILIKE '%pos_checkout%'
      )
    )::text,
    'quiet window; review recent activity',
    CASE WHEN (
      SELECT count(*)
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND state <> 'idle'
        AND query ILIKE '%pos_checkout%'
    ) = 0 THEN 'REVIEW' ELSE 'FAIL' END
  UNION ALL
  SELECT
    'invoice_quantity_dependents',
    dependencies,
    'review before ACCESS EXCLUSIVE type change',
    'REVIEW'
  FROM quantity_dependents
  UNION ALL
  SELECT
    'current_atomic_registry_state',
    jsonb_build_object(
      'finalization_runtime', to_regclass('public.zatca_finalization_runtime'),
      'atomic_intents', to_regclass('public.zatca_atomic_checkout_intents_v2'),
      'chain_reservations', to_regclass('public.zatca_chain_reservations_v2'),
      'response_evidence',
        to_regclass('public.zatca_reporting_response_evidence_v2')
    )::text,
    'all required atomic relations present',
    CASE WHEN to_regclass('public.zatca_finalization_runtime') IS NOT NULL
      AND to_regclass('public.zatca_atomic_checkout_intents_v2') IS NOT NULL
      AND to_regclass('public.zatca_chain_reservations_v2') IS NOT NULL
      AND to_regclass('public.zatca_reporting_response_evidence_v2') IS NOT NULL
      THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT check_name, observed_value, expected_value, result
  FROM prerequisite_results
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
    '0 FAIL; discharge every REVIEW before applying',
    CASE WHEN count(*) FILTER (WHERE result = 'FAIL') = 0
      THEN 'REVIEW' ELSE 'FAIL' END
  FROM checks
)
SELECT check_name, observed_value, expected_value, result
FROM output
ORDER BY CASE result WHEN 'FAIL' THEN 1 WHEN 'REVIEW' THEN 2 ELSE 3 END,
  check_name;

ROLLBACK;
