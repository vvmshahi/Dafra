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

## Authoritative purchase-contract audit

There is no safe all-in-one purchase-posting RPC in the reviewed schema. The current web flow creates a purchase header with a direct `purchases.insert`, then separately creates receiving lines with `purchase_items.insert`. A detailed purchase is initially `draft` / `pending_confirmation`; `confirm_purchase_receiving(p_purchase_id, p_confirm)` subsequently locks the purchase, locks its lines, creates `purchase_stock_movements`, and changes stock for linked `inventory_items` in its own transaction. It serializes confirmation for one existing purchase with an advisory lock and rejects a second confirmation.

This is not an idempotent purchase-creation contract:

- `purchases` has no operation-id or request-fingerprint column and no unique operation-key index.
- No `create_purchase*` or `post_purchase*` server function exists.
- A repeated direct header insert gets a new UUID; repeating the following line insert therefore creates another purchase, not a replay result.
- A failure between the two browser calls can leave a header without lines; confirmation cannot repair or identify the caller's intended operation.
- `update_purchase_entry` is a safe edit RPC for an existing eligible purchase, not a creation RPC.
- `confirm_purchase_receiving`, `cancel_purchase_receiving`, and `delete_purchase_receiving` enforce authority and lifecycle rules for an existing purchase, but accept no client operation ID or payload fingerprint.

The repository does contain a separate safe single-product receipt contract: `receive_product_stock_with_units_v1` (through `receive_product_stock`). It validates authority, supplier and unit conversion, takes an advisory transaction lock, records a payload fingerprint, replays an identical idempotency key, rejects a conflicting one, updates product stock, writes `product_stock_receipts`, and writes a POS movement. It does **not** create a purchase header or purchase lines and must not be misrepresented as purchase posting.

### Required reviewed server addition — not implemented or deployed

The narrowest acceptable next migration is a `post_purchase_receiving_v1(p_payload jsonb)` RPC for an explicitly supported receiving mode. It must add a nullable client operation ID and immutable request fingerprint to the purchase record (or a narrowly scoped purchase-operation table) with a unique `(tenant_id, branch_id, operation_id)` constraint. In one transaction it must lock the operation key, validate role/scope/supplier/items/product-unit versions, compute server totals, create the header and lines, apply each approved stock target, write one movement per stock line with purchase and line references, mark receiving confirmed, and return the complete result. Existing-key behavior must be: matching fingerprint returns the original result; a different fingerprint fails with an idempotency conflict. The implementation must preserve the existing inventory-item receiving path and explicitly define the saleable-product/unit target before it is reviewed.

## Implementation status

The mobile drawer now exposes Categories, Products, Units & packages, Product barcodes, Stock, Customers, Suppliers, Purchases, and Expenses. Functional list/search/retry/error states and simple guarded forms are present for categories, products, units, barcodes, stock adjustments, customers, suppliers, and expenses. Product forms reuse branch categories and support the valid backend VAT enum, SKU, service flag, stock tracking, and opening quantity. Barcode entry supports the native scanner plus manual fallback and permission-denied messaging.

Categories, products, customers, suppliers, and expenses now expose the existing web-authorised edit controls. Categories/customers/suppliers/products use activate/deactivate instead of a new destructive flow; category deletion remains absent from mobile so foreign-key dependency protection is not bypassed. Expenses follow the existing web policy: update and delete are direct scoped operations because the current schema exposes no locked/accounted lifecycle state.

The stock screen now reads authenticated `inventory_item_stock_movements` and `purchase_stock_movements`, including product, base-unit context, date, source, reference, delta, and before/after values when available; its scoped search also filters those movement rows. The POS product ledger (`pos_stock_movements`) remains service-only, so sales, returns, and manual product-adjustment history cannot be presented honestly without a reviewed reporting RPC. Stock adjustments now use a stable operation ID for the life of the form: an uncertain response can be retried with the same key and the approved server RPC returns its idempotent result. Direct table contracts do not claim server replay protection where the backend does not provide it.

