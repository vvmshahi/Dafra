import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const dashboard = read('src/pages/admin/DashboardPage.tsx')
const branches = read('src/pages/settings/BranchesTab.tsx')
const zatca = read('src/pages/settings/ZatcaTab.tsx')
const settings = read('src/pages/settings/SettingsPage.tsx')
const subscription = read('src/pages/settings/SubscriptionTab.tsx')
const account = read('src/pages/settings/AccountTab.tsx')

const dashboardCard = dashboard.slice(dashboard.indexOf('function BranchCard'), dashboard.indexOf('// ── Welcome'))
assert.match(dashboardCard, /bg-sidebar/)
assert.match(dashboardCard, /min-h-\[390px\].*flex flex-col/s)
assert.match(dashboardCard, /flex-1 rounded-xl/)
assert.match(dashboardCard, /bg-gold-500/)
for (const key of ['sessionSalesLabel', 'expectedCash', 'cash', 'card', 'invoices', 'vat', 'viewDetails']) {
  assert.match(dashboardCard, new RegExp(key))
}

const directoryCard = branches.slice(branches.indexOf('function BranchCard'), branches.indexOf('export default function BranchesTab'))
assert.match(directoryCard, /bg-sidebar/)
assert.doesNotMatch(directoryCard, /invoice_prefix|#\{branch\.invoice_prefix\}/)
for (const key of ['card.city', 'card.phone', 'card.vat', 'editor.login', 'resetPassword', 'contactSupport']) {
  assert.match(directoryCard, new RegExp(key.replace('.', '\\.')))
}
assert.match(branches, /role="progressbar"/)
assert.match(branches, /contactAddBranches/)
assert.doesNotMatch(branches, /editor\.legalIdentityHelp/)
assert.match(branches, /officialSeller\.legacyFieldWarning/)

assert.match(zatca, /role="dialog"\s+aria-modal="true"/)
assert.match(zatca, /max-w-\[880px\]/)
assert.match(zatca, /event\.key === 'Escape'/)
assert.match(zatca, /event\.key !== 'Tab'/)
assert.match(zatca, /returnFocusRef\.current\?\.focus/)
assert.match(zatca, /const \[functionalityMap, setFunctionalityMap\].*useState<ZatcaFunctionalityMap \| ''>\(''\)/)
assert.match(zatca, /if \(initialStatus\?\.functionalityMap\) setFunctionalityMap/)
assert.match(zatca, /disabled=\{!isOwner \|\| loading \|\| otp\.length !== 6 \|\| !functionalityMap\}/)
assert.match(zatca, /Number\.isNaN\(date\.getTime\(\)\)/)

assert.doesNotMatch(settings, /businessType\.readOnly/)
assert.match(subscription, /lg:grid-cols-2/)
assert.match(subscription, /role="progressbar"/)
assert.match(account, /const \[editingProfile, setEditingProfile\]/)
assert.match(account, /if \(editingProfile\) return[\s\S]*setPhone\(profile\?\.phone \?\? ''\)/)
assert.match(account, /!editingProfile \?/)
assert.match(account, /setEditingProfile\(false\)/)
assert.match(account, /const \[editingPassword, setEditingPassword\]/)
assert.match(account, /!editingPassword \?/)
assert.match(account, /newPass\.length < 8 \|\| newPass !== confirmPass/)

console.log('Owner Workspace second refinement: branded cards, compact capacity, modal ZATCA, explicit capability, compact settings, profile view/edit, and password gating passed.')
