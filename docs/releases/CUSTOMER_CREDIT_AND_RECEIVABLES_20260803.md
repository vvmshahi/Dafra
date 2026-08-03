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

## Release gates

This worktree is not authorized to apply the receivables migrations to the
remote project, deploy web, merge to main, or perform a real customer purchase.
Before production certification, the owner must provide an explicitly
disposable tenant and branch for controlled mutation tests, and a tax adviser
must sign off the fiscal/settlement boundary. Required sequence is local reset,
metadata/RPC preflight, migration, function verification, preview tests,
disposable-tenant acceptance, then separately approved deployment.

Current verdict: **KUBRI_CUSTOMER_RECEIVABLES_BLOCKED**
