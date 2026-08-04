import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260728000000_phase1_onboarding_provisioning.sql', 'utf8')
const owner = readFileSync('supabase/functions/create-owner-account/index.ts', 'utf8')
const branch = readFileSync('supabase/functions/provision-first-branch/index.ts', 'utf8')
const setup = readFileSync('src/pages/onboarding/SetupBranchPage.tsx', 'utf8')
const auth = readFileSync('src/hooks/useAuth.ts', 'utf8')
const faults = readFileSync('supabase/functions/_shared/test-faults.ts', 'utf8')

for (const fragment of [
  'branches_one_main_per_tenant_uidx',
  'tenant_subscriptions_one_live_per_tenant_uidx',
  'pg_advisory_xact_lock',
  'owner_provisioning_plan_allowlist',
  'REVOKE ALL ON FUNCTION public.complete_owner_provisioning_core',
  'GRANT EXECUTE ON FUNCTION public.complete_owner_provisioning_core',
]) assert.ok(migration.includes(fragment), fragment)
assert.match(migration, /FROM PUBLIC, anon, authenticated/)
assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.complete_owner_provisioning_core[^;]+authenticated/)
assert.ok(owner.includes('owner_provisioning_id'))
assert.ok(owner.includes('CORE_COMPLETE_SETUP_LINK_FAILED'))
assert.ok(owner.includes('CONFLICT_EXISTING_UNRELATED_USER'))
assert.ok(owner.includes("vat_number: body.vat_number?.trim() || null"))
assert.ok(owner.includes("vat_number: safePayload.vat_number ?? ''"))
assert.ok(owner.includes('normalizeLegacyBlankVat'))
assert.ok(owner.includes("payload.vat_number !== ''"))
assert.ok(owner.includes("vat_number: null"))
assert.ok(owner.includes("step: 'core', code: 'CORE_DATABASE_FAILED'"))
assert.ok(branch.includes('first_branch_provisioning_id'))
assert.ok(branch.includes('RESUMABLE_LOGIN_CONFLICT'))
assert.ok(branch.includes('CORE_BRANCH_READY_ACCESS_FAILED'))
assert.ok(setup.includes("invoke('provision-first-branch'"))
assert.ok(!setup.includes("rpc('create_branch_for_tenant'"))
assert.ok(!setup.includes("invoke('create-branch-user'"))
assert.ok(auth.includes('PROFILE_RETRY_DELAYS_MS'))
assert.ok(auth.includes('get_first_branch_provisioning_status'))
assert.match(migration, /CASE WHEN r\.state = 'complete' THEN r\.state ELSE p_state END/)
assert.ok(owner.includes('racedUser?.user_metadata?.owner_provisioning_id'))
assert.ok(branch.includes('racedUser?.user_metadata?.first_branch_provisioning_id'))
assert.ok(faults.includes("Deno.env.get('DAFRA_TEST_FAULT_SECRET')"))
assert.ok(faults.includes('configured.length < 24'))
assert.ok(owner.includes("disposableFault(req, 'owner_setup_link')"))
assert.ok(branch.includes("disposableFault(req, 'branch_auth_create')"))
for (const source of [migration, owner, branch]) {
  assert.doesNotMatch(source, /password\s*[:=].*console|console\.[a-z]+\([^)]*setupLink/i)
}
console.log('phase1 provisioning security contract: PASS')
