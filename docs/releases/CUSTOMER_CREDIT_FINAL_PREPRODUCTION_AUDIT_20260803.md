# Kubri Customer Credit / AR Final Pre-production Audit — 2026-08-03

## Decision

**Verdict: `READY_FOR_MANUAL_ACCEPTANCE` —
`KUBRI_CUSTOMER_RECEIVABLES_READY_FOR_MANUAL_ACCEPTANCE`.** Migration 00500
has been applied and independently verified. A matching Preview is Ready. No
production frontend deployment, `main` merge, mobile/purchase work, desktop
build, historical backfill, or fiscal test transaction occurred.

| Item | Evidence |
| --- | --- |
| Worktree / branch | `/Users/admin/Desktop/DAFRA SUB/Dafra-customer-receivables` / `feature/customer-credit-receivables-20260803` |
| Reviewed starting SHA | `1e176b9828e77aa712b6c92ee2e53bbd68f92854` |
| Final audited code SHA | `846ca7b6d382a401d632edfe16d49cf97094142d` |
| Production project | `bkbphkpqcxuejozayrsy` |
| Acceptance Preview | `dpl_9cB9AKuMqpcnhpyDyDUa3d6jXQXj` — `https://dafra-j0u5qd6sc-mohammed-shahin-v-vs-projects.vercel.app` |
| Preview source metadata | `feature/customer-credit-receivables-20260803` / `f674f8e4802f0f9b0142db32e82430dd2400214a` |
| Production migration head | `20260803000500` |
| Pending AR migration | None |

## Lineage, scope, and production boundary

The target branch started at the stated SHA and adds only narrow review commits:
`13ebed4` (legacy date/XLSX safety), `7c17286` (the content-equivalent
desktop-download production correction), `c73664b` (later receipt-credit
settlement controls), `a74bf9d` (configured local test port), and `846ca7b`
(malformed-payload hardening). `origin/main` has one graph-only exclusive
commit, `5491389`; its desktop-download source correction was cherry-picked as
`7c17286`. No rebase or history rewrite occurred.

The audit is additive to POS, invoices, ZATCA/Atomic/Legacy, stock, printing,
reports, customers, suppliers, expenses, products, and branch entitlement. It
does not backfill or rewrite invoices, payments, stock, fiscal payloads,
ZATCA artifacts, or historical AR rows.

## Feature / regression / compatibility matrix

| Area | Result | Evidence / boundary |
| --- | --- | --- |
| Customer, policy, terms, hold, limit, warning, overdue | Pass locally | Server enforces active non-walk-in customer and policy. |
| Credit and partial checkout | Pass locally | Existing fiscal checkout owns invoice, tax, numbering, stock and ZATCA route; AR is settlement metadata. |
| Cash/card/bank/other and split receipt tenders | Pass locally | RPC-owned append-only receipt, tender and allocation records. |
| Auto/manual allocation and unapplied credit | Pass locally | Stateful fixture covers split/manual allocation and retained unapplied credit. |
| Later reallocation | P1 fixed | Role-gated UI calls `reallocate_customer_payment_v1`; existing allocations are preserved. |
| Authorized reversal | Pass locally | Immutable original plus compensating entry. |
| Credit note / refund / account credit | Pass locally | Existing fiscal credit-note engine remains authoritative; AR settlement is explicit/replay-safe. |
| Approved adjustment | P1 fixed | Role-gated UI calls `post_customer_receivable_adjustment_v1`. |
| Ledger, statement, reports | Pass locally | Server-scoped workspace/report owns balances and branch scope. |
| Receipt and statement printing | Source/SSR pass | Non-fiscal, QR-free settlement documents; physical acceptance remains. |
| Genuine XLSX and formula safety | Pass | OOXML ZIP, typed cells, RTL, frozen header/filter, neutralized formula-leading text. |
| English, Arabic, RTL, responsive | Source contracts pass | Authenticated browser/device review remains. |
| Legacy/null dates and values | P1 fixed | UI prints `—`; XLSX emits safe values rather than invalid date/`NaN`. |
| Existing POS/register/stock/invoice/ZATCA | No regression found | Focused POS, printing, stock, inventory, product, barcode and fiscal suites passed. |

