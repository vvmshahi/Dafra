import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/pages/branch/InvoiceSettingsPage.tsx')
const settings = read('src/lib/invoices/presentationSettings.ts')
const receiptHelper = read('src/lib/receiptPrint.ts')
const pos = read('src/pages/pos/POSPage.tsx')

const js = ts.transpileModule(settings, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { normalizeInvoiceSettings } = await import(`data:text/javascript,${encodeURIComponent(js)}`)
const branch = { name: 'Branch', business_name: 'Company', invoice_language: 'en', print_mode: 'thermal', show_logo: true, show_footer: true, show_cash_change: true }
const legacy = normalizeInvoiceSettings(undefined, branch)
const envelope = normalizeInvoiceSettings({ presentation_settings: { ...legacy.presentation, thermal: { ...legacy.presentation.thermal, width: '58mm', density: 'compact', qr_size: 'large' } }, invoice_language: 'ar', print_mode: 'pdf' }, branch)
assert.equal(legacy.presentation.thermal.width, '80mm')
assert.equal(envelope.invoiceLanguage, 'ar')
assert.equal(envelope.printMode, 'pdf')
assert.equal(envelope.presentation.thermal.width, '58mm')
assert.equal(envelope.presentation.thermal.density, 'compact')
assert.equal(envelope.presentation.thermal.qr_size, 'large')

for (const tab of ['General', 'Header & Branding', 'Contact & Footer', 'Thermal Receipt', 'A4 Themes']) assert.match(page, new RegExp(tab))
for (const marker of ['normalizeInvoiceSettings', 'documentFromPreviewDraft', 'setUseBranchName', 'mobilePane', 'resetChanges', 'beforeunload', 'routeGuard', '<ThermalReceipt', '<A4Document', 'role="tab"', 'role="tabpanel"']) assert.match(page, new RegExp(marker.replace(/[<>]/g, '\\$&')))
assert.doesNotMatch(page, /officialSeller|Official Seller|ComplianceReadiness|manageOfficial/)
assert.match(page, /presentation_settings: normalized\.presentation/)
assert.match(page, /upsert: true/)
assert.doesNotMatch(page, /immutableLogoObjectPath|invoice-branding\//)
assert.doesNotMatch(receiptHelper + pos, /identity_snapshot|branch_compliance_profiles|compliance_identity_mode/)
console.log('Invoice Settings UX redesign focused tests passed (legacy/V1 normalization, tabs, live preview, reset/save guard, mobile pane, logo contract, Official Seller hidden, and print-path safety).')
