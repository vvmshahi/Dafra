import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isSandboxFiscalDocument } from '../src/lib/zatca/fiscalDocumentScope.ts'
import { selectStoredInvoiceQr } from '../src/lib/zatca/qrSelector.ts'
import { selectStoredOutputStateQr } from '../src/lib/zatca/qrDisplay.mjs'

const detail = readFileSync('src/pages/invoices/InvoiceDetailPage.tsx', 'utf8')
const receipt = readFileSync('src/pages/print/ReceiptPrintPage.tsx', 'utf8')

const inv0001 = { is_demo: false }
const mainBranchSandbox = { zatca_environment: 'sandbox' }
const productionBranch = { zatca_environment: 'production' }
const acceptedQr = 'ACCEPTED-SANDBOX-PHASE2-QR'

assert.equal(isSandboxFiscalDocument(inv0001, mainBranchSandbox), true,
  'a fiscal invoice on a Sandbox branch must use the Sandbox output contract')
assert.equal(
  selectStoredInvoiceQr(null, 'sandbox', { sandboxGenerated: true, sandboxQrCode: acceptedQr }),
  acceptedQr,
  'a reported Sandbox simplified invoice exposes its persisted QR on reopen',
)
assert.equal(
  selectStoredInvoiceQr(null, 'sandbox', { sandboxGenerated: true, sandboxQrCode: null }),
  null,
  'a Sandbox invoice without an accepted QR must not generate or invent one',
)
assert.equal(isSandboxFiscalDocument(inv0001, productionBranch), false,
  'Production documents retain the existing output-state route')
assert.equal(selectStoredOutputStateQr({
  contractMode: 'legacy',
  legacyCompatible: true,
  invoiceStatus: 'reported',
  finalizationStatus: 'legacy_reported',
  artifactStage: 'legacy_final',
  documentKind: 'standard',
  canPrint: true,
  qrCode: 'PRODUCTION-STANDARD-QR',
}), 'PRODUCTION-STANDARD-QR', 'Production Standard/B2B output remains unchanged')
assert.equal(isSandboxFiscalDocument({ is_demo: true }, mainBranchSandbox), false,
  'non-fiscal demo records must never obtain a fiscal QR')

for (const [name, source] of [['invoice detail', detail], ['receipt print', receipt]]) {
  assert.match(source, /isSandboxFiscalDocument\(invoice, branch\)/,
    `${name} routes persisted Sandbox branches through the Sandbox status contract`)
  assert.match(source, /getSandboxValidationStatus\(invoice\.id\)/,
    `${name} reads the authenticated Sandbox status output`)
  assert.match(source, /selectStoredInvoiceQr\(null, 'sandbox'/,
    `${name} renders only the returned Sandbox QR payload`)
  assert.match(source, /sandboxDocument \? sandboxValidated/,
    `${name} permits document output only after the accepted Sandbox status response`)
  assert.match(source, /qrImageUrl: qrDataUrl/,
    `${name} passes the same rendered payload into its document renderer`)
  assert.doesNotMatch(source, /invoice!?\.zatca_qr_code/,
    `${name} does not bypass the safe QR read contract`)
}

assert.match(detail, /A4Document[\s\S]*qrImageUrl: qrDataUrl/)
assert.match(detail, /ThermalReceipt[\s\S]*qrImageUrl: qrDataUrl/)
assert.match(receipt, /ThermalReceipt[\s\S]*qrImageUrl: qrDataUrl/)

console.log('Sandbox issued-document QR routing tests passed.')
