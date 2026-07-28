# Version 1 final frontend release candidate — 2026-07-28

## Candidate and ancestry

- Candidate branch: `release/version1-ui-final-recovery-20260728`
- Baseline: `origin/rescue/version1-ui-with-phase1-20260728` at `588ad6f`
- Polished Version 1 ancestor: `7702e24607b3a779f3c607188652f277d020f026`
- Rescue ancestor: `588ad6f`
- Main/rescue merge base: `d591c6ac8838ee4dcfc8194eee7a58c51c549889`

The polished and rescue commits are not ancestors of `origin/main`. Production
deployment `dpl_Lo7dYCHLD81UFGJHyd95mLAg2v9H` was built automatically from
`main` at `9ec9da5`; it was a newer deployment from incomplete Git ancestry, not
a rollback of the polished commit.

## Newer main behavior integrated

The frontend portion of ZATCA authentication hotfix `9ec9da5` was manually
reconciled into the rescue UI:

- current access-token retrieval;
- one bounded near-expiry refresh;
- missing/invalid session cleanup and sign-in redirect;
- `Authorization` and `apikey` request headers;
- safe 401 and invalid-OTP classification;
- localized English and Arabic session/OTP messages.

Files manually reconciled:

- `src/lib/zatca/api.ts`
- `src/pages/settings/ZatcaTab.tsx`
- `src/localization/locales/en/zatca.json`
- `src/localization/locales/ar-SA/zatca.json`
- `scripts/test-zatca-onboarding-auth.mjs`

No database migration or Edge Function source was integrated or changed.

## Preserved Version 1 contract

The candidate retains the rescue manifest contracts: centered Product, Stock,
Customer, Supplier, Expense, Employee, Purchase, and branded tabbed Branch
modals; compact Owner branch-session cards; Branch Directory; Printing &
Documents; barcode workflows; unified POS scanner/search; POS customer
quick-create; responsive density; accessibility; and English/Arabic RTL parity.

Owner/Admin navigation does not expose the normal Operations entry. Owner
runtime recovery and bounded stale-session handling remain present.

Component names such as `ProductDrawer`, `PurchaseDrawer`, and
`ProductStockReceiptDrawer` remain for compatibility, but their active renderers
are centered, sidebar-aware dialogs. `BarcodeBatchPrintDrawer` remains an active
specialized batch-print workspace; it is not an Add/Edit entity workflow.
Reusable drawer infrastructure is retained where it does not activate an old
Add/Edit path.

## Verification

- Polished commit ancestry: present
- Rescue commit ancestry: present
- ZATCA frontend authentication behavior: present
- Production build: passed
- Version 1 UI contracts: passed
- Owner workspace/runtime: passed
- Branch/Product/Customer/Supplier/Expense/Purchase/Stock modal contracts: passed
- POS scanner and customer quick-create: passed
- Printing and barcode contracts: passed
- P1/P2 responsive, RTL, accessibility, and runtime contracts: passed
- `git diff --check`: passed

Physical scanners and printers were not tested. Authenticated Owner and Branch
browser smoke testing remains a manual Preview gate.

## Deployment plan

1. Push this candidate branch.
2. Allow the Git-linked `dafra` Vercel project to build a new Preview from the
   candidate commit.
3. Complete authenticated Owner, Branch, modal, POS, printing, English/Arabic,
   responsive, and short-height smoke checks.
4. In a separate approved production task, merge the candidate into `main`
   using a normal merge commit. This combines the polished/rescue ancestry with
   current main history so future automatic main deployments cannot restore the
   old UI.

Do not promote an older Preview or pin production to a feature deployment.
