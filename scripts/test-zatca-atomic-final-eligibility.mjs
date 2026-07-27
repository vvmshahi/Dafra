import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const migration = readFileSync(join(
  root,
  'supabase/migrations/20260727000300_consolidate_atomic_checkout_final_eligibility_v2.sql',
), 'utf8')
const recovered = readFileSync(join(
  root,
  'supabase/migrations/20260727000200_recover_atomic_checkout_gate_sync_definition.sql',
), 'utf8')
const edge = readFileSync(join(root, 'supabase/functions/zatca-submit/index.ts'), 'utf8')
const atomic = readFileSync(join(
  root,
  'supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql',
), 'utf8')

let failures = 0
const tests = []
function test(name, run) {
  tests.push({ name, run })
}

function loadTranspiledExports(source, exportNames, injected = {}) {
  const exportedSource = `${source}\nexport { ${exportNames.join(', ')} }`
  const compiled = ts.transpileModule(exportedSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  const names = Object.keys(injected)
  const values = Object.values(injected)
  new Function('module', 'exports', ...names, compiled)(
    module,
    module.exports,
    ...values,
  )
  return module.exports
}

test('authenticated RPC has the exact hardened signature and ACL', () => {
  assert.match(migration, /evaluate_zatca_atomic_checkout_eligibility_v2\(\s*p_branch_id uuid,\s*p_client_version text,\s*p_edge_version text\s*\)/)
  assert.match(migration, /RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER/)
  assert.match(migration, /SET search_path TO public, pg_temp/)
  assert.match(migration, /SET row_security TO off/)
  assert.match(migration, /ALTER FUNCTION public\.evaluate_zatca_atomic_checkout_eligibility_v2\(uuid, text, text\)\s+OWNER TO postgres/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.evaluate_zatca_atomic_checkout_eligibility_v2\(uuid, text, text\)\s+FROM PUBLIC/)
  assert.match(migration, /FOR v_role IN[\s\S]*FROM pg_roles[\s\S]*rolname <> 'postgres'[\s\S]*REVOKE ALL ON FUNCTION/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.evaluate_zatca_atomic_checkout_eligibility_v2\(uuid, text, text\)\s+TO authenticated/)
  assert.match(migration, /has_function_privilege\(0, v_function_oid, 'EXECUTE'\)/)
  assert.match(migration, /acl\.grantee NOT IN \(v_owner_oid, v_authenticated_oid\)/)
  assert.match(migration, /acl\.is_grantable/)
  assert.match(migration, /\(rolsuper OR rolbypassrls\)/)
})

test('authentication and branch authorization precede sync and readiness access', () => {
  const auth = migration.indexOf('v_actor_user_id uuid := auth.uid()')
  const profile = migration.indexOf('FROM public.user_profiles')
  const branch = migration.indexOf('FROM public.branches')
  const denial = migration.indexOf("'reason', 'branch_access_denied'", branch)
  const sync = migration.indexOf('FROM public.sync_zatca_atomic_checkout_branch_gates_v2')
  assert.ok(auth > 0 && profile > auth && branch > profile && denial > branch && sync > denial)
  assert.match(migration, /p\.is_active = true/)
  assert.match(migration, /FROM public\.user_profiles[\s\S]*FOR UPDATE/)
  assert.match(migration, /FROM public\.branches[\s\S]*FOR UPDATE/)
  assert.match(migration, /v_profile\.role NOT IN \('owner', 'admin', 'branch'\)/)
  assert.match(migration, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/)
  assert.match(migration, /v_profile\.role = 'branch'[\s\S]*v_profile\.branch_id IS DISTINCT FROM v_branch\.id/)
  assert.doesNotMatch(migration, /p_actor_user_id|p_tenant_id|p_actor_role/)
  assert.match(migration, /FINAL_ELIGIBILITY_AUTHORIZATION_CHANGED/)
})

test('compiled and runtime schema, client, and Edge versions are exact', () => {
  assert.match(migration, /v_expected_schema_version constant integer := 2/)
  assert.match(migration, /v_expected_client_version constant text := '2\.1\.0'/)
  assert.match(migration, /v_expected_edge_version constant text := '2\.1\.0'/)
  assert.match(migration, /p_client_version IS DISTINCT FROM v_expected_client_version/)
  assert.match(migration, /p_edge_version IS DISTINCT FROM v_expected_edge_version/)
  assert.match(migration, /v_runtime\.schema_version IS DISTINCT FROM v_expected_schema_version/)
  assert.match(migration, /v_runtime\.minimum_client_version IS DISTINCT FROM v_expected_client_version/)
  assert.match(migration, /v_runtime\.minimum_edge_version IS DISTINCT FROM v_expected_edge_version/)
})

test('authoritative recovered evaluation, locking, precedence, and gate actions are reused', () => {
  assert.match(migration, /public\.sync_zatca_atomic_checkout_branch_gates_v2\(\s*p_branch_id,\s*v_actor_user_id\s*\)/)
  assert.match(recovered, /pg_advisory_xact_lock\(hashtextextended\(/)
  assert.match(recovered, /FROM public\.zatca_atomic_checkout_branch_gates_v2[\s\S]*FOR UPDATE/)
  assert.match(recovered, /v_desired := v_eligible OR \([\s\S]*v_previous IS TRUE[\s\S]*v_static_ready[\s\S]*v_reason = 'missing_client_acknowledgement'/)
  assert.match(recovered, /v_blocking_reason := CASE[\s\S]*'inactive_branch'[\s\S]*'runtime_missing'[\s\S]*'explicitly_blocked'[\s\S]*'missing_chain_head'[\s\S]*'missing_production_credentials'[\s\S]*'missing_client_acknowledgement'[\s\S]*'eligible'/)
  for (const action of ['inserted', 'updated', 'unchanged']) {
    assert.ok(migration.includes(`'${action}'`))
  }
  assert.doesNotMatch(migration, /standard_enabled|standardEnabled|standard_finalization/)
  assert.match(migration, /FINAL_ELIGIBILITY_SYNC_CARDINALITY_INVALID/)
  assert.match(migration, /FINAL_ELIGIBILITY_SYNC_CONTRACT_INVALID/)
  assert.match(migration, /FINAL_ELIGIBILITY_SYNC_REASON_INVALID/)
  assert.match(migration, /FINAL_ELIGIBILITY_SYNC_STATE_INVALID/)
  for (const reason of [
    'eligible', 'inactive_branch', 'inactive_tenant', 'tenant_suspended',
    'runtime_missing', 'immutable_finalization_disabled',
    'simplified_finalization_disabled', 'atomic_global_disabled',
    'schema_version_incompatible', 'edge_version_incompatible',
    'client_version_incompatible', 'explicitly_blocked', 'readiness_missing',
    'branch_not_ready', 'missing_chain_head', 'missing_production_credentials',
    'missing_client_acknowledgement',
  ]) {
    assert.ok(migration.includes(`'${reason}'`), `missing synchronizer reason ${reason}`)
  }
  assert.match(migration, /v_sync\.readiness_result IS TRUE[\s\S]*v_sync\.resulting_gate_state IS NOT TRUE[\s\S]*v_sync\.blocking_reason <> 'eligible'/)
  assert.match(migration, /v_sync\.resulting_gate_state IS FALSE[\s\S]*v_sync\.blocking_reason = 'eligible'/)
  assert.match(migration, /v_sync\.resulting_gate_state IS TRUE[\s\S]*v_sync\.blocking_reason <> 'missing_client_acknowledgement'/)
  const sync = migration.indexOf('FROM public.sync_zatca_atomic_checkout_branch_gates_v2')
  const contractRaise = migration.indexOf('FINAL_ELIGIBILITY_SYNC_CONTRACT_INVALID', sync)
  const safeCatch = migration.indexOf('EXCEPTION WHEN OTHERS', contractRaise)
  assert.ok(sync > 0 && contractRaise > sync && safeCatch > contractRaise)
})

test('result contract is narrow, never proceed, and failures are fixed', () => {
  assert.match(migration, /'status', 'eligible'[\s\S]*'branchId'[\s\S]*'blockingReason', NULL[\s\S]*'gateSyncAction'/)
  assert.match(migration, /'status', 'legacy_required'[\s\S]*'reason', v_legacy_reason[\s\S]*'blockingReason', v_reason[\s\S]*'gateSyncAction'/)
  assert.match(migration, /'status', 'authorization_failed'/)
  assert.match(migration, /'status', 'unavailable'/)
  assert.match(migration, /'status', 'dependency_failed'/)
  assert.doesNotMatch(migration, /'status', 'proceed'/)
  assert.doesNotMatch(migration, /SQLERRM|PG_EXCEPTION|GET STACKED DIAGNOSTICS/)
  assert.doesNotMatch(migration, /receipt|signed.?xml|encrypted_|private.?key|certificate|production_secret|production_csid/i)
})

test('Edge kill switch and committed replay both precede final eligibility', () => {
  const enabled = edge.indexOf('partialCheckoutAction && consolidatedAtomicPreflightEnabled()')
  const killSwitch = edge.indexOf('parseImmutableFinalizationEdgeSwitch(', 0)
  const committed = edge.indexOf("partialPreflight.status === 'committed'", enabled)
  const finalCall = edge.indexOf('invokeTimedAtomicFinalEligibility(',
    edge.indexOf("if (action === 'checkout_simplified'"))
  assert.ok(killSwitch > 0 && enabled > killSwitch && committed > enabled && finalCall > committed)
  assert.match(edge.slice(committed, finalCall), /receipt: existing\.receipt/)
  assert.match(edge, /canPrint: true/)
})

test('enabled path skips exactly the replaced database stages and makes one timed call', () => {
  assert.match(edge, /const CONSOLIDATED_ATOMIC_FINAL_ELIGIBILITY_ENABLED = true/)
  assert.match(edge, /CONSOLIDATED_ATOMIC_FINAL_ELIGIBILITY_ENABLED && usePartialPreflight/)
  const active = edge.indexOf('if (useConsolidatedFinalEligibility)')
  const fallback = edge.indexOf('} else {', active)
  const activeBlock = edge.slice(active, fallback)
  for (const stage of [
    'rollout_initial_load',
    'readiness_initial_load',
    'eligibility_sync',
    'rollout_reload',
  ]) {
    assert.ok(activeBlock.includes(`'${stage}'`), `missing skipped ${stage}`)
  }
  assert.match(activeBlock, /invokeTimedAtomicFinalEligibility\(/)
  assert.doesNotMatch(activeBlock, /loadAtomicSimplifiedRolloutV2|loadBranchReadinessV2|syncAtomicSimplifiedEligibilityV2/)
})

test('Edge validates every status-dependent RPC shape at runtime', () => {
  assert.match(edge, /function parseAtomicFinalEligibilityResult\(value: unknown\)/)
  assert.match(edge, /function hasExactObjectKeys\(/)
  assert.match(edge, /UUID_TEXT_PATTERN/)
  assert.match(edge, /FINAL_ELIGIBILITY_GATE_ACTIONS/)
  assert.match(edge, /FINAL_ELIGIBILITY_LEGACY_REASONS/)
  assert.match(edge, /FINAL_ELIGIBILITY_FAILURE_REASONS/)
  assert.match(edge, /return parseAtomicFinalEligibilityResult\(data\)/)
  assert.doesNotMatch(
    edge.slice(
      edge.indexOf('async function invokeAtomicFinalEligibility'),
      edge.indexOf('type PartialAtomicPreflightResult'),
    ),
    /rpcObject\(data\) as AtomicFinalEligibilityResult/,
  )
})

test('actual Edge result parser accepts only the exact safe runtime contract', () => {
  const parserStart = edge.indexOf('const UUID_TEXT_PATTERN')
  const parserEnd = edge.indexOf('async function invokeAtomicFinalEligibility', parserStart)
  assert.ok(parserStart > 0 && parserEnd > parserStart)
  const { parseAtomicFinalEligibilityResult: parse } = loadTranspiledExports(
    edge.slice(parserStart, parserEnd),
    ['parseAtomicFinalEligibilityResult'],
  )
  const branchId = '2fc17777-82c8-4b35-8ce3-124e96c6b737'
  assert.equal(parse({
    status: 'eligible',
    branchId,
    blockingReason: null,
    gateSyncAction: 'updated',
  }).status, 'eligible')
  assert.equal(parse({
    status: 'legacy_required',
    branchId,
    reason: 'atomic_branch_not_ready',
    blockingReason: 'missing_chain_head',
    gateSyncAction: 'unchanged',
  }).status, 'legacy_required')
  for (const malformed of [
    null,
    [],
    { status: 'eligible', branchId, blockingReason: null },
    { status: 'eligible', branchId, blockingReason: null, gateSyncAction: 'forged' },
    { status: 'eligible', branchId, blockingReason: null, gateSyncAction: 'updated', secret: 'x' },
    { status: 'legacy_required', branchId, reason: 'forged', blockingReason: 'x', gateSyncAction: 'updated' },
    { status: 'authorization_failed', reason: 'forged' },
    { status: 'unavailable', reason: 'version_incompatible', extra: true },
    { status: 'proceed' },
  ]) {
    assert.deepEqual(parse(malformed), {
      status: 'dependency_failed',
      reason: 'final_eligibility_dependency_failed',
    })
  }
})

test('actual preflight enablement helper prevents consolidated RPC use when kill switch is off', () => {
  const helperStart = edge.indexOf('const CONSOLIDATED_ATOMIC_PREFLIGHT_ENABLED')
  const helperEnd = edge.indexOf('type AtomicFinalEligibilityResult', helperStart)
  const source = edge.slice(helperStart, helperEnd)
  const environment = new Map()
  const { consolidatedAtomicPreflightEnabled: enabled } = loadTranspiledExports(
    source,
    ['consolidatedAtomicPreflightEnabled'],
    {
      Deno: { env: { get: key => environment.get(key) } },
      parseImmutableFinalizationEdgeSwitch: value => ({
        edgeExecutionEnabled: value === 'true',
      }),
    },
  )
  environment.set('ZATCA_IMMUTABLE_FINALIZATION_ENABLED', 'false')
  assert.equal(enabled(), false)
  environment.set('ZATCA_IMMUTABLE_FINALIZATION_ENABLED', 'true')
  assert.equal(enabled(), true)
})

test('final eligibility timing reports outcome rather than every safe failure as ok', () => {
  const timedStart = edge.indexOf('async function invokeTimedAtomicFinalEligibility')
  const timedEnd = edge.indexOf('type PartialAtomicPreflightResult', timedStart)
  const timedHelper = edge.slice(timedStart, timedEnd)
  assert.equal(
    (timedHelper.match(/'final_eligibility_total'/g) ?? []).length,
    1,
  )
  assert.match(timedHelper, /status === 'eligible'[\s\S]*'ok'/)
  assert.match(timedHelper, /status === 'legacy_required'[\s\S]*'legacy_required'[\s\S]*'error'/)
})

test('actual helper maps rejected RPC promises and emits one error timing', async () => {
  const helperStart = edge.indexOf('async function invokeAtomicFinalEligibility')
  const helperEnd = edge.indexOf('type PartialAtomicPreflightResult', helperStart)
  const {
    invokeTimedAtomicFinalEligibility: invokeTimed,
  } = loadTranspiledExports(
    edge.slice(helperStart, helperEnd),
    ['invokeTimedAtomicFinalEligibility'],
    {
      FINALIZATION_EDGE_VERSION: '2.1.0',
      parseAtomicFinalEligibilityResult: value => value,
    },
  )
  const events = []
  const thrownMessage = 'sensitive transport internals'
  const result = await invokeTimed(
    { log: (...args) => events.push(args) },
    { rpc: async () => { throw new Error(thrownMessage) } },
    '2fc17777-82c8-4b35-8ce3-124e96c6b737',
    '2.1.0',
  )
  assert.deepEqual(result, {
    status: 'dependency_failed',
    reason: 'final_eligibility_dependency_failed',
  })
  assert.equal(JSON.stringify(result).includes(thrownMessage), false)
  assert.equal(events.length, 1)
  assert.equal(events[0][0], 'final_eligibility_total')
  assert.equal(events[0][2], 'error')
})

test('rollback branch retains the old four-call sequence', () => {
  const active = edge.indexOf('if (useConsolidatedFinalEligibility)')
  const fallback = edge.indexOf('} else {', active)
  const rate = edge.indexOf("span('rate_limit'", fallback)
  const fallbackBlock = edge.slice(fallback, rate)
  const rollout = fallbackBlock.indexOf("span('rollout_initial_load'")
  const readiness = fallbackBlock.indexOf("span('readiness_initial_load'")
  const sync = fallbackBlock.indexOf("span('eligibility_sync'")
  const reload = fallbackBlock.indexOf("span('rollout_reload'")
  assert.ok(rollout > 0 && readiness > rollout && sync > readiness && reload > sync)
})

test('rate, audit, prepare, signing, storage, commit, and reporting remain after eligibility', () => {
  const finalCall = edge.indexOf('invokeTimedAtomicFinalEligibility(',
    edge.indexOf("if (action === 'checkout_simplified'"))
  const rate = edge.indexOf("span('rate_limit'", finalCall)
  const audit = edge.indexOf("span('attempt_audit'", rate)
  const process = edge.indexOf('await processAtomicSimplifiedCheckoutV2(', audit)
  assert.ok(finalCall > 0 && rate > finalCall && audit > rate && process > audit)

  const prepare = edge.indexOf("serviceDb.rpc('prepare_zatca_atomic_checkout_v2'")
  const claim = edge.indexOf("serviceDb.rpc('claim_zatca_atomic_checkout_signing_v2'", prepare)
  const signing = edge.indexOf('signInvoice(', claim)
  const storage = edge.indexOf("serviceDb.rpc('store_zatca_atomic_checkout_artifact_v2'", signing)
  const commit = edge.indexOf("callerDb.rpc('commit_zatca_atomic_checkout_v2'", storage)
  const reporting = edge.indexOf('scheduleReportingOutboxDrain(serviceDb', commit)
  assert.ok(prepare > 0 && claim > prepare && signing > claim && storage > signing
    && commit > storage && reporting > commit)
  assert.doesNotMatch(edge.slice(commit, reporting + 100), /await scheduleReportingOutboxDrain/)
})

test('prepare independently revalidates and standard/legacy paths are untouched by migration', () => {
  assert.match(atomic, /CREATE OR REPLACE FUNCTION public\.prepare_zatca_atomic_checkout_v2/)
  assert.match(atomic, /ATOMIC_SIMPLIFIED_CHECKOUT_NOT_READY/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:prepare|commit)_zatca_atomic_checkout_v2/)
  const helper = edge.slice(
    edge.indexOf('async function invokeAtomicFinalEligibility'),
    edge.indexOf('type PartialAtomicPreflightResult'),
  )
  assert.doesNotMatch(helper, /checkout_standard|processLegacy|checkout_legacy/)
  assert.match(edge, /if \(action === 'checkout_simplified' \|\| action === 'checkout_simplified_credit_note'\)/)
})

test('catalog assertions cover language, kind, comment, exact ACL, and recovered dependencies', () => {
  assert.match(migration, /v_function\.prokind IS DISTINCT FROM 'f'/)
  assert.match(migration, /v_function\.prolang IS DISTINCT FROM v_plpgsql_oid/)
  assert.match(migration, /FINAL_ELIGIBILITY_COMMENT_MISMATCH/)
  assert.match(migration, /FINAL_ELIGIBILITY_ACL_ENTRY_MISMATCH/)
  assert.match(migration, /sync_zatca_atomic_checkout_branch_gates_v2\(uuid,uuid\)/)
  assert.match(migration, /FINAL_ELIGIBILITY_SYNC_DEPENDENCY_MISMATCH/)
  assert.match(migration, /get_zatca_atomic_checkout_eligibility_v2\(uuid,uuid\)/)
  assert.match(migration, /FINAL_ELIGIBILITY_EVALUATION_DEPENDENCY_MISMATCH/)
})

for (const { name, run } of tests) {
  try {
    await run()
    console.log(`ok - ${name}`)
  } catch (error) {
    failures += 1
    console.error(`not ok - ${name}`)
    console.error(error)
  }
}

if (failures > 0) {
  console.error(`${failures} final eligibility contract test(s) failed`)
  process.exit(1)
}
console.log('ZATCA Atomic Simplified final eligibility consolidation contracts passed.')
