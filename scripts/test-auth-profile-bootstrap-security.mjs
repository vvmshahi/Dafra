import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationPath =
  'supabase/migrations/20260725000100_harden_auth_profile_bootstrap.sql'
const sql = readFileSync(migrationPath, 'utf8')

const mustMatch = (pattern, message) => assert.match(sql, pattern, message)

mustMatch(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)/, 'replaces the Auth bootstrap function')
mustMatch(/RETURNS trigger[\s\S]*LANGUAGE plpgsql[\s\S]*SECURITY DEFINER/, 'preserves the secure trigger signature')
mustMatch(/SET search_path = public, pg_temp/, 'uses a fixed safe search path')
mustMatch(/NEW\.raw_user_meta_data ->> 'full_name'/, 'retains only display-name metadata')
mustMatch(/LEFT\(BTRIM\(COALESCE\([\s\S]*\), 255\)/, 'normalizes and limits the display name')
mustMatch(/'owner'::public\.user_role,[\s\S]*NULL,[\s\S]*NULL,[\s\S]*TRUE/, 'assigns the fixed safe profile state')
mustMatch(/ON CONFLICT \(id\) DO NOTHING/, 'does not overwrite existing profiles')
mustMatch(/REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM PUBLIC;/, 'revokes PUBLIC execution')
mustMatch(/REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM anon;/, 'revokes anon execution')
mustMatch(/REVOKE ALL ON FUNCTION public\.handle_new_user\(\) FROM authenticated;/, 'revokes authenticated execution')

assert.doesNotMatch(sql, /raw_user_meta_data\s*->>\s*'(role|tenant_id|branch_id|is_active)'/, 'must ignore authorization metadata')
assert.doesNotMatch(sql, /raw_app_meta_data/, 'must not use app metadata as authority')
assert.doesNotMatch(sql, /'super_admin'::public\.user_role/, 'must not assign super administrator')
assert.doesNotMatch(sql, /ON CONFLICT[\s\S]*DO UPDATE/, 'must not update an existing profile')
assert.doesNotMatch(sql, /\b(CREATE|DROP)\s+TRIGGER\b/i, 'must not create or replace the Auth trigger')

const replacements = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([^\s(]+)/g)].map(match => match[1])
assert.deepEqual(replacements, ['public.handle_new_user'], 'must not replace unrelated functions')

console.log('Auth profile bootstrap migration security checks passed')
