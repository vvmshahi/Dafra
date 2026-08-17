import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'

const root = new URL('..', import.meta.url).pathname
const workdir = process.env.DAFRA_ATOMIC_TEST_WORKDIR
assert.ok(workdir, 'DAFRA_ATOMIC_TEST_WORKDIR is required')
assert.match(
  workdir,
  /^\/(?:private\/)?tmp\/dafra-(?:atomic-disposable|migration-chain)\./,
  'Refusing to run outside a named disposable temporary workdir',
)

const config = readFileSync(`${workdir}/supabase/config.toml`, 'utf8')
const projectId = config.match(/project_id = "([^"]+)"/)?.[1]
assert.match(
  projectId ?? '',
  /^dafra_(?:atomic_disposable|migration_chain|remote_reconcile)_[^"]+$/,
)
assert.ok(!config.includes('bkbphkpqcxuejozayrsy'), 'Production project ref is forbidden')

const statusText = execFileSync(
  'supabase',
  ['status', '--workdir', workdir, '--output', 'env'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)
const localEnv = Object.fromEntries(
  statusText
    .split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(match => [match[1], match[2].replace(/"$/, '')]),
)
for (const endpoint of [localEnv.API_URL, localEnv.DB_URL]) {
  const url = new URL(endpoint)
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Refusing non-local endpoint')
}
assert.ok(new URL(localEnv.DB_URL).port, 'Disposable database port is required')
assert.ok(localEnv.SERVICE_ROLE_KEY && localEnv.ANON_KEY, 'Disposable local keys are required')

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}
const service = createClient(localEnv.API_URL, localEnv.SERVICE_ROLE_KEY, clientOptions)
const anon = createClient(localEnv.API_URL, localEnv.ANON_KEY, clientOptions)
const password = `Atomic-${randomUUID()}!`
const identityRun = randomUUID().replaceAll('-', '')
const emails = {
  ownerA: `atomic-owner-a-${identityRun}@example.test`,
  adminA: `atomic-admin-a-${identityRun}@example.test`,
  branch: `atomic-branch-a-${identityRun}@example.test`,
  branchA2: `atomic-branch-a2-${identityRun}@example.test`,
  ownerB: `atomic-owner-b-${identityRun}@example.test`,
  demoTrading: `atomic-demo-trading-${identityRun}@example.test`,
  demoService: `atomic-demo-service-${identityRun}@example.test`,
}
const ids = {
  tenantA: randomUUID(),
  tenantB: randomUUID(),
  demoTenant: 'ebf1144b-55ed-472a-99c9-23b5ee915351',
  branchA: randomUUID(),
  branchA2: randomUUID(),
  branchB: randomUUID(),
  demoTradingBranch: '14271653-b404-44bf-9f39-7e9927569c02',
  demoServiceBranch: 'c30094d7-40ca-4d2e-833a-07aa18c4fa46',
  posSessionA: randomUUID(),
  posSessionA2: randomUUID(),
  posSessionB: randomUUID(),
  posSessionDemoTrading: randomUUID(),
  posSessionDemoService: randomUUID(),
  product: randomUUID(),
  serviceProduct: randomUUID(),
  branchA2ServiceProduct: randomUUID(),
  demoTradingProduct: randomUUID(),
  demoServiceProduct: randomUUID(),
  individualCustomer: randomUUID(),
  businessCustomer: randomUUID(),
}
const timings = {}
const timeline = []

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    )
  }
  return value
}

function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex')
}

function artifact(label) {
  const xml = `<Invoice xmlns="urn:zatca:atomic:disposable"><ID>${label}</ID></Invoice>`
  return {
    xml,
    hash: createHash('sha256').update(xml).digest('base64'),
    signature: `disposable-signature-${label}`,
    qr: `disposable-phase2-qr-${label}`,
  }
}

async function ok(resultPromise, label) {
  const result = await resultPromise
  if (result.error) {
    throw new Error(`${label}: ${result.error.code ?? ''} ${result.error.message}`)
  }
  return result.data
}

async function expectError(resultPromise, pattern, label) {
  const result = await resultPromise
  assert.ok(result.error, `${label} unexpectedly succeeded`)
  assert.match(
    `${result.error.code ?? ''} ${result.error.message ?? ''} ${result.error.details ?? ''}`,
    pattern,
    `${label} returned an unexpected error`,
  )
  return result.error
}

async function rowCount(resultPromise, label) {
  const result = await resultPromise
  if (result.error) {
    throw new Error(`${label}: ${result.error.code ?? ''} ${result.error.message}`)
  }
  assert.equal(typeof result.count, 'number', `${label} did not return an exact count`)
  return result.count
}

async function createUser(email, role) {
  const data = await ok(
    service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role },
    }),
    `create ${email}`,
  )
  return data.user.id
}

async function login(email) {
  const client = createClient(localEnv.API_URL, localEnv.ANON_KEY, clientOptions)
  await ok(client.auth.signInWithPassword({ email, password }), `login ${email}`)
  return client
}

async function timed(name, operation) {
  const started = performance.now()
  const result = await operation()
  timings[name] = Number((performance.now() - started).toFixed(2))
  return result
}

async function prepare(actorId, payload, documentType = 'invoice', ttl = 120, timingName = null) {
  const operation = () => ok(
    service.rpc('prepare_zatca_atomic_checkout_v2', {
      p_actor_user_id: actorId,
      p_document_type: documentType,
      p_payload: payload,
      p_cart_fingerprint: fingerprint(payload),
      p_ttl_seconds: ttl,
    }),
    `prepare ${payload.idempotency_key}`,
  )
  return timingName ? timed(timingName, operation) : operation()
}

async function storeArtifact(prepared, value, recordTimings = false) {
  const claimOperation = () => ok(
    service.rpc('claim_zatca_atomic_checkout_signing_v2', {
      p_intent_id: prepared.intentId,
      p_claim_token: prepared.claimToken,
      p_lease_seconds: 45,
    }),
    'claim signing input',
  )
  const signing = recordTimings
    ? await timed('signing_input_retrieval_ms', claimOperation)
    : await claimOperation()
  assert.equal(signing.status, 'claimed')

  const storeOperation = () => ok(
    service.rpc('store_zatca_atomic_checkout_artifact_v2', {
      p_intent_id: prepared.intentId,
      p_claim_token: prepared.claimToken,
      p_signing_token: signing.signingToken,
      p_snapshot_hash: prepared.snapshotHash,
      p_signed_xml: value.xml,
      p_xml_hash: value.hash,
      p_signature: value.signature,
      p_qr: value.qr,
    }),
    'store signed artifact',
  )
  const stored = recordTimings
    ? await timed('artifact_storage_ms', storeOperation)
    : await storeOperation()
  assert.equal(stored.status, 'artifact_stored')
}

async function commit(client, prepared, timingName = null) {
  const operation = () => ok(
    client.rpc('commit_zatca_atomic_checkout_v2', {
      p_intent_id: prepared.intentId,
      p_claim_token: prepared.claimToken,
    }),
    'commit atomic checkout',
  )
  return timingName ? timed(timingName, operation) : operation()
}

