import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const migrationPath = join(
  root,
  'supabase/migrations/20260727000100_consolidate_atomic_checkout_preflight_v2.sql',
)
const migration = readFileSync(migrationPath, 'utf8')
const edge = readFileSync(join(root, 'supabase/functions/zatca-submit/index.ts'), 'utf8')
const atomicMigration = readFileSync(
  join(root, 'supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql'),
  'utf8',
)

let failures = 0
function test(name, run) {
  try {
    run()
    console.log(`ok - ${name}`)
  } catch (error) {
    failures += 1
    console.error(`not ok - ${name}`)
    console.error(error)
  }
}

test('unauthenticated caller is rejected from auth.uid()', () => {
  assert.match(migration, /v_actor_user_id uuid := auth\.uid\(\)/)
  assert.match(migration, /IF v_actor_user_id IS NULL THEN[\s\S]*'authorization_failed'[\s\S]*'unauthenticated'/)
  assert.doesNotMatch(migration, /p_actor_user_id|p_tenant_id|p_actor_role/)
})

test('null document type is rejected explicitly', () => {
  assert.match(migration, /p_document_type IS NULL[\s\S]*p_document_type NOT IN \('invoice', 'credit_note'\)/)
  assert.match(migration, /'code', 'INVALID_ATOMIC_CHECKOUT_REQUEST'/)
})

test('inactive or missing profile is rejected', () => {
  assert.match(migration, /FROM public\.user_profiles[\s\S]*id = v_actor_user_id[\s\S]*is_active = true/)
  assert.match(migration, /NOT FOUND OR v_profile\.role::text NOT IN \('owner', 'admin', 'branch'\)/)
  assert.match(migration, /'caller_profile_not_found'/)
})

test('tenant owner and admin are limited to their own tenant', () => {
  assert.match(migration, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/)
  assert.match(migration, /v_profile\.role::text NOT IN \('owner', 'admin', 'branch'\)/)
})

test('branch user is limited to the assigned branch', () => {
  assert.match(migration, /v_profile\.role::text = 'branch'[\s\S]*v_profile\.branch_id IS DISTINCT FROM v_branch\.id/)
})

test('cross-tenant branch access returns a safe denial', () => {
  assert.match(migration, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id[\s\S]*'branch_access_denied'/)
})

test('committed atomic replay returns safe identity only after scope checks', () => {
  const authz = migration.indexOf("reason', 'branch_access_denied'")
  const intent = migration.indexOf('FROM public.zatca_atomic_checkout_intents_v2')
  const replay = migration.indexOf("'status', 'committed'")
  assert.ok(authz > 0 && intent > authz && replay > intent)
  assert.match(migration, /actor_user_id = v_actor_user_id[\s\S]*branch_id = v_branch\.id[\s\S]*idempotency_key = v_idempotency_key/)
  assert.match(migration, /'invoiceId', v_intent\.invoice_id[\s\S]*'idempotentReplay', true/)
  assert.doesNotMatch(migration, /'receipt', v_intent\.receipt_payload/)
})

test('fingerprint or document mismatch returns conflict', () => {
  assert.match(migration, /v_intent\.cart_fingerprint IS DISTINCT FROM v_cart_fingerprint/)
  assert.match(migration, /v_intent\.document_type IS DISTINCT FROM p_document_type/)
  assert.match(migration, /'status', 'conflict'[\s\S]*'ATOMIC_CHECKOUT_IDEMPOTENCY_CONFLICT'/)
})

test('legacy idempotency compatibility is preserved for invoice and credit note', () => {
  assert.match(migration, /credit_note_idempotency_key = v_idempotency_key/)
  assert.match(migration, /checkout_idempotency_key = v_idempotency_key/)
  assert.match(migration, /'reason', 'existing_legacy_idempotency'/)
})

test('disabled runtime returns unavailable with the existing legacy reason', () => {
  assert.match(migration, /immutable_finalization_enabled/)
  assert.match(migration, /simplified_enabled/)
  assert.match(migration, /atomic_simplified_checkout_enabled/)
  assert.match(migration, /'status', 'unavailable'[\s\S]*'reason', 'atomic_rollout_disabled'[\s\S]*'atomic_global_disabled'/)
})

