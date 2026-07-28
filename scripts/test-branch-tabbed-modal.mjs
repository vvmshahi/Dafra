import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const source = read('src/pages/settings/BranchesTab.tsx')
const en = JSON.parse(read('src/localization/locales/en/branches.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/branches.json'))

assert.match(source, /function BranchModal/)
assert.doesNotMatch(source, /function BranchDrawer|<BranchDrawer|<aside/)
assert.match(source, /(?:max-w-\[1040px\]|md:w-\[min\(100%,1040px\)\])/)
assert.match(source, /id="branch-modal-form"/)
assert.match(source, /form="branch-modal-form"/)

for (const tab of ['general', 'access', 'pos', 'modules', 'invoices', 'zatca']) {
  assert.match(source, new RegExp(`id: '${tab}'`))
  assert.match(source, new RegExp(`branch-tab-\\$\\{tab\\.id\\}`))
  assert.match(source, new RegExp(`branch-panel-${tab}`))
}
assert.match(source, /role="tablist"/)
assert.match(source, /role="tab"/)
assert.match(source, /role="tabpanel"/)
assert.match(source, /aria-selected=\{selected\}/)
assert.match(source, /aria-controls=\{`branch-panel-\$\{tab\.id\}`\}/)
assert.match(source, /event\.key === 'ArrowRight'/)
assert.match(source, /event\.key === 'ArrowLeft'/)
assert.match(source, /event\.key === 'Home'/)
assert.match(source, /event\.key === 'End'/)
assert.match(source, /isRtl \? -1 : 1/)
assert.match(source, /scrollIntoView\(\{ inline: 'nearest', block: 'nearest' \}\)/)
assert.match(source, /overflow-x-auto/)

assert.match(source, /const \[form, setForm\]/)
assert.match(source, /const \[activeTab, setActiveTab\]/)
assert.match(source, /setForm\(prev => \(\{ \.\.\.prev, \[k\]: v \}\)\)/)
assert.match(source, /firstInvalidField/)
assert.match(source, /firstInvalidField\?\.startsWith\('login_'\) \? 'access' : 'general'/)
assert.match(source, /data-branch-field="vat_number"/)
assert.match(source, /data-branch-field="login_username"/)
assert.match(source, /aria-invalid=\{invalid \|\| undefined\}/)
assert.match(source, /setShowAllErrors\(true\)/)

for (const key of [
  'name', 'name_ar', 'business_name', 'business_name_ar', 'vat_number', 'cr_number',
  'building_number', 'street', 'district', 'city', 'country', 'postal_code', 'phone',
  'email', 'website', 'vat_mode', 'invoice_prefix', 'receipt_footer', 'show_logo',
  'invoice_language', 'zatca_phase', 'is_active', 'is_main_branch',
]) {
  assert.match(source, new RegExp(`${key}:\\s+`))
}
assert.match(source, /create_branch_for_tenant/)
assert.match(source, /branchIdFromRpcResult\(data\)/)
assert.match(source, /update_branch_pos_settings/)
assert.match(source, /update_branch_module_settings/)
assert.match(source, /create-branch-user/)
assert.match(source, /from\('branches'\)\.update\(branchPayload\).*select\('id'\)\.single\(\)/s)
assert.ok(source.indexOf('create_branch_for_tenant') < source.indexOf("create-branch-user"))
assert.doesNotMatch(source.slice(source.indexOf('function BranchModal'), source.indexOf('function ResetPasswordModal')), /certificate.*rpc|onboard.*rpc/i)
assert.doesNotMatch(source.slice(source.indexOf('function BranchModal'), source.indexOf('function ResetPasswordModal')), /operations/i)

assert.match(source, /initialFormRef/)
assert.match(source, /JSON\.stringify\(form\) !== initialFormRef\.current/)
assert.match(source, /kind="discard"/)
assert.match(source, /if \(!isDirty\)/)
assert.match(source, /pendingCloseActionRef/)
assert.match(source, /discardOpenRef/)
assert.match(source, /openerRef\.current\?\.focus\(\)/)
assert.match(source, /event\.key === 'Escape'/)
assert.match(source, /event\.key !== 'Tab'/)

assert.match(source, /requestClose\(\(\) => navigate\('\/zatca'\)\)/)
assert.match(source, /availableAfterCreation/)
assert.match(source, /invoiceWorkspaceHelp/)
assert.match(source, /canEditModuleSettings \? \[\{ id: 'modules'/)
assert.match(source, /p_stock_enabled: form\.stock_enabled/)
assert.match(source, /serviceTenant && option\.key === 'enabled'/)

assert.deepEqual(Object.keys(en.tabs).sort(), Object.keys(ar.tabs).sort())
for (const locale of [en, ar]) {
  for (const value of Object.values(locale.tabs)) {
    assert.equal(typeof value, 'string')
    assert.ok(value.length > 0)
  }
}

console.log('Branch tabbed modal structure, contracts, validation, unsaved-state, RTL, and locale checks passed.')
