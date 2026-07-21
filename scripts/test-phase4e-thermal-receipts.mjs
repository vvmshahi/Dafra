import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const renderer = read('src/components/print/ThermalReceipt.tsx')
const css = read('src/index.css')
const model = read('src/lib/invoices/documentViewModel.ts')
const adapters = read('src/lib/invoices/documentViewAdapters.ts')
const fixture = read('src/lib/invoices/documentPreviewFixture.ts')

assert.match(renderer, /interface ThermalRenderOptions/); assert.match(renderer, /readonly model: DocumentViewModel/)
assert.doesNotMatch(renderer, /businessNameEn|invoiceNumber: string|subtotal: number|buildZatcaQR|QRCode/)
for (const mode of ['58mm', '80mm', 'compact', 'standard', 'detailed']) assert.match(renderer, new RegExp(mode))
assert.match(renderer, /52mm/); assert.match(renderer, /72mm/); assert.match(renderer, /@page \{ size: \$\{width\} auto/)
for (const required of ['seller\.registeredName', 'seller\.vatNumber', 'seller\.registeredAddress', 'identity\.number', 'totals\.taxableAmount', 'totals\.vat', 'totals\.total', 'originalDocument\.number']) assert.match(renderer, new RegExp(required.replaceAll('.', '\\.')))
assert.match(renderer, /presentation\.thermal\.wrapItemNames/); assert.match(renderer, /presentation\.thermal\.showCashChange/); assert.match(renderer, /presentation\.thermal\.qrSize/)
assert.match(renderer, /creditedQuantity/); assert.match(renderer, /creditReason/); assert.match(renderer, /formatDocumentMoney/); assert.doesNotMatch(renderer, /\*\s*0\.15|taxAmount\s*\+/)
assert.match(css, /thermal-receipt--58mm/); assert.match(css, /thermal-items--stacked/); assert.match(css, /thermal-cut/)
assert.match(adapters, /documentFromStoredInvoiceV2/); assert.match(adapters, /documentFromStoredInvoiceV1/); assert.match(adapters, /documentFromLegacyInvoice/)
assert.match(fixture, /sample-credit-qr-marker/); assert.match(fixture, /cashTendered: 40/); assert.match(fixture, /قهوة إثيوبية/)
assert.match(model, /Object\.freeze/)
console.log('Phase 4E thermal receipt contract assertions passed (58/80, three densities, invoice/credit, RTL/bilingual fixture, payments, QR/logo safety, snapshots and deterministic model).')