test('final branch gate decision remains an Edge prerequisite', () => {
  assert.doesNotMatch(migration, /FROM public\.zatca_atomic_checkout_branch_gates_v2 AS gate/)
  assert.match(migration, /'status', 'preflight_ok'/)
  const handler = edge.indexOf("if (action === 'checkout_simplified'")
  assert.ok(edge.indexOf('syncAtomicSimplifiedEligibilityV2(', handler) > handler)
  assert.ok(edge.indexOf('loadAtomicSimplifiedRolloutV2(', handler) > handler)
})

test('final readiness decision and blocking reason remain in Edge after sync', () => {
  assert.doesNotMatch(migration, /'reason', 'atomic_branch_not_ready'/)
  const handler = edge.indexOf("if (action === 'checkout_simplified'")
  const sync = edge.indexOf('syncAtomicSimplifiedEligibilityV2(', handler)
  const rolloutReload = edge.indexOf('loadAtomicSimplifiedRolloutV2(', sync)
  const readinessDecision = edge.indexOf('if (!readiness.structurallyReady', rolloutReload)
  assert.ok(sync > handler && rolloutReload > sync && readinessDecision > rolloutReload)
  assert.match(edge.slice(readinessDecision, readinessDecision + 700), /eligibilitySync\?\.blockingReason/)
})