The formerly missing later-settlement UI was a P1 completion gap, not a new
financial feature: its reviewed client/server contracts already existed but
were unreachable from the workspace. Financial writes remain authenticated
RPC-only; the new direct query is RLS-scoped read-only receipt metadata.

## P1 compatibility remediation pending remote approval

The rejection fixture exposed a raw PostgreSQL malformed-UUID response from a
public JSONB AR RPC. Migration 00500 is forward-only compatibility hardening:

- it renames each of ten public JSONB AR implementations to private
  `*_raw_20260803` bodies;
- it recreates the identical public signature as authenticated `SECURITY
  DEFINER` wrappers with `search_path = public, pg_temp` and `row_security=off`;
- it catches only conversion/range/date-overflow errors and returns stable
  controlled `AR_*` validation errors;
- it revokes all client access to raw bodies and grants only authenticated
  execution to public wrappers.

It creates no table/index/trigger/policy/business row, invoice/payment update,
stock movement, checkout alteration, or ZATCA/Atomic/Legacy alteration. The
exception boundary rolls back a rejected call, preventing partial AR mutation.
Local catalog verification found all ten wrappers owned by `postgres`, security
definer, safe-search-path, authenticated-only; raw bodies deny authenticated,
anon and service-role execution.

## Migration parity and read-only production preflight

Linked migration history exactly matches through `20260803000400`, with no
remote-only version and exactly one pending local migration: 00500. It was
deliberately **not applied**.

Read-only production catalog checks found all eight AR tables RLS-enabled and
without authenticated direct writes: policies, accounts, operations, receipt
headers/tenders/allocations, ledger entries, and adjustments. The reviewed
public API has the ten JSONB functions plus
`get_customer_payment_receipt_document_v1(uuid)`; all are owned by `postgres`,
security-definer, safe-search-path, `row_security=off`, anon-denied and
authenticated-executable. The two expected `AFTER INSERT` AR synchronization
triggers on `invoices` and `payments` are enabled. No business data was read.

The only safe next remote action is a separately authorised 00500 application,
then parity/catalog/rejection verification and a new Preview built from the
same source. This audit did not make that change.

## Local technical certification

| Check | Result |
| --- | --- |
| Clean `supabase db reset --local --yes`, including 00500 | Pass |
| `npm run test:customer-receivables` | Pass — 53 checks |
| `npm run test:receivables-xlsx` | Pass |
| `npm run test:receivables-rejection` | Pass — controlled errors and unchanged AR-row aggregate |
| `npm run test:receivables-stateful` | Pass — rollback-only three-branch fixture: allocation, replay, reallocation, reversal, scope, report |
| `npm run test:receivables-certification` | Pass |
| Owner-entitlement migration/runtime suites | Pass after deriving configured local DB port |
| Focused POS/printing/credit-note/customer/stock/product/barcode/inventory/sales-report suites | Pass |
| `npm test` | Pass with non-secret local SSR placeholder config; 192 thermal SSR renders passed |
| `npm run build` | Pass; existing 798 kB gzip main-chunk warning remains |
| `git diff --check` | Pass |
| Independent SheetJS parse of hostile `.xlsx` | Pass — B2 string, no formula, zero-width prefix code point `8203` |

The direct `fflate@0.8.2` export implementation has no audit finding. `npm
audit --omit=dev` has no critical finding, but reports existing unrelated
low/moderate items and a high `ws@8.20.0` transitive advisory through
`@supabase/realtime-js` (and jsdom). That dependency decision needs separate
upgrade/retest; it was not broadened inside this AR compatibility change.

## Security and platform RLS advisory

Secret-marker scans of source and produced web assets found no service-role key
or private-key material. Browser writes remain RPC-mediated.

