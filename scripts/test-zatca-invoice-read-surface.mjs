import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = join(root, 'scripts/sql/zatca-phase2-finalization-v2')
const read = relative => readFileSync(join(root, relative), 'utf8')

const safeColumns = [
  'id', 'tenant_id', 'branch_id', 'customer_id', 'created_by',
  'invoice_number', 'invoice_reference', 'zatca_invoice_type',
  'zatca_status', 'zatca_submitted_at', 'subtotal', 'discount_amount',
  'taxable_amount', 'tax_amount', 'total_amount', 'currency_code',
  'invoice_date', 'supply_date', 'due_date', 'status', 'payment_status',
  'notes', 'notes_ar', 'cancelled_at', 'cancellation_reason',
  'created_at', 'updated_at', 'session_id', 'payment_method',
  'original_invoice_id', 'credit_reason', 'document_language',
]

const rawV2Columns = [
  'zatca_finalization_version', 'zatca_artifact_provenance',
  'zatca_document_kind', 'zatca_lifecycle_state', 'zatca_artifact_stage',
  'zatca_finalized_at_v2', 'zatca_finalization_error_v2',
  'zatca_simplified_xml', 'zatca_simplified_xml_hash',
  'zatca_simplified_signature', 'zatca_simplified_qr',
  'zatca_provisional_xml', 'zatca_provisional_xml_hash',
  'zatca_provisional_signature', 'zatca_provisional_qr',
  'zatca_cleared_xml', 'zatca_cleared_xml_hash',
  'zatca_cleared_signature', 'zatca_cleared_qr',
  'zatca_clearance_metadata_v2', 'zatca_network_response_v2',
  'zatca_finalization_claim_token_v2', 'zatca_finalization_claimed_at_v2',
  'zatca_finalization_lease_expires_at_v2', 'zatca_finalization_claimed_by_v2',
  'zatca_finalization_attempt_v2', 'zatca_network_claim_token_v2',
  'zatca_network_claimed_at_v2', 'zatca_network_lease_expires_at_v2',
  'zatca_network_claimed_by_v2', 'zatca_network_operation_v2',
  'zatca_network_attempt_v2', 'zatca_network_idempotency_key_v2',
  'zatca_network_request_hash_v2', 'zatca_network_request_started_at_v2',
  'zatca_network_ack_state_v2', 'zatca_reconciliation_reason_v2',
]

const legacyServerOnlyColumns = [
  'zatca_uuid', 'zatca_type_code', 'zatca_counter_number',
  'zatca_prev_invoice_hash', 'zatca_xml', 'zatca_xml_hash',
  'zatca_signature', 'zatca_qr_code', 'zatca_submission_id',
  'zatca_clearance_status', 'zatca_clearance_response',
  'zatca_reporting_response', 'zatca_warnings',
  'checkout_idempotency_key', 'credit_note_idempotency_key',
]
const serverOnlyColumns = [...legacyServerOnlyColumns, ...rawV2Columns]

function quotedValues(value) {
  return [...value.matchAll(/'([^']+)'/g)].map(match => match[1])
}

function tsArray(source, name) {
  const body = source.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`))?.[1]
  assert.ok(body, `${name} array not found`)
  return quotedValues(body)
}

function sqlConstantArray(source, name) {
  const body = source.match(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\];`))?.[1]
  assert.ok(body, `${name} SQL array not found`)
  return quotedValues(body)
}

