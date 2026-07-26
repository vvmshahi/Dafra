import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { selectZatcaBranchCheckoutMode } from '../supabase/functions/_shared/zatca/branch_readiness.mjs'
import {
  parseImmutableFinalizationEdgeSwitch,
  resolveAtomicSimplifiedCheckoutCapability,
} from '../supabase/functions/_shared/zatca/finalization_capabilities.mjs'

const enabledEdge = parseImmutableFinalizationEdgeSwitch('true')
assert.deepEqual(enabledEdge, {
  edgeExecutionEnabled: true,
  edgeKillSwitchEnabled: false,
})

for (const rawValue of [undefined, '', 'false', 'TRUE', ' true ', '1']) {
  assert.deepEqual(
    parseImmutableFinalizationEdgeSwitch(rawValue),
    {
      edgeExecutionEnabled: false,
      edgeKillSwitchEnabled: true,
    },
    `only exact lowercase true may enable Edge execution: ${String(rawValue)}`,
  )
}

const base = {
  compatible: true,
  databaseFeatureEnabled: true,
  immutableFinalizationEnabled: true,
  simplifiedEnabled: true,
  standardEnabled: false,
  edgeKillSwitchEnabled: enabledEdge.edgeKillSwitchEnabled,
}
const rollout = {
  atomicSimplifiedCheckoutEnabled: true,
  branchGateEnabled: true,
}
const capability = resolveAtomicSimplifiedCheckoutCapability(base, rollout)
assert.equal(capability.databaseFeatureEnabled, true)
assert.equal(capability.immutableFinalizationEnabled, true)
assert.equal(capability.simplifiedEnabled, true)
assert.equal(capability.edgeKillSwitchEnabled, false)

const readyBranch = {
  compatible: capability.compatible,
  globalMasterEnabled: capability.databaseFeatureEnabled,
  simplifiedEnabled: capability.simplifiedEnabled,
  edgeExecutionEnabled: capability.edgeKillSwitchEnabled === false,
  clientAcknowledged: true,
  chainHeadExists: true,
  branchReady: true,
  branchBlocked: false,
  productionConnected: true,
}
const enabledMode = selectZatcaBranchCheckoutMode(readyBranch)
const enabledModes = {
  checkoutMode: enabledMode,
  simplifiedCheckoutMode: enabledMode,
}
assert.equal(enabledModes.checkoutMode, 'v2')
assert.equal(enabledModes.simplifiedCheckoutMode, 'v2')

for (const rawValue of [undefined, 'false']) {
  const edge = parseImmutableFinalizationEdgeSwitch(rawValue)
  const disabled = resolveAtomicSimplifiedCheckoutCapability({
    ...base,
    edgeKillSwitchEnabled: edge.edgeKillSwitchEnabled,
  }, rollout)
  assert.equal(disabled.edgeKillSwitchEnabled, true)
  assert.equal(disabled.immutableFinalizationEnabled, false)
  const disabledMode = selectZatcaBranchCheckoutMode({
    ...readyBranch,
    edgeExecutionEnabled: disabled.edgeKillSwitchEnabled === false,
  })
  assert.equal(disabledMode, 'legacy')
}

for (const disabledRollout of [
  { atomicSimplifiedCheckoutEnabled: false, branchGateEnabled: true },
  { atomicSimplifiedCheckoutEnabled: true, branchGateEnabled: false },
]) {
  const disabled = resolveAtomicSimplifiedCheckoutCapability(base, disabledRollout)
  assert.equal(disabled.databaseFeatureEnabled, false)
  assert.equal(disabled.immutableFinalizationEnabled, false)
  assert.equal(disabled.simplifiedEnabled, false)
}

const root = process.cwd()
const edgeSource = readFileSync(
  join(root, 'supabase/functions/zatca-submit/index.ts'),
  'utf8',
)
assert.match(
  edgeSource,
  /parseImmutableFinalizationEdgeSwitch\(\s*Deno\.env\.get\('ZATCA_IMMUTABLE_FINALIZATION_ENABLED'\)/,
)
assert.match(edgeSource, /loadAtomicSimplifiedRolloutV2\(/)
assert.match(edgeSource, /resolveAtomicSimplifiedCheckoutCapability\(/)
assert.match(edgeSource, /edgeExecutionEnabled: capabilities\.edgeKillSwitchEnabled === false/)
assert.match(edgeSource, /\.\.\.branchCapabilities,[\s\S]*checkoutMode: simplifiedCheckoutMode,[\s\S]*simplifiedCheckoutMode,/)
assert.doesNotMatch(
  edgeSource,
  /edgeKillSwitchEnabled\s*=\s*Deno\.env\.get\('ZATCA_IMMUTABLE_FINALIZATION_ENABLED'\)\s*===\s*'true'/,
)

console.log('ZATCA atomic capability switch and branch rollout diagnostics passed')
