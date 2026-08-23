import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildGenerationQr } from '../supabase/functions/_shared/fiscal/generation_qr.mjs'
import { decodeTlvBase64 } from '../supabase/functions/_shared/fiscal/tlv.mjs'
import { validateGenerationInvoiceSnapshot, GENERATION_ERRORS } from '../supabase/functions/_shared/fiscal/generation_validation.mjs'

const edge = await readFile(new URL('../supabase/functions/fiscal-finalize-generation/index.ts', import.meta.url), 'utf8')
const migration = await readFile(new URL('../supabase/migrations/20260824000300_generation_finalizer_b2.sql', import.meta.url), 'utf8')

const valid = {
  zatca_invoice_type: 'simplified', total: '115.00', tax_amount: '15.00',
  seller: { business_name: 'KUBRI', vat_number: '123456789012345' }, customer: null,
}
assert.equal(validateGenerationInvoiceSnapshot(valid).documentKind, 'simplified')
assert.throws(() => validateGenerationInvoiceSnapshot({ ...valid, seller: { business_name: 'KUBRI', vat_number: '1' } }), new RegExp(GENERATION_ERRORS.VALIDATION_FAILED))
assert.equal(validateGenerationInvoiceSnapshot({ ...valid, zatca_invoice_type: 'standard', customer: { customer_type: 'individual' } }).documentKind, 'standard')
assert.throws(() => validateGenerationInvoiceSnapshot({ ...valid, zatca_invoice_type: 'standard', customer: { customer_type: 'business' } }), new RegExp(GENERATION_ERRORS.VALIDATION_FAILED))

const qr = buildGenerationQr({ sellerName: 'KUBRI', sellerVatNumber: '123456789012345', timestamp: '2026-08-24T00:00:00.000Z', totalIncludingVat: 115, vatTotal: 15 })
assert.deepEqual(decodeTlvBase64(qr).map(field => field.tag), [1, 2, 3, 4, 5])
assert.match(edge, /finalize_generation_invoice_v1/)
assert.match(edge, /buildGenerationQr/)
for (const forbidden of ['zatca-submit', 'Reporting', 'Clearance', 'zatca_counter_number', 'previous_hash', 'fiscal_phase2']) assert.equal(edge.includes(forbidden), false, `forbidden ${forbidden}`)
for (const required of ['generation_issued', 'canPrint', 'canShare', 'IDEMPOTENCY_CONFLICT', 'FISCAL_POLICY_CHANGED']) assert.equal(migration.includes(required) || edge.includes(required), true, `missing ${required}`)
assert.match(migration, /generation_fiscal_operations_v1/)
assert.match(migration, /UNIQUE \(branch_id, checkout_idempotency_key\)/)
assert.match(migration, /fiscal_document_snapshot_hash/)
console.log('Generation finalizer B2 tests passed: 19 assertions')
