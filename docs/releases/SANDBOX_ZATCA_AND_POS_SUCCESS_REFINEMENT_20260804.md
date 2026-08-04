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

No checkout, invoice posting, inventory, payment, Electron, mobile,
production deployment, or main-branch changes were made. The focused
Sandbox onboarding/validation Edge Functions and one function-only migration
were repaired and redeployed; no production ZATCA function or endpoint was
called.

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
was required. The fully tested application SHA is
`709f4fbe2a3638392e57d3c166330cdd03520f6f`.

Trading Demo is tenant `ebf1144b-55ed-472a-99c9-23b5ee915351`, Branch
`14271653-b404-44bf-9f39-7e9927569c02`. Service Demo is Branch
`c30094d7-40ca-4d2e-833a-07aa18c4fa46` in the same tenant.

Trading's authoritative state remains `non_fiscal` because its current Sandbox
credential is failed and its historical credential is revoked. The read-only
remote count is zero active Trading credentials, one historical row with a
compliance-demo flag, and two failed/revoked historical rows overall. No failed
credential was reactivated, deleted, renewed, or copied from Service Demo. The
backend onboarding function accepts only an authenticated Owner or Super Admin
for the exact Demo tenant and Trading Branch, while retaining its fixed Sandbox
endpoint and server-owned CSR/device/credential handling.

The Owner-area `Reconnect Sandbox` control shows safe business, Branch,
environment, and credential state. It never accepts an environment, endpoint,
credential, CSR owner, or Service Demo material from the browser. For this
Integration Sandbox repair, the official Sandbox OTP is held only in the
server-side Edge Function configuration and is never accepted from, returned
to, logged, or displayed by the browser. Production endpoints cannot receive
that value. The flow excludes failed/revoked rows, generates a fresh Trading
device keypair and CSR, verifies that the CSR public key belongs to that exact
private key before storage, obtains the compliance credential, submits
compliance samples, requests the Sandbox Production credential only after
compliance passes, verifies the returned certificate against the same fresh
private key, and activates only the complete chain.

No authenticated owner session was available in this environment, so onboarding,
QR generation, Sandbox response, status persistence, and retry acceptance remain
owner-gated. The fixed server-side OTP was not printed or used by this audit.

### Follow-up reconnect defect repair

The latest Preview exposed `TRADING_BRANCH_ID is not defined` from
`zatca-onboard-sandbox-demo` as HTTP 500. The authorization guard referenced the
identifier, but the function only declared the broader historical branch set;
it was neither an environment variable nor a request field. The server now
declares and validates the exact Trading Branch as trusted configuration, checks
the exact Demo tenant and active Sandbox Branch in the database, and rejects
every other tenant/Branch before onboarding. The service-role path is also
scope-checked before its bypass.

Unexpected implementation/configuration failures now return controlled
`SANDBOX_ONBOARDING_UNAVAILABLE` or `SANDBOX_RECONNECT_CONFIG_MISSING` results;
unauthorized scope returns `SANDBOX_RECONNECT_UNAUTHORIZED`, and malformed OTP
returns `SANDBOX_OTP_INVALID`. No stack trace or sensitive upstream material is
returned or logged.

Normal reconnect status selection excludes failed, revoked, and expired
credentials. Failed and revoked rows remain audit history and are not selected
by the onboarding function’s reconnect target. An explicit history ID is only
accepted for reconciliation inspection, never as a fresh renewal target. No
historical credential was deleted, copied, renewed, or submitted.

The reconnect failure was the upstream certificate/CSR signing-key mismatch
persisted on the failed Trading row during Sandbox Production credential
request. The repair adds safe server-side key-association checks at both fresh
CSR creation and returned-certificate acceptance. Mismatches fail closed with
`SANDBOX_DEVICE_IDENTITY_MISMATCH` or the existing production-key mismatch
error, before a credential can be stored or activated. The new migration keeps
the existing compliance-only mode and additionally recognizes only an active,
non-expired, complete Sandbox chain; it does not alter business rows.

The validator now treats a fully active Trading credential as an idempotent
successful connection and the UI completes the server-owned sequence through
Sandbox Production CSID and activation. Service Demo credentials remain
outside the exact Trading tenant/Branch scope.

Changed Edge Functions:

| Function | Before | After | JWT |
| --- | ---: | ---: | --- |
| `zatca-onboard-sandbox-demo` | 20 | 22 | enabled |
| `zatca-validate-sandbox-demo` | 21 | 23 | enabled |
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
- controlled reconnect configuration, scope, OTP, and historical-credential
  regression contracts
- fresh private-key/public-key/CSR association checks and production-certificate
  key-match rejection contracts
- local/remote migration parity through `20260804000200`
- remote application of `20260804000200_trading_sandbox_active_credential_mode.sql`
- function-only migration diff review: no invoice, checkout, ZATCA business,
  Atomic, Legacy, or existing business-row changes
- active credential mode contract and server-side production-CSID flow

The existing QR path remains authoritative: Sandbox QR content comes only from
the stored
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

The final tested application source is represented by Vercel Preview and
reached `READY`:

- URL: https://dafra-9m468lo97-mohammed-shahin-v-vs-projects.vercel.app
- deployment: `dpl_styeE7tfNjBJ3njvQP1h8XeWn1GU`
- target: `preview`
- application source SHA: `709f4fbe2a3638392e57d3c166330cdd03520f6f`

The focused reconnect repair Preview also reached `READY`:

- URL: https://dafra-4a85ttqkc-mohammed-shahin-v-vs-projects.vercel.app
- deployment: `dpl_uxuEAp7kdmpqAaKajcQuQibfu6fP`
- target: preview
- application source SHA: `72a2c70`

This is not a production certification or a claim that either Demo branch
has completed an authenticated Sandbox submission.

Owner stop condition: open Kubri → Settings → ZATCA for the exact `Kubri Demo`
business, select the `Kubri Trading Demo` Sandbox reconnect card, and run the
server-owned reconnect flow from an authenticated Owner or Super Admin session.
Do not paste the official Sandbox OTP into chat or add it to client code.

After OTP, verify Trading's own onboarding response, active compliance-demo
mode, QR, factual stored Sandbox response, refresh persistence, and safe retry.
Then use only authorized/disposable simplified Cash, Card, and Customer Credit
Sandbox invoices; verify thermal, A4, preview, reprint, PDF, mobile/desktop
widths, Arabic/RTL, and exact success-modal button counts. Service Demo must
remain unchanged. Standard/production clearance is not claimed because the
supported scope is simplified compliance validation.