async function expireIntent(intentId) {
  await ok(
    service
      .from('zatca_atomic_checkout_intents_v2')
      .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('id', intentId),
    'force disposable intent expiry',
  )
  const count = await ok(
    service.rpc('expire_zatca_atomic_checkout_intents_v2', { p_limit: 100 }),
    'expire intent cleanup',
  )
  assert.ok(count >= 1)
  const row = await ok(
    service
      .from('zatca_atomic_checkout_intents_v2')
      .select('state,failure_code')
      .eq('id', intentId)
      .single(),
    'read expired intent',
  )
  assert.equal(row.state, 'expired')
}

async function invoiceCounts(invoiceId) {
  const [invoice, items, payments, movements, outbox, reservation] = await Promise.all([
    service.from('invoices').select('id', { count: 'exact', head: true }).eq('id', invoiceId),
    service.from('invoice_items').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId),
    service.from('payments').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId),
    service.from('pos_stock_movements').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId),
    service.from('zatca_reporting_outbox_v2').select('id', { count: 'exact', head: true }).eq('invoice_id', invoiceId),
    service.from('zatca_chain_reservations_v2').select('invoice_id', { count: 'exact', head: true }).eq('invoice_id', invoiceId),
  ])
  for (const [index, result] of [invoice, items, payments, movements, outbox, reservation].entries()) {
    assert.equal(result.error, null, `count query ${index} failed`)
  }
  return {
    invoice: invoice.count,
    items: items.count,
    payments: payments.count,
    movements: movements.count,
    outbox: outbox.count,
    reservation: reservation.count,
  }
}

