# Kubri Customer Credit and Receivables — 2026-08-03

## Certification scope

This worktree is based on the current Phase 2 branch-entitlement lineage:

- worktree: `/Users/admin/Desktop/DAFRA SUB/Dafra-customer-receivables`
- branch: `feature/customer-credit-receivables-20260803`
- base: `796687ed1d6010d38da0c098b702829da72ef521`
- protected checkout: `/Users/admin/Desktop/Dafra`, branch `feature/invoice-settings-ux-redesign`, SHA `e70dbab70b047d550e8ecc8f2fcfe38e5f9ecceb`
- Supabase project reference: `bkbphkpqcxuejozayrsy`

The protected checkout was not modified, stashed, reset, cleaned, committed, or
switched. Mobile, purchase-idempotency, transfers, desktop packaging, and web
deployment are outside this change.

## Existing-contract audit

The existing fiscal boundary remains authoritative:

- `pos_checkout` / `pos_checkout_capability_base_v1` owns pricing, tax,
  invoice numbering, invoice lines, stock movement, invoice snapshots, and
  fiscal document identity.
- `resolve_pos_checkout_document_internal_v1` remains the server classifier for
  tenant/branch state, customer classification, ZATCA capability, and atomic
  versus legacy checkout routing.
- `create_partial_credit_note(jsonb)` remains the fiscal credit-note engine.
- Existing ZATCA XML, hash, signature, QR, clearance/reporting, and issued
  invoice identity are not replaced by AR records.

The receivables layer is intentionally additive. It creates no opening balance
for historical rows. New ordinary posted customer invoices and payments are
mirrored by controlled server triggers; the credit-checkout RPC suppresses that
temporary legacy payment bridge and writes its AR entries exactly once.

## Credit POS eligibility and tender boundary update

The manual `AR_CREDIT_DISABLED` outcome is intentional server behaviour, but
the former POS offered Credit before showing that authoritative condition. The
failure occurs after `ar_ensure_customer_account_v1` and the scoped policy
lookup in `post_customer_credit_checkout_v1`: no policy, or a policy with
`credit_enabled = false`, is a financial-permission denial. It is independent
of `customers.customer_type` and does not mean every Business customer should
receive credit.

## Tenant policy configuration completion

The former customer Credit Settings message was a configuration-path defect:
the existing table was per customer receivable account, no tenant-level policy
model existed, legacy customers could be unlinked, and the only writer was
hidden in a collapsed customer-panel control. Migration 00800 adds a safe,
lazy Owner/admin tenant policy, visible account setup and explicit customer
approval. It does not auto-approve a Business customer or backfill debt.
Details and local/remote evidence are recorded in
[`CUSTOMER_CREDIT_POLICY_CONFIGURATION_20260803.md`](CUSTOMER_CREDIT_POLICY_CONFIGURATION_20260803.md).

`20260803000600_credit_preflight_and_server_demo_modes.sql`, followed by the
forward-only `20260803000700_rebind_credit_and_sandbox_mode_contracts.sql`,
adds
`get_customer_credit_checkout_eligibility_v1(jsonb)`. It is a read-only
security-definer preflight with safe values only: account link state, enabled
state, hold, limit, current balance, available credit, overdue amount,
owner-approval requirement and stable `AR_*` reason code. It never invokes
`ar_ensure_customer_account_v1`, inserts no account, and never changes a
policy. POS loads it when selecting a customer and immediately before Charge;
the posting RPC performs its original authoritative checks again.

The POS treatment is deliberately compact:

- Cash, Card and enabled Split remain the primary selector.
- Customer credit is a separate action shown only after a selected customer has
  a server result. Known ineligible customers cannot dispatch a credit checkout
  request; account linking/settings is offered only to owner/admin users.
- Initial payment starts blank. Valid input is exactly `0` or a non-negative
  decimal with no more than two places and less than the total, leaving a real
  AR balance. Blank, whitespace, malformed, negative, excessive-precision and
  over-total values keep Charge disabled. Full normal settlement uses the
  primary tender controls.
- A positive initial payment permits **Cash** or **Card** only. Bank Transfer
  is hidden at this POS boundary because it is not separately reconciled in the
  original initial-credit register bridge. Later AR receipts retain the
  explicit Bank Transfer tender, optional reference, branch attribution,
  allocation and reversal records; it remains distinct from Cash/Card.

## Server-derived Demo and Sandbox modes

The non-fiscal demo guard remains intact. The new server evaluator uses only
tenant/branch state and active **compliance** credential metadata to select:

