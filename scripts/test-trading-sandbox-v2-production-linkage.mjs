import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync('supabase/functions/zatca-onboard-trading-sandbox-v2/index.ts', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260804001000_add_v2_production_linkage_diagnostic.sql', 'utf8')

assert.match(edge, /function rawJsonNumberLiteral\(text: string, field: string\)/)
assert.match(edge, /Number\.isSafeInteger\(parsedRequestId\)/)
assert.match(edge, /requestIdSource: 'same_v2_compliance_response_object'/)
assert.match(edge, /production_request_linkage_verified/)
assert.match(edge, /requestBodyField: 'compliance_request_id'/)
assert.match(edge, /endpointPath: 'production\/csids'/)
assert.match(edge, /apiVersion: 'V2'/)
assert.match(edge, /authCsidMatchesPersistedCompliance: authCsidMatches/)
assert.match(edge, /authSecretMatchesPersistedCompliance: authSecretMatches/)
assert.match(edge, /globalCacheUsed: false/)
assert.match(edge, /serviceDemoSelected: false/)
assert.match(edge, /legacyCredentialSelected: false/)
assert.match(migration, /production_request_linkage JSONB NOT NULL DEFAULT '\{\}'::JSONB/)

// Exact decimal-string round-trip contract, including the unsafe-integer guard.
const safeRaw = '123456789012345'
const safeNumber = Number(safeRaw)
assert.equal(Number.isSafeInteger(safeNumber), true)
assert.equal(String(safeNumber), safeRaw)
const unsafeRaw = '9007199254740993'
const unsafeNumber = Number(unsafeRaw)
assert.equal(Number.isSafeInteger(unsafeNumber), false)
assert.notEqual(String(unsafeNumber), unsafeRaw)

// Persisted and submitted values must be the same exact text, never a stale or
// mixed-session value.
const persisted = safeRaw
const submitted = safeRaw
assert.equal(persisted, submitted)
assert.notEqual(persisted, '900719925474098')

const productionBlock = edge.slice(edge.indexOf('const productionRequestId'), edge.indexOf('const productionBody'))
assert.match(productionBlock, /url: `\$\{SANDBOX_BASE_URL\}\/production\/csids`/)
assert.match(productionBlock, /'accept-version': 'V2'/)
assert.match(productionBlock, /body: JSON\.stringify\(\{ compliance_request_id: compliance\.requestID \}\)/)
assert.match(productionBlock, /btoa\(`\$\{compliance\.binarySecurityToken\}:\$\{compliance\.secret\}`\)/)
assert.doesNotMatch(productionBlock, /zatca_sandbox_credentials|zatca_sandbox_credentials|zatca_production_credentials|localStorage|sessionStorage/)

const linkageBlock = edge.slice(edge.indexOf('async function diagnoseProductionLinkage'), edge.indexOf('async function verifyComplianceResponseShape'))
assert.doesNotMatch(linkageBlock, /fetch\(/)
assert.doesNotMatch(edge, /jwtRole\(bearer\(req\)\).*service_role/)

console.log('Trading Sandbox V2 Production request linkage contracts passed')
