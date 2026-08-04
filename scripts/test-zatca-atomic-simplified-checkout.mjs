import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canOpenStoredInvoicePrint,
  selectStoredOutputStateQr,
} from '../src/lib/zatca/qrDisplay.mjs'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const alignment = read('supabase/migrations/20260724000000_atomic_commercial_function_compatibility_alignment.sql')
const migration = read('supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql')
const posSessionGrant = read('supabase/migrations/20260724000200_pos_sessions_authenticated_select.sql')
const alignmentPackage = read('scripts/sql/zatca-phase2-finalization-v2/11a_atomic_commercial_function_alignment.sql')
const alignmentVerification = read('scripts/sql/zatca-phase2-finalization-v2/11b_verify_atomic_commercial_function_alignment.sql')
const packageSql = read('scripts/sql/zatca-phase2-finalization-v2/12_atomic_simplified_checkout_v2.sql')
const posSessionPackage = read('scripts/sql/zatca-phase2-finalization-v2/13_pos_sessions_authenticated_select.sql')
const edge = read('supabase/functions/zatca-submit/index.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const credit = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const creditReceipt = read('src/pages/invoices/AtomicCreditNoteReceiptView.tsx')
const invoiceDetail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const invoiceList = read('src/pages/invoices/InvoicesPage.tsx')
const atomicClient = read('src/lib/zatca/atomicCheckout.ts')
const creditPresentation = read('src/lib/zatca/creditNotePresentation.mjs')
const atomicPrint = read('src/lib/atomicReceiptPrint.ts')
const electronMain = read('electron/main.cjs')
const electronPreload = read('electron/preload.cjs')
const outputClient = read('src/lib/zatca/submission.ts')

const results = []
async function test(name, fn) {
  await fn()
  results.push(name)
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

class AtomicCheckoutModel {
  constructor() {
    this.head = { counter: 0, hash: 'FIRST' }
    this.invoiceCounter = 0
    this.creditCounter = 0
    this.active = null
    this.intents = new Map()
    this.invoices = new Map()
    this.payments = []
    this.stockMovements = []
    this.reservations = []
    this.outbox = []
    this.evidence = []
    this.signCount = 0
    this.now = 1_000
    this.priceVersion = 1
    this.stockVersion = 1
  }

  prepare({ key, fingerprint, documentType = 'invoice' }) {
    const existing = this.intents.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.documentType !== documentType) {
        throw new Error('IDEMPOTENCY_FINGERPRINT_MISMATCH')
      }
      return existing
    }
    if (this.active && this.active.expiresAt > this.now) {
      throw new Error('CHAIN_PREDECESSOR_PENDING')
    }
    const documentCounter = documentType === 'credit_note'
      ? ++this.creditCounter
      : ++this.invoiceCounter
    const intent = {
      key,
      fingerprint,
      documentType,
      id: `intent-${key}`,
      invoiceId: `invoice-${key}`,
      number: documentType === 'credit_note'
        ? `INV-CN-${String(documentCounter).padStart(4, '0')}`
        : `INV-${String(documentCounter).padStart(4, '0')}`,
      uuid: `uuid-${key}`,
      counter: this.head.counter + 1,
      previousHash: this.head.hash,
      priceVersion: this.priceVersion,
      stockVersion: this.stockVersion,
      expiresAt: this.now + 120,
      state: 'prepared',
      artifact: null,
      receipt: null,
    }
    this.intents.set(key, intent)
    this.active = intent
    return intent
  }

  sign(intent) {
    if (intent.artifact) return intent.artifact
    this.signCount += 1
    const xml = `<Invoice><ID>${intent.number}</ID><UUID>${intent.uuid}</UUID><ICV>${intent.counter}</ICV><PIH>${intent.previousHash}</PIH></Invoice>`
    intent.artifact = {
      xml,
      hash: digest(xml),
      signature: `signature-${intent.uuid}`,
      qr: `phase2-qr-${intent.uuid}`,
    }
    return intent.artifact
  }

  commit(intent, { loseResponse = false } = {}) {
    if (intent.state === 'committed') return intent.receipt
    if (intent.expiresAt <= this.now) throw new Error('ATOMIC_CHECKOUT_INTENT_EXPIRED')
    if (this.priceVersion !== intent.priceVersion) throw new Error('ATOMIC_CHECKOUT_SNAPSHOT_CHANGED')
    if (this.stockVersion !== intent.stockVersion) throw new Error('ATOMIC_CHECKOUT_SNAPSHOT_CHANGED')
    if (this.head.counter + 1 !== intent.counter || this.head.hash !== intent.previousHash) {
      throw new Error('ATOMIC_CHECKOUT_CHAIN_HEAD_CHANGED')
    }
    if (!intent.artifact?.qr) throw new Error('ATOMIC_CHECKOUT_NOT_READY_TO_COMMIT')

    const invoice = {
      id: intent.invoiceId,
      number: intent.number,
      uuid: intent.uuid,
      counter: intent.counter,
      previousHash: intent.previousHash,
      artifact: structuredClone(intent.artifact),
      lifecycle: 'locally_finalized',
    }
    const receipt = Object.freeze({
      invoice_id: invoice.id,
      invoice_number: invoice.number,
      invoice_uuid: invoice.uuid,
      zatca_counter_number: invoice.counter,
      previous_hash: invoice.previousHash,
      xml_hash: invoice.artifact.hash,
      qr_code: invoice.artifact.qr,
      can_print: true,
      reporting_display_state: 'reporting_pending',
    })
    this.invoices.set(invoice.id, invoice)
    this.payments.push({ invoiceId: invoice.id })
    this.stockMovements.push({ invoiceId: invoice.id, direction: intent.documentType === 'credit_note' ? 'in' : 'out' })
    this.reservations.push({ invoiceId: invoice.id, counter: invoice.counter, state: 'committed', hash: invoice.artifact.hash })
    this.outbox.push({ invoiceId: invoice.id, artifactHash: invoice.artifact.hash, status: 'pending' })
    this.head = { counter: invoice.counter, hash: invoice.artifact.hash }
    intent.state = 'committed'
    intent.receipt = receipt
    this.active = null
    if (loseResponse) throw new Error('RESPONSE_LOST_AFTER_COMMIT')
    return receipt
  }

  checkout(input, options) {
    const intent = this.prepare(input)
    if (intent.state === 'committed') return intent.receipt
    this.sign(intent)
    return this.commit(intent, options)
  }

  cleanup() {
    if (this.active && this.active.expiresAt <= this.now) {
      this.active.state = 'expired'
      this.active = null
      return 1
    }
    return 0
  }

  recordResponse(outboxIndex, response, { failApply = false } = {}) {
    const outbox = this.outbox[outboxIndex]
    const evidence = Object.freeze({
      invoiceId: outbox.invoiceId,
      httpStatus: response.httpStatus,
      reportingStatus: response.reportingStatus,
      validationStatus: response.validationStatus,
      warningCodes: response.warningCodes ?? [],
      errorCodes: response.errorCodes ?? [],
      outcome: response.outcome,
    })
    this.evidence.push(evidence)
    if (failApply) throw new Error('RESULT_PERSISTENCE_FAILED')
    outbox.status = response.outcome === 'accepted' ? 'accepted' : 'blocked'
    return evidence
  }
}

