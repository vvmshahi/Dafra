import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  'supabase/migrations/20260731000100_purchase_posting_idempotency.sql',
  'utf8',
)

const contract = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.post_purchase_receiving_v1'),
  migration.indexOf('ALTER FUNCTION public.post_purchase_receiving_v1'),
)

assert.match(migration, /^BEGIN;/)
assert.match(migration, /SET LOCAL lock_timeout = '5s';/)
assert.match(migration, /SET LOCAL statement_timeout = '5min';/)
assert.match(migration, /COMMIT;\s*$/)

assert.match(migration, /CREATE TABLE public\.purchase_posting_operations/)
assert.match(migration, /UNIQUE \(branch_id, operation_id\)/)
assert.match(migration, /state IN \('pending', 'completed', 'failed'\)/)
assert.match(migration, /request_fingerprint text NOT NULL/)
assert.match(migration, /purchase_posting_operations_completed_result_check/)
assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
assert.match(migration, /purchase_posting_operations_service_role_all/)

assert.match(contract, /SECURITY DEFINER/)
assert.match(contract, /SET search_path = public, pg_temp/)
assert.match(contract, /SET row_security = off/)
assert.match(contract, /v_user_id uuid := auth\.uid\(\)/)
assert.doesNotMatch(contract, /p_payload\s*->>\s*'tenant_id'/)
assert.match(contract, /PURCHASE_UNAUTHORIZED/)
assert.match(contract, /PURCHASE_BRANCH_MISMATCH/)
assert.match(contract, /PURCHASE_INVALID_SUPPLIER/)

assert.match(contract, /v_action <> 'receive'/)
assert.match(contract, /jsonb_object_keys\(p_payload\)/)
assert.match(contract, /jsonb_object_keys\(v_raw_line\)/)
assert.match(contract, /jsonb_agg\(value ORDER BY/)
assert.match(contract, /trim_scale\(v_package_quantity\)/)
assert.match(contract, /expected_totals/)
assert.match(contract, /PURCHASE_TOTAL_MISMATCH/)

assert.match(contract, /pg_advisory_xact_lock\(/)
assert.match(contract, /purchase-posting:/)
assert.match(contract, /PURCHASE_IDEMPOTENCY_CONFLICT/)
assert.match(contract, /PURCHASE_OPERATION_IN_PROGRESS/)
assert.match(contract, /idempotent_replay', true/)
assert.match(contract, /INSERT INTO public\.purchase_posting_operations/)
assert.match(contract, /state = 'completed'/)

assert.match(contract, /FROM public\.products p[\s\S]*?FOR UPDATE OF p, b, u/)
assert.match(contract, /v_base_quantity := v_package_quantity \* v_product\.conversion_to_base/)
assert.match(contract, /round\(v_package_quantity, v_product\.package_quantity_scale\)/)
assert.match(contract, /PURCHASE_INVALID_PRODUCT_UNIT/)
assert.match(contract, /PURCHASE_STOCK_DISABLED/)
assert.match(contract, /public\.receive_product_stock_with_units_v1/)
assert.match(contract, /INSERT INTO public\.purchase_stock_movements/)
assert.match(contract, /'saleable_product'/)
assert.match(contract, /line_type,\n\s*receiving_status/)
assert.match(contract, /'non_stock'/)
assert.doesNotMatch(contract, /UPDATE public\.products\s+SET stock_quantity/)
assert.doesNotMatch(contract, /INSERT INTO public\.(?:purchases|purchase_items).*tenant_id.*p_payload/s)

assert.match(migration, /ALTER COLUMN inventory_item_id DROP NOT NULL/)
assert.match(migration, /purchase_stock_movements_target_reference_check/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cancel_purchase_receiving/)
assert.match(migration, /v_movement\.stock_target_type = 'saleable_product'/)
assert.match(migration, /purchase_receiving_reversed/)

assert.match(migration, /REVOKE ALL ON FUNCTION public\.post_purchase_receiving_v1\(jsonb\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.post_purchase_receiving_v1\(jsonb\)\s+TO authenticated/)
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:post|create)_invoice/)
assert.doesNotMatch(migration, /zatca_/i)

console.log('Purchase posting idempotency migration contract markers passed')
