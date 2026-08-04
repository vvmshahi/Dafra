import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const migration = read('supabase/migrations/20260804000500_reset_trading_sandbox_onboarding.sql')
const edge = read('supabase/functions/zatca-onboard-sandbox-demo/index.ts')
const api = read('src/lib/zatca/api.ts')
const ui = read('src/pages/settings/ZatcaTab.tsx')
const debugUi = ui.slice(ui.indexOf('function TradingSandboxReconnectDebug'), ui.indexOf('/* ── Production onboarding orchestrator'))

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reset_zatca_sandbox_onboarding/)
assert.match(migration, /ebf1144b-55ed-472a-99c9-23b5ee915351/)
assert.match(migration, /14271653-b404-44bf-9f39-7e9927569c02/)
assert.match(migration, /status IN \('pending', 'compliance', 'active'\)/)
assert.match(migration, /status = 'revoked'/)
assert.match(migration, /abandoned_by_owner_reset/)
assert.match(migration, /owner_requested_clean_sandbox_restart/)
assert.match(migration, /Active Trading Sandbox credential cannot be reset/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.reset_zatca_sandbox_onboarding/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.reset_zatca_sandbox_onboarding[\s\S]*TO service_role/)

assert.match(edge, /'reset_sandbox_onboarding'/)
assert.match(edge, /body\.confirmation !== 'RESET SANDBOX'/)
assert.match(edge, /db\.rpc\('reset_zatca_sandbox_onboarding'/)
assert.match(edge, /SANDBOX_RESET_ACTIVE_CREDENTIAL/)
assert.doesNotMatch(edge, /SANDBOX_CORE_BASE_URL[\s\S]{0,500}resetSandboxOnboarding/)

assert.match(api, /resetSandboxDemoOnboarding/)
assert.match(api, /confirmation: 'RESET SANDBOX'/)
const resetApi = api.slice(api.indexOf('export async function resetSandboxDemoOnboarding'), api.indexOf('export async function activateSandboxDemoConnection'))
assert.doesNotMatch(resetApi, /tenantId|branchId|environment|credentialId/)

for (const stage of [
  'reset_started', 'previous_state_archived', 'reset_completed', 'otp_ready',
  'submit_started', 'caller_authorized', 'trading_scope_resolved',
  'fresh_identity_started', 'private_key_generated', 'csr_generated',
  'csr_key_match_verified', 'credential_draft_saved',
  'compliance_csid_request_started', 'compliance_csid_response_received',
  'compliance_validation_started', 'compliance_validation_completed',
  'production_csid_request_started', 'production_csid_response_received',
  'certificate_key_match_verified', 'credential_activation_started',
  'credential_activation_completed', 'trading_mode_updated',
  'onboarding_completed', 'onboarding_failed',
]) assert.match(debugUi, new RegExp(`'${stage}'`))

assert.match(debugUi, /Copy Safe Debug Log|debugCopy/)
assert.match(debugUi, /setEvents\(\[\]\)/)
assert.doesNotMatch(debugUi, /localStorage|sessionStorage/)
assert.doesNotMatch(debugUi, /console\.(?:log|info|warn|error)/)
assert.doesNotMatch(debugUi, /otp:\s*otp|otpValue|privateKey|certificateBody|csidSecret|accessToken|refreshToken/)
assert.match(debugUi, /autoComplete="off"/)
assert.match(debugUi, /replace\(\/\\D\/g, ''\)/)

console.log('Trading Sandbox reset and debug contracts passed')
