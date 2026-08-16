import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const migrationsDirectory = 'supabase/migrations'
const migrationNames = readdirSync(migrationsDirectory)
  .filter(name => /^\d{14}_.+\.sql$/.test(name))
  .sort()
const versions = migrationNames.map(name => name.slice(0, 14))

assert.equal(new Set(versions).size, versions.length, 'migration versions must be unique')

const migrationIndex = name => {
  const index = migrationNames.indexOf(name)
  assert.notEqual(index, -1, `${name} must exist`)
  return index
}

const sandboxPrerequisite = '20260804000250_restore_zatca_sandbox_credentials_prerequisite.sql'
const sandboxPersistence = '20260804000300_fix_trading_sandbox_credential_persistence.sql'
const billingMigrations = [
  '20260816000100_services_and_custom_billing_lines.sql',
  '20260816000200_branch_billing_profile_foundation.sql',
  '20260816000300_authoritative_custom_line_checkout.sql',
  '20260816000400_source_aware_reporting_credit_restock.sql',
  '20260817000100_custom_line_display_units.sql',
]

assert.ok(
  migrationIndex(sandboxPrerequisite) < migrationIndex(sandboxPersistence),
  'the sandbox credential table must precede its unconditional index reference',
)
for (let index = 1; index < billingMigrations.length; index += 1) {
  assert.ok(
    migrationIndex(billingMigrations[index - 1]) < migrationIndex(billingMigrations[index]),
    'the billing migration chain must be ordered',
  )
}

const sandboxSchema = readFileSync(`${migrationsDirectory}/${sandboxPrerequisite}`, 'utf8')
const sandboxPersistenceSql = readFileSync(`${migrationsDirectory}/${sandboxPersistence}`, 'utf8')
const sandboxV2Sql = readFileSync(`${migrationsDirectory}/20260804000600_trading_sandbox_v2.sql`, 'utf8')
const capabilitySelectionSql = readFileSync(`${migrationsDirectory}/20260805000200_persist_zatca_capability_selection.sql`, 'utf8')
const billingFoundationSql = readFileSync(`${migrationsDirectory}/20260816000200_branch_billing_profile_foundation.sql`, 'utf8')
assert.match(sandboxSchema, /CREATE TABLE IF NOT EXISTS public\.zatca_sandbox_credentials/)
assert.match(sandboxPersistenceSql, /CREATE UNIQUE INDEX zatca_sandbox_credentials_one_current_onboarding_uidx/)
assert.match(
  sandboxV2Sql,
  /INSERT INTO public\.zatca_sandbox_v2_settings[\s\S]*?WHERE EXISTS \([\s\S]*?FROM public\.tenants t[\s\S]*?JOIN public\.branches b/,
  'the fixed Trading Sandbox setting must only seed an existing historical scope',
)
assert.match(capabilitySelectionSql, /DROP CONSTRAINT IF EXISTS zatca_production_credentials_requested_functionality_map_check/)
assert.match(capabilitySelectionSql, /DROP CONSTRAINT IF EXISTS zatca_production_credentials_issued_functionality_map_check/)
assert.equal(
  capabilitySelectionSql.trim().endsWith('COMMIT;'),
  true,
  'the capability-selection migration must not retain an orphaned SQL fragment after commit',
)
assert.match(billingFoundationSql, /ADD COLUMN IF NOT EXISTS custom_lines_enabled boolean NOT NULL DEFAULT false/)
assert.match(billingFoundationSql, /ADD COLUMN IF NOT EXISTS line_source text NOT NULL DEFAULT 'legacy'/)
assert.match(billingFoundationSql, /DO \$invoice_items_line_source_check\$/)

const billingBlob = execFileSync(
  'git',
  ['hash-object', `${migrationsDirectory}/${billingMigrations[0]}`],
  { encoding: 'utf8' },
).trim()
assert.equal(
  billingBlob,
  'a1e58c0e2d4fc658dcb73dc5e0526c479a19cc0d',
  'the hardened historical billing prerequisite must remain byte-identical',
)

const changedEdgeSources = execFileSync(
  'git',
  ['diff', '--name-only', 'd7e0a2959fc8f6556ed39dd51877022eff3264cf', '--', 'supabase/functions'],
  { encoding: 'utf8' },
).trim()
assert.equal(changedEdgeSources, '', 'lineage repair must not introduce Edge source changes')

console.log(`Migration lineage contract tests passed (${migrationNames.length} unique versions).`)
