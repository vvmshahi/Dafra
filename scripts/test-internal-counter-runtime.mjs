import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const workdir = process.env.DAFRA_ONBOARDING_TEST_WORKDIR
assert.ok(workdir, 'DAFRA_ONBOARDING_TEST_WORKDIR is required')
assert.match(workdir, /^\/(?:private\/)?tmp\/dafra-atomic-disposable\./)

const config = readFileSync(`${workdir}/supabase/config.toml`, 'utf8')
assert.match(config, /project_id = "dafra_atomic_disposable_[^"]+"/)

const container = execFileSync(
  'docker',
  ['ps', '--filter', 'label=com.supabase.cli.project=dafra_atomic_disposable_20260724', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'],
  { encoding: 'utf8' },
).trim()
assert.equal(container, 'supabase_db_dafra_atomic_disposable_20260724')

const migration = readFileSync(
  'supabase/migrations/20260725000200_harden_internal_counter_functions.sql',
  'utf8',
)

const sql = String.raw`
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE counter_baseline AS
SELECT
  md5(pg_get_functiondef('public.get_next_credit_note_counter(uuid)'::regprocedure)) AS definition_hash,
  proacl
FROM pg_proc
WHERE oid = 'public.get_next_credit_note_counter(uuid)'::regprocedure;

${migration}

DO $test$
BEGIN
  IF has_function_privilege('public', 'public.get_next_invoice_counter(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_next_invoice_counter(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_next_invoice_counter(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.get_next_zatca_counter(uuid,character varying)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_next_zatca_counter(uuid,character varying)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_next_zatca_counter(uuid,character varying)', 'EXECUTE') THEN
    RAISE EXCEPTION 'direct counter privilege remains';
  END IF;
END
$test$;

INSERT INTO public.tenants (id, name, vat_number)
VALUES ('82000000-0000-0000-0000-000000000001', 'Counter runtime tenant', '310000000000060');
INSERT INTO public.branches (id, tenant_id, name, invoice_counter, credit_note_counter)
VALUES (
  '83000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000001',
  'Counter runtime branch',
  40,
  70
);
INSERT INTO public.zatca_certificates (
  id, tenant_id, branch_id, environment, invoice_counter
)
VALUES (
  '84000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000001',
  'sandbox',
  90
);

CREATE FUNCTION pg_temp.allocate_invoice_counter(p_branch_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS 'SELECT public.get_next_invoice_counter(p_branch_id)';

CREATE FUNCTION pg_temp.allocate_zatca_counter(p_branch_id uuid, p_env varchar)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS 'SELECT public.get_next_zatca_counter(p_branch_id, p_env)';

DO $test$
DECLARE
  v_invoice_first bigint;
  v_invoice_second bigint;
  v_zatca_first bigint;
  v_zatca_second bigint;
  v_before bigint;
BEGIN
  v_invoice_first := pg_temp.allocate_invoice_counter('83000000-0000-0000-0000-000000000001');
  v_invoice_second := pg_temp.allocate_invoice_counter('83000000-0000-0000-0000-000000000001');
  IF v_invoice_first <> 41 OR v_invoice_second <> 42 THEN
    RAISE EXCEPTION 'invoice allocation semantics changed: %, %', v_invoice_first, v_invoice_second;
  END IF;

  v_zatca_first := pg_temp.allocate_zatca_counter(
    '83000000-0000-0000-0000-000000000001', 'sandbox'
  );
  v_zatca_second := pg_temp.allocate_zatca_counter(
    '83000000-0000-0000-0000-000000000001', 'sandbox'
  );
  IF v_zatca_first <> 91 OR v_zatca_second <> 92 THEN
    RAISE EXCEPTION 'ZATCA allocation semantics changed: %, %', v_zatca_first, v_zatca_second;
  END IF;

  SELECT invoice_counter INTO v_before
  FROM public.branches
  WHERE id = '83000000-0000-0000-0000-000000000001';
  BEGIN
    PERFORM pg_temp.allocate_invoice_counter('83000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'forced surrounding failure';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forced surrounding failure' THEN RAISE; END IF;
  END;
  IF (
    SELECT invoice_counter FROM public.branches
    WHERE id = '83000000-0000-0000-0000-000000000001'
  ) <> v_before THEN
    RAISE EXCEPTION 'failed transaction retained invoice increment';
  END IF;
END
$test$;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM public.get_next_invoice_counter('83000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'anon invoice call unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_next_zatca_counter(
      '83000000-0000-0000-0000-000000000001', 'sandbox'
    );
    RAISE EXCEPTION 'anon ZATCA call unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  BEGIN
    PERFORM public.get_next_invoice_counter('83000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'authenticated invoice call unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_next_zatca_counter(
      '83000000-0000-0000-0000-000000000001', 'sandbox'
    );
    RAISE EXCEPTION 'authenticated ZATCA call unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;

DO $test$
DECLARE
  v_hash text;
  v_acl aclitem[];
BEGIN
  SELECT md5(pg_get_functiondef('public.get_next_credit_note_counter(uuid)'::regprocedure)),
         proacl
  INTO v_hash, v_acl
  FROM pg_proc
  WHERE oid = 'public.get_next_credit_note_counter(uuid)'::regprocedure;
  IF v_hash IS DISTINCT FROM (SELECT definition_hash FROM counter_baseline)
     OR v_acl IS DISTINCT FROM (SELECT proacl FROM counter_baseline) THEN
    RAISE EXCEPTION 'credit-note counter changed';
  END IF;
END
$test$;

ROLLBACK;
`

const result = spawnSync(
  'docker',
  ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres'],
  { input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
)
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
assert.match(result.stdout, /ROLLBACK/)
console.log('Internal counter disposable runtime checks passed')