| Branch | Derived mode | Behaviour |
| --- | --- | --- |
| Kubri Trading Demo | `non_fiscal` | Demo label; no QR, ZATCA request, chain, outbox, reporting or clearance. |
| Kubri Service Demo | `sandbox_compliance` | Sandbox label; Simplified-only developer-portal compliance validation, Phase 2 signed QR, status ledger and Sandbox test output. |

Historical metadata showed validation activity for both branches, but only
Service has a current active/unexpired compliance record with successful
onboarding. Trading's current record is failed and its historical
Sandbox-production record is revoked. Service has no active Sandbox-production
credential material, so full Sandbox reporting/clearance is not available and
is never attempted. The server blocks Standard Sandbox checkout rather than
pretending to clear it. Neither route reads or returns secret values, and no
production ZATCA endpoint/credential is selected.

Migration 00600 was applied after exact parity and catalog preflight. The
source was then kept immutable and the public POS/credit rebind plus
credit-checkout contract registration were placed in forward-only migration
00700. Migration history now matches through 00700 at that historical point.
The later owner-credit configuration rollout is applied separately as 00800.
The public preflight/mode,
POS, and credit-checkout contracts are authenticated `SECURITY DEFINER`
functions with `search_path = public, pg_temp`; internal evaluators are
service-role-only. The matching `zatca-validate-sandbox-demo` Edge Function is
active at version 21. Neither migration modifies customer policies, credential
values, invoices, payments, stock, fiscal output, or historical business rows.

The remaining required evidence is an explicitly authorised disposable-tenant
manual lifecycle: policy states, explicit-zero/partial/retry cases, normal
register/report reconciliation, and Service Sandbox accepted/rejected/retry QR
validation. No such financial or fiscal mutation was performed in this update.

## Forward-only migrations

1. `20260803000200_customer_receivables_schema_v1.sql`
   - customer receivable accounts and optional customer account links;
   - explicit credit policy, terms, hold, limit, warning, and overdue controls;
   - append-only AR entries, receipt headers/tenders, allocations, operation
     fingerprints, and approved non-fiscal adjustments;
   - tenant/branch indexes, RLS, and server-only write contracts.
2. `20260803000300_customer_receivables_rpcs_v1.sql`
   - credit/partial checkout;
   - payment receipts with single, split, manual, oldest-first, unapplied, and
     replay-safe settlement;
   - fiscal credit-note settlement, refund/account-credit handling, reversal;
   - scoped customer workspace and payment-receipt document RPCs.
3. `20260803000400_customer_receivables_controls_reports_v1.sql`
   - role matrix expansion for AR operations;
   - new-invoice/payment synchronization without historical backfill;
   - locked allocation replacement, approved adjustments, cross-branch account
     linking, and read-only receivables reports.
4. `20260803000600_credit_preflight_and_server_demo_modes.sql`
   - read-only credit eligibility and server-derived Demo/Sandbox mode
     classification.
5. `20260803000700_rebind_credit_and_sandbox_mode_contracts.sql`
   - forward-only public POS/credit wrapper rebind and immutable-function
     contract fingerprint registration.

No migration rewrites historical invoices, payments, stock, ZATCA artifacts, or
business rows. The only invoice updates are derived settlement state (`due_date`,
`payment_method`, `payment_status`, and `updated_at`) on the invoice created by
the same transaction; fiscal totals and identity remain untouched.

## Business rules implemented

- Fully paid invoices resolve to outstanding `0`, have no AR due date by
  default, and retain clean fiscal output.
- Partial and unpaid invoices expose total, paid/allocated amount,
  outstanding, status, and optional internal due date.
- Aging uses invoice date when no due date exists. Overdue status requires an
  explicit due date.
- Ledger debits invoices and approved debit adjustments; credits receipts,
  credit notes, and approved credit adjustments. Reversals are separate debit
  entries and never rewrite the original receipt.
- Receipts have immutable receipt numbers, amount/currency/method/tenders,
  reference/date/cashier/notes, status, reversal data, operation identity,
  allocations, and unapplied remainder.
- The server serializes operation identity, invoice locks, and allocation
  replacement. Fingerprint mismatch returns an operation conflict.
- Credit checkout requires an active non-walk-in customer and is a settlement
  mode, not a fiscal invoice type. Policy limits, holds, overdue blocks, and
  explicit override reasons are server-enforced.
- Fiscal credit notes use the existing fiscal engine; settlement can apply to
  AR, refund excess, or leave account credit without editing the original.

## UI and documents

The customer detail workspace now exposes scoped summary metrics, open invoices,
aging, account policy, ledger navigation, payment receipt capture, and links to
invoice/receipt documents. The operation ID for a credit checkout is persisted
per branch/customer/cart fingerprint so an uncertain retry after restart can
replay safely; it is cleared only after success.

