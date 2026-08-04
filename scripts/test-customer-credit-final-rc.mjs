import fs from 'node:fs'

const pos = fs.readFileSync('src/pages/pos/POSPage.tsx', 'utf8')
const customers = fs.readFileSync('src/pages/customers/CustomersPage.tsx', 'utf8')
const detail = fs.readFileSync('src/pages/customers/CustomerDetailPage.tsx', 'utf8')
const eligibility = fs.readFileSync('supabase/migrations/20260803001100_branch_only_b2b_customer_credit_v1.sql', 'utf8')
const enPayments = JSON.parse(fs.readFileSync('src/localization/locales/en/payments.json', 'utf8'))
const arPayments = JSON.parse(fs.readFileSync('src/localization/locales/ar-SA/payments.json', 'utf8'))

if (!pos.includes("t('payments:sellOnCredit')") || !pos.includes("title={t('payments:sellOnCreditTooltip')}")) throw new Error('eligible POS credit action is missing the approved copy/tooltip')
if (pos.includes("t('payments:businessCustomerCredit')")) throw new Error('POS credit action still exposes eligibility text')
if (!customers.includes('onClick={onView}') || !customers.includes("t('actions.viewDetails')")) throw new Error('customer name/row discoverability contract is missing')
if (!detail.includes("section !== 'credit' || customerCreditVisible") || !detail.includes("data.customer.customerType !== 'business'")) throw new Error('individual customer credit tab is not gated')
for (const token of ["v_branch_enabled", "v_customer.customer_type IS DISTINCT FROM 'business'", "account_auto_create", "creditLimit', NULL", "requiresOwnerApproval', false"]) {
  if (!eligibility.includes(token)) throw new Error(`branch-only eligibility contract missing: ${token}`)
}
if (enPayments.sellOnCredit !== 'Sell on customer credit' || arPayments.sellOnCredit !== 'بيع على ائتمان العميل') throw new Error('POS copy localization regression')
console.log('Customer Credit final RC source contract: PASS')
