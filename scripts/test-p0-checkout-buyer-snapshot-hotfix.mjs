import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260817000700_restore_pos_checkout_after_buyer_snapshot_hardening.sql')

// The P0 repair must redefine only the invoice-insert trigger function. It
// cannot add a fictional Phase-6A schema, alter checkout authority, or mutate
// any previously issued document.
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.capture_invoice_identity_snapshot\(\)/)
assert.match(migration, /SELECT to_jsonb\(branch_row\) INTO branch_snapshot/)
assert.match(migration, /WHERE branch_row\.id = NEW\.branch_id[\s\S]*branch_row\.tenant_id = NEW\.tenant_id/)
assert.doesNotMatch(migration, /compliance_identity_mode|branch_compliance_profiles/)
assert.doesNotMatch(migration, /CREATE TABLE|ALTER TABLE public\.branches|INSERT INTO public\.branches/)
assert.doesNotMatch(migration, /UPDATE\s+public\.invoices|DELETE\s+FROM\s+public\.invoices/i)
assert.doesNotMatch(migration, /FUNCTION public\.pos_checkout|INSERT INTO public\.invoices/)

// Walk-in B2C must reach the issue-time capture trigger without a customer
// lookup, while B2B retains every approved buyer-readiness requirement.
assert.match(migration, /IF NEW\.customer_id IS NULL THEN[\s\S]*'state', 'walk_in'/)
assert.match(migration, /STANDARD_BUYER_SNAPSHOT_REQUIRED/)
for (const field of ['customer_type', 'vat_number', 'cr_number', 'building_number', 'address', 'district', 'city', 'postal_code', 'country']) {
  assert.match(migration, new RegExp(`buyer_customer\\.${field}`), `${field} must remain in the B2B gate`)
}

// Credit/debit documents inherit their original V3 buyer snapshot; current
// customer data is never used for a historical correction.
assert.match(migration, /original_document\.identity_snapshot->'buyer'/)
assert.match(migration, /'state', 'legacy_unavailable'/)

// Seller/presentation data comes from the actual linked branches contract and
// remains captured in the V3 immutable envelope for new documents only.
for (const key of ['business_name', 'business_name_ar', 'vat_number', 'cr_number', 'building_number', 'street', 'address', 'district', 'city', 'postal_code', 'country', 'invoice_language', 'print_mode']) {
  assert.match(migration, new RegExp(`branch_snapshot->>'${key}'`), `${key} must be captured from branches`)
}
assert.match(migration, /public\.resolve_invoice_presentation_settings\(NEW\.branch_id\)/)
assert.match(migration, /'version', 3/)
assert.match(migration, /'buyer', buyer_snapshot/)

console.log('P0 checkout buyer-snapshot hotfix static contract assertions passed.')
