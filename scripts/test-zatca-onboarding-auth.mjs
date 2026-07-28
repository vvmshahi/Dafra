import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const api = readFileSync('src/lib/zatca/api.ts', 'utf8')
const tab = readFileSync('src/pages/settings/ZatcaTab.tsx', 'utf8')
const edge = readFileSync('supabase/functions/zatca-onboard-production/index.ts', 'utf8')
const auth = readFileSync('supabase/functions/_shared/zatca/auth.ts', 'utf8')
const en = JSON.parse(readFileSync('src/localization/locales/en/zatca.json', 'utf8'))
const ar = JSON.parse(readFileSync('src/localization/locales/ar-SA/zatca.json', 'utf8'))

assert.match(api, /'Authorization': `Bearer \$\{jwt\}`/)
assert.match(api, /'apikey': EDGE_API_KEY/)
assert.match(api, /if \(!session\?\.access_token\) return expireKubriSession\('SESSION_MISSING'\)/)
assert.match(api, /supabase\.auth\.refreshSession\(\)/)
assert.equal((api.match(/supabase\.auth\.refreshSession\(\)/g) ?? []).length, 1)
assert.match(api, /clearStaleAuthSessionData\(\)/)
assert.match(api, /session_expired/)
assert.doesNotMatch(api, /console\.(?:log|info|warn|error)\([^)]*(?:jwt|access_token|Authorization)/)
assert.doesNotMatch(api, /Bearer \$\{session\?\./)

assert.match(auth, /AUTH_HEADER_MISSING/)
assert.match(auth, /EDGE_JWT_REJECTED/)
assert.match(auth, /db\.auth\.getUser\(jwt\)/)
assert.match(auth, /profile\.role !== 'owner'/)
assert.match(edge, /loadOwnedBranch\(/)
assert.match(edge, /ZatcaAuthContractError/)
assert.match(edge, /\{ code: err\.code \}/)

assert.match(api, /isZatcaOtpRejection/)
assert.match(api, /compliance_csid_request_completed/)
assert.match(tab, /errors\.invalidOrExpiredOtp/)
assert.match(tab, /errors\.sessionExpired/)
assert.match(api, /action: 'status'/)
assert.match(api, /action: 'onboard'/)

for (const locale of [en, ar]) {
  assert.ok(locale.errors.sessionExpired)
  assert.ok(locale.errors.invalidOrExpiredOtp)
}

console.log('ZATCA onboarding authenticated transport contract: PASS')
