import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json')), config = read('supabase/config.toml'), phase4b = read('scripts/test-phase4b-invoice-settings-runtime.mjs')
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()
for (const script of ['test:phase3c-official-seller','test:phase3d-invoice-snapshot','test:phase4b-invoice-settings','test:phase4d-document-view-model','test:phase4e-thermal-receipts','test:phase4f-a4-templates']) assert.ok(pkg.scripts[script], `missing regression script: ${script}`)
assert.deepEqual(migrations.slice(0,4), ['20260721000100_dafra_current_schema_and_security.sql','20260721000200_phase5x_document_language_snapshot.sql','20260721000300_phase6a_identity_foundation.sql','20260721000400_invoice_presentation_settings.sql']); assert.match(config, /api_url = "http:\/\/127\.0\.0\.1"/); assert.match(config, /\[storage\]\s*\nenabled = true/)
for (const label of ['owner immutable logo upload','assigned branch immutable logo upload','other tenant logo upload','foreign branch logo upload','immutable logo overwrite','immutable logo update','immutable logo delete','oversized logo upload','retrieve old immutable logo']) assert.match(phase4b, new RegExp(label))
assert.match(phase4b, /identity_snapshot\.version,2/); assert.match(phase4b, /JSON\.stringify\(.*identity_snapshot/)
console.log('Phase 4G release-readiness harness passed (canonical migrations, localhost configuration, dependent regression availability, immutable logo runtime coverage, and snapshot determinism coverage).')
