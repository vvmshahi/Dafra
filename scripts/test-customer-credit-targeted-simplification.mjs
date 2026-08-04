import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const panel = read('src/components/customers/CustomerReceivablesPanel.tsx')
const report = read('src/pages/reports/CustomerReceivablesReportPage.tsx')
const locale = read('src/localization/locales/en/receivables.json')

assert.doesNotMatch(panel, /actions\.openWorkspace/)
assert.match(panel, /statementOpen/)
assert.match(panel, /statementPreset/)
assert.match(panel, /metrics\.openInvoices/)
assert.doesNotMatch(panel, /metrics\.unpaid.*metrics\.partial/s)
assert.match(panel, /hidden grid gap-4 xl:grid-cols/)
assert.match(panel, /ledger\.title/)
assert.match(panel, /statementPath/)
assert.match(report, /type WorkspaceTab = 'overview' \| 'payments'/)
assert.doesNotMatch(report, /id: 'customers'/)
assert.doesNotMatch(report, /id: 'statements'/)
assert.match(report, /tab === 'overview' && <section id="workspace-panel-customers"/)
assert.doesNotMatch(report, /branchComparison-heading/)
assert.match(report, /activityPeriod/)
assert.match(locale, /"Total sales"/)
assert.match(locale, /"Total paid"/)

console.log('Customer and credit targeted simplification contract passed')
