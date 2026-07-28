import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const root = new URL('..', import.meta.url).pathname
const workdir = process.env.DAFRA_ATOMIC_TEST_WORKDIR
assert.match(
  workdir ?? '',
  /^\/(?:private\/)?tmp\/dafra-atomic-disposable\./,
  'A guarded disposable Supabase workdir is required',
)
const config = readFileSync(`${workdir}/supabase/config.toml`, 'utf8')
assert.match(config, /project_id = "dafra_atomic_disposable_/)
assert.doesNotMatch(config, /bkbphkpqcxuejozayrsy/)

const statusText = execFileSync(
  'supabase',
  ['status', '--workdir', workdir, '--output', 'env'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)
const local = Object.fromEntries(
  statusText
    .split(/\r?\n/)
    .map(line => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(match => [match[1], match[2].replace(/"$/, '')]),
)
for (const endpoint of [local.API_URL, local.DB_URL]) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(endpoint).hostname))
}

const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options)
const anon = createClient(local.API_URL, local.ANON_KEY, options)
const password = `Atomic-Phase2-${randomUUID()}!`
const run = randomUUID().replaceAll('-', '')
const ids = {
  tenantA: randomUUID(),
  tenantB: randomUUID(),
  plan: randomUUID(),
  simpleBranch: randomUUID(),
  standardBranch: randomUUID(),
  bothBranch: randomUUID(),
  fallbackBranch: randomUUID(),
  unsetBranch: randomUUID(),
  crossBranch: randomUUID(),
  simpleProduct: randomUUID(),
  standardProduct: randomUUID(),
  bothProduct: randomUUID(),
  fallbackProduct: randomUUID(),
  individual: randomUUID(),
  nonVatBusiness: randomUUID(),
  vatBusiness: randomUUID(),
  crossBranchCustomer: randomUUID(),
  crossTenantCustomer: randomUUID(),
}
const emails = {
  ownerA: `phase2-owner-a-${run}@example.test`,
  ownerB: `phase2-owner-b-${run}@example.test`,
  inactive: `phase2-inactive-${run}@example.test`,
}

async function ok(promise, label) {
  const result = await promise
  if (result.error) {
    throw new Error(`${label}: ${result.error.code ?? ''} ${result.error.message}`)
  }
  return result.data
}

async function expectError(promise, pattern, label) {
  const result = await promise
  assert.ok(result.error, `${label} unexpectedly succeeded`)
  assert.match(
    `${result.error.code ?? ''} ${result.error.message ?? ''} ${result.error.details ?? ''}`,
    pattern,
    label,
  )
}

async function createUser(email, role) {
  const data = await ok(
    service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role },
    }),
    `create ${role}`,
  )
  return data.user.id
}

async function login(email) {
  const client = createClient(local.API_URL, local.ANON_KEY, options)
  await ok(client.auth.signInWithPassword({ email, password }), `login ${email}`)
  return client
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    )
  }
  return value
}

function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex')
}

function artifact(label) {
  const xml = `<Invoice><ID>${label}</ID></Invoice>`
  return {
    xml,
    hash: createHash('sha256').update(xml).digest('base64'),
    signature: `disposable-signature-${label}`,
    qr: `disposable-qr-${label}`,
  }
}

async function classify(client, branchId, customerId = null) {
  return ok(client.rpc('resolve_pos_checkout_document_v1', {
    p_branch_id: branchId,
    p_customer_id: customerId,
  }), 'resolve document')
}

async function prepare(actorId, payload) {
  return ok(service.rpc('prepare_zatca_atomic_checkout_v2', {
    p_actor_user_id: actorId,
    p_document_type: 'invoice',
    p_payload: payload,
    p_cart_fingerprint: fingerprint(payload),
    p_ttl_seconds: 120,
  }), `prepare ${payload.idempotency_key}`)
}

