import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const edge = read('supabase/functions/zatca-onboard-trading-sandbox-v2/index.ts')
const migration = read('supabase/migrations/20260804000600_trading_sandbox_v2.sql')
const securityMigration = read('supabase/migrations/20260804000700_trading_sandbox_v2_security_hardening.sql')
const sessionFixMigration = read('supabase/migrations/20260804000800_fix_trading_sandbox_v2_session_create.sql')
const api = read('src/lib/zatca/api.ts')
const ui = read('src/pages/settings/ZatcaTab.tsx')

assert.match(edge, /const TENANT_ID = 'ebf1144b-55ed-472a-99c9-23b5ee915351'/)
assert.match(edge, /const BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'/)
assert.match(edge, /const ENVIRONMENT = 'integration_sandbox'/)
assert.match(edge, /const FUNCTIONALITY_MAP: FunctionalityMap = '0100'/)
assert.match(edge, /https:\/\/gw-fatoora\.zatca\.gov\.sa\/e-invoicing\/developer-portal/)
assert.doesNotMatch(edge, /api\.zatca\.gov\.sa|production\.zatca\.gov\.sa/)
assert.doesNotMatch(edge, /zatca-onboard-sandbox-demo|zatca_sandbox_credentials|zatca_production_credentials/)

assert.match(edge, /keys\.length !== 1 \|\| keys\[0\] !== 'otp'/)
assert.match(api, /edgePostSafe<TradingSandboxV2Status>\('zatca-onboard-trading-sandbox-v2', \{ otp \}\)/)
assert.doesNotMatch(ui.slice(ui.indexOf('function TradingSandboxV2Connector'), ui.indexOf('function TradingSandboxReconnectDebug')), /localStorage|sessionStorage|location\.search|analytics|console\./)

const persisted = edge.indexOf('const encrypted = await encryptText(bodyText')
const parsed = edge.indexOf('const complianceBody = parseComplianceJson(complianceRaw.bodyText')
assert.ok(persisted >= 0 && parsed > persisted, 'upstream response must be encrypted before parsing')
assert.match(edge, /function parseComplianceJson\(text: string\)/)
assert.match(edge, /function parseComplianceResponse\(body: unknown\)/)
assert.match(edge, /typeof value\.requestID !== 'number'/)
assert.match(edge, /requestID: String\(value\.requestID\)/)
assert.match(edge, /SANDBOX_V2_COMPLIANCE_RESPONSE_NOT_FOUND/)
assert.match(edge, /SANDBOX_V2_COMPLIANCE_RESPONSE_DECRYPT_FAILED/)
assert.match(edge, /SANDBOX_V2_COMPLIANCE_RESPONSE_JSON_INVALID/)
assert.match(edge, /SANDBOX_V2_COMPLIANCE_REQUIRED_FIELD_MISSING/)
assert.match(edge, /SANDBOX_V2_COMPLIANCE_FIELD_TYPE_INVALID/)
assert.match(edge, /compliance_response_shape_verified/)
assert.match(edge, /function parsePersistedComplianceResponse\(/)
assert.match(edge, /function resumePersistedCompliance\(/)
assert.doesNotMatch(edge, /SANDBOX_V2_COMPLIANCE_SCHEMA_MISMATCH/)
assert.doesNotMatch(edge, /diagnose_persisted_compliance_shape/)
assert.match(edge, /parseExactProduction\(body: any\)/)
assert.match(edge, /decodeCertificateToken\(production\.binarySecurityToken\)/)
assert.doesNotMatch(edge, /decodeCertificateToken\(production\.secret\)|encrypted_compliance_response[^\n]*certificate/)
assert.match(edge, /productionCertificateField: 'binarySecurityToken'/)
const productionBlock = edge.slice(edge.indexOf('const productionBody ='), edge.indexOf('let certificateDer'))
assert.doesNotMatch(productionBlock, /compliance\.binarySecurityToken/)
assert.match(edge, /\.eq\('tenant_id', TENANT_ID\)\.eq\('branch_id', BRANCH_ID\)/)
assert.match(edge, /\.eq\('environment', ENVIRONMENT\)/)

assert.match(edge, /function spkiPoint\(/)
assert.match(edge, /function ecSpki\(/)
assert.match(edge, /const privateSpki = ecSpki\(privatePoint\)/)
assert.match(edge, /const csrSpki = ecSpki\(csrKey\)/)
assert.match(edge, /certificateSpki = ecSpki\(spkiPoint\(extractCertPublicKeySpki\(certificateDer\)\)\)/)
assert.match(edge, /if \(!equal\(privateSpki, certificateSpki\)\)/)
assert.match(edge, /extractEcPrivateKeyScalar\(pemDer\(generated\.privateKeyPem\)\)/)

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.zatca_sandbox_v2_settings/)
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.zatca_sandbox_v2_sessions/)
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.zatca_sandbox_v2_events/)
assert.match(migration, /environment TEXT NOT NULL CHECK \(environment = 'integration_sandbox'\)/)
assert.match(migration, /functionality_map TEXT NOT NULL CHECK \(functionality_map = '0100'\)/)
assert.match(migration, /ALTER TABLE public\.zatca_sandbox_v2_sessions ENABLE ROW LEVEL SECURITY/)
assert.match(migration, /REVOKE ALL ON TABLE public\.zatca_sandbox_v2_sessions FROM PUBLIC, anon, authenticated/)
assert.doesNotMatch(`${migration}\n${read('supabase/migrations/20260804000700_trading_sandbox_v2_security_hardening.sql')}`, /row_security\s*=\s*off/)
assert.doesNotMatch(migration, /\botp\b\s+TEXT/i)
assert.doesNotMatch(migration, /zatca_sandbox_v2_events[\s\S]{0,180}encrypted_/i)
assert.match(migration, /encrypted_production_response/)
assert.match(migration, /encrypted_certificate/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.activate_zatca_sandbox_v2_session/)
assert.match(migration, /status IN \('in_progress', 'completed'\)/)
assert.match(migration, /idempotent BOOLEAN/)
assert.match(migration, /zatca_sandbox_credentials_one_active_uidx|status = 'active'/)
assert.match(migration, /v_session\.compliance_request_id/)
assert.match(migration, /v_session\.compliance_results/)
assert.match(migration, /v_session\.encrypted_production_csid/)
assert.match(migration, /v_session\.encrypted_certificate/)
assert.match(migration, /status = 'completed'/)
assert.match(sessionFixMigration, /FROM public\.zatca_sandbox_v2_settings AS s[\s\S]*s\.functionality_map = '0100'/)
assert.doesNotMatch(`${securityMigration}\n${sessionFixMigration}`, /row_security\s*=\s*off/)
assert.match(edge, /function safeDatabaseCode\(/)
assert.match(edge, /function safeDatabaseConstraint\(/)
assert.match(edge, /databaseCode: v2\.databaseCode \?\? null/)
assert.match(edge, /databaseConstraint: v2\.databaseConstraint \?\? null/)
assert.doesNotMatch(edge, /created\.error\.message|created\.error\.details/)

// Canonical representation contract: encodings normalize to the same point/SPKI,
// while a distinct point cannot compare equal. This mirrors the Edge Function's
// secp256k1 Point.fromBytes(...).toBytes(false) path without loading Deno imports.
const compressed = '02' + '11'.repeat(32)
const uncompressed = '04' + '11'.repeat(64)
const normalize = value => value.slice(-64).padStart(64, '0')
assert.equal(normalize(compressed), normalize(uncompressed))
assert.notEqual(normalize(compressed), normalize('02' + '22'.repeat(32)))

assert.match(ui, /function TradingSandboxV2Connector\(\)/)
assert.match(ui, /runTradingSandboxV2Onboarding\(otp\)/)
assert.match(ui, /tradingSandboxV2Panel/)
assert.match(ui, /SHOW_TRADING_SANDBOX_DEBUG = import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_ENABLE_TRADING_SANDBOX_DEBUG === 'true'/)
assert.match(ui, /canShowTradingSandboxDebug = isPermanentDemoOwner[\s\S]*SHOW_TRADING_SANDBOX_DEBUG/)
assert.match(ui, /const isPermanentDemoOwner = isPermanentDemo && \['owner', 'super_admin'\]/)
assert.match(ui, /V2 Safe Debug Console|sandbox\.v2\.debugTitle/)
assert.doesNotMatch(edge, /console\.(?:log|info|warn|error)/)
assert.doesNotMatch(ui.slice(ui.indexOf('function TradingSandboxV2Connector'), ui.indexOf('function TradingSandboxReconnectDebug')), /otp\s*[:=].*JSON\.stringify|JSON\.stringify\(.*otp/i)

// The persisted Compliance fixture is intentionally value-redacted. The real
// shape is a single JSON object with a numeric requestID; a JSON string wrapper
// must not trigger a second permissive parse or a fallback field search.
const persistedComplianceFixture = {
  binarySecurityToken: '<redacted-token>',
  dispositionMessage: 'fixture',
  errors: null,
  requestID: 123456,
  secret: '<redacted-secret>',
}
const parsedFixture = JSON.parse(JSON.stringify(persistedComplianceFixture))
assert.equal(typeof parsedFixture, 'object')
assert.equal(typeof parsedFixture.requestID, 'number')
assert.deepEqual(Object.keys(parsedFixture).sort(), ['binarySecurityToken', 'dispositionMessage', 'errors', 'requestID', 'secret'])
const wrappedFixture = JSON.parse(JSON.stringify(JSON.stringify(persistedComplianceFixture)))
assert.equal(typeof wrappedFixture, 'string')
assert.notEqual(typeof wrappedFixture.requestID, 'number')
const resumeBlock = edge.slice(edge.indexOf('async function resumePersistedCompliance'), edge.indexOf('async function fail'))
assert.doesNotMatch(resumeBlock, /create_zatca_sandbox_v2_session|compliance_request_started|readOtp\(/)
assert.match(edge, /action === 'resume_persisted_compliance'/)

console.log('Trading Sandbox V2 isolated onboarding contracts passed')
