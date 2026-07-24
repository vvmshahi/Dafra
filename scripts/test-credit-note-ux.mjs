import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  atomicCheckoutStorageKey,
  isLegacyBranchCreditNoteStorageKey,
  legacyBranchCreditNoteStorageKey,
  pendingAtomicCheckoutMatchesScope,
  removeObsoleteCreditNoteStorageEntries,
  resolveScopedAtomicCheckout,
} from '../src/lib/zatca/atomicCheckoutScope.mjs'
import { creditNotePresentationState } from '../src/lib/zatca/creditNotePresentation.mjs'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const json = path => JSON.parse(read(path))

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries)
  }
  get length() {
    return this.values.size
  }
  key(index) {
    return [...this.values.keys()][index] ?? null
  }
  getItem(key) {
    return this.values.get(key) ?? null
  }
  setItem(key, value) {
    this.values.set(key, String(value))
  }
  removeItem(key) {
    this.values.delete(key)
  }
}

const pendingB2C = creditNotePresentationState({
  documentKind: 'simplified',
  invoiceStatus: 'pending',
  finalizationStatus: 'locally_finalized',
  artifactStage: 'simplified_final',
  reportingDisplayState: 'reporting_pending',
  canPrint: true,
})
assert.equal(pendingB2C.headingKey, 'creditNotes:created')
assert.equal(pendingB2C.messageKey, 'creditNotes:reportingContinuesAutomatically')
assert.equal(pendingB2C.printAllowed, true)
assert.equal(pendingB2C.finalSuccess, true)

const reportedB2C = creditNotePresentationState({
  documentKind: 'simplified',
  invoiceStatus: 'reported',
  finalizationStatus: 'reported',
  artifactStage: 'simplified_final',
  reportingDisplayState: 'reported',
  canPrint: true,
})
assert.equal(reportedB2C.headingKey, 'creditNotes:created')
assert.equal(reportedB2C.statusKey, 'creditNotes:reportedToZatca')
assert.equal(reportedB2C.printAllowed, true)

const rejectedB2C = creditNotePresentationState({
  documentKind: 'simplified',
  invoiceStatus: 'failed',
  finalizationStatus: 'reporting_failed',
  artifactStage: 'simplified_final',
  reportingDisplayState: 'rejected',
  canPrint: true,
})
assert.equal(rejectedB2C.headingKey, 'creditNotes:created')
assert.equal(rejectedB2C.messageKey, 'creditNotes:reportingRejected')
assert.equal(rejectedB2C.localCreationAcknowledged, true)
assert.equal(rejectedB2C.printAllowed, true)

const reconciliationB2C = creditNotePresentationState({
  documentKind: 'simplified',
  invoiceStatus: 'pending',
  finalizationStatus: 'locally_finalized',
  artifactStage: 'simplified_final',
  reportingDisplayState: 'reconciliation_required',
  reconciliationRequired: true,
  canPrint: true,
})
assert.equal(reconciliationB2C.headingKey, 'creditNotes:created')
assert.equal(reconciliationB2C.messageKey, 'creditNotes:reportingRequiresReconciliation')
assert.equal(reconciliationB2C.localCreationAcknowledged, true)

const provisionalB2B = creditNotePresentationState({
  documentKind: 'standard',
  invoiceStatus: 'pending',
  finalizationStatus: 'clearance_pending',
  artifactStage: 'standard_provisional',
  reportingDisplayState: 'clearance_pending',
  canPrint: true,
})
assert.equal(provisionalB2B.headingKey, 'creditNotes:waitingForClearance')
assert.equal(provisionalB2B.messageKey, 'creditNotes:availableAfterClearance')
assert.equal(provisionalB2B.printAllowed, false)
assert.equal(provisionalB2B.finalSuccess, false)

const clearedB2B = creditNotePresentationState({
  documentKind: 'standard',
  invoiceStatus: 'cleared',
  finalizationStatus: 'cleared_final',
  artifactStage: 'standard_cleared',
  reportingDisplayState: 'cleared',
  canPrint: true,
})
assert.equal(clearedB2B.headingKey, 'creditNotes:createdAndCleared')
assert.equal(clearedB2B.statusKey, 'creditNotes:clearedByZatca')
assert.equal(clearedB2B.printAllowed, true)
assert.equal(clearedB2B.finalSuccess, true)

