import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/20260727000200_recover_atomic_checkout_gate_sync_definition.sql',
  ),
  'utf8',
)

const eligibilityStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.get_zatca_atomic_checkout_eligibility_v2(',
)
const eligibilityEnd = migration.indexOf('$function$;', eligibilityStart)
assert.ok(eligibilityStart >= 0 && eligibilityEnd > eligibilityStart)
const eligibilityBody = migration.slice(eligibilityStart, eligibilityEnd)

const functionStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.sync_zatca_atomic_checkout_branch_gates_v2(',
)
const functionEnd = migration.indexOf('$function$;', functionStart)
assert.ok(functionStart >= 0 && functionEnd > functionStart)
assert.ok(eligibilityStart < functionStart, 'eligibility must be created before synchronization')
const syncFunctionBody = migration.slice(functionStart, functionEnd)

assert.match(
  eligibilityBody,
  /get_zatca_atomic_checkout_eligibility_v2\(\s*p_branch_id uuid,\s*p_actor_user_id uuid DEFAULT NULL::uuid\s*\)/,
)
assert.match(eligibilityBody, /RETURNS jsonb\s+LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/)
assert.match(eligibilityBody, /SET search_path TO 'public', 'pg_temp'/)
assert.match(eligibilityBody, /SET row_security TO 'off'/)
assert.match(eligibilityBody, /IF NOT FOUND THEN\s+RAISE EXCEPTION 'BRANCH_NOT_FOUND'/)
assert.match(
  eligibilityBody,
  /b\.is_active AS branch_active[\s\S]*COALESCE\(t\.is_active, true\) AS tenant_active[\s\S]*t\.suspended_at/,
)
assert.match(
  eligibilityBody,
  /v_runtime\.schema_version = 2[\s\S]*v_runtime\.minimum_edge_version = '2\.1\.0'[\s\S]*v_runtime\.minimum_client_version = '2\.1\.0'/,
)
assert.match(
  eligibilityBody,
  /v_readiness_status = 'ready'[\s\S]*v_chain_head_exists[\s\S]*v_production_connected/,
)
assert.match(
  eligibilityBody,
  /h\.last_committed_counter >= 0[\s\S]*NULLIF\(btrim\(h\.last_committed_hash\), ''\) IS NOT NULL/,
)
assert.match(
  eligibilityBody,
  /c\.environment = 'production'[\s\S]*c\.onboarding_status = 'production_connected'[\s\S]*encrypted_production_csid[\s\S]*encrypted_production_secret/,
)
assert.match(
  eligibilityBody,
  /p_actor_user_id IS NULL OR c\.user_id = p_actor_user_id[\s\S]*p\.is_active = true[\s\S]*p\.tenant_id = v_branch\.tenant_id/,
)
assert.match(
  eligibilityBody,
  /p\.role::text IN \('owner', 'admin'\)[\s\S]*p\.role::text = 'branch' AND p\.branch_id = v_branch\.id/,
)
assert.match(
  eligibilityBody,
  /c\.client_version = v_runtime\.minimum_client_version[\s\S]*c\.edge_version = v_runtime\.minimum_edge_version[\s\S]*c\.schema_version = v_runtime\.schema_version[\s\S]*c\.expires_at > clock_timestamp\(\)/,
)

const blockingReasons = [
  'inactive_branch',
  'inactive_tenant',
  'tenant_suspended',
  'runtime_missing',
  'immutable_finalization_disabled',
  'simplified_finalization_disabled',
  'atomic_global_disabled',
  'schema_version_incompatible',
  'edge_version_incompatible',
  'client_version_incompatible',
  'explicitly_blocked',
  'readiness_missing',
  'branch_not_ready',
  'missing_chain_head',
  'missing_production_credentials',
  'missing_client_acknowledgement',
  'eligible',
]
let previousReasonIndex = -1
for (const reason of blockingReasons) {
  const reasonIndex = eligibilityBody.indexOf(`'${reason}'`, previousReasonIndex + 1)
  assert.ok(reasonIndex > previousReasonIndex, `blocking reason precedence missing: ${reason}`)
  previousReasonIndex = reasonIndex
}

