import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

const edge = read('supabase/functions/zatca-submit/index.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const atomicClient = read('src/lib/zatca/atomicCheckout.ts')
const stockMigration = read(
  'supabase/migrations/20260725000400_canonical_branch_stock_enabled.sql',
)
const diagnostic = read(
  'scripts/sql/operator/diagnose_production_checkout_failure.sql',
)

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('incompatible atomic contract returns the write-free legacy decision', () => {
  const route = edge.indexOf(
    "if (action === 'checkout_simplified' || action === 'checkout_simplified_credit_note')",
  )
  const compatibility = edge.indexOf('if (!capabilities.compatible', route)
  const legacyAvailable = edge.indexOf(
    'if (capabilities.legacySubmitAvailable)',
    compatibility,
  )
  const legacyResponse = edge.indexOf("status: 'legacy_required'", legacyAvailable)
  const branchAuthorization = edge.indexOf(
    'const branchAuth = await authorizeBranchAccess',
    route,
  )
  const commercialCommit = edge.indexOf(
    'processAtomicSimplifiedCheckoutV2({',
    route,
  )

  assert.ok(route > 0)
  assert.ok(compatibility > route)
  assert.ok(legacyAvailable > compatibility)
  assert.ok(legacyResponse > legacyAvailable)
  assert.ok(legacyResponse < branchAuthorization)
  assert.ok(branchAuthorization < commercialCommit)
  assert.match(
    edge.slice(compatibility, branchAuthorization),
    /reason: 'atomic_rollout_disabled'/,
  )
  assert.match(
    edge.slice(compatibility, branchAuthorization),
    /runtime_version_incompatible/,
  )
  assert.match(
    edge.slice(compatibility, branchAuthorization),
    /client_request_version_incompatible/,
  )
})

test('legacy is not selected when the server says legacy submission is unavailable', () => {
  const compatibility = edge.indexOf('if (!capabilities.compatible')
  const legacyResponse = edge.indexOf("status: 'legacy_required'", compatibility)
  const unavailableError = edge.indexOf(
    "code: 'ATOMIC_SIMPLIFIED_CHECKOUT_UNAVAILABLE'",
    compatibility,
  )

  assert.ok(legacyResponse > compatibility)
  assert.ok(unavailableError > legacyResponse)
  assert.match(
    edge.slice(compatibility, unavailableError),
    /if \(capabilities\.legacySubmitAvailable\)/,
  )
})

test('frontend retains one idempotency key across atomic and legacy checkout', () => {
  const charge = pos.indexOf('async function charge()')
  const key = pos.indexOf('const idempotencyKey =', charge)
  const persist = pos.indexOf('persistPendingAtomicCheckout(', key)
  const atomic = pos.indexOf('await checkoutSimplifiedAtomically({', persist)
  const legacy = pos.indexOf("rpc('pos_checkout'", atomic)

  assert.ok(charge > 0 && key > charge)
  assert.ok(persist > key && atomic > persist)
  assert.ok(legacy > atomic)
  assert.match(
    pos.slice(key, atomic),
    /idempotency_key: idempotencyKey/,
  )
})

test('ambiguous transport errors remain failures and are not silently downgraded', () => {
  assert.match(atomicClient, /if \(error\) throw new Error\(error\.message\)/)
  assert.doesNotMatch(
    atomicClient,
    /FunctionsFetchError[\s\S]*legacy_required/,
  )
  assert.doesNotMatch(
    atomicClient,
    /FunctionsRelayError[\s\S]*legacy_required/,
  )
})

test('local checkout remains database-owned and ZATCA work is downstream', () => {
  const legacy = pos.indexOf("rpc('pos_checkout'")
  const finalizationBlock = pos.indexOf(
    'try {',
    pos.indexOf('let finalizationError', legacy),
  )
  const cartClear = pos.indexOf('setCart([])', finalizationBlock)

  assert.ok(legacy > 0)
  assert.ok(finalizationBlock > legacy)
  assert.ok(cartClear > finalizationBlock)
  assert.match(
    pos.slice(finalizationBlock, cartClear),
    /catch \(finalizationFailure\)/,
  )
})

test('branch stock NULL still resolves enabled for a trading tenant', () => {
  assert.match(
    stockMigration,
    /COALESCE\(t\.business_type, 'trading'\) <> 'service'[\s\S]*AND COALESCE\(b\.stock_enabled, true\)/,
  )
  assert.match(
    stockMigration,
    /GRANT EXECUTE ON FUNCTION public\.pos_checkout\(jsonb\) TO authenticated;/,
  )
})

test('generic UI error keeps the original failure in sanitized developer evidence', () => {
  assert.match(
    pos,
    /console\.warn\('\[POSPage charge\] checkout failed', err\)/,
  )
  assert.match(pos, /toast\.error\(t\(safeKey\)\)/)
})

test('production diagnostic is transactionally read-only and redacted', () => {
  assert.match(
    diagnostic,
    /^--[\s\S]*BEGIN TRANSACTION READ ONLY;/,
  )
  assert.match(diagnostic, /ROLLBACK;\s*$/)
  assert.doesNotMatch(
    diagnostic,
    /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b(?![^\n]*comment)/i,
  )
  assert.doesNotMatch(
    diagnostic,
    /\b(certificate|private_key|production_secret|compliance_secret|qr_code|zatca_xml|zatca_signature)\b/i,
  )
  assert.match(diagnostic, /idempotency_key_length/)
  assert.doesNotMatch(
    diagnostic,
    /SELECT[\s\S]{0,120}\bidempotency_key\b[\s\S]{0,40}\bFROM\b/i,
  )
})

for (const { name, fn } of tests) {
  await fn()
  console.log(`ok - ${name}`)
}

console.log(`production checkout hotfix checks passed (${tests.length})`)
