import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260824000600_owner_account_provisioning_v2.sql', 'utf8')
const edge = readFileSync('supabase/functions/create-owner-account-v2/index.ts', 'utf8')
const clients = readFileSync('src/pages/super-admin/ClientsPage.tsx', 'utf8')

assert.match(migration, /idempotency_key text NOT NULL UNIQUE/)
assert.match(migration, /IDEMPOTENCY_CONFLICT/)
assert.match(migration, /INSERT INTO public\.tenant_subscriptions/)
assert.match(migration, /INSERT INTO public\.user_profiles/)
assert.match(migration, /INSERT INTO public\.branches/)
assert.match(migration, /fiscal_intent.*generation.*integration_setup/s)
assert.match(migration, /fiscal_activation_state/)
assert.match(migration, /first_branch_created/)
assert.match(edge, /create-owner-account-v2/)
assert.match(edge, /account_type/)
assert.match(edge, /fiscal_intent/)
assert.match(edge, /idempotency_key/)
assert.match(edge, /OWNER_ACCOUNT_CREATED_SETUP_LINK_PENDING/)
assert.match(edge, /deleteUser\(createdAuthUserId\)/)
assert.match(clients, /functions\.invoke\('create-owner-account-v2'/)
assert.match(clients, /account_type:\s+isDemo \? 'demo' : 'production'/)
assert.match(clients, /fiscal_intent:\s+fiscalRegime === 'generation' \? 'generation' : 'integration_setup'/)
assert.match(clients, /idempotency_key:/)
assert.doesNotMatch(clients, /functions\.invoke\('create-owner-account-v2'[\s\S]*fiscal_regime:/)

console.log('Owner account provisioning V2 contract tests passed (16 assertions)')
