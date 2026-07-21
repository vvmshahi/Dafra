import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/pages/settings/OfficialSellerProfilePage.tsx')
const card = read('src/components/compliance/ComplianceReadinessCard.tsx')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const branchSettings = read('src/pages/settings/BranchesTab.tsx')
const en = JSON.parse(read('src/localization/locales/en/settings.json')).officialSeller
const ar = JSON.parse(read('src/localization/locales/ar-SA/settings.json')).officialSeller

assert.match(page, /saveComplianceDraft[\s\S]*submitComplianceReview[\s\S]*reviewCompliance[\s\S]*activateCompliance/)
assert.match(page, /confirmation: true/)
assert.match(page, /profile\?\.role === 'owner'/)
assert.match(page, /type="checkbox"/)
assert.match(page, /field\.ltr \? 'ltr' : 'auto'/)
assert.doesNotMatch(page, /recoverLegacyMode|getComplianceAudit|actions\.(submit|verify|reject|activate|recover)|officialSeller\.(status|mode)/)
assert.doesNotMatch(card, /officialSeller\.(status|mode)|legacy mode|protected mode/i)
assert.match(card, /'incomplete' \| 'confirmed' \| 'reconfirm'/)
assert.match(invoiceSettings, /ComplianceReadinessCard[^>]*invoiceGuidance/)
assert.match(branchSettings, /officialSeller\.legacyFieldWarning/)

assert.equal(en.simpleTitle, 'Official Seller Information')
assert.equal(en.simpleDescription, 'These are the official details used for ZATCA invoices. Enter them exactly as shown on your VAT certificate or official registration.')
assert.match(en.confirmDialog.message, /Existing invoices will not be changed\./)
assert.deepEqual(Object.keys(ar.publicState).sort(), Object.keys(en.publicState).sort())
assert.deepEqual(Object.keys(ar.groups).sort(), Object.keys(en.groups).sort())
assert.deepEqual(Object.keys(ar.cardAction).sort(), Object.keys(en.cardAction).sort())
assert.deepEqual(Object.keys(ar.confirmDialog).sort(), Object.keys(en.confirmDialog).sort())
assert.deepEqual(Object.keys(ar.validation).sort(), Object.keys(en.validation).sort())
assert.deepEqual(Object.keys(ar.fields).sort(), Object.keys(en.fields).sort())

console.log('Phase 1 simplified Official Seller frontend assertions passed.')
