import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const tab = read('src/pages/settings/ZatcaTab.tsx')
const sandboxCard = read('src/components/zatca/SandboxBranchOnboardingPanel.tsx')
const ownerDashboard = read('src/pages/admin/DashboardPage.tsx')
const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/dashboard.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/dashboard.json'))

assert.match(tab, /const \{ profile, tenant \} = useAuth\(\)/)
assert.match(tab, /const isPermanentDemo = tenant\?\.is_demo === true/)
assert.match(tab, /tenant\.is_demo !== true/)
assert.match(tab, /const activeBranches = data\.filter\(branch => branch\.is_active\)/)
assert.match(tab, /isPermanentDemo\s*\? <SandboxBranchOnboardingPanel key=\{branch\.id\} branch=\{branch\}/)
assert.match(tab, /: <ProductionBranchOnboardingCard key=\{branch\.id\} branch=\{branch\}/)
assert.doesNotMatch(tab, /\{tradingSandboxV2Panel\}|\{reconnectPanel\}|ComplianceReadinessCard key=/)
assert.match(tab, /const tradingSandboxV2Panel = null/)
assert.match(tab, /const reconnectPanel = null/)

assert.match(sandboxCard, /data-zatca-branch-card=\{branch\.id\}/)
assert.match(sandboxCard, /getSandboxBranchOnboardingStatus\(branch\.id, branch\.tenant_id\)/)
assert.match(sandboxCard, /getZatcaConnectionState\(branch\.id\)/)
assert.match(sandboxCard, /connection\?\.connection_state === 'connected'/)
assert.match(sandboxCard, /functionalityMap: '1100'/)
assert.match(sandboxCard, /Begin Sandbox onboarding/)
assert.match(sandboxCard, /Retry/)
assert.match(sandboxCard, /complianceSampleResults/)

for (const dashboard of [ownerDashboard, branchDashboard]) {
  assert.match(dashboard, /getZatcaConnectionState/)
  assert.match(dashboard, /tenant\?\.is_demo === true/)
  assert.match(dashboard, /zatca\.sandboxConnected/)
  assert.match(dashboard, /zatca\.sandboxPending/)
}

for (const locale of [en, ar]) {
  for (const key of ['sandboxConnected', 'sandboxPending', 'sandboxOnboarding', 'sandboxFailed']) {
    assert.equal(typeof locale.zatca[key], 'string')
  }
}

console.log('Owner ZATCA canonical-flow assertions passed.')
