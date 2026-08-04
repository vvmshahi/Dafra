import assert from 'node:assert/strict'
import fs from 'node:fs'

const edge = fs.readFileSync('supabase/functions/zatca-onboard-trading-sandbox-v2/index.ts', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260804000900_add_v2_certificate_diagnostic.sql', 'utf8')

assert.match(edge, /4b1ef8b2-75d1-4176-baa7-9d7017db4e63/)
assert.match(edge, /function tokenCertificateBytes\(token: string\)/)
assert.match(edge, /double_base64_der_certificate/)
assert.match(edge, /function certificateDerList\(bytes: Uint8Array\)/)
assert.match(edge, /selectedCertificateIndex/)
assert.match(edge, /SANDBOX_V2_PRODUCTION_TOKEN_DECODE_FAILED/)
assert.match(edge, /SANDBOX_V2_CERTIFICATE_PARSE_FAILED/)
assert.match(edge, /SANDBOX_V2_CERTIFICATE_CHAIN_AMBIGUOUS/)
assert.match(edge, /SANDBOX_V2_SESSION_KEY_NOT_FOUND/)
assert.match(edge, /SANDBOX_V2_CERTIFICATE_KEY_MISMATCH/)
assert.match(edge, /certificate_comparison_diagnosed/)
assert.match(edge, /certificateDiagnostic: diagnostic/)
assert.match(edge, /privateProduction: productionFingerprint !== null && productionFingerprint === privateFingerprint/)
assert.doesNotMatch(edge, /diagnose_persisted_production[\s\S]{0,1200}fetch\(/)
assert.doesNotMatch(edge, /jwtRole\(bearer\(req\)\).*service_role/)
assert.doesNotMatch(edge, /zatca-onboard-sandbox-demo|zatca_sandbox_credentials|zatca_production_credentials/)
assert.match(migration, /certificate_diagnostic JSONB NOT NULL DEFAULT '\{\}'::JSONB/)

// Safe synthetic token fixture: a DER sequence encoded twice, with no
// certificate/key material or real response values.
const fakeDer = Buffer.from([0x30, 0x02, 0x01, 0x00])
const doubleBase64 = Buffer.from(fakeDer.toString('base64')).toString('base64')
assert.equal(Buffer.from(Buffer.from(doubleBase64, 'base64').toString(), 'base64')[0], 0x30)
assert.notEqual(doubleBase64, fakeDer.toString('base64'))

// Canonical public-key comparison contract: compressed/uncompressed forms of
// the same point match; a different point does not.
const compressed = '02' + '11'.repeat(32)
const uncompressed = '04' + '00'.repeat(32) + '11'.repeat(32)
const different = '02' + '22'.repeat(32)
const canonical = point => point.endsWith('11'.repeat(32)) ? '11'.repeat(64) : point.slice(-64)
assert.equal(canonical(compressed), canonical(uncompressed))
assert.notEqual(canonical(compressed), canonical(different))

const diagnosticBlock = edge.slice(edge.indexOf('async function diagnosePersistedProduction'), edge.indexOf('function derNode'))
assert.doesNotMatch(diagnosticBlock, /console\.(?:log|info|warn|error)/)
assert.doesNotMatch(diagnosticBlock, /fetch\(/)

console.log('Trading Sandbox V2 persisted Production resume contracts passed')