async function storeArtifact(prepared, value) {
  const claim = await ok(service.rpc('claim_zatca_atomic_checkout_signing_v2', {
    p_intent_id: prepared.intentId,
    p_claim_token: prepared.claimToken,
    p_lease_seconds: 45,
  }), 'claim signing')
  assert.equal(claim.status, 'claimed')
  await ok(service.rpc('store_zatca_atomic_checkout_artifact_v2', {
    p_intent_id: prepared.intentId,
    p_claim_token: prepared.claimToken,
    p_signing_token: claim.signingToken,
    p_snapshot_hash: prepared.snapshotHash,
    p_signed_xml: value.xml,
    p_xml_hash: value.hash,
    p_signature: value.signature,
    p_qr: value.qr,
  }), 'store artifact')
}

async function commitAtomic(client, actorId, payload, label) {
  const prepared = await prepare(actorId, payload)
  const value = artifact(label)
  await storeArtifact(prepared, value)
  const committed = await ok(client.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: prepared.intentId,
    p_claim_token: prepared.claimToken,
  }), `commit ${label}`)
  assert.equal(committed.status, 'committed')
  assert.equal(committed.receipt.can_print, true)
  assert.equal(committed.receipt.qr_code, value.qr)
  return { prepared, committed, value }
}

async function count(table, column, value) {
  const result = await service
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
  assert.equal(result.error, null)
  return result.count
}

async function connectBranch(branchId, ownerId, map) {
  await ok(service.from('zatca_production_credentials').insert({
    tenant_id: ids.tenantA,
    branch_id: branchId,
    environment: 'production',
    egs_serial_number: `DISPOSABLE-${branchId}`,
    functionality_map: map,
    onboarding_status: 'production_connected',
    encrypted_production_csid: 'disposable-csid',
    encrypted_production_secret: 'disposable-secret',
    created_by: ownerId,
    updated_by: ownerId,
  }), `connect ${map}`)
}

async function makeAtomicReady(branchId, ownerId, runtime) {
  await ok(service.rpc('initialize_zatca_new_branch_chain_v2', {
    p_branch_id: branchId,
    p_reason: 'Disposable new compliance unit',
    p_approved_by: ownerId,
  }), 'initialize chain')
  await ok(service.rpc('approve_zatca_branch_readiness_v2', {
    p_branch_id: branchId,
    p_source: 'production_onboarding',
    p_reason: 'Disposable production onboarding complete',
    p_approved_by: ownerId,
  }), 'approve readiness')
  const acknowledgement = await ok(
    service.rpc('acknowledge_zatca_client_capability_v2', {
      p_user_id: ownerId,
      p_branch_id: branchId,
      p_client_version: runtime.minimum_client_version,
      p_edge_version: runtime.minimum_edge_version,
      p_ttl_seconds: 600,
    }),
    'acknowledge client',
  )
  assert.equal(acknowledgement.acknowledged, true)
  const sync = await ok(service.rpc('sync_zatca_atomic_checkout_branch_gates_v2', {
    p_branch_id: branchId,
    p_actor_user_id: ownerId,
  }), 'sync atomic gate')
  assert.equal(sync[0].resulting_gate_state, true)
}

const ownerAId = await createUser(emails.ownerA, 'owner')
const ownerBId = await createUser(emails.ownerB, 'owner')
const inactiveId = await createUser(emails.inactive, 'owner')
const ownerA = await login(emails.ownerA)
const ownerB = await login(emails.ownerB)
const inactive = await login(emails.inactive)

await ok(service.from('subscription_plans').insert({
  id: ids.plan,
  name: 'Disposable Phase 2',
  max_branches: 20,
  is_active: true,
}), 'insert plan')
await ok(service.from('tenants').insert([
  { id: ids.tenantA, name: 'Phase 2 Tenant A', vat_number: `TA-${run.slice(0, 12)}`, city: 'Riyadh', business_type: 'trading', max_branches: 20 },
  { id: ids.tenantB, name: 'Phase 2 Tenant B', vat_number: `TB-${run.slice(0, 12)}`, city: 'Jeddah', business_type: 'trading', max_branches: 20 },
]), 'insert tenants')
await ok(service.from('tenant_subscriptions').insert([
  { tenant_id: ids.tenantA, plan_id: ids.plan, status: 'active', paid_branch_count: 20 },
  { tenant_id: ids.tenantB, plan_id: ids.plan, status: 'active', paid_branch_count: 20 },
]), 'insert subscriptions')
await ok(service.from('user_profiles').upsert([
  { id: ownerAId, tenant_id: ids.tenantA, role: 'owner', full_name: 'Owner A', email: emails.ownerA, is_active: true },
  { id: ownerBId, tenant_id: ids.tenantB, role: 'owner', full_name: 'Owner B', email: emails.ownerB, is_active: true },
  { id: inactiveId, tenant_id: ids.tenantA, role: 'owner', full_name: 'Inactive', email: emails.inactive, is_active: false },
]), 'insert profiles')

