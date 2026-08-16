import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const source = read('src/pages/settings/BranchesTab.tsx')
const profileClient = read('src/lib/branches/billingProfile.ts')
const configHook = read('src/hooks/useBranchBillingConfig.ts')
const migration = read('supabase/migrations/20260816000200_branch_billing_profile_foundation.sql')
const en = JSON.parse(read('src/localization/locales/en/branches.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/branches.json'))

const defaults = profileClient.slice(
  profileClient.indexOf('export const BRANCH_BILLING_PROFILE_DEFAULTS'),
  profileClient.indexOf('export const BRANCH_BILLING_PROFILE_OPTIONS'),
)
const branchModal = source.slice(source.indexOf('function BranchModal'), source.indexOf('function ResetPasswordModal'))
const identityPayload = branchModal.slice(
  branchModal.indexOf('const branchPayload = {'),
  branchModal.indexOf('// supabase-js@2.45'),
)

assert.deepEqual(
  Object.keys(en.billing.profiles),
  ['retail_trading', 'food_beverage', 'services'],
  'Create Branch exposes the three supported business profiles',
)
assert.equal(en.billing.profiles.retail_trading.label, 'Retail & Trading')
assert.equal(en.billing.profiles.food_beverage.label, 'Food & Beverage')
assert.equal(en.billing.profiles.services.label, 'Services')
assert.deepEqual(Object.keys(en.tabs).sort(), Object.keys(ar.tabs).sort(), 'Billing tab remains localized')

assert.match(defaults, /retail_trading:[\s\S]*productsEnabled: true,[\s\S]*servicesEnabled: false,[\s\S]*customLinesEnabled: false,[\s\S]*posMode: 'quick'/)
assert.match(defaults, /food_beverage:[\s\S]*productsEnabled: true,[\s\S]*servicesEnabled: false,[\s\S]*customLinesEnabled: false,[\s\S]*posMode: 'touch'/)
assert.match(defaults, /services:[\s\S]*productsEnabled: false,[\s\S]*servicesEnabled: true,[\s\S]*customLinesEnabled: false,[\s\S]*posMode: 'touch'/)
assert.match(branchModal, /const selectBusinessProfile = \(profile: BranchBusinessProfile\)/)
assert.match(branchModal, /products_enabled: applyRecommendations \? defaults\.productsEnabled/)
assert.match(branchModal, /services_enabled: applyRecommendations \? defaults\.servicesEnabled/)
assert.match(branchModal, /pos_mode: isNew \? defaults\.posMode : previous\.pos_mode/)

assert.match(branchModal, /What will this branch sell\?|branches:billing\.whatWillSell/)
assert.match(branchModal, /checked=\{form\.products_enabled\}/)
assert.match(branchModal, /checked=\{form\.services_enabled\}/)
assert.match(branchModal, /checked=\{form\.custom_lines_enabled\}/)
assert.match(branchModal, /servicesMustRemainEnabled/)
assert.match(branchModal, /const disabled = isLegacyServiceBranch && option\.key === 'enabled'/)
assert.doesNotMatch(branchModal, /const serviceTenant = resolveBusinessType/)

assert.match(branchModal, /useBranchBillingConfig\(branch\?\.id\)/)
assert.match(configHook, /loadEffectiveBranchBillingConfig/)
assert.match(profileClient, /get_effective_branch_billing_config/)
assert.match(branchModal, /business_profile: effectiveBillingConfig\.businessProfile/)
assert.match(branchModal, /pos_mode: effectiveBillingConfig\.posMode/)
assert.match(branchModal, /legacyProfile/)

assert.match(branchModal, /const createBranchPayload = \{[\s\S]*business_profile: form\.business_profile,[\s\S]*products_enabled: form\.products_enabled,[\s\S]*services_enabled: form\.services_enabled,[\s\S]*custom_lines_enabled: form\.custom_lines_enabled,[\s\S]*pos_mode: form\.pos_mode/)
assert.match(branchModal, /rpc\('create_branch_for_tenant',[\s\S]*p_payload: createBranchPayload/)
assert.match(branchModal, /updateBranchBillingProfileConfig\(branch!\.id, \{[\s\S]*businessProfile: form\.business_profile/)
assert.doesNotMatch(identityPayload, /business_profile|products_enabled|services_enabled|custom_lines_enabled/)
assert.match(migration, /v_actor\.role NOT IN \('owner', 'admin'\)/)
assert.match(migration, /v_actor\.role = 'branch'/)
assert.match(migration, /BRANCH_BILLING_CONFIG_FORBIDDEN/)

assert.match(branchModal, /Not configured|branches:billing\.notConfigured/)
assert.match(branchModal, /effectiveBillingConfig\?\.legacyProfile/)
assert.match(branchModal, /profileChangeKeepsChoices/)
assert.match(branchModal, /dataSafetyHelp/)
assert.match(branchModal, /update_branch_module_settings/)
assert.match(branchModal, /from\('branches'\)\.update\(branchPayload\)/)
assert.match(migration, /New keys[\s\S]*optional, so all existing branch-creation callers remain compatible/)

console.log('Branch billing profile Phase 2 UX tests passed.')
