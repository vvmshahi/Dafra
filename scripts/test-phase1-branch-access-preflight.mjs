import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const preflight = readFileSync(
  'supabase/phase1-provisioning-readonly-checks.sql',
  'utf8',
)
const migration = readFileSync(
  'supabase/migrations/20260728000000_phase1_onboarding_provisioning.sql',
  'utf8',
)

const classify = ({
  username = false,
  email = false,
  auth = true,
  tenant = true,
  branch = true,
  active = true,
  unrelatedEmail = false,
}) => {
  const validIdentity = auth && tenant && branch && active
  const usernameAccess = username && validIdentity
  const emailAccess = email && validIdentity && !unrelatedEmail
  return {
    usernameAccess,
    emailAccess,
    complete: usernameAccess || emailAccess,
    both: usernameAccess && emailAccess,
  }
}

assert.deepEqual(classify({ username: true }), {
  usernameAccess: true, emailAccess: false, complete: true, both: false,
})
assert.deepEqual(classify({ email: true }), {
  usernameAccess: false, emailAccess: true, complete: true, both: false,
})
assert.deepEqual(classify({ username: true, email: true }), {
  usernameAccess: true, emailAccess: true, complete: true, both: true,
})
assert.equal(classify({ email: true, auth: false }).complete, false)
assert.equal(classify({ email: true, tenant: false }).complete, false)
assert.equal(classify({ email: true, branch: false }).complete, false)
assert.equal(classify({ email: true, active: false }).complete, false)
assert.equal(classify({}).complete, false)
assert.equal(classify({ email: true, unrelatedEmail: true }).complete, false)

assert.match(preflight, /branches_without_usable_access/)
assert.match(preflight, /valid_username_login_branches/)
assert.match(preflight, /valid_email_login_branches/)
assert.match(preflight, /branches_supporting_both/)
assert.match(preflight, /ambiguous_or_mismatched_branch_access/)
assert.match(preflight, /lower\(u\.email\) = lower\(m\.internal_auth_email\)/)
assert.match(preflight, /p\.tenant_id = b\.tenant_id/)
assert.match(preflight, /p\.branch_id = b\.id/)
assert.match(preflight, /p\.is_active IS TRUE/)

// The compatibility allowance is preflight-only. A newly provisioned first
// branch must still finish by inserting and verifying its username mapping.
assert.match(migration, /INSERT INTO public\.branch_login_usernames/)
assert.match(
  migration,
  /SELECT 1 FROM public\.branch_login_usernames WHERE user_id = p_auth_user_id/,
)
assert.match(
  migration,
  /UPDATE public\.first_branch_provisioning_requests SET[\s\S]*state = 'complete'/,
)

console.log('phase1 branch access preflight contract: PASS')