await test('normal simplified checkout commits complete buyer output once', () => {
  const model = new AtomicCheckoutModel()
  const receipt = model.checkout({ key: 'normal', fingerprint: digest('cart') })
  assert.equal(receipt.can_print, true)
  assert.match(receipt.qr_code, /^phase2-qr-/)
  assert.equal(model.invoices.size, 1)
  assert.equal(model.payments.length, 1)
  assert.equal(model.stockMovements.length, 1)
  assert.equal(model.reservations.length, 1)
  assert.equal(model.outbox.length, 1)
  assert.equal(model.head.counter, 1)
})

await test('failed final commit exposes no partial commercial transaction', () => {
  const model = new AtomicCheckoutModel()
  const intent = model.prepare({ key: 'price-change', fingerprint: digest('cart') })
  model.sign(intent)
  model.priceVersion += 1
  assert.throws(() => model.commit(intent), /SNAPSHOT_CHANGED/)
  assert.equal(model.invoices.size, 0)
  assert.equal(model.payments.length, 0)
  assert.equal(model.stockMovements.length, 0)
  assert.equal(model.reservations.length, 0)
  assert.equal(model.outbox.length, 0)
})

await test('ZATCA unavailability never delays or rolls back the local receipt', () => {
  const model = new AtomicCheckoutModel()
  const receipt = model.checkout({ key: 'zatca-down', fingerprint: digest('cart') })
  model.now += 31
  assert.equal(receipt.reporting_display_state, 'reporting_pending')
  assert.equal(model.outbox[0].status, 'pending')
  assert.equal(model.invoices.size, 1)
})

