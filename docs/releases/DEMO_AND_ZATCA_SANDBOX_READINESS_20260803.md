# Kubri Demo and ZATCA Sandbox Readiness — 2026-08-03

## Scope and safety decision

This record covers the customer-credit POS correction and demonstration-mode
routing on `feature/customer-credit-receivables-20260803`. It does not merge
`main`, deploy a production frontend alias, modify a production customer
tenant, invoke a production ZATCA endpoint, or reveal fiscal credentials.

Remote inspection was metadata-only. The project is
`bkbphkpqcxuejozayrsy`; migration history matched through 00500 before 00600
was applied. The subsequent public-contract refinement was recorded in
forward-only 00700, rather than changing the already-applied 00600 source.

## Audited demo state

| Demo branch | Tenant/branch state | Credential metadata result | Selected mode |
| --- | --- | --- | --- |
| Kubri Trading Demo | active Demo tenant / active sandbox-environment branch | failed current compliance record; revoked historical record | Non-fiscal Demo |
| Kubri Service Demo | active Demo tenant / active sandbox-environment branch | active, unexpired compliance material; successful compliance onboarding; no Sandbox-production material | ZATCA Sandbox Demo (compliance validation) |

Historical `zatca_sandbox_validation_attempts` metadata confirms both branches
previously used compliance validation. The more recent blanket non-fiscal
classifier ignored that distinction, explaining Trading's observed “Demo ·
Non-fiscal”, QR-free, “Not submitted” flow. The restored mode is intentionally
Service, not Trading: it is the only branch satisfying the server's current
active-compliance predicate.

## Mode contract

`zatca_demo_checkout_mode_internal_v1` derives the result on the server from
active demo/branch status, `zatca_environment = 'sandbox'`, active compliance
status, successful compliance onboarding, unexpired metadata, and presence of
encrypted **compliance** material. It never accepts a browser mode flag and
does not inspect production credential values.

| Mode | User label | QR and submission | Isolation |
| --- | --- | --- | --- |
| `non_fiscal` | Demo | No fiscal QR or ZATCA request; Demo invoice status | Existing demo marker/trigger blocks fiscal output, reporting outbox and chain paths. |
| `sandbox_compliance` | Sandbox | Simplified document signed with the existing Phase 2 QR path and sent only to the ZATCA developer-portal compliance endpoint; attempt ledger provides pending/submitted/warnings/rejected/retry status | No production endpoint, production credential, production chain, or production outbox is selected. Standard sandbox clearance is explicitly unavailable and server-blocked. |

This is a compliance-validation demonstration, not a claim of production
reporting or clearance. Service currently lacks active Sandbox-production
material, therefore full Sandbox reporting and Standard clearance remain
unavailable by design.

## Verification and manual gate

- Remote migrations 00600 and 00700 are present; their public functions are
  security-definer with `search_path = public, pg_temp` and authenticated
  grants only where required. The POS and credit-checkout contract fingerprints
  match their deployed function definitions.
- `zatca-validate-sandbox-demo` is deployed and active at version 21; its
  scope query now requires `status = 'compliance'` as well as active compliance
  metadata.
- Static routing/QR/authority tests, customer-receivables contracts, demo
  boundary contracts, thermal SSR and production build pass. The aggregate
  `npm test` run used inert public placeholder SSR variables and made no remote
  application requests.
- The remote malformed-payload rejection checks returned only
  `AR_CREDIT_PREFLIGHT_IDENTIFIER_INVALID`, `AR_CHECKOUT_IDENTIFIER_INVALID`,
  and `INVALID_CHECKOUT_PAYLOAD`. They fail before scope or checkout work and
  create no invoice, payment, AR, stock, QR, or fiscal record.

Before accepting the Sandbox UI, use an explicitly authorised disposable
Service Demo fixture to prove: valid Simplified QR, accepted/rejected response,
retry/idempotency, invoice list/detail/receipt status, and no duplicate
submission. Do not run any real production or customer-tenant fiscal mutation.