function runPsql(sql) {
  return new Promise(resolve => {
    const started = performance.now()
    const child = spawn(
      'psql',
      [localEnv.DB_URL, '-X', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-c', sql],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', code => resolve({
      code,
      stdout,
      stderr,
      durationMs: Number((performance.now() - started).toFixed(2)),
    }))
  })
}

// The hosted production role enum includes the legacy tenant-admin value while
// the disposable canonical baseline does not. Add it only to this isolated
// fixture so the reviewed production compatibility path is exercised.
const adminRoleFixture = await runPsql(
  "ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin'",
)
assert.equal(
  adminRoleFixture.code,
  0,
  `install disposable admin role fixture: ${adminRoleFixture.stderr}`,
)
// ALTER TYPE invalidates PostgREST's schema cache. Wait for its guarded local
// reload before issuing auth or RPC requests so the test cannot race a restart.
await delay(5_000)

const ownerAId = await createUser(emails.ownerA, 'owner')
const adminAId = await createUser(emails.adminA, 'admin')
const branchUserId = await createUser(emails.branch, 'branch')
const branchA2UserId = await createUser(emails.branchA2, 'branch')
const ownerBId = await createUser(emails.ownerB, 'owner')
const demoTradingUserId = await createUser(emails.demoTrading, 'branch')
const demoServiceUserId = await createUser(emails.demoService, 'branch')
const ownerA = await login(emails.ownerA)
const adminA = await login(emails.adminA)
const branchUser = await login(emails.branch)
const branchA2User = await login(emails.branchA2)
const ownerB = await login(emails.ownerB)
const demoTradingUser = await login(emails.demoTrading)
const demoServiceUser = await login(emails.demoService)

await ok(service.from('tenants').insert([
  {
    id: ids.tenantA,
    name: 'Atomic Disposable Tenant A',
    vat_number: '300000000000003',
    city: 'Riyadh',
    business_type: 'trading',
  },
  {
    id: ids.tenantB,
    name: 'Atomic Disposable Tenant B',
    vat_number: '300000000000013',
    city: 'Jeddah',
    business_type: 'trading',
  },
  {
    id: ids.demoTenant,
    name: 'Atomic Permanent Demo Tenant',
    vat_number: '300000000000033',
    city: 'Riyadh',
    business_type: 'trading',
  },
]), 'insert tenants')
await ok(service.from('branches').insert([
  {
    id: ids.branchA,
    tenant_id: ids.tenantA,
    name: 'Atomic Branch A',
    name_ar: 'فرع الاختبار أ',
    branch_code: 'ATOM-A',
    is_main_branch: true,
    business_name: 'Atomic Disposable Seller',
    business_name_ar: 'بائع ذري تجريبي',
    vat_number: '300000000000003',
    cr_number: '1010999901',
    building_number: '1234',
    street: 'Disposable Street',
    district: 'Test District',
    city: 'Riyadh',
    postal_code: '12345',
    zatca_phase: 2,
    invoice_prefix: 'ATM',
    vat_mode: 'exclusive',
  },
  {
    id: ids.branchA2,
    tenant_id: ids.tenantA,
    name: 'Atomic Branch A2',
    branch_code: 'ATOM-A2',
    is_main_branch: false,
  },
  {
    id: ids.branchB,
    tenant_id: ids.tenantB,
    name: 'Atomic Branch B',
    branch_code: 'ATOM-B',
    is_main_branch: true,
  },
  {
    id: ids.demoTradingBranch,
    tenant_id: ids.demoTenant,
    name: 'Atomic Demo Trading Branch',
    branch_code: 'ATOM-DEMO-T',
    invoice_prefix: 'DMT',
    is_main_branch: true,
    zatca_phase: 2,
  },
  {
    id: ids.demoServiceBranch,
    tenant_id: ids.demoTenant,
    name: 'Atomic Demo Service Branch',
    branch_code: 'ATOM-DEMO-S',
    invoice_prefix: 'DMS',
    is_main_branch: false,
    zatca_phase: 2,
  },
]), 'insert branches')
await ok(service.from('user_profiles').upsert([
  {
    id: ownerAId,
    tenant_id: ids.tenantA,
    role: 'owner',
    full_name: 'Atomic Owner A',
    email: emails.ownerA,
    is_active: true,
  },
  {
    id: branchUserId,
    tenant_id: ids.tenantA,
    branch_id: ids.branchA,
    role: 'branch',
    full_name: 'Atomic Branch User',
    email: emails.branch,
    is_active: true,
  },
  {
    id: adminAId,
    tenant_id: ids.tenantA,
    role: 'admin',
    full_name: 'Atomic Admin A',
    email: emails.adminA,
    is_active: true,
  },
  {
    id: branchA2UserId,
    tenant_id: ids.tenantA,
    branch_id: ids.branchA2,
    role: 'branch',
    full_name: 'Atomic Branch A2 User',
    email: emails.branchA2,
    is_active: true,
  },
  {
    id: ownerBId,
    tenant_id: ids.tenantB,
    role: 'owner',
    full_name: 'Atomic Owner B',
    email: emails.ownerB,
    is_active: true,
  },
  {
    id: demoTradingUserId,
    tenant_id: ids.demoTenant,
    branch_id: ids.demoTradingBranch,
    role: 'branch',
    full_name: 'Atomic Demo Trading User',
    email: emails.demoTrading,
    is_active: true,
  },
  {
    id: demoServiceUserId,
    tenant_id: ids.demoTenant,
    branch_id: ids.demoServiceBranch,
    role: 'branch',
    full_name: 'Atomic Demo Service User',
    email: emails.demoService,
    is_active: true,
  },
]), 'insert profiles')

const posSessionFixtures = await runPsql(`
  INSERT INTO public.pos_sessions
    (id, tenant_id, branch_id, opened_by, opening_cash, status)
  VALUES
    (
      '${ids.posSessionA}'::uuid,
      '${ids.tenantA}'::uuid,
      '${ids.branchA}'::uuid,
      '${branchUserId}'::uuid,
      100,
      'open'
    ),
    (
      '${ids.posSessionA2}'::uuid,
      '${ids.tenantA}'::uuid,
      '${ids.branchA2}'::uuid,
      '${branchA2UserId}'::uuid,
      200,
      'open'
    ),
    (
      '${ids.posSessionB}'::uuid,
      '${ids.tenantB}'::uuid,
      '${ids.branchB}'::uuid,
      '${ownerBId}'::uuid,
      300,
      'open'
    ),
    (
      '${ids.posSessionDemoTrading}'::uuid,
      '${ids.demoTenant}'::uuid,
      '${ids.demoTradingBranch}'::uuid,
      '${demoTradingUserId}'::uuid,
      0,
      'open'
    ),
    (
      '${ids.posSessionDemoService}'::uuid,
      '${ids.demoTenant}'::uuid,
      '${ids.demoServiceBranch}'::uuid,
      '${demoServiceUserId}'::uuid,
      0,
      'open'
    )
`)
assert.equal(
  posSessionFixtures.code,
  0,
  `insert disposable POS session fixtures: ${posSessionFixtures.stderr}`,
)

await expectError(
  anon.from('pos_sessions').select('id,tenant_id,branch_id'),
  /permission denied|42501|401|403/i,
  'anon POS session read',
)
const branchVisibleSessions = await ok(
  branchUser.from('pos_sessions').select('id,tenant_id,branch_id').order('id'),
  'branch user permitted POS session read',
)
assert.deepEqual(branchVisibleSessions, [{
  id: ids.posSessionA,
  tenant_id: ids.tenantA,
  branch_id: ids.branchA,
}])
const branchCrossBranchSessions = await ok(
  branchUser
    .from('pos_sessions')
    .select('id')
    .eq('branch_id', ids.branchA2),
  'branch user cross-branch POS session read',
)
assert.deepEqual(branchCrossBranchSessions, [])
const branchCrossTenantSessions = await ok(
  branchUser
    .from('pos_sessions')
    .select('id')
    .eq('tenant_id', ids.tenantB),
  'branch user cross-tenant POS session read',
)
assert.deepEqual(branchCrossTenantSessions, [])
const ownerVisibleSessions = await ok(
  ownerA.from('pos_sessions').select('id,tenant_id,branch_id').order('branch_id'),
  'owner same-tenant POS session read',
)
assert.equal(ownerVisibleSessions.length, 2)
assert.deepEqual(
  new Set(ownerVisibleSessions.map(row => row.id)),
  new Set([ids.posSessionA, ids.posSessionA2]),
)
assert.ok(ownerVisibleSessions.every(row => row.tenant_id === ids.tenantA))
const otherOwnerVisibleSessions = await ok(
  ownerB.from('pos_sessions').select('id,tenant_id,branch_id'),
  'other tenant owner POS session read',
)
assert.deepEqual(otherOwnerVisibleSessions, [{
  id: ids.posSessionB,
  tenant_id: ids.tenantB,
  branch_id: ids.branchB,
}])

const officialSeller = {
  registeredSellerName: 'Atomic Disposable Seller',
  registeredSellerNameAr: 'بائع ذري تجريبي',
  vatNumber: '300000000000003',
  registrationScheme: 'CRN',
  registrationIdentifier: '1010999901',
  buildingNumber: '1234',
  street: 'Disposable Street',
  district: 'Test District',
  city: 'Riyadh',
  postalCode: '12345',
  country: 'SA',
  evidenceReference: 'Disposable localhost database fixture',
}
await ok(ownerA.rpc('save_branch_compliance_draft', {
  p_branch_id: ids.branchA,
  p_payload: officialSeller,
  p_reason: 'Disposable atomic fixture',
}), 'save compliance fixture')
await ok(ownerA.rpc('confirm_branch_official_seller_information', {
  p_branch_id: ids.branchA,
  p_payload: officialSeller,
  p_reason: 'Disposable atomic fixture confirmation',
  p_confirmation: true,
}), 'confirm compliance fixture')

await ok(service.from('products').insert([
  {
    id: ids.product,
    tenant_id: ids.tenantA,
    branch_id: ids.branchA,
    name: 'Atomic Stock Product',
    sku: 'ATOM-STOCK',
    price: 100,
    tax_rate: 15,
    tax_category: 'S',
    is_taxable: true,
    vat_treatment: 'exclusive',
    stock_quantity: 50,
    track_stock: true,
    is_service: false,
    is_active: true,
    is_available: true,
  },
  {
    id: ids.serviceProduct,
    tenant_id: ids.tenantA,
    branch_id: ids.branchA,
    name: 'Atomic Service Product',
    sku: 'ATOM-SERVICE',
    price: 20,
    tax_rate: 15,
    tax_category: 'S',
    is_taxable: true,
    vat_treatment: 'exclusive',
    stock_quantity: 0,
    track_stock: false,
    is_service: true,
    is_active: true,
    is_available: true,
  },
  {
    id: ids.branchA2ServiceProduct,
    tenant_id: ids.tenantA,
    branch_id: ids.branchA2,
    name: 'Atomic Branch A2 Service',
    sku: 'ATOM-A2-SERVICE',
    price: 30,
    tax_rate: 15,
    tax_category: 'S',
    is_taxable: true,
    vat_treatment: 'exclusive',
    stock_quantity: 0,
    track_stock: false,
    is_service: true,
    is_active: true,
    is_available: true,
  },
  {
    id: ids.demoTradingProduct,
    tenant_id: ids.demoTenant,
    branch_id: ids.demoTradingBranch,
    name: 'Atomic Demo Trading Service',
    sku: 'ATOM-DEMO-T',
    price: 40,
    tax_rate: 15,
    tax_category: 'S',
    is_taxable: true,
    vat_treatment: 'exclusive',
    stock_quantity: 0,
    track_stock: false,
    is_service: true,
    is_active: true,
    is_available: true,
  },
  {
    id: ids.demoServiceProduct,
    tenant_id: ids.demoTenant,
    branch_id: ids.demoServiceBranch,
    name: 'Atomic Demo Service Product',
    sku: 'ATOM-DEMO-S',
    price: 50,
    tax_rate: 15,
    tax_category: 'S',
    is_taxable: true,
    vat_treatment: 'exclusive',
    stock_quantity: 0,
    track_stock: false,
    is_service: true,
    is_active: true,
    is_available: true,
  },
]), 'insert products')
await ok(service.from('customers').insert([
  {
    id: ids.individualCustomer,
    tenant_id: ids.tenantA,
    branch_id: ids.branchA,
    name: 'Atomic Individual',
    customer_type: 'individual',
    is_active: true,
  },
  {
    id: ids.businessCustomer,
    tenant_id: ids.tenantA,
    branch_id: ids.branchA,
    name: 'Atomic Business',
    business_name: 'Atomic Business Buyer',
    customer_type: 'business',
    vat_number: '300000000000023',
    is_active: true,
  },
]), 'insert customers')
await ok(service.from('zatca_production_credentials').insert({
  tenant_id: ids.tenantA,
  branch_id: ids.branchA,
  environment: 'production',
  egs_serial_number: 'DISPOSABLE-EGS-1',
  functionality_map: '0100',
  onboarding_status: 'production_connected',
  encrypted_production_csid: 'disposable-not-a-real-secret',
  encrypted_production_secret: 'disposable-not-a-real-secret',
  created_by: ownerAId,
  updated_by: ownerAId,
}), 'insert disposable production readiness record')

const initialRuntime = await ok(
  service
    .from('zatca_finalization_runtime')
    .select('immutable_finalization_enabled,simplified_enabled,standard_enabled,atomic_simplified_checkout_enabled,minimum_client_version,minimum_edge_version')
    .eq('singleton', true)
    .single(),
  'read initial runtime flags',
)
assert.equal(initialRuntime.immutable_finalization_enabled, false)
assert.equal(initialRuntime.simplified_enabled, false)
assert.equal(initialRuntime.standard_enabled, false)
assert.equal(initialRuntime.atomic_simplified_checkout_enabled, false)
const defaultBranchGates = await ok(
  service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .select('tenant_id,branch_id,enabled')
    .in('branch_id', [
      ids.branchA,
      ids.branchA2,
      ids.branchB,
      ids.demoTradingBranch,
      ids.demoServiceBranch,
    ]),
  'read default branch gates',
)
assert.equal(defaultBranchGates.length, 5)
assert.ok(defaultBranchGates.every(gate => gate.enabled === false))
assert.deepEqual(
  new Set(defaultBranchGates.map(gate => gate.branch_id)),
  new Set([
    ids.branchA,
    ids.branchA2,
    ids.branchB,
    ids.demoTradingBranch,
    ids.demoServiceBranch,
  ]),
)

const initialized = await ok(service.rpc('initialize_zatca_new_branch_chain_v2', {
  p_branch_id: ids.branchA,
  p_reason: 'Disposable new compliance unit',
  p_approved_by: ownerAId,
}), 'initialize disposable chain')
assert.equal(initialized.initialized, true)

await ok(
  service
    .from('zatca_finalization_runtime')
    .update({
      immutable_finalization_enabled: true,
      simplified_enabled: true,
      standard_enabled: false,
      atomic_simplified_checkout_enabled: false,
    })
    .eq('singleton', true),
  'enable local prerequisite flags',
)
for (const userId of [ownerAId, branchUserId]) {
  const acknowledged = await ok(service.rpc('acknowledge_zatca_client_capability_v2', {
    p_user_id: userId,
    p_branch_id: ids.branchA,
    p_client_version: initialRuntime.minimum_client_version,
    p_edge_version: initialRuntime.minimum_edge_version,
    p_ttl_seconds: 600,
  }), 'acknowledge disposable client')
  assert.equal(acknowledged.acknowledged, true)
}
const defaultGate = await ok(
  service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .select('enabled')
    .eq('branch_id', ids.branchA)
    .single(),
  'read default branch gate',
)
assert.equal(defaultGate.enabled, false)
await ok(
  service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .update({ enabled: true })
    .eq('branch_id', ids.branchA),
  'enable disposable branch gate',
)
await ok(
  service
    .from('zatca_finalization_runtime')
    .update({ atomic_simplified_checkout_enabled: true })
    .eq('singleton', true),
  'enable disposable atomic flag',
)

const basePayload = {
  branch_id: ids.branchA,
  customer_id: ids.individualCustomer,
  session_id: ids.posSessionA,
  payment_method: 'card',
  items: [{ product_id: ids.product, quantity: 2 }],
  idempotency_key: `atomic-normal-${randomUUID()}`,
}
const missingSessionPayload = {
  ...basePayload,
  session_id: null,
  idempotency_key: `atomic-no-session-${randomUUID()}`,
}
await expectError(
  service.rpc('prepare_zatca_atomic_checkout_v2', {
    p_actor_user_id: branchUserId,
    p_document_type: 'invoice',
    p_payload: missingSessionPayload,
    p_cart_fingerprint: fingerprint(missingSessionPayload),
    p_ttl_seconds: 120,
  }),
  /NO_SESSION/,
  'atomic checkout requires an open register session',
)
const prepared = await prepare(
  branchUserId,
  basePayload,
  'invoice',
  120,
  'intent_preparation_ms',
)
assert.equal(prepared.status, 'prepared')
assert.equal(prepared.snapshot.zatca_counter_number, 1)
await storeArtifact(prepared, artifact('normal'), true)

await expectError(
  ownerB.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: prepared.intentId,
    p_claim_token: prepared.claimToken,
  }),
  /ATOMIC_CHECKOUT_COMMIT_FORBIDDEN|42501/,
  'cross-tenant commit',
)