The local Supabase adviser issued a required critical warning for three
**unrelated local tables**. Do not blindly run its remediation: enabling RLS
without policies can block their internal callers.

```sql
ALTER TABLE public.barcode_function_contracts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_sku_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_units_commercial_function_contracts_v1 ENABLE ROW LEVEL SECURITY;
```

Their source purposes/dependencies are immutable barcode function-definition
fingerprints; tenant/prefix SKU counters used by `next_product_sku` and
`peek_product_sku`; and immutable Product Units commercial function
fingerprints. Production metadata already has RLS enabled there, with no
anon/authenticated privilege. Treat this as separate P2 local-baseline/security
work, not an AR release mutation.

## Evidence limits and manual acceptance

No authenticated browser session, physical printer, or real fiscal/stock
transaction was available. Browser automation is not installed. Historic
onboarding/owner-routing runtimes require their special disposable Docker
environment; current entitlement runtime passed locally. Two old static tests
expect obsolete dashboard/Document Studio architecture; supported focused
suites pass. Saudi tax-adviser sign-off remains a legal/business gate.

After explicit authorization applies 00500 and a new Preview is built from its
matching source, use an explicitly disposable three-branch tenant with owner
and branch accounts, open register, disposable customer/products:

1. Configure policy and test branch-scoped allowed, warned, held, over-limit
   and overdue credit checkout. Confirm fiscal invoice/ZATCA, stock and register
   behavior are unchanged.
2. Create a **10,000** credit invoice; receive **2,000 cash**, then **3,000
   card**, then **5,000 split/manual allocation**. Reconcile exact invoice,
   ledger, receipt, tender and allocation balances.
3. Make a controlled partial credit note through the existing fiscal path;
   verify stock restoration, source linkage, AR offset, residual
   account-credit/refund choice, fiscal print/clearance and replay safety.
4. Reallocate unapplied credit and reverse an authorized receipt; verify the
   immutable original, compensating ledger entry, invoice refresh and no
   duplicate operation after retry/restart.
5. Check owner, allowed branch, sibling branch, other tenant and anonymous
   workspace/report/document/receipt access; retain evidence and error IDs.
6. Print/reprint English and Arabic RTL receipt/statement at 58 mm, 80 mm and
   A4/PDF; open XLSX in Excel/LibreOffice and verify totals, values, RTL,
   filters and hostile-text display.
7. Obtain written Saudi tax-adviser approval for settlement, credit note,
   refund/account-credit and advance-payment boundaries before any real pilot.

## Release handoff

Do not deploy production web, merge `main`, perform a real purchase/credit
transaction, or apply 00500 without separate authorization. The existing
Preview is pre-hardening source and is not suitable for final acceptance. After
remote 00500 verification, push/deploy only a matching new Preview; production
release still depends on the checklist above.

## Final rollout completion update — 2026-08-03

This section supersedes the former “do not apply 00500” release handoff. After
fresh exact parity/preflight, the only pending migration
`20260803000500_harden_customer_receivables_payload_errors.sql` was applied to
`bkbphkpqcxuejozayrsy` with `supabase db push --linked --yes`. Linked history
now matches through 00500 with no pending migration. A benign post-apply
pg-delta catalog-cache certificate-file warning did not affect the successful
CLI result; live migration history, function metadata, grants, RLS, triggers
and aggregate-only counts were then independently verified.

All aggregate baselines are unchanged after application and rejection testing:
six customers, 4,302 invoices, 4,318 payments, 110 credit-note invoices, and
zero AR accounts, operations, receipts, allocations, ledger entries and
adjustments. The ten public wrappers are `postgres`-owned, JSONB-to-JSONB,
`SECURITY DEFINER`, safe-search-path, anon-denied and authenticated-executable;
their internal raw bodies deny all client execution. The eight AR tables retain
RLS and no direct authenticated writes. The invoice/payment AR sync triggers
remain enabled. The remote rejection fixture passed without a retained business
row, and the no-key RPC boundary returned HTTP 401.

