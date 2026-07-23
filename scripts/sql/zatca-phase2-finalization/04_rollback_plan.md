# SUPERSEDED / UNSAFE / DO NOT USE

Use `../zatca-phase2-finalization-v2/07_rollback_plan.md`.

# Phase 2 finalization rollback plan (superseded v1)

These scripts are review artifacts only. They must not be executed as part of a
frontend build or local test run.

## Safe rollback

- Disable the new POS finalization call and leave already-finalized invoices
  readable and printable according to their stored final values.
- Stop new reporting retries without deleting or changing signed XML, hashes,
  signatures, or QR values.
- Revert only application orchestration after verifying that no code path writes
  Phase 1 fallback data to a compliance column.

## Not safely reversible

- A signed document already issued to a customer must not be regenerated or
  replaced during rollback.
- Compliance values must not be restored to browser-writable permissions after
  finalization.
- Existing invoices must not be backfilled, re-signed, or have their QR/XML/hash
  values cleared.

## Recovery procedure

1. Disable new finalization orchestration behind the release flag.
2. Keep read-only loading of stored final QR/XML metadata enabled.
3. Preserve service-side status/error updates only.
4. Investigate failed finalization rows without modifying compliance values.
5. Re-enable output only after the immutable finalization checks pass.