Payment receipts and customer statements have dedicated print routes with A4
print CSS, Arabic RTL direction, browser print/Save PDF, reprint navigation,
and no ZATCA QR code. Receipt documents are settlement documents, not tax
invoices. XLSX export remains a release gate until a controlled export contract
and acceptance test are added.

## Verification record

- Static customer-receivables contract checks: passed, 37 checks.
- JSON locale validation and `git diff --check`: passed.
- The final clean local `supabase db reset --no-seed --yes` completed through
  migration 004 with exit code 0 and no receivables SQL errors. Optional local
  vector/pooler services were stopped during recovery; they are not required
  for the public-schema migration/RPC verification recorded here.
- Local metadata verification found migration head `20260803000400`, eight
  receivables tables with RLS enabled, ten security-definer receivables RPCs
  using `search_path = public, pg_temp`, and the expected unique operation,
  receipt, source, and allocation indexes. Authenticated direct table writes
  remain revoked.
- Non-mutating rejection checks passed and left zero operations, receipts, or
  ledger entries. The full test suite (including 37 receivables contract
  checks), typecheck, and production build passed.
- `supabase db lint --local --schema public --fail-on error` remains non-zero
  only for pre-existing legacy function issues (`zatca_sandbox_validation_attempts`,
  `phase5e_assert_optional_branch_fk`, and an existing `pg_temp` relation
  reference); no new receivables function errors were reported.
- Stateful authenticated cases, report/document acceptance, XLSX export, and
  controlled disposable-tenant lifecycle tests remain required.

## Remote rollout record

The worktree was linked to Supabase project `bkbphkpqcxuejozayrsy`. Before the
rollout, linked migration history matched every migration through
`20260803000100_authoritative_owner_branch_entitlement.sql`, with no
remote-only versions and exactly these reviewed pending migrations:

1. `20260803000200_customer_receivables_schema_v1.sql` — schema, constraints,
   indexes, RLS, and server-only table-write surface;
2. `20260803000300_customer_receivables_rpcs_v1.sql` — settlement, receipt,
   workspace, and document RPCs; and
3. `20260803000400_customer_receivables_controls_reports_v1.sql` — authority
   controls, append-only synchronization triggers, allocation controls, and
   reports.

Their source SHA-256 values were respectively
`26111d231e7d686313bfb9b5f459e82319d94d3e67c12894b1c4b523a5fd20e9`,
`ede07041ef5d15af61bd54f805a1f99e7cbdec4857eb85cd8de82351efabfced`, and
`57d50235dbe330776cc8fc85930b72756a67c771628663bef6da96024832003e`.
The Phase 2 entitlement migration has the same Git blob in the authoritative
base and this branch (`a924d3db54bf6bd13098e98ac8049fac887b9fbe`).

Targeted remote catalog preflight confirmed the required customer, invoice,
payment, refund, tenant, branch, user-profile, POS-session, fiscal guard, and
authority-helper contracts. The existing system represents credit notes as
`invoices.zatca_invoice_type = 'credit_note'` and register state as
`pos_sessions`; the receivables migration uses those existing contracts and
does not require separate `credit_notes` or `register_sessions` tables.
`pgcrypto` and `uuid-ossp` are installed. The remote invoice ZATCA compliance
write guard was present before rollout.

The three migrations were applied successfully and linked history now ends at
`20260803000400`. The CLI emitted a post-apply local catalog-cache certificate
warning, but remote migration history and the live catalog independently
confirmed all three migrations. The migrations contain additive DDL and
function/trigger definitions only; they execute no historical invoice,
payment, customer, or fiscal-row backfill. Immediately after rollout, every
new receivables table had zero rows.

Remote verification found eight receivables tables with RLS enabled, expected
foreign keys/check constraints, operation/receipt/source/allocation uniqueness,
and the two reviewed `AFTER INSERT` synchronization triggers on `invoices` and
`payments`. `anon` has neither table access nor function execution; authenticated
users retain scoped SELECT only and have no direct INSERT, UPDATE, or DELETE
rights on receivables tables.

The reviewed public receivables API contains eleven (not ten) authenticated
SECURITY DEFINER entry points. All are owned by `postgres`, set
`search_path = public, pg_temp` and `row_security = off`, deny `anon` execute,
and do not accept a payload tenant ID or authoritative balance. The additional
entry point is `link_customer_receivable_account_v1(jsonb)`, an owner/admin-only
compatibility operation. This corrected count must be retained in future
certification records rather than silently dropping a reviewed grant.

