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

### Statement preview repair

The authenticated Preview failure was reproduced from the source contract:
both the modal and print page requested `page_size: 200`, while
`get_customer_receivable_workspace_v1(jsonb)` accepts only page sizes 1–100.
The 20260803 wrapper surfaced that validation as
`AR_WORKSPACE_FILTER_INVALID` with SQLSTATE 22023. The customer and date values
were otherwise in the expected fields; the failing field was `page_size`.

This was fixed client-side with `buildCustomerStatementRequest` and
`loadCustomerStatementWorkspace`. Preview, Print, PDF, and XLSX now share the
same request path. The builder sends only `customer_id`, normalized optional
`branch_id`, canonical `start_date`/`end_date` when a bounded period is chosen,
`page: 1`, and `page_size: 100`. All activity omits date keys. Invalid UUIDs,
invalid dates, and reversed ranges are rejected before the RPC. The approved
modal and navigation were not redesigned.

Period mapping is Saudi-calendar based: This month is the first day of the
current month through today; Last month is the complete previous calendar
month; Last 3 months is the same calendar date three months earlier through
today; This year is January 1 through today; Custom validates From ≤ To; All
activity omits the date range.

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

The focused statement-filter-repair contract test also passed. Stateful
disposable-tenant fixture certification and authenticated browser acceptance
remain manual; no real customer financial rows were created or changed.

No live customer payment, invoice, stock, or other business mutation was
performed. Manual browser acceptance remains required for filter interaction,
Arabic layout, modal preview/output, and responsive action-menu behavior.
