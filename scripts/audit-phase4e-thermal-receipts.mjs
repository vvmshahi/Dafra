import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const renderer = read('src/components/print/ThermalReceipt.tsx')
const calls = ['src/pages/invoices/InvoiceDetailPage.tsx', 'src/pages/print/ReceiptPrintPage.tsx', 'src/pages/pos/POSPage.tsx', 'src/pages/settings/PrinterTab.tsx', 'src/pages/branch/InvoiceSettingsPage.tsx'].map(read)
const css = read('src/index.css')
const en = JSON.parse(read('src/localization/locales/en/documents.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/documents.json'))

for (const source of calls) { assert.match(source, /<ThermalReceipt[\s\S]{0,180}model=\{/); assert.doesNotMatch(source, /<ThermalReceipt[\s\S]{0,500}(businessNameEn|invoiceNumber=|subtotal=|documentLanguage=)/) }
assert.doesNotMatch(renderer, /from\('branches'\)|supabase|buildZatcaQR|QRCode|\*\s*0\.15/)
assert.match(renderer, /seller\.registeredName/); assert.match(renderer, /seller\.vatNumber/); assert.match(renderer, /seller\.registeredAddress/)
for (const mode of ['58mm', '80mm', 'compact', 'standard', 'detailed']) assert.match(renderer, new RegExp(mode))
assert.match(renderer, /identity\.kind === 'credit_note'/); assert.match(renderer, /thermalPrintCss/); assert.match(renderer, /@media print/)
assert.match(renderer, /presentation\.logo\.previewUrl/); assert.match(renderer, /options\.qrImageUrl/)
for (const key of ['taxInvoice', 'creditNoteNumber', 'debitNoteNumber', 'taxDebitNote', 'vatNumber', 'taxableAmount', 'qrCode', 'computerGeneratedCreditNote']) { assert.ok(en[key], `English document key missing: ${key}`); assert.ok(ar[key], `Arabic document key missing: ${key}`) }
console.log('Phase 4E thermal receipt static architecture assertions passed.')
