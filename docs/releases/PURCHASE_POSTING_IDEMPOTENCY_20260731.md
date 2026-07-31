# Purchase Posting Idempotency — Server Contract

Status: implementation prepared; local execution and remote deployment are blocked pending repair of the local Docker image store and host disk capacity.

## Root cause and scope

Legacy web purchase creation remains two authenticated browser writes: a `purchases` header insert followed by `purchase_items` inserts. Detailed purchases begin as `draft` / `pending_confirmation`; `confirm_purchase_receiving` later applies inventory-item stock. That flow has no purchase-level operation ID or request fingerprint, so a network retry can create another purchase.

The new forward-only migration is `20260731000100_purchase_posting_idempotency.sql`. It adds `purchase_posting_operations` and `post_purchase_receiving_v1(p_payload jsonb)`. It does not alter invoice, checkout, ZATCA, Atomic, Legacy, or the existing web direct-insert flow.

## V1 request and transaction

`post_purchase_receiving_v1` accepts only an authenticated, branch-scoped `receive` request with an operation UUID, branch UUID, active scoped supplier, purchase date, payment/tax inputs, optional bill/notes, optional validated `expected_totals`, and product-unit lines. `tenant_id`, calculated totals, stock target, conversion, base quantity, and names are never trusted from the client.

The function normalizes line order and decimal values, fingerprints the semantic request, serializes `(branch_id, operation_id)` with an advisory lock and a unique durable operation row, validates product/unit scope/version/conversion, creates the purchase and lines, delegates each saleable-product stock effect to `receive_product_stock_with_units_v1`, writes purchase-linked movement records, stores a stable completed result, and returns it. PostgreSQL function execution is one transaction: an error rolls back the pending operation, header, lines, receipts, movements, and stock effect together.

The contract deliberately handles only immediate product receiving. It creates a normal `detailed_receiving` purchase in `posted` / `confirmed` state. Legacy web draft/confirmation remains a distinct business stage and is not silently collapsed. Existing web direct inserts therefore remain non-idempotent until a separate reviewed web migration adopts this RPC.

## Idempotency and authority

- First request: reserves and completes one operation.
- Identical retry: returns the stored result with `idempotent_replay: true`.
- Changed payload with the same operation UUID: `PPC06` / `PURCHASE_IDEMPOTENCY_CONFLICT`.
- Concurrent same UUID: waits on the advisory lock, then returns the completed result; no second purchase or stock effect is possible.
- Known pending operation: `PPC07` / `PURCHASE_OPERATION_IN_PROGRESS`.
- User/branch/supplier/product/unit/validation failures use distinct `PPC01`–`PPC10` SQLSTATE codes so the mobile client need not parse prose.

Authority is derived from `auth.uid()` and `user_profiles`, then checked against the requested branch and supplier. The RPC is `SECURITY DEFINER` with `search_path = public, pg_temp`, `row_security = off`, public/anon execution revoked, and authenticated execution granted. The idempotency table is service-role-only; clients receive reconciliation through the RPC result.

## Stock and reversal behavior

The schema already contains reserved product-unit snapshots on purchase lines and purchase movements. New saleable-product rows use `stock_target_type = saleable_product`; legacy inventory-item rows remain unchanged. The existing package-aware receipt RPC owns product stock mutation, package conversion, receipt audit, unit first-use marking, and POS stock movement. The new purchase-linked movement provides the purchase and line reference required for receiving history.

Non-stock and service products are recorded as `non_stock` / `skipped` lines and have no stock effect. `cancel_purchase_receiving` is extended to reverse new saleable-product purchase movements safely, while preserving legacy inventory-item reversal behavior.

## Verification status

`node scripts/test-purchase-posting-idempotency.mjs` verifies the migration’s security, normalized idempotency, calculation, stock-ledger, reversal, and non-scope contract markers.

Actual local migration reset, pgTAP/database state tests, remote migration parity, remote application, Android RPC integration, controlled tenant mutation tests, APK build, and Xiaomi manual purchase testing are not claimed as complete.

## 2026-07-31 local environment recovery record

The original hangs occurred before Supabase could create or reset a project: every Docker daemon request (`docker info`, container/network/volume listing, and the Supabase commands) timed out while the Docker Desktop socket was still owned by a backend process that had been running for nine days. Docker Desktop logs record a prior VM stop caused by `no space left on device`.

Docker Desktop 4.83.0 was recovered with its supported restart path where possible. The normal quit and `docker desktop restart` calls were themselves wedged, and the exact stale backend process ignored `TERM`; it was then force-stopped and Docker Desktop was relaunched. The new Engine 29.6.2 process responds normally and Supabase CLI is 2.109.1. No container, network, image, volume, database, migration, or production data was removed or changed during recovery.

The recovery exposed a second, decisive blocker: `docker system df` fails with a containerd content-blob input/output error following the disk-full event, while the host system volume has only 1.2 GiB free (94% used). Existing local projects occupy the standard `dafra` ports and a separate temporary project occupies the 58431–58434 range. The repository configuration also still uses the legacy mixed-case local project ID `Dafra`; it was not changed because a fresh lower-case validation project could not safely be created with a corrupt image store and insufficient disk.

Consequently, this task did not start, reset, or reuse an existing local database for migration testing. A clean disposable environment is required to prove the full migration chain, RPC compilation, row-level/stateful behavior, concurrency, security, and web compatibility. The static migration contract test continues to pass, but it is not a substitute for those database tests. No remote migration or remote parity operation was run.
