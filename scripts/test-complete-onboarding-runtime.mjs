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
  'supabase/migrations/20260725000000_harden_complete_onboarding.sql',
  'utf8',
)

const sql = String.raw`
\set ON_ERROR_STOP on
BEGIN;
${migration}

DO $test$
BEGIN
  IF has_function_privilege('anon', 'public.complete_onboarding(text,text,text,text,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has execute privilege';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.complete_onboarding(text,text,text,text,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated lacks execute privilege';
  END IF;
END
$test$;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM public.complete_onboarding('anonymous');
    RAISE EXCEPTION 'anonymous invocation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
RESET ROLE;

CREATE TEMP TABLE onboarding_test_users (
  id uuid PRIMARY KEY,
  expected_role public.user_role,
  is_active boolean,
  tenant_id uuid,
  branch_id uuid
);

INSERT INTO onboarding_test_users VALUES
  ('10000000-0000-0000-0000-000000000001', 'owner',       true,  NULL, NULL),
  ('10000000-0000-0000-0000-000000000002', 'owner',       false, NULL, NULL),
  ('10000000-0000-0000-0000-000000000003', 'branch',      true,  NULL, NULL),
  ('10000000-0000-0000-0000-000000000004', 'super_admin', true,  NULL, NULL),
  ('10000000-0000-0000-0000-000000000005', 'owner',       true,  NULL, NULL),
  ('10000000-0000-0000-0000-000000000006', 'owner',       true,  NULL, NULL),
  ('10000000-0000-0000-0000-000000000007', 'owner',       true,  NULL, NULL);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  id::text || '@onboarding.invalid', '', now(), '{"provider":"email","providers":["email"]}',
  '{}'::jsonb, now(), now()
FROM onboarding_test_users;

INSERT INTO public.user_profiles (id, role, is_active, tenant_id, branch_id)
SELECT id, expected_role, is_active, tenant_id, branch_id
FROM onboarding_test_users;

INSERT INTO public.subscription_plans (id, name, price_monthly, is_active)
VALUES ('40000000-0000-0000-0000-000000000001', 'Disposable onboarding plan', 1, true);

INSERT INTO public.tenants (id, name, vat_number)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'Existing onboarding tenant', '310000000000003'),
  ('20000000-0000-0000-0000-000000000002', 'Branch-holder onboarding tenant', '310000000000011');
INSERT INTO public.branches (id, tenant_id, name)
VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Existing branch');
UPDATE public.user_profiles
SET tenant_id = '20000000-0000-0000-0000-000000000001'
WHERE id = '10000000-0000-0000-0000-000000000005';
UPDATE public.user_profiles
SET branch_id = '30000000-0000-0000-0000-000000000001'
WHERE id = '10000000-0000-0000-0000-000000000006';

SET LOCAL ROLE authenticated;
DO $test$
DECLARE
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY ARRAY[
    '10000000-0000-0000-0000-000000000099'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    '10000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000005'::uuid,
    '10000000-0000-0000-0000-000000000006'::uuid
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
    BEGIN
      PERFORM public.complete_onboarding('rejected');
      RAISE EXCEPTION 'ineligible invocation unexpectedly succeeded for %', v_id;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END
$test$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
CREATE TEMP TABLE onboarding_result AS
SELECT public.complete_onboarding(
  'Runtime onboarding success', '', '310000000000029', '', 'Riyadh', 'SA', '500000001', '', NULL
) AS payload;

DO $test$
DECLARE
  v_tenant_id uuid := (SELECT (payload ->> 'tenant_id')::uuid FROM onboarding_result);
BEGIN
  IF (SELECT count(*) FROM public.tenants WHERE id = v_tenant_id) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one tenant';
  END IF;
  IF (SELECT count(*) FROM public.tenant_subscriptions WHERE tenant_id = v_tenant_id AND status = 'trial') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one trial subscription';
  END IF;
  IF (SELECT count(*) FROM public.user_profiles WHERE id = auth.uid() AND tenant_id = v_tenant_id AND role = 'owner' AND branch_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one assigned owner profile';
  END IF;

  BEGIN
    PERFORM public.complete_onboarding('Runtime onboarding replay');
    RAISE EXCEPTION 'replay unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  IF (SELECT count(*) FROM public.tenants WHERE name LIKE 'Runtime onboarding%') <> 1 THEN
    RAISE EXCEPTION 'replay created another tenant';
  END IF;
END
$test$;
RESET ROLE;

CREATE FUNCTION pg_temp.reject_onboarding_profile_update()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
BEGIN
  IF NEW.id = '10000000-0000-0000-0000-000000000007'::uuid THEN
    RAISE EXCEPTION 'forced test failure';
  END IF;
  RETURN NEW;
END
$trigger$;
CREATE TRIGGER onboarding_forced_failure
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_onboarding_profile_update();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000007', true);
DO $test$
DECLARE
  v_tenants_before bigint;
  v_subscriptions_before bigint;
BEGIN
  SELECT count(*) INTO v_tenants_before FROM public.tenants;
  SELECT count(*) INTO v_subscriptions_before FROM public.tenant_subscriptions;
  BEGIN
    PERFORM public.complete_onboarding(
      'Runtime forced rollback', '', '310000000000037', '', 'Riyadh', 'SA', '500000002', '', NULL
    );
    RAISE EXCEPTION 'forced profile-update failure unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forced test failure' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.tenants) <> v_tenants_before
     OR (SELECT count(*) FROM public.tenant_subscriptions) <> v_subscriptions_before THEN
    RAISE EXCEPTION 'tenant or subscription survived profile-update failure';
  END IF;
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
console.log('complete_onboarding disposable runtime checks passed')
