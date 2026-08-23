import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectStoredOutputStateQr } from '../src/lib/zatca/qrDisplay.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const submission = read('src/lib/zatca/submission.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const browserPrint = read('src/lib/print/browserPrint.ts')

const cleared = {
  contractMode: 'legacy', legacyCompatible: false, invoiceStatus: 'cleared',
  finalizationStatus: 'sandbox_cleared', artifactStage: 'sandbox_final',
  canPrint: true, qrCode: 'persisted-cleared-qr',
}
const reported = {
  contractMode: 'legacy', legacyCompatible: false, invoiceStatus: 'reported',
  finalizationStatus: 'sandbox_reported', artifactStage: 'sandbox_final',
  canPrint: true, qrCode: 'persisted-reported-qr',
}

assert.equal(selectStoredOutputStateQr(cleared), 'persisted-cleared-qr')
assert.equal(selectStoredOutputStateQr(reported), 'persisted-reported-qr')
assert.equal(selectStoredOutputStateQr({ ...cleared, canPrint: false }), null)
assert.equal(selectStoredOutputStateQr({ ...cleared, invoiceStatus: 'failed', qrCode: 'rejected-qr' }), null)

assert.match(submission, /from\('invoices'\)/)
assert.match(submission, /zatca_status,zatca_clearance_status,zatca_clearance_response/)
assert.match(submission, /const accepted = invoiceStatus === 'cleared' \|\| invoiceStatus === 'reported'/)
assert.match(submission, /artifactStage: 'sandbox_final'/)
assert.match(submission, /retryAvailable: false/)
assert.match(pos, /getInvoiceZatcaOutputState\(/)
assert.match(pos, /selectStoredOutputStateQr\(sandboxOutput\)/)
assert.match(pos, /\{!receipt\.canPrint\s*&&/)
assert.match(browserPrint, /window\.print\(\)/)

console.log('Sandbox cleared/reported success-modal state tests passed (8 assertions)')
