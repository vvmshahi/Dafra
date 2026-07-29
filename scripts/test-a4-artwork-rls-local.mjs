import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const localStatus = execFileSync('supabase', ['status', '-o', 'env'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
})
const local = Object.fromEntries(
  localStatus
    .split('\n')
    .map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/"$/, '')]),
)
for (const key of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
  if (!local[key]) throw new Error(`Local Supabase status did not provide ${key}`)
}

const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const client = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const password = `${randomBytes(24).toString('hex')}Aa1!`
const tenantA = randomUUID()
const tenantB = randomUUID()
const branchA = randomUUID()
const branchSibling = randomUUID()
const branchB = randomUUID()
const users = []

const png = () => new Blob([Uint8Array.from([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
  0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
  0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
  0x89,0x00,0x00,0x00,0x0d,0x49,0x44,0x41,
  0x54,0x08,0xd7,0x63,0xf8,0xcf,0xc0,0xf0,
  0x1f,0x00,0x05,0x00,0x01,0xff,0x89,0x99,
  0x3d,0x1d,0x00,0x00,0x00,0x00,0x49,0x45,
  0x4e,0x44,0xae,0x42,0x60,0x82,
])], { type: 'image/png' })
const ok = result => {
  assert.ifError(result.error)
  return result.data
}
const denied = async promise => {
  const result = await promise
  assert.ok(result.error, 'operation should be denied')
}
const createUser = async (email, profile) => {
  const data = ok(await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'A4 local fixture' },
  }))
  users.push(data.user.id)
  const savedProfile = ok(await service
    .from('user_profiles')
    .upsert({ id: data.user.id, email, full_name: 'A4 local fixture', ...profile }, { onConflict: 'id' })
    .select('id,tenant_id,branch_id,role,is_active')
    .single())
  assert.equal(savedProfile.tenant_id, profile.tenant_id)
  assert.equal(savedProfile.branch_id, profile.branch_id)
  assert.equal(savedProfile.role, profile.role)
  assert.equal(savedProfile.is_active, true)
  const api = client()
  const session = ok(await api.auth.signInWithPassword({ email, password }))
  assert.equal(session.user.id, data.user.id)
  return api
}

try {
  ok(await service.from('tenants').insert([
    { id: tenantA, name: 'A4 local fixture A', vat_number: `3${Date.now().toString().slice(-14)}` },
    { id: tenantB, name: 'A4 local fixture B', vat_number: `4${Date.now().toString().slice(-14)}` },
  ]))
  ok(await service.from('branches').insert([
    { id: branchA, tenant_id: tenantA, name: 'A4 local branch A', is_active: true },
    { id: branchSibling, tenant_id: tenantA, name: 'A4 local sibling', is_active: true },
    { id: branchB, tenant_id: tenantB, name: 'A4 local branch B', is_active: true },
  ]))

  const owner = await createUser(`owner-${randomUUID()}@fixture.invalid`, {
    tenant_id: tenantA, branch_id: null, role: 'owner', is_active: true,
  })
  const branch = await createUser(`branch-${randomUUID()}@fixture.invalid`, {
    tenant_id: tenantA, branch_id: branchA, role: 'branch', is_active: true,
  })
  const other = await createUser(`other-${randomUUID()}@fixture.invalid`, {
    tenant_id: tenantB, branch_id: null, role: 'owner', is_active: true,
  })
  const anonymous = client()

  const ownerPath = `tenant/${tenantA}/branch/${branchA}/invoice-artwork/${randomUUID()}/header.png`
  ok(await owner.storage.from('invoice-artwork').upload(ownerPath, png(), { upsert: false }))
  ok(await owner.storage.from('invoice-artwork').download(ownerPath))
  ok(await owner.storage.from('invoice-artwork').update(ownerPath, png()))

  const branchPath = `tenant/${tenantA}/branch/${branchA}/invoice-artwork/${randomUUID()}/footer.png`
  ok(await branch.storage.from('invoice-artwork').upload(branchPath, png(), { upsert: false }))
  ok(await branch.storage.from('invoice-artwork').download(branchPath))
  ok(await branch.storage.from('invoice-artwork').update(branchPath, png()))

  const siblingPath = `tenant/${tenantA}/branch/${branchSibling}/invoice-artwork/${randomUUID()}/header.png`
  await denied(branch.storage.from('invoice-artwork').upload(siblingPath, png(), { upsert: false }))
  const crossTenantPath = `tenant/${tenantA}/branch/${branchA}/invoice-artwork/${randomUUID()}/header.png`
  await denied(other.storage.from('invoice-artwork').upload(crossTenantPath, png(), { upsert: false }))
  await denied(other.storage.from('invoice-artwork').download(ownerPath))
  await denied(anonymous.storage.from('invoice-artwork').upload(crossTenantPath, png(), { upsert: false }))
  await denied(anonymous.storage.from('invoice-artwork').download(ownerPath))
  await denied(anonymous.storage.from('invoice-artwork').update(ownerPath, png()))
  await anonymous.storage.from('invoice-artwork').remove([ownerPath])
  ok(await owner.storage.from('invoice-artwork').download(ownerPath))
  await other.storage.from('invoice-artwork').remove([ownerPath])
  ok(await owner.storage.from('invoice-artwork').download(ownerPath))

  ok(await owner.storage.from('invoice-artwork').upload(siblingPath, png(), { upsert: false }))
  await branch.storage.from('invoice-artwork').remove([siblingPath])
  ok(await owner.storage.from('invoice-artwork').download(siblingPath))

  for (const invalidPath of [
    `tenant/${tenantA}/branch/${branchA}/invoice-artwork/${randomUUID()}/../header.png`,
    `tenant/${tenantA}/branch/${branchA}/invoice-artwork/${randomUUID()}/side.png`,
    `tenant/${tenantA}/branch/${branchA}/invoice-artwork/${randomUUID()}/header.svg`,
    `tenant/${tenantA}/branch/${branchA}/extra/invoice-artwork/${randomUUID()}/header.png`,
  ]) {
    await denied(owner.storage.from('invoice-artwork').upload(invalidPath, png(), { upsert: false }))
  }
  await denied(owner.storage.from('invoice-artwork').move(ownerPath, siblingPath))

  ok(await owner.storage.from('invoice-artwork').remove([ownerPath]))
  ok(await owner.storage.from('invoice-artwork').remove([siblingPath]))
  ok(await branch.storage.from('invoice-artwork').remove([branchPath]))
} finally {
  for (const user of users) await service.auth.admin.deleteUser(user)
  await service.from('tenants').delete().in('id', [tenantA, tenantB])
}

console.log('A4 disposable local Storage API owner/branch CRUD and RLS matrix passed')
