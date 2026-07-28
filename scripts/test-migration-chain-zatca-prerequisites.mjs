import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const migrationName = '20260723000000_restore_zatca_finalization_v2_prerequisites.sql'
const migration = readFileSync(`supabase/migrations/${migrationName}`, 'utf8')
const sources = [
  '01_artifact_lifecycle.sql',
  '02_chain_allocator.sql',
  '03_claims_and_idempotency.sql',
  '04_lock_compliance_fields.sql',
  '04a_safe_invoice_read_surface.sql',
  '05_capabilities_and_status.sql',
  '09_branch_readiness_gate.sql',
  '11_durable_simplified_reporting_outbox.sql',
]

let previous = -1
for (const source of sources) {
  const marker = `-- BEGIN RESTORED SOURCE: ${source}`
  const position = migration.indexOf(marker)
  assert.ok(position > previous, `${source} is missing or out of order`)
  previous = position
  const original = readFileSync(`scripts/sql/zatca-phase2-finalization-v2/${source}`, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\set ') && !line.startsWith('\\echo '))
    .join('\n')
    .trim()
  assert.ok(migration.includes(original), `${source} is not an exact restored source`)
}

const ordered = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()
assert.ok(ordered.indexOf(migrationName) < ordered.indexOf('20260724000100_atomic_simplified_checkout_v2.sql'))
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.zatca_finalization_runtime/)
assert.match(migration, /immutable_finalization_enabled boolean NOT NULL DEFAULT false/)
assert.match(migration, /ALTER TABLE public\.zatca_finalization_runtime ENABLE ROW LEVEL SECURITY/)
assert.match(migration, /REVOKE ALL ON public\.zatca_finalization_runtime FROM PUBLIC, anon, authenticated/)
assert.match(migration, /GRANT ALL ON public\.zatca_finalization_runtime TO service_role/)
assert.ok(
  migration.includes('Deliberately no UPDATE statement exists in this migration'),
  'the restored prerequisite must retain the source package no-history-rewrite guarantee',
)
assert.doesNotMatch(
  migration,
  /UPDATE\s+public\.invoices\s+SET\s+zatca_finalization_version/i,
  'the restored prerequisite must not backfill the historical invoice finalization version',
)

console.log('ZATCA prerequisite migration history and security contract: PASS')
