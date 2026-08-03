# Kubri Branch and Owner Settings Redesign — 2026-08-03

## Scope and release boundary

This is a focused customer-credit wiring and settings-workspace correction on
`feature/customer-credit-receivables-20260803` in
`/Users/admin/Desktop/DAFRA SUB/Dafra-customer-receivables`.

- Starting implementation SHA: `3a13199de7e31a33f2d7fa4da92230e573845d5c`
- Supabase project: `bkbphkpqcxuejozayrsy`
- Protected checkout preserved: `/Users/admin/Desktop/Dafra`,
  `feature/invoice-settings-ux-redesign`,
  `e70dbab70b047d550e8ecc8f2fcfe38e5f9ecceb`
- Protected dirty files remained exactly
  `scripts/recover-inv-0826-0827.mjs` (modified) and
  `scripts/recover-zatca-pending-invoices.mjs` (untracked).

Main merge, production frontend deployment, mobile, purchase-idempotency,
Electron packaging, and unrelated feature work remained paused. No real
customer, invoice, payment, stock, ledger, ZATCA, or fiscal row was changed.

## Wiring root cause and effective eligibility

Owner and Branch switches were being saved correctly. POS still showed the
account-not-ready message because the existing preflight exposed its raw
`AR_*` denial result without the effective state diagnostics needed by the
client. The client therefore could not distinguish business, Branch, customer,
account, and inactive-state failures, and its fallback action routed to the
generic Customers area.

The authoritative path is now explicit:

`business_enabled` AND `branch_enabled` AND `customer_enabled` AND
`account_ready` AND `customer_active` AND `branch_active` AND authenticated
scope → `eligible`.

Migration `20260803001000_branch_settings_authority_and_credit_diagnostics_v1.sql`
keeps the established 009 implementation as an internal raw function and wraps
it with a read-only effective summary. It returns both normalized diagnostic
fields and the legacy camelCase fields required by existing consumers. The
legacy `reasonCode` remains unchanged; `reason_code` and `effectiveReasonCode`
carry the normalized UI code.

The POS now refreshes the selected-customer preflight, rechecks it before
credit posting, preserves safe defaults for missing/stale state, and maps:

| Effective code | Message | Resolution route |
| --- | --- | --- |
| `BUSINESS_CREDIT_DISABLED` | Customer credit is turned off for this business. | Owner Customer Credit settings |
| `BRANCH_CREDIT_DISABLED` | Customer credit is turned off for this Branch. | `/branch-settings?section=credit` |
| `CUSTOMER_CREDIT_DISABLED` | Credit is not enabled for this customer. | Selected customer Credit Settings |
| `CREDIT_ACCOUNT_NOT_READY` | Set up the customer credit account first. | Selected customer Credit Settings |
| inactive customer | This customer is inactive. | Selected customer |

No raw PostgreSQL conversion error is shown and no client-side eligibility
decision bypasses the final server-authoritative checkout check.

## Branch Settings workspace

`BranchSettingsPage` is now a compact, URL-addressable settings studio with one
active section at a time:

- General — safe Branch name, Arabic name when available, code, status, contact
  and address context; unsupported edits are not fabricated.
- POS & Payments — the existing Branch POS authority, including touch/quick
  mode, split-payment enablement, and category/product navigation arrows.
- Customer Credit — concise status and Branch switch, disabled with an
  explanation when the business-wide switch is off, plus a link to the existing
  Customer Credit workspace.
- Printing & Documents — concise summaries for Receipts, A4 invoices, Barcode
  labels, Payment receipts, and Customer statements, with one strong action to
  the existing context-preserving studio.
- ZATCA — clear Owner-account management wording; Branch users see status and
  explanation without secrets or a misleading management action.

The page uses `?section=general|pos|credit|printing|zatca`, preserves
Back/Forward and refresh behavior, exposes tab/tabpanel semantics and focus
states, includes loading/error/empty handling, and guards unsaved changes.
The former misleading “Back to Branch” action is accurately “Back to
Dashboard”.

The Owner route `/settings/branches/:branchId` opens the same Branch context.
Printing context is preserved through the existing
`/settings/branches/:branchId/printing` route for Owners and
`/invoice-settings` for Branch users. No second settings source was created.

## Owner Settings and navigation

The existing Subscription, Account, and Customer Credit tabs remain intact but
now use the same restrained settings-shell language: aligned rows, compact
status treatment, deliberate spacing, visible focus, and contextual actions.
Owner Customer Credit links to the selected/first active Branch’s exact Credit
section and to `/reports/receivables`. The Customer Credit sidebar continues to
open the dedicated receivables workspace rather than the generic customer
directory. Customer detail Credit links scroll to the existing credit panel.

