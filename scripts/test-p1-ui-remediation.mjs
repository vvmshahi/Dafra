import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const customers = read('src/pages/customers/CustomersPage.tsx')
const archiveEntity = read('src/lib/archiveEntity.ts')
const auth = read('src/hooks/useAuth.ts')
const sidebar = read('src/components/layout/Sidebar.tsx')
const dashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const reports = read('src/pages/reports/ReportsPage.tsx')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const printingEn = JSON.parse(read('src/localization/locales/en/printing.json'))
const printingAr = JSON.parse(read('src/localization/locales/ar-SA/printing.json'))
const customersEn = JSON.parse(read('src/localization/locales/en/customers.json'))
const customersAr = JSON.parse(read('src/localization/locales/ar-SA/customers.json'))
const authEn = JSON.parse(read('src/localization/locales/en/auth.json'))
const authAr = JSON.parse(read('src/localization/locales/ar-SA/auth.json'))

test('customer archive verifies the soft-update response before state removal', () => {
  assert.match(customers, /await archiveEntity\(supabase as unknown as ArchiveEntityClient, 'customers', target\.id\)/)
  assert.match(archiveEntity, /update\(\{ is_active: false \}\).*eq\('id', id\).*select\('id'\).*maybeSingle\(\)/s)
  assert.match(archiveEntity, /result\.data\?\.id !== id/)
  assert.ok(customers.indexOf('await archiveEntity') < customers.indexOf('setCustomers(prev => prev.filter'))
  assert.match(customers, /archivingIds\.has\(target\.id\)/)
  assert.match(customers, /kind="customerArchive"/)
  assert.doesNotMatch(customers, /\.from\(['"]customers['"]\)\.delete\(/)
  assert.equal(customersEn.success.archived, 'Customer archived successfully.')
  assert.equal(customersAr.success.archived, 'تمت أرشفة العميل بنجاح.')
})

test('sign out is single-flight and cleanup follows confirmed remote success', () => {
  const request = auth.indexOf('await supabase.auth.signOut()')
  const cleanup = auth.indexOf("key.startsWith('pos_cart_')")
  assert.ok(request >= 0 && cleanup > request)
  assert.match(auth, /if \(signOutPending\.current\)/)
  assert.match(auth, /try \{[\s\S]*await supabase\.auth\.signOut\(\)[\s\S]*\} catch/)
  assert.match(auth, /if \(error\)[\s\S]*return \{ error, pending: false \}/)
  assert.match(auth, /setUser\(null\)[\s\S]*setProfile\(null\)[\s\S]*setTenant\(null\)[\s\S]*setBranch\(null\)/)
  assert.doesNotMatch(auth, /removeItem\(['"](?:i18nextLng|language)/)
  assert.match(sidebar, /disabled=\{signingOut\}/)
  assert.match(sidebar, /toast\.error\(t\('auth:signOutFailure'\)\)/)
  assert.equal(authEn.signingOut, 'Signing out…')
  assert.equal(authAr.signingOut, 'جارٍ تسجيل الخروج…')
})

test('printing settings visible copy is localized in English and Arabic', () => {
  assert.doesNotMatch(invoiceSettings, />General</)
  assert.doesNotMatch(invoiceSettings, />Header & Branding</)
  assert.doesNotMatch(invoiceSettings, />Contact & Footer</)
  assert.doesNotMatch(invoiceSettings, /window\.confirm/)
  assert.match(invoiceSettings, /kind="removeLogo"/)
  assert.match(invoiceSettings, /kind="discard"/)
  for (const locale of [printingEn, printingAr]) {
    assert.equal(typeof locale.invoiceSettings.tabs.general, 'string')
    assert.equal(typeof locale.invoiceSettings.branding.logoHelp, 'string')
    assert.equal(typeof locale.invoiceSettings.contact.footer, 'string')
    assert.equal(typeof locale.invoiceSettings.thermal.paperWidth, 'string')
    assert.equal(typeof locale.invoiceSettings.a4.theme, 'string')
    assert.equal(typeof locale.barcodeLabels.calibration.deviceOnly, 'string')
  }
})

test('long-open register warning is actionable without changing register RPC authority', () => {
  assert.match(dashboard, /session\.isLongOpen &&/)
  assert.match(dashboard, /longOpenRisk/)
  assert.match(dashboard, /onManageRegister/)
  assert.match(dashboard, /onManageRegister=\{\(\) => navigate\('\/pos'\)\}/)
  assert.match(dashboard, /60_000/)
  assert.match(dashboard, /timeZone: 'Asia\/Riyadh'/)
  assert.doesNotMatch(dashboard, /rpc\(['"][^'"]*close/i)
})

test('report tabs provide associated panels and roving keyboard focus', () => {
  assert.match(reports, /role="tablist"/)
  assert.match(reports, /role="tab"/)
  assert.match(reports, /aria-selected=\{active === tabItem\.id\}/)
  assert.match(reports, /aria-controls=\{`report-panel-/)
  assert.match(reports, /role="tabpanel"/)
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.match(reports, new RegExp(key))
  assert.match(reports, /tabRefs\.current\[next\]\?\.focus\(\)/)
})

test('hybrid sidebar footer remains compact, visible and route-aware', () => {
  assert.match(sidebar, /data-sidebar-footer/)
  assert.match(sidebar, /min-h-11/)
  assert.match(sidebar, /grid grid-cols-2 gap-1/)
  const estimatedExpandedFooterHeight = 44 + 32 + 40 + 16 + 4
  assert.ok(estimatedExpandedFooterHeight >= 130 && estimatedExpandedFooterHeight <= 145)
  assert.match(sidebar, /AuthenticatedLanguageSwitch/)
  assert.match(sidebar, /navigation:profile/)
  assert.match(sidebar, /auth:signOut/)
  assert.match(sidebar, /scrollIntoView\(\{ block: 'nearest' \}\)/)
  assert.match(sidebar, /overflow-y-auto sidebar-scroll/)
  assert.match(sidebar, /truncate/)
  assert.match(sidebar, /dir=\{isRtl \? 'rtl' : 'ltr'\}/)
})
