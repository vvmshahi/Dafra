# Atomic simplified checkout `invoice_items` FK root cause

## Incident summary and production evidence

On 2026-07-26 at 17:51 UTC (20:51 Asia/Riyadh), a browser POS walk-in
simplified checkout reached `zatca-submit` in `ap-south-1` and returned HTTP
409 after about 2.9 seconds. The response reported
`invoice_items_invoice_id_fkey` and `ATOMIC_SIMPLIFIED_CHECKOUT_FAILED`.
The sanitized correlation identifiers are:

- Supabase request: `019f9f8d-30b3-7a67-9491-e11660347ca0`
- Deno execution: `b576c6f7-47ea-456a-83de-dce13f2f456f`
- tenant: `630f6faf-fc0e-4523-a569-1179fe13de1a`
- branch: `371dee75-6e46-496e-89e7-1a7492b51a3c`

The request used client contract `2.1.0`, action `checkout_simplified`, source
`auto_checkout`, one product, quantity one, cash, and SAR 10.00. No credential,
token, customer identity, or complete payload is retained here.

## Exact runtime path

1. `POSPage.charge` builds the package-aware commercial payload and calls
   `checkoutSimplifiedAtomically`.
2. `src/lib/zatca/atomicCheckout.ts` invokes `zatca-submit` with
   `action=checkout_simplified`.
3. The Edge handler authorizes the branch, evaluates capability/readiness,
   and calls `processAtomicSimplifiedCheckoutV2`.
4. Edge calls `prepare_zatca_atomic_checkout_v2`. Preparation reserves the
   invoice identity and runs `public.pos_checkout` inside a PL/pgSQL exception
   subtransaction to construct a preview, then deliberately rolls that preview
   back.
5. `public.pos_checkout` sees product-unit fields and dispatches to
   `public.pos_checkout_with_product_units_v1(jsonb)`.
6. That helper inserts `public.invoices`, then `public.invoice_items`, optional
   `public.pos_stock_movements`, and `public.payments`.
7. After a signed artifact is stored, Edge calls
   `commit_zatca_atomic_checkout_v2`, which repeats the commercial transaction,
   compares the receipt snapshot, commits the chain reservation/head, finalizes
   the invoice, creates the reporting outbox row, and commits the intent.

The production failure occurred during step 6, at the first
`public.invoice_items` insert. Because it happened while
`prepare_zatca_atomic_checkout_v2` was constructing the preview, the PostgreSQL
statement and transaction rolled back before preparation could persist.

## ID lineage

| Stage | Pre-fix source | Value used | Result |
|---|---|---|---|
| Atomic reservation | `zatca_atomic_checkout_intents_v2.invoice_id` | Reserved UUID `R` | Authoritative atomic identity |
| Product-unit helper declaration | `v_invoice_id := gen_random_uuid()` | Candidate UUID `C` | `C` normally differs from `R` |
| Parent insert input | `invoices.id = v_invoice_id` | `C` | Passed to `INSERT` |
| Atomic identity trigger | `NEW.id := v_intent.invoice_id` | Replaces `C` with `R` | Persisted parent ID is `R` |
| Pre-fix parent result handling | no `RETURNING` clause | local variable remains `C` | Trigger output is not copied back |
| Child item insert | `invoice_items.invoice_id = v_invoice_id` | `C` | FK lookup fails because parent is `R` |
| Stock/payment writes | `v_invoice_id` | Would use `C` | Not reached after first item failure |
| Corrected parent handling | `RETURNING id INTO v_invoice_id` | local variable becomes `R` | All later writes use the parent row’s ID |

The divergence is therefore exactly between the `BEFORE INSERT` trigger and
the next statement in the product-unit helper. A PostgreSQL row trigger can
replace `NEW.id`, but it cannot mutate a caller's already-evaluated PL/pgSQL
local variable unless the `INSERT` returns the persisted value.

## Why earlier atomic invoices could succeed

Atomic checkout v2 originally installed a guarded rewrite into the then-current
commercial functions. In atomic context their local document ID was initialized
from `app.atomic_checkout_invoice_id`; outside atomic context it still used
`gen_random_uuid()`. The local ID and trigger-reserved ID therefore already
matched.

Commit `286ea59` (`feat: complete product unit commercial workflow`,
2026-07-26) introduced a new package-aware helper and replaced
`public.pos_checkout` with a dispatcher. The new helper restored the plain
`gen_random_uuid()` declaration and was installed after the atomic rewrite.
Quantity-only payloads continued to use the preserved
`pos_checkout_legacy_base_v1` definition, while explicit product-unit payloads
used the defective new helper. This explains earlier success and makes the
failure path-dependent rather than evidence of intermittent PostgreSQL
behavior.

## Reachability and determinism

Given a fresh atomic intent and an explicit product-unit payload, the defect is
deterministic: independently generated UUIDs differ for all practical purposes,
the trigger persists the reserved UUID, and the immediate FK rejects the stale
candidate. It is:

