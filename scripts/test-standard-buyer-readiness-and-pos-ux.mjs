import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getStandardBuyerReadiness } from '../src/lib/customers/standardBuyerReadiness.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const modal = read('src/pages/customers/CustomerModal.tsx')
const submission = read('src/lib/zatca/submission.ts')
const preflight = read('supabase/migrations/20260811000100_standard_buyer_preflight_v1.sql')

const completeSaudiBuyer = {
  businessName: 'Kubri Buyer LLC',
  vatNumber: '399999999900003',
  buildingNumber: '1234',
  address: 'King Fahd Road',
  district: 'Al Olaya',
  city: 'Riyadh',
  postalCode: '12214',
  country: 'SA',
}

test('Saudi Standard buyer readiness mirrors the persisted pre-charge contract', () => {
  assert.deepEqual(getStandardBuyerReadiness(completeSaudiBuyer), {
    eligible: true,
    missingFields: [],
    invalidFields: [],
  })

  const incomplete = getStandardBuyerReadiness({ ...completeSaudiBuyer, buildingNumber: '', district: '', postalCode: '12' })
  assert.equal(incomplete.eligible, false)
  assert.deepEqual(incomplete.missingFields, ['buildingNumber', 'district'])
  assert.deepEqual(incomplete.invalidFields, ['postalCode'])

  const invalidVat = getStandardBuyerReadiness({ ...completeSaudiBuyer, vatNumber: '123' })
  assert.equal(invalidVat.eligible, false)
  assert.deepEqual(invalidVat.invalidFields, ['vatNumber'])
})

test('server is still the canonical Standard buyer preflight and returns all missing fields', () => {
  for (const field of ['building_number', 'address', 'district', 'city', 'postal_code', 'country']) {
    assert.match(preflight, new RegExp(`v_customer\\.${field}`))
  }
  assert.match(preflight, /'missingFields', to_jsonb\(v_missing\)/)
  assert.match(preflight, /'invalidFields', to_jsonb\(v_invalid\)/)
  assert.match(preflight, /STANDARD_BUYER_BUILDING_NUMBER_REQUIRED/)
})

test('customer Create/Edit exposes and persists the existing B2B address fields without a migration', () => {
  assert.match(modal, /getStandardBuyerReadiness/)
  for (const input of ['customer-building-number', 'customer-address', 'customer-district', 'customer-city', 'customer-postal-code', 'customer-country']) {
    assert.match(modal, new RegExp(input))
  }
  for (const field of ['building_number', 'district', 'postal_code', 'country']) {
    assert.match(modal, new RegExp(`${field}: isBusiness`))
  }
  assert.match(modal, /customers:readiness\.incomplete/)
})

test('POS blocks before checkout with every authoritative buyer field and does not issue a document', () => {
  assert.match(submission, /missingFields: Array\.isArray\(data\?\.missingFields\)/)
  assert.match(submission, /invalidFields: Array\.isArray\(data\?\.invalidFields\)/)
  const resolver = pos.indexOf('const documentDecision = await resolvePosCheckoutDocument')
  const checkout = pos.indexOf("'post_customer_credit_checkout_v1' : 'pos_checkout'")
  assert.ok(resolver >= 0 && checkout >= 0 && resolver < checkout, 'buyer preflight must precede checkout RPC')
  assert.match(pos, /documentDecision\.missingFields, \.\.\.documentDecision\.invalidFields/)
  assert.match(pos, /standardBuyerReadinessRequired/)
})

test('Sandbox receipt presentation rehydrates the persisted issued artifact without reissuing', () => {
  const sandboxStart = pos.indexOf('} else if (sandboxDemo) {')
  const sandboxEnd = pos.indexOf("} else if (productionCheckoutMode === 'legacy')", sandboxStart)
  const sandboxPath = pos.slice(sandboxStart, sandboxEnd)
  assert.match(sandboxPath, /submitInvoiceForBranch/)
  assert.match(sandboxPath, /getInvoiceZatcaOutputState/)
  assert.ok(sandboxPath.indexOf('submitInvoiceForBranch') < sandboxPath.indexOf('getInvoiceZatcaOutputState'))
  assert.match(sandboxPath, /selectStoredOutputStateQr\(sandboxOutput\)/)
  assert.match(sandboxPath, /canPrintCustomerCopy = Boolean\(finalQrCode\)/)
  assert.doesNotMatch(sandboxPath, /finalizeInvoiceForZatca|retryStoredSimplifiedArtifact/)
})

test('credit is absent when the branch disables it, and Sandbox skips the Production capability handshake', () => {
  assert.match(pos, /const branchCreditDisabled = creditEligibility\?\.branchEnabled === false/)
  assert.match(pos, /selectedCustomerIsBusiness && !branchCreditDisabled/)
  assert.doesNotMatch(pos, /creditEligibilitySettingsPath/)
  assert.match(pos, /branch\?\.zatca_environment === 'sandbox'/)
})

console.log('Standard buyer readiness, Sandbox post-sale print, and credit UX contracts passed')
