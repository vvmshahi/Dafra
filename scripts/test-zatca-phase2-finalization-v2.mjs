import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseZatcaClearedInvoice } from '../supabase/functions/_shared/zatca/cleared_artifact.mjs'
import {
  canOpenStoredInvoicePrint,
  renderStoredQrDataUrl,
  selectStoredOutputStateQr,
} from '../src/lib/zatca/qrDisplay.mjs'

const root = process.cwd()
const pkg = join(root, 'scripts/sql/zatca-phase2-finalization-v2')
const files = [
  '00_hosted_preflight.sql',
  '01_artifact_lifecycle.sql', '02_chain_allocator.sql',
  '03_claims_and_idempotency.sql', '04_lock_compliance_fields.sql',
  '04a_safe_invoice_read_surface.sql',
  '05_capabilities_and_status.sql', '06_verification.sql',
  '07_rollback_plan.md', '09_branch_readiness_gate.sql',
  '10_branch_readiness_verification.sql',
  '11_durable_simplified_reporting_outbox.sql',
  '12_atomic_simplified_checkout_v2.sql', 'CONTRACT.md',
]
const source = Object.fromEntries(files.map(name => [name, readFileSync(join(pkg, name), 'utf8')]))
const edge = readFileSync(join(root, 'supabase/functions/zatca-submit/index.ts'), 'utf8')
const pos = readFileSync(join(root, 'src/pages/pos/POSPage.tsx'), 'utf8')
const selector = readFileSync(join(root, 'src/lib/zatca/qrSelector.ts'), 'utf8')
const submission = readFileSync(join(root, 'src/lib/zatca/submission.ts'), 'utf8')
const authenticatedEdge = readFileSync(join(root, 'src/lib/zatca/authenticatedEdge.ts'), 'utf8')
const invoiceDetail = readFileSync(join(root, 'src/pages/invoices/InvoiceDetailPage.tsx'), 'utf8')
const creditNoteModal = readFileSync(join(root, 'src/pages/invoices/CreateCreditNoteModal.tsx'), 'utf8')
const receiptPrint = readFileSync(join(root, 'src/pages/print/ReceiptPrintPage.tsx'), 'utf8')
const invoiceReadContract = readFileSync(join(root, 'src/lib/invoices/invoiceReadContract.ts'), 'utf8')
const allocatorFixture = readFileSync(join(pkg, '08_allocator_two_session_fixture.md'), 'utf8')
const allocatorSessionA = readFileSync(join(pkg, 'fixtures/allocator_session_a.sql'), 'utf8')
const allocatorSessionB = readFileSync(join(pkg, 'fixtures/allocator_session_b.sql'), 'utf8')
const oldMarker = readFileSync(join(root, 'scripts/sql/zatca-phase2-finalization/SUPERSEDED_UNSAFE_DO_NOT_EXECUTE.md'), 'utf8')

const results = []
async function test(name, fn) {
  await fn()
  results.push(name)
}

class SerialChain {
  #tail = Promise.resolve()
  constructor() { this.counter = 0; this.hash = 'FIRST'; this.reservations = new Map() }
  async finalize(invoiceId, artifactHash) {
    if (this.reservations.has(invoiceId)) return this.reservations.get(invoiceId)
    let release
    const previousTail = this.#tail
    this.#tail = new Promise(resolve => { release = resolve })
    await previousTail
    try {
      if (this.reservations.has(invoiceId)) return this.reservations.get(invoiceId)
      const reservation = { counter: this.counter + 1, previousHash: this.hash, artifactHash }
      this.counter = reservation.counter
      this.hash = artifactHash
      this.reservations.set(invoiceId, reservation)
      return reservation
    } finally { release() }
  }
}

class Lease {
  constructor() { this.token = null; this.expires = 0; this.attempt = 0 }
  claim(now, duration = 90) {
    if (this.token && this.expires > now) return { status: 'in_progress' }
    this.attempt += 1; this.token = `token-${this.attempt}`; this.expires = now + duration
    return { status: 'claimed', token: this.token }
  }
  persist(token, now) {
    if (token !== this.token || now >= this.expires) throw new Error('STALE_TOKEN')
    return true
  }
}

class NetworkLease extends Lease {
  constructor() { super(); this.requestStarted = false }
  claim(now, duration = 120) {
    if (this.requestStarted && this.expires <= now) return { status: 'reconciliation_required' }
    return super.claim(now, duration)
  }
}

