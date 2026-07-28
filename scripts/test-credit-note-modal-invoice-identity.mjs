import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  atomicCheckoutStorageKey,
  pendingAtomicCheckoutMatchesScope,
  resolveScopedAtomicCheckout,
} from '../src/lib/zatca/atomicCheckoutScope.mjs'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const creditModal = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const invoiceList = read('src/pages/invoices/InvoicesPage.tsx')
const invoiceDetail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const invoiceCache = read('src/lib/invoices/invoiceListCache.ts')
const atomicClient = read('src/lib/zatca/atomicCheckout.ts')

const branchId = '371dee75-6e46-496e-89e7-1a7492b51a3c'
const inv0830 = {
  id: 'b1e04bc9-792d-4d89-ad21-f737337aa460',
  number: 'INV-0830',
  branchId,
}
const inv0835 = {
  id: '7c4d8911-1542-4d66-956d-9ca4c8da17e9',
  number: 'INV-0835',
  branchId,
}

const oldCheckout = {
  original_invoice_id: inv0830.id,
  idempotency_key: 'idem-inv-0830',
  reason: 'Customer refund',
  items: [{ original_invoice_item_id: 'inv-0830-line', quantity: 1 }],
  refund_allocations: [{ method: 'cash', amount: 10 }],
}
const oldPending = {
  idempotencyKey: oldCheckout.idempotency_key,
  cartFingerprint: 'a'.repeat(64),
  documentType: 'credit_note',
  scopeId: inv0830.id,
  branchId,
  checkout: oldCheckout,
}
const currentCheckout = {
  original_invoice_id: inv0835.id,
  idempotency_key: 'idem-inv-0835',
  reason: 'Customer refund',
  items: [{ original_invoice_item_id: 'inv-0835-line', quantity: 1 }],
  refund_allocations: [{ method: 'card', amount: 25 }],
}

// Reopening the same original may replay its exact durable request.
assert.equal(
  resolveScopedAtomicCheckout(oldPending, oldCheckout, 'credit_note', inv0830.id, branchId),
  oldCheckout,
)

// Closing INV-0830 and opening INV-0835 cannot reuse any INV-0830 request state.
const secondSubmission = resolveScopedAtomicCheckout(
  oldPending,
  currentCheckout,
  'credit_note',
  inv0835.id,
  branchId,
)
assert.equal(secondSubmission.original_invoice_id, inv0835.id)
assert.equal(secondSubmission.idempotency_key, 'idem-inv-0835')
assert.deepEqual(secondSubmission.items, currentCheckout.items)
assert.deepEqual(secondSubmission.refund_allocations, currentCheckout.refund_allocations)
assert.notEqual(secondSubmission.idempotency_key, oldCheckout.idempotency_key)
assert.notDeepEqual(secondSubmission.items, oldCheckout.items)

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
assert.notEqual(fingerprint(secondSubmission), fingerprint(oldCheckout))
assert.equal(pendingAtomicCheckoutMatchesScope(oldPending, 'credit_note', inv0835.id, branchId), false)

// Pending credit-note durability is scoped by immutable invoice ID, not number.
assert.notEqual(
  atomicCheckoutStorageKey(branchId, 'credit_note', inv0830.id),
  atomicCheckoutStorageKey(branchId, 'credit_note', inv0835.id),
)
assert.match(
  atomicCheckoutStorageKey(branchId, 'credit_note', inv0835.id),
  new RegExp(`${inv0835.id}$`),
)

// Duplicate invoice numbers in different branches cannot share a pending key.
const duplicateNumberA = { id: 'duplicate-a', number: 'INV-0001', branchId: 'branch-a' }
const duplicateNumberB = { id: 'duplicate-b', number: 'INV-0001', branchId: 'branch-b' }
assert.equal(duplicateNumberA.number, duplicateNumberB.number)
assert.notEqual(
  atomicCheckoutStorageKey(duplicateNumberA.branchId, 'credit_note', duplicateNumberA.id),
  atomicCheckoutStorageKey(duplicateNumberB.branchId, 'credit_note', duplicateNumberB.id),
)

