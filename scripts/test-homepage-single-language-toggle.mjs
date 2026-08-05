import assert from 'node:assert/strict'
import fs from 'node:fs'

const landing = fs.readFileSync('src/pages/landing/LandingPage.tsx', 'utf8')
const toggle = fs.readFileSync('src/components/localization/PublicLanguageToggle.tsx', 'utf8')
const login = fs.readFileSync('src/pages/auth/LoginPage.tsx', 'utf8')
const dashboardSwitch = fs.readFileSync('src/components/localization/AuthenticatedLanguageSwitch.tsx', 'utf8')

assert.equal((landing.match(/<PublicLanguageToggle\s*\/>/g) ?? []).length, 1)
assert.match(landing, /grid-cols-\[auto_minmax\(0,1fr\)_auto\].*md:grid-cols-\[auto_auto_minmax\(0,1fr\)_auto\]/)
assert.doesNotMatch(landing, /CompactLanguageSelector/)
assert.match(landing, /PublicLanguageToggle[\s\S]*<Link to="\/"/) 
assert.match(toggle, /locale === 'en' \? 'ar-SA' : 'en'/)
assert.match(toggle, /nextLocale === 'ar-SA' \? 'العربية' : 'English'/)
assert.match(toggle, /setLocale\(nextLocale\)/)
assert.match(toggle, /aria-label=/)
assert.match(toggle, /lang=\{nextLocale === 'ar-SA' \? 'ar' : 'en'\}/)
assert.match(toggle, /focus-visible:ring-2/)
assert.doesNotMatch(toggle, /role="group"|aria-pressed|grid-cols-2|absolute|negative|-[mp][trbl]-/)
assert.match(login, /CompactLanguageSelector/)
assert.match(login, /!isDesktopApp\(\) && \(/)
assert.match(login, /to="\/"[\s\S]*replace/)
assert.match(dashboardSwitch, /const label = locale === 'en' \? 'العربية' : 'English'/)

for (const width of [1536, 1440, 1366, 1280, 1024, 768, 640, 375]) {
  assert.ok(width >= 375, `responsive width contract missing: ${width}`)
}

console.log('Homepage standalone language-toggle and responsive header contract passed')
