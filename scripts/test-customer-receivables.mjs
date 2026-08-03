import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const migrationPath = 'supabase/migrations/20260803001100_branch_only_b2b_customer_credit_v1.sql'
const migration = read(migrationPath)
const panel = read('src/components/customers/CustomerReceivablesPanel.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
const detail = read('src/pages/customers/CustomerDetailPage.tsx')
const settings = read('src/pages/settings/SettingsPage.tsx')
const compatibility = read('src/pages/settings/CustomerCreditPolicySettings.tsx')
const workspace = read('src/pages/reports/CustomerReceivablesReportPage.tsx')
const statement = read('src/pages/print/CustomerStatementPrintPage.tsx')
const receipt = read('src/pages/print/PaymentReceiptPrintPage.tsx')
const client = read('src/lib/customers/receivables.ts')

assert.ok(fs.existsSync(migrationPath), 'Branch-only migration exists')
for (const code of ['BRANCH_CREDIT_DISABLED', 'BUSINESS_CUSTOMER_REQUIRED', 'CUSTOMER_INACTIVE', 'CUSTOMER_NOT_FOUND', 'CREDIT_ACCOUNT_SETUP_FAILED', 'BRANCH_INACTIVE', 'CREDIT_UNAUTHORIZED']) {
  assert.match(migration, new RegExp(code), `server exposes ${code}`)
}
assert.match(migration, /customer_type::text IS DISTINCT FROM 'business'/)
assert.match(migration, /coalesce\(v_branch\.customer_credit_enabled, false\)/)
assert.match(migration, /ar_ensure_customer_account_v1/)
assert.match(migration, /historicalBalanceBackfilled', false/)
assert.match(migration, /SET search_path = public, pg_temp/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.post_customer_credit_checkout_v1\(jsonb\) TO authenticated/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_customer_credit_access_v1\(jsonb\) FROM PUBLIC, anon, authenticated/)
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.(?:invoices|payments|stock_movements)/i, 'consolidation migration is additive')

assert.doesNotMatch(settings, /customer-credit|CustomerCreditPolicySettings/)
assert.doesNotMatch(compatibility, /type="checkbox"|set_tenant_customer_credit_policy_v1|set_customer_credit_access_v1|credit_limit|hold|approval/i)
assert.doesNotMatch(panel, /ensureCustomerReceivableAccount|saveCustomerCreditAccess|Allow credit for this customer|Stop credit|creditLimit|availableCredit/)
assert.match(panel, /branchCreditSettings\?\.branchCreditEnabled/)
assert.match(panel, /actions\.receivePayment/)

assert.match(sidebar, /loadBranchCustomerCreditSettings/)
assert.match(sidebar, /item\.path !== '\/reports\/receivables' \|\| branchCreditEnabled/)
assert.match(pos, /BUSINESS_CUSTOMER_REQUIRED/)
assert.match(pos, /payments:customerCredit/)
assert.doesNotMatch(pos, /creditEligibility\.availableCredit|creditAvailable|creditLimit/)
assert.match(pos, /payMethod === 'credit'\s*\? \(checkout\.display_payment_method \?\? 'credit'\)/)

for (const tab of ['overview', 'invoices', 'products', 'documents', 'report']) assert.match(detail, new RegExp(`'${tab}'`), `customer profile has ${tab} tab`)
assert.match(detail, /customerCreditVisible/)
for (const tab of ['overview', 'customers', 'payments', 'statements']) assert.match(workspace, new RegExp(`'${tab}'`), `Customer Credit has ${tab} workspace tab`)
assert.match(workspace, /customer_payment_receipts/)
assert.match(workspace, /print\/payment-receipt/)
assert.match(workspace, /lastCreditInvoice/)
assert.match(workspace, /quickRange/)
assert.match(statement, /startDate: searchParams\.get\('start'\)/)
assert.match(receipt, /format58|format80|formatA4/)
assert.match(client, /get_customer_payment_receipt_document_v1/)
assert.match(client, /getPersistentReceivableOperation/)

console.log('final Branch-only Business/B2B customer-credit contracts passed (31 checks)')
