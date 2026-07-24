import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migrationPath =
  'supabase/migrations/20260725000200_harden_internal_counter_functions.sql'
const sql = readFileSync(migrationPath, 'utf8')

for (const signature of [
  'public\\.get_next_invoice_counter\\(uuid\\)',
  'public\\.get_next_zatca_counter\\(uuid, varchar\\)',
]) {
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`))
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`))
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated;`))
}

assert.match(
  sql,
  /CREATE OR REPLACE FUNCTION public\.get_next_zatca_counter\([\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/,
  'hardens the legacy ZATCA allocator search path',
)
assert.match(sql, /UPDATE public\.zatca_certificates[\s\S]*invoice_counter = invoice_counter \+ 1/, 'preserves the atomic increment')
assert.match(sql, /WHERE branch_id = p_branch_id[\s\S]*AND environment = p_env/, 'preserves branch/environment scope')
assert.doesNotMatch(sql, /GRANT\s+EXECUTE/i, 'does not grant direct counter access')
assert.doesNotMatch(sql, /get_next_credit_note_counter/, 'does not alter the credit-note baseline')
assert.doesNotMatch(sql, /\b(invoice_counter|credit_note_counter)\s*=\s*(0|1)\b/i, 'does not reset a counter')
assert.doesNotMatch(sql, /\b(INSERT|DELETE|TRUNCATE)\s+(INTO\s+|FROM\s+)?public\.(branches|zatca_certificates)\b/i, 'does not migrate counter data')
assert.doesNotMatch(sql, /lpad|invoice_prefix|invoice_number|previous_hash|last_invoice_hash/i, 'does not change numbering or chain formatting')

const replacements = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([^\s(]+)/g)].map(match => match[1])
assert.deepEqual(replacements, ['public.get_next_zatca_counter'], 'replaces only the function requiring a safe search path')

console.log('Internal counter migration security checks passed')
