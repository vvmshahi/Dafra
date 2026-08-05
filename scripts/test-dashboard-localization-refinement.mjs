import assert from 'node:assert/strict'
import fs from 'node:fs'

const sidebar = fs.readFileSync('src/components/layout/Sidebar.tsx', 'utf8')
const switcher = fs.readFileSync('src/components/localization/AuthenticatedLanguageSwitch.tsx', 'utf8')
const login = fs.readFileSync('src/pages/auth/LoginPage.tsx', 'utf8')
const rial = fs.readFileSync('src/components/ui/RiyalSymbol.tsx', 'utf8')
const formats = fs.readFileSync('src/lib/utils/localeFormat.ts', 'utf8')
const dates = fs.readFileSync('src/lib/utils/date.ts', 'utf8')
const adminDashboard = fs.readFileSync('src/pages/admin/DashboardPage.tsx', 'utf8')
const branchDashboard = fs.readFileSync('src/pages/branch/BranchDashboardPage.tsx', 'utf8')

assert.match(sidebar, /<AuthenticatedLanguageSwitch inverse collapsed=\{collapsed\}/)
assert.doesNotMatch(sidebar, /AuthenticatedLanguageSwitch[^\n]*w-full/)
assert.match(switcher, /aria-pressed="true"/)
assert.match(switcher, /collapsed \? 'w-10 px-0' : 'w-fit'/)
assert.match(switcher, /focus-visible:ring-2/)
assert.match(switcher, /Switch interface language to/)

assert.match(login, /CompactLanguageSelector/)
assert.doesNotMatch(login, /AuthenticatedLanguageSwitch/)

assert.match(rial, /formatDisplayCurrency\(amount, locale, decimals\)/)
assert.match(rial, /currentUiLocale\(\)/)
assert.match(formats, /ar-SA/)
assert.match(formats, /SAUDI_DISPLAY_TIME_ZONE/)
assert.match(formats, /formatDisplayPercent/)
assert.match(dates, /locale\?\.startsWith\('ar'\)/)
assert.doesNotMatch(dates, /ar-SA-u-nu-latn/)
assert.match(adminDashboard, /formatDisplayInteger\(sessionTotals\.invoices, i18n\.language\)/)
assert.match(branchDashboard, /formatDisplayInteger\(session\.invoiceCount, i18n\.language\)/)
assert.match(branchDashboard, /formatSaudiDateTime\(session\.openedAt, i18n\.language\)/)

const arabic = new Intl.NumberFormat('ar-SA').format(2873.5)
const english = new Intl.NumberFormat('en-SA').format(2873.5)
assert.equal(arabic, '٢٬٨٧٣٫٥')
assert.equal(english, '2,873.5')
assert.match(new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date('2026-08-05T13:01:00Z')), /٥ أغسطس ٢٠٢٦/)

console.log('Dashboard compact language switch and Arabic display-format contract passed')
