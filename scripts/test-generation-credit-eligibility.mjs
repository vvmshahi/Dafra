import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolveCreditNoteEligibility } from '../src/lib/fiscal/domain.ts'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const modal = await read('src/pages/invoices/CreateCreditNoteModal.tsx')
const detail = await read('src/pages/invoices/InvoiceDetailPage.tsx')
const list = await read('src/pages/invoices/InvoicesPage.tsx')
const presentation = await read('src/lib/zatca/creditNotePresentation.mjs')
const b3 = await read('supabase/migrations/20260824000400_generation_notes_b3.sql')
const finalizer = await read('supabase/functions/fiscal-finalize-generation/index.ts')

const generationIssued = {
  parentRegime: 'generation',
  parentLifecycle: 'generation_issued',
  currentRegime: 'generation',
  integrationAccepted: false,
}
assert.deepEqual(resolveCreditNoteEligibility(generationIssued), { allowed: true, regime: 'generation' })
assert.deepEqual(resolveCreditNoteEligibility({ ...generationIssued, parentLifecycle: 'not_submitted' }), {
  allowed: false,
  code: 'GENERATION_FINALIZATION_REQUIRED',
})
assert.deepEqual(resolveCreditNoteEligibility({ ...generationIssued, currentRegime: 'integration' }), {
  allowed: false,
  code: 'CROSS_REGIME_NOTE_NOT_ALLOWED',
})

const integration = { parentRegime: 'integration', parentLifecycle: 'reported', currentRegime: 'integration' }
assert.deepEqual(resolveCreditNoteEligibility({ ...integration, integrationAccepted: true }), { allowed: true, regime: 'integration' })
assert.deepEqual(resolveCreditNoteEligibility({ ...integration, parentLifecycle: 'cleared', integrationAccepted: true }), { allowed: true, regime: 'integration' })
assert.deepEqual(resolveCreditNoteEligibility({ ...integration, integrationAccepted: false }), {
  allowed: false,
  code: 'INTEGRATION_NOT_ACCEPTED',
})
assert.deepEqual(resolveCreditNoteEligibility({ ...integration, currentRegime: 'generation', integrationAccepted: true }), {
  allowed: false,
  code: 'FISCAL_POLICY_INVALID',
})

assert.match(modal, /createGenerationCreditNote\(/)
assert.match(modal, /fullParentSelected/)
assert.match(modal, /generationCreditFullParentOnly/)
assert.match(modal, /generationOriginalRefundAllocation/)
assert.match(modal, /generationCreditEligible \? \[\] : \[/)
assert.match(modal, /generationRefundPlanReady/)
assert.match(modal, /!usedGenerationCredit && atomicSimplifiedCreditEligible/)
assert.match(modal, /!usedGenerationCredit && !usedAtomicSimplifiedCredit/)
assert.match(detail, /resolveCreditNoteEligibility\(/)
assert.match(detail, /generationCreditFinalizationRequired/)
assert.match(list, /resolveCreditNoteEligibility\(/)
assert.match(list, /CROSS_REGIME_NOTE_NOT_ALLOWED/)
assert.match(presentation, /input\?\.fiscalRegimeAtIssue === 'generation'/)
assert.match(presentation, /statusKey: 'creditNotes:generationNotRequired'/)

assert.match(b3, /fiscal_regime_at_issue IS DISTINCT FROM 'generation'/)
assert.match(b3, /fiscal_lifecycle_state IS DISTINCT FROM 'generation_issued'/)
assert.match(b3, /GENERATION_CREDIT_LIMIT_EXCEEDED/)
assert.match(b3, /payment_refunds/)
assert.match(b3, /pos_stock_movements/)
assert.match(finalizer, /create_generation_note_v1/)
assert.match(finalizer, /parent_invoice_id/)
assert.match(finalizer, /CROSS_REGIME_NOTE_NOT_ALLOWED/)
assert.doesNotMatch(finalizer, /zatca-submit/)

console.log('Generation Credit Note eligibility matrix and B3 routing checks passed')
