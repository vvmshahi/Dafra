import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260724000200_pos_sessions_authenticated_select.sql')
const baseline = read('supabase/migrations/20260721000100_dafra_current_schema_and_security.sql')
const hook = read('src/hooks/usePosSession.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const english = JSON.parse(read('src/localization/locales/en/register.json'))
const arabic = JSON.parse(read('src/localization/locales/ar-SA/register.json'))

assert.match(migration, /REVOKE SELECT ON TABLE public\.pos_sessions FROM PUBLIC, anon;/)
assert.match(migration, /GRANT SELECT ON TABLE public\.pos_sessions TO authenticated;/)
assert.match(migration, /public\.pos_sessions must retain row level security/)
assert.doesNotMatch(migration, /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE).*pos_sessions/i)
assert.doesNotMatch(migration, /\bTO\s+(?:anon|PUBLIC)\s*;/i)
assert.doesNotMatch(migration, /CREATE\s+POLICY/i)

assert.match(baseline, /ALTER TABLE "public"\."pos_sessions" ENABLE ROW LEVEL SECURITY;/)
assert.match(
  baseline,
  /CREATE POLICY "branch_pos_sessions_select"[\s\S]*"user_profiles"\."id" = "auth"\."uid"\(\)[\s\S]*"user_profiles"\."branch_id" IS NOT NULL/,
)
assert.match(
  baseline,
  /CREATE POLICY "owner_pos_sessions_select"[\s\S]*"user_profiles"\."id" = "auth"\."uid"\(\)[\s\S]*"user_profiles"\."role" = 'owner'/,
)

const queryStart = hook.indexOf("q().from('pos_sessions')")
const queryErrorCheck = hook.indexOf('if (queryError)', queryStart)
const noSessionAssignment = hook.indexOf('setSession((data ?? [])[0] ?? null)', queryStart)
assert.ok(queryStart > 0 && queryErrorCheck > queryStart)
assert.ok(noSessionAssignment > queryErrorCheck)
assert.match(hook.slice(queryErrorCheck, noSessionAssignment), /setError\(queryError\)[\s\S]*return/)
assert.match(hook, /return \{ session, loading, error, resolvedBranchId, openSession, closeSession, fetchActiveSession \}/)

const loadErrorState = pos.indexOf('if (sessionLoadError)')
const closedState = pos.indexOf('if (!session)')
assert.ok(loadErrorState > 0 && loadErrorState < closedState)
assert.match(pos.slice(loadErrorState, closedState), /register:loadFailed/)
assert.match(pos.slice(loadErrorState, closedState), /fetchActiveSession/)
assert.doesNotMatch(pos.slice(loadErrorState, closedState), /register:closed/)

assert.equal(english.loadFailed, 'Register session unavailable')
assert.match(english.loadFailedPrompt, /could not be loaded/i)
assert.ok(arabic.loadFailed)
assert.ok(arabic.loadFailedPrompt)

console.log('POS session access: authenticated SELECT grant, unchanged RLS authority, and explicit query-error UX passed')