Remote empty-payload rejection paths returned only their expected validation or
authority errors: `AR_CHECKOUT_IDENTIFIERS_REQUIRED`,
`AR_RECEIPT_FIELDS_REQUIRED`, `AR_REALLOCATION_PAYLOAD_INVALID`,
`AR_REVERSAL_FIELDS_REQUIRED`, and `AR_ACTOR_NOT_ACTIVE`. A subsequent
aggregate check found zero AR accounts, policies, operations, receipts,
allocations, ledger entries, and adjustments.

Preview deployment `dpl_4aqxnb9cPnTHgu5AciBvwYQVJcaB` is Ready at
`https://dafra-mluncvpc5-mohammed-shahin-v-vs-projects.vercel.app` with a
Preview-only alias. It was uploaded from reviewed source commit
`bcef7d5b1a8e288564c08e55b7d624ca5c6077ec`; no production deployment, alias,
or main-branch update occurred. The deployment is Vercel-SSO protected, so no
authenticated product walkthrough was inferred from the unauthenticated smoke.

## Tax-boundary adviser review checklist

- [ ] Later payment receipts are recorded as non-fiscal settlement documents
  and do not modify the original fiscal invoice identity.
- [ ] Returned goods or value reductions use the established fiscal credit-note
  pathway; settlement may reduce AR, refund excess, or leave account credit.
- [ ] Advance payments before supply remain outside this receivables settlement
  decision and require separate adviser review.
- [ ] Optional internal due dates are neither required nor printed by default
  on fiscal documents.

Saudi tax-adviser sign-off is **pending**. This checklist is a technical review
record, not legal or tax certification.

## Release gates

The remote database rollout and a Preview-only frontend deployment are complete.
This worktree is not authorized to merge to main, deploy production web, or
perform a real customer purchase. Before production certification, the owner
must provide an explicitly authorized disposable tenant with three branch IDs,
owner/branch test accounts, a disposable customer/products, and open register
state. The complete stateful scenarios, idempotency/concurrency cases,
owner/branch scope checks, authenticated Preview walkthrough, 58/80 mm and A4
document checks, XLSX implementation/acceptance, responsive English/Arabic RTL
acceptance, and adviser sign-off must then pass before a reviewed main merge
and separately approved production deployment.

Current verdict: **KUBRI_CUSTOMER_RECEIVABLES_BLOCKED**

The later customer-credit configuration correction has a clean, Ready
Preview-only deployment from the feature branch. It does not update the
production alias; exact final deployment metadata is recorded in the handoff.

## Completion update — automated certification and Preview preparation

### Implemented additive client completion

- The customer workspace now captures one receipt through the server RPC with
  either one tender or a distinct split-tender breakdown, and supports explicit
  per-invoice manual allocation. The same persistent operation identity is
  retained for an uncertain retry and cleared only after a successful response.
- An authorized owner, admin, accountant, or manager can reverse the newly
  recorded receipt from the workspace. The server remains the authority for the
  reversal reason, scope, immutable original receipt, compensating ledger entry,
  and invoice settlement refresh.
- The established Credit Note modal has an explicit AR-settlement choice. That
  choice uses `create_customer_credit_note_settlement_v1`, retains a persistent
  settlement operation identity across restart/retry, applies the credit to the
  original outstanding amount first, and only records an optional external
  refund from excess credit. The normal fiscal/Atomic credit-note route remains
  unchanged unless this explicit mode is selected.
- Customer statements now download a real OOXML `.xlsx` workbook, generated
  locally with `fflate`: typed dates/numbers, frozen transaction header,
  autofilter, currency formatting, safe filename, Arabic RTL sheet direction,
  and opening/closing balances. It does not use a CSV renamed as XLSX.
- Payment-receipt printing supports 58 mm, 80 mm, and A4 print styles, browser
  Save-as-PDF, and native/copy-link sharing. Receipts remain explicitly
  non-fiscal and QR-free.
- `/reports/receivables` is a dedicated read-only dashboard using
  `get_customer_receivables_report_v1`, with server-scoped date/branch filters,
  KPI cards, customer balances, pagination, and branch comparison. Client
  filtering does not expand the server's role/branch authority.

### Automated evidence — passed

| Check | Result |
| --- | --- |
| Migration parity, linked project | Local and remote histories match through `20260803000400`; no AR migration is pending. |
| Remote AR function metadata | All 11 reviewed entry points are `SECURITY DEFINER`, owned by `postgres`, have `search_path = public, pg_temp` and `row_security = off`. |
| Remote AR table safety | All eight AR tables have RLS enabled; `anon` has no table privilege and `authenticated` has no direct AR write privilege. |
| Static AR safety/UI contract | `npm run test:customer-receivables` passed, 46 checks. |
| Genuine XLSX contract | `npm run test:receivables-xlsx` passed; validates OOXML ZIP parts, typed number/date cells, frozen header, autofilter, and Arabic sheet direction. |
| Stateful local three-branch certification | `npm run test:receivables-stateful` passed. A nested transaction creates and rolls back all local fixtures. It proves posted-invoice AR sync, split/manual receipt allocation, exact replay, cross-branch rejection without rows, owner reallocation without ledger mutation, immutable reversal/compensating balance restoration, and consolidated report/overdue results. |
| Combined AR automated certification | `npm run test:receivables-certification` passed. |
| Application typecheck/build | `npm run build` passed. Vite emitted only the existing large main-chunk warning. |
| Patch hygiene | `git diff --check` passed. |