// Actual first-branch and additional-owner provisioning paths both exercise the
// new AFTER INSERT provisioning contract.
const first = await ok(service.rpc('prepare_first_branch_provisioning', {
  p_owner_id: ownerAId,
  p_branch_payload: {
    name: 'First Provisioned Branch',
    zatca_phase: 2,
    vat_number: '300000000000003',
  },
}), 'prepare first branch')
const firstBranchId = first[0].branch_id
const additional = await ok(ownerA.rpc('create_branch_for_tenant', {
  p_payload: {
    name: 'Additional Provisioned Branch',
    zatca_phase: 2,
    is_active: true,
  },
}), 'create additional branch')
const additionalBranchId = additional.id

for (const branchId of [firstBranchId, additionalBranchId]) {
  const gate = await ok(service
    .from('zatca_atomic_checkout_branch_gates_v2')
    .select('enabled')
    .eq('branch_id', branchId)
    .single(), 'read provisioned gate')
  const readiness = await ok(service
    .from('zatca_branch_readiness_v2')
    .select('readiness_status,readiness_source,reason')
    .eq('branch_id', branchId)
    .single(), 'read provisioned readiness')
  assert.equal(gate.enabled, false)
  assert.deepEqual(readiness, {
    readiness_status: 'blocked',
    readiness_source: 'operator_block',
    reason: 'awaiting_production_onboarding',
  })
}

await connectBranch(firstBranchId, ownerAId, '1100')
await ok(service.from('zatca_production_credentials')
  .update({ onboarding_status: 'disconnected' })
  .eq('branch_id', firstBranchId)
  .eq('environment', 'production'), 'mark first branch disconnected')
assert.equal(
  (await classify(ownerA, firstBranchId)).code,
  'ZATCA_CONNECTION_REQUIRED',
)

await ok(service.from('branches').insert([
  { id: ids.simpleBranch, tenant_id: ids.tenantA, name: 'Simplified Branch', branch_code: 'P2-S', zatca_phase: 2, vat_number: '300000000000003', cr_number: '1010000001', building_number: '1', street: 'Street', district: 'District', city: 'Riyadh', postal_code: '12345', allow_split_payments: true },
  { id: ids.standardBranch, tenant_id: ids.tenantA, name: 'Standard Branch', branch_code: 'P2-T', zatca_phase: 2, vat_number: '300000000000003', allow_split_payments: false },
  { id: ids.bothBranch, tenant_id: ids.tenantA, name: 'Both Branch', branch_code: 'P2-B', zatca_phase: 2, vat_number: '300000000000003', cr_number: '1010000002', building_number: '2', street: 'Street', district: 'District', city: 'Riyadh', postal_code: '12345', allow_split_payments: true },
  { id: ids.fallbackBranch, tenant_id: ids.tenantA, name: 'Legacy Fallback Branch', branch_code: 'P2-F', zatca_phase: 2, vat_number: '300000000000003', allow_split_payments: false },
  { id: ids.unsetBranch, tenant_id: ids.tenantA, name: 'Unset Branch', branch_code: 'P2-U', zatca_phase: 2, allow_split_payments: false },
  { id: ids.crossBranch, tenant_id: ids.tenantB, name: 'Cross Branch', branch_code: 'P2-X', zatca_phase: 2, allow_split_payments: false },
]), 'insert matrix branches')

await Promise.all([
  connectBranch(ids.simpleBranch, ownerAId, '0100'),
  connectBranch(ids.standardBranch, ownerAId, '1000'),
  connectBranch(ids.bothBranch, ownerAId, '1100'),
  connectBranch(ids.fallbackBranch, ownerAId, '0100'),
])

