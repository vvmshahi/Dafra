-- psql-only destructive-in-transaction test for an isolated Supabase/PostgreSQL
-- environment. Required variables: user_id, product_unit_id, product_id,
-- branch_id, cross_tenant_unit_id. Every write is rolled back.
\if :{?user_id}
\else
\quit
\endif

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'user_id', 'role', 'authenticated')::text,
  true
);

CREATE TEMP TABLE barcode_runtime_parameters (
  user_id uuid,
  product_unit_id uuid,
  product_id uuid,
  branch_id uuid,
  cross_tenant_unit_id uuid,
  test_barcode text
) ON COMMIT DROP;

INSERT INTO barcode_runtime_parameters
VALUES (
  :'user_id'::uuid,
  :'product_unit_id'::uuid,
  :'product_id'::uuid,
  :'branch_id'::uuid,
  :'cross_tenant_unit_id'::uuid,
  :'test_barcode'
);

SELECT
  pg_typeof(scope.actor_role)::text AS actor_role_runtime_type,
  scope.actor_role IS NOT NULL AS actor_role_present
FROM public.product_barcode_scope(:'product_unit_id'::uuid) scope;

CREATE TEMP TABLE barcode_runtime_result AS
SELECT public.create_product_unit_barcode(jsonb_build_object(
  'product_unit_id', :'product_unit_id',
  'barcode', :'test_barcode',
  'barcode_type', 'code128',
  'source', 'manufacturer',
  'is_primary', true
)) AS result;

SELECT
  jsonb_typeof(result) = 'object' AS create_returned_jsonb,
  (result->>'id')::uuid IS NOT NULL AS barcode_id_present
FROM barcode_runtime_result;

DO $duplicate_must_fail$
DECLARE
  v_parameters barcode_runtime_parameters%ROWTYPE;
BEGIN
  SELECT * INTO v_parameters FROM barcode_runtime_parameters;
  PERFORM public.create_product_unit_barcode(jsonb_build_object(
    'product_unit_id', v_parameters.product_unit_id,
    'barcode', v_parameters.test_barcode,
    'barcode_type', 'code128',
    'source', 'manufacturer',
    'is_primary', false
  ));
  RAISE EXCEPTION 'duplicate barcode unexpectedly succeeded';
EXCEPTION
  WHEN unique_violation THEN NULL;
END;
$duplicate_must_fail$;

SELECT count(*) = 1 AS list_contract_valid
FROM public.list_product_unit_barcodes(:'product_id'::uuid)
WHERE barcode = :'test_barcode'
  AND product_unit_id = :'product_unit_id'::uuid;

SELECT count(*) = 1 AS resolve_contract_valid
FROM public.resolve_product_unit_barcode(
  :'branch_id'::uuid,
  :'test_barcode'
)
WHERE product_id = :'product_id'::uuid
  AND product_unit_id = :'product_unit_id'::uuid;

SELECT public.update_product_unit_barcode(jsonb_build_object(
  'barcode_id', (SELECT (result->>'id')::uuid FROM barcode_runtime_result),
  'label_name', 'Runtime contract test'
));

SELECT public.set_primary_product_unit_barcode(
  (SELECT (result->>'id')::uuid FROM barcode_runtime_result)
);

SELECT public.record_product_barcode_print(jsonb_build_object(
  'barcode_id', (SELECT (result->>'id')::uuid FROM barcode_runtime_result),
  'copies', 1,
  'label_template', 'runtime_contract'
));

SELECT public.disable_product_unit_barcode(
  (SELECT (result->>'id')::uuid FROM barcode_runtime_result)
);

SELECT public.reactivate_product_unit_barcode(
  (SELECT (result->>'id')::uuid FROM barcode_runtime_result)
);

SELECT public.generate_internal_product_unit_barcode(
  :'product_unit_id'::uuid,
  false
);

DO $cross_tenant_must_fail$
DECLARE
  v_cross_tenant_unit_id uuid;
BEGIN
  SELECT cross_tenant_unit_id INTO v_cross_tenant_unit_id
  FROM barcode_runtime_parameters;
  PERFORM public.product_barcode_scope(v_cross_tenant_unit_id);
  RAISE EXCEPTION 'cross-tenant scope unexpectedly succeeded';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END;
$cross_tenant_must_fail$;

SELECT
  NOT has_table_privilege(
    'authenticated',
    'public.product_unit_barcodes',
    'SELECT'
  ) AS no_authenticated_registry_select,
  NOT has_table_privilege(
    'authenticated',
    'public.product_unit_barcodes',
    'INSERT'
  ) AS no_authenticated_registry_insert,
  NOT has_table_privilege(
    'authenticated',
    'public.product_barcode_print_events',
    'SELECT'
  ) AS no_authenticated_audit_select;

ROLLBACK;
