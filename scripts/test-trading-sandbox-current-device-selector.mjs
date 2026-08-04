import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync('supabase/functions/zatca-onboard-sandbox-demo/index.ts', 'utf8')
const selector = edge.slice(edge.indexOf('async function loadCredential('), edge.indexOf('async function loadCredentialById('))

assert.match(selector, /\.eq\('tenant_id', PERMANENT_DEMO_TENANT_ID\)/)
assert.match(selector, /\.eq\('branch_id', TRADING_BRANCH_ID\)/)
assert.match(selector, /\.eq\('environment', 'sandbox'\)/)
assert.match(selector, /\.in\('status', \[\.\.\.CURRENT_TRADING_SANDBOX_STATUSES\]\)/)
assert.match(selector, /\.in\('onboarding_status', \[\.\.\.RESUMABLE_TRADING_SANDBOX_STATES\]\)/)
assert.match(selector, /\.is\('reconciliation_decision', null\)/)
assert.doesNotMatch(selector, /'failed'|'revoked'|'expired'/)

const eligibleStatuses = new Set(['pending', 'compliance', 'active'])
const eligibleStates = new Set([
  'not_started', 'csr_ready', 'compliance_csid_ready',
  'compliance_checks_pending', 'compliance_passed',
  'sandbox_production_csid_ready', 'active',
])
const rows = [
  { status: 'failed', onboarding_status: 'failed', functionality_map: '1100', reconciliation_decision: null },
  { status: 'revoked', onboarding_status: 'compliance_passed', functionality_map: '1100', reconciliation_decision: 'abandoned_by_owner_reset' },
  { status: 'compliance', onboarding_status: 'compliance_passed', functionality_map: '0100', reconciliation_decision: null },
  { status: 'active', onboarding_status: 'active', functionality_map: '1100', reconciliation_decision: null },
]
const selected = rows.filter(row => eligibleStatuses.has(row.status) && eligibleStates.has(row.onboarding_status) && row.reconciliation_decision === null)
assert.deepEqual(selected.map(row => row.functionality_map), ['0100', '1100'])
assert.equal(selected.some(row => row.status === 'failed' || row.status === 'revoked'), false)
assert.equal(selected.find(row => row.status === 'compliance')?.functionality_map, '0100')
assert.equal(selected.find(row => row.status === 'active')?.functionality_map, '1100')

const serviceDemoRow = { tenant_id: 'service-demo', branch_id: 'service-demo', status: 'active', onboarding_status: 'active' }
assert.notEqual(serviceDemoRow.tenant_id, 'ebf1144b-55ed-472a-99c9-23b5ee915351')
assert.notEqual(serviceDemoRow.branch_id, '14271653-b404-44bf-9f39-7e9927569c02')

console.log('Trading Sandbox current-device selector regression passed')