await ok(service.from('products').insert([
  { id: ids.simpleProduct, tenant_id: ids.tenantA, branch_id: ids.simpleBranch, name: 'Simple Stock', sku: 'P2-S', price: 100, tax_rate: 15, tax_category: 'S', is_taxable: true, vat_treatment: 'exclusive', stock_quantity: 50, track_stock: true, is_service: false, is_active: true, is_available: true },
  { id: ids.standardProduct, tenant_id: ids.tenantA, branch_id: ids.standardBranch, name: 'Standard Stock', sku: 'P2-T', price: 80, tax_rate: 15, tax_category: 'S', is_taxable: true, vat_treatment: 'exclusive', stock_quantity: 20, track_stock: true, is_service: false, is_active: true, is_available: true },
  { id: ids.bothProduct, tenant_id: ids.tenantA, branch_id: ids.bothBranch, name: 'Both Stock', sku: 'P2-B', price: 60, tax_rate: 15, tax_category: 'S', is_taxable: true, vat_treatment: 'exclusive', stock_quantity: 100, track_stock: true, is_service: false, is_active: true, is_available: true },
  { id: ids.fallbackProduct, tenant_id: ids.tenantA, branch_id: ids.fallbackBranch, name: 'Fallback Stock', sku: 'P2-F', price: 40, tax_rate: 15, tax_category: 'S', is_taxable: true, vat_treatment: 'exclusive', stock_quantity: 10, track_stock: true, is_service: false, is_active: true, is_available: true },
]), 'insert products')
await ok(service.from('customers').insert([
  { id: ids.individual, tenant_id: ids.tenantA, branch_id: ids.bothBranch, name: 'Individual', customer_type: 'individual', is_active: true },
  { id: ids.nonVatBusiness, tenant_id: ids.tenantA, branch_id: ids.bothBranch, name: 'Non VAT Business', business_name: 'Non VAT Business', customer_type: 'business', is_active: true },
  { id: ids.vatBusiness, tenant_id: ids.tenantA, branch_id: ids.standardBranch, name: 'VAT Business', business_name: 'VAT Business', customer_type: 'business', vat_number: '300000000000023', is_active: true },
  { id: ids.crossBranchCustomer, tenant_id: ids.tenantA, branch_id: ids.simpleBranch, name: 'Other Branch Customer', customer_type: 'individual', is_active: true },
  { id: ids.crossTenantCustomer, tenant_id: ids.tenantB, branch_id: ids.crossBranch, name: 'Other Tenant Customer', customer_type: 'individual', is_active: true },
]), 'insert customers')

// Capability matrix before atomic enablement.
assert.equal((await classify(ownerA, ids.simpleBranch)).documentType, 'simplified')
const simpleVatCustomer = randomUUID()
await ok(service.from('customers').insert({
  id: simpleVatCustomer,
  tenant_id: ids.tenantA,
  branch_id: ids.simpleBranch,
  name: 'Simple VAT Business',
  business_name: 'Simple VAT Business',
  customer_type: 'business',
  vat_number: '300000000000033',
  is_active: true,
}), 'insert simple VAT customer')
assert.equal((await classify(ownerA, ids.simpleBranch, simpleVatCustomer)).code, 'BRANCH_SIMPLIFIED_ONLY')
assert.equal((await classify(ownerA, ids.standardBranch)).code, 'BRANCH_STANDARD_ONLY')
assert.deepEqual(
  {
    status: (await classify(ownerA, ids.standardBranch, ids.vatBusiness)).status,
    documentType: (await classify(ownerA, ids.standardBranch, ids.vatBusiness)).documentType,
    checkoutPath: (await classify(ownerA, ids.standardBranch, ids.vatBusiness)).checkoutPath,
  },
  { status: 'allowed', documentType: 'standard', checkoutPath: 'legacy' },
)
assert.equal((await classify(ownerA, ids.unsetBranch)).code, 'INVOICE_CAPABILITY_NOT_CONFIGURED')
await ok(service.rpc('initialize_zatca_new_branch_chain_v2', {
  p_branch_id: ids.fallbackBranch,
  p_reason: 'Disposable fallback compliance unit',
  p_approved_by: ownerAId,
}), 'initialize fallback chain')
await ok(service.rpc('approve_zatca_branch_readiness_v2', {
  p_branch_id: ids.fallbackBranch,
  p_source: 'production_onboarding',
  p_reason: 'Disposable fallback readiness',
  p_approved_by: ownerAId,
}), 'approve fallback readiness')
const legacySimplifiedFallback = await ok(ownerA.rpc('pos_checkout', {
  p_payload: {
    branch_id: ids.fallbackBranch,
    customer_id: null,
    session_id: null,
    payment_method: 'card',
    items: [{ product_id: ids.fallbackProduct, quantity: 1 }],
    idempotency_key: `legacy-simplified-${randomUUID()}`,
  },
}), 'explicit legacy Simplified fallback')
assert.equal(legacySimplifiedFallback.zatca_invoice_type, 'simplified')
assert.equal(legacySimplifiedFallback.checkout_path, 'legacy')

