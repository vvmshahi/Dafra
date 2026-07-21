import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/pages/branch/InvoiceSettingsPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/settings.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/settings.json'))
const settings = value => value.invoiceSettings

assert.match(page, /rpc\('get_branch_invoice_settings'/)
assert.match(page, /rpc\('update_branch_invoice_settings'/)
assert.match(page, /presentation_settings: normalized\.presentation/)
assert.doesNotMatch(page, /p_payload:\s*\{[\s\S]{0,500}(registeredSellerName|vatNumber|registrationIdentifier|compliance)/)
for (const field of ['display_heading', 'display_subheading', 'custom_display_name', 'show_company_name', 'show_branch_name', 'show_phone', 'show_address', 'thank_you_message', 'footer_note', 'refund_note', 'asset_path', 'asset_version', 'width', 'density', 'qr_size', 'wrap_item_names', 'show_cash_change', 'template_id', 'template_version', 'header_style']) assert.match(page, new RegExp(field), `missing UI mapping for ${field}`)
assert.match(page, /cancelChanges/); assert.match(page, /resetChanges/); assert.match(page, /beforeunload/); assert.match(page, /routeGuard/)
assert.match(page, /immutableLogoObjectPath/); assert.match(page, /upsert: false/); assert.doesNotMatch(page, /\$\{bid\}\/logo\.\$\{ext\}/)
assert.match(page, /canEdit/); assert.match(page, /readOnlyMessage/); assert.match(page, /newDocumentsOnly/)
for (const locale of [settings(en), settings(ar)]) {
  for (const key of ['sections', 'fields', 'options', 'templates', 'printModes', 'preview', 'readOnlyMessage', 'resetTitle', 'leaveWarning', 'newDocumentsOnly']) assert.ok(locale[key], `missing translation ${key}`)
}
assert.match(page, /resolveHistoricalA4Template/)
console.log('Phase 4C Invoice Settings UI static assertions passed.')
