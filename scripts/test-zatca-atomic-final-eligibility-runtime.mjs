import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const container = process.env.DAFRA_FINAL_ELIGIBILITY_TEST_CONTAINER
const database = process.env.DAFRA_FINAL_ELIGIBILITY_TEST_DATABASE
assert.match(
  container ?? '',
  /^supabase_db_[a-zA-Z0-9_-]*disposable[a-zA-Z0-9_-]*$/,
  'Refusing to run outside a named disposable Supabase database container',
)
assert.match(
  database ?? '',
  /^dafra_[a-zA-Z0-9_]*(?:validation|disposable|test)[a-zA-Z0-9_]*$/,
  'Refusing to run against a non-disposable database name',
)

const psqlArgs = [
  'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
  '-U', 'supabase_admin', '-d', database, '-P', 'pager=off',
]
function psql(sql, options = {}) {
  return execFileSync('docker', psqlArgs, {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  })
}

const migration = readFileSync(
  new URL('../supabase/migrations/20260727000300_consolidate_atomic_checkout_final_eligibility_v2.sql', import.meta.url),
)
psql(migration)

const ids = {
  tenant: '4f3e5dee-bbf5-4de1-b175-b532ebf1fd86',
  owner: '9035be05-0c7a-4f59-93dd-4b868920cfd1',
  admin: '16699627-f45a-4058-a558-55d659d04b99',
  branchUser: '93cfe03b-d4bc-49c6-9ea9-522c2d3c31c4',
  branch: '2fc17777-82c8-4b35-8ce3-124e96c6b737',
  sameTenantBranch: '7efd5ccc-f764-427e-a924-ab8a2aacd28f',
  crossTenantBranch: '7e28b5f3-a864-4535-a08c-1e59cd6e2bb2',
}

const runtimeOutput = psql(`
BEGIN;
DO $catalog$
DECLARE
  f oid := 'public.evaluate_zatca_atomic_checkout_eligibility_v2(uuid,text,text)'::regprocedure;
  owner_oid oid := (SELECT oid FROM pg_roles WHERE rolname='postgres');
  authenticated_oid oid := (SELECT oid FROM pg_roles WHERE rolname='authenticated');
BEGIN
  IF has_function_privilege(0, f, 'EXECUTE')
     OR has_function_privilege('anon', f, 'EXECUTE')
     OR has_function_privilege('service_role', f, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p,
       LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid=f
         AND (
           acl.grantee NOT IN (owner_oid, authenticated_oid)
           OR acl.privilege_type <> 'EXECUTE'
           OR acl.is_grantable
         )
     ) THEN
    RAISE EXCEPTION 'runtime ACL mismatch';
  END IF;
END
$catalog$;

UPDATE public.zatca_finalization_runtime
SET immutable_finalization_enabled=true,
    simplified_enabled=true,
    atomic_simplified_checkout_enabled=true,
    schema_version=2,
    minimum_client_version='2.1.0',
    minimum_edge_version='2.1.0'
WHERE singleton=true;
UPDATE public.zatca_branch_readiness_v2
SET readiness_status='ready',
    readiness_source='production_onboarding',
    reason='disposable final eligibility runtime'
WHERE branch_id='${ids.branch}';
UPDATE public.zatca_production_credentials
SET onboarding_status='production_connected'
WHERE branch_id='${ids.branch}';
UPDATE public.zatca_client_capabilities_v2
SET client_version='2.1.0',
    edge_version='2.1.0',
    schema_version=2,
    expires_at=clock_timestamp()+interval '5 minutes'
WHERE branch_id='${ids.branch}';
DELETE FROM public.zatca_atomic_checkout_branch_gates_v2
WHERE branch_id='${ids.branch}';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','',true);
DO $tests$
DECLARE r jsonb;
BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r <> '{"status":"authorization_failed","reason":"unauthenticated"}'::jsonb THEN
    RAISE EXCEPTION 'unauthenticated mismatch: %', r;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','${ids.owner}',true);
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r->>'status' <> 'eligible' OR r->>'gateSyncAction' <> 'inserted' THEN
    RAISE EXCEPTION 'owner/insert mismatch: %', r;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(r) key
    WHERE key NOT IN ('status','branchId','blockingReason','gateSyncAction')
  ) THEN RAISE EXCEPTION 'unsafe eligible key: %', r; END IF;

  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r->>'status' <> 'eligible' OR r->>'gateSyncAction' <> 'unchanged' THEN
    RAISE EXCEPTION 'unchanged mismatch: %', r;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','${ids.admin}',true);
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r->>'status' = 'authorization_failed' THEN
    RAISE EXCEPTION 'same-tenant admin denied: %', r;
  END IF;
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.crossTenantBranch}','2.1.0','2.1.0'
  );
  IF r->>'status' <> 'authorization_failed' THEN
    RAISE EXCEPTION 'cross-tenant admin allowed: %', r;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','${ids.branchUser}',true);
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r->>'status' <> 'eligible' THEN
    RAISE EXCEPTION 'assigned branch user denied: %', r;
  END IF;
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.sameTenantBranch}','2.1.0','2.1.0'
  );
  IF r->>'status' <> 'authorization_failed' THEN
    RAISE EXCEPTION 'cross-branch user allowed: %', r;
  END IF;
END
$tests$;
RESET ROLE;

UPDATE public.user_profiles SET is_active=false WHERE id='${ids.owner}';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $inactive$
DECLARE r jsonb;
BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r->>'status' <> 'authorization_failed'
     OR r->>'reason' <> 'caller_profile_not_found' THEN
    RAISE EXCEPTION 'inactive profile mismatch: %', r;
  END IF;
END
$inactive$;
RESET ROLE;
UPDATE public.user_profiles SET is_active=true WHERE id='${ids.owner}';

UPDATE public.zatca_client_capabilities_v2
SET expires_at=clock_timestamp()-interval '1 second'
WHERE user_id='${ids.owner}' AND branch_id='${ids.branch}';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $expired$
DECLARE r jsonb;
BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r->>'status' <> 'legacy_required'
     OR r->>'blockingReason' <> 'missing_client_acknowledgement'
     OR r->>'gateSyncAction' <> 'unchanged' THEN
    RAISE EXCEPTION 'expired acknowledgement preservation mismatch: %', r;
  END IF;
END
$expired$;
RESET ROLE;

UPDATE public.zatca_branch_readiness_v2
SET readiness_status='blocked', readiness_source='operator_block', reason='runtime blocker'
WHERE branch_id='${ids.branch}';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.branchUser}',true);
DO $blocked$
DECLARE r jsonb;
BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r->>'blockingReason' <> 'explicitly_blocked'
     OR r->>'gateSyncAction' <> 'updated' THEN
    RAISE EXCEPTION 'blocked/update mismatch: %', r;
  END IF;
END
$blocked$;
RESET ROLE;

ROLLBACK;
`)
assert.match(runtimeOutput, /ROLLBACK/)

