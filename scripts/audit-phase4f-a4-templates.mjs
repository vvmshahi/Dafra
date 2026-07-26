import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const registry = read('src/lib/invoices/a4TemplateRegistry.ts')
const renderer = read('src/components/print/A4Document.tsx')
const settings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const css = read('src/index.css')
const en = JSON.parse(read('src/localization/locales/en/documents.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/documents.json'))

for (const id of ['classic', 'modern_split', 'minimal_professional']) assert.match(registry, new RegExp(id))
assert.match(registry, /resolveA4Template/); assert.match(registry, /unknown_historical_template/)
assert.match(settings, /<A4Document[\s\S]*model=\{previewModel\}/)
assert.doesNotMatch(renderer, /from\('branches'\)|supabase|buildZatcaQR|QRCode|\*\s*0\.15/)
assert.match(renderer, /seller\.registeredName/); assert.match(renderer, /seller\.vatNumber/); assert.match(renderer, /model\.identity\.kind === 'credit_note'/)
assert.match(renderer, /presentation\.logo\.previewUrl/); assert.match(renderer, /options\.qrImageUrl/); assert.match(css, /@page \{ size: A4/); assert.doesNotMatch(css, /a4-document[^}]*thermal-paper-width/)
for (const key of ['taxInvoice', 'creditNoteNumber', 'debitNoteNumber', 'taxDebitNote', 'vatNumber', 'taxableAmount', 'qrCode', 'computerGeneratedCreditNote']) { assert.ok(en[key], `English key missing: ${key}`); assert.ok(ar[key], `Arabic key missing: ${key}`) }
console.log('Phase 4F A4 template static architecture assertions passed.')
