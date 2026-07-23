-- Start after session A reaches pg_sleep. Run only in the documented disposable DB.
\set ON_ERROR_STOP on

DO $disposable_guard$
BEGIN
  IF current_database() !~* '(test|fixture|disposable)' THEN
    RAISE EXCEPTION 'DISPOSABLE_DATABASE_REQUIRED';
  END IF;
END
$disposable_guard$;

BEGIN;
SET LOCAL lock_timeout = '15s';
SELECT *
FROM public.allocate_zatca_chain_v2(:'invoice_id'::uuid, :'claim_token'::uuid);
COMMIT;
