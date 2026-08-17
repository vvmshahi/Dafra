import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(new URL('../supabase/migrations/20260817000500_expenses_authority_v1.sql', import.meta.url), 'utf8')

test('expense creation is authenticated, branch-scoped, and strict about input', () => {
  assert.match(migration, /FUNCTION public\.create_expense_v1\(p_payload jsonb\)/)
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/)
  assert.match(migration, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/)
  assert.match(migration, /v_profile\.role::text NOT IN \('owner', 'admin'\)/)
  assert.match(migration, /EXPLICIT_VAT_TREATMENT_REQUIRED/)
  assert.match(migration, /EXPLICIT_PAYMENT_METHOD_REQUIRED/)
  assert.match(migration, /SUPPLIER_OUTSIDE_BRANCH_SCOPE/)
})

test('expense totals are server calculated and recurring templates stay outside the create path', () => {
  assert.match(migration, /v_total_paid \* 15 \/ 115/)
  assert.match(migration, /v_expense_before_vat \* \.15/)
  assert.match(migration, /v_vat_amount := 0/)
  assert.doesNotMatch(migration, /INSERT INTO public\.fixed_expenses/)
})

test('expense creation has scoped idempotency and authenticated-only execution', () => {
  assert.match(migration, /creation_idempotency_key uuid/)
  assert.match(migration, /IDEMPOTENCY_FINGERPRINT_MISMATCH/)
  assert.match(migration, /idempotent_replay/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_expense_v1\(jsonb\) FROM PUBLIC, anon/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_expense_v1\(jsonb\) TO authenticated/)
})

test('reporting exposes actual and recurring estimates separately', () => {
  assert.match(migration, /get_expense_report_summary_v1/)
  assert.match(migration, /actualExpenses/)
  assert.match(migration, /recurringEstimatedCosts/)
  assert.match(migration, /projectedTotalCost/)
  assert.match(migration, /get_profit_report_summary_v1/)
  assert.match(migration, /actualNetProfit/)
  assert.match(migration, /projectedNetProfit/)
})