const runtime = await ok(service
  .from('zatca_finalization_runtime')
  .select('minimum_client_version,minimum_edge_version')
  .eq('singleton', true)
  .single(), 'read runtime')
await ok(service.from('zatca_finalization_runtime').update({
  immutable_finalization_enabled: true,
  simplified_enabled: true,
  standard_enabled: false,
  atomic_simplified_checkout_enabled: true,
}).eq('singleton', true), 'enable disposable atomic runtime')
await makeAtomicReady(ids.bothBranch, ownerAId, runtime)
await makeAtomicReady(ids.simpleBranch, ownerAId, runtime)

const bothWalkIn = await classify(ownerA, ids.bothBranch)
assert.equal(bothWalkIn.documentType, 'simplified')
assert.equal(bothWalkIn.checkoutPath, 'atomic')
assert.equal((await classify(ownerA, ids.bothBranch, ids.individual)).checkoutPath, 'atomic')
const nonVatDecision = await classify(ownerA, ids.bothBranch, ids.nonVatBusiness)
assert.equal(nonVatDecision.documentType, 'simplified')
assert.equal(nonVatDecision.classificationReason, 'business_without_qualifying_vat')
const bothVatCustomer = randomUUID()
await ok(service.from('customers').insert({
  id: bothVatCustomer,
  tenant_id: ids.tenantA,
  branch_id: ids.bothBranch,
  name: 'Both VAT Business',
  business_name: 'Both VAT Business',
  customer_type: 'business',
  vat_number: '300000000000043',
  is_active: true,
}), 'insert both VAT customer')
assert.equal((await classify(ownerA, ids.bothBranch, bothVatCustomer)).documentType, 'standard')

const base = {
  branch_id: ids.bothBranch,
  customer_id: null,
  session_id: null,
  items: [{ product_id: ids.bothProduct, quantity: 1 }],
}
const cashPayload = { ...base, payment_method: 'cash', amount_paid: 100, idempotency_key: `cash-${randomUUID()}` }
const cardPayload = { ...base, payment_method: 'card', idempotency_key: `card-${randomUUID()}` }
const splitPayload = { ...base, payment_method: 'other', payments: [{ method: 'cash', amount: 34.5 }, { method: 'card', amount: 34.5 }], idempotency_key: `split-${randomUUID()}` }
const customerPayload = { ...base, customer_id: ids.individual, payment_method: 'card', idempotency_key: `customer-${randomUUID()}` }

const cash = await commitAtomic(ownerA, ownerAId, cashPayload, 'cash')
const card = await commitAtomic(ownerA, ownerAId, cardPayload, 'card')
const split = await commitAtomic(ownerA, ownerAId, splitPayload, 'split')
const customer = await commitAtomic(ownerA, ownerAId, customerPayload, 'customer')
assert.equal(split.committed.receipt.payments.length, 2)
assert.equal(customer.committed.receipt.customer.id, ids.individual)

// Lost response and duplicate replay return the same committed invoice.
const replay = await prepare(ownerAId, cardPayload)
assert.equal(replay.status, 'committed')
assert.equal(replay.invoiceId, card.committed.invoiceId)
await expectError(service.rpc('prepare_zatca_atomic_checkout_v2', {
  p_actor_user_id: ownerAId,
  p_document_type: 'invoice',
  p_payload: { ...cardPayload, items: [{ product_id: ids.bothProduct, quantity: 2 }] },
  p_cart_fingerprint: 'f'.repeat(64),
  p_ttl_seconds: 120,
}), /IDEMPOTENCY_FINGERPRINT_MISMATCH/, 'conflicting replay')

