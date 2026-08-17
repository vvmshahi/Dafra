import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const atomicClient = read('src/lib/zatca/atomicCheckout.ts')
const edgePath = 'supabase/functions/zatca-submit/index.ts'

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]))
  }
  return value
}

function fingerprint(payload) {
  return createHash('sha256').update(JSON.stringify(stableValue(payload))).digest('hex')
}

function decideRetry({ saved, current }) {
  const currentFingerprint = fingerprint(current)
  const savedPayloadFingerprint = fingerprint(saved.checkout)
  return saved.cartFingerprint === currentFingerprint
    && saved.cartFingerprint === savedPayloadFingerprint
    ? { action: 'resume', currentFingerprint }
    : { action: 'start_fresh_required', currentFingerprint }
}

function checkout({
  idempotencyKey = 'attempt-a',
  customerId = null,
  sessionId = 'register-a',
  items = [{ source: 'catalogue', product_id: 'product-a', product_unit_id: 'unit-a', quantity: 1, unit_price: 10, tax_rate: 15 }],
} = {}) {
  return {
    branch_id: 'branch-a',
    customer_id: customerId,
    session_id: sessionId,
    payment_method: 'cash',
    amount_paid: null,
    note: null,
    idempotency_key: idempotencyKey,
    items,
  }
}

function savedRetry(payload, actorId = 'cashier-a') {
  return {
    idempotencyKey: payload.idempotency_key,
    cartFingerprint: fingerprint(payload),
    documentType: 'invoice',
    checkout: payload,
    actorId,
    registerSessionId: payload.session_id,
  }
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('only an exact current checkout resumes the saved idempotency attempt', () => {
  const current = checkout({ customerId: 'customer-b2c' })
  assert.equal(decideRetry({ saved: savedRetry(current), current }).action, 'resume')

  const b2b = checkout({ customerId: 'customer-b2b' })
  assert.equal(decideRetry({ saved: savedRetry(b2b), current: b2b }).action, 'resume')
})

test('a changed product, quantity, custom line, payment input, or cart order cannot replay', () => {
  const original = checkout({
    items: [
      { source: 'catalogue', product_id: 'tracked-product', product_unit_id: 'unit-a', quantity: 1, unit_price: 10, tax_rate: 15 },
      { source: 'custom', product_id: null, product_unit_id: null, name: 'Service', quantity: 1, unit_price: 5, tax_rate: 15 },
    ],
  })
  const saved = savedRetry(original)
  for (const current of [
    checkout({ items: [{ ...original.items[0], quantity: 2 }, original.items[1]] }),
    checkout({ items: [original.items[1], original.items[0]] }),
    { ...original, payment_method: 'card' },
    { ...original, items: [{ ...original.items[1], name: 'Different service' }] },
  ]) {
    assert.equal(decideRetry({ saved, current }).action, 'start_fresh_required')
  }
})

test('WebView reload preserves an exact retry but a restored old cart requires explicit fresh checkout', () => {
  const preReload = checkout({ customerId: 'customer-a' })
  const saved = savedRetry(preReload)
  assert.equal(decideRetry({ saved, current: structuredClone(preReload) }).action, 'resume')

  const restoredNewSale = checkout({ customerId: null, items: [{ source: 'catalogue', product_id: 'product-new', product_unit_id: 'unit-new', quantity: 1, unit_price: 7, tax_rate: 15 }] })
  assert.equal(decideRetry({ saved, current: restoredNewSale }).action, 'start_fresh_required')
})

test('a sign-out or register-session change never attaches a saved checkout to the new sale', () => {
  const prior = checkout({ customerId: 'customer-a', sessionId: 'register-before-logout' })
  const afterSignIn = checkout({ customerId: 'customer-a', sessionId: 'register-after-sign-in' })
  assert.equal(decideRetry({ saved: savedRetry(prior), current: afterSignIn }).action, 'start_fresh_required')
})

test('corrupt saved payload state cannot be replayed even if its stored fingerprint matches the live cart', () => {
  const current = checkout()
  const saved = savedRetry(current)
  saved.checkout = { ...saved.checkout, items: [{ ...saved.checkout.items[0], quantity: 99 }] }
  assert.equal(decideRetry({ saved, current }).action, 'start_fresh_required')
})

test('source contract preserves one safe local recovery path and server idempotency', () => {
  assert.match(pos, /currentPayloadFingerprint = persistedInvoiceCheckout[\s\S]*atomicCheckoutFingerprint\(payload\)/)
  assert.match(pos, /savedPayloadFingerprint = persistedInvoiceCheckout[\s\S]*atomicCheckoutFingerprint\(persistedInvoiceCheckout\.checkout\)/)
  assert.match(pos, /persistedInvoiceCheckout[\s\S]*!atomicRequested[\s\S]*cartFingerprint !== currentPayloadFingerprint/)
  assert.match(pos, /SavedCheckoutRecoveryDialog/)
  assert.match(pos, /discardPendingAtomicCheckout\([\s\S]*staleCheckoutRecovery\.branchId,[\s\S]*staleCheckoutRecovery\.idempotencyKey,[\s\S]*staleCheckoutRecovery\.savedFingerprint/)
  assert.match(pos, /checkoutKeyRef\.current = createCheckoutIdempotencyKey\(\)/)
  assert.match(pos, /savedCheckoutState: 'pending_local'/)
  assert.match(pos, /source: checkoutClientSource\(\)/)
  assert.doesNotMatch(pos, /if \(persistedInvoiceCheckout\) payload = persistedInvoiceCheckout\.checkout\n\s*atomicFingerprint/)
  assert.match(atomicClient, /export function discardPendingAtomicCheckout/)
  assert.match(atomicClient, /atomicCheckoutStorageKey\(branchId, documentType, scopeId\)/)
  assert.match(atomicClient, /actorId\?: string \| null/)
  assert.match(atomicClient, /registerSessionId\?: string \| null/)
  assert.equal(execFileSync('git', ['diff', 'origin/main...HEAD', '--', edgePath], { encoding: 'utf8' }), '')
})

for (const { name, fn } of tests) {
  fn()
  console.log(`ok - ${name}`)
}

console.log(`P0 saved checkout recovery tests passed (${tests.length})`)