No remote business row, customer, invoice, receipt, stock movement, fiscal
artifact, ZATCA credential, reporting/clearance state, production alias, or
main branch was modified by this completion update. No migration was created or
applied: the remote schema already contained the reviewed RPC/data contracts.

### Combined final manual acceptance checklist

The following acceptance is intentionally still required in an explicitly
authorised disposable three-branch tenant before production merge/deployment:

1. Owner creates/enables a customer policy with credit limit, terms, hold,
   warning, and overdue behavior; branch user confirms allowed/blocked credit
   checkout, partial tender, due date and server conflict/retry UX.
2. On three branches, create real disposable invoices; receive cash, card,
   bank-transfer/other and split tenders; exercise auto/manual allocation,
   overpayment/account credit, reallocation, receipt reprint and authorized
   reversal. Reconcile invoices, allocations, receipt state and ledger.
3. Create an eligible credit note using the explicit AR-settlement mode; verify
   original-balance offset, residual account credit, optional excess refund,
   fiscal status/print gate, and retry without a duplicate credit note.
4. Verify the statement and receipt in English and Arabic RTL at mobile,
   desktop, 58 mm, 80 mm and A4 print/PDF targets. Open the exported XLSX in
   Excel/LibreOffice and verify filters, date/amount cells, headers and totals.
5. Verify the read-only report for owner, branch, manager/accountant, a sibling
   branch, another tenant and anonymous user; retain the approved evidence.
6. Obtain the pending Saudi tax-adviser confirmation for the settlement and
   advance-payment boundary. Conduct no real fiscal pilot without separately
   authorised seller/buyer credentials and controlled written approval.

### Environment note

The local Supabase adviser reports pre-existing, unrelated RLS-disabled tables
`barcode_function_contracts_v1`, `product_sku_counters`, and
`product_units_commercial_function_contracts_v1`. They are outside this AR
change and were not modified. Platform-wide production approval should resolve
them with owner-approved policies; enabling RLS alone would break their callers.

**Updated automated verdict: `KUBRI_CUSTOMER_RECEIVABLES_AUTOMATED_READY`.**
Production readiness, production deployment, and merge to `main` remain
pending the combined human acceptance above.

## Final pre-production audit update — 2026-08-03

This historical rollout record is superseded for release decisions by
[`CUSTOMER_CREDIT_FINAL_PREPRODUCTION_AUDIT_20260803.md`](CUSTOMER_CREDIT_FINAL_PREPRODUCTION_AUDIT_20260803.md).

The final audit found and locally remediated a P1 compatibility gap: malformed
JSONB values could escape a public AR RPC as a raw PostgreSQL conversion error.
The new forward-only migration
`20260803000500_harden_customer_receivables_payload_errors.sql` preserves the
existing public signatures and business logic while converting only malformed
UUID/date/number inputs to stable `AR_*` errors. Its local rejection fixture
proves no AR business row is retained. The linked production project matches
every prior migration through `20260803000400` and has exactly this one pending
migration. It was deliberately **not** applied in this audit.

Accordingly, the former automated-ready statement is historical only. Current
release verdict: **`KUBRI_CUSTOMER_RECEIVABLES_BLOCKED`**, pending separately
authorised remote application of migration 00500, a Preview built from the
post-00500 source, and the controlled manual acceptance checklist in the final
audit record. No production frontend, production data, `main` branch, or
customer fiscal transaction was changed by the final audit.

## Final remote hardening rollout — 2026-08-03

This update supersedes the historical blocked status above and the earlier
automated-ready wording for release decisions. The sole authorized migration,
`20260803000500_harden_customer_receivables_payload_errors.sql`, was applied
to project `bkbphkpqcxuejozayrsy`. No other migration was pending or applied.

### Migration review and remote compatibility

