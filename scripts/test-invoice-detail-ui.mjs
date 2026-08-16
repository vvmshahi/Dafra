import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const a4PreviewFit = read('src/components/print/A4PreviewFit.tsx')
const adapters = read('src/lib/invoices/documentViewAdapters.ts')
const thermal = read('src/components/print/ThermalReceipt.tsx')
const thermalCompositions = read('src/components/print/ThermalReceiptCompositions.tsx')
const receiptPage = read('src/pages/print/ReceiptPrintPage.tsx')
const readiness = read('src/lib/invoices/issuedDocumentReadiness.ts')
const enInvoices = JSON.parse(read('src/localization/locales/en/invoices.json'))
const arInvoices = JSON.parse(read('src/localization/locales/ar-SA/invoices.json'))
const enCredit = JSON.parse(read('src/localization/locales/en/creditNotes.json'))
const arCredit = JSON.parse(read('src/localization/locales/ar-SA/creditNotes.json'))
const enPrinting = JSON.parse(read('src/localization/locales/en/printing.json'))
const arPrinting = JSON.parse(read('src/localization/locales/ar-SA/printing.json'))

// One canonical model feeds the visible configured renderers and A4 print target.
assert.match(detail, /documentFromStoredInvoice\(\{[\s\S]*authoritativeDocumentKind:/)
assert.equal((detail.match(/id="invoice-printable"/g) ?? []).length, 0)
assert.doesNotMatch(detail, /VAT.*15%|\(15%\)|sellerNames|sellerAddresses|documentTitleLines/)
assert.match(detail, /<A4Document model=\{documentViewModel\} options=\{\{ preview: true/)
assert.match(detail, /<ThermalReceipt model=\{documentViewModel\} options=\{\{ preview: true/)
assert.match(detail, /<A4Document model=\{documentViewModel\} options=\{\{ preview: autoPrint, pdfMode: true/)
assert.equal((detail.match(/<ThermalReceipt/g) ?? []).length, 1)

// Historical preference chooses the initial mode without persistence.
assert.match(detail, /function resolveDefaultInvoicePreviewMode/)
assert.match(detail, /if \(printMode === 'thermal'\) return 'thermal'/)
assert.match(detail, /if \(printMode === 'pdf'\) return 'a4'/)
assert.match(detail, /afterSaleAction === 'receipt' \? 'thermal' : 'a4'/)
assert.match(detail, /documentViewModel\.presentation\.printMode/)
assert.doesNotMatch(detail, /localStorage.*preview|update_branch_invoice_settings/)

// Tabs are operable and only the selected renderer is visible.
for (const marker of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected=', 'ArrowLeft', 'ArrowRight', 'focus-visible:ring-2']) {
  assert.ok(detail.includes(marker), `missing accessible preview marker: ${marker}`)
}
assert.match(detail, /previewMode === 'a4' \? \(/)
assert.match(detail, /<A4PreviewFit bounded zoom=\{a4PreviewZoom\}>/)
assert.match(detail, /h-\[clamp\(30rem,calc\(100dvh-14\.5rem\),58rem\)\]/)

// Printing stays gated by the finalized QR; A4 has a repeat-click lock.
assert.match(detail, /selectStoredOutputStateQr\(outputStateMatchesInvoice \? outputState : null\)/)
assert.match(detail, /renderIssuedDocumentQr\(/)
assert.doesNotMatch(detail, /buildZatcaQR|sellerName.*QRCode|vatNumber.*QRCode/)
assert.match(detail, /if \(a4Printing\) return/)
assert.match(detail, /disabled=\{a4Printing \|\| !printReady\}/)
assert.match(detail, /setA4Printing\(true\)[\s\S]*setA4Printing\(false\)/)
assert.match(detail, /openBrowserReceiptPrint\(invoice\.id\)/)
assert.match(detail, /openPrintPopup\(`\/invoices\/\$\{encodeURIComponent\(invoice\.id\)\}\?print=1`\)/)
assert.match(detail, /documentReadiness\.phase === 'qr_failed'/)
assert.match(receiptPage, /documentReadiness = resolveIssuedDocumentReadiness/)
assert.match(receiptPage, /setQrRetryVersion/)
assert.match(readiness, /readIssuedDocumentOutputState/)
assert.match(readiness, /sessionStorage/)
assert.match(readiness, /renderIssuedDocumentQr/)
assert.match(readiness, /loading_document.*loading_qr.*qr_failed/)
assert.match(detail, /printing:printInvoice/)
assert.doesNotMatch(detail, /\(PDF\)|printing:printA4/)

// Header is compact, non-repetitive, and keeps the two print actions together.
const header = detail.slice(detail.indexOf('<header'), detail.indexOf('</header>') + '</header>'.length)
assert.equal((detail.match(/\{documentTitle\}/g) ?? []).length, 1)
assert.doesNotMatch(header, /documentKindLabel|paymentStatusLabel|paymentStatuses|legacyBestEffort|identity\.legacy/)
assert.doesNotMatch(header, /creditNotes:create|creditNotes:createAnother|openCreditModal/)
assert.match(header, /aria-label=\{t\('printing:printActions'\)\}[\s\S]*printing:printInvoice[\s\S]*printing:printReceipt/)
assert.match(header, /px-3 py-2\.5 sm:px-4 sm:py-3/)

// Credit-note flow is one compact preview action, preserves history, and returns focus.
assert.doesNotMatch(detail, /min-w-\[620px\]|original_quantity\)}|credited_quantity\)}/)
assert.doesNotMatch(detail, /credit-summary-title|creditNotes:sectionTitle/)
assert.match(detail, /remainingRefundableAmount = refundableItems\.length > 0/)
assert.match(detail, /creditedAmount = linkedCreditNotes\.reduce/)
assert.match(detail, /<details[\s\S]*creditNotes:viewCreditNotes/)
assert.match(detail, /creditNotes:createAnother/)
assert.equal((detail.match(/onClick=\{openCreditModal\}/g) ?? []).length, 1)
assert.match(detail, /canCreateCreditNote && \([\s\S]*creditNotes:createAnother/)
assert.match(detail, /<CreateCreditNoteModal/)
assert.match(detail, /creditNoteTriggerRef\.current\?\.focus\(\)/)

// Preview follows the header and zoom changes only the screen wrapper.
assert.ok(detail.indexOf('aria-labelledby="document-preview-title"') > detail.indexOf('</header>'))
assert.match(a4PreviewFit, /zoom\?: A4PreviewZoom/)
assert.match(a4PreviewFit, /data-preview-zoom=\{zoom\}/)
assert.match(a4PreviewFit, /overflow-auto/)
assert.match(a4PreviewFit, /transform: `scale\(\$\{scale\}\)`/)
const printTarget = detail.split('\n').find(line => line.includes("pdfMode: true, id: 'invoice-printable-a4'")) ?? ''
assert.doesNotMatch(printTarget, /zoom|scale/)

// Standard/Simplified adjustment titles use authenticated output-state kind.
assert.match(adapters, /authoritativeDocumentKind\?: 'simplified' \| 'standard'/)
assert.match(adapters, /invoiceType: input\.authoritativeDocumentKind \?\? invoice\.zatca_invoice_type/)
assert.match(receiptPage, /authoritativeDocumentKind: outputStateMatchesInvoice \? outputState\?\.documentKind : null/)
assert.match(thermal, /ThermalReceiptCompositions/)
assert.match(thermalCompositions, /const isStandard = identity\.invoiceType === 'standard'/)
assert.doesNotMatch(thermalCompositions, /isAdjustment && buyer\.type/)

// Existing snapshot and legacy adapters remain available.
for (const adapter of ['documentFromStoredInvoiceV2', 'documentFromStoredInvoiceV1', 'documentFromLegacyInvoice']) {
  assert.match(adapters, new RegExp(`function ${adapter}`))
}
assert.doesNotMatch(header, /documentViewModel\.identity\.legacy/)

for (const [en, ar, keys] of [
  [enInvoices, arInvoices, ['documentStatus', 'paymentStatus', 'legacyBestEffort', 'documentPreview', 'documentPreviewHint', 'previewMode']],
  [enCredit, arCredit, ['createAnother', 'creditedAmount', 'linkedCount', 'viewCreditNotes']],
  [enPrinting, arPrinting, ['printActions', 'invoicePreviewTab', 'receiptPreviewTab', 'previewZoom', 'zoomFit', 'zoomPercent']],
]) {
  for (const key of keys) {
    assert.equal(typeof en[key], 'string', `missing English key ${key}`)
    assert.equal(typeof ar[key], 'string', `missing Arabic key ${key}`)
  }
}

console.log('Invoice Detail shared-preview and compact credit-note UX assertions passed.')
