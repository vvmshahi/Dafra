import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const migrationPath = 'supabase/migrations/20260816000200_branch_billing_profile_foundation.sql'
const migration = read(migrationPath)
const databaseTypes = read('src/types/database.ts')
const publicTypes = read('src/types/index.ts')
const configClient = read('src/lib/branches/billingProfile.ts')

const updateRpc = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.update_branch_billing_profile_config'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.create_branch_for_tenant'),
)
const createBranchRpc = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.create_branch_for_tenant'),
)
const effectiveConfigRpc = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.get_effective_branch_billing_config'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.update_branch_billing_profile_config'),
)

for (const profile of ['retail_trading', 'food_beverage', 'services']) {
  assert.match(migration, new RegExp(`'${profile}'`), `${profile} is accepted`)
}
assert.match(migration, /BRANCH_BILLING_PROFILE_INVALID/)
assert.match(migration, /business_profile IN \('retail_trading', 'food_beverage', 'services'\)/)
assert.match(migration, /legacy\/unclassified/)
assert.match(migration, /IF v_branch\.business_profile IS NULL THEN/)

assert.match(migration, /ADD COLUMN custom_lines_enabled boolean NOT NULL DEFAULT false/)
assert.match(migration, /ADD COLUMN products_enabled boolean/)
assert.match(migration, /ADD COLUMN services_enabled boolean/)
assert.match(migration, /REVOKE INSERT \(business_profile, products_enabled, services_enabled, custom_lines_enabled\),[\s\S]*UPDATE \(business_profile, products_enabled, services_enabled, custom_lines_enabled\)/)
assert.match(migration, /v_actor\.role NOT IN \('owner', 'admin'\)/)
assert.doesNotMatch(updateRpc, /v_actor\.role = 'branch'/)
assert.match(updateRpc, /v_products_enabled := COALESCE\([\s\S]*v_defaults ->> 'products_enabled'/)
assert.match(updateRpc, /v_services_enabled := COALESCE\([\s\S]*v_defaults ->> 'services_enabled'/)
assert.doesNotMatch(updateRpc, /products_enabled.*services_enabled.*INVALID/i)

assert.match(createBranchRpc, /v_business_profile := CASE[\s\S]*ELSE NULL/)
assert.match(createBranchRpc, /v_products_enabled := CASE[\s\S]*ELSE NULL/)
assert.match(createBranchRpc, /v_pos_mode := COALESCE\([\s\S]*v_billing_defaults ->> 'pos_mode'/)
assert.match(createBranchRpc, /INSERT INTO public\.branches \([\s\S]*business_profile, products_enabled, services_enabled,[\s\S]*custom_lines_enabled, pos_mode/)

assert.match(migration, /products_service_cannot_track_stock_check/)
assert.match(migration, /CHECK \(NOT COALESCE\(is_service, false\) OR NOT COALESCE\(track_stock, false\)\) NOT VALID/)
assert.match(migration, /ADD COLUMN line_source text NOT NULL DEFAULT 'legacy'/)
assert.match(migration, /line_source IN \('legacy', 'catalogue', 'custom'\)/)
assert.match(migration, /REVOKE INSERT \(line_source\), UPDATE \(line_source\)/)

assert.match(effectiveConfigRpc, /IF v_branch\.business_profile IS NULL THEN/)
assert.match(effectiveConfigRpc, /v_branch\.legacy_business_type <> 'service'/)
assert.match(effectiveConfigRpc, /WHEN v_branch\.legacy_business_type = 'service' THEN 'touch'/)
assert.match(effectiveConfigRpc, /v_defaults := public\.branch_billing_profile_defaults\(v_branch\.business_profile\)/)
assert.match(effectiveConfigRpc, /'pos_mode', COALESCE\(v_branch\.pos_mode, v_defaults ->> 'pos_mode'\)/)

for (const definition of [databaseTypes, publicTypes, configClient]) {
  assert.match(definition, /BranchBusinessProfile/)
}
assert.match(databaseTypes, /export type InvoiceLineSource = 'legacy' \| 'catalogue' \| 'custom'/)
assert.match(databaseTypes, /business_profile: BranchBusinessProfile \| null/)
assert.match(databaseTypes, /custom_lines_enabled: boolean/)
assert.match(databaseTypes, /line_source: InvoiceLineSource/)
assert.match(configClient, /get_effective_branch_billing_config/)
assert.match(configClient, /update_branch_billing_profile_config/)
assert.match(configClient, /legacyProfile: config\.legacy_profile === true/)

console.log('Branch billing profile Phase 1 contract tests passed.')