function eligibilityReason(overrides = {}) {
  const state = {
    branchActive: true,
    tenantActive: true,
    tenantSuspended: false,
    runtimeFound: true,
    immutableEnabled: true,
    simplifiedEnabled: true,
    atomicEnabled: true,
    schemaVersion: 2,
    edgeVersion: '2.1.0',
    clientVersion: '2.1.0',
    readinessStatus: 'ready',
    chainHeadExists: true,
    productionConnected: true,
    acknowledgedUserId: 'user-id',
    ...overrides,
  }
  if (!state.branchActive) return 'inactive_branch'
  if (!state.tenantActive) return 'inactive_tenant'
  if (state.tenantSuspended) return 'tenant_suspended'
  if (!state.runtimeFound) return 'runtime_missing'
  if (!state.immutableEnabled) return 'immutable_finalization_disabled'
  if (!state.simplifiedEnabled) return 'simplified_finalization_disabled'
  if (!state.atomicEnabled) return 'atomic_global_disabled'
  if (state.schemaVersion !== 2) return 'schema_version_incompatible'
  if (state.edgeVersion !== '2.1.0') return 'edge_version_incompatible'
  if (state.clientVersion !== '2.1.0') return 'client_version_incompatible'
  if (state.readinessStatus === 'blocked') return 'explicitly_blocked'
  if (state.readinessStatus == null) return 'readiness_missing'
  if (state.readinessStatus !== 'ready') return 'branch_not_ready'
  if (!state.chainHeadExists) return 'missing_chain_head'
  if (!state.productionConnected) return 'missing_production_credentials'
  if (!state.acknowledgedUserId) return 'missing_client_acknowledgement'
  return 'eligible'
}

for (const [overrides, expected] of [
  [{ branchActive: false }, 'inactive_branch'],
  [{ tenantActive: false }, 'inactive_tenant'],
  [{ tenantSuspended: true }, 'tenant_suspended'],
  [{ runtimeFound: false }, 'runtime_missing'],
  [{ immutableEnabled: false }, 'immutable_finalization_disabled'],
  [{ simplifiedEnabled: false }, 'simplified_finalization_disabled'],
  [{ atomicEnabled: false }, 'atomic_global_disabled'],
  [{ schemaVersion: 3 }, 'schema_version_incompatible'],
  [{ edgeVersion: '2.0.0' }, 'edge_version_incompatible'],
  [{ clientVersion: '2.0.0' }, 'client_version_incompatible'],
  [{ readinessStatus: 'blocked' }, 'explicitly_blocked'],
  [{ readinessStatus: null }, 'readiness_missing'],
  [{ readinessStatus: 'pending' }, 'branch_not_ready'],
  [{ chainHeadExists: false }, 'missing_chain_head'],
  [{ productionConnected: false }, 'missing_production_credentials'],
  [{ acknowledgedUserId: null }, 'missing_client_acknowledgement'],
  [{}, 'eligible'],
]) {
  assert.equal(eligibilityReason(overrides), expected)
}