Acceptance Preview `dpl_9cB9AKuMqpcnhpyDyDUa3d6jXQXj` is Ready at
`https://dafra-j0u5qd6sc-mohammed-shahin-v-vs-projects.vercel.app`. Its Vercel
metadata records branch `feature/customer-credit-receivables-20260803` and
exact SHA `f674f8e4802f0f9b0142db32e82430dd2400214a`. It is a Preview only and
does not alter the production alias. A read-only merge-tree rehearsal with
current main was conflict-free and produced the exact feature tree; no merge
occurred. The detailed remote evidence and consolidated owner checklist are in
[`CUSTOMER_CREDIT_AND_RECEIVABLES_20260803.md`](CUSTOMER_CREDIT_AND_RECEIVABLES_20260803.md).

Current technical verdict: **`KUBRI_CUSTOMER_RECEIVABLES_READY_FOR_MANUAL_ACCEPTANCE`**.
The remaining gates are authenticated/disposable-tenant, device/print,
responsive/accessibility, and Saudi tax-adviser manual acceptance—not another
automated migration or production deployment.

## Branch and Owner Settings redesign update — 2026-08-03

The separate settings correction is now documented in
[`BRANCH_AND_OWNER_SETTINGS_REDESIGN_20260803.md`](BRANCH_AND_OWNER_SETTINGS_REDESIGN_20260803.md).
The POS eligibility defect was wiring/diagnostic ambiguity: Owner and Branch
switches persisted, but POS received the old raw denial shape and sent every
resolution action to the generic Customers route. The new wrapper adds
business/Branch/customer/account/active diagnostics while preserving the legacy
`reasonCode`, and POS routes each normalized denial to the exact resolving page.

The Branch Settings page is now a compact General, POS & Payments, Customer
Credit, Printing & Documents, and ZATCA studio with direct section URLs,
browser history, unsaved-change protection, Arabic locale parity, and the
existing Branch POS storage/RPC. Owner Settings uses the same visual language;
no credit, receivables, printing, ZATCA, or fiscal source was duplicated.

The only intended pending migration after 00900,
`20260803001000_branch_settings_authority_and_credit_diagnostics_v1.sql`, was
applied to `bkbphkpqcxuejozayrsy` after exact parity and metadata preflight.
Remote head is 01000 with no pending migration. Function security, safe search
path, grants, RLS/policies, and linked non-mutating rejection checks passed.

The final redesign Preview is recorded after the focused commit/deployment
below. Manual authenticated browser/device/RTL, disposable three-Branch,
physical-printing, and tax-adviser checks remain required. No main merge,
production alias update, mobile/purchase work, or unauthorized data mutation
occurred.

Final source is `f6d0a552351a8583bd85ff0710a1d64a28389be3` on
`feature/customer-credit-receivables-20260803`. Preview
`dpl_EX51CwSPY1vB3nXzSbtntj1pjP3K` is `READY` at
`https://dafra-bxf8vychq-mohammed-shahin-v-vs-projects.vercel.app`, target
`preview`; no production alias was changed.

## Customer-credit configuration correction — 00800 rollout complete

The later Preview acceptance found that the historical per-customer policy was
not a usable Owner configuration journey. The correction is documented in
[`CUSTOMER_CREDIT_POLICY_CONFIGURATION_20260803.md`](CUSTOMER_CREDIT_POLICY_CONFIGURATION_20260803.md):
tenant-wide disabled-by-default policy, visible owner setup, controlled legacy
account linking, explicit customer approval and POS refresh. It is forward-only
configuration work; no historical balance, customer policy, fiscal record,
production frontend deployment or main merge has occurred.