function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const contractSource = read('src/lib/invoices/invoiceReadContract.ts')
const migration = read('scripts/sql/zatca-phase2-finalization-v2/04a_safe_invoice_read_surface.sql')
const preflight = read('scripts/sql/zatca-phase2-finalization-v2/00_hosted_preflight.sql')
const statusSql = read('scripts/sql/zatca-phase2-finalization-v2/05_capabilities_and_status.sql')
const verification = read('scripts/sql/zatca-phase2-finalization-v2/06_verification.sql')
const contractDoc = read('scripts/sql/zatca-phase2-finalization-v2/INVOICE_READ_CONTRACT.md')
const releaseContract = read('scripts/sql/zatca-phase2-finalization-v2/CONTRACT.md')
const rollback = read('scripts/sql/zatca-phase2-finalization-v2/07_rollback_plan.md')
const fixture = read('scripts/sql/zatca-phase2-finalization-v2/fixtures/invoice_read_surface_fixture.sql')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const receipt = read('src/pages/print/ReceiptPrintPage.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const edge = read('supabase/functions/zatca-submit/index.ts')
const submission = read('src/lib/zatca/submission.ts')
const qrDisplay = read('src/lib/zatca/qrDisplay.mjs')

const results = []
async function test(name, callback) {
  await callback()
  results.push(name)
}

await test('canonical typed safe list is exact and synchronized with SQL', () => {
  assert.deepEqual(tsArray(contractSource, 'INVOICE_SAFE_COLUMNS'), safeColumns)
  assert.deepEqual(sqlConstantArray(migration, 'v_safe_columns'), safeColumns)
  assert.deepEqual(sqlConstantArray(verification, 'v_safe_invoice_columns'), safeColumns)
  assert.match(contractSource, /satisfies readonly \(keyof Invoice\)\[\]/)
  assert.match(contractSource, /Pick<Invoice, InvoiceSafeColumn>/)
})

await test('exact v2 and complete server-only lists are synchronized', () => {
  assert.equal(rawV2Columns.length, 37)
  assert.equal(serverOnlyColumns.length, 52)
  assert.deepEqual(sqlConstantArray(migration, 'v_server_only_columns'), serverOnlyColumns)
  assert.deepEqual(sqlConstantArray(verification, 'v_raw_v2_columns'), serverOnlyColumns)
  for (const column of rawV2Columns) assert.match(contractDoc, new RegExp(`\\b${column}\\b`))
})

await test('all authenticated invoice selectors are explicit and server-only-free', () => {
  const sourceFiles = walk(join(root, 'src')).filter(path => /\.(?:ts|tsx)$/.test(path))
  let calls = 0
  for (const path of sourceFiles) {
    const source = readFileSync(path, 'utf8')
    const selectCall = /\.from\(\s*['"]invoices['"]\s*\)[\s\S]{0,180}?\.select\(([\s\S]{0,700}?)\)/g
    for (const match of source.matchAll(selectCall)) {
      calls += 1
      const selector = match[1]
      assert.doesNotMatch(selector, /^\s*['"`]\s*\*/, `${path} selects invoices.*`)
      for (const column of serverOnlyColumns) {
        assert.doesNotMatch(selector, new RegExp(`\\b${column}\\b`), `${path} selects ${column}`)
      }
    }
  }
  assert.ok(calls >= 17, `expected the complete browser inventory, found only ${calls} selectors`)
})

await test('detail, receipt, and historical A4 paths use safe rows plus safe QR APIs', () => {
  for (const source of [detail, receipt]) {
    assert.match(source, /from\('invoices'\)\.select\(INVOICE_SAFE_SELECT\)/)
    assert.match(source, /getInvoiceZatcaOutputState/)
    assert.match(source, /getSandboxValidationStatus/)
    assert.match(source, /selectStoredOutputStateQr\(outputStateMatchesInvoice \? outputState : null\)/)
    assert.doesNotMatch(source, /invoice!?\.zatca_qr_code/)
    assert.doesNotMatch(source, /zatca_finalization_version:\s*2/)
    assert.match(source, /documentFromStoredInvoice/)
  }
  assert.match(qrDisplay, /outputState\.qrCode/)
  assert.doesNotMatch(qrDisplay, /zatca_(?:qr_code|simplified_qr|cleared_qr)/)
  assert.match(detail, /A4Document/)
  assert.match(receipt, /ThermalReceipt/)
})

await test('list, POS, credit-note, dashboard, and accounting selectors stay within the safe contract', () => {
  const expected = new Map([
    ['src/pages/invoices/InvoicesPage.tsx', ['id, branch_id, invoice_number', 'original_invoice_id']],
    ['src/pages/pos/POSPage.tsx', ['id, zatca_invoice_type, total_amount']],
    ['src/pages/invoices/InvoiceDetailPage.tsx', ['payment_status, credit_reason', 'document_language']],
    ['src/pages/invoices/CreateCreditNoteModal.tsx', ['zatca_status']],
    ['src/pages/day-closing/DayClosingPage.tsx', ['id, total_amount, tax_amount, zatca_invoice_type']],
    ['src/pages/customers/CustomerDetailPage.tsx', ['invoice_number, invoice_date, total_amount']],
    ['src/pages/operations/OperationsPage.tsx', ['zatca_status, zatca_submitted_at']],
    ['src/pages/admin/BranchDetailPage.tsx', ['invoice_date, payment_method']],
  ])
  for (const [path, snippets] of expected) {
    const source = read(path)
    for (const snippet of snippets) assert.match(source, new RegExp(snippet.replaceAll(' ', '\\s*')))
  }
  assert.match(pos, /getInvoiceZatcaOutputState/)
  assert.match(read('src/pages/reports/accounting.ts'), /zatca_invoice_type/)
})

await test('grant patch is fail-closed, idempotent, and RLS-neutral', () => {
  for (const marker of [
    'EXPECTED_SUPABASE_ROLE_MISSING', 'INVOICE_RLS_NOT_ENABLED',
    'UNEXPECTED_PUBLIC_INVOICE_SELECT_GRANT', 'UNEXPECTED_ANON_INVOICE_SELECT_GRANT',
    'UNEXPECTED_AUTHENTICATED_INVOICE_SELECT_STATE',
    'UNEXPECTED_AUTHENTICATED_UNSAFE_COLUMN_GRANTS',
    'AUTHENTICATED_NON_SAFE_INVOICE_COLUMNS_REMAIN',
    'SERVICE_ROLE_INVOICE_READ_CONTRACT_BROKEN',
  ]) assert.match(migration, new RegExp(marker))
  assert.match(migration, /REVOKE SELECT ON TABLE public\.invoices FROM authenticated, anon/)
  assert.match(migration, /GRANT SELECT \(%s\) ON TABLE public\.invoices TO authenticated/)
  assert.doesNotMatch(migration, /CREATE\s+POLICY|DROP\s+POLICY|ENABLE\s+ROW\s+LEVEL|DISABLE\s+ROW\s+LEVEL/i)
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+public\.invoices\b/i)
})

await test('safe output state exposes only approved customer-output metadata', () => {
  for (const key of [
    'invoiceId', 'invoiceStatus', 'finalizationStatus', 'artifactStage',
    'documentKind', 'canPrint', 'canShare', 'retryAvailable',
    'reconciliationRequired', 'qrCode', 'error',
  ]) assert.match(statusSql, new RegExp(`'${key}'`))
  for (const forbiddenKey of [
    'xml', 'hash', 'signature', 'counter', 'pih', 'claimToken',
    'leaseExpiresAt', 'idempotencyKey', 'networkResponse', 'clearanceResponse',
  ]) assert.doesNotMatch(statusSql, new RegExp(`'${forbiddenKey}'\\s*,`))
  assert.match(edge, /minimumClientVersion: capabilities\.minimumClientVersion/)
  assert.match(submission, /const invoiceId = String\(data\?\.invoiceId/)
  assert.match(submission, /const minimumClientVersion = String\(data\?\.minimumClientVersion/)
  assert.match(submission, /invoiceId !== params\.invoiceId/)
  assert.match(submission, /const canPrint = compatible && data\?\.canPrint === true/)
})

await test('service-role Edge reads retain required raw compliance fields', () => {
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/)
  for (const field of [
    'zatca_simplified_xml', 'zatca_provisional_xml', 'zatca_cleared_xml',
    'zatca_counter_number', 'zatca_prev_invoice_hash',
  ]) assert.match(edge, new RegExp(field))
})

await test('preflight and verifier cover every role and emit the 59-row contract', () => {
  assert.match(preflight, /BEGIN TRANSACTION READ ONLY/)
  assert.match(preflight, /effective_table_select/)
  assert.match(preflight, /effective_column_select/)
  assert.match(preflight, /authenticated_invoice_source_audit/)
  for (const check of [
    'browser_raw_v2_select_privileges', 'browser_invoice_table_select_absent',
    'authenticated_safe_invoice_select_privileges', 'anon_invoice_select_privileges',
    'service_role_invoice_read_privileges', 'safe_status_rpc_service_path',
    'frontend_safe_status_source_contract',
  ]) assert.match(verification, new RegExp(check))
  assert.match(verification, /v_total <> 59 OR v_pass <> 54 OR v_review <> 5 OR v_fail <> 0/)
  assert.match(verification, /'PASS', 54::bigint/)
  assert.match(verification, /'REVIEW', 5::bigint/)
  assert.match(verification, /'FAIL', 0::bigint/)
  assert.match(releaseContract, /59 mandatory rows/)
  assert.match(releaseContract, /54 `PASS`, 5 `REVIEW`, and[\s\S]*0 `FAIL`/)
})

await test('disposable fixture proves safe, denied, service, RPC, and RLS paths', () => {
  for (const marker of [
    'DISPOSABLE_DATABASE_REQUIRED', 'SET LOCAL ROLE authenticated',
    'authenticated_safe_read_succeeds', 'authenticated_raw_read_denied',
    'authenticated_star_read_denied', 'cross_tenant_invoice_hidden',
    'SET LOCAL ROLE service_role', 'service_role_full_read_succeeds',
    'get_zatca_output_state_v2', 'output_contract_safe', 'ROLLBACK;',
  ]) assert.match(fixture, new RegExp(marker))
  assert.match(fixture, /'42501'/)
})

await test('compatibility documentation makes the schema-only no-go explicit', () => {
  assert.match(contractDoc, /schema including `04a`[\s\S]*\*\*NO-GO\*\*/)
  assert.match(releaseContract, /schema-only change[\s\S]*hard[\s\n]+no-go/i)
  assert.match(rollback, /no approved unattended schema-only window/i)
  assert.match(rollback, /Do not restore table-wide browser SELECT/i)
})

console.log(`ZATCA invoice read surface: ${results.length} deterministic checks passed`)
for (const name of results) console.log(`PASS ${name}`)
