# Version 1 UI predeploy snapshot

Captured on 2026-07-28 (Asia/Kolkata) before release staging, commits, tags, pushes, or deployment changes.

## Deployment contract

- Working branch: `feature/ui-refinement-20260726`
- Working HEAD: `d3952ecf7a5ffd401aec051c07da12bad984981d`
- Remote release-branch HEAD before release: `d3952ecf7a5ffd401aec051c07da12bad984981d`
- Production branch configured in Vercel: `main`
- Remote production HEAD: `d591c6ac8838ee4dcfc8194eee7a58c51c549889`
- Merge base with production: `8dd0f980b59c352f64b2cc6f21dfd01c2ab530a0`
- Production commits not yet in this branch at capture time: `a0ce57e`, `0a2e314`, `5740280`, merge `d591c6a`
- Origin: `https://github.com/vvmshahi/Dafra.git`
- Vercel project: `dafra` (`prj_dqMRy6aDjapYQTy661moyzrYWShC`)
- Deployment flow: GitHub pushes create Vercel Preview deployments; an approved Preview can be promoted to Production. The project production branch is `main`.
- Production aliases: `kubri.shop`, `www.kubri.shop`, `dafra.vercel.app`
- Current production deployment before release: `dpl_EVbKCXqZ8nf6mdSykvUvnFbYghnw`
- Current production source commit before release: `22f010dfbcb773c0cf633e7a3a19df8c39fce862`

## Working-tree summary

- Tracked changed paths: 104
- Untracked paths: 47
- Tracked deletions: 5
- Diff summary before this snapshot: 104 files, 8,012 insertions, 5,438 deletions

### Tracked modifications by category

- Release manifest: `package.json`
- Frontend tests: 12 existing `scripts/test-*.mjs` files
- Shared UI/layout/hooks: `src/components/**`, `src/hooks/useAuth.ts`, `src/hooks/usePosSession.ts`
- Frontend libraries: barcode scanner, invoice view/cache, and Saudi date helpers under `src/lib/**`
- English translations: 16 changed namespaces under `src/localization/locales/en/`
- Arabic translations: the matching 16 namespaces under `src/localization/locales/ar-SA/`
- Frontend pages: Owner, Branch, auth, customers, employees, expenses, inventory, invoices, onboarding, POS, printing, products, purchases, reports, settings, super-admin client detail, and suppliers

### Intended tracked deletions and replacements

- `src/pages/customers/CustomerDrawer.tsx` → `src/pages/customers/CustomerModal.tsx`
- `src/pages/expenses/ExpenseDrawer.tsx` → shared expense modal shell and daily/fixed modal implementations
- `src/pages/expenses/FixedExpenseDrawer.tsx` → `src/pages/expenses/FixedExpenseModal.tsx`
- `src/pages/inventory/StockItemDrawer.tsx` → `src/pages/inventory/StockItemModal.tsx`
- `src/pages/suppliers/SupplierDrawer.tsx` → `src/pages/suppliers/SupplierModal.tsx`

### Untracked release documentation

- `docs/credit-note-model-audit.md`
- `docs/credit-note-redesign-proposal.md`
- `docs/p2-batch1-expense-unused-keys.md`
- `docs/p2-batch2-legacy-surface-inventory.md`
- `docs/p2-batch3-responsive-rtl-audit.md`
- `docs/p2-batch4-runtime-audit.md`
- `docs/production-checkout-incident-diagnostics.md`
- `docs/production-checkout-timezone-audit.md`
- `docs/releases/version-1-ui-predeploy-snapshot.md`

### Untracked frontend tests and harness

- `scripts/runtime/p2-batch4-interactions.harness.tsx`
- `scripts/test-branch-modal-visual-stability.mjs`
- `scripts/test-branch-tabbed-modal.mjs`
- `scripts/test-customer-modal-ui.mjs`
- `scripts/test-expense-modal-ui.mjs`
- `scripts/test-invoice-detail-ui.mjs`
- `scripts/test-invoice-session-filters.mjs`
- `scripts/test-manage-categories.mjs`
- `scripts/test-owner-workspace-v1.mjs`
- `scripts/test-p1-ui-remediation.mjs`
- `scripts/test-p2-batch1-ui.mjs`
- `scripts/test-p2-batch2-ui.mjs`
- `scripts/test-p2-batch3-ui.mjs`
- `scripts/test-p2-batch4-runtime.mjs`
- `scripts/test-pos-customer-search-create.mjs`
- `scripts/test-pos-unified-scanner.mjs`
- `scripts/test-printing-documents-workspace.mjs`
- `scripts/test-product-archive.mjs`
- `scripts/test-product-catalogue.mjs`
- `scripts/test-product-editor-compact-ui.mjs`
- `scripts/test-product-editor-modal-ui.mjs`
- `scripts/test-product-editor-v1-ui.mjs`
- `scripts/test-purchase-modal-ui.mjs`
- `scripts/test-stock-page-ui.mjs`
- `scripts/test-supplier-modal-ui.mjs`

### Untracked frontend implementation

- `src/lib/archiveEntity.ts`
- `src/lib/pos/customerSearch.ts`
- `src/lib/pos/unifiedScanner.ts`
- `src/lib/products/archiveProduct.ts`
- `src/lib/products/catalogue.ts`
- `src/lib/products/productEditorUi.ts`
- `src/pages/customers/CustomerModal.tsx`
- `src/pages/expenses/DailyExpenseModal.tsx`
- `src/pages/expenses/ExpenseModalShell.tsx`
- `src/pages/expenses/FixedExpenseModal.tsx`
- `src/pages/inventory/PurchaseBillModal.tsx`
- `src/pages/inventory/StockItemModal.tsx`
- `src/pages/pos/PosCustomerQuickCreateModal.tsx`
- `src/pages/suppliers/SupplierModal.tsx`

## Explicit exclusions

The following ignored local/generated paths are excluded from commits and deployment source:

- `.env.local` — local credentials/configuration
- `.vercel/` — local Vercel linkage metadata
- `dist/` — generated build output
- `node_modules/` — installed dependencies

No changed path was found under `supabase/`, `scripts/sql/`, `migrations/`, `database/`, `backend/`, `server/`, API-function directories, `.env.example`, `vercel.json`, `vite.config.ts`, or `package-lock.json` at snapshot time.

## Release-scope decision

The listed source, locale, frontend-test, and audit-document paths are candidates for the Version 1 frontend release. They must still pass secret scanning, replacement/import verification, translation validation, the complete registered frontend regression suite, production-branch synchronization, and preview smoke verification before promotion.
