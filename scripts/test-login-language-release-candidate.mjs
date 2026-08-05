import assert from 'node:assert/strict'
import fs from 'node:fs'

const login = fs.readFileSync('src/pages/auth/LoginPage.tsx', 'utf8')
const landing = fs.readFileSync('src/pages/landing/LandingPage.tsx', 'utf8')
const navigation = fs.readFileSync('src/lib/loginNavigation.ts', 'utf8')
const selector = fs.readFileSync('src/components/localization/CompactLanguageSelector.tsx', 'utf8')
const locale = fs.readFileSync('src/localization/locale.ts', 'utf8')
const useLocale = fs.readFileSync('src/localization/useLocale.ts', 'utf8')

assert.match(login, /approvedLoginReturnPath\(location\.state\)/)
assert.match(login, /!isDesktopApp\(\)/)
assert.match(login, /\{loginReturnPath && \(/)
assert.doesNotMatch(login, /to="\/"[\s\S]{0,300}common:back/)

assert.match(navigation, /from\.startsWith\('\/'\)/)
assert.match(navigation, /from === '\/login'/)
assert.match(landing, /to="\/login" state=\{\{ from: '\/' \}\}/)
assert.match(navigation, /from\.startsWith\('\/login\?'\)/)
assert.doesNotMatch(navigation, /window\.history|history\.length/)

assert.match(selector, /role="group"/)
assert.match(selector, /aria-pressed=\{active\}/)
assert.match(selector, /English/)
assert.match(selector, /العربية/)
assert.match(selector, /min-w-\[88px\]/)
assert.doesNotMatch(selector, /aria-current|\|<|index > 0/)

assert.match(locale, /UI_LOCALE_STORAGE_KEY = 'kubri\.uiLocale'/)
assert.match(useLocale, /persistUiLocale\(nextLocale\)/)

console.log('Login root-navigation and English/Arabic segmented-selector contract passed')
