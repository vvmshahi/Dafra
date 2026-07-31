# Purchase Posting Idempotency — Server Contract

Status: local migration and stateful validation passed; remote parity is pending Supabase linkage and credentials. Remote deployment remains intentionally blocked.

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

`node scripts/test-purchase-posting-idempotency.mjs` verifies the migration’s security, normalized idempotency, calculation, stock-ledger, reversal, and non-scope contract markers. `supabase/tests/purchase_posting_idempotency_stateful.sql` is the executable clean-database fixture for actual purchase rows, idempotency, stock, movement, rollback, and authority assertions.

Android RPC integration, controlled remote tenant mutation tests, APK build, and Xiaomi manual purchase testing are outside this server validation task and are not claimed as complete.

## 2026-07-31 local environment recovery record

The original hangs occurred before Supabase could create or reset a project: every Docker daemon request (`docker info`, container/network/volume listing, and the Supabase commands) timed out while the Docker Desktop socket was still owned by a backend process that had been running for nine days. Docker Desktop logs record a prior VM stop caused by `no space left on device`.

Docker Desktop 4.83.0 was recovered with its supported restart path where possible. The normal quit and `docker desktop restart` calls were themselves wedged, and the exact stale backend process ignored `TERM`; it was then force-stopped and Docker Desktop was relaunched. The new Engine 29.6.2 process responds normally and Supabase CLI is 2.109.1. No container, network, image, volume, database, migration, or production data was removed or changed during recovery.

The original recovery exposed a second blocker: `docker system df` failed with a containerd content-blob input/output error while the host had only 1.1 GiB free. Recovery removed only classified, reproducible data: ignored `node_modules` and build output from clean inactive worktrees; the npm, Electron, Electron Builder, Homebrew, node-gyp, pip, and TypeScript caches; and three SHA-256-verified duplicate pilot installers. No Git repository, dirty worktree, Docker container, network, image, or volume was deleted. Free space reached 15.24 GiB before Docker restart and `docker system df` subsequently succeeded (20 images, 13.23 GB total; 10 local volumes, 426.3 MB total) with no blob I/O error.

All Docker volumes were recorded and preserved: the active `dafra` certification project, a temporary migration-chain project, an unbound atomic-disposable project, and an unbound legacy mixed-case `Dafra` storage volume. The standard ports remained occupied by those projects, so validation used an additional disposable worktree with project ID `kubri_purchase_validation_20260731` and ports `59420`–`59429`. The temporary migration-chain stack had an unchanged `/private/tmp` source path and an edge runtime already exited for 35 hours; its ten running containers were stopped (not removed) to release Docker VM memory, after which the validation stack Analytics service became healthy. `supabase start --debug` completed, `supabase db reset --local --no-seed` completed after the recovery, and local history ends at `20260731000100`.

Stateful testing found and fixed one migration defect: product lifecycle provisioning correctly creates service units with `receiving_enabled = false`, but the initial RPC rejected that non-stock line before it could be skipped. The RPC now requires `receiving_enabled` only for stock-tracked, non-service lines. A clean rebuild then verified base-unit receiving, 12x package conversion, mixed stock/service lines, exact receipt/POS/purchase movement counts, identical retry, conflicting retry (`PPC06`), atomic rollback after a first line had received stock, zero quantity, inactive and cross-tenant suppliers, unauthorized and cross-tenant users, stale unit version, and same-tenant owner scope.

Two independent authenticated sessions with one operation ID produced one purchase, one receipt, one movement, final stock `41.000`, and a replay response for the second caller. Two concurrent conflicting payloads produced one purchase with package quantity `6.000`, final stock `47.000`, one receipt/movement, and `PURCHASE_IDEMPOTENCY_CONFLICT` for the loser. Anonymous and service-role execution are denied; authenticated execution without a JWT subject returns `PURCHASE_UNAUTHORIZED`. The legacy browser `simple_bill` direct insert also succeeded under the authenticated branch role and was rolled back after verification. The purchase modal and migration contract tests pass.

Remote parity is the remaining preflight condition. This workstation has no linked project ref and no Supabase access token or database password, so `supabase migration list --linked` correctly stopped before remote access. No remote migration was applied and no production data was modified.
