export function atomicCheckoutStorageKey(
  branchId,
  documentType = 'invoice',
  scopeId,
) {
  const base = `dafra:atomic-checkout:v2:${branchId}:${documentType}`
  return scopeId ? `${base}:${encodeURIComponent(scopeId)}` : base
}

export function pendingAtomicCheckoutMatchesScope(
  pending,
  documentType = 'invoice',
  scopeId,
) {
  if (!pending
      || pending.documentType !== documentType
      || !pending.checkout
      || typeof pending.checkout !== 'object'
      || Array.isArray(pending.checkout)) return false

  if (!scopeId) return pending.scopeId == null
  if (pending.scopeId !== scopeId) return false

  return documentType !== 'credit_note'
    || pending.checkout.original_invoice_id === scopeId
}

export function resolveScopedAtomicCheckout(
  pending,
  currentCheckout,
  documentType = 'invoice',
  scopeId,
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
  return pendingAtomicCheckoutMatchesScope(pending, documentType, scopeId)
    ? pending.checkout
    : currentCheckout
}
