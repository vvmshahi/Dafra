import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { setTimeout as delay } from 'node:timers/promises'

const workdir = process.env.DAFRA_OWNER_SETUP_TEST_WORKDIR
assert.match(
  workdir ?? '',
  /^\/(?:private\/)?tmp\/dafra-(?:atomic-disposable|migration-chain)\./,
  'DAFRA_OWNER_SETUP_TEST_WORKDIR must be a named disposable Supabase workdir',
)

const config = readFileSync(`${workdir}/supabase/config.toml`, 'utf8')
const projectId = config.match(/project_id = "([^"]+)"/)?.[1]
assert.match(projectId ?? '', /^dafra_(?:atomic_disposable|migration_chain)/)
assert.ok(!config.includes('bkbphkpqcxuejozayrsy'), 'Production project is forbidden')

const status = execFileSync(
  'supabase',
  ['status', '--workdir', workdir, '--output', 'env'],
  { encoding: 'utf8' },
)
const local = Object.fromEntries(
  status.split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(match => [match[1], match[2].replace(/"$/, '')]),
)
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(local.API_URL).hostname))

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options)
const anon = createClient(local.API_URL, local.ANON_KEY, options)
const password = `Owner-setup-${randomUUID()}!`
const run = randomUUID().replaceAll('-', '')

async function createUser(role, tenantId, active = true) {
  const email = `${role}-${randomUUID()}@example.test`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(created.error)
  assert.ifError((await admin.from('user_profiles').upsert({
    id: created.data.user.id,
    tenant_id: tenantId,
    role,
    email,
    is_active: active,
  })).error)
  const client = createClient(local.API_URL, local.ANON_KEY, options)
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error)
  return { client, id: created.data.user.id }
}

const tenantA = randomUUID()
const tenantB = randomUUID()
assert.ifError((await admin.from('tenants').insert([
  { id: tenantA, name: `Owner setup A ${run}`, vat_number: `3${run.slice(0, 13)}3` },
  { id: tenantB, name: `Owner setup B ${run}`, vat_number: `3${run.slice(13, 26)}3` },
])).error)

const ownerA = await createUser('owner', tenantA)
const ownerB = await createUser('owner', tenantB)
const branchA = await createUser('branch', tenantA)
const missingProfile = await createUser('owner', tenantA)
assert.ifError((await admin.from('user_profiles').delete().eq('id', missingProfile.id)).error)

const first = await ownerA.client.rpc('mark_owner_setup_complete')
assert.ifError(first.error)
assert.equal(first.data.length, 1)
assert.equal(first.data[0].tenant_id, tenantA)
assert.equal(first.data[0].owner_setup_status, 'owner_setup_complete')
assert.equal(first.data[0].already_completed, false)
const completedAt = first.data[0].owner_setup_completed_at

const repeated = await ownerA.client.rpc('mark_owner_setup_complete')
assert.ifError(repeated.error)
assert.equal(repeated.data.length, 1)
assert.equal(repeated.data[0].already_completed, true)
assert.equal(repeated.data[0].owner_setup_completed_at, completedAt)

const otherTenant = await ownerB.client.rpc('mark_owner_setup_complete')
assert.ifError(otherTenant.error)
assert.equal(otherTenant.data[0].tenant_id, tenantB)
const tenantAAfterOther = await admin.from('tenant_onboarding_status')
  .select('tenant_id, owner_setup_completed_at').eq('tenant_id', tenantA).single()
assert.ifError(tenantAAfterOther.error)
assert.equal(tenantAAfterOther.data.owner_setup_completed_at, completedAt)

const branchAttempt = await branchA.client.rpc('mark_owner_setup_complete')
assert.equal(branchAttempt.error?.code, '42501')

const anonymousAttempt = await anon.rpc('mark_owner_setup_complete')
assert.ok(anonymousAttempt.error)

let rows
for (let attempt = 0; attempt < 5; attempt += 1) {
  rows = await admin.from('tenant_onboarding_status')
    .select('tenant_id, owner_setup_completed_at').in('tenant_id', [tenantA, tenantB])
  if (!['PGRST000', 'PGRST002'].includes(rows.error?.code)) break
  await delay(500)
}
assert.ifError(rows.error)
assert.equal(rows.data.length, 2)
assert.equal(
  rows.data.find(row => row.tenant_id === tenantA)?.owner_setup_completed_at,
  completedAt,
)

const invalidProfileAttempt = await missingProfile.client.rpc('mark_owner_setup_complete')
assert.ok(invalidProfileAttempt.error)

console.log('owner setup completion disposable runtime: PASS')