const duplicatePayload = { ...base, payment_method: 'card', idempotency_key: `duplicate-${randomUUID()}` }
const duplicatePrepared = await prepare(ownerAId, duplicatePayload)
await storeArtifact(duplicatePrepared, artifact('duplicate'))
const duplicateResults = await Promise.all([
  ownerA.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: duplicatePrepared.intentId,
    p_claim_token: duplicatePrepared.claimToken,
  }),
  ownerA.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: duplicatePrepared.intentId,
    p_claim_token: duplicatePrepared.claimToken,
  }),
])
assert.ok(duplicateResults.every(result => result.error === null))
assert.equal(duplicateResults[0].data.invoiceId, duplicateResults[1].data.invoiceId)
assert.equal(await count('invoices', 'id', duplicateResults[0].data.invoiceId), 1)
assert.equal(await count('payments', 'invoice_id', duplicateResults[0].data.invoiceId), 1)

const failurePayload = { ...base, payment_method: 'card', items: [{ product_id: ids.bothProduct, quantity: 5 }], idempotency_key: `stock-failure-${randomUUID()}` }
const failurePrepared = await prepare(ownerAId, failurePayload)
await storeArtifact(failurePrepared, artifact('stock-failure'))
await ok(service.from('products').update({ stock_quantity: 0 }).eq('id', ids.bothProduct), 'exhaust stock')
await expectError(ownerA.rpc('commit_zatca_atomic_checkout_v2', {
  p_intent_id: failurePrepared.intentId,
  p_claim_token: failurePrepared.claimToken,
}), /Insufficient stock/, 'stock failure rollback')
assert.equal(await count('invoices', 'id', failurePrepared.snapshot.invoice_id), 0)
assert.equal(await count('payments', 'invoice_id', failurePrepared.snapshot.invoice_id), 0)
await ok(service.from('products').update({ stock_quantity: 94 }).eq('id', ids.bothProduct), 'restore stock')

// Reporting rejection occurs after commit and never removes print availability.
const claimedOutbox = await ok(service.rpc('claim_zatca_reporting_outbox_v2', {
  p_claimed_by: 'phase2-runtime',
  p_lease_seconds: 120,
  p_invoice_id: cash.committed.invoiceId,
}), 'claim outbox')
const network = await ok(service.rpc('claim_zatca_network_v2', {
  p_invoice_id: cash.committed.invoiceId,
  p_claimed_by: 'phase2-runtime',
  p_lease_seconds: 120,
}), 'claim reporting network')
await ok(service.rpc('mark_zatca_network_request_started_v2', {
  p_invoice_id: cash.committed.invoiceId,
  p_network_token: network.networkToken,
}), 'mark reporting started')
const evidence = await ok(service.rpc('append_zatca_reporting_response_evidence_v2', {
  p_outbox_id: claimedOutbox.outboxId,
  p_outbox_token: claimedOutbox.outboxToken,
  p_network_token: network.networkToken,
  p_http_status: 400,
  p_reporting_status: 'REJECTED',
  p_validation_status: 'ERROR',
  p_warning_codes: [],
  p_error_codes: ['DISPOSABLE_REJECTION'],
  p_outcome: 'definite_rejection',
  p_safe_response: { reportingStatus: 'REJECTED' },
  p_safe_warnings: null,
  p_safe_reason: 'Disposable rejection',
}), 'append rejection evidence')
await ok(service.rpc('apply_zatca_reporting_response_evidence_v2', {
  p_outbox_id: claimedOutbox.outboxId,
  p_outbox_token: claimedOutbox.outboxToken,
  p_network_token: network.networkToken,
  p_evidence_id: evidence.evidenceId,
}), 'apply rejection evidence')
const rejectedOutput = await ok(service.rpc('get_zatca_output_state_v2', {
  p_invoice_id: cash.committed.invoiceId,
  p_tenant_id: ids.tenantA,
}), 'read rejected atomic output')
assert.equal(rejectedOutput.canPrint, true)
assert.equal(rejectedOutput.qrCode, cash.value.qr)

