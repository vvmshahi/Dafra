import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/phase6a-compliance-presentation-identity-foundation.sql')
const f3 = read('scripts/audit-f3-identity-separation.mjs')
const production = read('supabase/functions/zatca-submit/index.ts')
const sandbox = read('supabase/functions/zatca-submit-sandbox-demo/index.ts')
const settingsRpc = read('supabase/phase5x-document-language-snapshot.sql')

for (const table of ['public.tenants', 'public.branches', 'public.invoices', 'public.user_profiles']) {
  assert.match(migration, new RegExp(table.replace('.', '\\.')))
}
assert.match(migration, /compliance_identity_mode TEXT NOT NULL DEFAULT 'legacy'/)
assert.match(migration, /IF v_branch\.compliance_identity_mode = 'legacy' THEN[\s\S]*NEW\.identity_snapshot := NULL/)
assert.match(migration, /activate_branch_compliance_identity/)
assert.match(migration, /validation_status='verified'/)
assert.match(migration, /BEFORE INSERT ON public\.invoices/)
assert.match(migration, /BEFORE UPDATE OF identity_snapshot/)
assert.doesNotMatch(migration, /UPDATE\s+public\.invoices\s+SET\s+(zatca_|identity_snapshot)/i)
assert.doesNotMatch(settingsRpc, /branch_compliance_profiles|registered_seller_name|compliance_identity_mode/)
assert.match(production, /protectedMode[\s\S]*branch_compliance_profiles/)
assert.match(sandbox, /protectedMode[\s\S]*branch_compliance_profiles/)
assert.match(f3, /Stored QR|zatca_qr_code/)

console.log('F3A rollout and migration static assertions passed.')
