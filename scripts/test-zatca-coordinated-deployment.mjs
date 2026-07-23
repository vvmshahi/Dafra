import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const edge = read('supabase/functions/zatca-submit/index.ts')
const client = read('src/lib/zatca/submission.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const statusSql = read('scripts/sql/zatca-phase2-finalization-v2/05_capabilities_and_status.sql')
const safeGrant = read('scripts/sql/zatca-phase2-finalization-v2/04a_safe_invoice_read_surface.sql')

const legacyStart = edge.indexOf('async function processLegacyInvoiceDisabledMode')
const legacyEnd = edge.indexOf('async function processInvoiceV1SupersededDoNotCall')
assert.ok(legacyStart > 0 && legacyEnd > legacyStart, 'dedicated legacy compatibility function is missing')
const legacy = edge.slice(legacyStart, legacyEnd)

assert.match(edge, /const legacySubmitAvailable = runtime\.error == null[\s\S]*runtimeSchemaMissing/)
assert.match(edge, /databaseFeatureEnabled, legacySubmitAvailable: !databaseFeatureEnabled/)
assert.match(edge, /rawAction === null\s*&&\s*clientVersion === null\s*&&\s*capabilities\.legacySubmitAvailable/)
assert.match(edge, /rawAction !== null && !\['submit', 'finalize', 'status', 'capability', 'capabilities'\]\.includes\(rawAction\)/)
assert.match(edge, /!legacyActionlessSubmit[\s\S]*FINALIZATION_VERSION_MISMATCH/)
assert.match(edge, /legacyStatusRequest && !capabilities\.compatible[\s\S]*loadLegacyOutputState/)
assert.match(edge, /processLegacyInvoiceDisabledMode/)
assert.match(edge, /SUPERSEDED_V1_FINALIZATION_PATH_DISABLED/)

for (const v2Only of [
  'zatca_finalization_status',
  'zatca_finalization_error',
  'zatca_finalization_version',
  'zatca_artifact_stage',
  'zatca_lifecycle_state',
]) {
  assert.doesNotMatch(legacy, new RegExp(v2Only), `legacy path requires ${v2Only}`)
}
assert.match(legacy, /zatca_qr_code/)
assert.match(legacy, /buildInvoiceXMLData/)
assert.match(legacy, /signInvoice/)
assert.match(legacy, /reporting\/single/)
assert.match(legacy, /clearance\/single/)

assert.match(client, /checkoutMode:\s*'legacy'/)
assert.match(client, /checkoutMode:\s*'v2'/)
assert.match(client, /contractMode === 'legacy'[\s\S]*\{ invoiceId, branchId, source \}/)
assert.match(client, /action: 'submit'[\s\S]*clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION/)
assert.match(client, /legacyCompatible = data\?\.contractMode === 'legacy'/)

const capabilityIndex = pos.indexOf('await requireZatcaFinalizationCapability(branch.id)')
const checkoutIndex = pos.indexOf("rpc('pos_checkout'")
assert.ok(capabilityIndex > 0 && capabilityIndex < checkoutIndex, 'version mismatch is not detected before checkout')
assert.match(pos, /productionCheckoutMode = capability\.checkoutMode/)
assert.match(pos, /productionCheckoutMode === 'legacy'[\s\S]*contractMode: productionCheckoutMode/)

assert.match(statusSql, /'contractMode', 'legacy', 'legacyCompatible', true/)
assert.match(statusSql, /v_invoice\.zatca_status IN \('reported', 'cleared'\)/)
assert.match(statusSql, /CASE WHEN v_can_output THEN v_invoice\.zatca_qr_code ELSE NULL END/)
assert.match(statusSql, /'contractMode', 'v2', 'legacyCompatible', false/)

assert.match(safeGrant, /REVOKE SELECT ON TABLE public\.invoices FROM authenticated, anon/)
assert.doesNotMatch(safeGrant, /GRANT SELECT ON TABLE public\.invoices TO authenticated/)

const route = ({ databaseEnabled, rawAction, clientVersion, schemaCompatible }) => {
  const legacyAvailable = !databaseEnabled
  if (rawAction !== null && !['submit', 'finalize', 'status', 'capability', 'capabilities'].includes(rawAction)) return '400'
  if (rawAction === 'capability' || rawAction === 'capabilities') return 'capability'
  const legacySubmit = rawAction === null && clientVersion === null && legacyAvailable
  const legacyStatus = rawAction === 'status' && clientVersion === '2.0.0' && legacyAvailable
  if (!legacySubmit && !legacyStatus && (!schemaCompatible || clientVersion !== '2.0.0')) return '426'
  if (!legacySubmit && rawAction !== 'status' && !databaseEnabled) return '409'
  if (legacySubmit) return 'legacy-submit'
  if (legacyStatus && !schemaCompatible) return 'legacy-status'
  return rawAction ?? 'submit'
}

assert.equal(route({ databaseEnabled: false, rawAction: null, clientVersion: null, schemaCompatible: false }), 'legacy-submit')
assert.equal(route({ databaseEnabled: false, rawAction: 'capabilities', clientVersion: '2.0.0', schemaCompatible: false }), 'capability')
assert.equal(route({ databaseEnabled: false, rawAction: 'capability', clientVersion: '2.0.0', schemaCompatible: false }), 'capability')
assert.equal(route({ databaseEnabled: false, rawAction: 'status', clientVersion: '2.0.0', schemaCompatible: false }), 'legacy-status')
assert.equal(route({ databaseEnabled: false, rawAction: 'finalize', clientVersion: '2.0.0', schemaCompatible: false }), '426')
assert.equal(route({ databaseEnabled: false, rawAction: 'submit', clientVersion: '2.0.0', schemaCompatible: true }), '409')
assert.equal(route({ databaseEnabled: false, rawAction: 'retry', clientVersion: null, schemaCompatible: false }), '400')
assert.equal(route({ databaseEnabled: false, rawAction: 'report', clientVersion: null, schemaCompatible: false }), '400')
assert.equal(route({ databaseEnabled: false, rawAction: 'clear', clientVersion: null, schemaCompatible: false }), '400')
assert.equal(route({ databaseEnabled: true, rawAction: null, clientVersion: null, schemaCompatible: true }), '426')
assert.equal(route({ databaseEnabled: true, rawAction: 'finalize', clientVersion: '2.0.0', schemaCompatible: true }), 'finalize')

console.log('ZATCA coordinated deployment: 10 contract and routing groups passed')