- globally reachable for branches eligible for atomic simplified checkout;
- specific to the product-unit/package dispatcher branch;
- not specific to the reported tenant or branch;
- not dependent on cash versus card, totals, VAT, concurrency, or timing;
- exposed by a fresh request and by preparation before final commit;
- bypassed by committed idempotent replay because replay returns the stored
  receipt without rerunning commercial insertion.

Prepared, expired, failed, fingerprint-mismatch, missing-intent, parent-conflict,
and lost-response states follow their existing guards. They do not repair or
weaken the parent identity invariant.

## Why the legacy Electron path remained functional

The current Electron build contains the same frontend as the browser. The
reported working Electron installation is older and its exact artifact is not
available, so its path cannot be proved from this repository. Two source-backed
compatibility explanations remain:

1. a quantity-only request dispatches to the preserved legacy-base helper,
   whose atomic-context ID rewrite remains intact; or
2. a sufficiently old client calls the non-atomic commercial RPC, where no
   atomic trigger context replaces the locally generated ID.

This fix does not introduce or force either fallback.

## Minimal correction and invariant

Migration
`20260726000600_fix_atomic_product_unit_parent_identity.sql` performs a guarded
definition-only correction:

```sql
INSERT INTO public.invoices (...)
VALUES (...)
RETURNING id INTO v_invoice_id;
```

Before any child write, it then asserts that an invoice with that ID, tenant,
and branch exists. Failure raises
`ATOMIC_CHECKOUT_COMMERCIAL_PARENT_MISSING`. The existing local variable is
thereafter authoritative for every item, stock movement, payment, returned
invoice ID, and audit reference.

The migration verifies the installed definition and registered MD5 before
replacement, requires an unambiguous single anchor, updates the function
contract hash, verifies its postconditions, and preserves owner, grants, search
path, calculations, numbering, stock behavior, and the FK. It does not add an
`ON CONFLICT` branch, nullable return path, legacy fallback, or constraint
change.

## Transaction and rollback semantics

`prepare_zatca_atomic_checkout_v2` runs its commercial preview in a PL/pgSQL
subtransaction and deliberately rolls the preview back after snapshot capture.
Any unexpected error, including SQLSTATE `23503`, aborts preparation instead of
being swallowed by the preview sentinel handler. Final commercial creation,
snapshot comparison, chain writes, invoice finalization, outbox insertion, and
intent commit all occur in the single transaction of
`commit_zatca_atomic_checkout_v2`. Any failure rolls that transaction back.

The disposable pre-fix runtime reproduced SQLSTATE `23503`; a read-only
follow-up found zero package invoices, zero matching intents, and zero orphan
items. The corrected runtime verified a committed parent, item, payment, stock
movement, receipt, reservation, outbox, and exact committed replay under one
invoice ID.

## Edge error contract

The pre-fix catch block returned sanitized-but-raw database text to the client
and assigned `ATOMIC_SIMPLIFIED_CHECKOUT_FAILED` for non-assertion errors. The
change classifies failures into safe code/category/stage values, returns a
generic merchant message and request ID, and records only safe classification
metadata in the audit event. It does not log or return payloads, prices, XML,
credentials, headers, tokens, or customer data; it does not retry or fall back.

## Local package limitation

A plain `supabase db reset --local` is not a complete reconstruction of this
release. The migration directory depends on the separately packaged Phase 2 v2
SQL sequence. Without it, the atomic migration stops because
`public.zatca_finalization_runtime` is absent.

After the reviewed Phase 2 package and pre-product migrations are applied, the
clean baseline definition of `public.receive_product_stock(jsonb)` hashes to
`20676b116d9001c6eedf7179e5e9ba64`. The current product-unit migration expects
the production-aligned hash
`78c5524f0f0ccef32740ca5453aaaa68` and correctly stops with
`PRODUCT_UNITS_RECEIVING_LEGACY_DEFINITION_UNREVIEWED`. This is unrelated to
checkout parent identity.

Valid checkout testing therefore uses the reviewed product-unit migration body
from commit `286ea59`, whose POS helper is identical but whose receiving guard
accepts the clean baseline hash, followed by the corrective migration. No
receiving function, expected production hash, or reproducibility guard is
changed.

## Test evidence and remaining uncertainty

Static regression coverage proves the source lineage, bounded migration, Edge
contract, rollback model, dispatch/security/calculation invariants, and
read-only verifier. The disposable runtime covers one-item package checkout,
cash, exact parent/child/payment/stock/outbox/reservation linkage, replay,
prepared/expired/failed/conflict/lost-response cases, roles, standard and
legacy compatibility, numbering, totals, VAT, stock, receipt, chain, and
outbox behavior. The verifier confirms the FK remains validated, immediate,
and non-deferrable.

Remaining uncertainty is operational, not root-cause uncertainty:

- no production verifier has been run;
- the two committed-but-incomplete production candidates have not been
  classified and are not assumed to be caused by this rolled-back FK failure;
- the exact old Electron build is unavailable;
- deployment and a controlled production smoke test have not occurred.