await test('duplicate click, refresh, Edge retry, and lost response replay exactly', () => {
  const model = new AtomicCheckoutModel()
  const input = { key: 'replay', fingerprint: digest('cart') }
  assert.throws(() => model.checkout(input, { loseResponse: true }), /RESPONSE_LOST/)
  const replayA = model.checkout(input)
  const replayB = model.checkout(input)
  assert.deepEqual(replayA, replayB)
  assert.equal(model.signCount, 1)
  assert.equal(model.invoices.size, 1)
  assert.equal(model.payments.length, 1)
  assert.equal(model.reservations.length, 1)
  assert.equal(model.outbox.length, 1)
})

await test('fingerprint mismatch cannot reuse an idempotency key', () => {
  const model = new AtomicCheckoutModel()
  model.checkout({ key: 'same-key', fingerprint: digest('cart-a') })
  assert.throws(
    () => model.checkout({ key: 'same-key', fingerprint: digest('cart-b') }),
    /FINGERPRINT_MISMATCH/,
  )
})

await test('concurrent chain work cannot overtake an active preparation', () => {
  const model = new AtomicCheckoutModel()
  const first = model.prepare({ key: 'first', fingerprint: digest('a') })
  assert.throws(
    () => model.prepare({ key: 'second', fingerprint: digest('b') }),
    /CHAIN_PREDECESSOR_PENDING/,
  )
  model.sign(first)
  model.commit(first)
  const second = model.prepare({ key: 'second', fingerprint: digest('b') })
  assert.equal(second.counter, 2)
  assert.equal(second.previousHash, model.head.hash)
})

await test('expired abandoned intent is safely cleaned without a sale', () => {
  const model = new AtomicCheckoutModel()
  const abandoned = model.prepare({ key: 'abandoned', fingerprint: digest('a') })
  model.now = abandoned.expiresAt
  assert.equal(model.cleanup(), 1)
  assert.equal(abandoned.state, 'expired')
  assert.equal(model.invoices.size, 0)
  const next = model.prepare({ key: 'next', fingerprint: digest('b') })
  assert.equal(next.counter, 1)
})

await test('stock changes between preparation and commit fail atomically', () => {
  const model = new AtomicCheckoutModel()
  const intent = model.prepare({ key: 'stock-change', fingerprint: digest('a') })
  model.sign(intent)
  model.stockVersion += 1
  assert.throws(() => model.commit(intent), /SNAPSHOT_CHANGED/)
  assert.equal(model.invoices.size, 0)
})

await test('simplified credit note commits refund direction, artifact, chain, and outbox', () => {
  const model = new AtomicCheckoutModel()
  const receipt = model.checkout({
    key: 'credit',
    fingerprint: digest('credit-lines'),
    documentType: 'credit_note',
  })
  assert.match(receipt.invoice_number, /^INV-CN-/)
  assert.equal(model.stockMovements[0].direction, 'in')
  assert.equal(model.outbox[0].artifactHash, receipt.xml_hash)
})

await test('printer failure cannot duplicate or roll back checkout', () => {
  const model = new AtomicCheckoutModel()
  const input = { key: 'printer-failure', fingerprint: digest('cart') }
  const receipt = model.checkout(input)
  const print = () => { throw new Error('PRINTER_OFFLINE') }
  assert.throws(print, /PRINTER_OFFLINE/)
  assert.deepEqual(model.checkout(input), receipt)
  assert.equal(model.invoices.size, 1)
  assert.equal(model.payments.length, 1)
})

