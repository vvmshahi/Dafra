export const ATOMIC_CHECKOUT_STORAGE_PREFIX = 'dafra:atomic-checkout:v2'
export const CREDIT_NOTE_SCOPE_MIGRATION_KEY =
  `${ATOMIC_CHECKOUT_STORAGE_PREFIX}:credit-note-scope-enforced`

export function atomicCheckoutStorageKey(
  branchId,
  documentType = 'invoice',
  scopeId,
) {
  const base = `${ATOMIC_CHECKOUT_STORAGE_PREFIX}:${branchId}:${documentType}`
  return scopeId ? `${base}:${encodeURIComponent(scopeId)}` : base
}

export function legacyBranchCreditNoteStorageKey(branchId) {
  return atomicCheckoutStorageKey(branchId, 'credit_note')
}

export function isLegacyBranchCreditNoteStorageKey(key) {
  if (typeof key !== 'string') return false
  const suffix = key.slice(ATOMIC_CHECKOUT_STORAGE_PREFIX.length + 1)
  const parts = suffix.split(':')
  return key.startsWith(`${ATOMIC_CHECKOUT_STORAGE_PREFIX}:`)
    && parts.length === 2
    && Boolean(parts[0])
    && parts[1] === 'credit_note'
}

export function removeObsoleteCreditNoteStorageEntries(storage) {
  const keys = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (isLegacyBranchCreditNoteStorageKey(key)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
  return keys
}

export function pendingAtomicCheckoutMatchesScope(
  pending,
  documentType = 'invoice',
  scopeId,
  branchId,
) {
  if (!pending
      || pending.documentType !== documentType
      || !pending.checkout
      || typeof pending.checkout !== 'object'
      || Array.isArray(pending.checkout)) return false

  if (!scopeId) return pending.scopeId == null
  if (pending.scopeId !== scopeId) return false
  if (branchId && pending.branchId !== branchId) return false

  return documentType !== 'credit_note'
    || pending.checkout.original_invoice_id === scopeId
}

export function resolveScopedAtomicCheckout(
  pending,
  currentCheckout,
  documentType = 'invoice',
  scopeId,
  branchId,
) {
  if (!currentCheckout
      || typeof currentCheckout !== 'object'
      || Array.isArray(currentCheckout)) {
    throw new Error('Atomic checkout payload is invalid')
  }
  if (documentType === 'credit_note'
      && (!scopeId || currentCheckout.original_invoice_id !== scopeId)) {
    throw new Error('Credit-note checkout original invoice does not match the open modal')
  }
  return pendingAtomicCheckoutMatchesScope(
    pending,
    documentType,
    scopeId,
    branchId,
  )
    ? pending.checkout
    : currentCheckout
}
