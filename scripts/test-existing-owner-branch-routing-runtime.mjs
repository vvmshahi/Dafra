import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const workdir = process.env.DAFRA_OWNER_ROUTING_TEST_WORKDIR
assert.match(workdir ?? '', /^\/(?:private\/)?tmp\/dafra-(?:atomic-disposable|migration-chain)\./)
const config = readFileSync(`${workdir}/supabase/config.toml`, 'utf8')
assert.ok(!config.includes('bkbphkpqcxuejozayrsy'))
const status = execFileSync('supabase', ['status', '--workdir', workdir, '--output', 'env'], { encoding: 'utf8' })
const env = Object.fromEntries(status.split(/\r?\n/).map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/))
  .filter(Boolean).map(match => [match[1], match[2].replace(/"$/, '')]))
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(env.API_URL).hostname))
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, options)
const password = `Routing-${randomUUID()}!`

async function user(email, profile) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  assert.ifError(created.error)
  assert.ifError((await admin.from('user_profiles').upsert({ id: created.data.user.id, email, ...profile })).error)
  const client = createClient(env.API_URL, env.ANON_KEY, options)
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error)
  return { id: created.data.user.id, client }
}

async function tenantAndOwner(label) {
  const tenantId = randomUUID()
  assert.ifError((await admin.from('tenants').insert({
    id: tenantId, name: label, vat_number: `3${randomUUID().replaceAll('-', '').slice(0, 13)}3`,
  })).error)
  const owner = await user(`owner-${randomUUID()}@example.test`, {
    tenant_id: tenantId, role: 'owner', is_active: true,
  })
  return { tenantId, owner }
}

const emailCase = await tenantAndOwner('Email access routing')
let result = await emailCase.owner.client.rpc('get_first_branch_provisioning_status')
assert.ifError(result.error)
assert.equal(result.data[0].state, 'requested')
assert.equal(result.data[0].access_complete, false)

const emailBranch = randomUUID()
assert.ifError((await admin.from('branches').insert({
  id: emailBranch, tenant_id: emailCase.tenantId, name: 'Existing email branch',
  is_main_branch: true, is_active: false,
})).error)
result = await emailCase.owner.client.rpc('get_first_branch_provisioning_status')
assert.ifError(result.error)
assert.equal(result.data[0].access_complete, false)

const emailUser = await user(`branch-${randomUUID()}@example.test`, {
  tenant_id: emailCase.tenantId, branch_id: emailBranch, role: 'branch', is_active: true,
})
result = await emailCase.owner.client.rpc('get_first_branch_provisioning_status')
assert.ifError(result.error)
assert.equal(result.data[0].access_complete, false)
assert.ifError((await admin.from('branches').update({ is_active: true }).eq('id', emailBranch)).error)
result = await emailCase.owner.client.rpc('get_first_branch_provisioning_status')
assert.ifError(result.error)
assert.equal(result.data[0].state, 'complete')
assert.equal(result.data[0].access_complete, true)
assert.equal(result.data[0].branch_id, emailBranch)

const usernameCase = await tenantAndOwner('Username access routing')
const usernameBranch = randomUUID()
assert.ifError((await admin.from('branches').insert({
  id: usernameBranch, tenant_id: usernameCase.tenantId, name: 'Existing username branch',
  is_main_branch: true, is_active: true,
})).error)
const internalEmail = `${randomUUID()}@branch-login.kubri.internal`
const usernameUser = await user(internalEmail, {
  tenant_id: usernameCase.tenantId, branch_id: usernameBranch, role: 'branch', is_active: true,
})
result = await usernameCase.owner.client.rpc('get_first_branch_provisioning_status')
assert.ifError(result.error)
assert.equal(result.data[0].access_complete, false)
const normalized = `u_${randomUUID().replaceAll('-', '').slice(0, 12)}`
assert.ifError((await admin.from('branch_login_usernames').insert({
  tenant_id: usernameCase.tenantId,
  branch_id: usernameBranch,
  user_id: usernameUser.id,
  username: normalized,
  normalized_username: normalized,
  internal_auth_email: internalEmail,
  is_active: true,
})).error)
result = await usernameCase.owner.client.rpc('get_first_branch_provisioning_status')
assert.ifError(result.error)
assert.equal(result.data[0].access_complete, true)

assert.equal(emailUser.id.length > 0, true)
console.log('existing Owner branch routing disposable runtime: PASS')
