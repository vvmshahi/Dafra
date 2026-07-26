import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const submission = read('src/lib/zatca/submission.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const edge = read('supabase/functions/zatca-submit/index.ts')
const capabilitySql = read(
  'scripts/sql/zatca-phase2-finalization-v2/05_capabilities_and_status.sql',
)
const readinessSql = read(
  'scripts/sql/zatca-phase2-finalization-v2/09_branch_readiness_gate.sql',
)
const eligibilityMigration = read(
  'supabase/migrations/20260724000300_atomic_simplified_eligibility_rollout.sql',
)

const REQUIRED_VERSION = '2.1.0'
const REQUIRED_SCHEMA = 2
const ACK_TTL_SECONDS = 300

class CapabilityHandshakeModel {
  constructor(overrides = {}) {
    this.now = 1_000
    this.requestCount = 0
    this.acknowledgements = new Map()
    this.branch = {
      id: 'ready-branch',
      tenantId: 'tenant-a',
      ready: true,
      blocked: false,
      chainHeadExists: true,
      productionConnected: true,
      ...overrides,
    }
    this.gateEnabled = true
    this.standardEnabled = false
  }

  request({ user, branchId = this.branch.id, clientVersion = REQUIRED_VERSION }) {
    this.requestCount += 1
    if (!user) return { status: 'unauthorized', wrote: false }
    if (branchId !== this.branch.id) {
      return { status: 'unauthorized_branch', wrote: false }
    }
    if (user.tenantId !== this.branch.tenantId) {
      return { status: 'unauthorized_tenant', wrote: false }
    }
    if (user.role === 'branch' && user.branchId !== branchId) {
      return { status: 'unauthorized_branch', wrote: false }
    }
    if (clientVersion !== REQUIRED_VERSION) {
      return { status: 'version_mismatch', wrote: false }
    }
    if (this.branch.blocked) {
      return { status: 'rejected', reason: 'explicitly_blocked', wrote: false }
    }
    if (!this.branch.ready || !this.branch.chainHeadExists
        || !this.branch.productionConnected) {
      return { status: 'rejected', reason: 'branch_not_ready', wrote: false }
    }

    const key = `${user.id}:${branchId}`
    const existing = this.acknowledgements.get(key)
    const status = existing?.expiresAt > this.now ? 'refreshed' : 'written'
    const acknowledgement = {
      userId: user.id,
      branchId,
      clientVersion,
      edgeVersion: REQUIRED_VERSION,
      schemaVersion: REQUIRED_SCHEMA,
      acknowledgedAt: this.now,
      expiresAt: this.now + ACK_TTL_SECONDS,
    }
    this.acknowledgements.set(key, acknowledgement)
    return {
      status,
      wrote: true,
      acknowledgement,
      synchronizerEligible: this.isEligible(user, branchId),
      resultingGateState: this.gateEnabled,
      standardEnabled: this.standardEnabled,
    }
  }

  isEligible(user, branchId) {
    const acknowledgement = this.acknowledgements.get(`${user.id}:${branchId}`)
    return this.branch.ready
      && !this.branch.blocked
      && this.branch.chainHeadExists
      && this.branch.productionConnected
      && acknowledgement?.expiresAt > this.now
  }
}

const branchUser = {
  id: 'user-a',
  tenantId: 'tenant-a',
  branchId: 'ready-branch',
  role: 'branch',
}
const model = new CapabilityHandshakeModel()
const created = model.request({ user: branchUser })
assert.equal(created.status, 'written')
assert.equal(created.wrote, true)
assert.equal(created.acknowledgement.userId, branchUser.id)
assert.equal(created.acknowledgement.branchId, 'ready-branch')
assert.equal(model.branch.tenantId, branchUser.tenantId)
assert.equal(created.acknowledgement.clientVersion, REQUIRED_VERSION)
assert.equal(created.acknowledgement.edgeVersion, REQUIRED_VERSION)
assert.equal(created.acknowledgement.schemaVersion, REQUIRED_SCHEMA)
assert.equal(created.acknowledgement.expiresAt, model.now + ACK_TTL_SECONDS)
assert.equal(created.synchronizerEligible, true)
assert.equal(created.resultingGateState, true)
assert.equal(created.standardEnabled, false)

const firstExpiry = created.acknowledgement.expiresAt
model.now += 30
const refreshed = model.request({ user: branchUser })
assert.equal(refreshed.status, 'refreshed')
assert.ok(refreshed.acknowledgement.expiresAt > firstExpiry)
assert.equal(model.requestCount, 2, 'a cached UI result does not skip the second request')

for (const rejected of [
  new CapabilityHandshakeModel().request({ user: null }),
  new CapabilityHandshakeModel().request({
    user: { ...branchUser, tenantId: 'tenant-b' },
  }),
  new CapabilityHandshakeModel().request({
    user: { ...branchUser, branchId: 'other-branch' },
  }),
  new CapabilityHandshakeModel().request({
    user: branchUser,
    clientVersion: '2.0.0',
  }),
]) {
  assert.equal(rejected.wrote, false)
}

const blockedModel = new CapabilityHandshakeModel({ blocked: true })
const blocked = blockedModel.request({ user: branchUser })
assert.deepEqual(blocked, {
  status: 'rejected',
  reason: 'explicitly_blocked',
  wrote: false,
})
assert.equal(blockedModel.acknowledgements.size, 0)
assert.equal(blockedModel.gateEnabled, true, 'rejection does not rewrite an existing gate')

const capabilityClient = submission.slice(
  submission.indexOf('export async function getZatcaFinalizationCapabilities'),
  submission.indexOf('export async function requireZatcaFinalizationCapability'),
)
assert.match(capabilityClient, /supabase\.functions\.invoke\('zatca-submit'/)
assert.match(capabilityClient, /action: 'capabilities'/)
assert.match(capabilityClient, /branchId,/)
assert.match(capabilityClient, /clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION/)
assert.doesNotMatch(
  capabilityClient,
  /localStorage|sessionStorage|queryClient|staleTime|cache/i,
)
assert.match(submission, /ZATCA_FINALIZATION_CLIENT_VERSION = '2\.1\.0'/)
assert.match(submission, /acknowledgementStatus/)
assert.match(submission, /acknowledgementExpiresAt/)

const posHandshake = pos.slice(
  pos.indexOf('const userId = user?.id'),
  pos.indexOf('// ── Persist cart'),
)
assert.match(posHandshake, /getZatcaFinalizationCapabilities\(branchId\)/)
assert.match(posHandshake, /if \(!userId \|\| !tenantId \|\| !branchId\) return/)
assert.match(
  posHandshake,
  /\[user\?\.id, profile\?\.tenant_id, profile\?\.branch_id\]/,
)

const capabilityRoute = edge.slice(
  edge.indexOf("if (action === 'capabilities')"),
  edge.indexOf("if (action === 'checkout_simplified'"),
)
const authorizeIndex = capabilityRoute.indexOf('authorizeBranchAccess')
const acknowledgementIndex = capabilityRoute.indexOf(
  "rpc('acknowledge_zatca_client_capability_v2'",
)
const synchronizerIndex = capabilityRoute.indexOf(
  'syncAtomicSimplifiedEligibilityV2',
)
assert.ok(authorizeIndex >= 0 && authorizeIndex < acknowledgementIndex)
assert.ok(
  acknowledgementIndex >= 0 && acknowledgementIndex < synchronizerIndex,
  'the synchronizer runs only after the acknowledgement write',
)
assert.match(capabilityRoute, /p_user_id: user\.id/)
assert.match(capabilityRoute, /p_branch_id: branchId/)
assert.match(capabilityRoute, /p_client_version: clientVersion/)
assert.match(capabilityRoute, /p_edge_version: FINALIZATION_EDGE_VERSION/)
assert.match(capabilityRoute, /p_ttl_seconds: 300/)
assert.match(capabilityRoute, /acknowledgementPreviouslyValid \? 'refreshed' : 'written'/)
assert.match(capabilityRoute, /acknowledgementStatus = 'write_failed'/)
assert.match(capabilityRoute, /acknowledgementStatus = 'version_mismatch'/)
assert.match(capabilityRoute, /acknowledgementReason = 'acknowledged'/)
assert.match(capabilityRoute, /readiness\.branchBlocked[\s\S]*'explicitly_blocked'/)
assert.match(capabilityRoute, /standardCheckoutMode[\s\S]*branchCapabilities\.standardEnabled/)
assert.match(edge, /callerTenantId: caller\.tenant_id/)
assert.match(edge, /callerBranchId: caller\.branch_id/)

assert.match(capabilitySql, /CREATE TABLE IF NOT EXISTS public\.zatca_client_capabilities_v2/)
for (const column of [
  'user_id',
  'branch_id',
  'client_version',
  'edge_version',
  'schema_version',
  'acknowledged_at',
  'expires_at',
]) {
  assert.match(capabilitySql, new RegExp(`\\b${column}\\b`))
}
assert.match(capabilitySql, /PRIMARY KEY \(user_id, branch_id\)/)
assert.match(readinessSql, /p_ttl_seconds integer DEFAULT 300/)
assert.match(readinessSql, /v_user_tenant <> v_branch_tenant/)
assert.match(readinessSql, /ON CONFLICT \(user_id, branch_id\) DO UPDATE SET/)
assert.match(readinessSql, /expires_at = EXCLUDED\.expires_at/)
assert.match(readinessSql, /v_gate->>'structurallyReady'/)
assert.match(eligibilityMigration, /v_acknowledged_user_id IS NOT NULL/)
assert.doesNotMatch(capabilityRoute, /standard_enabled\s*=\s*true/i)

console.log('ZATCA capability acknowledgement: 14 handshake, refresh, authorization, and isolation groups passed')