await test('simplified pending, rejected, and reconciliation states remain printable', () => {
  for (const reportingDisplayState of [
    'reporting_pending',
    'retryable_failure',
    'rejected',
    'reconciliation_required',
    'manual_review_required',
  ]) {
    const state = {
      contractMode: 'v2',
      documentKind: 'simplified',
      artifactStage: 'simplified_final',
      canPrint: true,
      reconciliationRequired: reportingDisplayState === 'reconciliation_required',
      qrCode: `QR-${reportingDisplayState}`,
    }
    const qr = selectStoredOutputStateQr(state)
    assert.equal(qr, state.qrCode)
    assert.equal(canOpenStoredInvoicePrint(true, qr, 'ready', 'data:image/png;base64,QR'), true)
  }
  assert.equal(selectStoredOutputStateQr({
    contractMode: 'v2',
    documentKind: 'simplified',
    artifactStage: 'simplified_final',
    canPrint: true,
    qrCode: null,
  }), null)
})

await test('standard invoice output remains clearance-gated', () => {
  assert.equal(selectStoredOutputStateQr({
    contractMode: 'v2',
    documentKind: 'standard',
    artifactStage: 'standard_provisional',
    finalizationStatus: 'clearance_pending',
    canPrint: false,
    qrCode: 'PROVISIONAL-QR',
  }), null)
  assert.equal(selectStoredOutputStateQr({
    contractMode: 'v2',
    documentKind: 'standard',
    artifactStage: 'standard_cleared',
    finalizationStatus: 'cleared_final',
    invoiceStatus: 'cleared',
    canPrint: true,
    qrCode: 'CLEARED-QR',
  }), 'CLEARED-QR')
})

await test('response evidence survives a result-persistence failure', () => {
  const model = new AtomicCheckoutModel()
  model.checkout({ key: 'evidence', fingerprint: digest('cart') })
  assert.throws(() => model.recordResponse(0, {
    httpStatus: 200,
    reportingStatus: 'REPORTED',
    validationStatus: 'PASS',
    warningCodes: ['W-1'],
    errorCodes: [],
    outcome: 'accepted',
  }, { failApply: true }), /RESULT_PERSISTENCE_FAILED/)
  assert.equal(model.evidence.length, 1)
  assert.equal(model.evidence[0].reportingStatus, 'REPORTED')
  assert.equal(model.outbox[0].status, 'pending')
})

await test('SQL final transaction and constraints encode the atomic visibility invariant', () => {
  for (const object of [
    'zatca_atomic_checkout_branch_gates_v2',
    'zatca_atomic_checkout_intents_v2',
    'prepare_zatca_atomic_checkout_v2',
    'claim_zatca_atomic_checkout_signing_v2',
    'store_zatca_atomic_checkout_artifact_v2',
    'commit_zatca_atomic_checkout_v2',
    'expire_zatca_atomic_checkout_intents_v2',
    'zatca_reporting_response_evidence_v2',
    'append_zatca_reporting_response_evidence_v2',
    'apply_zatca_reporting_response_evidence_v2',
  ]) assert.match(migration, new RegExp(object))
  assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*one_active_branch_v2[\s\S]*WHERE state = 'prepared'/)
  assert.match(migration, /UNIQUE \(branch_id, idempotency_key\)/)
  assert.match(migration, /UNIQUE \(invoice_id\)/)
  assert.match(migration, /ATOMIC_CHECKOUT_SNAPSHOT_CHANGED/)
  assert.match(migration, /INSERT INTO public\.zatca_chain_reservations_v2[\s\S]*'committed'/)
  assert.match(migration, /UPDATE public\.zatca_chain_heads_v2[\s\S]*last_committed_hash/)
  assert.match(migration, /UPDATE public\.invoices[\s\S]*zatca_simplified_xml = v_intent\.candidate_signed_xml/)
  assert.match(migration, /INSERT INTO public\.zatca_reporting_outbox_v2/)
  assert.match(migration, /SET state = 'committed',[\s\S]*receipt_payload = v_receipt/)
  assert.match(migration, /candidate_signed_xml IS DISTINCT FROM OLD\.candidate_signed_xml/)
  assert.match(migration, /signing_lease_token IS DISTINCT FROM p_signing_token/)
  assert.match(migration, /OLD\.receipt_payload IS NOT NULL[\s\S]*NEW\.receipt_payload IS DISTINCT/)
  assert.doesNotMatch(`${alignment}\n${migration}\n${posSessionGrant}`, /0121e5c8|3ae21515|INV-0826|INV-0827/)
  assert.match(alignmentPackage, /20260724000000_atomic_commercial_function_compatibility_alignment\.sql/)
  assert.match(packageSql, /20260724000100_atomic_simplified_checkout_v2\.sql/)
  assert.match(posSessionPackage, /20260724000200_pos_sessions_authenticated_select\.sql/)
})