The exact parity check found 00800 as the sole pending migration, and the
targeted catalog preflight found all prerequisite contracts with the expected
pre-apply absence of the tenant-policy table. `20260803000800` then applied to
project `bkbphkpqcxuejozayrsy`; linked history now matches through 00800. Live
metadata confirms the new RLS-protected table, no authenticated direct writes,
and the intended authenticated-only, `postgres`-owned `SECURITY DEFINER` RPCs
with `search_path = public, pg_temp`. A malformed-payload rejection fixture
passed without changing aggregate configuration, account, operation, receipt,
allocation, ledger, or adjustment state. No real policy/customer setting was
changed without authorisation.

## Credit POS and Demo/Sandbox correction update — 2026-08-03

This update addresses the subsequent manual-acceptance findings without
changing the financial policy model or production fiscal routing.

- `AR_CREDIT_DISABLED` was traced to the authoritative
  `post_customer_credit_checkout_v1(jsonb)` policy lookup: a receivable account
  may be linked/created by the checkout bridge, but a missing policy or
  `credit_enabled = false` is rejected. Business customer classification is
  deliberately not credit approval.
- Migration `20260803000600_credit_preflight_and_server_demo_modes.sql` adds a
  read-only, authenticated `get_customer_credit_checkout_eligibility_v1` RPC;
  forward-only migration `20260803000700_rebind_credit_and_sandbox_mode_contracts.sql`
  preserves 00600's immutable source while rebinding the public POS/credit
  contracts to it.
  It returns only safe policy/balance fields and an `AR_*` reason code; it never
  creates an account or enables credit. POS rechecks the same RPC immediately
  before posting; the checkout RPC remains final authority.
- POS now keeps **Cash / Card / Split** in the primary selector and shows a
  separate full-width customer-credit action only after server preflight. The
  action is disabled with a concise reason for known ineligible customers. An
  owner/admin may open credit settings for an unlinked account; no cashier or
  client flow can auto-enable a policy.
- The initial-payment field begins blank and is not interpreted as zero.
  Only an explicit non-negative number with at most two decimals is accepted;
  explicit `0` creates a fully unpaid credit sale, while a positive initial
  payment reveals the Cash/Card method selector. A full payment is redirected
  to normal Cash/Card/Split settlement rather than sending a known-rejected
  credit request.
- Bank Transfer is intentionally hidden for the **initial POS credit payment**.
  The prior bridge used a temporary bank-transfer commercial tender and then
  replaced it with AR records; it does not provide a separately reconciled POS
  register tender total. Bank Transfer remains available for later AR payment
  receipts, where tender/reference/reversal/allocation records are explicit;
  it is not mapped to Card or Cash.

### Safe Demo/Sandbox result

The aggregate-only remote audit found one active demo tenant with two active
Sandbox-environment branches. Both had historical compliance-validation
attempts. Only **Kubri Service Demo** currently has active, unexpired,
compliance credential material with a successful compliance onboarding state.
**Kubri Trading Demo** has a failed current record and a revoked historical
record, so it is retained as the general **Demo** (non-fiscal) branch.

The same migration adds a server-only mode evaluator. It derives
`non_fiscal` or `sandbox_compliance` from tenant/branch state and active
compliance credential metadata; no client-supplied demo or environment flag is
accepted. It leaves normal-tenant Atomic/Legacy selection, production
credential selection, production chain/outbox routing, document classification,
and QR rules unchanged.

- **Demo / Trading**: concise Demo status, no ZATCA request, QR, outbox, chain,
  reporting, or clearance. It is not rendered as a failed “Not submitted”
  Sandbox invoice.
- **Sandbox / Service**: only the existing ZATCA developer-portal
  compliance-validation endpoint is used. A validated Simplified invoice uses
  the existing Phase 2 signed-QR extractor and renders the QR in thermal/A4
  output with a visible Sandbox test label. Validation state is displayed as
  Sandbox pending/submitted/warnings/rejected/retry required.
- This project currently has no active Sandbox production CSID/secret for the
  Service branch. Full Sandbox reporting and Standard clearance are therefore
  not claimed or attempted; Standard Sandbox checkout is server-blocked with a
  controlled message. No production endpoint or production credential is used.

