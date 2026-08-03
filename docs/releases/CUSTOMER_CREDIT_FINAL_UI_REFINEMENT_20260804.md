# Kubri Customer Credit Final UI Refinement — 2026-08-04

## Decision

**Superseded by the targeted profile refinement record below.** The Customer
Credit workspace evidence remains valid; the profile and directory scope was
subsequently refined in application commit
`911752b4fae333dddf78d0e8f6988d0fe381e867`.

The focused Customer, Customer Profile, Customer Credit, Branch/Owner Settings,
statement, receipt, and POS-success refinement is implemented and deployed to a
Vercel Preview. The application source tested and deployed is
`b31295f78ccffcd5355aa0c835a62f403214437f`. No migration, production alias,
`main` merge, mobile change, purchase-idempotency change, Electron build, or
real credit/purchase mutation was performed.

## Source and safety boundary

| Item | Evidence |
| --- | --- |
| Focused worktree | `/Users/admin/Desktop/DAFRA SUB/Dafra-customer-receivables` |
| Branch | `feature/customer-credit-receivables-20260803` |
| Tested/deployed application SHA | `b31295f78ccffcd5355aa0c835a62f403214437f` |
| Supabase project | `bkbphkpqcxuejozayrsy` |
| Protected checkout | `/Users/admin/Desktop/Dafra` |
| Protected branch/SHA | `feature/invoice-settings-ux-redesign` / `e70dbab70b047d550e8ecc8f2fcfe38e5f9ecceb` |
| Protected dirty files | `M scripts/recover-inv-0826-0827.mjs`; `?? scripts/recover-zatca-pending-invoices.mjs` |

The protected checkout remained untouched. The recovery-script modification and
untracked recovery script were not staged, stashed, committed, reset, cleaned,
or switched.

## UI refinement completed

- Customer Profile sections are URL-backed and browser-history-safe. Invalid
  sections fall back to Overview, hidden Customer Credit routes do not render a
  dead panel, and only the active profile panel is mounted.
- Customer header is compact and action-oriented. The redundant “Open Customer
  Reports” action and the low-value Customer Insights block were removed from
  the primary flow; useful analytics remain in the Customer Report section and
  PDF report path.
- Profile and workspace tabs use the established Kubri compact dark-green
  active treatment, RTL-aware arrow/Home/End keyboard navigation, focus rings,
  `role=tab` semantics, and responsive horizontal overflow.
- Customer Credit uses the Invoice/Document-Studio visual language: compact
  charcoal/green/teal/amber KPIs, date presets Today, Yesterday, Last 7 days,
  This month, Last month, This year, and Custom, plus debounced contextual
  search.
- The Customers table contains customer, phone, branch, last credit invoice,
  last payment, invoiced, paid, balance due, status, and statement actions.
- Payment history contains receipt, customer, branch, method, reference, amount,
  date/time, status, and receipt reopen/reprint navigation.
- Statements are an in-workspace bank-statement-style preview with loading,
  empty, error/retry, timestamp, branch, source reference, debit, credit, and
  running-balance rows. Print/Save PDF and genuine XLSX export remain available.
- Branch Settings and Owner Settings now share the dark-green active tab
  treatment.
- The POS success surface is wider and structured into customer/method/amount
  summary, receipt/invoice/share actions, invoice status, and New Sale. Credit
  displays the server-derived Customer Credit method rather than the internal
  fallback tender label.

The existing Branch-only Business/B2B credit boundary remains authoritative:
there are no tenant/customer switches, credit limits, manual setup controls,
walk-in/individual credit paths, direct AR writes, direct purchase writes, or
direct stock updates introduced by this pass. Existing RPC-backed payment,
reversal, settlement, receipt, statement, and checkout contracts remain in use.

## Migration and remote state

The refinement created no migration and applied nothing remotely. The linked
remote migration list was rechecked after the application commit:

- head: `20260803001100`;
- every local migration through that head matches remote;
- no pending migration and no remote-only migration;
- no schema or business-row change was required for this UI pass.

The previously recorded unrelated local Supabase adviser warning for
`barcode_function_contracts_v1`, `product_sku_counters`, and
`product_units_commercial_function_contracts_v1` remains separate baseline work
and was not auto-remediated.

## Verification

Passed on the clean application commit:

- `npm run test:customer-credit-final-ui-refinement`;
- `npm run test:branch-owner-settings-redesign`;
- `npm run test:customer-receivables` — 31 Branch-only credit contract checks;
- `npm run test:credit-pos-sandbox-demo`;
- `npm run test:receivables-xlsx`;
- `npm test` — including 192 thermal receipt SSR renders;
- `npx tsc --noEmit`;
- `npm run build`;
- `git diff --check`.

The production build retains the existing large-main-chunk warning (about
814.55 kB gzip); no new build error was introduced.

## Targeted profile follow-up

The later profile pass changes only the customer directory/profile surface:
the directory is a compact invoice-style table with City and Last purchase,
business styling uses Kubri teal/info treatment, and the final profile tabs are
Overview, Invoices, Products, and eligible Customer Credit. Legacy Documents
and Customer Report URLs normalize to Invoices and Overview. Overview visibly
contains only Total purchases, Credit notes/Returns, Net purchases, and Total
invoices; the timeline, recent activity, insights, average-invoice, and
last-purchase KPI blocks are not rendered. Last purchase is supplied by the
existing scoped customer-intelligence RPC; no migration was required.

## Preview handoff

| Item | Evidence |
| --- | --- |
| Deployment | `dpl_3YmvU8Z4eckCb7pvUFgw3ohxndoE` |
| Preview URL | `https://dafra-3uroomafm-mohammed-shahin-v-vs-projects.vercel.app` |
| Target/state | `preview` / `READY` |
| Inspector | `https://vercel.com/mohammed-shahin-v-vs-projects/dafra/3YmvU8Z4eckCb7pvUFgw3ohxndoE` |

The deployment was created from the clean application SHA above with Preview
target metadata for branch `feature/customer-credit-receivables-20260803`.
The anonymous URL returns the project’s normal Vercel SSO `302`; authenticated
browser acceptance is therefore still required for visual and interaction
verification.

## Manual acceptance gate

The remaining gate is controlled, authenticated manual acceptance—not another
source or migration repair:

1. Verify Overview, Customers, Payments, Statements, and Customer Profile tabs
   with Back/Forward, refresh, direct URLs, keyboard navigation, Arabic RTL,
   narrow responsive widths, loading/empty/error/retry states, and real receipt
   reopen/reprint.
2. Verify XLSX in Excel or LibreOffice, including dates, running balances,
   branches, source references, totals, and RTL display.
3. Use only an explicitly authorised disposable tenant/branch/customer for any
   real credit or payment mutation. No such mutation was run in this pass.
4. Keep production frontend aliasing, `main` merge, mobile/purchase work, and
   Electron packaging outside this handoff.

## Commit distinction

`b31295f78ccffcd5355aa0c835a62f403214437f` is the exact tested and deployed
application commit. This release record is a follow-up documentation-only
commit and must not be substituted for the deployed application SHA.