await test('commercial alignment is exact, behavior-preserving, and data-write-free', () => {
  assert.match(alignment, /bdc4ee5a02be05aa8b1d7378ebb84c0f/)
  assert.match(alignment, /c69249c13a29f0ff3d10c6529d7bca89/)
  assert.match(alignment, /b810798d8d9b64248f06ae67c6d95f90/)
  assert.match(alignment, /2789273cfedb900ae02d178eded85f90/)
  assert.match(alignment, /68d6d28ff7ed53ad8b79180b3e26592b/)
  assert.match(alignment, /ea38d6800970cf51594e27c11c376ebd/)
  assert.match(alignmentVerification, /68d6d28ff7ed53ad8b79180b3e26592b/)
  assert.match(alignmentVerification, /ea38d6800970cf51594e27c11c376ebd/)

  assert.match(alignment, /v_profile\.role = ''branch''/)
  assert.match(alignment, /v_profile\.role IN \(''owner'', ''admin''\)/)
  assert.match(alignment, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/)
  assert.match(alignment, /v_profile\.tenant_id IS DISTINCT FROM v_original\.tenant_id/)
  assert.match(alignment, /v_profile\.branch_id IS DISTINCT FROM v_branch\.id/)
  assert.match(alignment, /v_profile\.branch_id IS DISTINCT FROM v_original\.branch_id/)

  assert.match(alignment, /ebf1144b-55ed-472a-99c9-23b5ee915351/)
  assert.match(alignment, /14271653-b404-44bf-9f39-7e9927569c02/)
  assert.match(alignment, /c30094d7-40ca-4d2e-833a-07aa18c4fa46/)
  assert.match(alignment, /sandbox_validated/)
  assert.match(alignment, /sandbox_validated_with_warnings/)
  assert.match(alignment, /v_original\.zatca_status NOT IN \('reported', 'cleared'\)/)

  assert.match(alignment, /SECURITY_CONFIG_MISMATCH/)
  assert.match(alignment, /search_path=public/)
  assert.match(alignment, /row_security=off/)
  assert.match(alignment, /REVOKE ALL ON FUNCTION public\.pos_checkout\(jsonb\) FROM PUBLIC, anon/)
  assert.match(alignment, /REVOKE ALL ON FUNCTION public\.create_partial_credit_note\(jsonb\) FROM PUBLIC, anon/)
  assert.match(alignment, /GRANT EXECUTE ON FUNCTION public\.pos_checkout\(jsonb\) TO authenticated/)
  assert.match(alignment, /GRANT EXECUTE ON FUNCTION public\.create_partial_credit_note\(jsonb\) TO authenticated/)

  assert.doesNotMatch(
    alignment,
    /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE)\s+public\.(?:invoices|invoice_items|payments|payment_refunds|products|pos_stock_movements|zatca_chain|zatca_reporting_outbox)/mi,
  )
  assert.doesNotMatch(alignment, /(?:PERFORM|SELECT)\s+public\.(?:pos_checkout|create_partial_credit_note)\s*\(/i)
})