Existing Branch POS settings remain authoritative in `branches` and
`update_branch_pos_settings(uuid,jsonb)`. The migration broadens that existing
RPC safely to owner/admin tenant scope and a Branch user’s own active Branch;
it does not add duplicate columns or a parallel client store.

## Copy, accessibility, and state safety

English and Arabic locale keys cover the same five Branch sections and use
simple terms: Branch Settings, POS & Payments, Customer Credit, Printing &
Documents, ZATCA, Open Customer Credit, Open Printing & Documents, and Managed
from the Owner account. No “existing secure area”, resolver, governance, or
other technical copy is exposed to users.

Static contracts cover URL section state, tab semantics, focus treatment,
settings actions, exact reason routing, English/Arabic parity, no direct
financial writes, and no old stacked-card contract. Build/typecheck passed.
Authenticated viewport, RTL, keyboard, physical printing, and owner/Branch
browser acceptance remain manual gates; browser automation is not installed in
this worktree.

The client handles missing Branch settings, legacy Branch rows, missing
accounts, disabled business/Branch/customer state, inactive entities, stale
selection state, invalid route IDs, and safe defaults. No automatic credit
enablement or historical backfill occurs.

## Migration and remote verification

Exact linked parity before application had every prior local/remote migration
matching through `20260803000900` and exactly one intended pending migration:
`20260803001000`. Metadata-only preflight confirmed all referenced tables,
columns, functions, policies, owners, dependencies, and Branch RLS. No
remote-only drift or unexpected pending version was found.

The migration is forward-only and contains only DDL/function/grant/comment/
schema-notify operations. It does not execute an invoice, payment, ledger,
stock, ZATCA, customer, or historical-row write. It was applied alone with
`supabase db push --linked --yes`.

Post-apply verification confirms:

- migration `20260803001000` is the remote head with no pending migration;
- `branches` remains PostgreSQL-owned with RLS enabled and
  `customer_credit_enabled` default `false`;
- public wrapper and POS-settings RPC are `SECURITY DEFINER`, PostgreSQL-owned,
  `search_path = public, pg_temp`, `row_security = off`, authenticated-only;
- the renamed raw eligibility function denies `anon` and `authenticated`
  execution;
- anonymous function execution and direct table writes remain denied;
- existing scoped policies and Branch/customer/customer-policy/user-profile RLS
  remain present;
- the linked non-mutating rejection fixture returned no rows and retained no
  business mutation.

The CLI emitted its known non-blocking pg-delta catalog-cache warning about a
missing temporary certificate file after successful application. No unrelated
RLS remediation was applied. The local-only adviser warning for
`barcode_function_contracts_v1`, `product_sku_counters`, and
`product_units_commercial_function_contracts_v1` remains separate baseline
work.

## Test and Preview handoff

Passed evidence includes:

- `npm run test:branch-owner-settings-redesign`;
- `npm run test:customer-receivables` — 72 checks;
- Printing & Documents workspace — 20 checks;
- Owner workspace v1 and second/third refinement suites;
- direct local rollback-only stateful and rejection SQL fixtures;
- clean local migration application through 010;
- `npm run build` and `git diff --check`.

The exact final tested SHA is `f6d0a55` (`f6d0a552351a8583bd85ff0710a1d64a28389be3`).
It is pushed to `feature/customer-credit-receivables-20260803` and deployed as
Vercel Preview `dpl_EX51CwSPY1vB3nXzSbtntj1pjP3K` at
`https://dafra-bxf8vychq-mohammed-shahin-v-vs-projects.vercel.app`. Vercel
inspection reports `READY`, target `preview`, with a Preview alias only. The
deployment was uploaded from this exact clean SHA; no production alias,
`main`, or production frontend was changed.

## Remaining manual acceptance

- Owner and Branch authenticated walkthrough at narrow and desktop viewports,
  including Arabic/RTL, keyboard focus, Back/Forward, refresh, and unsaved
  changes.
- Disposable three-Branch lifecycle: Branch 1 settings persistence and POS
  eligibility, Branch 2 isolation/denial, Branch 3 persistence and
  attribution, customer switch changes, and zero retained fixture rows.
- Physical receipt/statement/A4 printing and business/tax acceptance.
- Confirm ZATCA Owner-only access and unchanged Demo/Sandbox,
  Atomic/Legacy, invoice, stock, and fiscal paths.

## Verdict

`KUBRI_BRANCH_OWNER_SETTINGS_REDESIGN_READY_FOR_MANUAL_ACCEPTANCE`
