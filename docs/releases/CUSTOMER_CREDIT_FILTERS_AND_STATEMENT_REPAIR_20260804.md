# Customer Credit Filters and Statement Repair — 2026-08-04

## Scope

This release is limited to the Customer Credit report and customer directory:
compact balance-as-of/activity-period filters, payment filtering, KPI wording,
authoritative customer summary mapping, compact row actions, and the shared
customer-profile statement entry point. No mobile, purchase, Electron, ZATCA,
POS, main-merge, or production-deployment work is included.

## Root cause and server contract

The report previously had an activity range but no server-enforced balance
cutoff. Migration `20260804000100_customer_receivables_balance_as_of.sql`
adds the optional `as_of_date` request field to
`get_customer_receivables_report_v1(jsonb)`. Ledger balances, unapplied
receipts, and overdue balances use that cutoff; receipt activity remains scoped
to the selected activity period. The migration is read-only and additive: it
does not insert, update, delete, or rewrite business, invoice, payment, stock,
fiscal, or ZATCA rows.

Remote rollout was parity-checked with exactly one pending migration and
applied to project `bkbphkpqcxuejozayrsy`. Remote head is
`20260804000100`. The deployed function is stable/security-definer with
`search_path=public, pg_temp`, `row_security=off`, execute granted only to
`authenticated`, and no PUBLIC/anon execute grant. Referenced receivables
tables retain RLS and authenticated SELECT policies.

## UI behavior

- Overview exposes compact Balance as Of and Activity Period controls, with a
  custom as-of date and custom activity range only when selected.
- Payments keeps the activity range and adds method/status filters.
- KPIs use Balance due, Payments received, Credit sales, and Customers with
  balance with consistent debt/green/teal/slate semantics.
- Customer rows use the authoritative customer receivables workspace summary
  for total sales, total paid, last payment, and open invoice reference data.
- Row actions are compact and provide Open account, Receive payment, and
  Statement. Statement opens the same customer-profile Customer Credit panel
  used by the profile UI; the report no longer maintains a second preview.
- The customer directory has a dark-green table section header. Existing
  responsive behavior and report pagination remain intact.

## Verification

Passed:

- Customer Credit filters/shared statement contract test
- Customer Credit visual consistency contract
- Customer Statement/final UI polish contract
- Customer receivables contract suite (31 checks)
- TypeScript check
- Production Vite build
- `git diff --check`
- Remote migration parity and metadata preflight

No live customer payment, invoice, stock, or other business mutation was
performed. Manual browser acceptance remains required for filter interaction,
Arabic layout, modal preview/output, and responsive action-menu behavior.
