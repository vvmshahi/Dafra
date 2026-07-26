# SUPERSEDED AND UNSAFE — DO NOT EXECUTE

This v1 package is retained for review history only. Use
`scripts/sql/zatca-phase2-finalization-v2/` after independent review.

# Phase 2 finalization contract (superseded v1)

## Ownership

The server owns final XML, XML hash, cryptographic signature/stamp, and the
Phase 2 QR. Browser pages may read a stored QR for display, but never generate a
replacement for a Phase 2 document or write `invoices.zatca_qr_code`.

## Two stages

Local finalization builds the existing XML, hash, signature, and QR using the
current server implementation, then persists the complete document atomically.
Network submission consumes that stored document and updates only reporting,
clearance, response, warning, and retry metadata.

For standard clearance, the current server implementation submits the stored
signed XML and does not consume or replace it with a separate cleared-XML
response field. Therefore the stored finalized XML/hash/signature/QR remain the
authoritative output object. If a future ZATCA response supplies a materially
different cleared document, that must be handled by a separate reviewed
compliance design; it must never silently overwrite this object.

## Output gates

- Simplified: output is enabled when `zatca_finalization_status = finalized`;
  reporting acknowledgment is not required.
- Standard: output is enabled only when `zatca_status = cleared`.
- Missing final QR never falls back to a browser-generated Phase 1 QR.

## Retry and reprint

Retries resend the stored signed XML/hash and reuse the stored QR/signature.
Reprints are read-only. Reporting or clearance failure cannot replace a
finalized compliance value.

## Legacy invoices

Rows with all four final values (`zatca_qr_code`, `zatca_xml`,
`zatca_xml_hash`, `zatca_signature`) may be classified finalized by metadata-only
state migration. Incomplete historical rows remain unavailable for final output;
they are never silently regenerated or backfilled.

## Rollout order

1. Review and apply the additive state migration.
2. Review and apply compliance-field ownership locks.
3. Deploy the server finalization/submission orchestration.
4. Deploy the read-only QR selector and output gates.
5. Run verification SQL and isolated first-issue/retry/reprint tests.
6. Enable the release flag for controlled preview traffic.

## Rollback limitation

Application orchestration can be disabled, but finalized compliance values and
server-only ownership must not be reverted or made client-writable.