for (const retryAvailable of [true, false]) {
  const failedB2B = creditNotePresentationState({
    documentKind: 'standard',
    invoiceStatus: 'failed',
    finalizationStatus: 'clearance_failed',
    artifactStage: 'standard_provisional',
    reportingDisplayState: 'clearance_failed',
    canPrint: true,
    retryAvailable,
  })
  assert.equal(failedB2B.headingKey, 'creditNotes:clearanceFailed')
  assert.equal(
    failedB2B.messageKey,
    retryAvailable
      ? 'creditNotes:clearanceFailedRetryable'
      : 'creditNotes:clearanceFailedReview',
  )
  assert.equal(failedB2B.printAllowed, false)
  assert.equal(failedB2B.finalSuccess, false)
}

const branch = '371dee75-6e46-496e-89e7-1a7492b51a3c'
const inv0830 = 'b1e04bc9-792d-4d89-ad21-f737337aa460'
const invoiceA = 'invoice-a'
const invoiceB = 'invoice-b'
const invoiceC = 'invoice-c'
const legacyKey = legacyBranchCreditNoteStorageKey(branch)
const posKey = atomicCheckoutStorageKey(branch, 'invoice')
const scopedA = atomicCheckoutStorageKey(branch, 'credit_note', invoiceA)
const local = new MemoryStorage([
  [legacyKey, JSON.stringify({ checkout: { original_invoice_id: inv0830 } })],
  [posKey, 'valid-pos-pending'],
  [scopedA, 'valid-scoped-credit-note'],
])
const session = new MemoryStorage([
  [legacyKey, JSON.stringify({ checkout: { original_invoice_id: inv0830 } })],
  ['unrelated-session-key', 'keep'],
])
assert.equal(isLegacyBranchCreditNoteStorageKey(legacyKey), true)
assert.deepEqual(removeObsoleteCreditNoteStorageEntries(local), [legacyKey])
assert.deepEqual(removeObsoleteCreditNoteStorageEntries(session), [legacyKey])
assert.equal(local.getItem(legacyKey), null)
assert.equal(session.getItem(legacyKey), null)
assert.equal(local.getItem(posKey), 'valid-pos-pending')
assert.equal(local.getItem(scopedA), 'valid-scoped-credit-note')
assert.equal(session.getItem('unrelated-session-key'), 'keep')

const pendingFor = (invoiceId, branchId = branch) => ({
  idempotencyKey: `idem-${invoiceId}`,
  cartFingerprint: 'a'.repeat(64),
  documentType: 'credit_note',
  scopeId: invoiceId,
  branchId,
  checkout: {
    original_invoice_id: invoiceId,
    idempotency_key: `idem-${invoiceId}`,
    items: [{ original_invoice_item_id: `line-${invoiceId}`, quantity: 1 }],
  },
})
assert.equal(
  pendingAtomicCheckoutMatchesScope(
    pendingFor(invoiceA),
    'credit_note',
    invoiceA,
    branch,
  ),
  true,
)
assert.equal(
  pendingAtomicCheckoutMatchesScope(
    pendingFor(invoiceA),
    'credit_note',
    invoiceB,
    branch,
  ),
  false,
)
assert.equal(
  pendingAtomicCheckoutMatchesScope(
    pendingFor(invoiceA, 'other-branch'),
    'credit_note',
    invoiceA,
    branch,
  ),
  false,
)

// Two successful scoped requests cannot affect a third invoice.
const sharedTabs = new MemoryStorage()
for (const invoiceId of [invoiceA, invoiceB]) {
  sharedTabs.setItem(
    atomicCheckoutStorageKey(branch, 'credit_note', invoiceId),
    JSON.stringify(pendingFor(invoiceId)),
  )
}
const thirdPayload = {
  original_invoice_id: invoiceC,
  idempotency_key: 'idem-invoice-c',
  items: [{ original_invoice_item_id: 'line-invoice-c', quantity: 1 }],
}
const thirdCheckout = resolveScopedAtomicCheckout(
  pendingFor(invoiceA),
  thirdPayload,
  'credit_note',
  invoiceC,
  branch,
)
assert.equal(thirdCheckout.original_invoice_id, invoiceC)
assert.equal(thirdCheckout.idempotency_key, 'idem-invoice-c')
assert.equal(
  sharedTabs.getItem(atomicCheckoutStorageKey(branch, 'credit_note', invoiceC)),
  null,
)