00500 changes only the public JSONB AR RPC boundary. It renames the existing
ten implementations to internal `*_raw_20260803` bodies, recreates each exact
public signature/return type as a `SECURITY DEFINER` wrapper with
`search_path = public, pg_temp` and `row_security = off`, catches malformed
UUID/numeric/date conversion classes, and emits stable `AR_*` errors. It does
not alter invoice totals, VAT, XML, QR, signature, ZATCA state, receipts,
allocations, balances, financial history, table RLS, triggers, or direct table
grants. No table DDL, row DML, backfill, fiscal routing, tenant/branch authority
change, or direct client write grant appears in the migration.

Before application, local/remote migration history matched exactly through
`20260803000400`; 00500 was the single pending version and the remote public
function source hashes matched the locally preserved raw bodies for all ten
functions. The applied CLI command was `supabase db push --linked --yes` and
reported 00500 applied with exit status 0. The CLI emitted a post-apply
pg-delta catalog-cache certificate-file warning; linked migration history and
live function metadata independently verified successful application.

### Aggregate-only non-mutation evidence

| Aggregate | Before 00500 | After 00500 and rejection checks |
| --- | ---: | ---: |
| Receivable accounts / operations / receipts / allocations / ledger / adjustments | 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 / 0 |
| Customers | 6 | 6 |
| Invoices | 4,302 | 4,302 |
| Payments | 4,318 | 4,318 |
| Credit-note invoices | 110 | 110 |

No customer, invoice, payment, credit-note, AR, stock, XML, QR, signature or
ZATCA row was selected individually, created, modified, or backfilled.

### Post-application security and rejection verification

Remote history now ends at `20260803000500` with no pending migration. The ten
public JSONB functions retain `jsonb` input and `jsonb` return types,
`postgres` ownership, `SECURITY DEFINER`, safe `search_path`, authenticated
execute, and denied anon/service-role execution. The ten raw bodies retain the
same safe configuration but deny authenticated/anon/service-role execution.

All eight AR tables remain RLS-enabled; anon and authenticated direct
INSERT/UPDATE/DELETE privileges remain false, while scoped authenticated SELECT
remains available. The expected `AFTER INSERT` invoice and payment
synchronization triggers remain enabled. Existing constraints still enforce
positive amounts, allowed tender/origin/action values, tenant/branch foreign
keys, and operation/receipt/allocation uniqueness.

The remote guaranteed-rejection fixture passed and compared AR aggregates
before/after inside its check. It covers empty/object-shape errors, blank and
missing identifiers, malformed UUID/numeric input, invalid allocation shape,
invalid adjustment direction and whitespace-only reason. The wrapper vocabulary
is: `AR_POLICY_VALUE_INVALID`, `AR_CHECKOUT_IDENTIFIER_INVALID`,
`AR_RECEIPT_VALUE_INVALID`, `AR_CREDIT_NOTE_IDENTIFIER_INVALID`,
`AR_REVERSAL_FIELDS_REQUIRED`, `AR_WORKSPACE_FILTER_INVALID`,
`AR_REALLOCATION_PAYLOAD_INVALID`, `AR_ADJUSTMENT_PAYLOAD_INVALID`,
`AR_ACCOUNT_LINK_PAYLOAD_INVALID`, and `AR_REPORT_FILTER_INVALID`. No raw
PostgreSQL conversion error escaped. An unauthenticated PostgREST RPC request
returned HTTP 401. Authorized cross-branch testing remains in the controlled
manual tenant checklist; no real user fixture was created for this rollout.

### Regression and acceptance Preview

`npm test` (non-secret local SSR placeholders),
`npm run test:receivables-certification`, and `npm run build` passed after
remote application; `git diff --check` passed. This includes 53 AR contracts,
rollback-only three-branch allocation/replay/reallocation/reversal/report
fixtures, rejection/no-mutation checks, 192 thermal SSR renders, genuine XLSX
generation, and independent SheetJS parsing of neutralized hostile text.

A new non-production Preview was deployed from the clean exact tested source:

| Field | Value |
| --- | --- |
| Deployment | `dpl_9cB9AKuMqpcnhpyDyDUa3d6jXQXj` |
| URL | `https://dafra-j0u5qd6sc-mohammed-shahin-v-vs-projects.vercel.app` |
| Target / state | Preview / Ready |
| Metadata source | `feature/customer-credit-receivables-20260803` at `f674f8e4802f0f9b0142db32e82430dd2400214a` |

The Preview header request returns its protected redirect (HTTP 302), so the
deployment is live but cannot truthfully stand in for an authenticated browser
walkthrough. No Playwright/Cypress or authorized disposable user credentials
are installed in this worktree. The local deterministic fixtures and deployed
metadata are the completed automated Preview preflight; workspace tabs,
checkout/payment/return UI, responsive viewport, accessibility and physical
print acceptance remain human gates below.

### Main rehearsal and RLS advisory

