# Sandbox ZATCA and POS Success Refinement — 2026-08-04

## Scope

This release-candidate patch is limited to the requested web functional repairs:

- keep Sandbox/Demo status factual and compact;
- remove repeated customer-facing Demo warning blocks from the POS success shell and invoice print/preview titles;
- make the POS success receipt compact and vertical;
- remove View invoice and WhatsApp from the POS success modal, leaving conditional
  print actions and one full-width New sale action;
- project Customer Credit only from the invoice-specific `credit_checkout`
  operation, then use authoritative receipts, tenders, and allocations for its
  payment summary;
- show Customer Credit controls only for active Business/B2B customers;
- keep ordinary Individual, Cash, Card, and Split sales out of the Customer
  Credit projection even when legacy AR rows exist;
- show Customer Credit status, initial payment, amount paid, and balance due in
  invoice detail, reprints, A4, and thermal output;
- present Customer credit as a translated payment badge independently of ZATCA status.

No checkout, invoice posting, inventory, payment, ZATCA Edge Function, migration,
Electron, mobile, production deployment, or main-branch changes were made.

## Remote Demo metadata and routing

Read-only linked-project inspection used project `bkbphkpqcxuejozayrsy` and did
not select or print credential material.

The Demo tenant is `Kubri Demo`, with these branches:

| Branch | Environment | Compliance-demo status | Credential status |
| --- | --- | --- | --- |
| Kubri Service Demo | sandbox | active | compliance |
| Kubri Trading Demo | sandbox | active | failed |
| Kubri Trading Demo | sandbox | disabled | revoked |

The Trading rows represent credential history; the failed/revoked state is not
reported as a successful Sandbox validation. The linked read-only
`get_zatca_demo_checkout_mode_v1` probe could not complete without an
authenticated active checkout profile and returned `CHECKOUT_PROFILE_NOT_ACTIVE`.
An authorized service-role metadata inspection of the internal classifier returned
`sandbox_compliance` for Service Demo and `non_fiscal` for Trading Demo. The
Trading result is the server-authoritative fallback caused by its failed active
credential row; the client does not relabel it as Sandbox. No credentials were
copied or changed.

No authenticated operator profile was available in this environment, so no real
Sandbox invoice mutation or submission was executed. No `Submitted`, `Reported`,
`Cleared`, or `Sandbox validated` claim is made without the stored Sandbox response.

## Focused repair

The previous client projection treated any positive invoice debit in
`customer_receivable_entries` as Customer Credit. The legacy
`ar_sync_posted_invoice_v1` trigger intentionally creates that invoice debit
for ordinary posted customer invoices as well, so this misclassified ordinary
Cash/Card/Split history.

The repaired discriminator is an exact row in
`customer_receivable_operations` with `action = 'credit_checkout'` and a
matching `response->>'invoice_id'`. The existing server RPC remains the
authoritative writer and already enforces active Business/B2B customer and
branch eligibility. No migration, RPC, or Edge Function was changed.

The POS now resolves customer type before rendering Customer Credit controls:
Walk-in and Individual customers do not see the credit panel and cannot retain
the credit payment method; Business customers continue through the existing
server eligibility result, including the disabled-policy state.

The success action matrix is now:

| Available output | Actions |
| --- | --- |
| Receipt and invoice | two equal print buttons on row one; full New sale on row two |
| Receipt only | Receipt and New sale as equal buttons |
| Invoice only | Invoice and New sale as equal buttons |
| No print action | full New sale |

View invoice, WhatsApp, raw mode text, and repeated Demo warnings remain absent
from the success modal.

## UI changes

- POS success modal: `max-w-md`, single-column customer/method summary, existing
  duplicate-submit/retry protection retained, conditional print actions, and one
  full-width New sale action.
- Removed View invoice and the raw `zatca_demo_non_fiscal`/mode row from the
  success modal. Toast failure actions may still link to invoice detail.
- Removed the success-modal WhatsApp button, handler, and icon path. WhatsApp
  remains available in its existing invoice-detail context.
- Removed the repeated bilingual Demo warning title from A4 and thermal
  rendering; Demo remains a concise non-print status badge in invoice detail.
- Invoice list payment badges now use the exact invoice-specific credit
  operation. Ordinary AR ledger rows no longer turn Individual or ordinary
  Cash/Card/Split invoices into Customer credit.
- Detail and document adapters consume the same read model. Initial settlement is
  limited to `checkout_initial` receipts; later allocations contribute to amount
  paid and balance due.
- A4 and thermal templates render translated Customer credit, payment status,
  initial payment/method, amount paid, and balance due without changing QR source.

## Verification

Passed:

- `npm run test:customer-credit-payment-projection`
- `npm run test:sandbox-zatca-pos-success-refinement`
- `npm run test:final-web-printing-refinements`
- `npm run test:thermal-receipt-layouts` with non-secret placeholder Supabase environment
- `npm test` with non-secret placeholder Supabase environment
- `npm run build`
- `git diff --check`
- mixed-history projection checks for ordinary Cash/Card/Split and genuine
  Customer Credit invoices

No migration or Edge Function version changed for this patch. The existing QR
path remains authoritative: Sandbox QR content comes only from the stored
Sandbox validation result, and production QR content comes only from the stored
output state.

No browser automation runner is installed in this worktree, so visual spacing,
responsive wrapping, authenticated Demo checkout, and real Sandbox response
remain manual acceptance items.

## Release state

The previous focused application commit `bf6c497dfea71c5d3eb4d37459228b43caeac2dd`
was deployed to Vercel Preview and reached `READY`:

- URL: https://dafra-4oea7ehyz-mohammed-shahin-v-vs-projects.vercel.app
- deployment: `dpl_FFsXjVxyyn3ppRFtu9rn5UDetamB`
- target: `preview`

The current projection/print repair is tested locally but is not yet represented
by that Preview deployment until the new verified commit is deployed. This is not
a production certification or a claim that either Demo branch has completed an
authenticated Sandbox submission.

Remaining manual gate: sign in as an authorized Demo operator, verify Service
Demo routing/status in the UI, exercise one disposable simplified cash Sandbox
validation and one disposable Customer Credit Sandbox validation where
authorized, confirm stored response/QR/retry behavior, and verify Walk-in,
Individual, and Business customer visibility plus POS success modal, invoice
detail, reprint, A4, and thermal output at mobile and desktop widths. Trading
Demo remains blocked until an approved owner-authorized credential repair
exists. Arabic/RTL behavior is covered by the existing translation/layout
paths but still needs visual manual confirmation.
