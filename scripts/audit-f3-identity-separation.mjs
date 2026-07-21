import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/phase6a-compliance-presentation-identity-foundation.sql')
const production = read('supabase/functions/zatca-submit/index.ts')
const sandbox = read('supabase/functions/zatca-submit-sandbox-demo/index.ts')
const preview = read('src/pages/branch/InvoiceSettingsPage.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const receipt = read('src/pages/print/ReceiptPrintPage.tsx')

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.branch_compliance_profiles/)
assert.match(migration, /ADD COLUMN IF NOT EXISTS identity_snapshot JSONB/)
assert.match(migration, /'logoAssetVersion', v_branch\.logo_asset_version/)
assert.match(migration, /'showCashChange', v_branch\.show_cash_change/)
assert.match(migration, /'printMode', v_branch\.print_mode/)
assert.match(migration, /Official seller profile is incomplete or unverified/)
assert.match(migration, /Issued invoice identity snapshot is immutable/)
assert.doesNotMatch(migration, /UPDATE\s+public\.invoices\s+SET\s+(zatca_|identity_snapshot)/i)

for (const source of [production, sandbox]) {
  assert.match(source, /from\('branch_compliance_profiles'\)/)
  assert.match(source, /registered_seller_name/)
}
assert.doesNotMatch(production, /sellerName:\s+branch\.(display_name|business_name|name)/)
assert.doesNotMatch(sandbox, /sellerName:\s+branch\.(display_name|business_name|name)/)
assert.match(pos, /sellerName:\s+receipt\.complianceSellerName/)
assert.doesNotMatch(pos, /sellerName:\s+receipt\.businessName/)
assert.match(preview, /function SamplePreview/)
assert.match(preview, /aria-label=\{copy\.qr\}/)
assert.match(preview, /presentation_settings: normalized\.presentation/)
assert.doesNotMatch(preview, /presentation_settings:[\s\S]{0,500}(registeredSellerName|vatNumber|registrationIdentifier|compliance)/)
assert.match(receipt, /invoice!\.zatca_qr_code \?\? \(identity\.snapshotBacked/)

console.log('F3 identity separation static assertions passed.')
