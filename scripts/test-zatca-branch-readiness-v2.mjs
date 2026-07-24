import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { selectZatcaBranchCheckoutMode } from '../supabase/functions/_shared/zatca/branch_readiness.mjs'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const migration = read('scripts/sql/zatca-phase2-finalization-v2/09_branch_readiness_gate.sql')
const verification = read('scripts/sql/zatca-phase2-finalization-v2/10_branch_readiness_verification.sql')
const seed = read('scripts/sql/zatca-phase2-finalization-v2/operator/seed_reviewed_branch_1_and_block_branch_2.sql')
const activation = read('scripts/sql/zatca-phase2-finalization-v2/operator/activate_simplified_branch_gate.sql')
const rollback = read('scripts/sql/zatca-phase2-finalization-v2/operator/rollback_global_master_false.sql')
const cleanup = read('scripts/sql/zatca-phase2-finalization-v2/operator/cleanup_expired_capability_rows.sql')
const edge = read('supabase/functions/zatca-submit/index.ts')
const onboarding = read('supabase/functions/zatca-onboard-production/index.ts')
const client = read('src/lib/zatca/submission.ts')
const pos = read('src/pages/pos/POSPage.tsx')

const ready = {
  compatible: true,
  globalMasterEnabled: true,
  simplifiedEnabled: true,
  edgeExecutionEnabled: true,
  clientAcknowledged: true,
  chainHeadExists: true,
  branchReady: true,
  branchBlocked: false,
  productionConnected: true,
}

assert.equal(selectZatcaBranchCheckoutMode(ready), 'v2', 'reviewed branch 1 must select v2')
assert.equal(
  selectZatcaBranchCheckoutMode({ ...ready, chainHeadExists: false, branchReady: false }),
  'legacy',
  'branch 2 without a head must remain legacy',
)
assert.equal(
  selectZatcaBranchCheckoutMode({ ...ready, chainHeadExists: true, branchReady: true }),
  'v2',
  'new onboarding-initialized branch must select v2',
)
assert.equal(
  selectZatcaBranchCheckoutMode({ ...ready, chainHeadExists: false }),
  'legacy',
  'new uninitialized branch must select legacy',
)
assert.equal(
  selectZatcaBranchCheckoutMode({ ...ready, globalMasterEnabled: false }),
  'legacy',
  'global rollback must return every branch to legacy',
)
assert.equal(
  selectZatcaBranchCheckoutMode({ ...ready, clientAcknowledged: false }),
  'legacy',
  'stale or missing acknowledgement must select legacy',
)
assert.equal(
  selectZatcaBranchCheckoutMode({
    ...ready,
    chainHeadExists: false,
    branchReady: false,
    globalMasterEnabled: true,
    simplifiedEnabled: true,
  }),
  'legacy',
  'global flags cannot override missing branch readiness',
)
assert.equal(
  selectZatcaBranchCheckoutMode({ ...ready, branchBlocked: true }),
  'legacy',
  'an explicit branch block must override every positive signal',
)

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.zatca_branch_readiness_v2/)
assert.match(migration, /readiness_status IN \('ready', 'blocked'\)/)
assert.match(migration, /get_zatca_branch_readiness_v2/)
assert.match(migration, /clientAcknowledged/)
assert.match(migration, /initialize_zatca_new_branch_chain_v2/)
assert.match(migration, /last_committed_counter, last_committed_hash[\s\S]*0, v_first_hash/)
assert.match(migration, /Invoice existence is used only to reject automatic new-unit initialization/)
assert.doesNotMatch(migration, /count\(\*\)\s*\+\s*1|MAX\([^)]*\)\s*\+\s*1/i)

const claimGate = migration.indexOf('CREATE OR REPLACE FUNCTION public.claim_zatca_finalization_v2(')
const claimUnchecked = migration.indexOf('RETURN public.claim_zatca_finalization_v2_unchecked', claimGate)
const claimReady = migration.indexOf("r.readiness_status = 'ready'", claimGate)
assert.ok(claimGate > 0 && claimReady > claimGate && claimReady < claimUnchecked)

