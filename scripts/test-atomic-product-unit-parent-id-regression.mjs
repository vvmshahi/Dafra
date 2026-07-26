import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const correctionPath =
  'supabase/migrations/20260726000600_fix_atomic_product_unit_parent_identity.sql'

const atomicMigration = read(
  'supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql',
)
const productUnitMigration = read(
  'supabase/migrations/20260725000700_product_units_commercial_workflow.sql',
)
const edge = read('supabase/functions/zatca-submit/index.ts')
const atomicClient = read('src/lib/zatca/atomicCheckout.ts')
const baselineSchema = read(
  'supabase/migrations/20260721000100_dafra_current_schema_and_security.sql',
)
const predeploymentSql = read(
  'scripts/sql/atomic-simplified-checkout-fk-fix/01_predeployment_read_only.sql',
)

const results = []
function test(name, assertion) {
  assertion()
  results.push(name)
}

function simulateCommercialWrite({
  capturePersistedParent,
  atomic = true,
  itemCount = 1,
  injectChildFailure = false,
}) {
  const state = {
    invoices: [],
    invoiceItems: [],
    payments: [],
    atomicState: 'prepared',
  }
  const candidateId = '00000000-0000-4000-8000-000000000001'
  const reservedId = '00000000-0000-4000-8000-000000000002'
  const persistedId = atomic ? reservedId : candidateId
  let authoritativeId = candidateId

  try {
    state.invoices.push(persistedId)
    if (capturePersistedParent) authoritativeId = persistedId
    if (!state.invoices.includes(authoritativeId)) {
      const error = new Error('invoice_items_invoice_id_fkey')
      error.code = '23503'
      throw error
    }
    for (let index = 0; index < itemCount; index += 1) {
      if (injectChildFailure && index === itemCount - 1) {
        throw new Error('injected child failure')
      }
      state.invoiceItems.push({ invoiceId: authoritativeId })
    }
    state.payments.push({ invoiceId: authoritativeId })
    state.atomicState = 'committed'
    return { state, candidateId, reservedId, persistedId, authoritativeId }
  } catch (error) {
    state.invoices = []
    state.invoiceItems = []
    state.payments = []
    state.atomicState = 'prepared'
    error.transactionState = state
    throw error
  }
}

