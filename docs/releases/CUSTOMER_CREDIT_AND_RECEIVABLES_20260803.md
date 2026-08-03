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
