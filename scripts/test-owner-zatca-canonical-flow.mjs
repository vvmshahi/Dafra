import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const tab = read('src/pages/settings/ZatcaTab.tsx')
const sandboxCard = read('src/components/zatca/SandboxBranchOnboardingPanel.tsx')
const ownerDashboard = read('src/pages/admin/DashboardPage.tsx')
const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/dashboard.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/dashboard.json'))

// The settings view owns a single, branch-scoped canonical route. It must select
// the Sandbox flow from the branch environment, not from a fixed tenant/branch UUID.
assert.match(tab, /const \{ profile \} = useAuth\(\)/)
assert.match(tab, /branch\.zatca_environment === 'sandbox'/)
assert.match(tab, /<SandboxOnboardingPanel/)
assert.match(tab, /<ProductionOnboardingPanel/)
assert.match(tab, /getSandboxOnboardingStatus\(branch\.id, tid\)/)
assert.doesNotMatch(tab, /zatca-onboard-trading-sandbox-v2/)
assert.doesNotMatch(tab, /PERMANENT_DEMO_(TENANT|TRADING|SERVICE)_BRANCH_ID/)
assert.doesNotMatch(tab, /14271653-b404-44bf-9f39-7e9927569c02/)
assert.doesNotMatch(tab, /f512b805-b0ef-494d-b696-139e31a9fabb/)

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
  assert.match(dashboard, /zatcaConnection\?\.environment === 'sandbox'/)
  assert.match(dashboard, /zatca\.sandboxConnected/)
  assert.match(dashboard, /zatca\.sandboxPending/)
}

for (const locale of [en, ar]) {
  for (const key of ['sandboxConnected', 'sandboxPending', 'sandboxOnboarding', 'sandboxFailed']) {
    assert.equal(typeof locale.zatca[key], 'string')
  }
}

console.log('Owner ZATCA canonical-flow assertions passed.')
