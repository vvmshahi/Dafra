-- PREPARED emergency rollback. This preserves all artifacts, reservations,
-- readiness records, and chain heads.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

UPDATE public.zatca_finalization_runtime
SET immutable_finalization_enabled = false,
    simplified_enabled = false,
    standard_enabled = false,
    updated_at = clock_timestamp()
WHERE singleton = true;

DO $postcondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.zatca_finalization_runtime
    WHERE singleton = true
      AND (immutable_finalization_enabled OR simplified_enabled OR standard_enabled)
  ) THEN RAISE EXCEPTION 'GLOBAL_V2_ROLLBACK_FAILED'; END IF;
END
$postcondition$;

COMMIT;