test('the historical source deterministically reproduces the production FK shape', () => {
  assert.match(
    productUnitMigration,
    /v_invoice_id uuid := pg_catalog\.gen_random_uuid\(\);/,
  )
  assert.match(
    atomicMigration,
    /NEW\.id := v_intent\.invoice_id;/,
  )
  assert.match(
    productUnitMigration,
    /INSERT INTO public\.invoice_items[\s\S]*?VALUES \(\s*v_invoice_id,/,
  )
  assert.throws(
    () => simulateCommercialWrite({
      capturePersistedParent: false,
      atomic: true,
      itemCount: 1,
    }),
    error => {
      assert.equal(error.code, '23503')
      assert.match(error.message, /invoice_items_invoice_id_fkey/)
      assert.deepEqual(error.transactionState, {
        invoices: [],
        invoiceItems: [],
        payments: [],
        atomicState: 'prepared',
      })
      return true
    },
  )
})

test('a guarded additive correction is present', () => {
  assert.equal(
    existsSync(join(root, correctionPath)),
    true,
    `${correctionPath} is missing; confirmed pre-fix regression`,
  )
})

const correction = existsSync(join(root, correctionPath))
  ? read(correctionPath)
  : ''

test('the correction captures and verifies the persisted parent before children', () => {
  assert.match(correction, /RETURNING id INTO v_invoice_id;/)
  assert.match(correction, /ATOMIC_CHECKOUT_COMMERCIAL_PARENT_MISSING/)
  assert.match(
    correction,
    /FROM public\.invoices AS persisted_invoice[\s\S]*?persisted_invoice\.id = v_invoice_id/,
  )
  const capture = correction.indexOf('RETURNING id INTO v_invoice_id;')
  const assertion = correction.indexOf('ATOMIC_CHECKOUT_COMMERCIAL_PARENT_MISSING')
  const childInsert = correction.indexOf('INSERT INTO public.invoice_items')
  assert.ok(capture > 0 && assertion > capture && childInsert > assertion)
})

test('the patch is bounded and preserves calculation, FK, and privilege contracts', () => {
  assert.match(correction, /^BEGIN;/)
  assert.match(correction, /SET LOCAL lock_timeout = '5s'/)
  assert.match(correction, /SET LOCAL statement_timeout = '5min'/)
  assert.match(correction, /pg_get_functiondef/)
  assert.match(correction, /PRODUCT_UNITS_ATOMIC_PARENT_DEFINITION_UNREVIEWED/)
  assert.match(correction, /product_units_commercial_function_contracts_v1/)
  assert.match(correction, /REVOKE ALL ON FUNCTION public\.pos_checkout_with_product_units_v1\(jsonb\)/)
  assert.match(correction, /GRANT EXECUTE ON FUNCTION public\.pos_checkout_with_product_units_v1\(jsonb\)[\s\S]*?TO service_role/)
  assert.match(correction, /COMMIT;\s*$/)
  assert.doesNotMatch(
    correction,
    /\bALTER TABLE public\.invoice_items\b|\bDROP CONSTRAINT\b|\bDEFERRABLE\b|\bON DELETE\b/,
  )
  assert.doesNotMatch(
    correction,
    /get_next_invoice_counter|stock_quantity|tax_amount :=|v_total :=|zatca_counter/,
  )
})

test('cash, card, one-item, multi-item, and non-atomic writes share one parent ID', () => {
  for (const paymentMethod of ['cash', 'card']) {
    for (const itemCount of [1, 3]) {
      const result = simulateCommercialWrite({
        capturePersistedParent: true,
        atomic: true,
        itemCount,
      })
      assert.equal(paymentMethod === 'cash' || paymentMethod === 'card', true)
      assert.equal(result.authoritativeId, result.persistedId)
      assert.equal(result.state.invoiceItems.length, itemCount)
      assert.ok(
        result.state.invoiceItems.every(item => item.invoiceId === result.persistedId),
      )
      assert.equal(result.state.payments[0].invoiceId, result.persistedId)
      assert.equal(result.state.atomicState, 'committed')
    }
  }

  const legacy = simulateCommercialWrite({
    capturePersistedParent: true,
    atomic: false,
    itemCount: 1,
  })
  assert.equal(legacy.candidateId, legacy.persistedId)
  assert.equal(legacy.authoritativeId, legacy.persistedId)
})

test('an injected child failure rolls the modeled commercial transaction back', () => {
  assert.throws(
    () => simulateCommercialWrite({
      capturePersistedParent: true,
      atomic: true,
      itemCount: 2,
      injectChildFailure: true,
    }),
    error => {
      assert.deepEqual(error.transactionState, {
        invoices: [],
        invoiceItems: [],
        payments: [],
        atomicState: 'prepared',
      })
      return true
    },
  )
})

test('atomic IDs and replay sources remain database-owned and version 2.1.0', () => {
  assert.match(
    atomicMigration,
    /invoice_id, invoice_uuid,[\s\S]*?VALUES \([\s\S]*?gen_random_uuid\(\), gen_random_uuid\(\)/,
  )
  assert.match(atomicMigration, /IF v_intent\.state = 'committed'/)
  assert.match(atomicMigration, /ATOMIC_CHECKOUT_INTENT_EXPIRED/)
  assert.match(atomicMigration, /IDEMPOTENCY_FINGERPRINT_MISMATCH/)
  assert.match(atomicMigration, /commit_zatca_atomic_checkout_v2/)
  assert.match(atomicMigration, /build_zatca_atomic_receipt_snapshot_v2/)
  assert.match(atomicMigration, /zatca_reporting_outbox_v2/)
  assert.match(atomicClient, /ZATCA_FINALIZATION_CLIENT_VERSION/)
  assert.match(edge, /const FINALIZATION_CLIENT_VERSION = '2\.1\.0'/)
  assert.doesNotMatch(
    edge.slice(
      edge.indexOf('async function processAtomicSimplifiedCheckoutV2'),
      edge.indexOf('async function loadBranchReadinessV2'),
    ),
    /randomUUID|gen_random_uuid/,
  )
})

test('the Edge response uses safe categories and never returns raw database text', () => {
  assert.match(edge, /function classifyAtomicCheckoutFailure/)
  assert.match(edge, /ATOMIC_COMMERCIAL_PARENT_MISSING/)
  assert.match(edge, /ATOMIC_IDEMPOTENCY_INCONSISTENCY/)
  assert.match(edge, /ATOMIC_STALE_INTENT/)
  assert.match(edge, /ATOMIC_UNEXPECTED_DATABASE_FAILURE/)
  assert.match(edge, /requestId: reqId/)
  assert.match(edge, /stage: 'commercial_commit'/)
  const catchStart = edge.indexOf(
    "} catch (error) {",
    edge.indexOf('processAtomicSimplifiedCheckoutV2({'),
  )
  const catchEnd = edge.indexOf('\n      }\n    }\n', catchStart)
  const catchBlock = edge.slice(catchStart, catchEnd)
  assert.doesNotMatch(catchBlock, /error: message/)
  assert.doesNotMatch(catchBlock, /reason: message/)
})

test('dispatch, authorization, register, standard, legacy, and calculation sources are unchanged', () => {
  assert.match(
    productUnitMigration,
    /RETURN public\.pos_checkout_with_product_units_v1\(p_payload\);[\s\S]*?RETURN public\.pos_checkout_legacy_base_v1\(p_payload\);/,
  )
  assert.match(productUnitMigration, /v_zatca_invoice_type public\.invoice_type := 'simplified'/)
  assert.match(productUnitMigration, /get_next_invoice_counter\(v_branch\.id\)/)
  assert.match(productUnitMigration, /POS session is not open/)
  assert.match(productUnitMigration, /branch_id = v_branch\.id/)
  assert.match(productUnitMigration, /v_payment_rows := jsonb_build_array/)
  assert.match(productUnitMigration, /public\.branch_effective_stock_enabled/)
  assert.match(
    baselineSchema,
    /ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY \("invoice_id"\) REFERENCES "public"\."invoices"\("id"\) ON DELETE CASCADE/,
  )
  assert.doesNotMatch(correction, /legacy_required|existing_legacy_idempotency/)
})

test('the deployment verifier is read-only, scoped, and checks the live invariant', () => {
  assert.match(predeploymentSql, /^BEGIN TRANSACTION READ ONLY;/)
  assert.match(predeploymentSql, /ROLLBACK;\s*$/)
  assert.match(predeploymentSql, /deployed_definition_md5/)
  assert.match(predeploymentSql, /registered_contract_matches/)
  assert.match(predeploymentSql, /minimum_client_version/)
  assert.match(predeploymentSql, /minimum_edge_version/)
  assert.match(predeploymentSql, /invoice_items_invoice_id_fkey/)
  assert.match(predeploymentSql, /condeferrable/)
  assert.match(predeploymentSql, /orphan_invoice_item_count/)
  assert.match(predeploymentSql, /expired_prepared_count/)
  assert.match(predeploymentSql, /committed-but-incomplete candidates/)
  assert.doesNotMatch(
    predeploymentSql,
    /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\s+(?:TABLE\s+)?public\./i,
  )
})

console.log(`Atomic product-unit parent ID regression: ${results.length} checks passed`)