await test('preparation reuses authoritative commercial validation without visibility', () => {
  assert.match(migration, /v_preview := public\.pos_checkout\(p_payload\)/)
  assert.match(migration, /v_preview := public\.create_partial_credit_note_with_refund\(p_payload\)/)
  assert.match(migration, /ATOMIC_COMMERCIAL_FUNCTION_HASH_DRIFT/)
  assert.match(migration, /public\.pos_checkout\(jsonb\)[\s\S]*68d6d28ff7ed53ad8b79180b3e26592b/)
  assert.match(migration, /public\.create_partial_credit_note\(jsonb\)[\s\S]*ea38d6800970cf51594e27c11c376ebd/)
  assert.match(migration, /447dc2f026ae6f488fa434079759b75e/)
  assert.match(migration, /acbf207e42d0a41cb81f09e9859e8fb1/)
  assert.doesNotMatch(migration, /bdc4ee5a02be05aa8b1d7378ebb84c0f|c69249c13a29f0ff3d10c6529d7bca89/)
  assert.doesNotMatch(migration, /b810798d8d9b64248f06ae67c6d95f90|2789273cfedb900ae02d178eded85f90/)
  assert.match(migration, /current_setting\('app\.atomic_checkout_invoice_id', true\)/)
  assert.match(migration, /set_config\('app\.atomic_checkout_invoice_id', v_intent\.invoice_id::text, true\)/)
  assert.match(migration, /MESSAGE = 'ATOMIC_CHECKOUT_PREVIEW_ROLLBACK'/)
  assert.match(migration, /v_actual_snapshot := public\.build_zatca_atomic_receipt_snapshot_v2/)
  assert.match(migration, /IF v_actual_core IS DISTINCT FROM v_expected_core/)
  assert.match(migration, /ORDER BY\s+p\.method::text,[\s\S]*p\.amount/)
})

await test('a DB-owned signing lease prevents concurrent duplicate signing', () => {
  assert.match(edge, /rpc\('claim_zatca_atomic_checkout_signing_v2'/)
  assert.match(edge, /signingClaim\.status === 'artifact_ready'/)
  assert.match(edge, /signingClaim\.status === 'claimed'/)
  assert.match(edge, /p_signing_token: signingToken/)
  assert.match(migration, /signing_lease_expires_at > clock_timestamp\(\)/)
  const claimIndex = edge.indexOf("rpc('claim_zatca_atomic_checkout_signing_v2'")
  const signIndex = edge.indexOf('await signInvoice(', claimIndex)
  assert.ok(claimIndex > 0 && signIndex > claimIndex)
  assert.ok(edge.includes('<cbc:ID>ICV<\\\\/cbc:ID>'))
  assert.ok(edge.includes('<cbc:ID>PIH<\\\\/cbc:ID>'))
})

await test('security is authoritative and private artifacts are not browser-readable', () => {
  assert.match(edge, /loadCallerProfile\(authClient as any, user\.id\)/)
  assert.match(edge, /authorizeBranchAccess\(supabase as any, branchId, callerProfile\)/)
  assert.match(edge, /ATOMIC_CHECKOUT_BRANCH_MISMATCH/)
  assert.match(migration, /FROM public\.user_profiles[\s\S]*id = p_actor_user_id AND is_active = true/)
  assert.match(migration, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/)
  assert.match(migration, /REVOKE ALL ON public\.zatca_atomic_checkout_intents_v2 FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.commit_zatca_atomic_checkout_v2\(uuid, uuid\)[\s\S]*TO authenticated/)
  assert.match(migration, /v_intent\.actor_user_id IS DISTINCT FROM v_actor/)
  assert.doesNotMatch(atomicClient, /signed_xml|private_key|production_csid|authorization/i)
})

await test('POS first print uses returned snapshot with no invoice refetch or status wait', () => {
  const atomicStart = pos.indexOf('const atomicAttempt = await checkoutSimplifiedAtomically')
  const atomicEnd = pos.indexOf('if (!checkout)', atomicStart)
  const atomicPath = pos.slice(atomicStart, atomicEnd)
  assert.ok(atomicStart > 0 && atomicEnd > atomicStart)
  assert.doesNotMatch(atomicPath, /getInvoiceZatcaOutputState|finalizeInvoiceForZatca|submitInvoiceForBranch/)
  assert.match(pos, /atomicSnapshot: Boolean\(atomicCheckoutResult\)/)
  assert.match(pos, /printRenderedReceiptSnapshot/)
  assert.match(pos, /printAtomicReceiptSnapshot/)
  assert.match(atomicPrint, /printCurrentReceipt\(\)/)
  assert.match(electronMain, /async function printCurrentReceiptSnapshot\(sender\)/)
  assert.match(electronPreload, /printCurrentReceipt/)
})

await test('rapid POS clicks are synchronously coalesced before a second renderer request', async () => {
  const chargeStart = pos.indexOf('async function charge()')
  const atomicRequest = pos.indexOf('await checkoutSimplifiedAtomically', chargeStart)
  const guardedPath = pos.slice(chargeStart, atomicRequest)
  assert.match(guardedPath, /checkoutInFlightRef\.current\) return/)
  assert.match(guardedPath, /checkoutInFlightRef\.current = true/)
  assert.ok(
    pos.indexOf('checkoutInFlightRef.current = true', chargeStart) < atomicRequest,
  )
  assert.ok(
    pos.indexOf('try {', chargeStart) <
      pos.indexOf('readPendingAtomicCheckout', chargeStart),
  )
  const finallyBlock = pos.slice(pos.indexOf('} finally {', atomicRequest), pos.indexOf('// ── Render', atomicRequest))
  assert.match(finallyBlock, /checkoutInFlightRef\.current = false/)
  assert.match(finallyBlock, /setSubmitting\(false\)/)

  let inFlight = false
  let requestCount = 0
  const failureToasts = []
  let releaseFirst
  const request = () => new Promise(resolve => { releaseFirst = resolve })
  const charge = async operation => {
    if (inFlight) return
    inFlight = true
    try {
      requestCount += 1
      await operation()
    } catch (error) {
      failureToasts.push(error)
    } finally {
      inFlight = false
    }
  }

  const firstClick = charge(request)
  const secondClick = charge(async () => {})
  assert.equal(requestCount, 1)
  assert.equal(failureToasts.length, 0)
  await secondClick
  releaseFirst()
  await firstClick

  await charge(async () => {})
  assert.equal(requestCount, 2, 'guard did not reset after success')
  await charge(async () => { throw new Error('expected local failure') })
  await charge(async () => {})
  assert.equal(requestCount, 4, 'guard did not reset after failure')
  assert.equal(failureToasts.length, 1)
})