psql(`
BEGIN;
UPDATE public.zatca_finalization_runtime
SET immutable_finalization_enabled=true,
    simplified_enabled=true,
    atomic_simplified_checkout_enabled=true,
    schema_version=2,
    minimum_client_version='2.1.0',
    minimum_edge_version='2.1.0'
WHERE singleton=true;
UPDATE public.zatca_branch_readiness_v2
SET readiness_status='ready',
    readiness_source='production_onboarding',
    reason='disposable blocker precedence'
WHERE branch_id='${ids.branch}';
UPDATE public.zatca_client_capabilities_v2
SET expires_at=clock_timestamp()+interval '5 minutes'
WHERE user_id='${ids.owner}' AND branch_id='${ids.branch}';

SAVEPOINT readiness_missing_case;
DELETE FROM public.zatca_branch_readiness_v2 WHERE branch_id='${ids.branch}';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $case$ DECLARE r jsonb; BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2('${ids.branch}','2.1.0','2.1.0');
  IF r->>'blockingReason' <> 'readiness_missing' THEN
    RAISE EXCEPTION 'readiness missing mismatch: %', r;
  END IF;
END $case$;
RESET ROLE;
ROLLBACK TO SAVEPOINT readiness_missing_case;

SAVEPOINT chain_missing_case;
UPDATE public.zatca_chain_heads_v2 SET last_committed_hash='' WHERE branch_id='${ids.branch}';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $case$ DECLARE r jsonb; BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2('${ids.branch}','2.1.0','2.1.0');
  IF r->>'blockingReason' <> 'missing_chain_head' THEN
    RAISE EXCEPTION 'chain missing mismatch: %', r;
  END IF;
END $case$;
RESET ROLE;
ROLLBACK TO SAVEPOINT chain_missing_case;

SAVEPOINT credentials_missing_case;
UPDATE public.zatca_production_credentials SET onboarding_status='disconnected'
WHERE branch_id='${ids.branch}';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $case$ DECLARE r jsonb; BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2('${ids.branch}','2.1.0','2.1.0');
  IF r->>'blockingReason' <> 'missing_production_credentials' THEN
    RAISE EXCEPTION 'credentials missing mismatch: %', r;
  END IF;
END $case$;
RESET ROLE;
ROLLBACK TO SAVEPOINT credentials_missing_case;

SAVEPOINT runtime_disabled_case;
UPDATE public.zatca_finalization_runtime SET immutable_finalization_enabled=false
WHERE singleton=true;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $case$ DECLARE r jsonb; BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2('${ids.branch}','2.1.0','2.1.0');
  IF r->>'blockingReason' <> 'immutable_finalization_disabled'
     OR r->>'reason' <> 'atomic_rollout_disabled' THEN
    RAISE EXCEPTION 'runtime disabled mismatch: %', r;
  END IF;
END $case$;
RESET ROLE;
ROLLBACK TO SAVEPOINT runtime_disabled_case;

SAVEPOINT runtime_missing_case;
DELETE FROM public.zatca_finalization_runtime WHERE singleton=true;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $case$ DECLARE r jsonb; BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2('${ids.branch}','2.1.0','2.1.0');
  IF r->>'blockingReason' <> 'runtime_missing'
     OR r->>'reason' <> 'atomic_rollout_disabled' THEN
    RAISE EXCEPTION 'runtime missing mismatch: %', r;
  END IF;
END $case$;
RESET ROLE;
ROLLBACK TO SAVEPOINT runtime_missing_case;
ROLLBACK;
`)

