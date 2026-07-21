import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const root = new URL('..', import.meta.url).pathname
const statusText = execFileSync('supabase', ['status', '--output', 'env'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const env = Object.fromEntries(statusText.split(/\r?\n/).map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map(match => [match[1], match[2].replace(/"$/, '')]))
const apiUrl = env.API_URL
const dbUrl = env.DB_URL
const serviceKey = env.SERVICE_ROLE_KEY
const anonKey = env.ANON_KEY
for (const value of [apiUrl, dbUrl]) {
  const host = new URL(value).hostname
  assert.ok(host === '127.0.0.1' || host === 'localhost', `Refusing non-localhost target: ${host}`)
}
assert.ok(serviceKey && anonKey, 'Local Supabase development keys are required')

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const service = createClient(apiUrl, serviceKey, options)
const password = `Local-Phase3C-${randomUUID()}!`
const emails = ['owner.phase3c@example.test', 'branch.phase3c@example.test', 'other-owner.phase3c@example.test']
const createdUserIds = []
let tenantA
let tenantB
let branchA
let branchB

const incomplete = {
  registeredSellerName: '', registeredSellerNameAr: '', vatNumber: '', registrationScheme: 'CRN',
  registrationIdentifier: '', buildingNumber: '', street: '', district: '', city: '', postalCode: '',
  country: 'SA', evidenceReference: '',
}
const complete = {
  registeredSellerName: 'Phase 3C Synthetic Trading Establishment',
  registeredSellerNameAr: 'مؤسسة اختبار المرحلة الثالثة',
  vatNumber: '300000000000003', registrationScheme: 'CRN', registrationIdentifier: '1010999999',
  buildingNumber: '1234', street: 'Synthetic Test Street', district: 'Test District', city: 'Riyadh',
  postalCode: '12345', country: 'SA', evidenceReference: 'Synthetic local runtime test only',
}
const reason = 'Synthetic localhost Phase 3C runtime confirmation'

function client() { return createClient(apiUrl, anonKey, options) }
async function ok(result, label) { if (result.error) throw new Error(`${label}: ${result.error.code ?? ''} ${result.error.message}`); return result.data }
async function denied(promise, label) { const result = await promise; assert.ok(result.error, `${label} unexpectedly succeeded`); return result.error }
async function rpc(c, name, args = {}) { return ok(await c.rpc(name, args), name) }
async function readiness(c, id) { return rpc(c, 'get_branch_compliance_readiness', { p_branch_id: id }) }
async function save(c, id, payload, why = 'Synthetic localhost draft save') { return rpc(c, 'save_branch_compliance_draft', { p_branch_id: id, p_payload: payload, p_reason: why }) }
async function confirm(c, id, payload, confirmation = true, why = reason) { return rpc(c, 'confirm_branch_official_seller_information', { p_branch_id: id, p_payload: payload, p_reason: why, p_confirmation: confirmation }) }

async function createUser(email, role) {
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Synthetic ${role}`, role } })
  const user = await ok(result, `create ${role}`)
  createdUserIds.push(user.user.id)
  return user.user.id
}
async function signIn(email) {
  const c = client()
  await ok(await c.auth.signInWithPassword({ email, password }), `sign in ${email}`)
  return c
}
async function count(table) {
  const result = await service.from(table).select('*', { count: 'exact', head: true })
  await ok(result, `count ${table}`)
  return result.count ?? 0
}
function sqlScalar(sql) {
  return execFileSync('docker', ['exec', 'supabase_db_Dafra', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', sql], { encoding: 'utf8' }).trim()
}

async function cleanup() {
  const tenantIds = [tenantA, tenantB].filter(Boolean)
  if (tenantIds.length) {
    const ids = tenantIds.map(id => `'${id}'::uuid`).join(',')
    execFileSync('docker', ['exec', 'supabase_db_Dafra', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-c',
      `BEGIN; DELETE FROM public.branch_compliance_profiles WHERE tenant_id IN (${ids}); DELETE FROM public.audit_events WHERE tenant_id IN (${ids}); DELETE FROM public.tenants WHERE id IN (${ids}); COMMIT;`],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] })
  }
  for (const id of createdUserIds.reverse()) await ok(await service.auth.admin.deleteUser(id), 'cleanup Auth user')
}

let passed = false
try {
  assert.equal(await count('tenants'), 0)
  assert.equal(await count('user_profiles'), 0)
  assert.equal(await count('invoices'), 0)

  const ownerAId = await createUser(emails[0], 'owner')
  const branchUserId = await createUser(emails[1], 'branch')
  const ownerBId = await createUser(emails[2], 'owner')
  tenantA = randomUUID(); tenantB = randomUUID(); branchA = randomUUID(); branchB = randomUUID()
  await ok(await service.from('tenants').insert([
    { id: tenantA, name: 'Phase 3C Synthetic Tenant A', vat_number: '300000000000013', cr_number: '1010999991', city: 'Riyadh' },
    { id: tenantB, name: 'Phase 3C Synthetic Tenant B', vat_number: '300000000000023', cr_number: '1010999992', city: 'Jeddah' },
  ]), 'create tenants')
  await ok(await service.from('branches').insert([
    { id: branchA, tenant_id: tenantA, name: 'Synthetic Branch A', branch_code: 'P3CA', is_main_branch: true },
    { id: branchB, tenant_id: tenantB, name: 'Synthetic Branch B', branch_code: 'P3CB', is_main_branch: true },
  ]), 'create branches')
  await ok(await service.from('user_profiles').upsert([
    { id: ownerAId, tenant_id: tenantA, branch_id: null, role: 'owner', email: emails[0], full_name: 'Synthetic Owner A', is_active: true },
    { id: branchUserId, tenant_id: tenantA, branch_id: branchA, role: 'branch', email: emails[1], full_name: 'Synthetic Branch User', is_active: true },
    { id: ownerBId, tenant_id: tenantB, branch_id: null, role: 'owner', email: emails[2], full_name: 'Synthetic Owner B', is_active: true },
  ]), 'scope synthetic profiles')
  const scopedProfiles = await ok(await service.from('user_profiles').select('id,tenant_id,branch_id,role,is_active').in('id', [ownerAId, branchUserId, ownerBId]), 'verify synthetic profiles')
  assert.equal(scopedProfiles.length, 3)

  const ownerA = await signIn(emails[0]); const branchUser = await signIn(emails[1]); const ownerB = await signIn(emails[2])
  const capability = await rpc(ownerA, 'get_compliance_identity_capability')
  assert.deepEqual(capability, { available: true, schema_version: 1 })
  assert.deepEqual(await rpc(branchUser, 'get_compliance_identity_capability'), capability)
  assert.doesNotMatch(JSON.stringify(capability), /secret|token|key|certificate|csid/i)

  await save(ownerA, branchA, incomplete)
  let state = await readiness(ownerA, branchA)
  assert.equal(state.status, 'draft'); assert.equal(state.mode, 'legacy'); assert.equal(state.profile.registeredSellerName, null)
  await save(ownerA, branchA, complete)
  state = await readiness(ownerA, branchA)
  assert.equal(state.status, 'draft'); assert.equal(state.profile.vatNumber, complete.vatNumber)
  const editedDraft = { ...complete, evidenceReference: 'Synthetic edited draft' }
  await save(ownerA, branchA, editedDraft)
  state = await readiness(ownerA, branchA)
  assert.equal(state.profile.evidenceReference, editedDraft.evidenceReference)
  assert.ok(state.profile.updatedAt)

  const beforeInvalid = JSON.stringify(state.profile)
  await denied(ownerA.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: { ...editedDraft, vatNumber: '123' }, p_reason: reason, p_confirmation: true }), 'malformed VAT confirmation')
  await denied(ownerA.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: { ...editedDraft, registeredSellerName: '' }, p_reason: reason, p_confirmation: true }), 'missing seller confirmation')
  await denied(ownerA.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: { ...editedDraft, postalCode: '12' }, p_reason: reason, p_confirmation: true }), 'invalid postal confirmation')
  await denied(ownerA.rpc('save_branch_compliance_draft', { p_branch_id: branchA, p_payload: { ...editedDraft, registrationScheme: 'BAD' }, p_reason: reason }), 'unsupported registration type')
  assert.equal(JSON.stringify((await readiness(ownerA, branchA)).profile), beforeInvalid)

  await denied(ownerA.rpc('save_branch_compliance_draft', { p_branch_id: branchB, p_payload: editedDraft, p_reason: reason }), 'owner A mutate branch B')
  await denied(ownerA.rpc('save_branch_compliance_draft', { p_branch_id: randomUUID(), p_payload: editedDraft, p_reason: reason }), 'wrong branch ID')
  assert.equal((await readiness(branchUser, branchA)).branchId, branchA)
  await denied(branchUser.rpc('save_branch_compliance_draft', { p_branch_id: branchA, p_payload: editedDraft, p_reason: reason }), 'branch save')
  await denied(branchUser.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: editedDraft, p_reason: reason, p_confirmation: true }), 'branch confirm')
  await denied(branchUser.rpc('activate_branch_compliance_identity', { p_branch_id: branchA, p_reason: reason, p_confirmation: true }), 'branch activate')
  await denied(branchUser.rpc('get_branch_compliance_readiness', { p_branch_id: branchB }), 'branch read B')
  await denied(ownerB.rpc('get_branch_compliance_readiness', { p_branch_id: branchA }), 'owner B read A')
  await denied(ownerB.rpc('save_branch_compliance_draft', { p_branch_id: branchA, p_payload: editedDraft, p_reason: reason }), 'owner B mutate A')

  await denied(ownerA.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: editedDraft, p_reason: reason, p_confirmation: false }), 'confirmation false')
  await denied(ownerA.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: editedDraft, p_reason: '', p_confirmation: true }), 'empty reason')
  await denied(ownerA.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: editedDraft, p_reason: '   ', p_confirmation: true }), 'blank reason')
  assert.equal((await readiness(ownerA, branchA)).status, 'draft')
  await denied(ownerA.rpc('activate_branch_compliance_identity', { p_branch_id: branchA, p_reason: reason, p_confirmation: true }), 'activation precondition')

  const first = await confirm(ownerA, branchA, editedDraft)
  assert.equal(first.status, 'verified'); assert.equal(first.mode, 'protected'); assert.equal(first.idempotent, false)
  state = await readiness(ownerA, branchA)
  assert.equal(state.status, 'verified'); assert.equal(state.mode, 'protected'); assert.equal(state.profile.verifiedBy, ownerAId); assert.ok(state.profile.verifiedAt)
  const second = await confirm(ownerA, branchA, editedDraft)
  assert.equal(second.idempotent, true)

  const reconfirmPayload = { ...editedDraft, registeredSellerName: 'Phase 3C Synthetic Trading Establishment Updated', vatNumber: '300000000000033' }
  await save(ownerA, branchA, reconfirmPayload, 'Synthetic confirmed-profile edit')
  state = await readiness(ownerA, branchA)
  assert.equal(state.status, 'revalidation_required'); assert.equal(state.mode, 'protected'); assert.equal(state.profile.verifiedAt, null)
  const concurrent = await Promise.all([confirm(ownerA, branchA, reconfirmPayload), confirm(ownerA, branchA, reconfirmPayload)])
  assert.equal(concurrent.filter(item => item.idempotent === false).length, 1)
  assert.equal(concurrent.filter(item => item.idempotent === true).length, 1)
  state = await readiness(ownerA, branchA)
  assert.equal(state.status, 'verified'); assert.equal(state.mode, 'protected'); assert.equal(state.profile.vatNumber, reconfirmPayload.vatNumber)

  await ok(await service.from('user_profiles').update({ is_active: false }).eq('id', ownerAId), 'deactivate owner')
  await denied(ownerA.rpc('confirm_branch_official_seller_information', { p_branch_id: branchA, p_payload: reconfirmPayload, p_reason: reason, p_confirmation: true }), 'inactive owner')
  await ok(await service.from('user_profiles').update({ is_active: true }).eq('id', ownerAId), 'reactivate owner')
  assert.equal((await readiness(ownerA, branchA)).status, 'verified')

  const officialBeforeDisplay = JSON.stringify((await readiness(ownerA, branchA)).profile)
  await ok(await service.from('branches').update({ invoice_display_heading: 'Synthetic Customer Display Heading', display_name: 'Synthetic Brand' }).eq('id', branchA), 'update display fields')
  const afterDisplay = await readiness(ownerA, branchA)
  assert.equal(JSON.stringify(afterDisplay.profile), officialBeforeDisplay); assert.equal(afterDisplay.status, 'verified'); assert.equal(afterDisplay.mode, 'protected')

  const audits = await ok(await service.from('audit_events').select('action,actor_user_id,actor_role,tenant_id,branch_id,metadata,created_at').eq('branch_id', branchA).like('action', 'branch_compliance_%').order('created_at'), 'load audits')
  const actions = audits.map(item => item.action)
  for (const action of ['branch_compliance_draft_saved', 'branch_compliance_submitted', 'branch_compliance_owner_confirmed', 'branch_compliance_verified', 'branch_compliance_identity_activated']) assert.ok(actions.includes(action), `missing audit ${action}`)
  assert.equal(actions.filter(action => action === 'branch_compliance_identity_activated').length, 1)
  for (const item of audits) {
    assert.ok(item.actor_user_id && item.actor_role && item.tenant_id === tenantA && item.branch_id === branchA && item.created_at)
    const metadata = JSON.stringify(item.metadata).toLowerCase()
    for (const forbidden of ['password', 'access_token', 'refresh_token', 'service_role_key', 'private_key', 'certificate', 'csid', 'otp']) assert.ok(!metadata.includes(forbidden), `unsafe audit metadata: ${forbidden}`)
  }

  assert.equal(await count('invoices'), 0)
  assert.equal(Number(sqlScalar('SELECT count(*) FROM public.branch_compliance_profiles')), 1)
  const catalog = sqlScalar("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity")
  assert.ok(Number(catalog) >= 1, 'RLS must remain enabled')
  passed = true
  console.log(`Phase 3C runtime assertions passed (${audits.length} scoped compliance audit events).`)
} finally {
  await cleanup()
  assert.equal(await count('tenants'), 0)
  assert.equal(await count('user_profiles'), 0)
  assert.equal(await count('invoices'), 0)
  if (!passed) console.error('Phase 3C cleanup completed after a failed assertion.')
}
