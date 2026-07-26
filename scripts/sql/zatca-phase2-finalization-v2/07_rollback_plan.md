# Rollback and emergency pause

## Schema execution prerequisites

Schema deployment is blocked unless the captured output from
`00_hosted_preflight.sql` matches the reviewed policy, grant, trigger,
protected-function, v2-object, singleton, and invoice-fingerprint contracts.
Policy drift is a hard stop; do not let `04` remove or weaken an unexpected
hosted policy, and do not let `04a` mask an unexpected grant. After each of
`01` through `05`, verify the database master,
simplified, and standard flags are all still false.

The allocator's current-token and active-lease checks are mandatory. The
isolated two-session allocator/lease fixture must pass before enablement. Static
source checks do not discharge that release gate.

There is no approved unattended schema-only window for the complete package.
After `04a`, an old frontend that requests legacy raw QR receives a PostgREST
column-permission error even when every feature flag is false. Deploy and
verify the dual Edge with its kill switch false, then the safe-reader frontend,
against the current schema. Use a controlled no-browser-traffic window to
install `01`, `02`, `03`, `04`, `04a`, and `05` in that order, then pass `06`
plus the disposable role fixture before reopening traffic. Running `04a`
immediately after `04` minimizes the interval in which newly added raw columns
inherit the legacy broad grant. The pre-schema Edge status fallback covers the
interval before `05`; afterward the safe-reader frontend uses the status action
backed by `get_zatca_output_state_v2`.

## Preferred rollback: pause, do not remove

1. Set the database master, simplified, and standard flags to `false` through a
   reviewed server-only change.
2. Set `ZATCA_IMMUTABLE_FINALIZATION_ENABLED=false` on the Edge deployment.
3. Confirm capabilities report disabled and the read-only status route still
   returns previously authoritative output.
4. Stop automatic retries. Reconcile every invoice in
   `reconciliation_required` by UUID, request hash, operation, and ZATCA result.
5. Do not change or delete committed artifacts, reservations, chain heads,
   counters, PIHs, payments, invoices, or responses.

The flag pause is the only routine rollback. Dropping columns or tables would
destroy audit/chain evidence and is not part of this package.

## Application rollback compatibility

- Rolling back the frontend while the database flag is enabled is prohibited:
  the capability insert guard will block old checkout before payment.
- Rolling back to a frontend that selects raw invoice fields is prohibited even
  with flags disabled after `04a`; pause traffic and redeploy a compatible
  safe-reader build. Do not restore table-wide browser SELECT as a routine
  rollback.
- Rolling back Edge while enabled is prohibited. Pause the database flag first,
  then the Edge kill switch.
- `04` and `04a` are intentionally restrictive and may run only after their
  hosted preflight contracts pass. Privilege broadening is not an emergency
  pause mechanism.

## Reconciliation procedure

For each ambiguous operation, record the invoice UUID, document kind, exact
stored artifact hash, stable idempotency identity, request-start time, claimant,
attempt, and any safely stored response. Determine the remote ZATCA outcome.
Never rebuild or resign. A reviewed repair function/change may persist the
already-returned response or mark a confirmed rejection retryable; this package
intentionally provides no browser or blind automatic bypass.

## Irreversibility warning

Locally-finalized simplified artifacts, provisional standard requests, cleared
standard artifacts, committed counters, and PIHs are immutable compliance
records. They are not rollback targets.
