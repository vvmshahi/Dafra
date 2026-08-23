export function isUnpersistedSandboxReservation(reservation) {
  return reservation?.reservation_state === 'reserved'
    && !reservation?.invoice_hash
    && !reservation?.signed_xml
    && !reservation?.submission_payload
    && !reservation?.dispatched_at
}

export function sandboxReservationRecoveryAction(reservation) {
  if (reservation?.reservation_state === 'accepted') return 'committed'
  if (isUnpersistedSandboxReservation(reservation)) return 'cancel_before_dispatch'
  if (reservation?.invoice_hash && reservation?.signed_xml && reservation?.submission_payload
    && ['reserved', 'dispatched', 'ambiguous'].includes(reservation.reservation_state)) {
    return 'retain_for_idempotent_retry'
  }
  return 'manual_reconciliation_required'
}
