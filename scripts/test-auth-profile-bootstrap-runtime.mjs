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
  'supabase/migrations/20260725000100_harden_auth_profile_bootstrap.sql',
  'utf8',
)

const sql = String.raw`
\set ON_ERROR_STOP on
BEGIN;
${migration}

DO $test$
BEGIN
  IF has_function_privilege('public', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'direct execution privilege remains';
  END IF;
END
$test$;

CREATE TRIGGER bootstrap_runtime_auth_trigger
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TEMP TABLE bootstrap_expected (
  id uuid PRIMARY KEY,
  expected_name text
);
INSERT INTO bootstrap_expected VALUES
  ('51000000-0000-0000-0000-000000000001', 'Malicious One'),
  ('51000000-0000-0000-0000-000000000002', ''),
  ('51000000-0000-0000-0000-000000000003', ''),
  ('51000000-0000-0000-0000-000000000004', repeat('x', 255));

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '51000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'malicious-one@bootstrap.invalid', '', now(),
    '{"role":"super_admin","tenant_id":"20000000-0000-0000-0000-000000000001"}',
    '{"full_name":"  Malicious One  ","role":"super_admin","tenant_id":"20000000-0000-0000-0000-000000000001","branch_id":"30000000-0000-0000-0000-000000000001","is_active":false}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '51000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'missing-meta@bootstrap.invalid', '', now(),
    '{}'::jsonb, NULL, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '51000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', 'invalid-meta@bootstrap.invalid', '', now(),
    '{}'::jsonb, '{"role":{"invalid":true},"tenant_id":"not-a-uuid","branch_id":42,"is_active":true}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '51000000-0000-0000-0000-000000000004',
    'authenticated', 'authenticated', 'long-name@bootstrap.invalid', '', now(),
    '{}'::jsonb, jsonb_build_object('full_name', repeat('x', 300), 'role', 'branch'),
    now(), now()
  );

DO $test$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bootstrap_expected e
    LEFT JOIN public.user_profiles p ON p.id = e.id
    WHERE p.id IS NULL
       OR p.role <> 'owner'::public.user_role
       OR p.tenant_id IS NOT NULL
       OR p.branch_id IS NOT NULL
       OR p.is_active IS DISTINCT FROM TRUE
       OR p.full_name IS DISTINCT FROM e.expected_name
       OR p.email IS DISTINCT FROM (
         SELECT u.email FROM auth.users u WHERE u.id = e.id
       )
  ) THEN
    RAISE EXCEPTION 'bootstrap profile did not match the fixed safe state';
  END IF;
END
$test$;

CREATE TEMP TABLE bootstrap_replay (
  id uuid,
  email text,
  raw_user_meta_data jsonb
);
CREATE TRIGGER bootstrap_replay_trigger
AFTER INSERT ON bootstrap_replay
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.tenants (id, name, vat_number)
VALUES
  ('61000000-0000-0000-0000-000000000001', 'Bootstrap branch tenant', '310000000000045'),
  ('61000000-0000-0000-0000-000000000002', 'Bootstrap owner tenant', '310000000000052');
INSERT INTO public.branches (id, tenant_id, name)
VALUES (
  '71000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001',
  'Bootstrap existing branch'
);

UPDATE public.user_profiles
SET role = 'branch',
    tenant_id = '61000000-0000-0000-0000-000000000001',
    branch_id = '71000000-0000-0000-0000-000000000001',
    is_active = false,
    full_name = 'Existing Branch'
WHERE id = '51000000-0000-0000-0000-000000000001';

INSERT INTO bootstrap_replay VALUES (
  '51000000-0000-0000-0000-000000000001',
  'changed@bootstrap.invalid',
  '{"full_name":"Overwrite","role":"super_admin"}'
);

UPDATE public.user_profiles
SET role = 'super_admin',
    tenant_id = NULL,
    branch_id = NULL,
    is_active = false,
    full_name = 'Existing Super'
WHERE id = '51000000-0000-0000-0000-000000000002';
INSERT INTO bootstrap_replay VALUES (
  '51000000-0000-0000-0000-000000000002',
  'changed-super@bootstrap.invalid',
  '{"full_name":"Overwrite","role":"owner"}'
);

UPDATE public.user_profiles
SET role = 'owner',
    tenant_id = '61000000-0000-0000-0000-000000000002',
    branch_id = NULL,
    is_active = false,
    full_name = 'Existing Owner'
WHERE id = '51000000-0000-0000-0000-000000000003';
INSERT INTO bootstrap_replay VALUES (
  '51000000-0000-0000-0000-000000000003',
  'changed-owner@bootstrap.invalid',
  '{"full_name":"Overwrite","role":"branch"}'
);

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = '51000000-0000-0000-0000-000000000001'
      AND role = 'branch' AND tenant_id = '61000000-0000-0000-0000-000000000001'
      AND branch_id = '71000000-0000-0000-0000-000000000001'
      AND is_active = false AND full_name = 'Existing Branch'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = '51000000-0000-0000-0000-000000000002'
      AND role = 'super_admin' AND tenant_id IS NULL AND branch_id IS NULL
      AND is_active = false AND full_name = 'Existing Super'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = '51000000-0000-0000-0000-000000000003'
      AND role = 'owner' AND tenant_id = '61000000-0000-0000-0000-000000000002'
      AND branch_id IS NULL AND is_active = false AND full_name = 'Existing Owner'
  ) THEN
    RAISE EXCEPTION 'existing profile was overwritten';
  END IF;
END
$test$;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM public.handle_new_user();
    RAISE EXCEPTION 'anon direct invocation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  BEGIN
    PERFORM public.handle_new_user();
    RAISE EXCEPTION 'authenticated direct invocation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;

ROLLBACK;
`

const result = spawnSync(
  'docker',
  ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres'],
  { input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
)
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
assert.match(result.stdout, /ROLLBACK/)
console.log('Auth profile bootstrap disposable runtime checks passed')
