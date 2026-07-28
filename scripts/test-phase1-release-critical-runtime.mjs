import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const workdir = process.env.DAFRA_ONBOARDING_TEST_WORKDIR
assert.ok(workdir?.match(/^\/(?:private\/)?tmp\/dafra-(?:atomic-disposable|migration-chain)\./))
const config = readFileSync(`${workdir}/supabase/config.toml`, 'utf8')
const projectId = config.match(/project_id = "([^"]+)"/)?.[1]
assert.ok(projectId)
const status = execFileSync('supabase', ['status', '--workdir', workdir, '--output', 'env'], { encoding: 'utf8' })
const local = Object.fromEntries(status.split(/\r?\n/).map((line) =>
  line.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((match) =>
  [match[1], match[2].replace(/"$/, '')]))
const url = local.API_URL
const anon = local.ANON_KEY
const service = local.SERVICE_ROLE_KEY
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
const faultSecret = process.env.DAFRA_TEST_FAULT_SECRET
assert.ok(faultSecret?.length >= 24)
const admin = createClient(url, service, { auth: { persistSession: false } })
const client = createClient(url, anon, { auth: { persistSession: false } })
const runId = `rc${Date.now()}`
const ownerPassword = 'DisposableOwner!123'
const branchPassword = 'DisposableBranch!123'

function sql(statement) {
  return execFileSync('docker', [
    'exec', `supabase_db_${projectId}`,
    'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-Atc', statement,
  ], { encoding: 'utf8' }).trim()
}

async function ensureAdmin() {
  const email = `${runId}.admin@test.invalid`
  const password = 'DisposableAdmin!123'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(created.error)
  assert.ifError((await admin.from('user_profiles').upsert({
    id: created.data.user.id, role: 'super_admin', is_active: true, email,
  }, { onConflict: 'id' })).error)
  const login = await client.auth.signInWithPassword({ email, password })
  assert.ifError(login.error)
  return login.data.session.access_token
}

async function ensurePlan() {
  const inserted = await admin.from('subscription_plans').insert({
    name: `${runId} eligible`, max_branches: 2, is_active: true,
  }).select('id').single()
  assert.ifError(inserted.error)
  assert.ifError((await admin.from('owner_provisioning_plan_allowlist')
    .insert({ plan_id: inserted.data.id })).error)
  return inserted.data.id
}

async function edge(name, token, body, fault, signal) {
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json',
      ...(fault ? {
        'x-dafra-test-fault': fault,
        'x-dafra-test-fault-secret': faultSecret,
      } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
  return { status: response.status, body: await response.json() }
}

async function provisionOwner(token, planId, suffix, fault, company = `${runId} ${suffix}`, signal) {
  const vatSeed = [...`${runId}:${suffix}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 10_000_000_000_000, 0)
  return edge('create-owner-account', token, {
    company_name: company,
    vat_number: `3${String(vatSeed).padStart(13, '0')}3`,
    email: `${runId}.${suffix}@test.invalid`,
    plan_id: planId,
    duration_months: 0,
  }, fault, signal)
}

async function ownerState(suffix) {
  const result = await admin.from('owner_provisioning_requests').select('*')
    .eq('normalized_email', `${runId}.${suffix}@test.invalid`).single()
  assert.ifError(result.error)
  return result.data
}

async function loginOwner(state, suffix) {
  assert.ifError((await admin.auth.admin.updateUserById(state.auth_user_id, { password: ownerPassword })).error)
  const login = await createClient(url, anon, { auth: { persistSession: false } }).auth
    .signInWithPassword({ email: `${runId}.${suffix}@test.invalid`, password: ownerPassword })
  assert.ifError(login.error)
  return login.data.session.access_token
}

function branchBody(suffix) {
  return {
    name: `${runId} Main ${suffix}`, vat_number: '310000000000083', cr_number: '12345',
    building_number: '1234', postal_code: '12345', street: 'Runtime',
    district: 'Runtime', city: 'Riyadh', username: `${runId}-${suffix}`.toLowerCase(),
    password: branchPassword, zatca_phase: 1,
  }
}

async function assertOwnerCounts(state) {
  const counts = {
    tenant: Number(sql(`select count(*) from public.tenants where id='${state.tenant_id}'`)),
    subscription: Number(sql(`select count(*) from public.tenant_subscriptions where tenant_id='${state.tenant_id}' and status in ('trial','active') and cancelled_at is null`)),
    profile: Number(sql(`select count(*) from public.user_profiles where id='${state.auth_user_id}' and tenant_id='${state.tenant_id}' and role='owner'`)),
    request: Number(sql(`select count(*) from public.owner_provisioning_requests where normalized_email='${state.normalized_email}'`)),
  }
  assert.deepEqual(counts, { tenant: 1, subscription: 1, profile: 1, request: 1 })
  return counts
}

const token = await ensureAdmin()
const planId = await ensurePlan()
const results = {}

// Setup-link failure occurs after the database core and must recover with stable IDs.
const linkFailure = await provisionOwner(token, planId, 'linkfail', 'owner_setup_link')
assert.equal(linkFailure.status, 503)
assert.equal(linkFailure.body.code, 'CORE_COMPLETE_SETUP_LINK_FAILED')
const linkPartial = await ownerState('linkfail')
assert.equal(linkPartial.state, 'failed_recoverable')
assert.ok(linkPartial.tenant_id && linkPartial.subscription_id && linkPartial.auth_user_id)
const linkRetry = await provisionOwner(token, planId, 'linkfail')
assert.equal(linkRetry.status, 200)
assert.ok(['RESUMED_AND_COMPLETE', 'COMPLETE_SETUP_LINK_REGENERATED'].includes(linkRetry.body.code))
const linkComplete = await ownerState('linkfail')
assert.equal(linkComplete.state, 'complete')
assert.deepEqual(
  [linkComplete.auth_user_id, linkComplete.tenant_id, linkComplete.subscription_id],
  [linkPartial.auth_user_id, linkPartial.tenant_id, linkPartial.subscription_id],
)
results.ownerSetupLink = await assertOwnerCounts(linkComplete)

// Force the transactional subscription insert to fail, then prove rollback and retry.
sql(`create or replace function public.phase1_test_fail_subscription() returns trigger language plpgsql as $$begin if new.tenant_id in (select id from public.tenants where email='${runId}.corefail@test.invalid') then raise exception 'DISPOSABLE_CORE_FAILURE'; end if; return new; end$$; create trigger phase1_test_fail_subscription before insert on public.tenant_subscriptions for each row execute function public.phase1_test_fail_subscription()`)
const coreFailure = await provisionOwner(token, planId, 'corefail')
assert.equal(coreFailure.status, 503)
assert.equal(coreFailure.body.code, 'FAILED_RECOVERABLE')
const corePartial = await ownerState('corefail')
assert.equal(corePartial.state, 'failed_recoverable')
assert.equal(Number(sql(`select count(*) from public.tenants where email='${runId}.corefail@test.invalid'`)), 0)
assert.equal(Number(sql(`select count(*) from public.user_profiles where id='${corePartial.auth_user_id}' and tenant_id is not null`)), 0)
sql('drop trigger phase1_test_fail_subscription on public.tenant_subscriptions; drop function public.phase1_test_fail_subscription()')
const coreRetry = await provisionOwner(token, planId, 'corefail')
assert.equal(coreRetry.status, 200)
const coreComplete = await ownerState('corefail')
assert.equal(coreComplete.state, 'complete')
results.ownerCoreRetry = await assertOwnerCounts(coreComplete)

// Six-way owner concurrency after the monotonic-state/race correction.
const ownerConcurrent = await Promise.all(Array.from({ length: 6 }, () =>
  provisionOwner(token, planId, 'concurrent')))
assert.ok(ownerConcurrent.some((r) => r.status === 200))
const ownerConverged = await provisionOwner(token, planId, 'concurrent')
assert.equal(ownerConverged.status, 200)
const concurrentState = await ownerState('concurrent')
assert.equal(concurrentState.state, 'complete')
results.ownerConcurrency = {
  responses: ownerConcurrent.map((r) => `${r.status}:${r.body.code}`),
  counts: await assertOwnerCounts(concurrentState),
}

// Client abort after durable completion; replay reconciles to the stable account.
const abortOwner = new AbortController()
setTimeout(() => abortOwner.abort(), 100)
let ownerTimedOut = false
try {
  await provisionOwner(token, planId, 'timeout', 'owner_response_after_complete',
    `${runId} timeout`, abortOwner.signal)
} catch (error) {
  ownerTimedOut = error?.name === 'AbortError'
}
assert.equal(ownerTimedOut, true)
await new Promise((resolve) => setTimeout(resolve, 900))
const timeoutState = await ownerState('timeout')
assert.equal(timeoutState.state, 'complete')
const timeoutReplay = await provisionOwner(token, planId, 'timeout')
assert.equal(timeoutReplay.status, 200)
assert.equal(timeoutReplay.body.tenant_id, timeoutState.tenant_id)
results.ownerTimeout = await assertOwnerCounts(timeoutState)

// Branch Auth failure after one Main branch, followed by same-branch recovery.
const branchOwner = await ownerState('corefail')
const branchToken = await loginOwner(branchOwner, 'corefail')
const authFailBody = branchBody('authfail')
const authFailure = await edge('provision-first-branch', branchToken, authFailBody, 'branch_auth_create')
assert.equal(authFailure.status, 503)
assert.equal(authFailure.body.code, 'CORE_BRANCH_READY_ACCESS_FAILED')
assert.equal(Number(sql(`select count(*) from public.branches where tenant_id='${branchOwner.tenant_id}' and is_main_branch`)), 1)
assert.equal(Number(sql(`select count(*) from public.branch_login_usernames where branch_id='${authFailure.body.branch_id}'`)), 0)
const authRetry = await edge('provision-first-branch', branchToken, authFailBody)
assert.equal(authRetry.status, 200)
assert.equal(authRetry.body.branch_id, authFailure.body.branch_id)

// Mapping trigger failure leaves Auth but rolls profile/mapping back; retry resumes it.
const mappingOwnerResult = await provisionOwner(token, planId, 'mappingowner')
assert.equal(mappingOwnerResult.status, 200)
const mappingOwner = await ownerState('mappingowner')
const mappingToken = await loginOwner(mappingOwner, 'mappingowner')
const mappingBody = branchBody('mappingfail')
sql(`create or replace function public.phase1_test_fail_mapping() returns trigger language plpgsql as $$begin if new.normalized_username='${mappingBody.username}' then raise exception 'DISPOSABLE_MAPPING_FAILURE'; end if; return new; end$$; create trigger phase1_test_fail_mapping before insert on public.branch_login_usernames for each row execute function public.phase1_test_fail_mapping()`)
const mappingFailure = await edge('provision-first-branch', mappingToken, mappingBody)
assert.equal(mappingFailure.status, 409)
assert.equal(mappingFailure.body.code, 'MANUAL_REVIEW_REQUIRED')
const mappingRequest = (await admin.from('first_branch_provisioning_requests').select('*')
  .eq('tenant_id', mappingOwner.tenant_id).single()).data
assert.ok(mappingRequest.branch_id)
assert.equal(Number(sql(`select count(*) from public.user_profiles where branch_id='${mappingRequest.branch_id}' and role='branch'`)), 0)
assert.equal(Number(sql(`select count(*) from public.branch_login_usernames where branch_id='${mappingRequest.branch_id}'`)), 0)
sql('drop trigger phase1_test_fail_mapping on public.branch_login_usernames; drop function public.phase1_test_fail_mapping()')
const mappingRetry = await edge('provision-first-branch', mappingToken, mappingBody)
assert.equal(mappingRetry.status, 200)
assert.equal(mappingRetry.body.branch_id, mappingRequest.branch_id)
const mappingFinal = (await admin.from('first_branch_provisioning_requests').select('*')
  .eq('tenant_id', mappingOwner.tenant_id).single()).data
assert.equal(mappingFinal.state, 'complete')
assert.equal(Number(sql(`select count(*) from public.branches where tenant_id='${mappingOwner.tenant_id}' and is_main_branch`)), 1)
assert.equal(Number(sql(`select count(*) from public.user_profiles where branch_id='${mappingFinal.branch_id}' and role='branch'`)), 1)
assert.equal(Number(sql(`select count(*) from public.branch_login_usernames where branch_id='${mappingFinal.branch_id}'`)), 1)

// Four-way first-branch concurrency and timeout reconciliation on fresh owners.
const concurrentBranchOwnerResult = await provisionOwner(token, planId, 'branchconcurrent')
assert.equal(concurrentBranchOwnerResult.status, 200)
const concurrentBranchOwner = await ownerState('branchconcurrent')
const concurrentBranchToken = await loginOwner(concurrentBranchOwner, 'branchconcurrent')
const concurrentBody = branchBody('concurrent')
const branchConcurrent = await Promise.all(Array.from({ length: 4 }, () =>
  edge('provision-first-branch', concurrentBranchToken, concurrentBody)))
const branchConverged = await edge('provision-first-branch', concurrentBranchToken, concurrentBody)
assert.equal(branchConverged.status, 200)
const branchState = (await admin.from('first_branch_provisioning_requests').select('*')
  .eq('tenant_id', concurrentBranchOwner.tenant_id).single()).data
assert.equal(branchState.state, 'complete')
assert.equal(Number(sql(`select count(*) from public.branches where tenant_id='${concurrentBranchOwner.tenant_id}' and is_main_branch`)), 1)
assert.equal(Number(sql(`select count(*) from public.user_profiles where id='${branchState.auth_user_id}' and branch_id='${branchState.branch_id}'`)), 1)
assert.equal(Number(sql(`select count(*) from public.branch_login_usernames where branch_id='${branchState.branch_id}'`)), 1)
results.branchConcurrency = branchConcurrent.map((r) => `${r.status}:${r.body.code}`)

const timeoutBranchOwnerResult = await provisionOwner(token, planId, 'branchtimeout')
assert.equal(timeoutBranchOwnerResult.status, 200)
const timeoutBranchOwner = await ownerState('branchtimeout')
const timeoutBranchToken = await loginOwner(timeoutBranchOwner, 'branchtimeout')
const timeoutBranchBody = branchBody('timeout')
const abortBranch = new AbortController()
setTimeout(() => abortBranch.abort(), 100)
let branchTimedOut = false
try {
  await edge('provision-first-branch', timeoutBranchToken, timeoutBranchBody,
    'branch_response_after_complete', abortBranch.signal)
} catch (error) {
  branchTimedOut = error?.name === 'AbortError'
}
assert.equal(branchTimedOut, true)
await new Promise((resolve) => setTimeout(resolve, 900))
const authoritativeBranch = (await admin.rpc('get_first_branch_provisioning_status', {}, {
  headers: { authorization: `Bearer ${timeoutBranchToken}` },
})).data
// Supabase client service-role RPC cannot substitute auth.uid; verify with user client.
const timeoutUserClient = createClient(url, anon, {
  global: { headers: { authorization: `Bearer ${timeoutBranchToken}` } },
  auth: { persistSession: false },
})
const statusResult = await timeoutUserClient.rpc('get_first_branch_provisioning_status')
assert.ifError(statusResult.error)
assert.equal(statusResult.data[0].access_complete, true)
const timeoutBranchReplay = await edge('provision-first-branch', timeoutBranchToken, timeoutBranchBody)
assert.equal(timeoutBranchReplay.status, 200)
assert.equal(timeoutBranchReplay.body.branch_id, statusResult.data[0].branch_id)
results.branchTimeout = statusResult.data[0]
void authoritativeBranch

console.log(JSON.stringify({ runId, ...results }, null, 2))
console.log('phase1 release-critical disposable runtime: PASS')
