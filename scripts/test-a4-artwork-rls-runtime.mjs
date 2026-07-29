import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'A4_TEST_OWNER_EMAIL',
  'A4_TEST_OWNER_PASSWORD',
  'A4_TEST_BRANCH_EMAIL',
  'A4_TEST_BRANCH_PASSWORD',
  'A4_TEST_OTHER_TENANT_EMAIL',
  'A4_TEST_OTHER_TENANT_PASSWORD',
  'A4_TEST_BRANCH_ID',
  'A4_TEST_FOREIGN_BRANCH_ID',
]
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing ${name}; this authenticated RLS test is intentionally opt-in.`)
}

const client = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const signIn = async (email, password) => {
  const api = client()
  const { error } = await api.auth.signInWithPassword({ email, password })
  if (error) throw error
  return api
}
const profile = async api => {
  const { data: user } = await api.auth.getUser()
  const { data, error } = await api.from('user_profiles').select('tenant_id,branch_id,role').eq('id', user.user.id).single()
  if (error) throw error
  return data
}
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
const expectDenied = async promise => {
  const result = await promise
  assert.ok(result.error, 'operation should be denied by RLS')
}

const owner = await signIn(process.env.A4_TEST_OWNER_EMAIL, process.env.A4_TEST_OWNER_PASSWORD)
const branch = await signIn(process.env.A4_TEST_BRANCH_EMAIL, process.env.A4_TEST_BRANCH_PASSWORD)
const other = await signIn(process.env.A4_TEST_OTHER_TENANT_EMAIL, process.env.A4_TEST_OTHER_TENANT_PASSWORD)
const anonymous = client()
const ownerProfile = await profile(owner)
const otherProfile = await profile(other)
const assetId = crypto.randomUUID()
const path = `tenant/${ownerProfile.tenant_id}/branch/${process.env.A4_TEST_BRANCH_ID}/invoice-artwork/${assetId}/header.png`

let result = await owner.storage.from('invoice-artwork').upload(path, png(), { upsert: false })
assert.ifError(result.error)
result = await owner.storage.from('invoice-artwork').download(path)
assert.ifError(result.error)
result = await owner.storage.from('invoice-artwork').update(path, png())
assert.ifError(result.error)

const foreignBranchPath = `tenant/${ownerProfile.tenant_id}/branch/${process.env.A4_TEST_FOREIGN_BRANCH_ID}/invoice-artwork/${crypto.randomUUID()}/header.png`
await expectDenied(branch.storage.from('invoice-artwork').upload(foreignBranchPath, png(), { upsert: false }))
const crossTenantPath = `tenant/${ownerProfile.tenant_id}/branch/${process.env.A4_TEST_BRANCH_ID}/invoice-artwork/${crypto.randomUUID()}/header.png`
assert.notEqual(otherProfile.tenant_id, ownerProfile.tenant_id)
await expectDenied(other.storage.from('invoice-artwork').upload(crossTenantPath, png(), { upsert: false }))
await expectDenied(anonymous.storage.from('invoice-artwork').upload(crossTenantPath, png(), { upsert: false }))

result = await owner.storage.from('invoice-artwork').remove([path])
assert.ifError(result.error)
console.log('A4 private artwork RLS insert/select/update/delete and isolation tests passed')
