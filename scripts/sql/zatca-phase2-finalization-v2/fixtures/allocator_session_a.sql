-- Run only as documented in ../08_allocator_two_session_fixture.md.
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
-- Hold the transaction-scoped compliance-unit lock so session B exercises the
-- real wait/reread path rather than a sequential retry.
SELECT pg_sleep(5);
COMMIT;
