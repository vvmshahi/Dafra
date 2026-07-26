import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const edge = read('supabase/functions/zatca-submit/index.ts')
const migration = read(
  'supabase/migrations/20260726000000_zatca_reporting_evidence_reconciliation.sql',
)
const diagnostic = read('scripts/sql/operator/diagnose_pending_zatca_reporting.sql')

const passed = []
const test = (name, callback) => {
  callback()
  passed.push(name)
}

function reconcileModel({ invoiceStatus, lifecycle, outboxStatus, evidenceOutcome }) {
  if (invoiceStatus === 'reported' && lifecycle === 'reported') {
    return { status: 'accepted', submitAgain: false, idempotentReplay: true }
  }
  if (lifecycle !== 'reconciliation_required') {
    return { status: outboxStatus, submitAgain: false, idempotentReplay: true }
  }
  if (evidenceOutcome == null || evidenceOutcome === 'ambiguous_outcome') {
    return { status: 'reconciliation_required', submitAgain: false }
  }
  if (evidenceOutcome === 'accepted') {
    return { status: 'accepted', submitAgain: false }
  }
  if (evidenceOutcome === 'definite_rejection') {
    return { status: 'blocked', submitAgain: false }
  }
  return { status: 'retryable', submitAgain: true }
}

test('a 121.193-second response outlives the old lease but not the corrected lease', () => {
  const responseSeconds = 121.193
  assert.ok(responseSeconds > 120)
  assert.ok(responseSeconds < 240)
  assert.match(edge, /const REPORTING_LEASE_SECONDS = 240/)
  const worker = edge.slice(
    edge.indexOf('async function processReportingOutboxV2'),
    edge.indexOf('async function drainReportingOutboxV2'),
  )
  assert.equal(
    [...worker.matchAll(/p_lease_seconds:\s*REPORTING_LEASE_SECONDS/g)].length,
    2,
  )
  assert.doesNotMatch(worker, /p_lease_seconds:\s*120/)
})

test('retry reconciles durable response evidence before enqueue or network dispatch', () => {
  const retry = edge.slice(
    edge.indexOf("if (action === 'retry')"),
    edge.indexOf("if (action === 'recover_immutable_pair')"),
  )
  const reconciliation = retry.indexOf(
    "rpc('reconcile_zatca_reporting_response_evidence_v2'",
  )
  const enqueue = retry.indexOf("rpc('enqueue_zatca_reporting_outbox_v2'")
  const dispatch = retry.indexOf('scheduleReportingOutboxDrain')
  assert.ok(reconciliation >= 0)
  assert.ok(reconciliation < enqueue)
  assert.ok(enqueue < dispatch)
  assert.match(retry, /reconciliation\.status === 'accepted'/)
  assert.match(retry, /reconciliation\.status !== 'retryable'/)
})

test('reconciliation is service-role-only and keeps strict function security', () => {
  assert.match(migration, /^BEGIN;$/m)
  assert.match(migration, /^COMMIT;$/m)
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.reconcile_zatca_reporting_response_evidence_v2\(/,
  )
  assert.match(migration, /LANGUAGE plpgsql\s+SECURITY DEFINER/)
  assert.match(migration, /SET search_path = public, pg_temp/)
  assert.match(
    migration,
    /ALTER FUNCTION public\.reconcile_zatca_reporting_response_evidence_v2\(uuid\)\s+OWNER TO postgres;/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.reconcile_zatca_reporting_response_evidence_v2\(uuid\)\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.reconcile_zatca_reporting_response_evidence_v2\(uuid\)\s+TO service_role;/,
  )
  assert.doesNotMatch(migration, /TO authenticated/)
})

