import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile(new URL('../supabase/migrations/20260824000800_generation_pos_checkout_capability_gate.sql', import.meta.url), 'utf8')
const submission = await readFile(new URL('../src/lib/zatca/submission.ts', import.meta.url), 'utf8')
const pos = await readFile(new URL('../src/pages/pos/POSPage.tsx', import.meta.url), 'utf8')
const finalizer = await readFile(new URL('../supabase/functions/fiscal-finalize-generation/index.ts', import.meta.url), 'utf8')

assert.match(migration, /fiscal_regime = 'generation'/)
assert.match(migration, /fiscal_activation_state <> 'generation_active'/)
assert.match(migration, /'checkoutPath', 'generation'/)
assert.match(migration, /'readinessStatus', 'generation_ready'/)
assert.match(migration, /'atomicEligibilityReason', 'generation_uses_fiscal_finalizer'/)
assert.match(migration, /GENERATION_SELLER_IDENTITY_REQUIRED/)
assert.match(migration, /validate_standard_buyer_identity_internal_v1/)

const generationSegment = migration.split('-- Integration and Sandbox retain')[0]
for (const forbidden of [
  'zatca_production_credentials',
  'zatca_client_capabilities_v2',
  'get_zatca_atomic_checkout_eligibility_v2',
  'zatca_branch_readiness_v2',
  'resolve-zatca-connection',
]) {
  assert.equal(generationSegment.includes(forbidden), false, `Generation segment must not reference ${forbidden}`)
}

assert.match(submission, /PosCheckoutPath = .*'generation'/)
assert.match(submission, /checkoutPath === 'generation'/)
assert.match(submission, /fiscal-finalize-generation/)
assert.match(submission, /checkout_idempotency_key/)
assert.match(submission, /expected_policy_revision/)

const generationCheckout = pos.slice(pos.indexOf("} else if (generationCheckoutRequested)"), pos.indexOf("} else if (productionCheckoutMode === 'legacy')"))
assert.match(generationCheckout, /finalizeGenerationInvoice/)
assert.equal(generationCheckout.includes('submitInvoiceForBranch'), false)
assert.equal(generationCheckout.includes('requireZatcaFinalizationCapability'), false)
assert.match(pos, /branch\?\.fiscal_regime === 'generation'/)
assert.match(pos, /generationCheckoutIdempotencyKey/)
assert.match(pos, /branch\.fiscal_regime === 'generation'/)

assert.match(finalizer, /finalize_generation_invoice_v1/)
assert.equal(finalizer.includes('zatca-submit'), false)
assert.equal(finalizer.includes('previous_hash'), false)
assert.equal(finalizer.includes('zatca_counter_number'), false)

console.log('Generation POS capability-gate tests passed: 24 assertions')
