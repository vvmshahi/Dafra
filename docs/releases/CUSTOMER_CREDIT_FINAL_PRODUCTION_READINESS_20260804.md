# Customer Credit Final Production Readiness — 2026-08-04

## Release candidate

- Worktree: `/Users/admin/Desktop/DAFRA SUB/Dafra-customer-receivables`
- Branch: `feature/customer-credit-receivables-20260803`
- Starting SHA: `e624f283f8b25e295aaf70d9808d2af4589ffebd`
- Main SHA: `549138965417c6343abf9775590464d17c0d9f4a`
- Previous Preview: `dpl_HQVxoJj3PByY41CgoRvXVh7zLRss`, source `e624f28`
- Supabase project: `bkbphkpqcxuejozayrsy`

This audit remained limited to Customer Credit. Mobile, purchase-idempotency,
Electron, unrelated ZATCA, broad UI redesign, main merge, and production
frontend deployment remained paused.

## Contract map

Branch Settings persists `branches.customer_credit_enabled` through
`get_branch_customer_credit_policy_v1(uuid)` and
`set_branch_customer_credit_policy_v1(jsonb)`. POS eligibility calls
`get_customer_credit_checkout_eligibility_v1(jsonb)`, which authenticates the
actor, checks active tenant/Branch scope, requires an active Business/B2B
customer on that Branch, and permits an absent receivable account for atomic
server-side creation. Checkout calls
`post_customer_credit_checkout_v1(jsonb)` with an operation ID. Later payments
use `record_customer_payment_receipt_v1(jsonb)` and reversals use
`reverse_customer_payment_receipt_v1(jsonb)`. Credit notes use
`create_customer_credit_note_settlement_v1(jsonb)`. Customer history and
statement output use `get_customer_receivable_workspace_v1(jsonb)` and the
shared normalized statement request builder.

The server ledger remains authoritative for invoice debits, payment/receipt
credits, credit-note credits, reversals, allocations, opening balances,
running balances, and closing balances. Customer Credit table totals use the
authoritative workspace response rather than visible-page aggregation.

## Findings and repairs

P1 fixed: eligible POS credit action exposed `Active Business/B2B customer`.
The action now shows only `Sell on customer credit`, with an accessible
localized tooltip. Unavailable guidance remains routed to Branch Settings or
the relevant customer resolution.

P1 fixed: Customers directory details were discoverable only through an eye
icon. Customer names are now keyboard-accessible details links with hover and
focus treatment; the eye action remains, and Edit/Archive actions remain
separate.

P1 previously fixed: statement Preview and Print/PDF/XLSX sent `page_size: 200`
to an RPC accepting only `1..100`, producing `AR_WORKSPACE_FILTER_INVALID`.
The shared builder now sends `page_size: 100`, validates UUID/date/range
values, omits dates for All activity, and is used by both entry points.

The approved Customer Credit structure remains Overview/Payments, and the
approved profile remains Overview/Products/Customer Credit for Business/B2B
customers only. Individual routes do not render Customer Credit.

## Server and security evidence

Migration parity is exact through `20260804000100`; no migration was created or
applied for this audit. Relevant remote RPCs are `SECURITY DEFINER`, use
`search_path=public, pg_temp`, and grant execution only to `authenticated`.
The referenced tables retain RLS and authenticated policies. No direct table
write, financial, fiscal, ZATCA, customer, payment, invoice, stock, or register
mutation was performed. Existing Edge versions were only inspected; no Edge
Function was deployed.

The Branch-only eligibility contract returns no credit limit, available credit,
or owner approval requirement and rejects Branch-disabled, inactive, and
non-Business customers. Legacy policy/account fields remain compatibility
shape only; no active customer-level activation UI is present in this pass.

## Verification

Passed:

- final Customer Credit RC source contract test
- statement filter-repair contract test
- Customer Credit visual consistency test
- Customer Statement final UI test
- customer receivables contract suite
- receivables XLSX tests
- full `npm test` with non-secret Vite environment placeholders
- TypeScript check
- production build
- `git diff --check`
- remote migration parity and RPC metadata inspection

The rollback-only local stateful harness passed after a recoverable local
Supabase stop/start. It verified Branch-only enable/disable, automatic account
setup idempotency, Business/Individual/inactive rejection, sibling-Branch
isolation, and rejected-checkout no-mutation; all reserved fixture rows were
confirmed absent afterward. It does not cover the requested invoice/payment,
credit-note, reversal, register, stock, report, or three-Branch lifecycle
matrix.

The first unconfigured `npm test` attempt stopped because local Vite Supabase
environment variables were absent; rerunning with non-secret placeholders
passed. No lint command is defined in this package.

## Stateful and visual gates

No disposable three-Branch tenant fixture was created, no real customer data
was mutated, and no authenticated browser session or screenshots were
available in this non-interactive pass. Manual acceptance must still cover
Branch toggle, POS eligibility and checkout variants, payment/reversal,
credit-note return, Branch isolation, all statement periods, Print/PDF/XLSX,
Arabic/RTL, responsive layouts, and rollback/concurrency scenarios.

The local Supabase diagnostic also reported pre-existing RLS-disabled tables
`barcode_function_contracts_v1`, `product_sku_counters`, and
`product_units_commercial_function_contracts_v1`. These are outside Customer
Credit scope; no remediation was applied because enabling RLS without reviewed
policies could block unrelated functionality. Customer Credit referenced tables
and remote RPC security checks passed.

## Recommendation

The tested application SHA is safe to merge and deploy only after the listed
manual acceptance and disposable-fixture certification pass. Production was
not deployed and main was not merged.