const committed = await commit(branchUser, prepared, 'final_transaction_ms')
assert.equal(committed.status, 'committed')
assert.equal(committed.idempotentReplay, false)
const normalInvoiceId = committed.invoiceId
assert.equal(committed.receipt.qr_code, artifact('normal').qr)
assert.equal(committed.receipt.can_print, true)
assert.equal(committed.receipt.reporting_display_state, 'reporting_pending')

const normalCounts = await invoiceCounts(normalInvoiceId)
assert.deepEqual(normalCounts, {
  invoice: 1,
  items: 1,
  payments: 1,
  movements: 1,
  outbox: 1,
  reservation: 1,
})
const productAfterSuccess = await ok(
  service.from('products').select('stock_quantity').eq('id', ids.product).single(),
  'read success stock',
)
assert.equal(Number(productAfterSuccess.stock_quantity), 48)

const replayPrepare = await prepare(branchUserId, basePayload)
assert.equal(replayPrepare.status, 'committed')
assert.equal(replayPrepare.idempotentReplay, true)
assert.equal(replayPrepare.invoiceId, normalInvoiceId)
assert.deepEqual(replayPrepare.receipt, committed.receipt)
await expectError(
  service.rpc('prepare_zatca_atomic_checkout_v2', {
    p_actor_user_id: branchUserId,
    p_document_type: 'invoice',
    p_payload: basePayload,
    p_cart_fingerprint: 'f'.repeat(64),
    p_ttl_seconds: 120,
  }),
  /IDEMPOTENCY_FINGERPRINT_MISMATCH/,
  'mismatched fingerprint',
)

await expectError(
  service
    .from('zatca_atomic_checkout_intents_v2')
    .update({ candidate_signed_xml: '<mutated />' })
    .eq('id', prepared.intentId),
  /ATOMIC_CHECKOUT_INTENT_IMMUTABLE/,
  'immutable intent artifact',
)
await expectError(
  service
    .from('invoices')
    .update({ zatca_simplified_xml: '<mutated />' })
    .eq('id', normalInvoiceId),
  /immutable|55000|simplified/i,
  'immutable committed invoice artifact',
)