// Exact same-invoice response-loss replay remains durable.
const sameInvoiceReplay = resolveScopedAtomicCheckout(
  pendingFor(invoiceA),
  { original_invoice_id: invoiceA, idempotency_key: 'new-key', items: [] },
  'credit_note',
  invoiceA,
  branch,
)
assert.equal(sameInvoiceReplay.idempotency_key, `idem-${invoiceA}`)

// Full and partial selections both bind the current immutable original ID.
for (const items of [
  [{ original_invoice_item_id: 'partial-line', quantity: 1 }],
  [
    { original_invoice_item_id: 'full-line-1', quantity: 2 },
    { original_invoice_item_id: 'full-line-2', quantity: 3 },
  ],
]) {
  const checkout = resolveScopedAtomicCheckout(
    null,
    { original_invoice_id: invoiceC, idempotency_key: 'current', items },
    'credit_note',
    invoiceC,
    branch,
  )
  assert.equal(checkout.original_invoice_id, invoiceC)
  assert.deepEqual(checkout.items, items)
}

// Duplicate numbers and independent browser tabs are isolated by branch + ID.
assert.notEqual(
  atomicCheckoutStorageKey('branch-a', 'credit_note', 'invoice-1'),
  atomicCheckoutStorageKey('branch-b', 'credit_note', 'invoice-2'),
)
const tabAKey = atomicCheckoutStorageKey(branch, 'credit_note', invoiceA)
const tabBKey = atomicCheckoutStorageKey(branch, 'credit_note', invoiceB)
assert.notEqual(tabAKey, tabBKey)
sharedTabs.setItem(tabAKey, JSON.stringify(pendingFor(invoiceA)))
sharedTabs.setItem(tabBKey, JSON.stringify(pendingFor(invoiceB)))
assert.equal(JSON.parse(sharedTabs.getItem(tabAKey)).scopeId, invoiceA)
assert.equal(JSON.parse(sharedTabs.getItem(tabBKey)).scopeId, invoiceB)

const creditModal = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const resultView = read('src/pages/invoices/AtomicCreditNoteReceiptView.tsx')
const atomicClient = read('src/lib/zatca/atomicCheckout.ts')
const invoiceList = read('src/pages/invoices/InvoicesPage.tsx')
const invoiceDetail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const presentationSource = read('src/lib/zatca/creditNotePresentation.mjs')
const currentSchema = read('supabase/migrations/20260721000100_dafra_current_schema_and_security.sql')

const trackedPhysical = { product_id: 'product-1', track_stock: true, is_service: false, quantity: 1 }
const serviceLine = { product_id: 'service-1', track_stock: false, is_service: true, quantity: 1 }
const untrackedProduct = { product_id: 'product-2', track_stock: false, is_service: false, quantity: 1 }
const valueLine = { product_id: null, track_stock: false, is_service: false, quantity: 1 }
const requiresStockReturnChoice = lines => lines.some(
  line => line.quantity > 0 && line.product_id && line.track_stock && !line.is_service,
)
const returnStockValue = (lines, choice) =>
  requiresStockReturnChoice(lines) ? choice === true : false

assert.equal(requiresStockReturnChoice([trackedPhysical]), true)
assert.equal(returnStockValue([trackedPhysical], true), true)
assert.equal(returnStockValue([trackedPhysical], false), false)
assert.equal(requiresStockReturnChoice([serviceLine]), false)
assert.equal(requiresStockReturnChoice([untrackedProduct]), false)
assert.equal(requiresStockReturnChoice([valueLine]), false)
assert.equal(requiresStockReturnChoice([trackedPhysical, serviceLine]), true)

