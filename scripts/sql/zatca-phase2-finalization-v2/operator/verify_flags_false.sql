-- Operator guard used after every mutating ZATCA v2 migration.
-- Read-only and fail-closed: any missing/duplicate runtime row or true flag
-- raises an error so the shell command stops under ON_ERROR_STOP.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

DO $guard$
DECLARE
  v_total bigint;
  v_singleton bigint;
  v_master boolean;
  v_simplified boolean;
  v_standard boolean;
  v_atomic boolean := false;
BEGIN
  IF to_regclass('public.zatca_finalization_runtime') IS NULL THEN
    RAISE EXCEPTION 'ZATCA_RUNTIME_TABLE_MISSING';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE singleton = true),
    bool_or(immutable_finalization_enabled) FILTER (WHERE singleton = true),
    bool_or(simplified_enabled) FILTER (WHERE singleton = true),
    bool_or(standard_enabled) FILTER (WHERE singleton = true)
  INTO v_total, v_singleton, v_master, v_simplified, v_standard
  FROM public.zatca_finalization_runtime;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'zatca_finalization_runtime'
      AND column_name = 'atomic_simplified_checkout_enabled'
  ) THEN
    EXECUTE
      'SELECT bool_or(atomic_simplified_checkout_enabled)
       FROM public.zatca_finalization_runtime
       WHERE singleton = true'
      INTO v_atomic;
  END IF;

  IF v_total <> 1 OR v_singleton <> 1 THEN
    RAISE EXCEPTION
      'ZATCA_RUNTIME_SINGLETON_INVALID:total=%,singleton=%',
      v_total, v_singleton;
  END IF;

  IF COALESCE(v_master, true)
     OR COALESCE(v_simplified, true)
     OR COALESCE(v_standard, true)
     OR COALESCE(v_atomic, true) THEN
    RAISE EXCEPTION
      'ZATCA_FLAGS_NOT_FALSE:master=%,simplified=%,standard=%,atomic_simplified_checkout=%',
      v_master, v_simplified, v_standard, v_atomic;
  END IF;
END
$guard$;

SELECT
  schema_version,
  minimum_edge_version,
  minimum_client_version,
  immutable_finalization_enabled,
  simplified_enabled,
  standard_enabled
FROM public.zatca_finalization_runtime
WHERE singleton = true;

ROLLBACK;
