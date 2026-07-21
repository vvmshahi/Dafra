import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/pages/settings/OfficialSellerProfilePage.tsx')
const card = read('src/components/compliance/ComplianceReadinessCard.tsx')
const api = read('src/lib/complianceIdentity.ts')
const migration = read('supabase/phase6a-compliance-presentation-identity-foundation.sql')

const saveAction = page.match(/async function save\(\)[\s\S]*?(?=async function confirmOfficialInformation)/)?.[0] ?? ''
const confirmAction = page.match(/async function confirmOfficialInformation\(\)[\s\S]*?(?=function cancelEdit)/)?.[0] ?? ''
const orchestration = migration.match(/CREATE OR REPLACE FUNCTION public\.confirm_branch_official_seller_information[\s\S]*?\n\$\$;/)?.[0] ?? ''
const activation = migration.match(/CREATE OR REPLACE FUNCTION public\.activate_branch_compliance_identity[\s\S]*?\n\$\$;/)?.[0] ?? ''

assert.match(saveAction, /saveComplianceDraft/)
assert.doesNotMatch(saveAction, /confirmOfficialSellerInformation|submitComplianceReview|reviewCompliance|activateCompliance/)
assert.match(confirmAction, /confirmOfficialSellerInformation\(\{ branchId, payload: form, reason, confirmation: true \}\)/)
assert.doesNotMatch(confirmAction, /saveComplianceDraft|submitComplianceReview|reviewCompliance|activateCompliance/)
assert.match(api, /confirm_branch_official_seller_information/)

assert.match(orchestration, /SECURITY DEFINER/)
assert.match(orchestration, /v_user\.role<>'owner'/)
assert.match(orchestration, /p_confirmation IS NOT TRUE/)
assert.match(orchestration, /FROM public\.branches[\s\S]*tenant_id=v_user\.tenant_id[\s\S]*FOR UPDATE/)
assert.match(orchestration, /FROM public\.branch_compliance_profiles[\s\S]*FOR UPDATE/)
assert.match(orchestration, /save_branch_compliance_draft[\s\S]*submit_branch_compliance_profile[\s\S]*branch_compliance_owner_confirmed[\s\S]*review_branch_compliance_profile[\s\S]*activate_branch_compliance_identity/)
assert.match(orchestration, /validation_status='verified'/)
assert.match(orchestration, /compliance_identity_mode='protected'/)
assert.match(orchestration, /'idempotent',true/)
assert.match(activation, /validation_status='verified'/)
assert.match(activation, /p_confirmation IS NOT TRUE/)

assert.match(page, /disabled=\{busy \|\| !complete\}/)
assert.match(page, /complianceCapability[\s\S]*if \(!capability\.available\) return[\s\S]*from\('branches'\)/)
assert.match(page, /setError\(true\)/)
assert.match(page, /officialSeller\.actionFailed/)
assert.match(page, /\}, \[\]\)\n\n  useEffect\(\(\) => \{ if \(enabled && branchId\)/)
assert.doesNotMatch(page, /recoverLegacyMode|getComplianceAudit|officialSeller\.(status|mode)|actions\.(submit|verify|reject|activate|recover)/)
assert.doesNotMatch(card, /officialSeller\.(status|mode)|legacy mode|protected mode/i)
assert.doesNotMatch(page, /invoiceDisplay|displayHeading|displaySubheading|logoUrl|receiptFooter/)
assert.doesNotMatch(orchestration, /UPDATE\s+public\.invoices|zatca_qr_code|invoice_hash|cryptographic|certificate|csid|private_key/i)
assert.doesNotMatch(migration, /UPDATE\s+public\.invoices\s+SET\s+(zatca_|identity_snapshot)/i)

console.log('Phase 2 simplified seller flow protection assertions passed.')