// A controlled disposable stub writes the gate and then violates the returned
// contract. The wrapper must catch the raised validation exception only after
// PostgreSQL has rolled back the implicit exception subtransaction.
psql(`
BEGIN;
UPDATE public.zatca_atomic_checkout_branch_gates_v2
SET enabled=false WHERE branch_id='${ids.branch}';
CREATE OR REPLACE FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  tenant_id uuid, branch_id uuid, branch_name text,
  previous_gate_state boolean, resulting_gate_state boolean,
  readiness_result boolean, blocking_reason text, action text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_temp SET row_security TO off AS $stub$
BEGIN
  UPDATE public.zatca_atomic_checkout_branch_gates_v2
  SET enabled=true WHERE branch_id=p_branch_id;
  RETURN QUERY SELECT '${ids.tenant}'::uuid, gen_random_uuid(), 'stub'::text,
    false, true, true, 'eligible'::text, 'updated'::text;
END
$stub$;
ALTER FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(uuid,uuid)
OWNER TO postgres;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $rollback_test$
DECLARE r jsonb;
BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r <> '{"status":"dependency_failed","reason":"final_eligibility_dependency_failed"}'::jsonb
  THEN RAISE EXCEPTION 'contract failure mapping mismatch: %', r; END IF;
END
$rollback_test$;
RESET ROLE;
DO $gate_rollback$
DECLARE gate_enabled boolean;
BEGIN
  SELECT enabled INTO gate_enabled
  FROM public.zatca_atomic_checkout_branch_gates_v2
  WHERE branch_id='${ids.branch}';
  IF gate_enabled THEN RAISE EXCEPTION 'contract failure committed gate mutation'; END IF;
END
$gate_rollback$;
ROLLBACK;
`)

// The same rollback guarantee applies when the dependency throws after a
// write, not only when it returns malformed data.
psql(`
BEGIN;
UPDATE public.zatca_atomic_checkout_branch_gates_v2
SET enabled=false WHERE branch_id='${ids.branch}';
CREATE OR REPLACE FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  tenant_id uuid, branch_id uuid, branch_name text,
  previous_gate_state boolean, resulting_gate_state boolean,
  readiness_result boolean, blocking_reason text, action text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_temp SET row_security TO off AS $stub$
BEGIN
  UPDATE public.zatca_atomic_checkout_branch_gates_v2
  SET enabled=true WHERE branch_id=p_branch_id;
  RAISE EXCEPTION 'disposable dependency failure';
END
$stub$;
ALTER FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(uuid,uuid)
OWNER TO postgres;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $exception_test$
DECLARE r jsonb;
BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r <> '{"status":"dependency_failed","reason":"final_eligibility_dependency_failed"}'::jsonb
  THEN RAISE EXCEPTION 'dependency failure mapping mismatch: %', r; END IF;
END
$exception_test$;
RESET ROLE;
DO $gate_rollback$
DECLARE gate_enabled boolean;
BEGIN
  SELECT enabled INTO gate_enabled
  FROM public.zatca_atomic_checkout_branch_gates_v2
  WHERE branch_id='${ids.branch}';
  IF gate_enabled THEN RAISE EXCEPTION 'dependency exception committed gate mutation'; END IF;
END
$gate_rollback$;
ROLLBACK;
`)

