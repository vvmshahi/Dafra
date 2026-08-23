import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const onboarding = read('supabase/functions/zatca-onboard-sandbox-demo/index.ts')
const resolver = read('supabase/functions/resolve-zatca-connection/index.ts')
const api = read('src/lib/zatca/api.ts')
const submission = read('src/lib/zatca/submission.ts')
const settings = read('src/pages/settings/ZatcaTab.tsx')
const ownerCard = read('src/components/zatca/SandboxBranchOnboardingPanel.tsx')

for (const source of [api, submission, settings, ownerCard]) {
  assert.doesNotMatch(source, /zatca-onboard-trading-sandbox-v2/)
  assert.doesNotMatch(source, /PERMANENT_DEMO_(TENANT|TRADING|SERVICE)_BRANCH_ID/)
  assert.doesNotMatch(source, /14271653-b404-44bf-9f39-7e9927569c02/)
  assert.doesNotMatch(source, /f512b805-b0ef-494d-b696-139e31a9fabb/)
}

assert.match(onboarding, /action === 'generate_csr' && body\.functionalityMap !== '1100'/)
assert.match(onboarding, /Canonical Sandbox onboarding requires functionality map 1100/)
assert.match(ownerCard, /functionalityMap: '1100'/)
assert.doesNotMatch(onboarding, /1234567890123/)
assert.doesNotMatch(api, /zatca-validate-sandbox-demo/)
assert.match(onboarding, /compliance_request_id: response\.requestID/)
assert.match(onboarding, /complianceRequestId: credential\.compliance_request_id/)

for (const source of [settings, ownerCard]) {
  assert.doesNotMatch(source, /123345/)
  assert.match(source, /6-digit OTP/)
}

assert.match(onboarding, /SANDBOX_PRODUCTION_CSID_TIMEOUT_MS/)
assert.match(onboarding, /AbortSignal\.timeout\(SANDBOX_PRODUCTION_CSID_TIMEOUT_MS\)/)
assert.match(onboarding, /SandboxProductionCsidTimeoutError/)
assert.match(onboarding, /outcome: 'unknown'/)
assert.match(onboarding, /persistSandboxProductionDispatchEvidence/)
assert.match(onboarding, /complianceRequestIdFingerprint/)
assert.match(onboarding, /returnedCredentialPresent/)
assert.match(onboarding, /certificateFingerprint/)
assert.match(onboarding, /certificateSpkiFingerprint/)
assert.match(onboarding, /operationalCredentialClassification/)
assert.match(onboarding, /signingCredential: 'compliance_certificate'/)
assert.match(onboarding, /certificateVat/)
assert.match(onboarding, /final XML\s+\/\/ signing remains on the generated private key plus Compliance certificate/)

for (const field of [
  'privateKeySpkiFingerprint',
  'csrSpkiFingerprint',
  'complianceCertificateSpkiFingerprint',
  'complianceCertificateVat',
  'operationalCertificateSpkiFingerprint',
  'operationalCertificateVat',
  'complianceRequestIdFingerprint',
]) assert.match(onboarding, new RegExp(field))

assert.match(resolver, /submission_verification/)
assert.match(resolver, /submission_verified/)
assert.match(resolver, /zatca_sandbox_submission_reservations/)
assert.match(ownerCard, /Sandbox onboarding connected — submission not yet verified/)
assert.match(settings, /Connected confirms onboarding readiness only/)

console.log('Sandbox safe-hardening assertions passed.')
