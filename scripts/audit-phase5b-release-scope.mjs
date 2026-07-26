import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()
const additive = read('supabase/migrations/20260722000100_reconcile_branch_assets_bucket.sql')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx'), branches = read('src/pages/settings/BranchesTab.tsx')
const a4 = read('src/components/print/A4Document.tsx'), thermal = read('src/components/print/ThermalReceipt.tsx')
const invoice = read('src/pages/invoices/InvoiceDetailPage.tsx'), pos = read('src/pages/pos/POSPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/documents.json')), ar = JSON.parse(read('src/localization/locales/ar-SA/documents.json'))

assert.equal(migrations.at(-1), '20260722000100_reconcile_branch_assets_bucket.sql')
for (const rule of ['INSERT INTO storage.buckets','2097152','image/jpeg','image/png','image/webp','DROP POLICY IF EXISTS','storage_invoice_branding_immutable','phase5b_invoice_branding_insert','invoice-branding']) assert.match(additive, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
assert.doesNotMatch(additive, /DELETE FROM storage\.objects|UPDATE public\.invoices|identity_snapshot/)
assert.doesNotMatch(branches, /storage\.from\('branch-assets'\)\.upload|upsert:\s*true/)
assert.match(invoiceSettings, /serializeInvoicePresentationSettingsForSave\(normalized/); assert.doesNotMatch(invoiceSettings, /presentation_settings:[\s\S]{0,500}(registeredSellerName|vatNumber|registrationIdentifier|certificate|csid)/)
for (const renderer of [a4,thermal]) assert.doesNotMatch(renderer, /supabase|buildZatcaQR|QRCode|\*\s*0\.15/)
assert.match(invoice, /documentFromStoredInvoice/); assert.match(pos, /documentFromPosReceipt/)
for (const source of [invoice,pos]) { assert.match(source, /<ThermalReceipt/); assert.match(source, /<A4Document/) }
assert.doesNotMatch(`${invoiceSettings}\n${branches}\n${a4}\n${thermal}`, /\bdebugger\b/)
for (const key of ['taxInvoice','creditNoteNumber','qrCode']) { assert.ok(en[key],`English key missing: ${key}`); assert.ok(ar[key],`Arabic key missing: ${key}`) }
console.log('Phase 5B release-scope audit passed (additive Storage migration, immutable render paths, presentation boundary, shared documents, locales, and no debugger statements).')
