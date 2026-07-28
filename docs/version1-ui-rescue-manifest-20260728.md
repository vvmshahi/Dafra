# Version 1 UI rescue manifest — 2026-07-28

## Ancestry and regression

- Polished UI source: `7702e24607b3a779f3c607188652f277d020f026`.
- Main before rescue: `be61f38209bb82226b0ec2488855c2601d4a2fab`.
- Merge base: `d591c6ac8838ee4dcfc8194eee7a58c51c549889`.
- The polished UI lineage was not an ancestor of main. Phase 1 was merged onto
  the older main frontend at `4387e13`; the UI was omitted, not reverted by an
  individual conflict.
- Vercel production correctly built branch `main`, commit `be61f38`. Production
  aliases were not stale; they pointed to the latest build of the regressed
  ancestry.

## Difference classification

The rescue branch starts at the exact polished UI commit. Its source delta from
that commit is limited to:

1. **Phase 1 logic preserved:** `App.tsx`, `hooks/useAuth.ts`,
   `lib/authRouteRecovery.ts`, onboarding locale resources,
   `OnboardingPage.tsx`, `SetupBranchPage.tsx`, and the Super Admin client
   onboarding state in `ClientsPage.tsx`.
2. **Runtime hotfix preserved:** `Sidebar.tsx`,
   `AppRuntimeErrorBoundary.tsx`, `authSessionRecovery.ts`,
   `ownerSetupCompletion.ts`, `main.tsx`, and English/Arabic recovery copy.
3. **Tests:** the owner runtime and mounted route/auth recovery contracts.

No checkout, invoice, ZATCA, VAT, payment, stock, financial, product, POS, or
document-rendering implementation differs from the verified polished UI base.

## Restored UI contract

The polished lineage supplies the centered Product, Stock, Customer, Supplier,
Expense, Employee, Purchase, and branded tabbed Branch modals; compact Owner
branch-session cards; Printing & Documents; barcode workflow; unified POS
scanner/search; POS customer quick-create; responsive density; and RTL
refinements.

Active legacy Branch and Employee drawers, `StockItemDrawer`, native browser
confirmations, and the obsolete Product opening-stock side panel are absent.
Operations remains absent from Owner/Admin navigation and unchanged for Super
Admin.
