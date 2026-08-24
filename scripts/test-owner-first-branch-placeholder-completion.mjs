import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  'supabase/migrations/20260824000700_fix_existing_v2_first_branch_completion.sql',
  'utf8',
)
const edgeFunction = readFileSync('supabase/functions/provision-first-branch/index.ts', 'utf8')
const english = readFileSync('src/localization/locales/en/onboarding.json', 'utf8')
const arabic = readFileSync('src/localization/locales/ar-SA/onboarding.json', 'utf8')

assert.match(migration, /WHERE b\.tenant_id = v_profile\.tenant_id AND b\.is_main_branch IS TRUE FOR UPDATE/)
assert.match(migration, /IF v_branch_id IS NULL THEN/)
assert.match(migration, /INSERT INTO public\.branches/)

const existingBranchPath = migration.slice(
  migration.indexOf('ELSE\n    -- V2 already created the canonical placeholder.'),
  migration.indexOf('END IF;\n\n  IF v_req.id IS NULL THEN'),
)
assert.match(existingBranchPath, /UPDATE public\.branches AS b SET/)
for (const field of [
  'name', 'business_name', 'vat_number', 'cr_number', 'building_number',
  'postal_code', 'street', 'district', 'city', 'phone',
]) assert.match(existingBranchPath, new RegExp(`\\b${field}\\s*=`), field)
for (const fiscalField of [
  'fiscal_regime', 'fiscal_activation_state', 'fiscal_policy_revision',
  'integration_environment', 'zatca_phase',
]) assert.doesNotMatch(existingBranchPath, new RegExp(`\\b${fiscalField}\\s*=`), fiscalField)
assert.match(existingBranchPath, /WHERE b\.id = v_branch_id AND b\.tenant_id = v_profile\.tenant_id/)
assert.match(existingBranchPath, /RETURNING b\.id INTO v_branch_id/)

for (const validation of [
  'FIRST_BRANCH_INVALID_NAME', 'FIRST_BRANCH_INVALID_VAT', 'FIRST_BRANCH_INVALID_CR',
  'FIRST_BRANCH_INVALID_BUILDING', 'FIRST_BRANCH_INVALID_POSTAL',
  'FIRST_BRANCH_INVALID_STREET', 'FIRST_BRANCH_INVALID_DISTRICT', 'FIRST_BRANCH_INVALID_CITY',
]) assert.ok(migration.includes(validation), validation)
assert.match(migration, /v_vat_number !~ '\^3\[0-9\]\{13\}3\$'/)
assert.match(migration, /v_cr_number !~ '\^\[A-Za-z0-9\]\+\$'/)
assert.match(migration, /v_building_number !~ '\^\[0-9\]\{4\}\$'/)
assert.match(migration, /v_postal_code !~ '\^\[0-9\]\{5\}\$'/)

assert.match(migration, /state = CASE WHEN f\.state = 'complete' THEN f\.state ELSE 'branch_ready' END/)
assert.match(edgeFunction, /complete_first_branch_access/)
assert.match(edgeFunction, /branch_login_usernames/)
assert.match(edgeFunction, /user_metadata:/)
assert.doesNotMatch(migration, /password/i, 'the provisioning request and access RPC do not persist plaintext passwords')
assert.match(edgeFunction, /admin\.auth\.admin\.createUser\([\s\S]*password: body\.password/)
assert.match(edgeFunction, /FIRST_BRANCH_INVALID_\(NAME\|VAT\|CR\|BUILDING\|POSTAL\|STREET\|DISTRICT\|CITY\)/)

assert.match(english, /"title":"Complete Branch Setup"/)
assert.match(english, /"ownerHelp":"Complete the branch record and create its POS login in one step\./)
assert.match(arabic, /"title":"إكمال إعداد الفرع"/)

console.log('owner first-branch placeholder completion contract: PASS')
