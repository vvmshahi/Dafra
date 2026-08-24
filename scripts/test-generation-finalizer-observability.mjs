import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  classifyGenerationFinalizerPreflight,
  GENERATION_PREFLIGHT_CODES,
} from '../supabase/functions/_shared/fiscal/generation_finalizer_preflight.mjs'

const edge = await readFile(new URL('../supabase/functions/fiscal-finalize-generation/index.ts', import.meta.url), 'utf8')
const valid = {
  policy: { regime: 'generation' },
  invoice: { id: 'invoice-1', branch_id: 'branch-1' },
  snapshot: { invoice_id: 'invoice-1' },
  branch: { id: 'branch-1' },
  branchId: 'branch-1',
}

const cases = [
  ['policy RPC error', { ...valid, policy: null, policyError: { code: '42501' } }, 'policy_lookup', GENERATION_PREFLIGHT_CODES.POLICY_LOOKUP_FAILED],
  ['policy missing', { ...valid, policy: null }, 'policy_lookup', GENERATION_PREFLIGHT_CODES.POLICY_NOT_FOUND],
  ['invoice RPC error', { ...valid, invoice: null, invoiceError: { code: 'PGRST116' } }, 'invoice_lookup', GENERATION_PREFLIGHT_CODES.INVOICE_LOOKUP_FAILED],
  ['invoice missing', { ...valid, invoice: null }, 'invoice_lookup', GENERATION_PREFLIGHT_CODES.INVOICE_NOT_FOUND],
  ['snapshot RPC error', { ...valid, snapshot: null, snapshotError: { code: 'PGRST500' } }, 'snapshot_lookup', GENERATION_PREFLIGHT_CODES.SNAPSHOT_LOOKUP_FAILED],
  ['snapshot missing', { ...valid, snapshot: null }, 'snapshot_lookup', GENERATION_PREFLIGHT_CODES.SNAPSHOT_NOT_FOUND],
  ['branch RPC error', { ...valid, branch: null, branchError: { code: 'PGRST500' } }, 'branch_lookup', GENERATION_PREFLIGHT_CODES.BRANCH_LOOKUP_FAILED],
  ['branch missing', { ...valid, branch: null }, 'branch_lookup', GENERATION_PREFLIGHT_CODES.BRANCH_NOT_FOUND],
  ['invoice branch mismatch', { ...valid, invoice: { id: 'invoice-1', branch_id: 'other-branch' } }, 'invoice_branch_scope', GENERATION_PREFLIGHT_CODES.INVOICE_BRANCH_MISMATCH],
  ['non-Generation policy', { ...valid, policy: { regime: 'integration' } }, 'policy_regime', GENERATION_PREFLIGHT_CODES.REGIME_INVALID],
]

for (const [label, input, stage, code] of cases) {
  const failure = classifyGenerationFinalizerPreflight(input)
  assert.equal(failure?.stage, stage, `${label}: stage`)
  assert.equal(failure?.code, code, `${label}: code`)
}
assert.equal(classifyGenerationFinalizerPreflight(valid), null, 'valid Generation policy proceeds')

for (const required of [
  'failure_stage', 'correlation_id', 'generation_finalizer_failure',
  'expected_policy_revision', 'checkout_idempotency_key', 'upstream_error',
  'GENERATION_POLICY_INVALID', 'GENERATION_NOTE_CREATE_FAILED', 'note_create_rpc', 'finalization_rpc',
]) assert.match(edge, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `edge contains ${required}`)

for (const forbidden of ['zatca-submit', 'zatca_counter_number', 'previous_hash', 'ICV', 'PIH']) {
  assert.equal(edge.includes(forbidden), false, `Generation finalizer must not use ${forbidden}`)
}

console.log(`Generation finalizer observability tests passed: ${cases.length + 1} preflight cases`)