// Ordinary POS invoice pending storage retains its existing unscoped key.
assert.equal(
  atomicCheckoutStorageKey(branchId, 'invoice'),
  `dafra:atomic-checkout:v2:${branchId}:invoice`,
)
const invoicePending = {
  idempotencyKey: 'invoice-idem',
  cartFingerprint: 'b'.repeat(64),
  documentType: 'invoice',
  checkout: { idempotency_key: 'invoice-idem', items: [{ product_id: 'product-1' }] },
}
assert.equal(pendingAtomicCheckoutMatchesScope(invoicePending, 'invoice'), true)
assert.equal(
  resolveScopedAtomicCheckout(invoicePending, { items: [] }, 'invoice'),
  invoicePending.checkout,
)

// Selection, row reconciliation, and cache identity all use invoice.id.
assert.match(invoiceList, /const \[creditModalRow, setCreditModalRow\] = useState<InvoiceRow \| null>\(null\)/)
assert.match(invoiceList, /key=\{r\.id\}/)
assert.match(invoiceList, /setCreditModalRow\(r\)/)
assert.match(invoiceList, /key=\{creditModalRow\?\.id \?\? 'closed-credit-note-modal'\}/)
assert.match(invoiceCache, /new Map\(rows\.map\(row => \[row\.id, row\]\)\)/)
assert.match(invoiceCache, /existing\.id !== row\.id/)
assert.match(invoiceDetail, /<CreateCreditNoteModal\s+key=\{invoice\.id\}/)

// A close/open or changed invoice clears every transient modal state before loading.
for (const reset of [
  "setOriginalPayments([])",
  "setRefundableItems([])",
  "setReturnQuantities({})",
  "setIdempotencyKey('')",
  "setCartFingerprint('')",
  "setCreating(false)",
  "setSubmitting(false)",
  "setRefundMode('')",
  "setRefundCash('')",
  "setRefundCard('')",
]) {
  assert.ok(creditModal.includes(reset), `missing modal reset: ${reset}`)
}
assert.match(creditModal, /setModalInvoiceIdentity\(null\)/)
assert.match(
  creditModal,
  /inspectPendingAtomicCheckout\(\s*originalBranchId,\s*'credit_note',\s*originalInvoiceId/,
)
assert.match(
  creditModal,
  /persistPendingAtomicCheckout\([\s\S]*?\}, originalInvoiceId\)/,
)
assert.match(
  creditModal,
  /clearPendingAtomicCheckout\([\s\S]*?'credit_note',\s*originalInvoiceId,\s*\)/,
)
assert.doesNotMatch(creditModal, /\[open,\s*invoice,\s*isServiceBusiness\]/)

// Submit is guarded against a stale render and binds the payload to current invoice.id.
assert.match(creditModal, /modalInvoiceIdentity\.id !== currentInvoiceIdentity\.id/)
assert.match(creditModal, /modalInvoiceIdentity\.branchId !== currentInvoiceIdentity\.branchId/)
assert.match(creditModal, /modalInvoiceIdentity\.invoiceNumber !== currentInvoiceIdentity\.invoiceNumber/)
assert.match(creditModal, /setError\(t\('validation:creditNoteInvoiceChanged'\)\)/)
assert.match(creditModal, /original_invoice_id: originalInvoiceId/)
assert.match(
  creditModal,
  /resolveScopedAtomicCheckout\(\s*pending,\s*payload,\s*'credit_note',\s*originalInvoiceId,\s*invoice\.branch_id,\s*\)/,
)
assert.match(creditModal, /checkoutSimplifiedAtomically\(\{[\s\S]*?checkout: atomicPayload/)
assert.doesNotMatch(creditModal, /data-original-invoice-id=\{invoice\.id\}/)
assert.doesNotMatch(creditModal, /originalInvoiceIdentity', \{ id: invoice\.id \}/)
assert.match(creditModal, /\{invoice\.invoice_number\}/)
assert.doesNotMatch(creditModal, /pending\?\.checkout \?\? payload/)

// The storage client passes scope through persist/read/clear without changing POS callers.
assert.match(atomicClient, /atomicCheckoutStorageKey\(branchId, pending\.documentType, scopeId\)/)
assert.match(atomicClient, /pendingAtomicCheckoutMatchesScope\(\s*pending,\s*documentType,\s*scopeId,\s*branchId,/)
assert.match(atomicClient, /return inspectPendingAtomicCheckout\(branchId, documentType, scopeId\)\.pending/)

// The regression patch contains no production-data or historical-incident operation.
for (const source of [creditModal, invoiceList, invoiceDetail, invoiceCache, atomicClient]) {
  assert.doesNotMatch(source, /INV-0826|INV-0827/)
}

console.log('Credit-note modal invoice identity and stale-state regression checks passed')