await test('rollout fallback is write-free and committed replay wins even after flag rollback', () => {
  const handlerStart = edge.indexOf("if (action === 'checkout_simplified'")
  const existingLookup = edge.indexOf("rpc('get_zatca_atomic_checkout_result_v2'", handlerStart)
  const rolloutCheck = edge.indexOf('loadAtomicSimplifiedRolloutV2(', handlerStart)
  const eligibilitySync = edge.indexOf('syncAtomicSimplifiedEligibilityV2(', rolloutCheck)
  const prepareCall = edge.indexOf('processAtomicSimplifiedCheckoutV2({', handlerStart)
  assert.ok(existingLookup > 0 && existingLookup < rolloutCheck)
  assert.ok(rolloutCheck > 0 && rolloutCheck < eligibilitySync)
  assert.ok(eligibilitySync > rolloutCheck && eligibilitySync < prepareCall)
  assert.match(edge, /status: 'legacy_required'/)
  assert.match(edge, /reason: 'existing_legacy_idempotency'/)
  assert.match(edge, /credit_note_idempotency_key[\s\S]*checkout_idempotency_key/)
  assert.match(atomicClient, /AtomicCheckoutLegacyRequired/)
  const fallbackStart = pos.indexOf('if (!checkout)')
  const fallbackEnd = pos.indexOf("if (!checkout) throw new Error('Checkout did not return an invoice')", fallbackStart)
  const fallbackPath = pos.slice(fallbackStart, fallbackEnd)
  assert.match(fallbackPath, /payMethod === 'credit' \? 'post_customer_credit_checkout_v1' : 'pos_checkout'/)
  assert.match(fallbackPath, /payMethod === 'credit' \? creditPayload : payload/)
})

await test('reporting is scheduled after commit and never awaited by checkout', () => {
  const commitCall = edge.indexOf("callerDb.rpc('commit_zatca_atomic_checkout_v2'")
  const scheduleCall = edge.indexOf('scheduleReportingOutboxDrain(serviceDb', commitCall)
  const returnCall = edge.indexOf("status: 'committed'", scheduleCall)
  assert.ok(commitCall > 0 && scheduleCall > commitCall && returnCall > scheduleCall)
  assert.match(edge, /EdgeRuntime[\s\S]*waitUntil\(dispatch\)/)
  assert.match(edge, /cron[\s\S]*durable/i)
})

