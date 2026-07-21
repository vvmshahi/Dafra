import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const model = read('src/lib/invoices/documentViewModel.ts')
const adapters = read('src/lib/invoices/documentViewAdapters.ts')
const settings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const receipt = read('src/pages/print/ReceiptPrintPage.tsx')
const thermal = read('src/lib/invoices/documentThermalProps.ts')

assert.match(model, /export interface DocumentViewModel/)
assert.match(settings, /documentFromPreviewDraft/); assert.match(settings, /<DocumentPreview/)
assert.match(adapters, /documentFromStoredInvoiceV2/); assert.match(adapters, /documentFromStoredInvoiceV1/); assert.match(adapters, /documentFromLegacyInvoice/)
assert.match(adapters, /documentFromFullCreditNote/); assert.match(adapters, /documentFromPartialCreditNote/)
assert.match(adapters, /documentFromPreviewCreditNoteDraft/)
assert.match(detail, /documentFromStoredInvoice/); assert.match(receipt, /documentFromStoredInvoice/)
assert.match(detail, /thermalReceiptPropsFromDocument/); assert.match(receipt, /thermalReceiptPropsFromDocument/)
assert.match(adapters, /snapshot\.presentationSettings/); assert.match(adapters, /base\(input, 'legacy', null, true\)/)
assert.match(model, /resolveHistoricalA4Template/); assert.match(model, /unknown_historical_template/)
assert.match(model, /Object\.freeze/); assert.doesNotMatch(model + adapters, /(password|access_token|service_role|private_key|certificate|csid|otp)/i)
assert.doesNotMatch(settings.slice(settings.indexOf('const previewModel')), /\b50\.43\b|\b7\.57\b|\b58\.00\b/)
assert.match(thermal, /model\.totals/); assert.doesNotMatch(thermal, /\*\s*0\.15|\+\s*.*tax/)
console.log('Phase 4D DocumentViewModel static architecture assertions passed.')