const claimedOutbox = await ok(service.rpc('claim_zatca_reporting_outbox_v2', {
  p_claimed_by: 'disposable-runtime-test',
  p_lease_seconds: 120,
  p_invoice_id: normalInvoiceId,
}), 'claim normal outbox')
assert.equal(claimedOutbox.status, 'claimed')
const networkClaim = await ok(service.rpc('claim_zatca_network_v2', {
  p_invoice_id: normalInvoiceId,
  p_claimed_by: 'disposable-runtime-test',
  p_lease_seconds: 120,
}), 'claim normal network')
assert.equal(networkClaim.status, 'claimed')
await ok(service.rpc('mark_zatca_network_request_started_v2', {
  p_invoice_id: normalInvoiceId,
  p_network_token: networkClaim.networkToken,
}), 'mark normal request started')
const evidence = await ok(service.rpc('append_zatca_reporting_response_evidence_v2', {
  p_outbox_id: claimedOutbox.outboxId,
  p_outbox_token: claimedOutbox.outboxToken,
  p_network_token: networkClaim.networkToken,
  p_http_status: 200,
  p_reporting_status: 'REPORTED',
  p_validation_status: 'PASS',
  p_warning_codes: [],
  p_error_codes: [],
  p_outcome: 'accepted',
  p_safe_response: { reportingStatus: 'REPORTED', validationStatus: 'PASS' },
  p_safe_warnings: null,
  p_safe_reason: null,
}), 'append accepted response evidence')
await ok(service.rpc('apply_zatca_reporting_response_evidence_v2', {
  p_outbox_id: claimedOutbox.outboxId,
  p_outbox_token: claimedOutbox.outboxToken,
  p_network_token: networkClaim.networkToken,
  p_evidence_id: evidence.evidenceId,
}), 'apply accepted response evidence')
const reportedOriginal = await ok(
  service
    .from('invoices')
    .select('zatca_status,zatca_lifecycle_state')
    .eq('id', normalInvoiceId)
    .single(),
  'read reported original',
)
assert.equal(reportedOriginal.zatca_status, 'reported')
assert.equal(reportedOriginal.zatca_lifecycle_state, 'reported')

await ok(
  service
    .from('zatca_finalization_runtime')
    .update({
      immutable_finalization_enabled: false,
      simplified_enabled: false,
      standard_enabled: false,
      atomic_simplified_checkout_enabled: false,
    })
    .eq('singleton', true),
  'disable all rollout flags',
)
await ok(
  service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .update({ enabled: false })
    .eq('branch_id', ids.branchA),
  'disable branch gate',
)
const replayAfterDisable = await timed(
  'receipt_replay_ms',
  () => commit(branchUser, prepared),
)
assert.equal(replayAfterDisable.idempotentReplay, true)
assert.deepEqual(replayAfterDisable.receipt, committed.receipt)

const standardPayload = {
  branch_id: ids.branchA,
  customer_id: ids.businessCustomer,
  session_id: null,
  payment_method: 'card',
  items: [{ product_id: ids.serviceProduct, quantity: 1 }],
  idempotency_key: `legacy-standard-${randomUUID()}`,
}
await expectError(
  service.rpc('prepare_zatca_atomic_checkout_v2', {
    p_actor_user_id: branchUserId,
    p_document_type: 'invoice',
    p_payload: standardPayload,
    p_cart_fingerprint: fingerprint(standardPayload),
    p_ttl_seconds: 120,
  }),
  /BRANCH_SIMPLIFIED_ONLY|STANDARD_DOCUMENT_REQUIRES_CLEARANCE_FLOW/,
  'atomic standard rejection',
)
const rejectedStandardCounts = await Promise.all([
  rowCount(service.from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', ids.tenantA), 'count invoices before standard rejection'),
  rowCount(service.from('payments').select('id', { count: 'exact', head: true }).eq('tenant_id', ids.tenantA), 'count payments before standard rejection'),
  rowCount(service.from('invoice_items').select('id', { count: 'exact', head: true }).eq('tenant_id', ids.tenantA), 'count invoice items before standard rejection'),
])
await expectError(
  branchUser.rpc('pos_checkout', { p_payload: standardPayload }),
  /BRANCH_SIMPLIFIED_ONLY/,
  'branch standard checkout rejection',
)
assert.deepEqual(await Promise.all([
  rowCount(service.from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', ids.tenantA), 'count invoices after standard rejection'),
  rowCount(service.from('payments').select('id', { count: 'exact', head: true }).eq('tenant_id', ids.tenantA), 'count payments after standard rejection'),
  rowCount(service.from('invoice_items').select('id', { count: 'exact', head: true }).eq('tenant_id', ids.tenantA), 'count invoice items after standard rejection'),
]), rejectedStandardCounts)

await ok(
  service
    .from('zatca_finalization_runtime')
    .update({
      immutable_finalization_enabled: true,
      simplified_enabled: true,
      atomic_simplified_checkout_enabled: true,
    })
    .eq('singleton', true),
  'reenable disposable atomic flags',
)
await ok(
  service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .update({ enabled: true })
    .eq('branch_id', ids.branchA),
  'reenable disposable branch gate',
)

const missingArtifactPayload = {
  ...basePayload,
  items: [{ product_id: ids.product, quantity: 1 }],
  idempotency_key: `atomic-missing-artifact-${randomUUID()}`,
}
const missingArtifactPrepared = await prepare(branchUserId, missingArtifactPayload)
await expectError(
  branchUser.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: missingArtifactPrepared.intentId,
    p_claim_token: missingArtifactPrepared.claimToken,
  }),
  /ATOMIC_CHECKOUT_NOT_READY_TO_COMMIT/,
  'commit before artifact storage',
)
assert.deepEqual(await invoiceCounts(missingArtifactPrepared.snapshot.invoice_id), {
  invoice: 0,
  items: 0,
  payments: 0,
  movements: 0,
  outbox: 0,
  reservation: 0,
})
await expireIntent(missingArtifactPrepared.intentId)

const driftPayload = {
  ...basePayload,
  items: [{ product_id: ids.product, quantity: 1 }],
  idempotency_key: `atomic-drift-${randomUUID()}`,
}
const driftPrepared = await prepare(branchUserId, driftPayload)
await storeArtifact(driftPrepared, artifact('drift'))
await ok(
  service.from('products').update({ price: 101 }).eq('id', ids.product),
  'introduce price drift',
)
const stockBeforeDriftCommit = Number(
  (await ok(
    service.from('products').select('stock_quantity').eq('id', ids.product).single(),
    'stock before drift commit',
  )).stock_quantity,
)
await expectError(
  branchUser.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: driftPrepared.intentId,
    p_claim_token: driftPrepared.claimToken,
  }),
  /ATOMIC_CHECKOUT_SNAPSHOT_CHANGED/,
  'failure after successful stock validation',
)
assert.deepEqual(await invoiceCounts(driftPrepared.snapshot.invoice_id), {
  invoice: 0,
  items: 0,
  payments: 0,
  movements: 0,
  outbox: 0,
  reservation: 0,
})
const stockAfterDriftFailure = Number(
  (await ok(
    service.from('products').select('stock_quantity').eq('id', ids.product).single(),
    'stock after drift failure',
  )).stock_quantity,
)
assert.equal(stockAfterDriftFailure, stockBeforeDriftCommit)
await ok(service.from('products').update({ price: 100 }).eq('id', ids.product), 'restore price')
await expireIntent(driftPrepared.intentId)

