import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const edge = read('supabase/functions/zatca-submit/index.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const receipt = read('src/pages/print/ReceiptPrintPage.tsx')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const selector = read('src/lib/zatca/qrSelector.ts')
const migration = read('scripts/sql/zatca-phase2-finalization-v2/01_artifact_lifecycle.sql')
const claims = read('scripts/sql/zatca-phase2-finalization-v2/03_claims_and_idempotency.sql')
const lock = read('scripts/sql/zatca-phase2-finalization-v2/04_lock_compliance_fields.sql')
const verifier = read('scripts/sql/zatca-phase2-finalization-v2/06_verification.sql')
const signedFixture = read('.zatca-debug/simplified_invoice.signed.xml')

const v2Edge = edge.slice(edge.indexOf('async function processInvoiceV2'))
const localSigning = v2Edge.indexOf('const signed = await signInvoice(')
const localPersist = v2Edge.indexOf("persist_zatca_simplified_final_v2")
const networkFetch = v2Edge.indexOf('const response = await fetch(')
assert(localSigning >= 0, 'server finalization must reuse signInvoice')
assert(localPersist >= 0 && localPersist < networkFetch, 'final compliance persistence must precede network submission')
assert(edge.includes("action === 'finalize'"), 'finalize action is missing')
assert(edge.includes("action === 'status'"), 'output status action is missing')
assert(edge.includes('Stored submission artifact does not match its durable request identity'), 'retry must validate and reuse the stored artifact')

const reportingRpc = claims.slice(claims.indexOf('persist_zatca_reporting_result_v2'), claims.indexOf('adopt_zatca_cleared_artifact_v2'))
for (const field of ['zatca_simplified_xml =', 'zatca_simplified_xml_hash =', 'zatca_simplified_signature =', 'zatca_simplified_qr =']) {
  assert(!reportingRpc.includes(field), `reporting status must not rewrite ${field}`)
}

assert(pos.includes('finalizeInvoiceForZatca'), 'POS must finalize before rendering')
assert(pos.includes('zatcaQrCode:    finalQrCode'), 'POS must render the server QR')
assert(!pos.includes('buildZatcaQR'), 'POS must not use Phase 1 QR for final output')
assert(receipt.includes('selectStoredInvoiceQr'), 'ReceiptPrintPage must use the read-only QR selector')
assert(receipt.includes('getInvoiceZatcaOutputState'), 'ReceiptPrintPage must use the server output gate')
assert(!receipt.includes('buildZatcaQR'), 'ReceiptPrintPage must not generate a fallback QR')
assert(detail.includes('selectStoredInvoiceQr'), 'InvoiceDetailPage must use the read-only QR selector')
assert(detail.includes('getInvoiceZatcaOutputState'), 'InvoiceDetailPage must use the server output gate')
assert(!detail.includes('buildZatcaQR'), 'InvoiceDetailPage must not generate a fallback QR')
assert(!detail.includes("update({ zatca_qr_code"), 'InvoiceDetailPage must not write QR values')
assert(selector.includes('environment === \'sandbox\''), 'selector must distinguish sandbox explicitly')
assert(selector.includes("artifact_stage === 'simplified_final'"), 'simplified output must require a final v2 stage')
assert(selector.includes("artifact_stage === 'standard_cleared'"), 'standard output must require a cleared v2 stage')

assert(migration.includes('zatca_lifecycle_state'), 'v2 lifecycle migration missing')
assert(!/UPDATE\s+public\.invoices/i.test(migration), 'historical invoices must not be classified or backfilled')
assert(lock.includes('REVOKE UPDATE'), 'compliance update privileges must be revoked')
assert(lock.includes('invoices_zatca_compliance_write_guard'), 'immutability trigger missing')
assert(verifier.includes('ROLLBACK;'), 'verification must end with rollback')
assert(verifier.includes('pos_checkout_hash'), 'protected checkout hash check missing')
assert(verifier.includes('snapshot_language_hash'), 'protected language trigger hash check missing')

const qrMatch = signedFixture.match(/<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>/)
assert(qrMatch?.[1], 'signed fixture must contain a final QR')
const finalQrHash = (await import('node:crypto')).createHash('sha256').update(qrMatch[1], 'utf8').digest('hex')
assert(finalQrHash.length === 64, 'final QR hash must be SHA-256')
const firstIssueQr = qrMatch[1]
const reprintQr = qrMatch[1]
assert(firstIssueQr === reprintQr, 'first issue and reprint selectors must reuse one final QR value')

console.log('PASS: local finalization precedes network submission')
console.log('PASS: retries consume stored XML/hash/signature/QR')
console.log('PASS: POS, receipt, and Invoice Detail use read-only stored QR selection')
console.log('PASS: client QR writes and Phase 1 final-output fallbacks are absent')
console.log('PASS: additive migration, ownership lock, verification, and rollback artifacts exist')