Remote parity was exact through `20260803000500` and initially contained only
00600 pending. All referenced tables/functions were present. Migration 00600
was applied successfully. A later source refinement was deliberately moved to
the sole forward-only 00700 migration rather than changing applied history;
00700 was then the only pending migration and applied successfully. Live
catalog checks confirm the public preflight/mode functions and public
POS/credit checkout wrappers are `SECURITY DEFINER`, use
`search_path = public, pg_temp`, and expose only intended authenticated grants.
Both public contract hashes match their remote definitions. The matching
`zatca-validate-sandbox-demo` Edge Function is active at version 21. The
post-apply pg-delta cache warning was non-blocking; linked history and catalog
verification are authoritative.

Automated source/build evidence now includes the credit POS/Sandbox contract
suite, the existing customer-receivables and non-fiscal boundary suites,
thermal SSR (192 renders), `npm test` with inert non-secret SSR variables,
`npm run build`, and `git diff --check`. No authenticated financial, stock, or
fiscal mutation was performed for this correction.

### Updated manual acceptance gate

- [ ] Confirm ineligible, held, over-limit, overdue, unlinked, and eligible
  customer states with an authorised disposable tenant; no checkout request is
  sent for a known ineligible state.
- [ ] Confirm blank initial payment disables Charge; explicit `0`, Cash partial,
  Card partial, full amount, duplicate/retry, and restart recovery behave as
  documented.
- [ ] Confirm normal register/report totals for Cash/Card/Split and later
  separately-labelled Bank Transfer receipt/reversal/reporting.
- [ ] Confirm Trading Demo remains QR-free/non-fiscal and Service Sandbox
  Simplified validation produces a QR plus sandbox status using a disposable
  fixture. Exercise accepted/rejected/retry only with explicit authorisation.
- [ ] Confirm responsive layouts at 1024×768, 1366×768, 1440×900 and narrow
  widths, then complete English/Arabic print/device review.

## Customer-credit configuration interruption recovery — 2026-08-03

The implementation and remote 00800 rollout were complete when the prior
verification model reached capacity. Recovery inspection found no merge,
rebase, cherry-pick or test process left running. The interrupted
rollback-only three-branch fixture completed directly in the disposable local
database with exit status 0, and its post-fixture preflight completed. It
covered absent-policy setup, Owner/customer configuration, account linking,
hold/limit state, cashier denial, and rollback. Aggregate retained rows are
zero for all customer-credit configuration and AR fixture tables.

`npm test` and `npm run build` passed on the completed source tree. The combined
receivables certification command reached the Supabase CLI SQL step but the
local container health-check timeout prevented that CLI wrapper from connecting;
the rejection and stateful SQL assertions themselves passed when executed
inside the same disposable container. Remote parity, 00800 metadata and the
non-mutating rejection fixture are complete. The remaining acceptance gate is
the authorised manual Preview walkthrough listed above.

A clean Preview-only deployment reached `READY` from the final feature source.
It is not a production deployment and no production alias or `main` branch was
updated. Exact deployment metadata is recorded in the handoff report.

## Follow-up: simplified Branch Settings and customer-credit navigation

This follow-up is limited to ordinary Owner/Branch configuration. It does not
add manager, cashier, accountant, approval, override, limit, threshold,
overdue-blocking or payment-governance systems.

The only user-facing switches are the business `Allow customer credit`, Branch
`Allow customer credit in this Branch`, and customer `Allow credit for this
customer`. Legacy Branches inherit the tenant setting while new Branches default
off. Server preflight and checkout enforce all three switches; existing AR
settlement, payment, ledger, statement, printing, ZATCA and POS mechanics stay
in their reviewed paths.

`20260803000900_simple_branch_customer_credit_v1.sql` is the forward-only
migration. It adds a safe Branch column, server-authoritative Branch read/write
RPCs, Branch-authorised empty account setup/simple customer access RPCs, and a
Branch gate in the existing credit preflight/post wrapper. RLS remains enabled
on `branches`; the new functions are `postgres`-owned, `SECURITY DEFINER`,
`search_path = public, pg_temp`, and authenticated-only. The client performs no
direct writes to credit or AR tables.