const stockFailurePayload = {
  ...basePayload,
  items: [{ product_id: ids.product, quantity: 2 }],
  idempotency_key: `atomic-stock-failure-${randomUUID()}`,
}
const stockFailurePrepared = await prepare(branchUserId, stockFailurePayload)
await storeArtifact(stockFailurePrepared, artifact('stock-failure'))
await ok(service.from('products').update({ stock_quantity: 0 }).eq('id', ids.product), 'remove stock')
await expectError(
  branchUser.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: stockFailurePrepared.intentId,
    p_claim_token: stockFailurePrepared.claimToken,
  }),
  /Insufficient stock/,
  'stock validation failure',
)
assert.deepEqual(await invoiceCounts(stockFailurePrepared.snapshot.invoice_id), {
  invoice: 0,
  items: 0,
  payments: 0,
  movements: 0,
  outbox: 0,
  reservation: 0,
})
await ok(service.from('products').update({ stock_quantity: 48 }).eq('id', ids.product), 'restore stock')
await expireIntent(stockFailurePrepared.intentId)

await expectError(
  service.rpc('prepare_zatca_atomic_checkout_v2', {
    p_actor_user_id: branchUserId,
    p_document_type: 'invoice',
    p_payload: {
      ...basePayload,
      branch_id: ids.branchA2,
      idempotency_key: `wrong-branch-${randomUUID()}`,
    },
    p_cart_fingerprint: 'a'.repeat(64),
    p_ttl_seconds: 120,
  }),
  /(?:ATOMIC_)?CHECKOUT_BRANCH_FORBIDDEN/,
  'branch user other-branch preparation',
)
await expectError(
  service.rpc('prepare_zatca_atomic_checkout_v2', {
    p_actor_user_id: ownerAId,
    p_document_type: 'invoice',
    p_payload: {
      ...basePayload,
      branch_id: ids.branchB,
      idempotency_key: `wrong-tenant-${randomUUID()}`,
    },
    p_cart_fingerprint: 'b'.repeat(64),
    p_ttl_seconds: 120,
  }),
  /(?:ATOMIC_)?CHECKOUT_BRANCH_FORBIDDEN/,
  'cross-tenant preparation',
)

// Query the catalog directly for denied roles. PostgreSQL 17.6 can crash a
// disposable backend while PostgREST exercises this denied SECURITY DEFINER
// call, obscuring the ACL assertion with PGRST001 during crash recovery.
const preparePrivileges = execFileSync(
  'psql',
  [
    localEnv.DB_URL,
    '-Atc',
    `select has_function_privilege('anon',
       'public.prepare_zatca_atomic_checkout_v2(uuid,text,jsonb,text,integer)',
       'EXECUTE'),
     has_function_privilege('authenticated',
       'public.prepare_zatca_atomic_checkout_v2(uuid,text,jsonb,text,integer)',
       'EXECUTE')`,
  ],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
).trim()
assert.equal(preparePrivileges, 'f|f', 'browser roles must not execute atomic preparation')
for (const [client, label] of [[anon, 'anon'], [branchUser, 'authenticated']]) {
  await expectError(
    client.from('zatca_atomic_checkout_intents_v2').select('id,claim_token,candidate_signed_xml'),
    /permission denied|42501|401|403/i,
    `${label} private intent read`,
  )
  await expectError(
    client.from('zatca_reporting_response_evidence_v2').select('*'),
    /permission denied|42501|401|403/i,
    `${label} response evidence read`,
  )
}
await expectError(
  branchUser
    .from('invoices')
    .select('id,zatca_simplified_xml,zatca_simplified_signature')
    .eq('id', normalInvoiceId),
  /permission denied|42501|401|403/i,
  'authenticated raw invoice artifact read',
)

const contentionPayload1 = {
  ...basePayload,
  items: [{ product_id: ids.product, quantity: 1 }],
  idempotency_key: `atomic-contention-first-${randomUUID()}`,
}
const contentionPayload2 = {
  ...basePayload,
  items: [{ product_id: ids.product, quantity: 1 }],
  idempotency_key: `atomic-contention-second-${randomUUID()}`,
}
const contentionSql1 = `
  BEGIN;
  SELECT public.prepare_zatca_atomic_checkout_v2(
    '${branchUserId}'::uuid, 'invoice',
    '${JSON.stringify(contentionPayload1).replaceAll("'", "''")}'::jsonb,
    '${fingerprint(contentionPayload1)}', 120
  );
  SELECT pg_sleep(1.5);
  COMMIT;
`
const contentionSql2 = `
  SET statement_timeout = '5s';
  SELECT public.prepare_zatca_atomic_checkout_v2(
    '${branchUserId}'::uuid, 'invoice',
    '${JSON.stringify(contentionPayload2).replaceAll("'", "''")}'::jsonb,
    '${fingerprint(contentionPayload2)}', 120
  );
`
const contentionStarted = performance.now()
const firstSession = runPsql(contentionSql1)
await delay(120)
const secondStarted = performance.now()
const secondSession = runPsql(contentionSql2)
const [firstSessionResult, secondSessionResult] = await Promise.all([firstSession, secondSession])
timeline.push({
  event: 'session_1_prepare_and_hold',
  startedMs: 0,
  finishedMs: Number(firstSessionResult.durationMs.toFixed(2)),
  result: firstSessionResult.code === 0 ? 'prepared_then_committed' : 'failed',
})
timeline.push({
  event: 'session_2_prepare',
  startedMs: Number((secondStarted - contentionStarted).toFixed(2)),
  finishedMs: Number((secondStarted - contentionStarted + secondSessionResult.durationMs).toFixed(2)),
  result: secondSessionResult.code === 0 ? 'unexpected_success' : 'CHAIN_PREDECESSOR_PENDING',
})
assert.equal(firstSessionResult.code, 0, firstSessionResult.stderr)
assert.notEqual(secondSessionResult.code, 0, 'second contention session unexpectedly succeeded')
assert.match(secondSessionResult.stderr, /CHAIN_PREDECESSOR_PENDING/)
assert.ok(!/deadlock detected/i.test(secondSessionResult.stderr))
assert.ok(secondSessionResult.durationMs < 5_000, 'branch lock was not released safely')

const contentionFirstIntent = await ok(
  service
    .from('zatca_atomic_checkout_intents_v2')
    .select('id,invoice_id,zatca_counter_number,previous_hash,state')
    .eq('idempotency_key', contentionPayload1.idempotency_key)
    .single(),
  'read contention first intent',
)
assert.equal(contentionFirstIntent.state, 'prepared')
assert.equal(Number(contentionFirstIntent.zatca_counter_number), 2)
assert.equal(contentionFirstIntent.previous_hash, artifact('normal').hash)
await expireIntent(contentionFirstIntent.id)

