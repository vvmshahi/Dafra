import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  'supabase/migrations/20260728000100_fix_owner_setup_completion_tenant_id_ambiguity.sql',
  'utf8',
)
const tracking = readFileSync('src/lib/ownerSetupCompletion.ts', 'utf8')
const auth = readFileSync('src/hooks/useAuth.ts', 'utf8')
const adminDetail = readFileSync('src/pages/super-admin/ClientDetailPage.tsx', 'utf8')
const adminList = readFileSync('src/pages/super-admin/ClientsPage.tsx', 'utf8')

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_owner_setup_complete\(\)/)
assert.match(migration, /ON CONFLICT ON CONSTRAINT tenant_onboarding_status_tenant_id_key/)
assert.doesNotMatch(migration, /ON CONFLICT \(tenant_id\)/)
assert.match(migration, /SECURITY DEFINER/)
assert.match(migration, /SET search_path = public/)
assert.match(migration, /SET row_security = off/)
assert.match(migration, /v_user_id UUID := auth\.uid\(\)/)
assert.match(migration, /v_profile\.role <> 'owner'/)
assert.match(migration, /WHERE tos\.tenant_id = v_profile\.tenant_id/)
assert.match(migration, /COALESCE\(\s*tos\.owner_setup_completed_at,\s*EXCLUDED\.owner_setup_completed_at/s)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.mark_owner_setup_complete\(\) FROM PUBLIC/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.mark_owner_setup_complete\(\) TO authenticated/)
assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/)

assert.match(tracking, /\.rpc\('mark_owner_setup_complete'\)/)
assert.match(tracking, /tracking update failed/)
assert.match(tracking, /return null/)
assert.match(auth, /void markOwnerSetupCompleteSilently\('owner_profile_load'/)
assert.match(adminDetail, /owner_setup_completed_at/)
assert.match(adminList, /ownerSetupStatus/)

console.log('owner setup completion contract: PASS')
