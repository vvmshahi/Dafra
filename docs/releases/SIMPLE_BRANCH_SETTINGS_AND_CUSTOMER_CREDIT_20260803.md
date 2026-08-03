# Simple Branch Settings and Customer Credit — 2026-08-03

## Scope

This is a focused follow-up to the completed customer-credit and receivables
work. It simplifies Owner/Branch configuration and navigation without changing
the reviewed payment, ledger, statement, printing, ZATCA, POS or fiscal paths.

Mobile, purchase-idempotency, main merge, production frontend deployment,
Electron packaging and unrelated feature work remain paused.

## Three switches

1. Owner: **Allow customer credit**.
2. Branch: **Allow customer credit in this Branch**.
3. Customer: **Allow credit for this customer**.

Credit eligibility is server-authoritative and requires all three switches,
plus an active customer, linked customer account, active Branch and an
authenticated user in the permitted tenant/Branch scope.

The customer account setup is idempotent and empty. It never fabricates an
opening balance or backfills old invoices or payments. Existing credit checkout,
partial payment, later payment, allocation, receipt, statement and credit-note
settlement behavior remains available after the switches pass.

## Branch compatibility rule

Migration `20260803000900_simple_branch_customer_credit_v1.sql` adds
`branches.customer_credit_enabled`:

- existing Branch rows remain `NULL` and inherit an enabled tenant switch;
- new Branch rows default to `false`;
- an explicit `false` disables credit for that Branch;
- the Owner can configure any Branch; a Branch user can configure only its own
  active Branch;
- the Owner business switch still controls the whole business and cannot be
  changed by a Branch user.

The legacy advanced policy columns remain in the database for backward
compatibility with already certified internals. They are not exposed in this
simple UI: there are no new credit-limit, warning, overdue, approval, manager,
allocation-mode or payment-method controls.

## Server contracts

The migration adds authenticated-only, `postgres`-owned `SECURITY DEFINER`
RPCs with `search_path = public, pg_temp`:

- `get_branch_customer_credit_policy_v1(uuid)` — scoped Branch read;
- `set_branch_customer_credit_policy_v1(jsonb)` — scoped Branch switch save;
- `ensure_customer_credit_account_v1(jsonb)` — Owner/admin/Branch idempotent
  empty account setup;
- `set_customer_credit_access_v1(jsonb)` — simple customer switch save.

`get_customer_credit_checkout_eligibility_v1(jsonb)` returns the Branch gate
before customer policy checks. `post_customer_credit_checkout_v1(jsonb)` checks
the same gate before entering the existing reviewed fiscal/AR implementation.
The client writes through RPCs only; it does not insert or update credit,
account, payment, invoice, stock or ledger tables directly.

Simple internal outcomes map to everyday messages:

- business disabled — “Customer credit is turned off for this business.”
- Branch disabled — “Customer credit is turned off for this Branch.”
- customer disabled — “Credit is not enabled for this customer.”
- account missing — “Set up the customer credit account first.”
- inactive customer — “This customer is inactive.”

## Settings and navigation

Branch users have `/branch-settings`. Owners/admins open
`/settings/branches/:branchId` from the Branch directory. Both routes use the
same page and show only useful, non-duplicated sections:

- General — safe Branch identity/status;
- POS & Payments — link to the existing Branch setup;
- Customer Credit — the one Branch switch;
- Printing & Documents — link to the existing studio;
- ZATCA — link to the existing secure area for Owners, with no secret display.

The sidebar now has Customer Credit under the business section for Owner and
Branch accounts. It points to the existing scoped Customer Credit report; no
second report or ledger implementation was created. Customer detail uses the
same simple switch and existing account, payment, statement and source-link
surfaces.

English and Arabic primary wording uses Customer Credit, Balance due, Amount
paid, Account history, Payments, Statements, Set up credit account, Allow
credit and Stop credit.

## Settings audit classification

- Owner/business: tenant customer-credit switch, subscription, business
  identity, branch allowance and consolidated reporting remain Owner surfaces.
