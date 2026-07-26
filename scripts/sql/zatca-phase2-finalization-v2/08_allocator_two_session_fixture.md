# Allocator two-session release fixture

This fixture is a mandatory release gate. It is not run by repository tests and
must never target production, staging with real invoices, or a developer's
normal local database.

Use an explicitly disposable PostgreSQL database whose name contains `test`,
`fixture`, or `disposable`. Apply `01` through `05`, enable the v2 flags only in
that disposable database, and create a new tenant/branch/invoice through the
normal fixture setup so the branch has no historical invoices or chain head.
Claim that invoice with `claim_zatca_finalization_v2`, retaining its returned
UUID token.

Run the two files in separate terminals, starting session A first:

```bash
psql "$ZATCA_V2_DISPOSABLE_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v invoice_id="<fixture invoice uuid>" \
  -v claim_token="<current claim token>" \
  -f scripts/sql/zatca-phase2-finalization-v2/fixtures/allocator_session_a.sql
```

```bash
psql "$ZATCA_V2_DISPOSABLE_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v invoice_id="<same fixture invoice uuid>" \
  -v claim_token="<same current claim token>" \
  -f scripts/sql/zatca-phase2-finalization-v2/fixtures/allocator_session_b.sql
```

Required evidence:

- A reports `allocated`; B waits and then reports `reused` with the identical
  reservation ID, counter, and previous hash.
- Exactly one head and one reservation exist for the fixture branch.
- A random/stale token and the current token after forced lease expiry both
  receive `STALE_CHAIN_CLAIM_TOKEN` without changing the reservation.
- After reclaim, the reservation token equals the newly returned claim token;
  the old token cannot allocate or commit and the new token can commit.
- A committed reservation keeps its original token, counter, previous hash,
  and committed hash and cannot be reassigned.

Capture both terminal logs and the final head/reservation queries. Destroy the
disposable database after review. Until this evidence exists, the corresponding
rows in `06_verification.sql` correctly remain `REVIEW`.