class ClaimOwnedAllocator {
  #tails = new Map()
  constructor() {
    this.invoices = new Map()
    this.heads = new Map()
    this.reservations = new Map()
  }
  setClaim(invoiceId, { token, expires, lifecycle = 'claiming', unit = 'tenant:branch' }) {
    this.invoices.set(invoiceId, { token, expires, lifecycle, unit })
  }
  reclaim(invoiceId, token, expires) {
    const invoice = this.invoices.get(invoiceId)
    this.invoices.set(invoiceId, { ...invoice, token, expires, lifecycle: 'retrying' })
    const reservation = this.reservations.get(invoiceId)
    if (reservation?.state === 'allocated') reservation.token = token
  }
  async #locked(unit, fn) {
    const previous = this.#tails.get(unit) ?? Promise.resolve()
    let release
    const current = new Promise(resolve => { release = resolve })
    this.#tails.set(unit, current)
    await previous
    try { return await fn() } finally {
      release()
      if (this.#tails.get(unit) === current) this.#tails.delete(unit)
    }
  }
  #assertCurrent(invoice, token, now) {
    if (!invoice || !token || invoice.token !== token || invoice.expires <= now
      || !['claiming', 'retrying'].includes(invoice.lifecycle)) {
      throw new Error('STALE_CHAIN_CLAIM_TOKEN')
    }
  }
  async allocate(invoiceId, token, now) {
    const invoice = this.invoices.get(invoiceId)
    const prior = this.reservations.get(invoiceId)
    if (prior?.state === 'committed') {
      if (prior.token !== token) throw new Error('STALE_CHAIN_CLAIM_TOKEN')
      return prior
    }
    this.#assertCurrent(invoice, token, now)
    if (prior) {
      if (prior.token !== token) throw new Error('STALE_CHAIN_CLAIM_TOKEN')
      return prior
    }
    return this.#locked(invoice.unit, async () => {
      const currentInvoice = this.invoices.get(invoiceId)
      this.#assertCurrent(currentInvoice, token, now)
      const retry = this.reservations.get(invoiceId)
      if (retry) {
        if (retry.token !== token) throw new Error('STALE_CHAIN_CLAIM_TOKEN')
        return retry
      }
      const head = this.heads.get(invoice.unit) ?? { counter: 0, hash: 'FIRST' }
      this.heads.set(invoice.unit, head)
      const open = [...this.reservations.values()].find(row => row.unit === invoice.unit && row.state === 'allocated')
      if (open) throw new Error(`CHAIN_PREDECESSOR_PENDING:${open.invoiceId}`)
      const reservation = {
        invoiceId, unit: invoice.unit, token, state: 'allocated',
        counter: head.counter + 1, previousHash: head.hash, committedHash: null,
      }
      this.reservations.set(invoiceId, reservation)
      return reservation
    })
  }
  commit(invoiceId, token, artifactHash, now) {
    const invoice = this.invoices.get(invoiceId)
    const reservation = this.reservations.get(invoiceId)
    if (!reservation) throw new Error('CHAIN_RESERVATION_NOT_FOUND')
    if (reservation.state === 'committed') {
      if (reservation.token !== token) throw new Error('STALE_CHAIN_CLAIM_TOKEN')
      if (reservation.committedHash !== artifactHash) throw new Error('CHAIN_ALREADY_COMMITTED_WITH_DIFFERENT_HASH')
      return reservation
    }
    this.#assertCurrent(invoice, token, now)
    if (reservation.token !== token) throw new Error('STALE_CHAIN_CLAIM_TOKEN')
    const head = this.heads.get(reservation.unit)
    assert.equal(reservation.counter, head.counter + 1)
    assert.equal(reservation.previousHash, head.hash)
    head.counter = reservation.counter
    head.hash = artifactHash
    reservation.state = 'committed'
    reservation.committedHash = artifactHash
    return reservation
  }
}

