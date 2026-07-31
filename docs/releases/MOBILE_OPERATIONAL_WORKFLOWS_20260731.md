# Kubri Mobile Operational Workflows — Phase 1

Date: 2026-07-31  
Starting commit: `9ed0db737dc9d14cf28e2ac50981e41016a72799`  
Feature branch: `feature/mobile-operational-workflows-20260731`

## Scope and safety

This worktree is isolated from the original dirty checkout and the mobile audit branch. No web, Electron, fiscal, ZATCA, or database migration changes were made. The mobile implementation reuses the stable web contracts and fails closed unless the build contains an explicitly authorised tenant and Branch scope.

The connected account is the non-fiscal demo workspace `Kubri Trading Demo`. The feature build has no authorised operational-write environment values, so no mutation test data was created or changed. The device was used for read-only observation and APK upgrade validation only.

## Contracts reused

- Categories: scoped `categories` table reads/writes and active-state updates.
- Products: `create_product_secure`, `update_product_secure`, and `update_product_stock_settings`.
- Units/packages: `get_product_units`, `create_product_unit`, and `update_product_unit`.
- Barcodes: `create_product_unit_barcode`; existing native `scanSingleBarcode` with manual fallback.
- Product stock: branch-scoped `products` reads and the authoritative stock-settings RPC with an idempotency key for adjustments.
- Customers, suppliers, expenses: scoped table contracts matching the web payload fields.
- Purchases: existing scoped list read; posting remains gated because the reviewed web insert/receiving path does not expose a purchase-level idempotency contract.

## Implementation status

The mobile drawer now exposes Categories, Products, Units & packages, Product barcodes, Stock, Customers, Suppliers, Purchases, and Expenses. Functional list/search/retry/error states and simple guarded forms are present for categories, products, units, barcodes, stock adjustments, customers, suppliers, and expenses. Product forms reuse branch categories and support VAT treatment, SKU, service flag, stock tracking, and opening quantity. Barcode entry supports the native scanner plus manual fallback and permission-denied messaging.

Client duplicate-submit protection uses the existing Capacitor Preferences store and busy-state guards. Authoritative stock adjustments also pass the server idempotency key through the approved RPC. Direct table contracts do not claim server replay protection where the backend does not provide it.

## Verification

- Mobile contract tests: passed.
- Operational workflow contract tests: passed.
- TypeScript typecheck: passed.
- Mobile production bundle: passed; Vite emitted only the existing chunk-size warning.
- Capacitor Android sync: passed.
- Android debug build: passed with Gradle 8.14.3 / SDK 36.
- `git diff --check`: passed.
- Embedded public Supabase URL: verified once in the final mobile bundle.
- `service_role` string in final mobile bundle: zero matches.

Final APK:

`/Users/admin/Desktop/Dafra-mobile-operational/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256: `80c5eba1b16fdaec18ed2244d3805f24f01b56d6c99df5457305bb6a645cd4e9`  
Size: 47,592,625 bytes  
Package: `com.kubri.pos.dev`, version `1.0`, target SDK 36, min SDK 26

## Device validation

Device: Xiaomi M2010J19CI, Android 12/API 31, arm64-v8a. The APK was installed with `adb install -r`; app data was not cleared and the authenticated demo session survived the upgrade and restart. The resumed screen showed `Kubri Trading Demo`, dashboard sales content, and invoices. Camera permission was already granted.

Xiaomi rejects automated tap injection with `INJECT_EVENTS`; no bypass was attempted. Observed logs contained no app crash or fatal network error. The product-owner must manually exercise the workflow checklist below.

## Manual product-owner checklist

- [ ] Categories: create, edit, activate/deactivate, search, and category selection in a product form.
- [ ] Products: create/edit, category, VAT, SKU, selling price, service/non-stock/stock-tracked variants, opening stock, and validation.
- [ ] Units/packages: base and package units, conversion quantity, unit price, receiving/selling flags, and referenced-transaction edit restrictions.
- [ ] Barcodes: manual entry, native scan, unit association, uniqueness error, denied-camera fallback, and lookup.
- [ ] Stock: overview, low-stock state, positive/negative adjustment, reason, movement history, and exact package conversion.
- [ ] Customers: individual/business, VAT, contact/address, create/edit, active state, Walk-in Customer handling, and POS readiness.
- [ ] Suppliers: create/edit, contact/VAT data, active state, validation, and purchase history where available.
- [ ] Purchases: supplier/product/unit selection, quantities, cost/VAT/totals, save/post/receive, stock increment, retry behavior, and cancellation policy.
- [ ] Expenses: date/category/amount/VAT/payment/notes, create/edit policy, duplicate tap, and report/register linkage.
- [ ] Restart/session persistence, offline/reconnect, Android Back, English, and Arabic/RTL.

## Remaining Phase 2 work and release blockers

This is not a completion certification. The following remain blocked or deferred:

1. Purchase create/post/receive is intentionally unavailable until the server exposes a reviewed purchase-level idempotency/retry contract.
2. No authorised disposable write tenant was supplied, so end-to-end mutations, stock increment after receiving, and audit-ledger verification were not run.
3. Product-owner manual interaction is still required because Xiaomi blocks host tap injection.
4. The mobile screen does not yet expose the full edit/archive controls for every module, a product/unit-specific movement history view, or the full purchase workflow.
5. Low-stock threshold persistence and receipt/report linkage must follow the corresponding web UI contract in the next implementation pass.

Exact Phase 2 starting point: this feature branch tip after the focused implementation, test, and documentation commits; resolve the purchase idempotency contract and obtain an authorised non-fiscal disposable tenant before enabling writes.

## Verdict

`KUBRI_MOBILE_OPERATIONAL_WORKFLOWS_BLOCKED`
