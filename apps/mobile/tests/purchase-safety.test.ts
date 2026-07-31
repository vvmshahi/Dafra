import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(repo, file), "utf8");
const purchaseDrawer = read("src/pages/inventory/PurchaseDrawer.tsx");
const schema = read("supabase/migrations/20260721000100_dafra_current_schema_and_security.sql");
const productReceipts = read("supabase/migrations/20260725000700_product_units_commercial_workflow.sql");
const mobileApi = read("apps/mobile/src/operationalApi.ts");

assert.match(purchaseDrawer, /from\('purchases'\)\s*\.insert\(purchasePayload\)/);
assert.match(purchaseDrawer, /from\('purchase_items'\)\.insert\(/);
assert.match(purchaseDrawer, /confirm_purchase_receiving/);
assert.match(schema, /confirm_purchase_receiving"\("p_purchase_id" "uuid", "p_confirm" boolean/);
assert.doesNotMatch(schema, /CREATE OR REPLACE FUNCTION "public"\."(?:create|post)_purchase(?:_\w+)?"/);

const purchaseTable = schema.slice(
  schema.indexOf('CREATE TABLE IF NOT EXISTS "public"."purchases"'),
  schema.indexOf('CREATE OR REPLACE VIEW "public"."reporting_counted_purchases_v"'),
);
assert.doesNotMatch(purchaseTable, /idempotency_key/);
assert.doesNotMatch(purchaseTable, /operation_id/);

assert.match(productReceipts, /receive_product_stock_with_units_v1/);
assert.match(productReceipts, /pg_advisory_xact_lock/);
assert.match(productReceipts, /IDEMPOTENCY_FINGERPRINT_MISMATCH/);
assert.match(productReceipts, /idempotent_replay', true/);
assert.match(mobileApi, /PURCHASE_POSTING_REQUIRES_SERVER_IDEMPOTENCY = true/);
assert.match(mobileApi, /loadStockMovementHistory/);

console.log("Purchase posting safety audit passed");
