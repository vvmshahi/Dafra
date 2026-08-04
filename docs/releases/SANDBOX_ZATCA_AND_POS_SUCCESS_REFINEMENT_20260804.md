# Sandbox ZATCA and POS Success Refinement — 2026-08-04

## Scope

This release-candidate patch is limited to the requested web presentation repairs:

- keep Sandbox/Demo status factual and compact;
- remove repeated customer-facing Demo warning blocks from the POS success shell and invoice print/preview titles;
- make the POS success receipt compact and vertical;
- remove WhatsApp from the POS success modal only;
- present `credit` and `partial_credit` as translated Customer credit payment badges, independently of ZATCA status.

No checkout, invoice posting, inventory, payment, ZATCA Edge Function, migration,
Electron, mobile, production deployment, or main-branch changes were made.

## Remote Demo metadata

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
Therefore this change does not claim an authenticated Sandbox invoice submission
or successful ZATCA response.

## UI changes

- POS success modal: `max-w-md`, single-column customer/method summary, concise
  Demo badge, existing print/view/new-sale actions and retry protection retained.
- Removed the success-modal WhatsApp button, handler, and icon path. WhatsApp
  remains available in its existing invoice-detail context.
- Removed the repeated bilingual Demo warning title from A4 and thermal
  rendering; Demo remains a concise non-print status badge in invoice detail.
- Invoice list payment badges now distinguish Customer credit with a muted
  burgundy treatment; `partial_credit` uses the same credit classification.
  Payment method and ZATCA status remain separate fields.

## Verification

Passed:

- `npm run test:sandbox-zatca-pos-success-refinement`
- `npm run test:final-web-printing-refinements`
- `npm run test:thermal-receipt-layouts` with non-secret placeholder Supabase environment
- `npm run test:demo-tenant-safe-checkout`
- `npm test` with non-secret placeholder Supabase environment
- `npm run build`
- `git diff --check`

No browser automation runner is installed in this worktree, so visual spacing,
responsive wrapping, authenticated Demo checkout, and real Sandbox response
remain manual acceptance items.

## Release state

This is ready for a Preview deployment after the focused commit is pushed. It is
not a production certification or a claim that either Demo branch has completed
an authenticated Sandbox submission.

Remaining manual gate: sign in as an authorized Demo operator, verify Service
Demo and Trading Demo routing/status in the UI, exercise one disposable Sandbox
validation where authorized, and confirm POS success modal/print/Invoice detail
at mobile and desktop widths.