The shared Branch Settings page is available at `/branch-settings` for Branch
users and `/settings/branches/:branchId` for Owners/admins. Customer Credit is
linked from both role sidebars to the existing Customer Credit report. The
Printing & Documents and ZATCA cards link to the existing areas rather than
duplicating either workspace. English and natural Arabic copy use everyday
terms such as balance due, account history, and customer credit.

Follow-up local evidence: the clean local migration reached
`20260803000900`; direct metadata checks confirmed the Branch column, RLS,
function ownership/security settings and authenticated grants; the rejection
fixture passed without AR rows; the three-Branch rollback fixture passed; 72
static contract checks, credit/POS, XLSX and build passed. The remote migration
has not been applied and no Preview has been redeployed yet. Manual browser,
responsive/RTL, disposable-tenant lifecycle, physical printing and tax-adviser
acceptance remain gates. Main merge, production frontend deployment, mobile,
purchase-idempotency and real customer/financial mutations remain paused.

### Remote rollout completion — 2026-08-03

After exact parity through `20260803000800`, the sole pending migration
`20260803000900_simple_branch_customer_credit_v1.sql` was applied to
`bkbphkpqcxuejozayrsy`. Linked history now ends at `20260803000900` with no
pending or remote-only version. The CLI emitted only its known pg-delta
certificate-cache warning after a successful `Finished supabase db push`.

Catalog verification confirmed the nullable/default-false Branch column,
Branch and credit-table RLS/no direct authenticated writes, the expected unique
policy constraints/indexes, six `postgres`-owned `SECURITY DEFINER` RPCs with
`search_path = public, pg_temp` and authenticated-only execution, and the
Branch gate in both eligibility and posting definitions. The linked
non-mutating rejection fixture passed with no returned rows and no business
mutation. No real customer setting, invoice, payment, stock, ledger or fiscal
row was changed.

The remaining release gates are Preview deployment from the final pushed SHA,
authenticated browser/RTL/responsive/manual three-Branch acceptance, physical
printing and business/tax acceptance. Main merge, production frontend
deployment, mobile, purchase-idempotency and real customer/financial mutation
remain paused.

### Preview handoff — 2026-08-03

The tested commit `97a7054fcc01e31bbe588991734c0e322e946920` was pushed to
`feature/customer-credit-receivables-20260803` and deployed to Preview as
`dpl_CXiSmjKNTMRReC8PJ94yNCMFNbMy`:
`https://dafra-qpl30l3q0-mohammed-shahin-v-vs-projects.vercel.app`. Vercel
reported `READY` with target `preview`; there was no `--prod` deployment and no
production alias change.

Final technical recommendation: `KUBRI_SIMPLE_BRANCH_CREDIT_READY_FOR_MANUAL_ACCEPTANCE`.
Remaining gates are authenticated browser/RTL/responsive/keyboard review,
explicitly disposable three-Branch lifecycle acceptance, physical printing and
business/tax acceptance. Mobile, purchase-idempotency, main merge and real
customer/financial mutations remain paused.

## Superseding certification state — 2026-08-03

This older audit recorded the former tenant/customer-policy design. It is not
the current product contract. The current certification is Branch-only and
Business/B2B-only: see
[`CUSTOMER_AND_CREDIT_UX_CONSOLIDATION_20260803.md`](CUSTOMER_AND_CREDIT_UX_CONSOLIDATION_20260803.md).

Migration `20260803001100_branch_only_b2b_customer_credit_v1.sql` is the
current additive change. Its local reset, rejection fixture, stateful
disposable fixture, typecheck, focused suites, aggregate `npm test`, and build
pass. Remote parity/preflight/application and manual authenticated acceptance
are still required. No real customer or fiscal mutation, production deploy,
main merge, mobile, purchase-idempotency, or Electron work occurred.