## Verification

- Mobile contract tests: passed.
- Operational workflow contract tests: passed.
- Purchase posting safety audit: passed; it asserts that current web creation is two direct inserts, that no purchase creation RPC or operation key exists, and that the product receipt RPC is a distinct idempotent contract.
- TypeScript typecheck: passed.
- Mobile production bundle: passed; Vite emitted only the existing chunk-size warning.
- Capacitor Android sync: passed.
- Android debug build: passed with Gradle 8.14.3 / SDK 36.
- `git diff --check`: passed.
- Embedded public Supabase URL: verified once in the final mobile bundle.
- `service_role` string in final mobile bundle: zero matches.

Final APK:

`/Users/admin/Desktop/Dafra-mobile-operational/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

SHA-256: `9623f94a6ecf9ba18cd3971b071b798d90c3467d5674cd9f59aeb118dcf04670`

Size: 47,322,204 bytes
Package: `com.kubri.pos.dev`, version `1.0`, target SDK 36, min SDK 26

## Device validation

Device: Xiaomi M2010J19CI, Android 12/API 31, arm64-v8a. The APK was installed with `adb install -r`; app data was not cleared and the authenticated demo session survived the upgrade and restart. The resumed screen showed `Kubri Trading Demo`, dashboard sales content, and invoices. Camera permission was already granted.

Xiaomi rejects automated tap injection with `INJECT_EVENTS`; no bypass was attempted. Observed logs contained no app crash or fatal network error. The product-owner must manually exercise the workflow checklist below.

## Manual product-owner checklist

- [ ] Categories: create, edit, activate/deactivate, search, and category selection in a product form.
- [ ] Products: create/edit, category, VAT, SKU, selling price, service/non-stock/stock-tracked variants, opening stock, and validation.
- [ ] Units/packages: base and package units, conversion quantity, unit price, receiving/selling flags, and referenced-transaction edit restrictions.
- [ ] Barcodes: manual entry, native scan, unit association, uniqueness error, denied-camera fallback, and lookup.
- [ ] Stock: overview, low-stock state, positive/negative adjustment, approved adjustment type, available movement history, and exact package conversion.
- [ ] Customers: individual/business, VAT, contact/address, create/edit, active state, Walk-in Customer handling, and POS readiness.
- [ ] Suppliers: create/edit, contact/VAT data, active state, validation, and purchase history where available.
- [ ] Purchases: supplier/product/unit selection, quantities, cost/VAT/totals, save/post/receive, stock increment, retry behavior, and cancellation policy.
- [ ] Expenses: date/category/amount/VAT/payment/notes, create/edit policy, duplicate tap, and report/register linkage.
- [ ] Restart/session persistence, offline/reconnect, Android Back, English, and Arabic/RTL.

## Remaining Phase 2 work and release blockers

This is not a completion certification. The following remain blocked or deferred:

1. Purchase create/post/receive is intentionally unavailable until the proposed reviewed server-side idempotent transaction is accepted and migrated.
2. No authorised disposable write tenant was supplied, so end-to-end mutations, stock increment after receiving, and audit-ledger verification were not run.
3. Product-owner manual interaction is still required because Xiaomi blocks host tap injection.
4. POS product sales/returns/manual-adjustment history is not queryable to an authenticated client; a reviewed scoped reporting RPC is required for complete movement coverage.
5. Low-stock threshold persistence, unit/barcode archive screens, purchase detail/reconciliation, and receipt/report linkage remain later work.

Exact Phase 2 starting point: this feature branch tip after the focused implementation, test, and documentation commits; resolve the purchase idempotency contract and obtain an authorised non-fiscal disposable tenant before enabling writes.

## Verdict

`KUBRI_MOBILE_OPERATIONAL_WORKFLOWS_BLOCKED`
