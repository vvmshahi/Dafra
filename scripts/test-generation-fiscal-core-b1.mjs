import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildGenerationQr } from '../supabase/functions/_shared/fiscal/generation_qr.mjs'
import { decodeTlvBase64 } from '../supabase/functions/_shared/fiscal/tlv.mjs'

const root = resolve(import.meta.dirname, '..')
const migration = readFileSync(resolve(root, 'supabase/migrations/20260824000200_generation_fiscal_core_b1.sql'), 'utf8')

const qr = buildGenerationQr({
  sellerName: 'شركة كوبري',
  sellerVatNumber: '310123456789003',
  timestamp: '2026-08-24T12:13:57Z',
  totalIncludingVat: 11.5,
  vatTotal: 1.5,
})
const fields = decodeTlvBase64(qr)
assert.deepEqual(fields.map(field => field.tag), [1, 2, 3, 4, 5])
assert.equal(fields[0].value, 'شركة كوبري')
assert.equal(fields[0].byteLength, new TextEncoder().encode('شركة كوبري').length)
assert.equal(fields[1].value, '310123456789003')
assert.equal(fields[2].value, '2026-08-24T12:13:57Z')
assert.equal(fields[3].value, '11.50')
assert.equal(fields[4].value, '1.50')
assert.ok(/^[A-Za-z0-9+/]+={0,2}$/.test(qr))
assert.equal(migration.includes("'tag 6'") || migration.includes('tag 6'), false)

assert.throws(() => buildGenerationQr({
  sellerName: 'Seller', sellerVatNumber: '310123456789003',
  timestamp: '2026-08-24T12:13:57', totalIncludingVat: 1, vatTotal: 0.15,
}), /timezone/)
assert.throws(() => buildGenerationQr({
  sellerName: 'Seller', sellerVatNumber: '123',
  timestamp: '2026-08-24T12:13:57Z', totalIncludingVat: 1, vatTotal: 0.15,
}), /15 digits/)
assert.throws(() => buildGenerationQr({
  sellerName: 'x'.repeat(256), sellerVatNumber: '310123456789003',
  timestamp: '2026-08-24T12:13:57Z', totalIncludingVat: 1, vatTotal: 0.15,
}), /255 UTF-8 bytes/)

for (const required of [
  'fiscal_regime', 'integration_environment', 'fiscal_policy_revision',
  'fiscal_activation_state', 'fiscal_regime_at_issue',
  'fiscal_policy_revision_at_issue', 'fiscal_policy_snapshot',
  'fiscal_lifecycle_state', 'fiscal_artifact_stage', 'fiscal_qr_payload',
  'fiscal_issued_at', 'resolve_fiscal_policy',
  'prevent_fiscal_issue_metadata_mutation',
]) assert.ok(migration.includes(required), `migration contains ${required}`)

assert.ok(migration.includes("SET fiscal_regime = 'integration'"))
assert.ok(migration.includes("fiscal_regime_at_issue = COALESCE(i.fiscal_regime_at_issue, 'integration')"))
assert.ok(migration.includes("CROSS_REGIME_NOTE_NOT_ALLOWED") === false)
assert.ok(migration.includes('auth.uid()'))
assert.ok(migration.includes('BRANCH_ACCESS_DENIED'))
assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.resolve_fiscal_policy(uuid) TO authenticated"))
assert.ok(!migration.includes('p_regime'))
assert.ok(!migration.includes('p_environment'))
assert.ok(migration.includes("OLD.status = 'posted' OR OLD.fiscal_issued_at IS NOT NULL"))
assert.ok(migration.includes('fiscal_policy_revision > 0'))
assert.ok(migration.includes("fiscal_regime IN ('generation', 'integration')"))
console.log('Generation fiscal core B1 tests passed (33 assertions)')
