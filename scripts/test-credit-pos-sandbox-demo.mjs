import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260803000600_credit_preflight_and_server_demo_modes.sql')
const rebind = read('supabase/migrations/20260803000700_rebind_credit_and_sandbox_mode_contracts.sql')
const sandboxClearanceGate = read('supabase/migrations/20260824000100_sandbox_standard_clearance_gate.sql')
const pos = read('src/pages/pos/POSPage.tsx')
const receivables = read('src/lib/customers/receivables.ts')
const submission = read('src/lib/zatca/submission.ts')
const sandboxValidator = read('supabase/functions/zatca-validate-sandbox-demo/index.ts')
const enPayments = JSON.parse(read('src/localization/locales/en/payments.json'))
const arPayments = JSON.parse(read('src/localization/locales/ar-SA/payments.json'))
const enPos = JSON.parse(read('src/localization/locales/en/pos.json'))
const arPos = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))

assert.match(migration, /get_customer_credit_checkout_eligibility_v1/)
assert.match(migration, /SELECT \* INTO v_scope FROM public\.ar_assert_scope_v1/)
assert.match(migration, /'accountLinked', v_account_linked/)
assert.match(migration, /'accountLinkable', NOT v_account_linked AND v_scope\.actor_role IN \('owner', 'admin'\)/)
assert.doesNotMatch(
  migration.match(/CREATE OR REPLACE FUNCTION public\.get_customer_credit_checkout_eligibility_v1[\s\S]*?\$function\$;/)?.[0] ?? '',
  /ar_ensure_customer_account_v1/,
  'preflight must not create a receivable account',
)
assert.match(migration, /AR_CREDIT_DISABLED/)
assert.match(migration, /AR_CREDIT_HOLD/)
assert.match(migration, /AR_CREDIT_OWNER_APPROVAL_REQUIRED/)
assert.match(migration, /AR_CREDIT_LIMIT_EXCEEDED/)
assert.match(migration, /AR_CREDIT_OVERDUE_BLOCK/)
assert.match(migration, /get_zatca_demo_checkout_mode_v1/)
assert.match(migration, /zatca_demo_checkout_mode_internal_v1/)
assert.match(migration, /c\.status = 'compliance'/)
assert.match(migration, /c\.compliance_demo_status = 'active'/)
assert.match(migration, /c\.encrypted_compliance_csid/)
assert.doesNotMatch(
  migration.match(/CREATE OR REPLACE FUNCTION public\.zatca_demo_checkout_mode_internal_v1[\s\S]*?\$function\$;/)?.[0] ?? '',
  /encrypted_production_(?:csid|secret)/,
  'mode selection must not use production credential material',
)
assert.match(sandboxClearanceGate, /'checkoutPath', 'sandbox'/)
assert.match(sandboxClearanceGate, /c\.status = 'active'/)
assert.match(sandboxClearanceGate, /c\.onboarding_status = 'active'/)
assert.match(sandboxClearanceGate, /c\.functionality_map = '1100'/)
assert.doesNotMatch(sandboxClearanceGate, /c\.compliance_demo_status/)
assert.doesNotMatch(sandboxClearanceGate, /SANDBOX_STANDARD_CLEARANCE_UNAVAILABLE/)
assert.match(rebind, /Explicitly bind the public checkout contract to the server-derived mode[\s\S]*?classifier/)
assert.match(rebind, /CREATE OR REPLACE FUNCTION public\.pos_checkout\(p_payload jsonb\)/)
assert.match(rebind, /v_result := public\.pos_checkout_capability_base_v1\(p_payload - 'is_demo' - 'non_fiscal'\)/)
assert.match(rebind, /post_customer_credit_checkout_v1_hardened_20260803/)
assert.match(rebind, /get_customer_credit_checkout_eligibility_v1_base_20260803/)
assert.match(rebind, /INSERT INTO public\.product_units_commercial_function_contracts_v1/)
assert.match(rebind, /ON CONFLICT \(function_signature\) DO UPDATE/)

assert.match(receivables, /loadCustomerCreditCheckoutEligibility/)
assert.match(receivables, /get_customer_credit_checkout_eligibility_v1/)
assert.match(pos, /parseExplicitMoneyInput/)
assert.match(pos, /\^\(\?:0\|\[1-9\]\[0-9\]\*\)\(\?:\\\.\[0-9\]\{1,2\}\)\?\$/)
assert.match(pos, /creditInitialAmount !== null/)
assert.match(pos, /creditEligibility\?\.allowed === true && creditInitialValid/)
assert.match(pos, /await loadCustomerCreditCheckoutEligibility/)
assert.match(pos, /payments:sellOnCredit/)
assert.match(pos, /creditInitialNumeric > 0/)
const creditPanel = pos.match(/\{payMethod === 'credit'[\s\S]*?\n          \)\}/)?.[0] ?? ''
assert.doesNotMatch(creditPanel, /bank_transfer/)
assert.doesNotMatch(creditPanel, /amber-/)
assert.match(pos, /grid-cols-3/)
assert.match(pos, /documentDecision\.checkoutPath === 'sandbox'/)
assert.match(pos, /else if \(sandboxDemo\)[\s\S]*?submitInvoiceForBranch/s)
assert.match(pos, /sandboxDemo,/)
assert.match(pos, /if \(receipt\.sandboxDemo\)[\s\S]*?routed\.mode !== 'sandbox_submission'/s)
assert.match(pos, /if \(receipt\.sandboxDemo\)[\s\S]*?getInvoiceZatcaOutputState/s)

assert.match(submission, /PosCheckoutPath = 'atomic' \| 'legacy' \| 'demo' \| 'sandbox'/)
assert.match(submission, /const connection = await getZatcaConnectionState\(params\.branchId\)/)
assert.match(submission, /supabase\.functions\.invoke\('zatca-submit-sandbox-demo'/)
assert.match(sandboxValidator, /\.in\('status', \['compliance', 'active'\]\)/)

for (const locale of [enPayments, arPayments]) {
  for (const key of [
    'creditDisabled', 'creditOnHold', 'creditOwnerApprovalRequired',
    'creditLimitExceeded', 'creditOverdueBlocked', 'sellOnCredit',
    'creditInitialPayment', 'creditExplicitZero', 'creditOutstandingLabel',
  ]) assert.equal(typeof locale[key], 'string', `payment locale has ${key}`)
}
assert.equal(enPayments.creditFullPaymentUseTender, 'Use Cash, Card, or Split for a fully paid sale.')
for (const locale of [enPos, arPos]) {
  assert.equal(locale.demo.badge.includes('Non-fiscal'), false)
  assert.equal(typeof locale.sandbox.label, 'string')
  assert.equal(typeof locale.sandbox.receiptLabelBilingual, 'string')
  assert.equal(typeof locale.zatca.sandbox_validated, 'string')
}

console.log('credit POS and server-derived Sandbox Demo contract tests passed')
