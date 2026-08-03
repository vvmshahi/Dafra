import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const branchSettings = read('src/pages/branch/BranchSettingsPage.tsx')
const ownerSettings = read('src/pages/settings/SettingsPage.tsx')
const creditSettings = read('src/pages/settings/CustomerCreditPolicySettings.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const customerDetail = read('src/pages/customers/CustomerDetailPage.tsx')
const customerPanel = read('src/components/customers/CustomerReceivablesPanel.tsx')
const printing = read('src/pages/branch/PrintingDocumentsPage.tsx')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const app = read('src/App.tsx')
const migration = read('supabase/migrations/20260803001000_branch_settings_authority_and_credit_diagnostics_v1.sql')
const enBranches = JSON.parse(read('src/localization/locales/en/branches.json'))
const arBranches = JSON.parse(read('src/localization/locales/ar-SA/branches.json'))

assert.match(branchSettings, /role="tablist"/)
assert.match(branchSettings, /useSearchParams/)
for (const section of ['general', 'pos', 'credit', 'printing', 'zatca']) assert.match(branchSettings, new RegExp(`'${section}'`))
assert.match(branchSettings, /update_branch_pos_settings/)
assert.match(branchSettings, /allow_split_payments/)
assert.match(branchSettings, /show_pos_scroll_buttons/)
assert.match(branchSettings, /SectionId = 'general'.*'credit'/s)
assert.match(branchSettings, /Open Printing & Documents|workspace\.openPrinting/)
assert.match(branchSettings, /managed from the Owner account|workspace\.zatcaHelp/)
assert.match(branchSettings, /Back to Dashboard|workspace\.backToDashboard/)

assert.match(ownerSettings, /role="tablist"/)
assert.match(ownerSettings, /setParams/)
assert.match(creditSettings, /viewBranchSettings/)
assert.match(creditSettings, /openWorkspace/)
assert.match(pos, /BUSINESS_CREDIT_DISABLED/)
assert.match(pos, /BRANCH_CREDIT_DISABLED/)
assert.match(pos, /CREDIT_ACCOUNT_NOT_READY/)
assert.match(pos, /customers\/\$\{customerId\}\?section=credit/)
assert.match(customerDetail, /customer-credit-settings/)
assert.match(customerPanel, /canManageCustomerCredit/)
assert.match(printing, /initialBranchId/)
assert.match(invoiceSettings, /initialBranchId/)
assert.match(app, /settings\/branches\/:branchId\/printing/)

assert.match(migration, /v_profile\.role = 'branch'/)
assert.match(migration, /v_profile\.branch_id IS DISTINCT FROM v_branch\.id/)
assert.match(migration, /get_customer_credit_checkout_eligibility_v1_raw_20260803/)
for (const field of ['business_enabled', 'branch_enabled', 'customer_enabled', 'account_ready', 'customer_active', 'eligible', 'reason_code']) {
  assert.match(migration, new RegExp(`'${field}'`))
}
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.(?:invoices|payments|customer_receivable_ledger|stock_movements)/i)

for (const locale of [enBranches, arBranches]) {
  for (const key of ['sections', 'posModes', 'printingItems']) assert.ok(locale.workspace[key], `Branch locale has workspace.${key}`)
}

console.log('Branch and Owner Settings redesign contracts passed')
