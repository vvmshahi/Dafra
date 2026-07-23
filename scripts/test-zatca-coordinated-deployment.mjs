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

assert.match(edge, /const legacySubmitAvailable = runtime\.error == null \|\| runtimeSchemaMissing/)
assert.match(edge, /databaseFeatureEnabled, legacySubmitAvailable: true/)
assert.match(edge, /const actionlessLegacyRequest = rawAction === null && clientVersion === null/)
assert.match(edge, /rawAction !== null && !\['submit', 'finalize', 'status', 'capability', 'capabilities'\]\.includes\(rawAction\)/)
assert.match(edge, /!actionlessLegacyRequest[\s\S]*FINALIZATION_VERSION_MISMATCH/)
assert.match(edge, /const readiness = await loadBranchReadinessV2/)
assert.match(edge, /const useLegacyProcessor = invoiceAuth\.target\.v2Invoice !== true[\s\S]*checkoutMode === 'legacy'/)
assert.match(edge, /const state = !capabilities\.compatible[\s\S]*loadLegacyOutputState/)
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
assert.match(client, /const contractMode: ZatcaCheckoutMode = data\?\.contractMode === 'legacy'/)
assert.match(client, /const legacyCompatible = contractMode === 'legacy'[\s\S]*data\?\.legacyCompatible === true/)
assert.match(client, /ZATCA_OUTPUT_STATE_READ_VERSION = '2\.0\.0'/)
assert.match(edge, /OUTPUT_STATE_READ_CLIENT_VERSIONS = new Set\(\['2\.0\.0', FINALIZATION_CLIENT_VERSION\]\)/)

const capabilityIndex = pos.indexOf('await requireZatcaFinalizationCapability(')
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

const route = ({
  databaseEnabled,
  rawAction,
  clientVersion,
  schemaCompatible,
  branchReady = false,
  acknowledged = false,
  edgeEnabled = false,
}) => {
  if (rawAction !== null && !['submit', 'finalize', 'status', 'capability', 'capabilities'].includes(rawAction)) return '400'
  if (rawAction === 'capability' || rawAction === 'capabilities') return 'capability'
  const actionlessLegacy = rawAction === null && clientVersion === null
  const compatibleStatus = rawAction === 'status' && ['2.0.0', '2.1.0'].includes(clientVersion)
  if (!actionlessLegacy && !compatibleStatus && (!schemaCompatible || clientVersion !== '2.1.0')) return '426'
  if (rawAction === 'status') return schemaCompatible ? 'status' : 'legacy-status'
  if (actionlessLegacy) return 'legacy-submit'
  if (!databaseEnabled || !branchReady || !acknowledged || !edgeEnabled) return 'legacy-submit'
  return rawAction ?? 'submit'
}

assert.equal(route({ databaseEnabled: false, rawAction: null, clientVersion: null, schemaCompatible: false }), 'legacy-submit')
assert.equal(route({ databaseEnabled: false, rawAction: 'capabilities', clientVersion: '2.1.0', schemaCompatible: false }), 'capability')
assert.equal(route({ databaseEnabled: false, rawAction: 'capability', clientVersion: '2.1.0', schemaCompatible: false }), 'capability')
assert.equal(route({ databaseEnabled: false, rawAction: 'status', clientVersion: '2.1.0', schemaCompatible: false }), 'legacy-status')
assert.equal(route({ databaseEnabled: false, rawAction: 'status', clientVersion: '2.0.0', schemaCompatible: false }), 'legacy-status')
assert.equal(route({ databaseEnabled: false, rawAction: 'finalize', clientVersion: '2.0.0', schemaCompatible: false }), '426')
assert.equal(route({ databaseEnabled: false, rawAction: 'finalize', clientVersion: '2.1.0', schemaCompatible: false }), '426')
assert.equal(route({ databaseEnabled: false, rawAction: 'submit', clientVersion: '2.1.0', schemaCompatible: true }), 'legacy-submit')
assert.equal(route({ databaseEnabled: false, rawAction: 'retry', clientVersion: null, schemaCompatible: false }), '400')
assert.equal(route({ databaseEnabled: false, rawAction: 'report', clientVersion: null, schemaCompatible: false }), '400')
assert.equal(route({ databaseEnabled: false, rawAction: 'clear', clientVersion: null, schemaCompatible: false }), '400')
assert.equal(route({ databaseEnabled: true, rawAction: null, clientVersion: null, schemaCompatible: true }), 'legacy-submit')
assert.equal(route({
  databaseEnabled: true,
  rawAction: 'finalize',
  clientVersion: '2.1.0',
  schemaCompatible: true,
  branchReady: true,
  acknowledged: true,
  edgeEnabled: true,
}), 'finalize')

console.log('ZATCA coordinated deployment: 10 contract and routing groups passed')
