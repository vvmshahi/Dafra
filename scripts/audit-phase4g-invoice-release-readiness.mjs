import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()
const config = read('supabase/config.toml'), migration = read('supabase/migrations/20260721000400_invoice_presentation_settings.sql')
const a4 = read('src/components/print/A4Document.tsx'), thermal = read('src/components/print/ThermalReceipt.tsx'), adapters = read('src/lib/invoices/documentViewAdapters.ts')
const invoice = read('src/pages/invoices/InvoiceDetailPage.tsx'), pos = read('src/pages/pos/POSPage.tsx'), settings = read('src/pages/branch/InvoiceSettingsPage.tsx'), branches = read('src/pages/settings/BranchesTab.tsx')

assert.deepEqual(migrations.slice(0,4), ['20260721000100_dafra_current_schema_and_security.sql','20260721000200_phase5x_document_language_snapshot.sql','20260721000300_phase6a_identity_foundation.sql','20260721000400_invoice_presentation_settings.sql'])
assert.match(config, /\[storage\]\s*\nenabled = true/); assert.match(config, /\[storage\.image_transformation\]\s*\nenabled = true/)
assert.match(migration, /INSERT INTO storage\.buckets/); assert.match(migration, /'branch-assets','branch-assets',TRUE,2097152/); assert.match(migration, /storage_invoice_branding_immutable/); assert.match(migration, /Deliberately no UPDATE\/DELETE policy/)
for (const source of [invoice, pos, settings]) assert.match(source, /<A4Document[\s\S]{0,220}model=\{/)
for (const source of [invoice, pos, settings]) assert.match(source, /<ThermalReceipt[\s\S]{0,220}model=\{/)
for (const source of [a4, thermal]) { assert.doesNotMatch(source, /supabase|buildZatcaQR|QRCode|\*\s*0\.15/) }
assert.match(adapters, /documentFromStoredInvoiceV2/); assert.match(adapters, /documentFromStoredInvoiceV1/); assert.match(adapters, /documentFromLegacyInvoice/)
assert.doesNotMatch(branches, /storage\.from\('branch-assets'\)\.upload/); assert.doesNotMatch(branches, /upsert:\s*true/)
assert.match(settings, /serializeInvoicePresentationSettingsForSave\(normalized/); assert.doesNotMatch(settings, /presentation_settings:[\s\S]{0,500}(registeredSellerName|vatNumber|registrationIdentifier|certificate|csid)/)
console.log('Phase 4G release-readiness static assertions passed (paths, snapshots, immutable Storage baseline, renderer secrecy, locale-safe presentation boundary, and migration determinism).')
