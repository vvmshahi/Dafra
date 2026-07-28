import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('supabase/functions/delete-tenant/index.ts', 'utf8')

assert.match(source, /product_stock_receipts/)
assert.match(source, /zatca_atomic_checkout_branch_gates_v2/)
assert.match(source, /AUTH_USER_OWNS_STORAGE/)
assert.match(source, /AUTH_USER_HAS_DEPENDENCIES/)
assert.match(source, /retryable: true/)
assert.match(source, /requireMutation/)

const authDelete = source.indexOf('adminClient.auth.admin.deleteUser')
const branchDelete = source.indexOf(
  "adminClient.from('branches').delete().eq('tenant_id', tenant.id)",
)
const profileDelete = source.indexOf(
  "adminClient.from('user_profiles').delete().eq('tenant_id', tenant.id)",
)
const tenantDelete = source.indexOf(
  "adminClient.from('tenants').delete().eq('id', tenant.id)",
)

assert.ok(authDelete > 0)
assert.ok(branchDelete > authDelete)
assert.ok(profileDelete > authDelete)
assert.ok(tenantDelete > authDelete)
assert.doesNotMatch(source, /Tenant data deleted but one or more auth users/)

console.log('delete-tenant retry safety contract: PASS')