No merge was performed. A read-only merge-tree rehearsal of current
`origin/main` (`5491389`) with this feature branch produced tree
`b9178a53168e91264843ec6813e067a82df39571`, exactly equal to the feature
tree, with no conflict. Main's only exclusive change is the desktop-download
correction already included as `7c17286`; tests/build therefore apply to the
hypothetical merge content. A later merge still requires manual acceptance and
normal review of printing/documents, owner provisioning, branch entitlement,
auth/routing, invoice/ZATCA, customer and report surfaces.

The local-only RLS adviser mismatch remains P2 and is excluded from this
release. Locally it reports RLS disabled for
`barcode_function_contracts_v1`, `product_sku_counters`, and
`product_units_commercial_function_contracts_v1`; no source migration enables
RLS for them. Production reports RLS enabled, no policies, no anon or
authenticated grants, postgres administration, service-role read access to the
two immutable contract tables, and service-role write access only to the
tenant-scoped SKU counter. The first/third are immutable function-definition
fingerprints; the counter is used by `next_product_sku` and `peek_product_sku`.
Treat this as out-of-band/local-baseline drift requiring separate policy and
fixture-lineage review. Do not apply an unrelated RLS change here.

### Consolidated owner manual acceptance checklist

**Authentication and scope**

- [ ] Owner and branch login; owner consolidated view; branch isolation; no sibling-branch financial access.

**Customer credit scenario**

- [ ] Invoice 1 SAR 10,000; initial payment SAR 2,000; outstanding SAR 8,000.
- [ ] Later payment SAR 3,000; outstanding SAR 5,000.
- [ ] Invoice 2 SAR 3,000; initial payment SAR 1,000; total customer balance SAR 7,000.
- [ ] Fiscal credit note SAR 2,000; adjusted outstanding SAR 5,000; stock restored.

**Payments and documents**

- [ ] Oldest-first/manual/one-payment-across-invoices allocation; overpayment; unapplied credit; apply later; authorized reversal; ledger source links.
- [ ] 58 mm, 80 mm, A4 receipt; no ZATCA QR; statement PDF; XLSX opened in Excel/LibreOffice; fully paid invoice uncluttered; partial invoice paid/outstanding; due date hidden; Arabic RTL.

**Fiscal, responsive and human gates**

- [ ] Payments leave invoice totals, QR, XML, signature and ZATCA status unchanged; credit note follows the established fiscal route.
- [ ] Verify Customer Workspace tabs, checkout, payments, credit-note options, reports and documents at 375 px, 430 px, 768 px, 1024×768, 1366×768, 1440×900 and 1920×1080 without blank panel/loading/overflow or inaccessible action.
- [ ] Thermal and A4 printers; written Saudi tax-adviser confirmation for settlement/refund/account-credit/advance-payment boundaries.

### Current recommendation

**`KUBRI_CUSTOMER_RECEIVABLES_READY_FOR_MANUAL_ACCEPTANCE`**. There is no
open P0/P1 technical blocker. Do not merge `main` or deploy production frontend
until the controlled checklist and tax-adviser sign-off are complete. Mobile
remained paused, purchase-idempotency migration was not applied, and no
unauthorized customer/fiscal data was modified.

## Simple Branch Settings and customer-credit navigation — 2026-08-03

The follow-up implementation keeps the completed AR/POS/payment/statement,
printing and ZATCA contracts intact and simplifies only the configuration and
navigation journey.

- Owner setting: `Allow customer credit`.
- Branch setting: `Allow customer credit in this Branch`.
- Customer setting: `Allow credit for this customer`.
- Effective eligibility is business enabled AND Branch enabled AND customer
  enabled, plus an active customer, linked AR account, active Branch and
  authenticated server scope.
- Legacy Branch rows keep `NULL` and inherit an enabled tenant setting; newly
  created Branch rows default to `false`, so credit is never silently enabled
  for a new Branch.
- Migration `20260803000900_simple_branch_customer_credit_v1.sql` adds the
  nullable Branch switch, `get_branch_customer_credit_policy_v1`,
  `set_branch_customer_credit_policy_v1`, and role-scoped simple customer
  account/access RPCs. Existing advanced columns remain only as a compatibility
  layer; no advanced controls are exposed by the new UI.
- The existing checkout preflight and post wrapper reject a disabled Branch
  before the reviewed fiscal/AR path. UI messages map business, Branch,
  customer, account and inactive-customer failures to simple wording.
- Branch users receive one Branch Settings route; Owners open the same page for
  any Branch from the Branch directory. Printing & Documents and ZATCA remain
  links to their existing workspaces.
- Customer Credit is now a simple sidebar destination backed by the existing
  server report/workspace RPCs. No duplicate ledger, payment or statement logic
  was introduced.

