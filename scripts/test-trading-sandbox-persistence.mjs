import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const functionSource = read('supabase/functions/zatca-onboard-sandbox-demo/index.ts')
const migration = read('supabase/migrations/20260804000300_fix_trading_sandbox_credential_persistence.sql')

assert.match(migration, /DROP INDEX IF EXISTS public\.zatca_sandbox_credentials_one_current_onboarding_uidx/)
assert.match(migration, /CREATE UNIQUE INDEX zatca_sandbox_credentials_one_current_onboarding_uidx[\s\S]*?WHERE status IN \('pending', 'compliance', 'active'\)/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_zatca_sandbox_credential/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.activate_zatca_sandbox_credential/)
assert.match(migration, /PERFORM 1 FROM public\.branches WHERE id = p_branch_id FOR UPDATE/)
assert.match(migration, /status IN \('pending', 'compliance', 'active'\)/)
assert.match(migration, /RETURN QUERY SELECT v_current\.id, true/)
assert.match(migration, /SET status = 'revoked', compliance_demo_status = 'disabled'/)
assert.match(migration, /SET status = 'active'[\s\S]*?onboarding_operation = NULL/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_zatca_sandbox_credential/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.activate_zatca_sandbox_credential/)

assert.match(functionSource, /db\.rpc\('create_zatca_sandbox_credential'/)
assert.match(functionSource, /db\.rpc\('activate_zatca_sandbox_credential'/)
assert.doesNotMatch(functionSource, /from\('zatca_sandbox_credentials'\)[\s\S]{0,160}\.insert\(/)
assert.match(functionSource, /SANDBOX_CREDENTIAL_CURRENT_CONFLICT/)
assert.match(functionSource, /zatca_sandbox_credentials_one_current_onboarding_uidx/)
assert.match(functionSource, /safeDatabaseCode/)
assert.match(functionSource, /safeDatabaseConstraint/)
assert.doesNotMatch(functionSource, /console\.(?:log|info|warn|error)[\s\S]{0,180}(?:private[_ -]?key|certificate|csid|token|otp|authorization|encrypted_)/i)

console.log('Trading Sandbox credential persistence contracts passed')
