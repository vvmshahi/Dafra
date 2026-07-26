-- PREPARED ONLY. Run only while all v2 database flags remain false.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.zatca_finalization_runtime
    WHERE singleton = true
      AND (immutable_finalization_enabled OR simplified_enabled OR standard_enabled)
  ) THEN RAISE EXCEPTION 'ZATCA_FLAGS_MUST_REMAIN_FALSE_DURING_CAPABILITY_CLEANUP'; END IF;
END
$guard$;

WITH deleted AS (
  DELETE FROM public.zatca_client_capabilities_v2
  WHERE expires_at <= clock_timestamp()
  RETURNING user_id, branch_id
)
SELECT count(*) AS deleted_expired_capability_rows
FROM deleted;

DO $postcondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.zatca_client_capabilities_v2
    WHERE expires_at <= clock_timestamp()
  ) THEN RAISE EXCEPTION 'EXPIRED_CAPABILITY_ROWS_REMAIN'; END IF;
END
$postcondition$;

COMMIT;