const contentionRecovered = await prepare(branchUserId, contentionPayload2)
assert.equal(Number(contentionRecovered.snapshot.zatca_counter_number), 2)
assert.equal(contentionRecovered.snapshot.previous_hash, artifact('normal').hash)
const contentionArtifact = artifact('contention-recovered')
await storeArtifact(contentionRecovered, contentionArtifact)
const contentionCommitted = await commit(branchUser, contentionRecovered)
assert.equal(contentionCommitted.status, 'committed')
const headAfterContention = await ok(
  service
    .from('zatca_chain_heads_v2')
    .select('last_committed_counter,last_committed_hash')
    .eq('branch_id', ids.branchA)
    .single(),
  'read head after contention',
)
assert.equal(Number(headAfterContention.last_committed_counter), 2)
assert.equal(headAfterContention.last_committed_hash, contentionArtifact.hash)
assert.equal(
  await rowCount(
    service
      .from('zatca_chain_reservations_v2')
      .select('invoice_id', { count: 'exact', head: true })
      .eq('branch_id', ids.branchA)
      .eq('state', 'allocated'),
    'allocated reservations after contention',
  ),
  0,
)

const originalItem = await ok(
  service
    .from('invoice_items')
    .select('id,total')
    .eq('invoice_id', normalInvoiceId)
    .single(),
  'read original item for credit note',
)
const creditPayload = {
  original_invoice_id: normalInvoiceId,
  idempotency_key: `atomic-credit-${randomUUID()}`,
  reason: 'Disposable partial return',
  return_stock: true,
  items: [{ original_invoice_item_id: originalItem.id, quantity: 1 }],
  refund_allocations: [{ method: 'bank_transfer', amount: Number(originalItem.total) / 2 }],
}
const creditPrepared = await prepare(branchUserId, creditPayload, 'credit_note')
assert.equal(Number(creditPrepared.snapshot.zatca_counter_number), 3)
assert.equal(creditPrepared.snapshot.previous_hash, contentionArtifact.hash)
const creditArtifact = artifact('credit-note')
await storeArtifact(creditPrepared, creditArtifact)
const creditCommitted = await commit(branchUser, creditPrepared)
assert.equal(creditCommitted.status, 'committed')
const creditInvoice = await ok(
  service
    .from('invoices')
    .select('zatca_invoice_type,original_invoice_id,zatca_artifact_stage,zatca_counter_number,zatca_simplified_xml_hash')
    .eq('id', creditCommitted.invoiceId)
    .single(),
  'read committed credit note',
)
assert.equal(creditInvoice.zatca_invoice_type, 'credit_note')
assert.equal(creditInvoice.original_invoice_id, normalInvoiceId)
assert.equal(creditInvoice.zatca_artifact_stage, 'simplified_final')
assert.equal(Number(creditInvoice.zatca_counter_number), 3)
assert.equal(creditInvoice.zatca_simplified_xml_hash, creditArtifact.hash)
assert.deepEqual(await invoiceCounts(creditCommitted.invoiceId), {
  invoice: 1,
  items: 1,
  payments: 1,
  movements: 1,
  outbox: 1,
  reservation: 1,
})

const finalHead = await ok(
  service
    .from('zatca_chain_heads_v2')
    .select('last_committed_counter,last_committed_hash')
    .eq('branch_id', ids.branchA)
    .single(),
  'read final chain head',
)
assert.equal(Number(finalHead.last_committed_counter), 3)
assert.equal(finalHead.last_committed_hash, creditArtifact.hash)

const protectedIncidentCountBefore = await rowCount(
  service
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .in('invoice_number', ['INV-0826', 'INV-0827']),
  'read protected incident count before compatibility checks',
)

const sessionForBranch = new Map([
  [ids.branchA, ids.posSessionA],
  [ids.branchA2, ids.posSessionA2],
  [ids.branchB, ids.posSessionB],
  [ids.demoTradingBranch, ids.posSessionDemoTrading],
  [ids.demoServiceBranch, ids.posSessionDemoService],
])
const legacyCheckout = (client, branchId, productId, label) => ok(
  client.rpc('pos_checkout', {
    p_payload: {
      branch_id: branchId,
      customer_id: null,
      session_id: sessionForBranch.get(branchId),
      payment_method: 'card',
      items: [{ product_id: productId, quantity: 1 }],
      idempotency_key: `compat-${label}-${randomUUID()}`,
    },
  }),
  `legacy compatibility checkout ${label}`,
)

const branchOriginal = await legacyCheckout(
  branchUser,
  ids.branchA,
  ids.serviceProduct,
  'branch-same-branch',
)
const ownerOriginal = await legacyCheckout(
  branchUser,
  ids.branchA,
  ids.serviceProduct,
  'owner-same-tenant',
)
const adminOriginal = await legacyCheckout(
  branchUser,
  ids.branchA,
  ids.serviceProduct,
  'admin-same-tenant',
)
const otherBranchOriginal = await legacyCheckout(
  branchA2User,
  ids.branchA2,
  ids.branchA2ServiceProduct,
  'owner-other-same-tenant-branch',
)
const pendingOriginal = await legacyCheckout(
  branchUser,
  ids.branchA,
  ids.serviceProduct,
  'normal-pending-original',
)
const demoTradingOriginal = await legacyCheckout(
  demoTradingUser,
  ids.demoTradingBranch,
  ids.demoTradingProduct,
  'demo-trading-original',
)
const demoServiceOriginal = await legacyCheckout(
  demoServiceUser,
  ids.demoServiceBranch,
  ids.demoServiceProduct,
  'demo-service-original',
)

await expectError(
  branchUser.rpc('pos_checkout', {
    p_payload: {
      branch_id: ids.branchA2,
      customer_id: null,
      session_id: null,
      payment_method: 'card',
      items: [{ product_id: ids.branchA2ServiceProduct, quantity: 1 }],
      idempotency_key: `compat-branch-cross-branch-${randomUUID()}`,
    },
  }),
  /Forbidden|42501/,
  'branch checkout cross-branch rejection',
)
await expectError(
  ownerB.rpc('pos_checkout', {
    p_payload: {
      branch_id: ids.branchA,
      customer_id: null,
      session_id: null,
      payment_method: 'card',
      items: [{ product_id: ids.serviceProduct, quantity: 1 }],
      idempotency_key: `compat-owner-cross-tenant-${randomUUID()}`,
    },
  }),
  /Forbidden|42501/,
  'owner checkout cross-tenant rejection',
)
await expectError(
  adminA.rpc('pos_checkout', {
    p_payload: {
      branch_id: ids.branchB,
      customer_id: null,
      session_id: null,
      payment_method: 'card',
      items: [{ product_id: ids.serviceProduct, quantity: 1 }],
      idempotency_key: `compat-admin-cross-tenant-${randomUUID()}`,
    },
  }),
  /Forbidden|42501/,
  'admin checkout cross-tenant rejection',
)

await ok(
  service
    .from('invoices')
    .update({ zatca_status: 'reported' })
    .in('id', [
      branchOriginal.invoice_id,
      ownerOriginal.invoice_id,
      adminOriginal.invoice_id,
      otherBranchOriginal.invoice_id,
    ]),
  'mark compatibility originals reported',
)