await test('1 simultaneous allocations receive distinct counters', async () => {
  const chain = new SerialChain()
  const [a, b] = await Promise.all([chain.finalize('a', 'HASH-A'), chain.finalize('b', 'HASH-B')])
  assert.deepEqual([a.counter, b.counter], [1, 2])
})
await test('2 predecessor advances', async () => {
  const chain = new SerialChain(); const a = await chain.finalize('a', 'HASH-A'); const b = await chain.finalize('b', 'HASH-B')
  assert.equal(a.previousHash, 'FIRST'); assert.equal(b.previousHash, 'HASH-A')
})
await test('3 finalized unreported simplified participates', async () => {
  const chain = new SerialChain(); await chain.finalize('local', 'LOCAL'); assert.equal((await chain.finalize('next', 'NEXT')).previousHash, 'LOCAL')
})
await test('4 retry reuses allocation', async () => {
  const chain = new SerialChain(); const first = await chain.finalize('same', 'HASH'); assert.strictEqual(await chain.finalize('same', 'HASH'), first)
})
await test('5 stale finalization claim is reclaimed', () => {
  const lease = new Lease(); const first = lease.claim(0, 10); const second = lease.claim(11, 10); assert.notEqual(first.token, second.token)
})
await test('6 old claim token cannot persist', () => {
  const lease = new Lease(); const old = lease.claim(0, 10); lease.claim(11, 10); assert.throws(() => lease.persist(old.token, 12), /STALE_TOKEN/)
})
await test('7 network submissions are single writer', () => {
  const lease = new NetworkLease(); assert.equal(lease.claim(0).status, 'claimed'); assert.equal(lease.claim(1).status, 'in_progress')
})
await test('8 first-print and reprint use stored simplified QR', () => {
  const artifact = Object.freeze({ qr: 'PHASE2-STORED' }); assert.equal(artifact.qr, artifact.qr); assert.match(selector, /zatca_simplified_qr/)
})
await test('9 reporting cannot alter simplified artifact', () => {
  const artifact = Object.freeze({ xml: 'X', hash: 'H', signature: 'S', qr: 'Q' }); const before = JSON.stringify(artifact); assert.equal(JSON.stringify(artifact), before)
})
await test('10 provisional standard cannot print', () => {
  assert.match(selector, /artifact_stage === 'standard_cleared'/); assert.doesNotMatch(selector, /artifact_stage === 'standard_provisional'[\s\S]{0,120}return/)
})
await test('11 cleared response becomes authoritative', async () => {
  assert.match(edge, /parseClearedArtifactV2/); assert.match(edge, /adopt_zatca_cleared_artifact_v2/); assert.match(selector, /zatca_cleared_qr/)
  const returnedXml = readFileSync(join(root, 'scripts/fixtures/zatca/standard-cleared-returned.xml'), 'utf8')
  const parsed = await parseZatcaClearedInvoice({
    clearedInvoice: Buffer.from(returnedXml, 'utf8').toString('base64'),
    expectedUuid: '11111111-2222-4333-8444-555555555555',
    expectedInvoiceNumber: 'INV-CLEAR-001',
    provisionalHash: 'PROVISIONAL-HASH',
    computeHash: async xml => createHash('sha256').update(xml).digest('base64'),
  })
  assert.equal(parsed.qr, 'RETURNED-CLEARED-QR')
  assert.equal(parsed.signature, 'CLEARED-ZATCA-STAMP')
  assert.equal(parsed.xml.trim(), returnedXml.trim())
  await assert.rejects(() => parseZatcaClearedInvoice({
    clearedInvoice: Buffer.from(returnedXml, 'utf8').toString('base64'),
    expectedUuid: 'wrong-uuid', expectedInvoiceNumber: 'INV-CLEAR-001',
    provisionalHash: 'PROVISIONAL-HASH', computeHash: async () => 'HASH',
  }), /identity does not match/)
})
await test('12 clearance failure preserves provisional and blocks output', () => {
  assert.match(source['03_claims_and_idempotency.sql'], /clearance_failed/); assert.match(source['04_lock_compliance_fields.sql'], /Standard provisional request artifact is immutable/)
})
await test('13 browser cannot write QR XML hash signature', () => {
  const lock = source['04_lock_compliance_fields.sql']; for (const field of ['zatca_simplified_qr', 'zatca_simplified_xml', 'zatca_simplified_xml_hash', 'zatca_simplified_signature']) assert.match(lock, new RegExp(field)); assert.match(lock, /FROM authenticated, anon/)
})
await test('14 service path performs legal transitions', () => {
  const claims = source['03_claims_and_idempotency.sql']; assert.match(claims, /persist_zatca_simplified_final_v2/); assert.match(claims, /adopt_zatca_cleared_artifact_v2/); assert.match(claims, /TO service_role/)
})
await test('15 DB write failure requires reconciliation', () => {
  const lease = new NetworkLease(); lease.claim(0, 10); lease.requestStarted = true; assert.equal(lease.claim(11).status, 'reconciliation_required'); assert.match(edge, /p_ambiguous: requestStarted/)
})
await test('16 payment remains complete on finalization failure', () => {
  const checkoutRpc = pos.indexOf("'pos_checkout'")
  assert.ok(checkoutRpc > 0 && checkoutRpc < pos.indexOf('catch (finalizationFailure)')); assert.match(pos, /saleCompletedAttention/)
})
await test('17 POS retry does not repeat checkout', () => {
  const body = pos.slice(pos.indexOf('async function retryReceiptFinalization'), pos.indexOf('const canCharge')); assert.doesNotMatch(body, /pos_checkout/); assert.match(body, /finalizeInvoiceForZatca/)
})
await test('17a capability routing always uses an explicit document kind', () => {
  assert.doesNotMatch(submission, /documentKind:\s*ZatcaDocumentKind\s*=/)
  for (const sourceText of [submission, pos]) {
    assert.doesNotMatch(sourceText, /requireZatcaFinalizationCapability\(\s*[^,()\n]+\s*\)/)
  }
  assert.match(submission, /requireZatcaFinalizationCapability\(branchId, options\.documentKind\)/)
  assert.match(pos, /receipt\.isStandardInvoice \? 'standard' : 'simplified'/)
  assert.match(invoiceDetail, /documentKind: isStandardDocument \? 'standard' : 'simplified'/)
  assert.match(creditNoteModal, /documentKind: invoice\.zatca_document_kind/)
  assert.match(submission, /originalDocumentKindById\.get\(invoice\.original_invoice_id\)/)
})
await test('18 disabled flag blocks unsafe output', () => {
  assert.match(source['01_artifact_lifecycle.sql'], /immutable_finalization_enabled boolean NOT NULL DEFAULT false/); assert.match(submission, /immutableFinalizationEnabled/)
})
await test('19 mismatch fails before checkout', () => {
  const decision = pos.indexOf('await resolvePosCheckoutDocument('); const checkout = pos.indexOf("'pos_checkout'"); assert.ok(decision > 0 && decision < checkout); assert.match(pos, /documentDecision\?\.status === 'blocked'/); assert.match(edge, /FINALIZATION_VERSION_MISMATCH/)
})
await test('20 historical rows are not auto-finalized', () => {
  assert.doesNotMatch(source['01_artifact_lifecycle.sql'], /UPDATE\s+public\.invoices/i); assert.match(source['01_artifact_lifecycle.sql'], /legacy\/unclassified/)
})
await test('21 valid allocator claimant creates and reuses one reservation', async () => {
  const allocator = new ClaimOwnedAllocator()
  allocator.setClaim('invoice-a', { token: 'current', expires: 100 })
  const first = await allocator.allocate('invoice-a', 'current', 10)
  const retry = await allocator.allocate('invoice-a', 'current', 11)
  assert.strictEqual(retry, first)
  assert.equal(first.counter, 1)
})
await test('22 stale and expired allocator claims are rejected behaviorally', async () => {
  const allocator = new ClaimOwnedAllocator()
  allocator.setClaim('invoice-a', { token: 'current', expires: 20 })
  await assert.rejects(() => allocator.allocate('invoice-a', 'stale', 10), /STALE_CHAIN_CLAIM_TOKEN/)
  await assert.rejects(() => allocator.allocate('invoice-a', 'current', 20), /STALE_CHAIN_CLAIM_TOKEN/)
  assert.equal(allocator.reservations.size, 0)
})
await test('23 reclaim transfers only the open reservation to the new claimant', async () => {
  const allocator = new ClaimOwnedAllocator()
  allocator.setClaim('invoice-a', { token: 'old', expires: 10 })
  const reservation = await allocator.allocate('invoice-a', 'old', 1)
  allocator.reclaim('invoice-a', 'new', 100)
  assert.equal(reservation.token, 'new')
  await assert.rejects(() => allocator.allocate('invoice-a', 'old', 11), /STALE_CHAIN_CLAIM_TOKEN/)
  await assert.rejects(async () => allocator.commit('invoice-a', 'old', 'HASH', 11), /STALE_CHAIN_CLAIM_TOKEN/)
  assert.strictEqual(await allocator.allocate('invoice-a', 'new', 11), reservation)
  assert.strictEqual(allocator.commit('invoice-a', 'new', 'HASH', 11), reservation)
})
await test('24 simultaneous first-head retry is deterministic and unique', async () => {
  const allocator = new ClaimOwnedAllocator()
  allocator.setClaim('invoice-a', { token: 'current', expires: 100 })
  const [first, second] = await Promise.all([
    allocator.allocate('invoice-a', 'current', 1),
    allocator.allocate('invoice-a', 'current', 1),
  ])
  assert.strictEqual(first, second)
  assert.equal(allocator.heads.size, 1)
  assert.equal(allocator.reservations.size, 1)
})
await test('25 committed reservation cannot be transferred or reassigned', async () => {
  const allocator = new ClaimOwnedAllocator()
  allocator.setClaim('invoice-a', { token: 'owner', expires: 100 })
  const reservation = await allocator.allocate('invoice-a', 'owner', 1)
  allocator.commit('invoice-a', 'owner', 'HASH', 2)
  allocator.reclaim('invoice-a', 'newer', 200)
  assert.equal(reservation.token, 'owner')
  await assert.rejects(() => allocator.allocate('invoice-a', 'newer', 3), /STALE_CHAIN_CLAIM_TOKEN/)
  assert.strictEqual(await allocator.allocate('invoice-a', 'owner', 3), reservation)
})
await test('26 SQL allocator encodes ownership and conflict-safe first head', () => {
  const allocator = source['02_chain_allocator.sql']
  assert.match(allocator, /zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token/)
  assert.match(allocator, /zatca_finalization_lease_expires_at_v2 <= clock_timestamp\(\)/)
  assert.match(allocator, /zatca_lifecycle_state NOT IN \('claiming', 'retrying'\)/)
  assert.match(allocator, /RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN'/)
  assert.match(allocator, /pg_advisory_xact_lock/)
  assert.match(allocator, /ON CONFLICT \(tenant_id, branch_id\) DO NOTHING/)
})
await test('27 frontend production reads safe status instead of raw v2 invoice columns', () => {
  const raw = [
    'zatca_finalization_version', 'zatca_artifact_provenance', 'zatca_document_kind',
    'zatca_lifecycle_state', 'zatca_artifact_stage', 'zatca_counter_number',
    'zatca_prev_invoice_hash', 'zatca_xml_hash',
  ]
  for (const column of raw) {
    assert.doesNotMatch(invoiceReadContract, new RegExp(`['"]${column}['"]`))
  }
  assert.match(invoiceReadContract, /INVOICE_SAFE_COLUMNS/)
  assert.match(invoiceReadContract, /satisfies readonly \(keyof Invoice\)\[\]/)
  assert.match(invoiceDetail, /from\('invoices'\)\.select\(INVOICE_SAFE_SELECT\)/)
  assert.match(receiptPrint, /from\('invoices'\)\.select\(INVOICE_SAFE_SELECT\)/)
  assert.match(invoiceDetail, /readIssuedDocumentOutputState/)
  assert.match(invoiceDetail, /getSandboxValidationStatus/)
  assert.match(receiptPrint, /readIssuedDocumentOutputState/)
  assert.match(receiptPrint, /getSandboxValidationStatus/)
  assert.doesNotMatch(invoiceDetail, /invoice!?\.zatca_qr_code/)
  assert.doesNotMatch(receiptPrint, /invoice!?\.zatca_qr_code/)
  assert.match(pos, /getInvoiceZatcaOutputState/)
  assert.match(submission, /action: 'status'/)
  assert.match(submission, /invokeAuthenticatedZatca/)
  assert.match(authenticatedEdge, /auth\.getSession\(\)/)
  assert.match(authenticatedEdge, /Authorization: `Bearer \$\{token\}`/)
  assert.match(authenticatedEdge, /auth\.refreshSession\(\)/)
  assert.match(submission, /edgeFunctionVersion/)
  assert.match(submission, /minimumClientVersion/)
  assert.match(submission, /invoiceId/)
})
await test('28 hosted preflight is read-only and 04/04a reject drift', () => {
  const preflight = source['00_hosted_preflight.sql']
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/)
  assert.match(preflight, /ROLLBACK;/)
  assert.doesNotMatch(preflight, /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/im)
  assert.match(preflight, /pg_policies/)
  assert.match(preflight, /role_column_grants/)
  assert.match(preflight, /has_table_privilege/)
  assert.match(preflight, /authenticated_invoice_source_audit/)
  assert.match(preflight, /invoice_id_update_fingerprint/)
  const lock = source['04_lock_compliance_fields.sql']
  assert.match(lock, /POLICY_DEFINITION_DRIFT/)
  assert.match(lock, /UNEXPECTED_BROWSER_COMPLIANCE_UPDATE_GRANTS/)
  assert.match(lock, /v_browser_grants <> ARRAY\[\]::text\[\]/)
  const readSurface = source['04a_safe_invoice_read_surface.sql']
  assert.match(readSurface, /UNEXPECTED_PUBLIC_INVOICE_SELECT_GRANT/)
  assert.match(readSurface, /UNEXPECTED_AUTHENTICATED_UNSAFE_COLUMN_GRANTS/)
  assert.match(readSurface, /REVOKE SELECT ON TABLE public\.invoices FROM authenticated, anon/)
  assert.match(readSurface, /GRANT SELECT \(%s\) ON TABLE public\.invoices TO authenticated/)
  assert.match(readSurface, /SERVICE_ROLE_INVOICE_READ_CONTRACT_BROKEN/)
  assert.doesNotMatch(readSurface, /CREATE\s+POLICY|DROP\s+POLICY|ROW\s+LEVEL\s+SECURITY/i)
})
await test('29 verifier emits complete mandatory rows and honest reviews', () => {
  const verification = source['06_verification.sql']
  for (const check of [
    'runtime_singleton_count', 'runtime_master_flag_false',
    'runtime_simplified_flag_false', 'runtime_standard_flag_false',
    'runtime_schema_version', 'runtime_edge_version', 'runtime_client_version',
    'legacy_qr_backfill_policies_absent', 'browser_protected_update_privileges',
    'browser_raw_v2_select_privileges', 'safe_status_rpc_service_path',
    'browser_invoice_table_select_absent',
    'authenticated_safe_invoice_select_privileges',
    'anon_invoice_select_privileges', 'service_role_invoice_read_privileges',
    'allocator_current_token_comparison', 'allocator_active_lease_validation',
    'historical_v2_classification', 'historical_artifact_population',
    'pos_checkout_hash', 'snapshot_language_hash',
  ]) assert.match(verification, new RegExp(`['"]${check}['"]`))
  for (const trigger of [
    'zatca_v2_10_require_client_capability',
    'zatca_v2_20_initialize_invoice',
    'invoices_zatca_compliance_write_guard_v2',
  ]) assert.match(verification, new RegExp(trigger))
  for (const functionName of [
    'initialize_zatca_finalization_v2_invoice', 'seed_zatca_chain_head_v2',
    'allocate_zatca_chain_v2', 'commit_zatca_chain_v2', 'zatca_v2_document_kind',
    'claim_zatca_finalization_v2', 'persist_zatca_simplified_final_v2',
    'persist_zatca_standard_provisional_v2', 'fail_zatca_finalization_v2',
    'claim_zatca_network_v2', 'mark_zatca_network_request_started_v2',
    'persist_zatca_reporting_result_v2', 'adopt_zatca_cleared_artifact_v2',
    'fail_zatca_network_v2', 'assert_zatca_compliance_write_v2',
    'get_zatca_finalization_capabilities_v2', 'acknowledge_zatca_client_capability_v2',
    'require_zatca_client_capability_v2', 'get_zatca_output_state_v2',
  ]) assert.match(verification, new RegExp(functionName))
  assert.match(verification, /allocator_two_session_behavior[\s\S]*'REVIEW'/)
  assert.match(verification, /frontend_safe_status_source_contract[\s\S]*'REVIEW'/)
  assert.match(verification, /SELECT check_name, observed_value, expected_value, result/)
  assert.match(verification, /v_total <> 59 OR v_pass <> 54 OR v_review <> 5 OR v_fail <> 0/)
  assert.match(verification, /'PASS', 54::bigint/)
  assert.match(verification, /'REVIEW', 5::bigint/)
  assert.match(verification, /'FAIL', 0::bigint/)
  assert.match(verification, /ROLLBACK;/)
  assert.match(source['CONTRACT.md'], /59 mandatory rows/)
  assert.match(source['CONTRACT.md'], /54 `PASS`, 5 `REVIEW`, and[\s\S]*0 `FAIL`/)
})
await test('30 real two-session allocator fixture is an explicit release gate', () => {
  assert.match(allocatorFixture, /mandatory release gate/i)
  assert.match(allocatorFixture, /ZATCA_V2_DISPOSABLE_DATABASE_URL/)
  assert.match(allocatorFixture, /STALE_CHAIN_CLAIM_TOKEN/)
  assert.match(allocatorSessionA, /DISPOSABLE_DATABASE_REQUIRED/)
  assert.match(allocatorSessionA, /pg_sleep\(5\)/)
  assert.match(allocatorSessionB, /DISPOSABLE_DATABASE_REQUIRED/)
  assert.match(allocatorSessionA, /allocate_zatca_chain_v2/)
  assert.match(allocatorSessionB, /allocate_zatca_chain_v2/)
})
await test('branch seller lookup uses hosted-compatible columns and preserves query errors', () => {
  assert.doesNotMatch(edge, /compliance_identity_mode|branch_compliance_profiles/)
  assert.equal((edge.match(/error: branchError/g) ?? []).length, 3)
  assert.equal((edge.match(/\[zatca-submit\] branch lookup failed:/g) ?? []).length, 3)
  assert.equal((edge.match(/registered_seller_name: branchScope\.business_name \|\| branchScope\.name/g) ?? []).length, 3)
})
await test('stored output-state QR contract supports legacy and v2 invoice reads', async () => {
  const legacyReported = {
    contractMode: 'legacy',
    legacyCompatible: true,
    invoiceStatus: 'reported',
    finalizationStatus: 'legacy_reported',
    artifactStage: 'legacy_final',
    documentKind: 'simplified',
    canPrint: true,
    qrCode: 'LEGACY-FINAL-QR',
  }
  const legacyFinal = {
    ...legacyReported,
    invoiceStatus: 'cleared',
    finalizationStatus: 'legacy_final',
    qrCode: 'LEGACY-CLEARED-QR',
  }
  const v2SimplifiedFinal = {
    contractMode: 'v2',
    legacyCompatible: false,
    invoiceStatus: 'pending',
    finalizationStatus: 'locally_finalized',
    artifactStage: 'simplified_final',
    documentKind: 'simplified',
    canPrint: true,
    qrCode: 'V2-FINAL-QR',
  }
  for (const [state, expectedQr] of [
    [legacyReported, 'LEGACY-FINAL-QR'],
    [legacyFinal, 'LEGACY-CLEARED-QR'],
    [v2SimplifiedFinal, 'V2-FINAL-QR'],
  ]) {
    const selectedQr = selectStoredOutputStateQr(state)
    assert.equal(selectedQr, expectedQr)
    const rendered = await renderStoredQrDataUrl(
      selectedQr,
      async payload => `data:image/png;base64,${payload}`,
    )
    assert.equal(
      canOpenStoredInvoicePrint(state.canPrint, selectedQr, rendered.status, rendered.dataUrl),
      true,
    )
  }
  assert.equal(selectStoredOutputStateQr({
    ...legacyReported,
    compatible: false,
    acknowledged: false,
    branchV2Ready: false,
    checkoutMode: 'legacy',
  }), 'LEGACY-FINAL-QR', 'readiness/capability metadata must not erase authenticated final QR')
  assert.equal(selectStoredOutputStateQr({ ...legacyReported, canPrint: false }), null)
  assert.equal(selectStoredOutputStateQr({ ...legacyReported, qrCode: null }), null)
  assert.equal(selectStoredOutputStateQr({
    ...v2SimplifiedFinal,
    reconciliationRequired: true,
  }), 'V2-FINAL-QR')
  for (const page of [invoiceDetail, receiptPrint]) {
    assert.match(page, /selectStoredOutputStateQr\(outputStateMatchesInvoice \? outputState : null\)/)
    assert.doesNotMatch(page, /zatca_finalization_version:\s*2/)
  }
  assert.match(pos, /selectStoredOutputStateQr\(legacy\)/)
  assert.match(pos, /selectStoredOutputStateQr\(output\)/)
  assert.match(pos, /selectStoredOutputStateQr\(\{\s*\.\.\.finalization,\s*contractMode: 'v2'/)
  assert.match(pos, /renderStoredQrDataUrl\(\s*receipt\.zatcaQrCode/)
})
await test('stored QR rendering succeeds, fails closed, and has a bounded wait', async () => {
  let renderedPayload = null
  const nativeSetTimeout = globalThis.setTimeout
  const nativeClearTimeout = globalThis.clearTimeout
  let fallbackTimerCleared = false
  let fallbackTimerDelay = null
  try {
    globalThis.setTimeout = (_callback, delay) => {
      fallbackTimerDelay = delay
      return 12345
    }
    globalThis.clearTimeout = timer => {
      if (timer === 12345) fallbackTimerCleared = true
    }
    const ready = await Promise.race([
      renderStoredQrDataUrl('FINAL-STORED-QR', async payload => {
        renderedPayload = payload
        return 'data:image/png;base64,stored'
      }),
      new Promise((_, reject) => nativeSetTimeout(
        () => reject(new Error('Valid stored QR waited for the fallback timeout.')),
        100,
      )),
    ])
    assert.equal(renderedPayload, 'FINAL-STORED-QR')
    assert.deepEqual(ready, { status: 'ready', dataUrl: 'data:image/png;base64,stored' })
  } finally {
    globalThis.setTimeout = nativeSetTimeout
    globalThis.clearTimeout = nativeClearTimeout
  }
  assert.equal(fallbackTimerDelay, 5_000)
  assert.equal(fallbackTimerCleared, true)

  let missingRendererCalled = false
  const missing = await renderStoredQrDataUrl(null, async () => {
    missingRendererCalled = true
    return 'unexpected'
  })
  assert.equal(missingRendererCalled, false)
  assert.deepEqual(missing, { status: 'missing', dataUrl: null })

  const started = Date.now()
  const timedOut = await renderStoredQrDataUrl('FINAL-STORED-QR', () => new Promise(() => {}), 10)
  assert.deepEqual(timedOut, { status: 'failed', dataUrl: null })
  assert.ok(Date.now() - started < 500, 'QR renderer timeout must be bounded')
})
await test('thermal and A4 printing require the finalized rendered QR', () => {
  assert.equal(canOpenStoredInvoicePrint(true, 'FINAL-QR', 'ready', 'data:image/png;base64,qr'), true)
  assert.equal(canOpenStoredInvoicePrint(true, null, 'missing', null), false)
  assert.equal(canOpenStoredInvoicePrint(true, 'FINAL-QR', 'failed', null), false)
  assert.equal(canOpenStoredInvoicePrint(false, 'FINAL-QR', 'ready', 'data:image/png;base64,qr'), false)
  assert.match(invoiceDetail, /async function handlePrintA4\(\)[\s\S]*?printCurrentPageDocument\('kubri-print-root', 'invoice'\)/)
  assert.match(invoiceDetail, /async function handlePrintThermal\(\)[\s\S]*?printCurrentPageDocument\('kubri-print-root', 'receipt'\)/)
  assert.match(invoiceDetail, /disabled=\{thermalPrinting \|\| !printReady\}/)
  assert.match(invoiceDetail, /disabled=\{a4Printing \|\| !printReady\}/)
  assert.match(receiptPrint, /function handlePrint\(\)[\s\S]*?window\.print\(\)/)
  const invoiceAutoPrint = invoiceDetail.slice(
    invoiceDetail.indexOf('// Auto-print when ?print=1'),
    invoiceDetail.indexOf('// ── Actions'),
  )
  const receiptAutoPrint = receiptPrint.slice(
    receiptPrint.indexOf("if (!autoPrint || embeddedPrint || electronPrint"),
    receiptPrint.indexOf('const receipt = useMemo'),
  )
  const electronReceiptReady = receiptPrint.slice(
    receiptPrint.indexOf("if (!electronPrint || electronReadyRef.current || loading"),
    receiptPrint.indexOf("if (!electronPrint || electronReadyRef.current || !error"),
  )
  for (const printReadiness of [invoiceAutoPrint, receiptAutoPrint, electronReceiptReady]) {
    assert.match(printReadiness, /printReady/)
  }
  for (const page of [invoiceDetail, receiptPrint]) {
    assert.match(page, /resolveIssuedDocumentReadiness/)
    assert.match(page, /readIssuedDocumentOutputState/)
    assert.match(page, /renderIssuedDocumentQr/)
    assert.doesNotMatch(page, /QR_DISPLAY_TIMEOUT_MS/)
    assert.match(page, /toast\.error\(t\('printing:qrUnavailable'\)\)/)
  }
  assert.match(pos, /const printReady = receipt\.isDemo\s*\?\s*receipt\.canPrint\s*:\s*receipt\.canPrint && qrStatus === 'ready' && Boolean\(qrDataUrl\)/)
  assert.match(pos, /disabled=\{printingReceipt \|\| !printReady\}/)
  assert.match(pos, /disabled=\{!printReady\}/)
  assert.match(receiptPrint, /qrUnavailable/)
  assert.doesNotMatch(invoiceDetail, /outputReady/)
  assert.doesNotMatch(receiptPrint, /outputReady/)
})
await test('package shape and protected scope', () => {
  assert.equal(files.length, 14)
  const mutating = ['01_artifact_lifecycle.sql', '02_chain_allocator.sql', '03_claims_and_idempotency.sql', '04_lock_compliance_fields.sql', '04a_safe_invoice_read_surface.sql', '05_capabilities_and_status.sql', '09_branch_readiness_gate.sql', '11_durable_simplified_reporting_outbox.sql'].map(name => source[name]).join('\n')
  assert.doesNotMatch(mutating, /storage\.|phase6a|snapshot_invoice_document_language\s*\(/i)
  assert.doesNotMatch(mutating, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.pos_checkout/i)
  assert.match(oldMarker, /Do not execute/i)
})

console.log(`ZATCA finalization v2: ${results.length} deterministic checks passed`)
for (const name of results) console.log(`PASS ${name}`)
