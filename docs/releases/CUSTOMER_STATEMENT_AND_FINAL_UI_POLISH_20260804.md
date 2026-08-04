# Kubri Customer Statement and Final UI Polish — 2026-08-04

## Executive result

The approved Customer Profile and Customer Credit navigation was preserved.
This pass repaired the Customer Statement client flow and completed the
remaining targeted UI polish without changing credit policy, accounting,
payment allocation, fiscal, stock, or register behavior.

Starting application/docs head: `50d05f418f541ef5f565de224d8170cad75bdea1`.
Tested application commit: `801151701a7592a7729f2a13361f03071d3b0dd4`.
The documentation-only follow-up commit is recorded after Preview deployment.

## Implemented UI

- Customers directory now uses one compact toolbar for the wider search, All /
  Individual / Business filters, counts, and Add Customer. Empty values remain
  consistent (`—`), action buttons retain accessible labels/tooltips, and
  Delete is visually secondary while permissions and confirmation remain
  unchanged.
- Customer Profile keeps Overview / Products / Customer Credit. Overview KPI
  cards now use equal 4/2/1 responsive columns. The approved dark-green header,
  metadata, centered tabs, and responsive focus behavior remain in place.
- Products adds a dark-green section header, product count and total amount,
  compact product search, and an optional unit filter. Existing calculations,
  columns, source filtering, and currency alignment remain unchanged.
- Account History is a bank-statement-style table with Date & time,
  Description, Reference, Debit, Credit, Balance, and Actions. Human-readable
  transaction labels and source links replace visible UUID fragments. The
  authoritative ledger ordering remains effective timestamp, creation
  timestamp, and ID; no client-side reordering was introduced.
- Receive Payment remains a proper accessible modal with Amount, Method,
  Reference, and Notes, Escape/focus handling, duplicate-submit guard,
  persistent operation ID, loading/error states, and a success result showing
  receipt number, amount, method, and remaining balance. Split/manual controls
  remain hidden by default; server oldest-first allocation remains unchanged.
- Customer Statement is now a proper modal with period presets, custom dates,
  owner-safe branch scope, preview loading/error/retry handling, summary
  gating, and output buttons disabled until preview succeeds. Statement Preview,
  Print, Save PDF, and Download XLSX all use the existing workspace RPC and
  context-sensitive route.
- Print remains A4-oriented with neutral headers, readable transaction labels,
  source links, opening/closing balances, and RTL direction. PDF output is a
  real A4 jsPDF document with the existing Kubri PDF font infrastructure and
  multi-row table support. XLSX remains a real typed workbook with formula
  neutralization and no visible UUID fallback.
- Shared dark-green section headers are retained for Document History,
  Products, Account History, Customer Credit Customers, Payments, and statement
  surfaces; table column headers remain light and neutral.

## Statement failure root cause and repair

The failure was client-side: the old Print Statement action rendered an inline
period panel, then routed Preview, Print, and XLSX directly to the print page
without requesting or validating a statement preview. There was no modal
loading/error state, no summary gate, no PDF action, and the print page exposed
truncated source IDs as visible references. The existing
`get_customer_receivable_workspace_v1` RPC already returns opening balance,
ordered ledger rows, running balances, closing balance, and scope. The repair
uses that contract directly; no mock data, migration, RPC replacement, or
historical rewrite was needed.

## Data and security boundary

Remote migration parity was rechecked for project `bkbphkpqcxuejozayrsy`:
all local and remote migrations match through `20260803001100`; there is no
pending or remote-only migration. No migration was created or applied.

Relevant Edge Functions were read-only listed; no function was deployed. The
remote versions observed included `zatca-compliance` 71,
`zatca-production` 69, `zatca-submit` 130, and the existing branch/account
provisioning and sandbox functions. They are outside this UI-only change.

The protected checkout `/Users/admin/Desktop/Dafra` remained on
`feature/invoice-settings-ux-redesign` at
`e70dbab70b047d550e8ecc8f2fcfe38e5f9ecceb`, preserving exactly:

- `M scripts/recover-inv-0826-0827.mjs`;
- `?? scripts/recover-zatca-pending-invoices.mjs`.

No real customer, payment, invoice, fiscal, stock, register, ZATCA, or other
financial mutation was performed.

## Verification

Passed:

- `npm run test:customer-statement-final-ui-polish`;
- `npm run test:customer-credit-visual-consistency`;
- `npm run test:customer-profile-targeted-refinement`;
- `npm run test:customer-credit-targeted-simplification`;
- `npm run test:customer-credit-final-ui-refinement`;
- `npm test`;
- `npx tsc --noEmit`;
- `npm run build`;
- `git diff --check`.

The full suite included 192 thermal receipt SSR renders, 31 Branch-only
Business/B2B customer-credit contract checks, POS-derived credit checks, and
XLSX checks. The build retains the known large-chunk warning; the new PDF
implementation is code-split into its own small chunk.

No authenticated browser screenshots were captured in this non-interactive
environment. Manual acceptance must review English and Arabic/RTL at 375, 430,
768, 1024×768, 1366×768, 1440×900, and 1920×1080, including focus trap,
source links, statement preview/empty/error states, real PDF/XLSX downloads,
multi-page print, and receipt success actions.

## Preview handoff

- Deployment: `dpl_C9Z1PbTTiZPJxduHrhTr72uCfZT7`;
- Preview URL: `https://dafra-7v78a2bl1-mohammed-shahin-v-vs-projects.vercel.app`;
- State: `READY`;
- Inspector: `https://vercel.com/mohammed-shahin-v-vs-projects/dafra/C9Z1PbTTiZPJxduHrhTr72uCfZT7`;
- Preview source: tested application commit `801151701a7592a7729f2a13361f03071d3b0dd4`.

Current `origin/main` is `549138965417c6343abf9775590464d17c0d9f4a`; the
production aliases were observed on the previously documented production
deployment `dpl_BQVkphxnBmUGX9mqHFHQrFJsVuu5`, main SHA
`59b134179c51229331bd2a686fca927089abda6e`. Neither was changed.

## Remaining manual gate

Authenticated manual acceptance remains required. This pass is ready for that
review, but it is not a substitute for an authorised disposable-tenant
stateful lifecycle test or production customer mutation approval.
