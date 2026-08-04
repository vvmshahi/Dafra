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
branch eligibility. No migration or RPC was changed.

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

## Trading reconnect

The repair started from application SHA
`db207936598b8fb36e3e3b2914a6419f2e61c69f` on
`feature/customer-credit-receivables-20260803`. The current main SHA captured
before the repair was `549138965417c6343abf9775590464d17c0d9f4a`. Local and
remote migration history was already at `20260804000100`; no migration change
was required.

Trading Demo is tenant `ebf1144b-55ed-472a-99c9-23b5ee915351`, Branch
`14271653-b404-44bf-9f39-7e9927569c02`. Service Demo is Branch
`c30094d7-40ca-4d2e-833a-07aa18c4fa46` in the same tenant.

Trading's authoritative state remains `non_fiscal` because its current Sandbox
credential is failed and its historical credential is revoked. No failed
credential was reactivated, deleted, or copied from Service Demo. The existing
backend onboarding function now accepts only an authenticated Owner or Super
Admin for the exact Demo tenant and Trading Branch, while retaining its fixed
Sandbox endpoint and server-owned CSR/device/credential handling.

The Owner-area `Reconnect Sandbox` control shows safe business, Branch,
environment, and credential state. It never accepts an environment, endpoint,
credential, CSR owner, or Service Demo material from the browser. A fresh OTP
is entered interactively, never prefilled, logged, persisted, returned, or sent
to production; the field clears immediately after submission and duplicate
submits are disabled. The flow generates Trading's own simplified-capability
CSR when needed, obtains the compliance credential, submits compliance samples,
and activates the compliance-demo state only after successful server checks.

No current OTP was available in this environment, so onboarding, QR generation,
Sandbox response, status persistence, and retry acceptance remain owner-gated.

Changed Edge Functions:

| Function | Before | After | JWT |
| --- | ---: | ---: | --- |
| `zatca-onboard-sandbox-demo` | 19 | 20 | enabled |
| `zatca-validate-sandbox-demo` | 21 | 22 | enabled |
| `zatca-submit-sandbox-demo` | 16 | 16 | unchanged |
| `zatca-compliance` | 71 | 71 | unchanged |
| `zatca-submit` | 130 | 130 | unchanged |

Unauthenticated requests to both changed functions returned HTTP 401. No
production ZATCA function or endpoint was deployed or called.

## UI changes

- POS success modal: `max-w-md`, single-column customer/method summary, existing
  duplicate-submit/retry protection retained, one normalized unique action
  model, conditional print actions, and one full-width New sale action.
- The duplicate buttons came from the legacy print-action row rendering beside
  the newer conditional action matrix. The legacy row was removed; action IDs
  are deduplicated before the single matrix is rendered.
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
  Paid via, one Amount paid value, and Balance due without changing QR source.
- The duplicate Customer Credit amount was the customer-facing Initial payment
  amount repeated beside Amount paid. The Initial payment amount row was
  removed from detail, thermal, A4, preview/reprint, and PDF paths; the useful
  issuance tender remains as translated Paid via. The existing read model's
  allocation-state Amount paid and Balance due remain consistent across detail
  and reprint outputs.

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
- `npm run test:trading-sandbox-reconnect`
- unauthenticated HTTP 401 checks for both changed Sandbox Edge Functions

No migration changed for this patch. The existing QR
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

The current projection/print/reconnect repair is tested locally but is not yet
represented by that Preview deployment until the new verified commit is
deployed. This is not a production certification or a claim that either Demo
branch has completed an authenticated Sandbox submission.

Owner OTP stop condition: open Kubri → Settings → ZATCA for the exact `Kubri
Demo` business, select the `Kubri Trading Demo` Sandbox reconnect card, open
`Reconnect Sandbox`, and obtain a fresh current 6-digit OTP from the ZATCA
Developer Portal for the Trading Demo device. Enter it only in that control;
never paste it into chat or add it to code.

After OTP, verify Trading's own onboarding response, active compliance-demo
mode, QR, factual stored Sandbox response, refresh persistence, and safe retry.
Then use only authorized/disposable simplified Cash, Card, and Customer Credit
Sandbox invoices; verify thermal, A4, preview, reprint, PDF, mobile/desktop
widths, Arabic/RTL, and exact success-modal button counts. Service Demo must
remain unchanged. Standard/production clearance is not claimed because the
supported scope is simplified compliance validation.
