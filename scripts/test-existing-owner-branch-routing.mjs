import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  'supabase/migrations/20260728000200_reconcile_existing_owner_branch_access.sql',
  'utf8',
)
const auth = readFileSync('src/hooks/useAuth.ts', 'utf8')
const routeRuntime = readFileSync('scripts/test-phase1-route-auth-recovery-runtime.mjs', 'utf8')

assert.match(migration, /JOIN public\.tenants t ON t\.id = p\.tenant_id AND t\.is_active IS TRUE/)
assert.match(migration, /b\.is_active IS TRUE/)
assert.match(migration, /public\.branch_login_usernames m/)
assert.match(migration, /lower\(btrim\(eu\.email\)\) NOT LIKE '%@branch-login\.kubri\.internal'/)
assert.match(migration, /bp\.tenant_id = b\.tenant_id/)
assert.match(migration, /ep\.tenant_id = b\.tenant_id/)
assert.match(migration, /WHEN ab\.id IS NOT NULL THEN 'complete'/)
assert.match(migration, /ab\.id IS NOT NULL/)
assert.match(migration, /ELSE 'requested'/)
assert.match(migration, /SECURITY DEFINER/)
assert.match(migration, /SET search_path = pg_catalog, public/)
assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/)

assert.match(auth, /first-branch access check failed safely/)
assert.match(auth, /setHasBranch\(null\)/)
assert.match(auth, /setAuthError\('We could not verify your branch access/)
assert.match(routeRuntime, /firstBranchAccessComplete: false/)
assert.match(routeRuntime, /firstBranchAccessComplete: true/)
assert.match(routeRuntime, /authError: 'PROFILE_QUERY_FAILED'/)

console.log('existing Owner authoritative branch routing contract: PASS')
