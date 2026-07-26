BEGIN TRANSACTION READ ONLY;

WITH
expected_functions (
  function_signature,
  security_definer,
  expected_config,
  authenticated_execute,
  service_role_execute,
  anon_execute,
  public_execute,
  expected_result
) AS (
  VALUES
    (
      'public.default_barcode_label_settings()',
      false,
      ARRAY['search_path=pg_catalog']::text[],
      false, false, false, false,
      'jsonb'
    ),
    (
      'public.validate_barcode_label_settings(jsonb)',
      false,
      ARRAY['search_path=pg_catalog']::text[],
      false, false, false, false,
      'jsonb'
    ),
    (
      'public.barcode_label_settings_scope(uuid)',
      true,
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      false, false, false, false,
      NULL
    ),
    (
      'public.get_branch_barcode_label_settings(uuid)',
      true,
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      true, true, false, false,
      NULL
    ),
    (
      'public.update_branch_barcode_label_settings(jsonb)',
      true,
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      true, true, false, false,
      NULL
    ),
    (
      'public.get_product_barcode_print_status(uuid)',
      true,
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      true, true, false, false,
      NULL
    ),
    (
      'public.record_product_barcode_print_batch(jsonb)',
      true,
      ARRAY['search_path=public, pg_temp', 'row_security=off']::text[],
      true, true, false, false,
      NULL
    )
),
function_observations AS (
  SELECT
    expected.*,
    procedure.oid,
    procedure.prosecdef AS observed_security_definer,
    COALESCE(procedure.proconfig, ARRAY[]::text[]) AS observed_config,
    pg_get_function_result(procedure.oid) AS observed_result,
    CASE
      WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      )
    END AS observed_authenticated_execute,
    CASE
      WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege(
        'service_role',
        procedure.oid,
        'EXECUTE'
      )
    END AS observed_service_role_execute,
    CASE
      WHEN procedure.oid IS NULL THEN false
      ELSE has_function_privilege('anon', procedure.oid, 'EXECUTE')
    END AS observed_anon_execute,
    CASE
      WHEN procedure.oid IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
    END AS observed_public_execute
  FROM expected_functions AS expected
  LEFT JOIN pg_proc AS procedure
    ON procedure.oid = to_regprocedure(expected.function_signature)
),
function_checks AS (
  SELECT
    'function: ' || function_signature AS check_name,
    jsonb_build_object(
      'present', oid IS NOT NULL,
      'security_definer', observed_security_definer,
      'config', observed_config,
      'authenticated_execute', observed_authenticated_execute,
      'service_role_execute', observed_service_role_execute,
      'anon_execute', observed_anon_execute,
      'public_execute', observed_public_execute,
      'result', observed_result
    )::text AS observed_value,
    jsonb_build_object(
      'present', true,
      'security_definer', security_definer,
      'config', expected_config,
      'authenticated_execute', authenticated_execute,
      'service_role_execute', service_role_execute,
      'anon_execute', anon_execute,
      'public_execute', public_execute,
      'result', COALESCE(expected_result, '<unchanged>')
    )::text AS expected_value,
    CASE
      WHEN oid IS NOT NULL
        AND observed_security_definer = security_definer
        AND observed_config @> expected_config
        AND expected_config @> observed_config
        AND observed_authenticated_execute = authenticated_execute
        AND observed_service_role_execute = service_role_execute
        AND observed_anon_execute = anon_execute
        AND observed_public_execute = public_execute
        AND (
          expected_result IS NULL
          OR observed_result = expected_result
        )
      THEN 'PASS'
      ELSE 'FAIL'
    END AS result
  FROM function_observations
),
expected_constraints (constraint_name) AS (
  VALUES
    ('branch_barcode_label_settings_pkey'),
    ('branch_barcode_label_settings_scope_fkey'),
    ('branch_barcode_label_settings_actor_fkey'),
    ('branch_barcode_label_settings_version'),
    ('branch_barcode_label_settings_object'),
    ('branch_barcode_label_settings_valid')
),
constraint_inventory AS (
  SELECT
    constraint_definition.constraint_name,
    constraint_definition.definition
  FROM (
    SELECT
      constraint_record.conname AS constraint_name,
      pg_get_constraintdef(constraint_record.oid) AS definition
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid =
      to_regclass('public.branch_barcode_label_settings')
  ) AS constraint_definition
),
expected_indexes (index_name) AS (
  VALUES
    ('branch_barcode_label_settings_pkey'),
    ('branches_id_tenant_id_barcode_settings_uidx')
),
index_inventory AS (
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND (
      tablename = 'branch_barcode_label_settings'
      OR indexname = 'branches_id_tenant_id_barcode_settings_uidx'
    )
),
base_checks (check_name, observed_value, expected_value, result) AS (
  SELECT
    'transaction is read-only',
    current_setting('transaction_read_only'),
    'on',
    CASE
      WHEN current_setting('transaction_read_only') = 'on' THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'settings table present',
    COALESCE(to_regclass('public.branch_barcode_label_settings')::text, '<missing>'),
    'branch_barcode_label_settings',
    CASE
      WHEN to_regclass('public.branch_barcode_label_settings') IS NOT NULL
        THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'settings table RLS enabled',
    COALESCE((
      SELECT relation.relrowsecurity::text
      FROM pg_class AS relation
      WHERE relation.oid =
        to_regclass('public.branch_barcode_label_settings')
    ), '<missing>'),
    'true',
    CASE
      WHEN (
        SELECT relation.relrowsecurity
        FROM pg_class AS relation
        WHERE relation.oid =
          to_regclass('public.branch_barcode_label_settings')
      ) IS TRUE THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'settings table FORCE RLS intentionally disabled',
    COALESCE((
      SELECT relation.relforcerowsecurity::text
      FROM pg_class AS relation
      WHERE relation.oid =
        to_regclass('public.branch_barcode_label_settings')
    ), '<missing>'),
    'false',
    CASE
      WHEN (
        SELECT relation.relforcerowsecurity
        FROM pg_class AS relation
        WHERE relation.oid =
          to_regclass('public.branch_barcode_label_settings')
      ) IS FALSE THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'authenticated direct settings writes denied',
    jsonb_build_object(
      'insert', has_table_privilege(
        'authenticated',
        'public.branch_barcode_label_settings',
        'INSERT'
      ),
      'update', has_table_privilege(
        'authenticated',
        'public.branch_barcode_label_settings',
        'UPDATE'
      ),
      'delete', has_table_privilege(
        'authenticated',
        'public.branch_barcode_label_settings',
        'DELETE'
      )
    )::text,
    '{"insert": false, "update": false, "delete": false}',
    CASE
      WHEN NOT has_table_privilege(
        'authenticated',
        'public.branch_barcode_label_settings',
        'INSERT'
      )
      AND NOT has_table_privilege(
        'authenticated',
        'public.branch_barcode_label_settings',
        'UPDATE'
      )
      AND NOT has_table_privilege(
        'authenticated',
        'public.branch_barcode_label_settings',
        'DELETE'
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'service-role-only ALL policy',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', policyname,
          'roles', roles,
          'command', cmd,
          'using', qual,
          'with_check', with_check
        )
        ORDER BY policyname
      )::text
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'branch_barcode_label_settings'
    ), '[]'),
    '[{"name": "branch_barcode_label_settings_service_role_all", "roles": ["service_role"], "command": "ALL", "using": "true", "with_check": "true"}]',
    CASE
      WHEN (
        SELECT count(*) = 1
          AND bool_and(policyname =
            'branch_barcode_label_settings_service_role_all')
          AND bool_and(roles = ARRAY['service_role']::name[])
          AND bool_and(cmd = 'ALL')
          AND bool_and(qual = 'true')
          AND bool_and(with_check = 'true')
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'branch_barcode_label_settings'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'service_role settings table privileges',
    jsonb_build_object(
      'select', has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'SELECT'
      ),
      'insert', has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'INSERT'
      ),
      'update', has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'UPDATE'
      ),
      'delete', has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'DELETE'
      )
    )::text,
    '{"select": true, "insert": true, "update": true, "delete": true}',
    CASE
      WHEN has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'SELECT'
      )
      AND has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'INSERT'
      )
      AND has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'UPDATE'
      )
      AND has_table_privilege(
        'service_role',
        'public.branch_barcode_label_settings',
        'DELETE'
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'expected constraints present',
    COALESCE((
      SELECT string_agg(
        expected.constraint_name ||
          CASE WHEN inventory.constraint_name IS NULL
            THEN ' (missing)'
            ELSE ' = ' || inventory.definition
          END,
        '; ' ORDER BY expected.constraint_name
      )
      FROM expected_constraints AS expected
      LEFT JOIN constraint_inventory AS inventory
        ON inventory.constraint_name = expected.constraint_name
    ), '<none>'),
    'all six named constraints present',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM expected_constraints AS expected
        LEFT JOIN constraint_inventory AS inventory
          ON inventory.constraint_name = expected.constraint_name
        WHERE inventory.constraint_name IS NULL
      ) THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'expected indexes present',
    COALESCE((
      SELECT string_agg(
        expected.index_name ||
          CASE WHEN inventory.indexname IS NULL
            THEN ' (missing)'
            ELSE ' = ' || inventory.indexdef
          END,
        '; ' ORDER BY expected.index_name
      )
      FROM expected_indexes AS expected
      LEFT JOIN index_inventory AS inventory
        ON inventory.indexname = expected.index_name
    ), '<none>'),
    'settings primary-key and branch scope indexes present',
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM expected_indexes AS expected
        LEFT JOIN index_inventory AS inventory
          ON inventory.indexname = expected.index_name
        WHERE inventory.indexname IS NULL
      ) THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'default configuration validates',
    (
      public.validate_barcode_label_settings(
        public.default_barcode_label_settings()
      ) = public.default_barcode_label_settings()
    )::text,
    'true',
    CASE
      WHEN public.validate_barcode_label_settings(
        public.default_barcode_label_settings()
      ) = public.default_barcode_label_settings()
      THEN 'PASS'
      ELSE 'FAIL'
    END

  UNION ALL

  SELECT
    'persisted configurations validate',
    count(*) FILTER (
      WHERE settings <> public.validate_barcode_label_settings(settings)
    )::text,
    '0 invalid rows',
    CASE
      WHEN count(*) FILTER (
        WHERE settings <> public.validate_barcode_label_settings(settings)
      ) = 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM public.branch_barcode_label_settings

  UNION ALL

  SELECT
    'settings scope has no orphan rows',
    count(*)::text,
    '0',
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
  FROM public.branch_barcode_label_settings AS settings
  LEFT JOIN public.branches AS branch
    ON branch.id = settings.branch_id
   AND branch.tenant_id = settings.tenant_id
  WHERE branch.id IS NULL

  UNION ALL

  SELECT
    'barcode identity IDs are unique',
    jsonb_build_object(
      'rows', count(*),
      'distinct_ids', count(DISTINCT id)
    )::text,
    'rows = distinct_ids',
    CASE
      WHEN count(*) = count(DISTINCT id) THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM public.product_unit_barcodes

  UNION ALL

  SELECT
    'print-event IDs are unique',
    jsonb_build_object(
      'rows', count(*),
      'distinct_ids', count(DISTINCT id)
    )::text,
    'rows = distinct_ids',
    CASE
      WHEN count(*) = count(DISTINCT id) THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM public.product_barcode_print_events
),
continuity_observations (
  check_name,
  observed_value,
  expected_value,
  result
) AS (
  SELECT
    'invoice_presentation_fingerprint',
    (
      SELECT jsonb_build_object(
        'branch_count', count(*),
        'configured_count',
          count(*) FILTER (WHERE presentation_settings IS NOT NULL),
        'fingerprint',
          md5(COALESCE(string_agg(
            id::text || ':' ||
              md5(COALESCE(presentation_settings::text, 'null')),
            ',' ORDER BY id
          ), ''))
      )::text
      FROM public.branches
    ),
    'match the captured pre-migration value',
    'INFO'

  UNION ALL

  SELECT
    'barcode_identity_fingerprint',
    (
      SELECT jsonb_build_object(
        'count', count(*),
        'fingerprint',
          md5(COALESCE(string_agg(
            id::text || ':' || md5(normalized_barcode),
            ',' ORDER BY id
          ), ''))
      )::text
      FROM public.product_unit_barcodes
    ),
    'match the captured pre-migration value',
    'INFO'

  UNION ALL

  SELECT
    'print_event_fingerprint',
    (
      SELECT jsonb_build_object(
        'count', count(*),
        'fingerprint',
          md5(COALESCE(string_agg(
            id::text || ':' ||
              product_unit_barcode_id::text || ':' ||
              print_kind || ':' || copies::text,
            ',' ORDER BY id
          ), ''))
      )::text
      FROM public.product_barcode_print_events
    ),
    'match the captured pre-migration value',
    'INFO'
),
checks AS (
  SELECT * FROM function_checks
  UNION ALL
  SELECT * FROM base_checks
  UNION ALL
  SELECT * FROM continuity_observations
),
report AS (
  SELECT
    check_name,
    observed_value,
    expected_value,
    result,
    0 AS sort_order
  FROM checks

  UNION ALL

  SELECT
    'SUMMARY',
    jsonb_build_object(
      'pass', count(*) FILTER (WHERE result = 'PASS'),
      'fail', count(*) FILTER (WHERE result = 'FAIL'),
      'info', count(*) FILTER (WHERE result = 'INFO')
    )::text,
    '0 FAIL',
    CASE
      WHEN count(*) FILTER (WHERE result = 'FAIL') = 0 THEN 'PASS'
      ELSE 'FAIL'
    END,
    1
  FROM checks
)
SELECT
  check_name,
  observed_value,
  expected_value,
  result
FROM report
ORDER BY sort_order, check_name;

ROLLBACK;