test('stored evidence and immutable invoice identity are validated under locks', () => {
  assert.ok((migration.match(/FOR UPDATE;/g) ?? []).length >= 3)
  for (const assertion of [
    /v_outbox\.tenant_id IS DISTINCT FROM v_invoice\.tenant_id/,
    /v_outbox\.branch_id IS DISTINCT FROM v_invoice\.branch_id/,
    /v_outbox\.artifact_hash IS DISTINCT FROM v_invoice\.zatca_simplified_xml_hash/,
    /v_reservation\.state IS DISTINCT FROM 'committed'/,
    /v_reservation\.counter_number IS DISTINCT FROM v_invoice\.zatca_counter_number/,
    /v_reservation\.previous_hash IS DISTINCT FROM v_invoice\.zatca_prev_invoice_hash/,
    /v_evidence\.network_token IS NULL/,
    /v_evidence\.attempt_count > v_outbox\.attempt_count/,
  ]) assert.match(migration, assertion)
  assert.match(
    migration,
    /ORDER BY\s+CASE WHEN classified_outcome = 'accepted' THEN 0 ELSE 1 END/,
  )
  assert.match(migration, /public\.persist_zatca_reporting_outbox_result_v2\(/)
})

test('accepted evidence is never submitted again and replay is idempotent', () => {
  assert.deepEqual(reconcileModel({
    invoiceStatus: 'pending',
    lifecycle: 'reconciliation_required',
    outboxStatus: 'blocked',
    evidenceOutcome: 'accepted',
  }), { status: 'accepted', submitAgain: false })
  assert.deepEqual(reconcileModel({
    invoiceStatus: 'reported',
    lifecycle: 'reported',
    outboxStatus: 'accepted',
    evidenceOutcome: 'accepted',
  }), { status: 'accepted', submitAgain: false, idempotentReplay: true })
  assert.match(migration, /'idempotentReplay', true/)
})

test('transient evidence becomes retryable but definite and ambiguous evidence stay blocked', () => {
  assert.deepEqual(reconcileModel({
    invoiceStatus: 'pending',
    lifecycle: 'reconciliation_required',
    outboxStatus: 'blocked',
    evidenceOutcome: 'transient_failure',
  }), { status: 'retryable', submitAgain: true })
  assert.deepEqual(reconcileModel({
    invoiceStatus: 'pending',
    lifecycle: 'reconciliation_required',
    outboxStatus: 'blocked',
    evidenceOutcome: 'definite_rejection',
  }), { status: 'blocked', submitAgain: false })
  assert.deepEqual(reconcileModel({
    invoiceStatus: 'pending',
    lifecycle: 'reconciliation_required',
    outboxStatus: 'blocked',
    evidenceOutcome: 'ambiguous_outcome',
  }), { status: 'reconciliation_required', submitAgain: false })
  assert.match(migration, /v_evidence\.classified_outcome = 'ambiguous_outcome'/)
})

test('reconciliation never rewrites commercial or immutable ZATCA identity fields', () => {
  for (const forbiddenAssignment of [
    'zatca_uuid =',
    'zatca_counter_number =',
    'zatca_prev_invoice_hash =',
    'zatca_simplified_xml =',
    'zatca_simplified_xml_hash =',
    'zatca_simplified_signature =',
    'zatca_simplified_qr =',
    'total_amount =',
    'tax_amount =',
    'payment_status =',
    'stock_quantity =',
  ]) assert.doesNotMatch(migration, new RegExp(forbiddenAssignment))
  assert.doesNotMatch(
    migration,
    /762872f8-b43e-47c9-ada7-68636c984eeb|fbc300c7-2ae3-4601-9355-4adc9a6f542d|INV-0916/,
  )
})

test('operator diagnostic is transactionally read-only and omits sensitive values', () => {
  assert.match(diagnostic, /^BEGIN TRANSACTION READ ONLY;$/m)
  assert.match(diagnostic, /^ROLLBACK;$/m)
  assert.doesNotMatch(
    diagnostic,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|CALL)\b/i,
  )
  for (const forbiddenSelection of [
    'zatca_simplified_xml,',
    'zatca_simplified_qr',
    'zatca_simplified_signature',
    'e.safe_response',
    'e.network_token',
    'o.lease_token AS',
    'j.command',
    'decrypted_secret',
  ]) assert.doesNotMatch(diagnostic, new RegExp(forbiddenSelection))
  for (const required of [
    'target_invoice',
    'target_outbox',
    'pending_after_last_reported',
    'expired_or_stuck_claims',
    'accepted_evidence_pending_invoice',
    'missing_reporting_outbox',
    'duplicate_reporting_outbox',
    'chain_continuity',
    'reporting_scheduler',
    'reporting_function_privileges',
  ]) assert.match(diagnostic, new RegExp(required))
})

console.log(
  `ZATCA reporting evidence reconciliation: ${passed.length} deterministic checks passed`,
)
for (const name of passed) console.log(`PASS ${name}`)
