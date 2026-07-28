import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const branchesPage = read('src/pages/branches/BranchesPage.tsx')
const branches = read('src/pages/settings/BranchesTab.tsx')
const zatca = read('src/pages/settings/ZatcaTab.tsx')
const account = read('src/pages/settings/AccountTab.tsx')
const enZatca = JSON.parse(read('src/localization/locales/en/zatca.json'))
const arZatca = JSON.parse(read('src/localization/locales/ar-SA/zatca.json'))

assert.doesNotMatch(branchesPage, /zatcaNoticeTitle|zatcaNoticeBody/)
assert.match(branches, /role="progressbar"/)
assert.match(branches, /aria-valuenow=\{activeBranchCount\}/)
assert.doesNotMatch(branches, /branch-panel-zatca|id: 'zatca'|manageZatca/)
assert.match(branches, /isNew && activeTab !== tabs\[tabs\.length - 1\]\.id/)
assert.match(branches, /'common:next'/)
assert.match(branches, /'branches:editor\.create'/)
assert.match(branches, /'branches:editor\.saveChanges'/)

const connectedStatus = zatca.slice(
  zatca.indexOf('function ProductionConnectionStatus'),
  zatca.indexOf('function DisconnectedStatus'),
)
assert.match(connectedStatus, /const \{ t, i18n \} = useTranslation\('zatca'\)/)
assert.match(connectedStatus, /const dateLocale =/)
assert.match(connectedStatus, /formatDateTime\(status\.connectedAt, dateLocale\)/)
assert.match(zatca, /role="radio"/)
assert.match(zatca, /aria-checked=\{functionalityMap === option\.value\}/)
assert.match(zatca, /otp\.length !== 6/)
assert.match(zatca, /PRODUCTION_STEPS\.map/)
assert.equal(enZatca.protectedHelp, 'Kubri securely protects your branch connection details.')
assert.equal(arZatca.protectedHelp, 'يحمي كبري تفاصيل اتصال فرعك بشكل آمن.')

assert.match(account, /autoComplete="new-password"/)
assert.match(account, /newPass\.length < 8 \|\| newPass !== confirmPass/)
assert.match(account, /focus-visible:ring-2/)

console.log('Owner Workspace refinement: modal flow, capacity, ZATCA connected expansion, capability radios, OTP, progress, account security, and bilingual safety copy passed.')
