import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const settings = read('src/lib/invoices/presentationSettings.ts')
const adapters = read('src/lib/invoices/documentViewAdapters.ts')
const runtimePresentation = read('src/lib/invoices/runtimePresentation.ts')
const thermal = read('src/components/print/ThermalReceipt.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const receipt = read('src/pages/print/ReceiptPrintPage.tsx')
const helper = read('src/lib/receiptPrint.ts')
const migration = read('scripts/sql/v1-release/01_invoice_presentation_settings_only.sql')

const settingsModuleSource = ts.transpileModule(settings, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { normalizeInvoiceSettings } = await import(`data:text/javascript,${encodeURIComponent(settingsModuleSource)}`)
const legacyBranch = {
  name: 'Legacy branch', business_name: 'Legacy seller', invoice_language: 'ar', print_mode: 'both',
  phone: '0500000000', show_email: false, show_website: false, show_footer: true,
  show_cash_change: true, show_logo: true,
}
const undefinedSettings = normalizeInvoiceSettings(undefined, legacyBranch)
const nullSettings = normalizeInvoiceSettings(null, legacyBranch)
assert.equal(undefinedSettings.invoiceLanguage, 'ar')
assert.equal(undefinedSettings.printMode, 'both')
assert.equal(undefinedSettings.presentation.thermal.width, '80mm')
assert.equal(undefinedSettings.presentation.a4.template_id, 'classic')
assert.deepEqual(nullSettings.presentation, undefinedSettings.presentation)
const populatedSettings = normalizeInvoiceSettings({
  presentation_settings: {
    identity: { display_heading: 'Counter', show_company_name: false, show_branch_name: true },
    thermal: { width: '58mm', density: 'compact', qr_size: 'large', wrap_item_names: false, show_cash_change: false },
  },
  invoice_language: 'en', print_mode: 'pdf',
}, legacyBranch)
assert.equal(populatedSettings.invoiceLanguage, 'both')
assert.equal(populatedSettings.printMode, 'pdf')
assert.equal(populatedSettings.presentation.identity.display_heading, 'Counter')
assert.equal(populatedSettings.presentation.thermal.width, '58mm')
assert.equal(populatedSettings.presentation.thermal.density, 'compact')

assert.match(settings, /export function normalizeInvoiceSettings\(rawSettings: unknown/)
assert.match(settings, /raw\.presentation_settings/)
assert.match(settings, /raw\.presentation/)
assert.match(runtimePresentation, /resolveInvoicePresentationSettings/)
assert.match(adapters, /resolveRuntimeInvoicePresentation/)
assert.match(runtimePresentation, /savedSettings === undefined \? branch\.presentation_settings/)
assert.match(adapters, /settings: resolved\.presentation/)
assert.doesNotMatch(adapters, /buildPresentationDocument\(\{ settings, language: documentLanguage\(input\.invoice\.document_language/)
for (const fallback of ["'both'", "'thermal'", "'80mm'", "'standard'", "'classic'"]) assert.match(settings, new RegExp(`oneOf\\([^\\n]+${fallback}`))
assert.match(thermal, /const model = 'model' in props \? props\.model : legacyModel\(props\)/)
assert.match(thermal, /normalizeInvoiceSettings\(/)
assert.match(thermal, /issueTimestamp: props\.issueTimestamp/)
for (const page of [pos, detail, receipt]) assert.match(page, /issueTimestamp=/)
for (const source of [pos, detail, receipt, helper]) {
  assert.doesNotMatch(source, /identity_snapshot/)
  assert.doesNotMatch(source, /presentation\s*\}/)
}
assert.match(migration, /'presentation_settings',coalesce/)
assert.match(migration, /'invoice_language',b\.invoice_language/)
assert.match(migration, /'print_mode',b\.print_mode/)

console.log('V1 POS settings compatibility assertions passed (undefined/null/partial settings normalize to legacy presentation defaults; populated V1 envelope remains supported; receipt/PDF paths do not query Phase 6A identity fields).')