const originalItemId = async (invoiceId, label) => {
  const item = await ok(
    service
      .from('invoice_items')
      .select('id')
      .eq('invoice_id', invoiceId)
      .single(),
    `read ${label} original item`,
  )
  return item.id
}
const partialCredit = async (client, original, label) => ok(
  client.rpc('create_partial_credit_note', {
    p_payload: {
      original_invoice_id: original.invoice_id,
      idempotency_key: `compat-credit-${label}-${randomUUID()}`,
      reason: `Compatibility ${label}`,
      refund_method: 'card',
      return_stock: false,
      items: [{
        original_invoice_item_id: await originalItemId(original.invoice_id, label),
        quantity: 1,
      }],
    },
  }),
  `partial credit ${label}`,
)

await expectError(
  branchUser.rpc('create_partial_credit_note', {
    p_payload: {
      original_invoice_id: otherBranchOriginal.invoice_id,
      idempotency_key: `compat-credit-branch-cross-branch-${randomUUID()}`,
      reason: 'Cross branch rejection',
      refund_method: 'card',
      return_stock: false,
      items: [{
        original_invoice_item_id: await originalItemId(
          otherBranchOriginal.invoice_id,
          'cross-branch',
        ),
        quantity: 1,
      }],
    },
  }),
  /Forbidden|42501/,
  'branch credit cross-branch rejection',
)
await expectError(
  ownerB.rpc('create_partial_credit_note', {
    p_payload: {
      original_invoice_id: ownerOriginal.invoice_id,
      idempotency_key: `compat-credit-owner-cross-tenant-${randomUUID()}`,
      reason: 'Cross tenant rejection',
      refund_method: 'card',
      return_stock: false,
      items: [{
        original_invoice_item_id: await originalItemId(
          ownerOriginal.invoice_id,
          'cross-tenant',
        ),
        quantity: 1,
      }],
    },
  }),
  /Forbidden|42501/,
  'owner credit cross-tenant rejection',
)

const branchCredit = await partialCredit(branchUser, branchOriginal, 'branch-same-branch')
const ownerCredit = await partialCredit(ownerA, ownerOriginal, 'owner-same-tenant')
const adminCredit = await partialCredit(adminA, adminOriginal, 'admin-same-tenant')
for (const result of [branchCredit, ownerCredit, adminCredit]) {
  assert.ok(result.credit_note_invoice_id)
}

await expectError(
  branchUser.rpc('create_partial_credit_note', {
    p_payload: {
      original_invoice_id: pendingOriginal.invoice_id,
      idempotency_key: `compat-credit-normal-pending-${randomUUID()}`,
      reason: 'Normal pending rejection',
      refund_method: 'card',
      return_stock: false,
      items: [{
        original_invoice_item_id: await originalItemId(
          pendingOriginal.invoice_id,
          'normal-pending',
        ),
        quantity: 1,
      }],
    },
  }),
  /Only reported, cleared, or successfully demo-submitted invoices can be credited|23514/,
  'normal production pending credit rejection',
)

const sandboxEvidenceTable = await runPsql(`
  CREATE TABLE IF NOT EXISTS public.zatca_sandbox_validation_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    invoice_id uuid NOT NULL UNIQUE,
    status text NOT NULL
  )
`)
assert.equal(
  sandboxEvidenceTable.code,
  0,
  `create disposable Sandbox evidence table: ${sandboxEvidenceTable.stderr}`,
)
const sandboxEvidenceInsert = await runPsql(`
  INSERT INTO public.zatca_sandbox_validation_attempts
    (tenant_id, branch_id, invoice_id, status)
  VALUES
    (
      '${ids.demoTenant}'::uuid,
      '${ids.demoTradingBranch}'::uuid,
      '${demoTradingOriginal.invoice_id}'::uuid,
      'sandbox_validated'
    ),
    (
      '${ids.demoTenant}'::uuid,
      '${ids.demoServiceBranch}'::uuid,
      '${demoServiceOriginal.invoice_id}'::uuid,
      'sandbox_validated_with_warnings'
    )
`)
assert.equal(
  sandboxEvidenceInsert.code,
  0,
  `insert disposable Sandbox evidence: ${sandboxEvidenceInsert.stderr}`,
)

const demoTradingCredit = await partialCredit(
  demoTradingUser,
  demoTradingOriginal,
  'demo-trading-sandbox-validated',
)
const demoServiceCredit = await partialCredit(
  demoServiceUser,
  demoServiceOriginal,
  'demo-service-sandbox-warning',
)
assert.ok(demoTradingCredit.credit_note_invoice_id)
assert.ok(demoServiceCredit.credit_note_invoice_id)

const headAfterCompatibilityChecks = await ok(
  service
    .from('zatca_chain_heads_v2')
    .select('last_committed_counter,last_committed_hash')
    .eq('branch_id', ids.branchA)
    .single(),
  'read chain head after compatibility checks',
)
assert.equal(Number(headAfterCompatibilityChecks.last_committed_counter), 3)
assert.equal(headAfterCompatibilityChecks.last_committed_hash, creditArtifact.hash)
assert.equal(
  await rowCount(
    service
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .in('invoice_number', ['INV-0826', 'INV-0827']),
    'read protected incident count after compatibility checks',
  ),
  protectedIncidentCountBefore,
)

await ok(
  service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .update({ enabled: false })
    .eq('branch_id', ids.branchA),
  'restore branch gate false',
)
await ok(
  service
    .from('zatca_finalization_runtime')
    .update({
      immutable_finalization_enabled: false,
      simplified_enabled: false,
      standard_enabled: false,
      atomic_simplified_checkout_enabled: false,
    })
    .eq('singleton', true),
  'restore all global flags false',
)
const finalRuntime = await ok(
  service
    .from('zatca_finalization_runtime')
    .select('immutable_finalization_enabled,simplified_enabled,standard_enabled,atomic_simplified_checkout_enabled')
    .eq('singleton', true)
    .single(),
  'read restored flags',
)
assert.deepEqual(finalRuntime, {
  immutable_finalization_enabled: false,
  simplified_enabled: false,
  standard_enabled: false,
  atomic_simplified_checkout_enabled: false,
})
const finalGate = await ok(
  service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .select('enabled')
    .eq('branch_id', ids.branchA)
    .single(),
  'read restored branch gate',
)
assert.equal(finalGate.enabled, false)

console.log(JSON.stringify({
  result: 'Atomic simplified checkout disposable runtime assertions passed',
  projectId,
  migrationVersion: '20260724000100',
  timingsMs: timings,
  contentionTimelineMs: timeline,
  assertions: {
    normalCommit: true,
    exactReplay: true,
    fingerprintMismatchRejected: true,
    failedTransactionsInvisible: true,
    expiredIntentCleanup: true,
    immutableMutationRejected: true,
    creditNoteCommit: true,
    standardPathUnchanged: true,
    actualRoleSecurity: true,
    commercialCompatibilityRoles: true,
    sandboxCreditException: true,
    protectedIncidentsUnchanged: true,
    posSessionRls: true,
    flagsRestoredFalse: true,
  },
}))
