# Kubri Customer and Credit Targeted Simplification — 2026-08-04

## Verdict

`KUBRI_CUSTOMER_AND_CREDIT_TARGETED_SIMPLIFICATION_BLOCKED`

The focused source changes are on
`feature/customer-credit-receivables-20260803`, based on starting SHA
`f35b1acc574a7e210d179773ac2a2b1b983465cb`. They simplify the customer profile,
customer credit account, sidebar workspace, and statement entry flow without
touching mobile, POS redesign, Electron, ZATCA, main, or the production alias.

## Implemented scope

- Customers directory: Business uses Kubri green, the directory heading is
  VAT Number, and VAT-only values remain sourced from `vat_number`; city and
  last purchase remain available.
- Customer profile: compact dark-green identity header, no generic PDF action,
  centered compact tabs, final tabs Overview / Products / Customer Credit, and
  legacy Invoices/Documents/Customer Report URLs redirect to Overview.
- Overview: compact filters precede four KPI cards; Document History renders
  below the KPI area; completed-document wording is used for finalized history.
- Customer Credit profile: direct account presentation, four useful KPIs,
  Receive Payment, statement range chooser, and Account History. The redundant
  Open Customer Credit action and explanatory setup/open-invoice panels are no
  longer rendered.
- Sidebar Customer Credit: only Overview and Payments tabs are exposed;
  Customers is rendered in Overview and the separate Statements tab is removed.
  Branch Comparison is no longer rendered. Existing payment and statement
  RPC/export routes remain in use.
- Statement chooser supports This month, Last month, Last 3 months, This year,
  Custom range, and explicit All activity. Preview/print/XLSX continue through
  the existing statement route and export implementation.

## Blocking contract finding

The existing `get_customer_receivables_report_v1` server function uses
`start_date` and `end_date` for activity metrics, but its balance aggregation
does not filter ledger entries by an as-of date. Therefore the requested
Balance as of Today / Yesterday / Custom model cannot be represented safely by
the current RPC. The UI labels the current balance and activity period
separately; it does not pretend that activity dates change the authoritative
balance.

A reviewed additive server migration/function revision is required before
certifying the final As-of model. No migration was created or applied in this
pass, and no financial or fiscal rows were mutated.

## Verification

Passed:

- `npm run test:customer-profile-targeted-refinement`;
- `npm run test:customer-credit-targeted-simplification`;
- `npm run test:customer-credit-final-ui-refinement`;
- `npm test`;
- `npx tsc --noEmit`;
- `npm run build`;
- `git diff --check`.

The build retains the known large-main-chunk warning. Authenticated visual
evidence was not captured in this non-interactive environment; manual review
remains required at 375, 430, 768, 1024, 1366, 1440, and 1920 widths in English
and Arabic/RTL, including URL compatibility, keyboard focus, statement preview,
empty/error/retry states, and source links.

## Deployment handoff

The exact tested application source is commit
`636c153d353cef8c6a5890539e021c3578961f78` on
`feature/customer-credit-receivables-20260803`.

- Preview deployment: `dpl_79objRmihMxwmw3GtZPvPN1pSJ8U`;
- Preview URL: `https://dafra-4rt8v510n-mohammed-shahin-v-vs-projects.vercel.app`;
- state: `READY`;
- inspector: `https://vercel.com/mohammed-shahin-v-vs-projects/dafra/79objRmihMxwmw3GtZPvPN1pSJ8U`.

This Preview is available for manual review, but it is not certified until
the As-of contract is resolved. No production alias or main merge was
performed.
