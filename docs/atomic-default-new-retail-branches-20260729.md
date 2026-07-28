# Atomic default for new retail branches

## Authoritative classification

`public.resolve_pos_checkout_document_internal_v1` is the private server
contract. `public.resolve_pos_checkout_document_v1` binds it to `auth.uid()` for
the POS. The classifier loads the active profile, tenant, branch, stored
production functionality map, scoped active customer, production connection,
readiness and current Atomic Simplified eligibility.

The browser supplies only the selected branch and customer identifiers. It
cannot supply the tenant, customer classification, document kind, capability or
checkout path.

Document classification is:

- walk-in: Simplified;
- Individual: Simplified;
- Business with a VAT number matching `^3[0-9]{13}3$`: Standard;
- Business without a qualifying VAT number: explicitly Simplified.

The Business-without-qualifying-VAT rule preserves Kubri's existing product
policy: Standard/B2B is offered for VAT-registered businesses, while other POS
sales receive Simplified documents. It is now a named server decision rather
than an accidental regex fallback.

## Capability matrix

| Stored functionality map | Simplified request | Standard request |
|---|---|---|
| `0100` Simplified only | allowed | `BRANCH_SIMPLIFIED_ONLY` |
| `1000` Standard only | `BRANCH_STANDARD_ONLY` | allowed through legacy clearance |
| `1100` Both | allowed | allowed through legacy clearance |
| unset | `INVOICE_CAPABILITY_NOT_CONFIGURED` | `INVOICE_CAPABILITY_NOT_CONFIGURED` |

A missing/disconnected production credential returns
`ZATCA_CONNECTION_REQUIRED`. Capability and customer failures occur before an
invoice, payment, stock or counter mutation.

`public.pos_checkout(jsonb)` reclassifies immediately before the commercial
transaction and verifies that the persisted invoice type matches the server
decision. It rejects direct legacy calls when the decision is Atomic, so the
browser cannot override the selected checkout path. `public.prepare_zatca_atomic_checkout_v2`
uses the same classifier and continues to reject Standard documents.

## New branch provisioning

Every branch inserted after migration `20260729000200` receives:

- an Atomic Simplified branch gate with `enabled = false`;
- a readiness row with status `blocked` and reason
  `awaiting_production_onboarding`.

The insert trigger covers first-branch provisioning, additional Owner branch
creation and any separate Super Admin insert path. It does not backfill or
update existing branches.

The migration also repairs the established additional-branch RPC's exact
historical `NOT =` PL/pgSQL typo so the existing Owner path can reach the insert
trigger. No other branch-creation behavior changes.

## Atomic enablement

A new Simplified-capable (`0100` or `1100`) branch becomes atomic without a
manual gate edit only after all existing eligibility checks pass:

- tenant and branch active and unsuspended;
- production credentials connected;
- chain head initialized;
- readiness approved by production onboarding;
- compatible schema, Edge and client versions;
- immutable and Simplified finalization enabled;
- global Atomic Simplified rollout enabled;
- current client acknowledgement;
- eligibility synchronizer enables the branch gate.

Before then, a connected branch with a valid Simplified capability uses the
explicit legacy Simplified fallback. An unconnected or unconfigured branch is
blocked rather than issuing an ungoverned fiscal document.

## Checkout and printing

- Eligible Simplified: Atomic Simplified Checkout v2. Invoice, items, payment,
  stock, chain, immutable QR and reporting outbox commit together. The returned
  snapshot is immediately printable; reporting remains asynchronous.
- Temporarily ineligible Simplified: the same Simplified document uses the
  approved legacy path. The server decision and eligibility reason remain
  available to the client.
- Standard: always the existing legacy clearance path. Atomic preparation
  rejects it. Customer output and auto-print remain unavailable until a cleared
  QR is persisted.
- Blocked: the POS shows localized capability/connection guidance and retains
  cart, payment and stock state.

## Existing branches

There is no existing-branch migration. No gate is enabled, no readiness row is
rewritten and no capability is inferred. A future production task must validate
and opt in existing branches separately.

## Validation

The guarded disposable runtime suite covers:

- actual first/additional branch provisioning;
- disabled gate/readiness defaults;
- `0100`, `1000`, `1100` and unset capability routing;
- walk-in, Individual, non-VAT Business and VAT Business decisions;
- atomic cash, card, split and customer sales;
- lost response, replay, conflicting replay and concurrent commit;
- stock-failure rollback;
- reporting rejection with immutable print availability;
- Standard legacy timeout, rejection, retry, successful-clearance and print
  gating state contracts (using isolated response fixtures, without an external
  ZATCA call);
- cross-branch, cross-tenant, anonymous, inactive-profile and browser-override
  boundaries.

Focused architecture, eligibility/readiness, POS, printing, product-unit,
TypeScript and production-build suites remain release gates.

## Production rollout and rollback

Production rollout must apply the forward migration before the compatible
frontend/Edge release, then validate controlled `0100`, `1000` and `1100`
branches. Existing production gates must not be bulk-enabled.

Rollback is operational rather than destructive:

1. disable the global Atomic Simplified flag to force allowed Simplified
   transactions to the legacy fallback;
2. retain the classification and capability enforcement;
3. do not delete gate/readiness rows or rewrite invoices;
4. revert application traffic only to a version that understands the same
   server error codes.

The migration itself should not be rolled back after new branches have been
created; its disabled provisioning rows are harmless and preserve auditability.
