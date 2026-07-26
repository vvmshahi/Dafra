import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const edge = await readFile(new URL('../supabase/functions/zatca-submit/index.ts', import.meta.url), 'utf8')
const client = await readFile(new URL('../src/lib/zatca/atomicCheckout.ts', import.meta.url), 'utf8')
const pos = await readFile(new URL('../src/pages/pos/POSPage.tsx', import.meta.url), 'utf8')
const browserPerf = await readFile(new URL('../src/lib/checkoutPerf.ts', import.meta.url), 'utf8')

let failures = 0
async function test(name, run) {
  try {
    await run()
    console.log(`ok - ${name}`)
  } catch (error) {
    failures += 1
    console.error(`not ok - ${name}`)
    console.error(error)
  }
}

const edgeStages = [
  'request_total', 'auth_get_user', 'caller_profile_load', 'runtime_capabilities_load',
  'branch_authorization', 'idempotency_result_lookup', 'legacy_idempotency_lookup',
  'rollout_initial_load', 'readiness_initial_load', 'capability_acknowledgement',
  'readiness_reload', 'eligibility_sync', 'rollout_reload', 'rate_limit', 'attempt_audit',
  'atomic_prepare_total', 'signing_claim', 'credential_load', 'credential_decryption',
  'xml_generation', 'signing_and_qr', 'artifact_validation', 'artifact_storage',
  'atomic_commit_total', 'response_serialization', 'background_reporting_schedule',
  'success_audit_schedule',
]
const browserStages = [
  'charge_clicked', 'client_validation', 'atomic_invoke_start', 'atomic_invoke_duration',
  'response_received', 'receipt_state_created', 'success_screen_visible', 'print_modal_ready',
]

await test('all required fixed timing stages exist', () => {
  for (const stage of edgeStages) assert.match(edge, new RegExp(`['"]${stage}['"]`))
  for (const stage of browserStages) {
    assert.ok(client.includes(`'${stage}'`) || pos.includes(`'${stage}'`), `missing ${stage}`)
  }
  const checkoutHandler = edge.indexOf("if (action === 'checkout_simplified'")
  assert.ok(edge.indexOf("span('branch_authorization'", checkoutHandler) > checkoutHandler)
})

await test('timings use monotonic performance.now and bounded serialization-safe numbers', () => {
  assert.match(edge, /performance\.now\(\)/)
  assert.match(browserPerf, /performance\.now\(\)/)
  assert.match(edge, /CHECKOUT_PERF_MAX_MS/)
  assert.match(browserPerf, /MAX_TIMING_MS/)
  assert.match(edge, /Math\.round\(durationMs \* 10\) \/ 10/)
  assert.match(browserPerf, /Math\.round\(Math\.min/)
})

await test('structured performance records contain only the approved fixed schema', () => {
  const edgeLogger = edge.slice(edge.indexOf("console.info('[zatca-checkout-perf]'"),
    edge.indexOf('async span<T>', edge.indexOf("console.info('[zatca-checkout-perf]'")))
  const browserLogger = browserPerf.slice(browserPerf.indexOf("console.info('[pos-checkout-perf]'"))
  const forbidden = [
    'payload', 'cart', 'customer', 'price', 'total', 'xml', 'qr', 'credential',
    'privateKey', 'certificate', 'token', 'jwt', 'authorization', 'cookie', 'hash',
  ]
  for (const field of forbidden) {
    assert.doesNotMatch(edgeLogger.toLowerCase(), new RegExp(field.toLowerCase()))
    assert.doesNotMatch(browserLogger.toLowerCase(), new RegExp(field.toLowerCase()))
  }
  for (const field of ['event', 'requestId', 'durationMs', 'elapsedMs', 'action', 'status', 'coldStartCandidate']) {
    assert.ok(edgeLogger.includes(field))
    assert.ok(browserLogger.includes(field))
  }
})

await test('instrumentation is fail-open', () => {
  assert.match(edge, /Performance diagnostics must never affect checkout behavior/)
  assert.match(browserPerf, /Performance diagnostics must never affect checkout behavior/)
  assert.match(edge, /log\([^)]*\)[\s\S]*?try \{[\s\S]*?console\.info\('\[zatca-checkout-perf\]'/)
  assert.match(browserPerf, /try \{[\s\S]*?console\.info\('\[pos-checkout-perf\]'/)
})

await test('commit still precedes success and reporting remains unawaited', () => {
  const commit = edge.indexOf("callerDb.rpc('commit_zatca_atomic_checkout_v2'")
  const schedule = edge.indexOf('scheduleReportingOutboxDrain(serviceDb', commit)
  const processReturn = edge.indexOf("status: 'committed'", schedule)
  const handlerReturn = edge.indexOf('return response', edge.indexOf('success_audit_schedule'))
  assert.ok(commit > 0 && schedule > commit && processReturn > schedule && handlerReturn > processReturn)
  assert.doesNotMatch(edge.slice(commit, handlerReturn), /await scheduleReportingOutboxDrain/)
  assert.match(edge, /EdgeRuntime[\s\S]*waitUntil\(dispatch\)/)
})

await test('standard and legacy checkout branches retain their awaited behavior', () => {
  assert.match(pos, /else if \(productionCheckoutMode === 'legacy'\)[\s\S]*await submitInvoiceForBranch/)
  assert.match(pos, /if \(isB2BInvoice\)[\s\S]*await submitInvoiceForBranch[\s\S]*await getInvoiceZatcaOutputState/)
  assert.match(pos, /canPrintCustomerCopy = Boolean\(finalQrCode\)/)
})

await test('request correlation is backward-compatible and does not rewrite errors', () => {
  assert.match(client, /checkoutPerfRequestId: params\.perf\?\.requestId/)
  assert.match(edge, /\{ \.\.\.result, checkoutPerfRequestId: checkoutPerf!\.requestId \}/)
  assert.doesNotMatch(edge, /\{ \.\.\.failure, checkoutPerfRequestId/)
  assert.doesNotMatch(edge, /\{ error:[^}]*checkoutPerfRequestId/)
})

if (failures > 0) process.exit(1)
console.log('Atomic checkout performance instrumentation invariants passed.')