- Branch: Branch identity, Branch customer-credit switch, existing POS/payment
  preferences, existing printing/ZATCA links and operational settings remain
  Branch-scoped.
- Device: physical printer selection, receipt/A4/barcode printer choice,
  copies, alignment and calibration remain device/Electron settings.
- User: language, appearance and supported personal preferences remain user
  preferences.

No existing Printing & Documents, ZATCA, barcode or Electron settings were
moved into shared cloud configuration.

## Verification and remaining gates

Local evidence on this feature branch:

- clean local migration reached `20260803000900`;
- Branch column, RLS, RPC ownership, safe search path and authenticated grants
  verified directly in Postgres;
- malformed-input rejection fixture passed without retained AR rows;
- rollback-only three-Branch fixture passed, including Branch A/C enabled,
  Branch B disabled and direct disabled-Branch checkout rejection;
- 72 static customer-credit/receivables checks passed;
- credit/POS, XLSX and production build passed;
- no real customer, invoice, payment, stock, ledger or fiscal row was changed.

Completed remote technical gates:

- exact remote parity through `20260803000800`, with exactly one intended
  pending migration;
- authorised application of only `20260803000900`;
- remote migration head, Branch column/RLS, policy constraints/indexes,
  authenticated grants and safe RPC metadata verification;
- remote non-mutating rejection-path verification.

Still required before the final manual-acceptance verdict:

- focused Preview deployment from the final pushed commit;
- authenticated Owner/Branch browser checks, responsive/RTL and keyboard
  checks, and the explicitly disposable three-Branch lifecycle;
- physical receipt/statement printing and business/tax acceptance.

No main merge, production frontend deployment, mobile or purchase work was
performed.

## Preview handoff

The exact tested commit is
`97a7054fcc01e31bbe588991734c0e322e946920` on
`feature/customer-credit-receivables-20260803`. It is deployed as Vercel
Preview `dpl_CXiSmjKNTMRReC8PJ94yNCMFNbMy` at
`https://dafra-qpl30l3q0-mohammed-shahin-v-vs-projects.vercel.app` with state
`READY` and target `preview`. Production was not deployed and `main` was not
merged.

Technical verdict: `KUBRI_SIMPLE_BRANCH_CREDIT_READY_FOR_MANUAL_ACCEPTANCE`.

## Settings studio and eligibility diagnostics closure — 2026-08-03

The Branch Settings follow-up is superseded and completed by
[`BRANCH_AND_OWNER_SETTINGS_REDESIGN_20260803.md`](BRANCH_AND_OWNER_SETTINGS_REDESIGN_20260803.md).
It retains the three-switch model and existing simple UI boundary while adding
the missing effective eligibility summary and exact POS resolution routing.
`reason_code` now distinguishes business, Branch, customer, account, and active
state without exposing SQL errors; the legacy camelCase reason remains for
compatibility.

Branch Settings is a direct-linkable studio rather than a stacked-card
dashboard. It exposes the existing Branch POS controls (touch/quick mode,
split payment, and category/product arrows), a concise Branch credit section,
the existing Printing & Documents context link, and accurate Owner-managed
ZATCA copy. Owner Settings now links to the exact Branch credit section and the
existing Customer Credit workspace. No authoritative settings were duplicated.

The sole pending migration after 00900,
`20260803001000_branch_settings_authority_and_credit_diagnostics_v1.sql`, was
applied after linked parity and metadata preflight. Remote head is 01000 with
no pending migration; the public RPCs, raw-function revokes, RLS/policies, and
non-mutating rejection fixture were verified. Static/targeted UI tests, local
stateful/rejection fixtures, build, and diff checks passed.

The remaining gate is manual acceptance of authenticated Owner/Branch flows,
responsive/RTL/keyboard behavior, the disposable three-Branch lifecycle,
physical printing, and business/tax boundaries. Main merge, production web,
mobile, purchase-idempotency, and unrelated RLS changes remain paused.