const eligibilityReturn = eligibilityBody.slice(
  eligibilityBody.indexOf('RETURN jsonb_build_object('),
)
const eligibilityKeys = new Set(
  [...eligibilityReturn.matchAll(/^    '([A-Za-z][A-Za-z0-9]+)',/gm)]
    .map(match => match[1]),
)
assert.deepEqual(eligibilityKeys, new Set([
  'tenantId',
  'branchId',
  'branchName',
  'branchActive',
  'tenantActive',
  'tenantSuspended',
  'immutableFinalizationEnabled',
  'simplifiedEnabled',
  'atomicGlobalEnabled',
  'standardEnabled',
  'schemaCompatible',
  'edgeVersionCompatible',
  'clientVersionCompatible',
  'readinessStatus',
  'readinessReason',
  'branchReady',
  'branchBlocked',
  'chainHeadExists',
  'productionConnected',
  'clientAcknowledged',
  'acknowledgedUserId',
  'staticReady',
  'eligible',
  'blockingReason',
]))
assert.doesNotMatch(
  eligibilityReturn,
  /encrypted_production|production_secret|production_csid|private_key|certificate/i,
)
assert.equal((eligibilityBody.match(/v_runtime\.standard_enabled/g) ?? []).length, 1)
assert.ok(
  eligibilityBody.indexOf('v_runtime.standard_enabled')
    > eligibilityBody.indexOf('RETURN jsonb_build_object('),
  'standardEnabled must be informational output only',
)
assert.match(
  migration,
  /ALTER FUNCTION public\.get_zatca_atomic_checkout_eligibility_v2\(uuid, uuid\)\s+OWNER TO postgres/,
)
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.get_zatca_atomic_checkout_eligibility_v2\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.get_zatca_atomic_checkout_eligibility_v2\(uuid, uuid\)\s+TO service_role/,
)
assert.match(
  migration,
  /Service-only, read-only Atomic Simplified eligibility evaluation with exact blocking reason\./,
)
assert.match(migration, /RECOVERED_ELIGIBILITY_SIGNATURE_MISSING/)
assert.match(migration, /RECOVERED_ELIGIBILITY_CONTRACT_OR_METADATA_MISMATCH/)
assert.match(migration, /RECOVERED_ELIGIBILITY_RUNTIME_CONFIGURATION_MISMATCH/)
assert.match(migration, /RECOVERED_ELIGIBILITY_ACL_MISMATCH/)
assert.match(migration, /RECOVERED_ELIGIBILITY_ACL_ENTRY_MISMATCH/)

assert.match(
  migration,
  /sync_zatca_atomic_checkout_branch_gates_v2\(\s*p_branch_id uuid DEFAULT NULL::uuid,\s*p_actor_user_id uuid DEFAULT NULL::uuid\s*\)/,
)
for (const output of [
  'tenant_id uuid',
  'branch_id uuid',
  'branch_name text',
  'previous_gate_state boolean',
  'resulting_gate_state boolean',
  'readiness_result boolean',
  'blocking_reason text',
  'action text',
]) {
  assert.match(migration, new RegExp(`\\b${output.replace(' ', '\\s+')}\\b`))
}
assert.match(migration, /LANGUAGE plpgsql\s+SECURITY DEFINER/)
assert.match(migration, /SET search_path TO 'public', 'pg_temp'/)
assert.match(migration, /SET row_security TO 'off'/)
assert.match(migration, /ALTER FUNCTION public\.sync_zatca_atomic_checkout_branch_gates_v2\(uuid, uuid\)\s+OWNER TO postgres/)
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.sync_zatca_atomic_checkout_branch_gates_v2\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.sync_zatca_atomic_checkout_branch_gates_v2\(uuid, uuid\)\s+TO service_role/,
)
assert.match(
  migration,
  /Service-only idempotent Atomic Simplified branch-gate synchronization\. Never changes Standard enablement\./,
)

function synchronizeGate({
  exists,
  previous = null,
  eligible,
  staticReady,
  blockingReason,
}) {
  const desired = eligible || (
    exists
    && previous === true
    && staticReady
    && blockingReason === 'missing_client_acknowledgement'
  )
  return {
    previousGateState: exists ? previous : null,
    resultingGateState: desired,
    readinessResult: eligible,
    blockingReason,
    action: !exists ? 'inserted' : previous !== desired ? 'updated' : 'unchanged',
  }
}

assert.deepEqual(
  synchronizeGate({
    exists: false,
    eligible: false,
    staticReady: false,
    blockingReason: 'branch_not_ready',
  }),
  {
    previousGateState: null,
    resultingGateState: false,
    readinessResult: false,
    blockingReason: 'branch_not_ready',
    action: 'inserted',
  },
)

