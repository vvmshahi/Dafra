import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260729000200_atomic_default_new_retail_branches.sql')
const pos = read('src/pages/pos/POSPage.tsx')
const submission = read('src/lib/zatca/submission.ts')
const docs = read('docs/atomic-default-new-retail-branches-20260729.md')
const en = JSON.parse(read('src/localization/locales/en/validation.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/validation.json'))

assert.match(migration, /CREATE TRIGGER branches_20_provision_zatca_checkout_defaults_v1[\s\S]*AFTER INSERT ON public\.branches/)
assert.match(migration, /enabled,[\s\S]*false,[\s\S]*awaiting_production_onboarding/)
assert.doesNotMatch(
  migration,
  /UPDATE public\.zatca_atomic_checkout_branch_gates_v2/,
  'existing branch gates must not be updated',
)
assert.match(migration, /v_profile\.role NOT = ''owner''[\s\S]*v_profile\.role <> ''owner''/)

assert.match(migration, /resolve_pos_checkout_document_internal_v1/)
assert.match(migration, /resolve_pos_checkout_document_v1[\s\S]*auth\.uid\(\)/)
assert.match(migration, /customer_type = 'business'[\s\S]*\^3\[0-9\]\{13\}3\$/)
assert.match(migration, /business_without_qualifying_vat/)
assert.match(migration, /BRANCH_SIMPLIFIED_ONLY/)
assert.match(migration, /BRANCH_STANDARD_ONLY/)
assert.match(migration, /INVOICE_CAPABILITY_NOT_CONFIGURED/)
assert.match(migration, /ZATCA_CONNECTION_REQUIRED/)
assert.match(migration, /STANDARD_DOCUMENT_REQUIRES_CLEARANCE_FLOW/)
assert.match(migration, /ATOMIC_NOT_READY/)
assert.match(migration, /ATOMIC_CHECKOUT_REQUIRED/)
assert.match(migration, /current_setting\('app\.atomic_checkout_intent_id', true\)/)

assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_pos_checkout_document_internal_v1[\s\S]*GRANT EXECUTE[\s\S]*TO service_role/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_pos_checkout_document_v1[\s\S]*GRANT EXECUTE[\s\S]*TO authenticated/)
assert.match(migration, /SET search_path = public, pg_temp/g)
assert.match(migration, /SET row_security = off/g)
assert.match(migration, /CHECKOUT_DOCUMENT_CLASSIFICATION_MISMATCH/)
assert.match(migration, /product_units_commercial_function_contracts_v1/)

assert.match(submission, /resolvePosCheckoutDocument/)
assert.match(pos, /await resolvePosCheckoutDocument\(branch\.id, customerId\)/)
assert.match(pos, /documentDecision\.documentType === 'standard'/)
assert.match(pos, /documentDecision\.checkoutPath === 'atomic'/)
assert.match(pos, /productionCheckoutMode = 'legacy'/)
assert.match(pos, /atomicCheckoutResult\.receipt\.can_print === true/)
assert.match(pos, /if \(isB2BInvoice\) void maybeAutoPrintReceiptAfterSale/)

for (const key of [
  'branchSimplifiedOnly',
  'branchStandardOnly',
  'invoiceCapabilityNotConfigured',
  'zatcaConnectionRequired',
  'atomicNotReady',
  'standardCustomerDetailsRequired',
]) {
  assert.ok(en[key])
  assert.ok(ar[key])
}

assert.match(docs, /Business without a qualifying VAT number: explicitly Simplified/)
assert.match(docs, /There is no existing-branch migration/)
assert.match(docs, /Standard: always the existing legacy clearance path/)

console.log('Atomic default for new retail branches focused contracts passed')