Local verification for this follow-up: build passed; 72 static receivables
contract checks passed; malformed-input rejection passed; rollback-only
three-Branch stateful checks passed; credit/POS and XLSX suites passed; and the
new migration reached the local migration head. Remote parity, targeted
preflight, and Preview deployment remain intentionally pending until the
focused change is committed and pushed. No real customer, financial or fiscal
row was modified.

Remote completion: parity was exact through `20260803000800`, with only
`20260803000900_simple_branch_customer_credit_v1.sql` pending. That migration
was applied to `bkbphkpqcxuejozayrsy`; linked history now ends at `20260803000900`
with no pending or remote-only migration. Catalog-only verification confirmed
the Branch column/default, RLS and grants, policy constraints/indexes, safe
`postgres`-owned authenticated RPC metadata and the Branch gate in eligibility
and posting. The linked malformed-input rejection fixture returned no rows.
The CLI emitted only its known pg-delta certificate-cache warning after the
successful push. Preview redeployment and manual browser/device/tax acceptance
remain pending; no real customer or financial row was modified.

Final focused Preview handoff: commit `97a7054fcc01e31bbe588991734c0e322e946920`
was pushed to `feature/customer-credit-receivables-20260803` and deployed as
Preview `dpl_CXiSmjKNTMRReC8PJ94yNCMFNbMy`,
`https://dafra-qpl30l3q0-mohammed-shahin-v-vs-projects.vercel.app`, with Vercel
state `READY` and target `preview`. No production alias was updated.

## Branch and Owner Settings redesign closure — 2026-08-03

The later focused correction is recorded in
[`BRANCH_AND_OWNER_SETTINGS_REDESIGN_20260803.md`](BRANCH_AND_OWNER_SETTINGS_REDESIGN_20260803.md).
It traced the POS account-not-ready message to missing effective eligibility
diagnostics and corrected route selection for business, Branch, customer, and
account failures. It introduced no second settings source: existing Branch POS
preferences remain stored in `branches` through the authoritative RPC, and the
new URL-addressable Branch Settings studio links to the existing printing,
receivables, customer, and Owner ZATCA workspaces.

After exact parity through `20260803000900`, the sole intended pending
`20260803001000_branch_settings_authority_and_credit_diagnostics_v1.sql` was
applied to `bkbphkpqcxuejozayrsy`. Linked history now has no pending migration.
Remote metadata confirms the effective eligibility wrapper and Branch POS RPC
are postgres-owned, `SECURITY DEFINER`, `search_path = public, pg_temp`,
`row_security = off`, authenticated-only, with the raw compatibility function
denying client execution. The linked rejection fixture returned no rows.

Static, focused UI, direct local stateful/rejection, build, and diff checks
passed. Owner/Branch authenticated walkthroughs, responsive/RTL/keyboard
acceptance, disposable three-Branch lifecycle, physical printing, and tax
acceptance remain manual gates. Mobile, purchase-idempotency, main merge,
production frontend, and unrelated RLS remediation remain paused.

The final focused source is `f6d0a552351a8583bd85ff0710a1d64a28389be3`.
Preview `dpl_EX51CwSPY1vB3nXzSbtntj1pjP3K` is `READY` at
`https://dafra-bxf8vychq-mohammed-shahin-v-vs-projects.vercel.app`, target
`preview`, with no production alias change.

## Superseding Branch-only UX consolidation — 2026-08-03

The historical configuration sections above describe an earlier tenant and
customer-policy model. They are retained as lineage, but are superseded for
the current certification by migration
`20260803001100_branch_only_b2b_customer_credit_v1.sql` and
[`CUSTOMER_AND_CREDIT_UX_CONSOLIDATION_20260803.md`](CUSTOMER_AND_CREDIT_UX_CONSOLIDATION_20260803.md).

The current product has exactly one operational gate: `Allow customer credit
in this Branch`. Owner/business and customer switches, manual setup, limits,
holds, approvals, overdue blocks, terms, due dates, and available-credit UI are
removed. Only active Business/B2B customers in the active authorized Branch
qualify; the account is created automatically and idempotently with no
historical backfill. Remote parity/application and manual acceptance remain
gates; no real financial mutation was performed.

Remote migration 011 is now applied and verified with no pending migration.
The exact tested application source is `4160ea12dd4f7a6c6d0db283b6d5efa0289be2d9`.
Preview `dpl_Geefbgu3Un8ocbRRwkdCNx3BVv3m` is `READY` at
`https://dafra-363ety7jy-mohammed-shahin-v-vs-projects.vercel.app`; it is a
Preview only. Manual authenticated, responsive/RTL, physical-print, and
explicit disposable-tenant acceptance remain required.