for (const semanticCase of [
  {
    name: 'unknown blocker',
    readiness: 'false',
    gate: 'false',
    blocker: 'unknown_dependency_state',
  },
  {
    name: 'eligible with false readiness',
    readiness: 'false',
    gate: 'true',
    blocker: 'eligible',
  },
  {
    name: 'eligible with false gate',
    readiness: 'true',
    gate: 'false',
    blocker: 'eligible',
  },
  {
    name: 'preserved gate with wrong blocker',
    readiness: 'false',
    gate: 'true',
    blocker: 'branch_not_ready',
  },
]) {
  psql(`
BEGIN;
UPDATE public.zatca_atomic_checkout_branch_gates_v2
SET enabled=false WHERE branch_id='${ids.branch}';
CREATE OR REPLACE FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(
  p_branch_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  tenant_id uuid, branch_id uuid, branch_name text,
  previous_gate_state boolean, resulting_gate_state boolean,
  readiness_result boolean, blocking_reason text, action text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_temp SET row_security TO off AS $stub$
BEGIN
  UPDATE public.zatca_atomic_checkout_branch_gates_v2
  SET enabled=true WHERE branch_id=p_branch_id;
  RETURN QUERY SELECT '${ids.tenant}'::uuid, p_branch_id, 'stub'::text,
    false, ${semanticCase.gate}, ${semanticCase.readiness},
    '${semanticCase.blocker}'::text, 'updated'::text;
END
$stub$;
ALTER FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(uuid,uuid)
OWNER TO postgres;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
DO $semantic_test$
DECLARE r jsonb;
BEGIN
  r := public.evaluate_zatca_atomic_checkout_eligibility_v2(
    '${ids.branch}','2.1.0','2.1.0'
  );
  IF r <> '{"status":"dependency_failed","reason":"final_eligibility_dependency_failed"}'::jsonb
  THEN RAISE EXCEPTION '${semanticCase.name} mapping mismatch: %', r; END IF;
END
$semantic_test$;
RESET ROLE;
DO $gate_rollback$
DECLARE gate_enabled boolean;
BEGIN
  SELECT enabled INTO gate_enabled
  FROM public.zatca_atomic_checkout_branch_gates_v2
  WHERE branch_id='${ids.branch}';
  IF gate_enabled THEN
    RAISE EXCEPTION '${semanticCase.name} committed gate mutation';
  END IF;
END
$gate_rollback$;
ROLLBACK;
`)
}

