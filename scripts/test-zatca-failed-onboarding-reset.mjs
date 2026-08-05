import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(file, 'utf8')
const migration = read('supabase/migrations/20260805000200_persist_zatca_capability_selection.sql')
const edge = read('supabase/functions/zatca-onboard-production/index.ts')
const api = read('src/lib/zatca/api.ts')
const ui = read('src/pages/settings/ZatcaTab.tsx')

assert.match(migration, /previous_status text NOT NULL/)
assert.match(migration, /reset_failed_zatca_onboarding/)
assert.match(migration, /v_current\.onboarding_status <> 'compliance_failed'/)
assert.match(migration, /ZATCA_ACTIVE_CREDENTIAL_EXISTS/)
assert.match(migration, /ZATCA_RECONCILIATION_REQUIRED/)
assert.match(migration, /ZATCA_ONBOARDING_ALREADY_RESET|already_reset/)
assert.match(migration, /onboarding_status = 'not_started'/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.reset_failed_zatca_onboarding/)
assert.match(edge, /action === 'reset_failed'/)
assert.match(edge, /reset_failed_zatca_onboarding/)
assert.match(api, /resetFailedProductionOnboarding/)
assert.match(ui, /currentStatus === 'compliance_failed'/)
assert.match(ui, /RESET ONBOARDING/)

console.log('ZATCA failed-onboarding reset safety contract checks passed')
