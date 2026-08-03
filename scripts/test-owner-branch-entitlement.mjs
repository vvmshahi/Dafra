import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260803000100_authoritative_owner_branch_entitlement.sql', 'utf8')
const owner = readFileSync('supabase/functions/create-owner-account/index.ts', 'utf8')
const clients = readFileSync('src/pages/super-admin/ClientsPage.tsx', 'utf8')
const branchEnforcement = readFileSync('supabase/phase4e-branch-limit-and-manual-suspension-enforcement.sql', 'utf8')

function isValidBranchAllowance(value) {
  return Number.isInteger(value) && value >= 1 && value <= 100
}

for (const value of [1, 3, 100]) assert.equal(isValidBranchAllowance(value), true, `accept ${value}`)
for (const value of [0, -1, 3.5, undefined, null, '3']) assert.equal(isValidBranchAllowance(value), false, `reject ${String(value)}`)
for (const paymentType of ['lifetime_free', 'one_time', 'monthly']) {
  assert.ok(owner.includes(`'${paymentType}'`), paymentType)
}

for (const fragment of [
  'branch_allowance integer',
  'ALTER COLUMN vat_number DROP NOT NULL',
  'branch_allowance BETWEEN 1 AND 100',
  "p_request_payload -> 'branch_count'",
  'INVALID_BRANCH_ALLOWANCE',
  'LEGACY_BRANCH_ALLOWANCE_REVIEW_REQUIRED',
  'v_row.branch_allowance IS DISTINCT FROM v_branch_allowance',
  'BRANCH_ALLOWANCE_MISSING',
  'BRANCH_ENTITLEMENT_CONFLICT',
  'max_branches, business_type',
  "'SA', true, v_branch_allowance",
  'paid_branch_count',
  'ts.paid_branch_count = v_branch_allowance',
  'SECURITY DEFINER',
  'SET search_path = pg_catalog, public, auth',
  'REVOKE ALL ON FUNCTION public.acquire_owner_provisioning',
  'GRANT EXECUTE ON FUNCTION public.acquire_owner_provisioning',
]) assert.ok(migration.includes(fragment), fragment)

assert.doesNotMatch(migration, /greatest\(1,\s*v_plan\.max_branches\)/i)
assert.ok(migration.includes("nullif(btrim(v_payload->>'vat_number'), '')"))
assert.ok(owner.includes('Number.isInteger(branchCount)'))
assert.ok(owner.includes('branchCount < 1 || branchCount > 100'))
assert.ok(owner.includes('branch_count: branchCount'))
assert.ok(owner.includes('payment_type: paymentType'))
assert.ok(owner.includes('branch_count: safePayload.branch_count'))
assert.ok(owner.includes('BRANCH_ENTITLEMENT_REVIEW_REQUIRED'))
assert.ok(clients.includes('MAX_OWNER_BRANCH_ALLOWANCE = 100'))
assert.ok(clients.includes('max={MAX_OWNER_BRANCH_ALLOWANCE}'))
assert.ok(clients.includes('branch_count:    branchCount'))
assert.ok(branchEnforcement.includes('IF v_active_branch_count >= v_tenant.max_branches THEN'))
assert.ok(branchEnforcement.includes("RAISE EXCEPTION 'Branch limit reached."))

console.log('owner branch-entitlement contract: PASS')
