import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationPath =
  'supabase/migrations/20260725000000_harden_complete_onboarding.sql'
const sql = readFileSync(migrationPath, 'utf8')

const mustMatch = (pattern, message) => assert.match(sql, pattern, message)

mustMatch(/CREATE OR REPLACE FUNCTION public\.complete_onboarding\s*\(/, 'replaces only the onboarding RPC')
mustMatch(/v_user_id := auth\.uid\(\)/, 'reads the authenticated user')
mustMatch(/IF v_user_id IS NULL[\s\S]*Authentication required/, 'rejects anonymous callers')
mustMatch(/FROM public\.user_profiles[\s\S]*WHERE id = v_user_id[\s\S]*FOR UPDATE/, 'locks the caller profile')
mustMatch(/INTO STRICT v_profile/, 'requires exactly one profile')
mustMatch(/v_profile\.is_active IS DISTINCT FROM TRUE/, 'requires an active profile')
mustMatch(/v_profile\.role = 'branch'::public\.user_role/, 'rejects branch users')
mustMatch(/v_profile\.role = 'super_admin'::public\.user_role/, 'rejects super administrators')
mustMatch(/v_profile\.role <> 'owner'::public\.user_role/, 'permits only owner profiles')
mustMatch(/v_profile\.tenant_id IS NOT NULL[\s\S]*ALREADY_ONBOARDED/, 'rejects replay')
mustMatch(/v_profile\.branch_id IS NOT NULL/, 'rejects branch-assigned profiles')
mustMatch(/UPDATE public\.user_profiles[\s\S]*tenant_id IS NULL[\s\S]*branch_id IS NULL/, 'rechecks the eligible state during assignment')
mustMatch(/GET DIAGNOSTICS v_updated_profiles = ROW_COUNT/, 'captures the profile update count')
mustMatch(/IF v_updated_profiles <> 1/, 'requires exactly one updated profile')
mustMatch(/SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/, 'uses a fixed safe search path')
mustMatch(/REVOKE ALL ON FUNCTION public\.complete_onboarding\([\s\S]*\) FROM PUBLIC;/, 'revokes PUBLIC execution')
mustMatch(/REVOKE ALL ON FUNCTION public\.complete_onboarding\([\s\S]*\) FROM anon;/, 'revokes anon execution')
mustMatch(/GRANT EXECUTE ON FUNCTION public\.complete_onboarding\([\s\S]*\) TO authenticated;/, 'grants authenticated execution')
mustMatch(/RETURN jsonb_build_object\('tenant_id', v_tenant_id\)/, 'returns only the tenant identifier')

const functionReplacements = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([^\s(]+)/g)].map(match => match[1])
assert.deepEqual(functionReplacements, ['public.complete_onboarding'], 'must not replace unrelated functions')
assert.doesNotMatch(sql, /\b(handle_new_user|zatca|invoice|refund|counter)\b/i, 'must not alter unrelated security surfaces')

console.log('complete_onboarding migration security checks passed')
