import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const databaseUrl = process.env.KUBRI_ENTITLEMENT_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:59722/postgres'
const psql = process.env.PSQL_BIN
  ?? ['/opt/homebrew/opt/libpq/bin/psql', '/opt/homebrew/bin/psql', '/usr/local/bin/psql', 'psql']
    .find(candidate => candidate === 'psql' || existsSync(candidate))
const migrationPath = resolve('supabase/migrations/20260803000100_authoritative_owner_branch_entitlement.sql')
const includeMigration = `\\i '${migrationPath.replaceAll("'", "''")}'`

function execute(sql) {
  return execFileSync(psql, [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

const partialDriftSql = String.raw`
BEGIN;

DO $fixture$
DECLARE
  v_plan_id uuid := gen_random_uuid();
  v_tenant_id uuid;
BEGIN
  INSERT INTO public.subscription_plans (
    id, name, price_monthly, price_yearly, max_branches, max_users, max_products, is_active
  ) VALUES (
    v_plan_id, 'Partial drift fixture', 17.50, 175.00, 999, 100, 1000, true
  );
  INSERT INTO public.tenants (
    name, vat_number, email, country, is_active, max_branches, business_type
  ) VALUES (
    'Partial drift fixture', 'VAT-PARTIAL-01', 'partial-drift@entitlement.test', 'SA', true, 7, 'trading'
  ) RETURNING id INTO v_tenant_id;
  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, starts_at, paid_branch_count
  ) VALUES (
    v_tenant_id, v_plan_id, 'active', now(), 2
  );
END
$fixture$;

CREATE TEMP TABLE phase2_partial_before AS
SELECT t.id AS tenant_id, t.max_branches, s.id AS subscription_id, s.paid_branch_count
FROM public.tenants t
JOIN public.tenant_subscriptions s ON s.tenant_id = t.id
WHERE t.email = 'partial-drift@entitlement.test';

ALTER TABLE public.owner_provisioning_requests
  DROP CONSTRAINT owner_provisioning_requests_branch_allowance_check;
ALTER TABLE public.owner_provisioning_requests
  DROP COLUMN branch_allowance;

${includeMigration}

DO $assertions$
DECLARE
  v_type text;
  v_not_null boolean;
  v_default text;
  v_constraint text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_not_null, v_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attrelid = 'public.owner_provisioning_requests'::regclass
    AND a.attname = 'branch_allowance' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_type <> 'integer' OR v_not_null OR v_default IS NOT NULL THEN
    RAISE EXCEPTION 'partial fixture branch_allowance definition mismatch';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.tenant_subscriptions'::regclass
    AND c.conname = 'tenant_subscriptions_paid_branch_count_check';
  IF v_constraint <> 'CHECK ((paid_branch_count >= 1))' THEN
    RAISE EXCEPTION 'partial fixture paid check was not preserved: %', v_constraint;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM phase2_partial_before b
    JOIN public.tenants t ON t.id = b.tenant_id
    JOIN public.tenant_subscriptions s ON s.id = b.subscription_id
    WHERE t.max_branches IS DISTINCT FROM b.max_branches
       OR s.paid_branch_count IS DISTINCT FROM b.paid_branch_count
  ) THEN
    RAISE EXCEPTION 'partial fixture tenant/subscription values changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants'
      AND column_name = 'vat_number' AND is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'partial fixture VAT became non-nullable';
  END IF;

  IF to_regprocedure('public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.complete_owner_provisioning_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'partial fixture entitlement functions did not compile';
  END IF;
END
$assertions$;

ROLLBACK;
SELECT 'partial entitlement drift migration: PASS' AS result;
`

const incompatibilities = [
  {
    name: 'paid branch count type',
    expected: 'INCOMPATIBLE_PAID_BRANCH_COUNT_DEFINITION',
    setup: String.raw`
ALTER TABLE public.tenant_subscriptions DROP CONSTRAINT tenant_subscriptions_paid_branch_count_check;
ALTER TABLE public.tenant_subscriptions ALTER COLUMN paid_branch_count DROP DEFAULT;
ALTER TABLE public.tenant_subscriptions ALTER COLUMN paid_branch_count DROP NOT NULL;
ALTER TABLE public.tenant_subscriptions ALTER COLUMN paid_branch_count TYPE text USING paid_branch_count::text;`,
  },
  {
    name: 'paid branch count nullable/default',
    expected: 'INCOMPATIBLE_PAID_BRANCH_COUNT_DEFINITION',
    setup: 'ALTER TABLE public.tenant_subscriptions ALTER COLUMN paid_branch_count DROP NOT NULL;',
  },
  {
    name: 'paid branch count range',
    expected: 'INCOMPATIBLE_PAID_BRANCH_COUNT_CHECK',
    setup: String.raw`
ALTER TABLE public.tenant_subscriptions DROP CONSTRAINT tenant_subscriptions_paid_branch_count_check;
ALTER TABLE public.tenant_subscriptions
  ADD CONSTRAINT tenant_subscriptions_paid_branch_count_check CHECK (paid_branch_count >= 0);`,
  },
  {
    name: 'branch allowance type',
    expected: 'INCOMPATIBLE_BRANCH_ALLOWANCE_DEFINITION',
    setup: String.raw`
ALTER TABLE public.owner_provisioning_requests
  DROP CONSTRAINT owner_provisioning_requests_branch_allowance_check;
ALTER TABLE public.owner_provisioning_requests
  ALTER COLUMN branch_allowance TYPE text USING branch_allowance::text;`,
  },
  {
    name: 'entitlement function signature',
    expected: 'INCOMPATIBLE_ENTITLEMENT_FUNCTION_SIGNATURE',
    setup: 'ALTER FUNCTION public.complete_owner_provisioning_core(uuid) RENAME TO complete_owner_provisioning_core_incompatible_fixture;',
  },
]

const partialOutput = execute(partialDriftSql)
assert.match(partialOutput, /partial entitlement drift migration: PASS/)

for (const fixture of incompatibilities) {
  try {
    execute(`BEGIN;\n${fixture.setup}\n${includeMigration}\nROLLBACK;`)
    assert.fail(`${fixture.name} was accepted`)
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    assert.match(output, new RegExp(fixture.expected), fixture.name)
  }
}

console.log('partial entitlement drift migration: PASS')
console.log('entitlement incompatibility guards: PASS')