// Standard legacy checkout, retry, rejection/timeout, and clearance-gated print.
const standardPayload = {
  branch_id: ids.standardBranch,
  customer_id: ids.vatBusiness,
  session_id: null,
  payment_method: 'card',
  items: [{ product_id: ids.standardProduct, quantity: 2 }],
  idempotency_key: `standard-${randomUUID()}`,
}
const standardCheckout = await ok(ownerA.rpc('pos_checkout', {
  p_payload: standardPayload,
}), 'standard legacy checkout')
assert.equal(standardCheckout.zatca_invoice_type, 'standard')
assert.equal(standardCheckout.checkout_path, 'legacy')
const stockAfterStandard = await ok(service.from('products')
  .select('stock_quantity')
  .eq('id', ids.standardProduct)
  .single(), 'read standard stock')
const standardReplay = await ok(ownerA.rpc('pos_checkout', {
  p_payload: standardPayload,
}), 'standard replay')
assert.equal(standardReplay.invoice_id, standardCheckout.invoice_id)
assert.equal((await ok(service.from('products').select('stock_quantity').eq('id', ids.standardProduct).single(), 'read replay stock')).stock_quantity, stockAfterStandard.stock_quantity)
assert.equal(await count('invoices', 'id', standardCheckout.invoice_id), 1)
assert.equal(await count('payments', 'invoice_id', standardCheckout.invoice_id), 1)
const pendingStandard = await ok(service.rpc('get_zatca_output_state_v2', {
  p_invoice_id: standardCheckout.invoice_id,
  p_tenant_id: ids.tenantA,
}), 'read pending standard')
assert.equal(pendingStandard.invoiceStatus, 'pending')
assert.equal(pendingStandard.canPrint, false)
assert.equal(pendingStandard.retryAvailable, true)

// Disposable-only fixtures represent timeout, rejection and validated
// clearance responses that the production Edge function would persist. No
// production or external ZATCA call is made. The initial pending state above is
// the timeout contract: no customer copy, retryable, and the same local invoice.
const retryAfterTimeout = await ok(ownerA.rpc('pos_checkout', {
  p_payload: standardPayload,
}), 'standard retry after timeout')
assert.equal(retryAfterTimeout.invoice_id, standardCheckout.invoice_id)
execFileSync('psql', [local.DB_URL, '-v', 'ON_ERROR_STOP=1', '-c', `
  BEGIN;
  SET LOCAL session_replication_role = replica;
  UPDATE public.invoices
  SET zatca_status = 'failed',
      zatca_clearance_status = 'REJECTED',
      zatca_clearance_response = '{"status":"REJECTED","source":"disposable"}'::jsonb
  WHERE id = '${standardCheckout.invoice_id}'::uuid;
  COMMIT;
`], { stdio: ['ignore', 'pipe', 'pipe'] })
const rejectedStandard = await ok(service.rpc('get_zatca_output_state_v2', {
  p_invoice_id: standardCheckout.invoice_id,
  p_tenant_id: ids.tenantA,
}), 'read rejected standard')
assert.equal(rejectedStandard.invoiceStatus, 'failed')
assert.equal(rejectedStandard.canPrint, false)
assert.equal(rejectedStandard.retryAvailable, true)
const retryAfterRejection = await ok(ownerA.rpc('pos_checkout', {
  p_payload: standardPayload,
}), 'standard retry after rejection')
assert.equal(retryAfterRejection.invoice_id, standardCheckout.invoice_id)
assert.equal(await count('invoices', 'id', standardCheckout.invoice_id), 1)
assert.equal(await count('payments', 'invoice_id', standardCheckout.invoice_id), 1)
assert.equal(
  (await ok(service.from('products')
    .select('stock_quantity')
    .eq('id', ids.standardProduct)
    .single(), 'read standard retry stock')).stock_quantity,
  stockAfterStandard.stock_quantity,
)

