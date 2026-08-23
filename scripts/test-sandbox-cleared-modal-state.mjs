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
const sandboxAccepted = {
  contractMode: 'legacy', legacyCompatible: false, invoiceStatus: 'cleared',
  finalizationStatus: 'sandbox_accepted', artifactStage: 'sandbox_final',
  canPrint: true, qrCode: 'persisted-accepted-qr',
}

assert.equal(selectStoredOutputStateQr(cleared), 'persisted-cleared-qr')
assert.equal(selectStoredOutputStateQr(reported), 'persisted-reported-qr')
assert.equal(selectStoredOutputStateQr(sandboxAccepted), 'persisted-accepted-qr')
assert.equal(selectStoredOutputStateQr({ ...cleared, canPrint: false }), null)
assert.equal(selectStoredOutputStateQr({ ...cleared, invoiceStatus: 'failed', qrCode: 'rejected-qr' }), null)

const sandboxReader = submission.match(/if \(connection\.environment === 'sandbox'\) \{[\s\S]*?return upstreamStatus\n  \}/)?.[0] ?? ''
assert.ok(sandboxReader)
assert.match(sandboxReader, /zatca-submit-sandbox-demo/)
assert.doesNotMatch(sandboxReader, /from\('invoices'\)/)
assert.match(sandboxReader, /artifactStage: String\(data\?\.artifactStage/)
assert.match(pos, /getInvoiceZatcaOutputState\(/)
assert.match(pos, /selectStoredOutputStateQr\(sandboxOutput\)/)
assert.match(pos, /\{!receipt\.canPrint\s*&&/)
assert.match(pos, /retryFinalizationAllowed/)
assert.match(pos, /statusRefreshUnavailable/)
assert.match(browserPrint, /window\.print\(\)/)

console.log('Sandbox cleared/reported success-modal state tests passed (12 assertions)')
