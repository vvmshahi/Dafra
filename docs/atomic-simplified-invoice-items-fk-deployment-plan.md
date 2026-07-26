# Atomic simplified checkout `invoice_items` FK deployment plan

## Scope and compatibility

The required release contains:

1. database migration
   `20260726000600_fix_atomic_product_unit_parent_identity.sql`;
2. the updated `zatca-submit` Edge Function error contract.

No frontend deployment is required. Client contract `2.1.0`, request fields,
successful receipt shape, classification, totals, VAT, numbering, payments,
stock, register checks, and ZATCA chain behavior are unchanged. The Edge change
only affects failure responses. The database change is compatible with both
atomic and non-atomic calls: `INSERT ... RETURNING` returns the candidate ID
unchanged outside atomic context and the trigger-reserved ID inside it.

This plan authorizes no deployment by itself.

## Required order

1. Freeze changes to the checkout, atomic, ZATCA, and product-unit functions.
2. Run
   `scripts/sql/atomic-simplified-checkout-fk-fix/01_predeployment_read_only.sql`
   through an authorized read-only production operator.
3. Stop if any required function is missing, a registered definition differs,
   the expected pre-patch helper is not installed, the runtime contract is not
   `2.1.0`, the FK is not validated/immediate/non-deferrable, or any parent
   linkage/readiness check is unsafe.
4. Apply database migration `20260726000600` in its normal migration order.
5. Rerun the definition/hash, FK, orphan, scope-mismatch, readiness, intent,
   and reconciliation portions of the read-only verifier.
6. Deploy the reviewed `zatca-submit` Edge Function.
7. Verify Edge health and capability response before permitting a smoke test.
8. Perform one controlled smoke test.
9. Monitor the database, Edge, client-visible result, and reporting outbox
   before returning the branch to ordinary operation.

Database goes first so any request handled by the new Edge contract reaches a
corrected commercial function. The Edge deployment is operationally useful for
safe error categorization but does not substitute for the database fix.

## Pre-deployment read-only checks

The verifier must run inside `BEGIN TRANSACTION READ ONLY` and `ROLLBACK`. It
must confirm:

- required commercial, atomic prepare/commit, and snapshot signatures;
- registered commercial definition hashes and the expected corrected hash when
  run post-migration;
- runtime schema/client/Edge minimum versions;
- `invoice_items_invoice_id_fkey` definition, validation, immediacy, and
  non-deferrability;
- zero orphan invoice items and zero tenant/branch mismatches across items,
  payments, stock movements, and outbox rows;
- affected branch and tenant active state, branch atomic gate, production
  onboarding state, and current capability acknowledgement count;
- prepared/expired intent state and absence of a stale live intent that would
  interfere with the smoke-test idempotency key;
- committed-but-incomplete candidates, including item/payment/chain/outbox
  counts, snapshot/receipt parent linkage, and finalization state.

Do not paste output containing credentials, payloads, customer identity,
employee email, XML, signatures, or tokens.

## Controlled smoke test

Only an authorized operator may approve and perform the production smoke test:

1. Confirm the branch is open for a legitimate low-value sale and identify the
   authoritative open register through normal application operations.
2. Confirm there is no stale prepared intent and choose a fresh idempotency key.
3. Use walk-in simplified/B2C, one reviewed product-unit item, quantity one,
   cash, and the normal price. Do not alter price, VAT, stock, customer class,
   or branch settings for the test.
4. Submit exactly once through the current browser client.
5. If the client reports any error or times out, do not retry. Immediately
   inspect the invoice list and use the read-only result lookup to distinguish
   rollback from a lost response.
6. On success, verify one parent invoice; all items, payment, applicable stock
   movement, receipt snapshot, chain reservation, committed intent, and outbox
   row reference that same invoice ID.
7. Verify numbering, totals, tax, payment allocation, stock decrement, QR/
   printable receipt, chain counter, and reporting state match the established
   contract.

## Monitoring

For the deployment window, monitor:

- Edge 409 counts by safe code/category/stage and request ID;
- PostgreSQL SQLSTATE `23503` involving
  `invoice_items_invoice_id_fkey`;
- `ATOMIC_CHECKOUT_COMMERCIAL_PARENT_MISSING`;
- prepared, expired, failed, and committed intent counts;
- chain reservations and head progression;
- reporting outbox pending/retryable/blocked state;
- invoice finalization/reconciliation state;
- client errors where an invoice nevertheless exists.

Stop normal checkout rollout if the FK error recurs, the invariant fires, a
response is ambiguous, the chain does not advance exactly once, an orphan or
scope mismatch appears, reporting blocks, or any financial/stock/numbering
result differs.

## Two reconciliation candidates

The two previously observed committed-but-incomplete candidates must be
reviewed read-only and separately from this migration. For each candidate
determine:

- invoice ID and whether the parent exists;
- item and payment existence/counts;
- matching atomic intent ID/state;
- chain reservation existence/state;
- prepared snapshot and committed receipt presence and invoice-ID agreement;
- invoice finalization lifecycle/artifact/timestamp;
- reporting outbox existence/status.

An FK failure in preparation rolls back and cannot itself leave a committed
invoice. Therefore do not label either candidate as caused by this defect
without matching evidence. Do not include automatic repair SQL. Any repair,
void, refund, reporting retry, or chain reconciliation requires its own
reviewed operational decision.

## Rollback

The preferred rollback is forward recovery, because reverting to the stale
candidate behavior reintroduces a deterministic integrity failure.

If the database migration itself causes a verified regression:

1. stop the smoke test and checkout rollout;
2. preserve logs and read-only state;
3. disable no constraints and mutate no commercial rows;
4. restore the previously reviewed function definition and its registered hash
   only through a new, guarded, reviewed migration;
5. rerun grants, definition hash, FK, orphan/scope, and complete disposable
   regression verification before reopening traffic.

If only the Edge error contract regresses, redeploy the prior reviewed Edge
artifact while leaving the database correction in place. A frontend rollback
is not part of this release.

## Prohibited emergency actions

Do not disable, drop, defer, or weaken the FK; force legacy checkout; disable
atomic checkout as an unreviewed workaround; manually insert a missing parent;
delete invoices/items; edit numbering, totals, VAT, discounts, payments, stock,
classification, register sessions, intents, chain rows, snapshots, or outbox
rows; retry ZATCA; reuse a failed idempotency key blindly; or expose production
credentials and payloads.

## Exact stop conditions

Stop before deployment or smoke testing when:

- the installed function/hash is not the reviewed expected definition;
- migration order differs or a duplicate migration exists;
- the FK is missing, unvalidated, deferrable, deferred, or changed;
- orphan or scope-mismatch counts are nonzero;
- branch/tenant/readiness/gate/version checks are unsafe;
- a stale prepared intent or chain reservation can interfere;
- either reconciliation candidate is operationally ambiguous;
- local static, build, or disposable runtime gates are not green;
- production access would be required to resolve a code uncertainty;
- any proposed action changes financial, stock, register, numbering,
  classification, or chain behavior.
