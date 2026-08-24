export const GENERATION_ERRORS = Object.freeze({
  POLICY_INVALID: 'GENERATION_POLICY_INVALID',
  VALIDATION_FAILED: 'GENERATION_VALIDATION_FAILED',
  QR_FAILED: 'GENERATION_QR_FAILED',
  FINALIZATION_FAILED: 'GENERATION_FINALIZATION_FAILED',
})

export function validateGenerationInvoiceSnapshot(snapshot) {
  const seller = snapshot?.seller
  const customer = snapshot?.customer
  const kind = snapshot?.zatca_invoice_type
  const family = snapshot?.parentSnapshot?.zatca_invoice_type ?? kind
  const total = Number(snapshot?.total)
  const tax = Number(snapshot?.tax_amount)

  if (!['simplified', 'standard', 'credit_note', 'debit_note'].includes(kind)) {
    throw new Error(GENERATION_ERRORS.VALIDATION_FAILED)
  }
  if (!seller?.business_name && !seller?.display_name) {
    throw new Error(GENERATION_ERRORS.VALIDATION_FAILED)
  }
  if (!/^\d{15}$/.test(String(seller?.vat_number ?? ''))) {
    throw new Error(GENERATION_ERRORS.VALIDATION_FAILED)
  }
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(tax) || tax < 0) {
    throw new Error(GENERATION_ERRORS.VALIDATION_FAILED)
  }
  if (family === 'standard' && customer?.customer_type === 'business'
      && !/^\d{15}$/.test(String(customer?.vat_number ?? ''))) {
    throw new Error(GENERATION_ERRORS.VALIDATION_FAILED)
  }
  if (['credit_note', 'debit_note'].includes(kind)) {
    if (!snapshot?.original_invoice_id || !snapshot?.invoice_reference || !snapshot?.credit_reason
      || !snapshot?.parentSnapshot || snapshot.parentSnapshot.fiscalRegimeAtIssue !== 'generation'
      || snapshot.parentSnapshot.lifecycleState !== 'generation_issued') {
      throw new Error(GENERATION_ERRORS.VALIDATION_FAILED)
    }
  } else if (snapshot?.original_invoice_id || snapshot?.credit_reason || snapshot?.invoice_reference) {
    throw new Error(GENERATION_ERRORS.VALIDATION_FAILED)
  }
  return { documentKind: kind, buyerVatRequired: family === 'standard' && customer?.customer_type === 'business' }
}