test('capability version and five-minute acknowledgement TTL are enforced', () => {
  assert.match(migration, /v_expected_schema_version constant integer := 2/)
  assert.match(migration, /v_expected_client_version constant text := '2\.1\.0'/)
  assert.match(migration, /v_expected_edge_version constant text := '2\.1\.0'/)
  assert.match(migration, /v_runtime\.minimum_client_version IS DISTINCT FROM v_expected_client_version/)
  assert.match(migration, /v_runtime\.minimum_edge_version IS DISTINCT FROM v_expected_edge_version/)
  assert.match(migration, /p_client_version IS DISTINCT FROM v_expected_client_version/)
  assert.match(migration, /p_edge_version IS DISTINCT FROM v_expected_edge_version/)
  assert.match(migration, /acknowledge_zatca_client_capability_v2\([\s\S]*p_client_version,[\s\S]*p_edge_version,[\s\S]*300/)
  assert.match(migration, /get_zatca_branch_readiness_v2\([\s\S]*v_actor_user_id/)
  assert.match(edge, /p_client_version: input\.clientVersion/)
  assert.match(edge, /clientVersion: requestClientVersion/)
  assert.match(edge, /p_edge_version: FINALIZATION_EDGE_VERSION/)
  assert.doesNotMatch(edge, /p_client_version: FINALIZATION_CLIENT_VERSION/)
})

test('rate limiting remains outside the RPC with exact serial HTTP 429 behavior', () => {
  assert.doesNotMatch(migration, /public\.consume_rate_limit\(/)
  const handler = edge.indexOf("if (action === 'checkout_simplified'")
  const rate = edge.indexOf("enforceRateLimit(supabase as any", handler)
  const rateResponse = edge.indexOf('return jsonResponse(rateLimitBody(rate), 429)', rate)
  assert.ok(rate > handler && rateResponse > rate)
})

test('caller request ID and IP cannot enter trusted audit evidence through the RPC', () => {
  assert.doesNotMatch(migration, /public\.record_audit_event\(/)
  assert.doesNotMatch(migration, /v_request_id|v_ip_hash/)
  assert.equal((migration.match(/p_request_id/g) ?? []).length, 0)
  assert.equal((migration.match(/p_ip_hash/g) ?? []).length, 0)
  const handler = edge.indexOf("if (action === 'checkout_simplified'")
  const attemptAudit = edge.indexOf("action: 'zatca_atomic_checkout_attempted'", handler)
  assert.ok(attemptAudit > handler)
})

test('safe outputs contain no artifacts, credentials, or secrets', () => {
  assert.doesNotMatch(migration, /receipt_payload->|'signedXml'|'xml'|'qr'|'credential'|'secret'|'privateKey'|'certificate'/i)
  assert.doesNotMatch(migration, /encrypted_private_key|encrypted_production_csid|encrypted_production_secret/)
  assert.doesNotMatch(migration, /SQLERRM|PG_EXCEPTION|GET STACKED DIAGNOSTICS/)
  assert.match(migration, /EXCEPTION WHEN OTHERS THEN[\s\S]*'ATOMIC_CHECKOUT_PREFLIGHT_FAILED'/)
})

test('function grants and search_path are hardened', () => {
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/)
  assert.match(migration, /ALTER FUNCTION public\.preflight_zatca_atomic_checkout_v2\([\s\S]*\) OWNER TO postgres;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.preflight_zatca_atomic_checkout_v2\([\s\S]*\) FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.preflight_zatca_atomic_checkout_v2\([\s\S]*\) TO authenticated;/)
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]*TO (?:anon|PUBLIC|service_role)/)
})

test('enabled consolidated preflight still requires every Edge safety prerequisite', () => {
  assert.match(edge, /const CONSOLIDATED_ATOMIC_PREFLIGHT_ENABLED = true/)
  assert.match(edge, /function consolidatedAtomicPreflightEnabled\(\)[\s\S]*parseImmutableFinalizationEdgeSwitch\([\s\S]*ZATCA_IMMUTABLE_FINALIZATION_ENABLED[\s\S]*CONSOLIDATED_ATOMIC_PREFLIGHT_ENABLED && edgeSwitch\.edgeExecutionEnabled/)
  const enabledCheck = edge.indexOf('partialCheckoutAction && consolidatedAtomicPreflightEnabled()')
  const invoke = edge.indexOf('await invokePartialAtomicPreflight(', enabledCheck)
  assert.ok(enabledCheck > 0 && invoke > enabledCheck)
  const handler = edge.indexOf("if (action === 'checkout_simplified'")
  const rollout = edge.indexOf('loadAtomicSimplifiedRolloutV2(', handler)
  const readiness = edge.indexOf('loadBranchReadinessV2(', rollout)
  const eligibility = edge.indexOf('syncAtomicSimplifiedEligibilityV2(', readiness)
  const gate = edge.indexOf('const atomicRolloutEnabled =', eligibility)
  const rateLimit = edge.indexOf('enforceRateLimit(supabase as any', gate)
  const audit = edge.indexOf("action: 'zatca_atomic_checkout_attempted'", rateLimit)
  const issuance = edge.indexOf('await processAtomicSimplifiedCheckoutV2(', audit)
  assert.ok(
    handler > invoke && rollout > handler && readiness > rollout
      && eligibility > readiness && gate > eligibility && rateLimit > gate
      && audit > rateLimit && issuance > audit,
  )
  const processStart = edge.indexOf('async function processAtomicSimplifiedCheckoutV2(')
  const prepare = edge.indexOf("serviceDb.rpc('prepare_zatca_atomic_checkout_v2'", processStart)
  const signing = edge.indexOf('signInvoice(', prepare)
  const storage = edge.indexOf("serviceDb.rpc('store_zatca_atomic_checkout_artifact_v2'", signing)
  const commit = edge.indexOf("callerDb.rpc('commit_zatca_atomic_checkout_v2'", storage)
  assert.ok(processStart > 0 && prepare > processStart && signing > prepare && storage > signing && commit > storage)
})

test('enabled partial path removes only consolidated calls after preflight_ok', () => {
  const partialStart = edge.indexOf('if (usePartialPreflight)')
  const serialStart = edge.indexOf('if (!usePartialPreflight)', partialStart)
  assert.ok(partialStart > 0 && serialStart > partialStart)
  const serialBlock = edge.slice(serialStart, edge.indexOf('// ── GET /debug', serialStart))
  assert.match(serialBlock, /authClient\.auth\.getUser/)
  assert.match(serialBlock, /loadCallerProfile/)
  assert.match(edge, /capabilities = capabilities \?\?/)
  assert.match(edge, /usePartialPreflight && partialPreflight\?\.status === 'preflight_ok'[\s\S]*authorizeBranchAccess/)
  assert.match(edge, /if \(!usePartialPreflight && checkoutIdempotencyKey\)/)
  assert.match(migration, /'status', 'preflight_ok'[\s\S]*'actorUserId'[\s\S]*'tenantId'[\s\S]*'branchId'[\s\S]*'actorRole'/)
  assert.doesNotMatch(migration, /'status', 'proceed'/)
})

test('committed replay still returns the original printable receipt through the serial lookup', () => {
  const handler = edge.indexOf("if (action === 'checkout_simplified'")
  const lookup = edge.indexOf("rpc('get_zatca_atomic_checkout_result_v2'", handler)
  const committed = edge.indexOf("existing.status === 'committed' && existing.receipt", lookup)
  const receipt = edge.indexOf('receipt: existing.receipt', committed)
  assert.ok(lookup > handler && committed > lookup && receipt > committed)
  assert.match(edge.slice(committed, receipt + 100), /canPrint: true/)
  assert.match(edge.slice(committed, receipt + 100), /reportingDisplayState/)
})

test('serial error mapping remains present and dependency failures are safe', () => {
  for (const code of [
    'INVALID_ATOMIC_CHECKOUT_REQUEST',
    'ATOMIC_SIMPLIFIED_CHECKOUT_UNAVAILABLE',
    'ATOMIC_CHECKOUT_IDEMPOTENCY_CONFLICT',
    'ATOMIC_CHECKOUT_IDEMPOTENCY_IN_PROGRESS',
    'ATOMIC_CHECKOUT_IDEMPOTENCY_LOOKUP_FAILED',
  ]) {
    assert.ok(edge.includes(code) || migration.includes(code), `missing ${code}`)
  }
  assert.match(migration, /WHEN TOO_MANY_ROWS OR UNDEFINED_COLUMN OR UNDEFINED_TABLE THEN[\s\S]*ATOMIC_CHECKOUT_IDEMPOTENCY_LOOKUP_FAILED/)
  assert.match(migration, /EXCEPTION WHEN OTHERS THEN[\s\S]*ATOMIC_CHECKOUT_PREFLIGHT_FAILED/)
})

test('prepare and commit defenses remain in the applied atomic migration', () => {
  assert.match(atomicMigration, /CREATE OR REPLACE FUNCTION public\.prepare_zatca_atomic_checkout_v2/)
  assert.match(atomicMigration, /CREATE OR REPLACE FUNCTION public\.commit_zatca_atomic_checkout_v2/)
  assert.match(atomicMigration, /ATOMIC_SIMPLIFIED_CHECKOUT_NOT_READY/)
  assert.match(atomicMigration, /ATOMIC_CHECKOUT_SNAPSHOT_CHANGED/)
  assert.match(atomicMigration, /INSERT INTO public\.zatca_reporting_outbox_v2/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:prepare|commit)_zatca_atomic_checkout_v2/)
})

test('standard and legacy actions cannot enter partial preflight', () => {
  assert.match(
    edge,
    /const partialCheckoutAction = earlyAction === 'checkout_simplified'\s*\|\| earlyAction === 'checkout_simplified_credit_note'/,
  )
  assert.doesNotMatch(
    edge.match(/const partialCheckoutAction[\s\S]*?let usePartialPreflight =/)[0],
    /checkout_standard|legacy/,
  )
  assert.match(edge, /if \(action === 'finalize'\)/)
  assert.match(edge, /const compatibleStatusRequest = action === 'status'/)
})

test('reporting remains unawaited and success remains after atomic commit', () => {
  const processStart = edge.indexOf('async function processAtomicSimplifiedCheckoutV2(')
  const processEnd = edge.indexOf('\nasync function processInvoiceV2(', processStart)
  const processSource = edge.slice(processStart, processEnd)
  const commit = processSource.indexOf("callerDb.rpc('commit_zatca_atomic_checkout_v2'")
  const reporting = processSource.indexOf('scheduleReportingOutboxDrain(', commit)
  const success = processSource.indexOf("status: 'committed'", reporting)
  assert.ok(commit > 0 && reporting > commit && success > reporting)
  assert.doesNotMatch(processSource.slice(reporting - 30, reporting + 80), /await\s+scheduleReportingOutboxDrain/)
  assert.match(processSource.slice(commit, reporting), /committed\.status !== 'committed'/)
})

if (failures > 0) process.exit(1)
console.log('ZATCA authenticated atomic preflight consolidation contracts passed.')