execFileSync('psql', [local.DB_URL, '-v', 'ON_ERROR_STOP=1', '-c', `
  BEGIN;
  SET LOCAL session_replication_role = replica;
  UPDATE public.invoices
  SET zatca_status = 'cleared',
      zatca_qr_code = 'disposable-cleared-standard-qr',
      zatca_clearance_status = 'CLEARED'
  WHERE id = '${standardCheckout.invoice_id}'::uuid;
  COMMIT;
`], { stdio: ['ignore', 'pipe', 'pipe'] })
const clearedStandard = await ok(service.rpc('get_zatca_output_state_v2', {
  p_invoice_id: standardCheckout.invoice_id,
  p_tenant_id: ids.tenantA,
}), 'read cleared standard')
assert.equal(clearedStandard.canPrint, true)
assert.equal(clearedStandard.qrCode, 'disposable-cleared-standard-qr')

// Capability/security blocking is pre-mutation.
const beforeBlocked = await count('invoices', 'branch_id', ids.simpleBranch)
await expectError(ownerA.rpc('pos_checkout', {
  p_payload: {
    branch_id: ids.simpleBranch,
    customer_id: simpleVatCustomer,
    payment_method: 'card',
    items: [{ product_id: ids.simpleProduct, quantity: 1 }],
    idempotency_key: `blocked-simple-${randomUUID()}`,
  },
}), /BRANCH_SIMPLIFIED_ONLY/, '0100 standard blocked')
assert.equal(await count('invoices', 'branch_id', ids.simpleBranch), beforeBlocked)
assert.equal((await classify(ownerA, ids.bothBranch, ids.crossBranchCustomer)).code, 'CHECKOUT_CUSTOMER_NOT_AVAILABLE')
assert.equal((await classify(ownerA, ids.bothBranch, ids.crossTenantCustomer)).code, 'CHECKOUT_CUSTOMER_NOT_AVAILABLE')
assert.equal((await classify(ownerB, ids.bothBranch)).code, 'CHECKOUT_BRANCH_FORBIDDEN')
assert.equal((await classify(inactive, ids.bothBranch)).code, 'CHECKOUT_PROFILE_NOT_ACTIVE')
await expectError(anon.rpc('resolve_pos_checkout_document_v1', {
  p_branch_id: ids.bothBranch,
  p_customer_id: null,
}), /permission denied|42501|401|403/i, 'anonymous classification')
const beforePathOverride = await count('invoices', 'branch_id', ids.bothBranch)
await expectError(ownerA.rpc('pos_checkout', {
  p_payload: {
    ...base,
    payment_method: 'card',
    document_type: 'standard',
    invoice_capability: '1000',
    checkout_path: 'legacy',
    idempotency_key: `override-${randomUUID()}`,
  },
}), /ATOMIC_CHECKOUT_REQUIRED/, 'browser path override blocked')
assert.equal(await count('invoices', 'branch_id', ids.bothBranch), beforePathOverride)
const ignoredClassificationOverride = await ok(ownerA.rpc('pos_checkout', {
  p_payload: {
    ...standardPayload,
    document_type: 'simplified',
    invoice_capability: '0100',
    checkout_path: 'atomic',
    items: [{ product_id: ids.standardProduct, quantity: 1 }],
    idempotency_key: `classification-override-${randomUUID()}`,
  },
}), 'browser classification override ignored')
assert.equal(ignoredClassificationOverride.zatca_invoice_type, 'standard')
assert.equal(ignoredClassificationOverride.document_decision, 'standard')
assert.equal(ignoredClassificationOverride.checkout_path, 'legacy')

console.log(JSON.stringify({
  firstBranchProvisionedDisabled: true,
  additionalBranchProvisionedDisabled: true,
  capabilityMatrix: 'passed',
  explicitLegacySimplifiedFallback: 'passed',
  atomicCashCardSplitCustomer: 'passed',
  atomicLostResponseReplayConflict: 'passed',
  atomicStockAndConcurrentDuplicateSafety: 'passed',
  atomicReportingRejectionPrint: 'passed',
  legacyStandardTimeoutRejectionClearanceAndRetry: 'passed',
  browserPathOverrideBlocked: 'passed',
  securityBoundaries: 'passed',
  atomicInvoiceIds: [
    cash.committed.invoiceId,
    card.committed.invoiceId,
    split.committed.invoiceId,
    customer.committed.invoiceId,
  ].length,
}, null, 2))