assert.match(creditModal, /cleanupObsoleteCreditNotePendingCheckouts\(\)/)
assert.match(creditModal, /window\.addEventListener\('storage', handleStorage\)/)
assert.match(creditModal, /inspectPendingAtomicCheckout\(\s*originalBranchId,\s*'credit_note',\s*originalInvoiceId/)
assert.match(creditModal, /inspectPendingAtomicCheckout\(\s*invoice\.branch_id,\s*'credit_note',\s*originalInvoiceId/)
assert.match(creditModal, /original_invoice_id: originalInvoiceId/)
assert.doesNotMatch(creditModal, /pending\?\.checkout \?\? payload/)
assert.match(atomicClient, /pending = \{ \.\.\.pending, branchId \}/)
assert.match(atomicClient, /rejectedReason: 'identity_mismatch'/)
assert.match(atomicClient, /removed: removeExactPendingKey\(key\)/)
assert.match(atomicClient, /removeObsoleteCreditNoteStorageEntries\(localStorage\)/)
assert.match(atomicClient, /removeObsoleteCreditNoteStorageEntries\(sessionStorage\)/)
assert.match(creditModal, /if \(!import\.meta\.env\.DEV\) return/)
assert.doesNotMatch(
  creditModal.slice(
    creditModal.indexOf("console.info('[credit-note atomic retry]'"),
    creditModal.indexOf('const QUICK_REASONS'),
  ),
  /qr|xml|signature|customer|secret/i,
)
assert.match(creditModal, /useState<boolean \| null>\(null\)/)
assert.match(
  creditModal,
  /line\.item\.product_id && line\.item\.track_stock && !line\.item\.is_service/,
)
assert.match(creditModal, /hasEligibleStockLines && stockReturnChoice === null/)
assert.match(
  creditModal,
  /return_stock: hasEligibleStockLines \? stockReturnChoice === true : false/,
)
assert.match(creditModal, /stockReturnChoiceMissing[\s\S]*createDisabled/)
assert.match(creditModal, /role="radio"/)

const creditFunctionStart = currentSchema.indexOf(
  'FUNCTION "public"."create_partial_credit_note"("p_payload" "jsonb")',
)
const creditFunctionEnd = currentSchema.indexOf(
  'ALTER FUNCTION "public"."create_partial_credit_note"',
  creditFunctionStart,
)
const creditFunction = currentSchema.slice(creditFunctionStart, creditFunctionEnd)
const replayReturnPosition = creditFunction.indexOf("'idempotent_replay', true")
const stockUpdatePosition = creditFunction.indexOf('UPDATE public.products')
assert.ok(replayReturnPosition > 0 && stockUpdatePosition > replayReturnPosition)
assert.match(creditFunction, /COALESCE\(v_line\.track_stock, FALSE\) IS TRUE/)
assert.match(creditFunction, /COALESCE\(v_line\.is_service, FALSE\) IS FALSE/)
assert.match(creditFunction, /return_quantity > remaining_quantity \+ 0\.0005/)

assert.match(invoiceList, /<AtomicCreditNoteReceiptView\s+result=\{creditNoteResult\}/)
assert.match(invoiceDetail, /<AtomicCreditNoteReceiptView\s+result=\{creditNoteResult\}/)
assert.match(resultView, /creditNotePresentationState\(result\)/)
assert.match(resultView, /disabled=\{printing \|\| !printReady\}/)
assert.match(resultView, /receipt \? documentFromAtomicReceipt\(receipt\) : null/)
assert.match(resultView, /printReceiptInHiddenFrame\(result\.creditNoteId\)/)
assert.doesNotMatch(resultView, /createdReportingPending/)
assert.doesNotMatch(presentationSource, /customer/i)

const en = json('src/localization/locales/en/creditNotes.json')
const ar = json('src/localization/locales/ar-SA/creditNotes.json')
const requiredKeys = [
  'created',
  'reportingContinuesAutomatically',
  'reportedToZatca',
  'reportingRejected',
  'reportingRequiresReconciliation',
  'waitingForClearance',
  'availableAfterClearance',
  'createdAndCleared',
  'clearedByZatca',
  'clearanceFailed',
  'clearanceFailedRetryable',
  'clearanceFailedReview',
  'stockReturnQuestion',
  'stockReturnQuestionHint',
  'stockReturnYes',
  'stockReturnYesDescription',
  'stockReturnNo',
  'stockReturnNoDescription',
  'stockReturnChoiceRequired',
]
for (const key of requiredKeys) {
  assert.equal(typeof en[key], 'string', `missing English credit-note key ${key}`)
  assert.ok(en[key].trim(), `empty English credit-note key ${key}`)
  assert.equal(typeof ar[key], 'string', `missing Arabic credit-note key ${key}`)
  assert.ok(ar[key].trim(), `empty Arabic credit-note key ${key}`)
}
assert.equal(en.created, 'Credit note created')
assert.notEqual(ar.created, en.created)

for (const source of [
  creditModal,
  resultView,
  atomicClient,
  invoiceList,
  invoiceDetail,
  presentationSource,
]) {
  assert.doesNotMatch(source, /INV-0826|INV-0827/)
}

console.log('Credit-note B2C/B2B UX, localization, and retry-storage hardening checks passed')
