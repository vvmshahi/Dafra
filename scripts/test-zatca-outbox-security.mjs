import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REPORTING_MAX_BATCH_SIZE,
  REPORTING_MAX_TRANSIENT_ATTEMPTS,
  REPORTING_OUTCOMES,
  clampReportingBatchSize,
  classifyReportingHttpOutcome,
  reportingRetryDecision,
} from '../supabase/functions/_shared/zatca/reporting_outcome.mjs'
import {
  authorizeDrainRequest,
  hasServiceRoleDrainCredentials,
  isStrictDrainBody,
  timingSafeEqualText,
} from '../supabase/functions/_shared/zatca/internal_drain_auth.mjs'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const migration = read('scripts/sql/zatca-phase2-finalization-v2/11_durable_simplified_reporting_outbox.sql')
const cron = read('scripts/sql/zatca-phase2-finalization-v2/operator/install_reporting_outbox_dispatch.sql')
const edge = read('supabase/functions/zatca-submit/index.ts')
const drainAuthSource = read('supabase/functions/_shared/zatca/internal_drain_auth.mjs')
const supabaseConfig = read('supabase/config.toml')

const tests = []
const pendingTests = []
const test = (name, fn) => {
  pendingTests.push(Promise.resolve().then(fn).then(() => tests.push(name)))
}

test('HTTP 200 plus REPORTED is accepted', () => {
  assert.equal(classifyReportingHttpOutcome({
    httpStatus: 200,
    reportingStatus: 'REPORTED',
    errorCodes: [],
  }), REPORTING_OUTCOMES.accepted)
})

test('HTTP 200 with an explicit validation error is a definite rejection', () => {
  assert.equal(classifyReportingHttpOutcome({
    httpStatus: 200,
    reportingStatus: 'REPORTED',
    errorCodes: ['BR-KSA-DEC-01'],
  }), REPORTING_OUTCOMES.definiteRejection)
  assert.equal(classifyReportingHttpOutcome({
    httpStatus: 200,
    reportingStatus: 'NOT_REPORTED',
    validationStatus: 'ERROR',
    errorCodes: [],
  }), REPORTING_OUTCOMES.definiteRejection)
})

test('deterministic HTTP 400 is blocked and never classified for retry', () => {
  assert.equal(classifyReportingHttpOutcome({
    httpStatus: 400,
    reportingStatus: undefined,
    errorCodes: [],
  }), REPORTING_OUTCOMES.definiteRejection)
  assert.match(migration, /p_outcome = 'definite_rejection'[\s\S]*ELSE 'blocked'/)
  assert.match(migration, /IF v_outbox\.status = 'blocked' THEN[\s\S]*REPORTING_OUTBOX_BLOCKED/)
})

test('HTTP 429 and temporary 5xx responses are transient', () => {
  for (const status of [429, 500, 502, 503, 599]) {
    assert.equal(classifyReportingHttpOutcome({
      httpStatus: status,
      reportingStatus: undefined,
      errorCodes: [],
    }), REPORTING_OUTCOMES.transientFailure)
  }
  assert.equal(classifyReportingHttpOutcome({
    httpStatus: 429,
    reportingStatus: undefined,
    errorCodes: ['INVOICE_VALIDATION_ERROR'],
  }), REPORTING_OUTCOMES.definiteRejection)
  // Explicit validation evidence takes priority over a nominally transient HTTP status.
  assert.equal(classifyReportingHttpOutcome({
    httpStatus: 503,
    reportingStatus: undefined,
    errorCodes: ['ZATCA_VALIDATION_ERROR'],
  }), REPORTING_OUTCOMES.definiteRejection)
})