assert.deepEqual(
  synchronizeGate({
    exists: true,
    previous: false,
    eligible: true,
    staticReady: true,
    blockingReason: 'eligible',
  }),
  {
    previousGateState: false,
    resultingGateState: true,
    readinessResult: true,
    blockingReason: 'eligible',
    action: 'updated',
  },
)

assert.equal(
  synchronizeGate({
    exists: true,
    previous: true,
    eligible: true,
    staticReady: true,
    blockingReason: 'eligible',
  }).action,
  'unchanged',
)

assert.deepEqual(
  synchronizeGate({
    exists: true,
    previous: true,
    eligible: false,
    staticReady: true,
    blockingReason: 'missing_client_acknowledgement',
  }),
  {
    previousGateState: true,
    resultingGateState: true,
    readinessResult: false,
    blockingReason: 'missing_client_acknowledgement',
    action: 'unchanged',
  },
)

assert.deepEqual(
  new Set(
    [...syncFunctionBody.matchAll(/v_action := '(inserted|updated|unchanged)'/g)]
      .map(match => match[1]),
  ),
  new Set(['inserted', 'updated', 'unchanged']),
)
assert.match(
  syncFunctionBody,
  /IF NOT v_gate_exists THEN[\s\S]*INSERT INTO public\.zatca_atomic_checkout_branch_gates_v2/,
)
assert.match(
  syncFunctionBody,
  /ELSIF v_previous IS DISTINCT FROM v_desired THEN[\s\S]*UPDATE public\.zatca_atomic_checkout_branch_gates_v2/,
)
assert.match(syncFunctionBody, /ELSE\s+v_action := 'unchanged';\s+END IF;/)
assert.doesNotMatch(syncFunctionBody, /standard_enabled|standardEnabled|standard_enabled\s*=/i)
assert.match(
  syncFunctionBody,
  /'atomic-simplified-gate:' \|\| v_branch\.tenant_id::text \|\| ':' \|\| v_branch\.id::text/,
)
assert.match(
  syncFunctionBody,
  /pg_advisory_xact_lock\(hashtextextended\([\s\S]*'atomic-simplified-gate:'[\s\S]*,\s*0\s*\)\)/,
)
assert.match(
  syncFunctionBody,
  /FROM public\.zatca_atomic_checkout_branch_gates_v2 g[\s\S]*FOR UPDATE/,
)
assert.match(
  syncFunctionBody,
  /public\.get_zatca_atomic_checkout_eligibility_v2\(\s*v_branch\.id,\s*p_actor_user_id\s*\)/,
)
assert.match(
  syncFunctionBody,
  /v_reason = 'missing_client_acknowledgement'/,
)
assert.match(migration, /RECOVERED_GATE_SYNC_SIGNATURE_MISSING/)
assert.match(migration, /RECOVERED_GATE_SYNC_ARGUMENT_OR_RETURN_CONTRACT_MISMATCH/)
assert.match(migration, /RECOVERED_GATE_SYNC_RUNTIME_CONFIGURATION_MISMATCH/)
assert.match(migration, /RECOVERED_GATE_SYNC_ACL_MISMATCH/)
assert.match(migration, /RECOVERED_GATE_SYNC_ACL_ENTRY_MISMATCH/)
assert.match(migration, /v_function\.prorettype IS DISTINCT FROM 'record'::regtype::oid/)
assert.match(migration, /v_function\.proretset IS DISTINCT FROM true/)
assert.match(migration, /has_function_privilege\(0, v_function_oid, 'EXECUTE'\)/)
assert.equal((migration.match(/OR acl\.is_grantable/g) ?? []).length, 2)

console.log(
  'ZATCA atomic eligibility and branch-gate synchronizer recovery: exact contracts, precedence, state transitions, locking, and ACL assertions passed',
)
