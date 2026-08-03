# Kubri Customer and Customer Credit UX Consolidation — 2026-08-03

## Current certification scope

This document supersedes older customer-credit configuration notes for the
current Branch-only product rule. It applies to:

- worktree `/Users/admin/Desktop/DAFRA SUB/Dafra-customer-receivables`;
- branch `feature/customer-credit-receivables-20260803`;
- Supabase project `bkbphkpqcxuejozayrsy`;
- migration `20260803001100_branch_only_b2b_customer_credit_v1.sql`.

The protected checkout `/Users/admin/Desktop/Dafra` remains untouched. Main
merge, production frontend deployment, mobile, purchase-idempotency, Electron,
and unrelated feature work remain paused.

## Product contract

The only operational credit gate is `Allow customer credit in this Branch`.
There is no Owner/business credit switch, customer credit switch, setup action,
credit limit, available-credit display, hold, approval, overdue block, terms,
or due-date control in the product flow.

Credit checkout is available only when the server confirms an active saved
Business/B2B customer in the active authorized Branch. The receivable account is
created automatically and idempotently with a zero opening balance; historical
invoices and balances are never backfilled. The old policy row is retained
only as an internal compatibility input required by the reviewed raw posting
engine; its compatibility limit is never rendered or used as an eligibility
decision.

Stable server rejection codes are `BRANCH_CREDIT_DISABLED`,
`BUSINESS_CUSTOMER_REQUIRED`, `CUSTOMER_INACTIVE`, `CUSTOMER_NOT_FOUND`,
`CREDIT_ACCOUNT_SETUP_FAILED`, `BRANCH_INACTIVE`, and `CREDIT_UNAUTHORIZED`.
The server rechecks Branch, tenant, customer type, active state, and scope at
the posting boundary.

## UX consolidation

- Customer directory remains the single customer entry point; the separate
  Customer Reports sidebar/header path was removed.
- Customer profiles use Overview, Invoices, Products, and—only for eligible
  Business/B2B customers with Branch visibility or historical AR activity—
  Customer Credit. Legacy Documents and Customer Report URLs are retained only
  as compatibility redirects to Invoices and Overview respectively.
- Customer Credit is one workspace with Overview, Customers, Payments, and
  Statements tabs.
- The Customers table is scoped to active Business/B2B customers and shows
  phone, last credit invoice, last payment, total invoiced, total paid,
  balance due, status, and statement/customer actions.
- Overview uses four compact KPIs: Total purchases, Credit notes/Returns, Net
  purchases, and Total invoices. Today, Yesterday, Last 7 days, This month,
  Last month, This year, and Custom date filters are available; custom From/To
  controls appear only for Custom.
- Payment receipt and statement routes retain their existing server RPC,
  print/reprint, A4, XLSX, Arabic/RTL, and date-range behavior.
- POS renders Customer credit as the visible payment method while preserving
  the existing compatible persisted payment enum and fiscal invoice path.

## Local evidence

Local migration reset applied the new migration successfully. Passed checks:

- `npm test` with ephemeral local SSR placeholder Supabase variables;
- `npm run test:branch-owner-settings-redesign`;
- `npm run test:customer-receivables` — 31 Branch-only contract checks;
- `npm run test:credit-pos-sandbox-demo`;
- `npm run test:receivables-xlsx`;
- `npm run test:receivables-rejection` — malformed/non-mutating rejection paths;
- `npm run test:receivables-stateful` — disposable Branch-only fixture with
  explicit cleanup and no retained tenant/customer/account;
- `npx tsc --noEmit`;
- `npm run build`;
- `git diff --check`.

The local Supabase adviser also reports a pre-existing critical baseline issue:
RLS is disabled on `public.barcode_function_contracts_v1`,
`public.product_sku_counters`, and
`public.product_units_commercial_function_contracts_v1`. The remediation is
not applied because enabling RLS without policies can block internal access.
This remains a separate security task.

No real customer, invoice, payment, stock, receivable, ZATCA, or fiscal
mutation was performed. The real mutation gate remains an explicitly
identified disposable tenant and Branch with written authorization.

## Remote and manual gates

Before remote application, linked migration parity and metadata-only preflight
must show all prior migrations matching and exactly migration 011 pending. The
migration must be applied alone and its function security, grants, RLS,
policies, dependencies, and rejection behavior independently verified.

Afterward, manual authenticated browser/RTL/responsive/printing acceptance and
a controlled disposable-tenant lifecycle remain required. No production alias,
`main`, mobile package, Electron package, or real customer mutation is in scope.

## Remote rollout and Preview handoff

Remote parity was exact through `20260803001000`, with exactly one intended
pending migration. Migration `20260803001100_branch_only_b2b_customer_credit_v1.sql`
was applied alone to `bkbphkpqcxuejozayrsy`. Linked history now ends at 011 with
no pending or remote-only migration. The CLI emitted only its known
post-apply pg-delta certificate-cache warning; live catalog verification passed.

Remote verification confirmed the five public Branch-only RPCs are
PostgreSQL-owned `SECURITY DEFINER`, use `search_path = public, pg_temp`, deny
anon execution, and grant authenticated execution only to the intended public
surface. Legacy tenant/customer writers are revoked. Target AR tables have RLS
and scoped policies; authenticated users have SELECT only and no direct table
INSERT/UPDATE/DELETE. Unique policy, operation, and receipt constraints remain
present. The linked malformed-payload fixture passed with no successful
business operation and no changed aggregate rows.

The exact tested application source is commit `4160ea12dd4f7a6c6d0db283b6d5efa0289be2d9`
on `feature/customer-credit-receivables-20260803`. Preview
`dpl_Geefbgu3Un8ocbRRwkdCNx3BVv3m` is `READY` at
`https://dafra-363ety7jy-mohammed-shahin-v-vs-projects.vercel.app`, target
`preview`; no production alias was updated.

## Current verdict

`KUBRI_BRANCH_ONLY_B2B_CREDIT_UX_READY_FOR_MANUAL_ACCEPTANCE`