test('network interruption after durable request start becomes reconciliation required', () => {
  assert.equal(classifyReportingHttpOutcome({
    httpStatus: 408,
    reportingStatus: undefined,
    errorCodes: [],
  }), REPORTING_OUTCOMES.ambiguousOutcome)
  const worker = edge.slice(
    edge.indexOf('async function processReportingOutboxV2'),
    edge.indexOf('async function drainReportingOutboxV2'),
  )
  assert.match(worker, /requestStarted\s*\?\s*REPORTING_OUTCOMES\.ambiguousOutcome/)
  assert.match(migration, /p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'/)
  assert.match(migration, /p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'/)
})

test('four-attempt maximum and exponential backoff are bounded', () => {
  assert.equal(REPORTING_MAX_TRANSIENT_ATTEMPTS, 4)
  assert.deepEqual(reportingRetryDecision(1), {
    retryable: true,
    retryAfterSeconds: 60,
    reason: 'TRANSIENT_REPORTING_FAILURE',
  })
  assert.equal(reportingRetryDecision(2).retryAfterSeconds, 120)
  assert.equal(reportingRetryDecision(3).retryAfterSeconds, 240)
  assert.deepEqual(reportingRetryDecision(4), {
    retryable: false,
    retryAfterSeconds: null,
    reason: 'MAX_TRANSIENT_ATTEMPTS_REACHED',
  })
  assert.match(migration, /v_outbox\.attempt_count >= 4/)
  assert.match(migration, /MAX_TRANSIENT_ATTEMPTS_REACHED/)
})

test('an earlier blocked counter prevents every later counter in the branch', () => {
  const rows = [
    { branch: 'branch-1', counter: 865, status: 'blocked' },
    { branch: 'branch-1', counter: 866, status: 'pending' },
  ]
  const dispatchable = candidate => !rows.some(earlier => (
    earlier.branch === candidate.branch
    && earlier.counter < candidate.counter
    && earlier.status !== 'accepted'
  ))
  assert.equal(dispatchable(rows[1]), false)
  assert.match(migration, /earlier_invoice\.zatca_counter_number < i\.zatca_counter_number/)
  assert.match(migration, /earlier\.status <> 'accepted'/)
})

const EXPECTED_PROJECT_REF = 'bkbphkpqcxuejozayrsy'
const DISPATCH_TOKEN = 'random-dispatch-token-for-local-tests-only'

function jwt(role, ref = EXPECTED_PROJECT_REF) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, ref })}.signature`
}

test('global drain rejects anon and every ordinary user role', async () => {
  for (const role of ['anon', 'authenticated', 'cashier', 'manager', 'owner', 'admin']) {
    const token = jwt(role)
    assert.equal(await hasServiceRoleDrainCredentials({
      callerJWT: token,
      apiKey: token,
      dispatchToken: DISPATCH_TOKEN,
      expectedDispatchToken: DISPATCH_TOKEN,
      expectedProjectRef: EXPECTED_PROJECT_REF,
    }), false, role)
    assert.deepEqual(await authorizeDrainRequest({
      body: { action: 'drain_outbox' },
      callerJWT: token,
      apiKey: token,
      dispatchToken: DISPATCH_TOKEN,
      expectedDispatchToken: DISPATCH_TOKEN,
      expectedProjectRef: EXPECTED_PROJECT_REF,
    }), {
      isDrain: true,
      allowed: false,
      status: 403,
      code: 'SERVICE_ROLE_REQUIRED',
    }, role)
  }
  const serviceRoleJwt = jwt('service_role')
  assert.equal(await hasServiceRoleDrainCredentials({
    callerJWT: serviceRoleJwt,
    apiKey: null,
    dispatchToken: DISPATCH_TOKEN,
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  }), false)
  assert.equal((await authorizeDrainRequest({
    body: { action: 'drain_outbox' },
    callerJWT: '',
    apiKey: serviceRoleJwt,
    dispatchToken: DISPATCH_TOKEN,
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  })).status, 403)
  assert.equal((await authorizeDrainRequest({
    body: { action: 'drain_outbox' },
    callerJWT: serviceRoleJwt,
    apiKey: serviceRoleJwt,
    dispatchToken: 'wrong-token',
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  })).status, 403)
  assert.equal((await authorizeDrainRequest({
    body: { action: 'drain_outbox' },
    callerJWT: serviceRoleJwt,
    apiKey: serviceRoleJwt,
    dispatchToken: null,
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  })).status, 403)
  const forgedServiceRoleJwt = serviceRoleJwt.replace(/signature$/, 'forged-signature')
  assert.equal(await hasServiceRoleDrainCredentials({
    callerJWT: forgedServiceRoleJwt,
    apiKey: serviceRoleJwt,
    dispatchToken: DISPATCH_TOKEN,
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  }), false)
  assert.match(edge, /SERVICE_ROLE_REQUIRED/)
})

test('valid project service-role JWT and dispatcher token authorize drain', async () => {
  const serviceRoleJwt = jwt('service_role')
  assert.equal(await hasServiceRoleDrainCredentials({
    callerJWT: serviceRoleJwt,
    apiKey: serviceRoleJwt,
    dispatchToken: DISPATCH_TOKEN,
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  }), true)
  assert.equal(await timingSafeEqualText(DISPATCH_TOKEN, DISPATCH_TOKEN), true)
  assert.equal(await timingSafeEqualText(DISPATCH_TOKEN, 'wrong-dispatch-token-same-size'), false)
  assert.deepEqual(await authorizeDrainRequest({
    body: { action: 'drain_outbox', batchSize: 10 },
    callerJWT: serviceRoleJwt,
    apiKey: serviceRoleJwt,
    dispatchToken: DISPATCH_TOKEN,
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  }), {
    isDrain: true,
    allowed: true,
    status: 200,
    code: null,
  })
  assert.match(edge, /const drainAuthorization = await authorizeDrainRequest/)
  assert.match(supabaseConfig, /\[functions\.zatca-submit\][\s\S]*verify_jwt = true/)
  assert.match(edge, /ZATCA_OUTBOX_DISPATCH_TOKEN/)
  assert.match(edge, /x-zatca-dispatch-token/)
  assert.doesNotMatch(edge, /callerJWT === serviceRoleKey|apiKey === serviceRoleKey/)
  assert.match(drainAuthSource, /crypto\.subtle\.digest\('SHA-256'/)
  assert.match(drainAuthSource, /mismatch \|=/)
  assert.doesNotMatch(drainAuthSource, /serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(cron, /'Authorization', 'Bearer ' \|\|/)
  assert.match(cron, /'apikey', \(/)
  assert.match(cron, /'X-Zatca-Dispatch-Token', \(/)
  assert.match(cron, /zatca_outbox_dispatch_token/)
  assert.doesNotMatch(cron, /RAISE NOTICE|RAISE LOG|SELECT\s+decrypted_secret\s*;/i)
})

test('wrong project-ref service-role JWT is forbidden', async () => {
  const wrongProjectJwt = jwt('service_role', 'wrong-project-ref')
  assert.equal((await authorizeDrainRequest({
    body: { action: 'drain_outbox' },
    callerJWT: wrongProjectJwt,
    apiKey: wrongProjectJwt,
    dispatchToken: DISPATCH_TOKEN,
    expectedDispatchToken: DISPATCH_TOKEN,
    expectedProjectRef: EXPECTED_PROJECT_REF,
  })).status, 403)
})

test('drain scope is fixed globally and batch size is clamped', async () => {
  const serviceRoleJwt = jwt('service_role')
  assert.equal(REPORTING_MAX_BATCH_SIZE, 10)
  assert.equal(clampReportingBatchSize(0), 1)
  assert.equal(clampReportingBatchSize(7), 7)
  assert.equal(clampReportingBatchSize(999), 10)
  assert.equal(clampReportingBatchSize('invalid'), 10)
  assert.equal(isStrictDrainBody({ action: 'drain_outbox', batchSize: 10 }), true)
  for (const scoped of [
    { action: 'drain_outbox', tenantId: 'tenant' },
    { action: 'drain_outbox', branchId: 'branch' },
    { action: 'drain_outbox', invoiceId: 'invoice' },
  ]) {
    assert.equal(isStrictDrainBody(scoped), false)
    assert.equal((await authorizeDrainRequest({
      body: scoped,
      callerJWT: serviceRoleJwt,
      apiKey: serviceRoleJwt,
      dispatchToken: DISPATCH_TOKEN,
      expectedDispatchToken: DISPATCH_TOKEN,
      expectedProjectRef: EXPECTED_PROJECT_REF,
    })).status, 400)
  }
  assert.match(edge, /DRAIN_SCOPE_NOT_ALLOWED/)
})

test('internal response is aggregate-only and post-fetch uses outbox persistence', () => {
  const internalRoute = edge.slice(
    edge.indexOf('const requestsGlobalDrain'),
    edge.indexOf('const authClient = createClient'),
  )
  assert.match(internalRoute, /summary/)
  assert.doesNotMatch(internalRoute, /results,\s*\n/)
  assert.doesNotMatch(internalRoute, /zatca_simplified_xml|productionSecret|privateKey|safe_response/)
  const aggregateResponse = internalRoute.match(
    /return jsonResponse\(\{\n\s+ok: true,[\s\S]*?\n\s+\}\)/,
  )?.[0] ?? ''
  assert.ok(aggregateResponse)
  assert.doesNotMatch(aggregateResponse, /dispatchToken|outboxDispatchToken|callerJWT|apiKey/)
  assert.doesNotMatch(
    edge,
    /console\.(?:log|info|warn|error)\([^\n]*(?:dispatchToken|outboxDispatchToken|ZATCA_OUTBOX_DISPATCH_TOKEN)/,
  )

  const postFetch = edge.slice(
    edge.indexOf('const response = await fetch', edge.indexOf('async function processReportingOutboxV2')),
    edge.indexOf('async function drainReportingOutboxV2'),
  )
  assert.match(postFetch, /persist_zatca_reporting_outbox_result_v2/)
  assert.doesNotMatch(postFetch, /persist_zatca_reporting_result_v2/)
  assert.doesNotMatch(postFetch, /fail_zatca_network_v2/)
})

test('classified persistence cannot mutate immutable artifact identity', () => {
  const outcomePersistence = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.persist_zatca_reporting_outbox_result_v2'),
    migration.indexOf('CREATE OR REPLACE FUNCTION public.fail_zatca_reporting_outbox_attempt_v2'),
  )
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.persist_zatca_reporting_outbox_result_v2\([\s\S]*boolean/)
  assert.match(outcomePersistence, /p_outcome text/)
  assert.doesNotMatch(outcomePersistence, /p_reported boolean/)
  for (const immutableWrite of [
    'zatca_simplified_xml =',
    'zatca_simplified_xml_hash =',
    'zatca_simplified_signature =',
    'zatca_simplified_qr =',
    'zatca_uuid =',
    'zatca_counter_number =',
    'zatca_prev_invoice_hash =',
  ]) assert.doesNotMatch(outcomePersistence, new RegExp(immutableWrite))
})

await Promise.all(pendingTests)
console.log(`ZATCA outbox security/retry: ${tests.length} deterministic checks passed`)
for (const name of tests) console.log(`PASS ${name}`)