const allocatorGate = migration.indexOf('CREATE OR REPLACE FUNCTION public.allocate_zatca_chain_v2(')
const allocatorUnchecked = migration.indexOf('public.allocate_zatca_chain_v2_unchecked', allocatorGate)
const allocatorReady = migration.indexOf("r.readiness_status = 'ready'", allocatorGate)
assert.ok(allocatorGate > 0 && allocatorReady > allocatorGate && allocatorReady < allocatorUnchecked)

const edgeReadiness = edge.indexOf('const readiness = await loadBranchReadinessV2')
const edgeProcessor = edge.indexOf('const result = useLegacyProcessor')
assert.ok(edgeReadiness > 0 && edgeReadiness < edgeProcessor)
assert.match(edge, /invoiceAuth\.target\.v2Invoice !== true[\s\S]*checkoutMode === 'legacy'/)
assert.match(edge, /BRANCH_V2_NOT_READY/)
assert.match(edge, /legacySubmitAvailable: true/)
assert.match(edge, /standardCheckoutMode = simplifiedCheckoutMode === 'v2' && branchCapabilities\.standardEnabled/)

assert.match(onboarding, /saveState[\s\S]*initialize_zatca_new_branch_chain_v2/)
assert.match(onboarding, /branchV2Ready \? 'v2' : 'legacy'/)
assert.match(client, /ZATCA_FINALIZATION_CLIENT_VERSION = '2\.1\.0'/)
assert.match(client, /documentKind: 'simplified' \| 'standard'/)
assert.match(client, /standardCheckoutMode/)
assert.match(pos, /standardRequested \? 'standard' : 'simplified'/)

assert.match(edge, /operation === 'report'[\s\S]*invoices\/clearance\/single/)
assert.match(edge, /operation === 'clear'[\s\S]*'Clearance-Status': '1'/)
assert.match(edge, /adopt_zatca_cleared_artifact_v2/)
assert.match(activation, /standard_enabled = false/)

assert.match(seed, /864/)
assert.match(seed, /t3CZaYvRmwniI6rCyL\+OfITTxHJQ5BdA1CjvdgVN1cY=/)
assert.match(seed, /block_zatca_branch_v2/)
assert.match(seed, /b2b4fd13-b6db-4baa-b353-4eaab842ed50/)
assert.match(cleanup, /WHERE expires_at <= clock_timestamp\(\)/)
assert.match(rollback, /immutable_finalization_enabled = false/)
assert.match(rollback, /simplified_enabled = false/)
assert.match(rollback, /standard_enabled = false/)
assert.match(verification, /v_total <> 15 OR v_pass <> 15 OR v_fail <> 0/)
assert.match(verification, /BEGIN;/)
assert.match(verification, /CREATE TEMP TABLE zatca_branch_gate_results/)
assert.match(verification, /ROLLBACK;/)

for (const runtimeFile of [client, pos]) {
  assert.doesNotMatch(runtimeFile, /371dee75-6e46-496e-89e7-1a7492b51a3c/)
  assert.doesNotMatch(runtimeFile, /b2b4fd13-b6db-4baa-b353-4eaab842ed50/)
}
assert.equal(
  (edge.match(/371dee75-6e46-496e-89e7-1a7492b51a3c/g) ?? []).length,
  1,
  'the incident branch id may appear only in the isolated recovery allowlist',
)
assert.match(edge, /const RECOVERY_BRANCH_ID = '371dee75-6e46-496e-89e7-1a7492b51a3c'/)
assert.doesNotMatch(edge, /b2b4fd13-b6db-4baa-b353-4eaab842ed50/)

console.log('ZATCA branch readiness v2: 9 routing scenarios and server-gate contracts passed')
