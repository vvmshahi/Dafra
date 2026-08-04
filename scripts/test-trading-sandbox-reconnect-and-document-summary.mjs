import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const receiptView = pos.slice(pos.indexOf('function ReceiptView'), pos.indexOf('// ── Product card'))
const settings = read('src/pages/settings/ZatcaTab.tsx')
const api = read('src/lib/zatca/api.ts')
const onboarding = read('supabase/functions/zatca-onboard-sandbox-demo/index.ts')
const validator = read('supabase/functions/zatca-validate-sandbox-demo/index.ts')
const thermal = read('src/components/print/ThermalReceiptCompositions.tsx')
const a4 = read('src/components/print/A4Document.tsx')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')

const count = (value, pattern) => value.match(pattern)?.length ?? 0

assert.equal(count(receiptView, /t\('payments:printReceipt'\)/g), 1)
assert.equal(count(receiptView, /t\('payments:printInvoice'\)/g), 1)
assert.equal(count(receiptView, /t\('payments:newSale'\)/g), 1)
assert.match(receiptView, /new Set\(actionIdCandidates\)/)
assert.doesNotMatch(receiptView, /afterSaleAction !== 'a4' && \(/)
assert.doesNotMatch(receiptView, /View invoice|shareWhatsApp|zatca_demo_non_fiscal/)

for (const source of [thermal, a4, detail]) {
  assert.doesNotMatch(source, /documents:initialPayment['")]|customerCredit\.initialPayment[}\s]/)
  assert.match(source, /amountPaid/)
}
for (const source of [thermal, a4, detail]) assert.match(source, /initialPaymentMethod/)

assert.match(settings, /DEMO_TENANT_ID = 'ebf1144b-55ed-472a-99c9-23b5ee915351'/)
assert.match(settings, /TRADING_BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'/)
assert.match(settings, /sandbox\.reconnectButton/)
assert.match(settings, /autoComplete="one-time-code"/)
assert.match(settings, /setOtp\('\'\)/)
assert.match(settings, /runSandboxDemoOnboarding/)
assert.doesNotMatch(settings, /localStorage[\s\S]{0,200}otp/i)

assert.match(api, /zatca-onboard-sandbox-demo/)
assert.match(api, /'request_compliance_csid'/)
assert.match(api, /PERMANENT_DEMO_TRADING_BRANCH_ID/)

assert.match(onboarding, /authorizeOnboardingCaller/)
assert.match(onboarding, /const TRADING_BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'/)
assert.match(onboarding, /assertTradingDemoConfiguration/)
assert.match(onboarding, /SANDBOX_RECONNECT_CONFIG_MISSING/)
assert.match(onboarding, /SANDBOX_ONBOARDING_UNAVAILABLE/)
assert.match(onboarding, /profile\.role === 'owner'/)
assert.match(onboarding, /profile\.role === 'super_admin'/)
assert.match(onboarding, /branchId !== TRADING_BRANCH_ID/)
assert.match(onboarding, /query = query\.in\('status', \['pending', 'compliance', 'active', 'failed'\]\)/)
assert.match(onboarding, /SANDBOX_CORE_BASE_URL/)
assert.match(onboarding, /otp\|secret\|csid\|token\|certificate/i)
assert.doesNotMatch(onboarding, /console\.(?:log|info|warn|error)[\s\S]{0,120}body\.otp/)
assert.doesNotMatch(onboarding, /production\.zatca\.gov\.sa|api\.zatca\.gov\.sa/i)

assert.match(validator, /activate_compliance_demo/)
assert.match(validator, /branchId !== TRADING_BRANCH_ID/)
assert.match(validator, /\['owner', 'super_admin'\]/)
assert.match(settings, /tradingSandboxOnboardingStatus\.status/)

console.log('Trading Sandbox reconnect, success-modal uniqueness, and credit document summary contracts passed')
