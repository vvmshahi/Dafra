import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/pages/branch/InvoiceSettingsPage.tsx')
const workspace = read('src/pages/branch/PrintingDocumentsPage.tsx')
const studioShell = read('src/components/printing/DocumentStudioShell.tsx')
const en = JSON.parse(read('src/localization/locales/en/settings.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/settings.json'))
const settings = value => value.invoiceSettings

assert.match(page, /rpc\('get_branch_invoice_settings'/)
assert.match(page, /rpc\('update_branch_invoice_settings'/)
assert.match(page, /serializeInvoicePresentationSettingsForSave\(normalized/)
assert.doesNotMatch(page, /presentation_settings:\s*normalized\.presentation/)
assert.doesNotMatch(page, /p_payload:\s*\{[\s\S]{0,500}(registeredSellerName|vatNumber|registrationIdentifier|compliance)/)
for (const field of ['display_heading', 'display_subheading', 'custom_display_name', 'show_company_name', 'show_branch_name', 'show_phone', 'show_address', 'thank_you_message', 'footer_note', 'refund_note', 'asset_path', 'asset_version', 'width', 'density', 'qr_size', 'wrap_item_names', 'show_cash_change', 'template_id', 'afterSaleAction']) assert.match(page, new RegExp(field), `missing UI mapping for ${field}`)
assert.doesNotMatch(page, /QR alignment|qr_alignment.*Choice|Choice.*qr_alignment/)
assert.match(page, /resetChanges/); assert.match(page, /beforeunload/); assert.match(page, /routeGuard/)
assert.doesNotMatch(page, /immutableLogoObjectPath/); assert.match(page, /upsert: true/); assert.match(page, /branch\.id\}\/logo/)
assert.match(page, /DocumentStudioSectionNav/)
assert.match(page, /allowedSections/)
assert.match(page, /workspace === 'receipts'/)
for (const workspaceId of ['receipts', 'invoices', 'barcode-labels']) assert.match(workspace, new RegExp(`['\"]${workspaceId}['\"]`))
assert.match(studioShell, /data-studio-section/)
assert.match(studioShell, /aria-current=\{selected \? 'page'/)
assert.match(studioShell, /role="dialog"/)
assert.match(studioShell, /aria-modal="true"/)
for (const locale of [settings(en), settings(ar)]) {
  for (const key of ['sections', 'fields', 'options', 'templates', 'printModes', 'preview', 'readOnlyMessage', 'resetTitle', 'leaveWarning', 'newDocumentsOnly']) assert.ok(locale[key], `missing translation ${key}`)
  assert.ok(locale.documentLanguage, 'missing general settings navigation label')
  for (const key of ['branding', 'contact', 'thermal', 'a4']) assert.ok(locale.sections?.[key], `missing settings navigation label ${key}`)
}
assert.match(page, /resolveInvoicePresentationSettings/)
assert.match(page, /documentFromPreviewDraft/)
assert.match(page, /<A4Document/)
console.log('Phase 4C Invoice Settings UI static assertions passed.')