// Hold the synchronizer advisory lock so the wrapper remains in-flight after
// acquiring its profile and branch row locks. Concurrent reassignment attempts
// must time out rather than changing authorization state under the wrapper.
psql(`DELETE FROM public.zatca_atomic_checkout_branch_gates_v2 WHERE branch_id='${ids.branch}';`)
const lockSql = `SET application_name='dafra_final_eligibility_lock_holder';
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended(
  'atomic-simplified-gate:${ids.tenant}:${ids.branch}',0
));
SELECT pg_sleep(4);
COMMIT;`
const holder = spawn('docker', [...psqlArgs.slice(0, -2), '-q'], {
  stdio: ['pipe', 'ignore', 'pipe'],
})
holder.stdin.end(lockSql)
let holderOwnsAdvisoryLock = false
for (let attempt = 0; attempt < 30; attempt += 1) {
  const state = psql(`
COPY (
  SELECT count(*)
  FROM pg_stat_activity
  WHERE application_name='dafra_final_eligibility_lock_holder'
    AND wait_event='PgSleep'
) TO STDOUT;
`).trim()
  if (state === '1') {
    holderOwnsAdvisoryLock = true
    break
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}
assert.equal(holderOwnsAdvisoryLock, true, 'lock holder never acquired the advisory lock')
const caller = spawn('docker', [...psqlArgs.slice(0, -2), '-q'], {
  stdio: ['pipe', 'ignore', 'pipe'],
})
caller.stdin.end(`SET application_name='dafra_final_eligibility_lock_probe';
BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
SELECT public.evaluate_zatca_atomic_checkout_eligibility_v2(
  '${ids.branch}','2.1.0','2.1.0'
); COMMIT;`)

let wrapperWaitingOnAdvisoryLock = false
for (let attempt = 0; attempt < 30; attempt += 1) {
  const state = psql(`
COPY (
  SELECT count(*)
  FROM pg_stat_activity
  WHERE application_name='dafra_final_eligibility_lock_probe'
    AND wait_event_type='Lock'
    AND wait_event='advisory'
) TO STDOUT;
`).trim()
  if (state === '1') {
    wrapperWaitingOnAdvisoryLock = true
    break
  }
  await new Promise(resolve => setTimeout(resolve, 50))
}
assert.equal(
  wrapperWaitingOnAdvisoryLock,
  true,
  'RPC never reached the synchronizer advisory-lock barrier',
)

function expectRowLockTimeout(mutation, expectedRelation) {
  try {
    psql(`\\set VERBOSITY verbose
BEGIN;
SET LOCAL lock_timeout='250ms';
${mutation};
ROLLBACK;`)
    assert.fail('competing mutation unexpectedly acquired the locked row')
  } catch (error) {
    const diagnostic = String(error.stderr ?? error.message ?? error)
    assert.match(diagnostic, /55P03:[\s\S]*canceling statement due to lock timeout/)
    assert.match(diagnostic, new RegExp(`while locking tuple[\\s\\S]*relation "${expectedRelation}"`))
  }
}
for (const [mutation, expectedRelation] of [
  [
    `UPDATE public.user_profiles SET tenant_id=(SELECT tenant_id FROM public.branches WHERE id='${ids.crossTenantBranch}') WHERE id='${ids.owner}'`,
    'user_profiles',
  ],
  [
    `UPDATE public.branches SET tenant_id=(SELECT tenant_id FROM public.branches WHERE id='${ids.crossTenantBranch}') WHERE id='${ids.branch}'`,
    'branches',
  ],
]) {
  expectRowLockTimeout(mutation, expectedRelation)
}
await Promise.all([
  new Promise((resolve, reject) => holder.on('exit', code => code === 0 ? resolve() : reject(new Error(`lock holder exited ${code}`)))),
  new Promise((resolve, reject) => caller.on('exit', code => code === 0 ? resolve() : reject(new Error(`RPC caller exited ${code}`)))),
])
const lockedState = psql(`
COPY (
  SELECT concat_ws('|',
    (SELECT tenant_id::text FROM public.user_profiles WHERE id='${ids.owner}'),
    (SELECT tenant_id::text FROM public.branches WHERE id='${ids.branch}'),
    COALESCE((SELECT enabled::text FROM public.zatca_atomic_checkout_branch_gates_v2
      WHERE tenant_id='${ids.tenant}' AND branch_id='${ids.branch}'),'missing')
  )
) TO STDOUT;
`).trim()
assert.equal(lockedState, `${ids.tenant}|${ids.tenant}|false`)

// Two real wrapper calls racing on a missing gate serialize through the same
// advisory lock: exactly one inserts and the other observes the inserted row.
psql(`DELETE FROM public.zatca_atomic_checkout_branch_gates_v2 WHERE branch_id='${ids.branch}';`)
function concurrentRpcCall() {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...psqlArgs.slice(0, -2), '-Atq'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('exit', code => code === 0
      ? resolve(stdout)
      : reject(new Error(`concurrent RPC exited ${code}: ${stderr}`)))
    child.stdin.end(`BEGIN; SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.owner}',true);
SELECT public.evaluate_zatca_atomic_checkout_eligibility_v2(
  '${ids.branch}','2.1.0','2.1.0'
); COMMIT;`)
  })
}
const concurrentResults = await Promise.all([concurrentRpcCall(), concurrentRpcCall()])
assert.equal(concurrentResults.filter(value => value.includes('"gateSyncAction": "inserted"')).length, 1)
assert.equal(concurrentResults.filter(value => value.includes('"gateSyncAction": "unchanged"')).length, 1)

psql(`
INSERT INTO public.zatca_atomic_checkout_branch_gates_v2(
  tenant_id,branch_id,enabled,updated_at
) VALUES ('${ids.tenant}','${ids.branch}',false,clock_timestamp())
ON CONFLICT (tenant_id,branch_id) DO UPDATE
SET enabled=false, enabled_at=NULL, enabled_by=NULL, updated_at=clock_timestamp();
`)

console.log('ZATCA final eligibility disposable runtime, ACL, rollback, and locking tests passed.')