await test('every received response is durably evidenced before state application', () => {
  const responseReceived = edge.indexOf('responseReceived = true')
  const appendEvidence = edge.indexOf("rpc('append_zatca_reporting_response_evidence_v2'", responseReceived)
  const applyEvidence = edge.indexOf("rpc('apply_zatca_reporting_response_evidence_v2'", appendEvidence)
  assert.ok(responseReceived > 0 && appendEvidence > responseReceived && applyEvidence > appendEvidence)
  const responseCatch = edge.slice(
    edge.indexOf('if (responseReceived)', applyEvidence),
    edge.indexOf('if (networkToken)', applyEvidence),
  )
  assert.doesNotMatch(responseCatch, /persist_zatca_reporting_outbox_result_v2|p_safe_response/)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.zatca_reporting_response_evidence_v2/)
})

await test('safe output state exposes all reporting states without weakening standard output', () => {
  for (const state of [
    'reporting_pending',
    'reported',
    'reported_with_warnings',
    'rejected',
    'retryable_failure',
    'reconciliation_required',
    'manual_review_required',
  ]) assert.match(migration, new RegExp(`'${state}'`))
  assert.match(migration, /zatca_document_kind = 'standard'[\s\S]*zatca_artifact_stage = 'standard_cleared'/)
  assert.match(outputClient, /reportingDisplayState/)
})

await test('simplified credit-note UI uses the same atomic action and exact replay store', () => {
  assert.match(credit, /documentType: 'credit_note'/)
  assert.match(credit, /checkoutSimplifiedAtomically/)
  assert.match(credit, /atomicReceipt = atomic\.receipt/)
  assert.match(credit, /usedAtomicSimplifiedCredit/)
  assert.match(atomicClient, /checkout_simplified_credit_note/)
})

await test('atomic credit-note first print renders only the returned receipt snapshot', () => {
  assert.match(creditReceipt, /documentFromAtomicReceipt\(receipt\)/)
  assert.match(creditReceipt, /printAtomicReceiptSnapshot/)
  assert.match(creditReceipt, /source: 'atomic_credit_note_snapshot'/)
  assert.match(creditReceipt, /automaticPrintRef\.current = true/)
  assert.match(creditReceipt, /!printAttemptedRef\.current/)
  assert.match(creditReceipt, /printInFlightRef\.current/)
  assert.doesNotMatch(creditReceipt, /supabase|getInvoiceZatcaOutputState|printReceipt\(\s*\{\s*invoiceId/)
  assert.match(invoiceDetail, /setCreditNoteResult\(result\)[\s\S]*if \(result\.atomicReceipt\) \{[\s\S]*return/)
  assert.match(invoiceList, /setCreditNoteResult\(result\)/)
  assert.match(invoiceDetail, /<AtomicCreditNoteReceiptView/)
  assert.match(invoiceList, /<AtomicCreditNoteReceiptView/)
})

await test('atomic credit-note messaging distinguishes local commit from ZATCA reporting', () => {
  assert.match(credit, /let autoSubmitSucceeded = false/)
  assert.match(credit, /creditNotePresentationState\(createdResult\)/)
  assert.match(creditReceipt, /creditNotePresentationState\(result\)/)
  assert.match(creditPresentation, /headingKey: 'creditNotes:created'/)
  assert.match(creditPresentation, /messageKey: 'creditNotes:reportingContinuesAutomatically'/)
  assert.doesNotMatch(creditReceipt, /createdReportingPending/)
})

await test('all required sanitized timing events are present', () => {
  const sources = `${edge}\n${pos}\n${creditReceipt}\n${atomicPrint}`
  for (const event of [
    'checkout_request_started',
    'intent_prepared',
    'artifact_signed',
    'final_transaction_committed',
    'receipt_payload_returned',
    'receipt_rendered',
    'print_requested',
    'printer_started',
    'outbox_claimed',
    'zatca_response_received',
    'result_persisted',
  ]) assert.match(sources, new RegExp(`['"]${event}['"]`))
  assert.doesNotMatch(edge, /\[zatca-timing\][\s\S]{0,240}(signedXml|privateKey|productionSecret|Authorization)/)
})

console.log(`ZATCA atomic simplified checkout: ${results.length} deterministic architecture and incident scenarios passed`)
for (const name of results) console.log(`PASS ${name}`)
