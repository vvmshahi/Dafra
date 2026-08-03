import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = relative => fs.readFileSync(relative, 'utf8')
const schema = read('supabase/migrations/20260803000200_customer_receivables_schema_v1.sql')
const rpcs = read('supabase/migrations/20260803000300_customer_receivables_rpcs_v1.sql')
const controls = read('supabase/migrations/20260803000400_customer_receivables_controls_reports_v1.sql')
const allSql = `${schema}\n${rpcs}\n${controls}`
const panel = read('src/components/customers/CustomerReceivablesPanel.tsx')
const client = read('src/lib/customers/receivables.ts')
const receipt = read('src/pages/print/PaymentReceiptPrintPage.tsx')
const statement = read('src/pages/print/CustomerStatementPrintPage.tsx')
const reportPage = read('src/pages/reports/CustomerReceivablesReportPage.tsx')
const creditNoteModal = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const xlsx = read('src/lib/customers/receivablesXlsx.ts')
const statefulFixture = read('scripts/certify-customer-receivables-stateful.sql')
const enLocale = read('src/localization/locales/en/receivables.json')
const arLocale = read('src/localization/locales/ar-SA/receivables.json')

for (const migration of [
  'supabase/migrations/20260803000200_customer_receivables_schema_v1.sql',
  'supabase/migrations/20260803000300_customer_receivables_rpcs_v1.sql',
  'supabase/migrations/20260803000400_customer_receivables_controls_reports_v1.sql',
]) assert.ok(fs.existsSync(migration), `migration exists: ${migration}`)

const cases = [
  ['migration chain defines the receivables model', /Customer credit and accounts-receivable foundation/],
  ['schema is additive', /This migration is additive/],
  ['historical debt is not fabricated', /does not derive, rewrite, or[\s\S]*historical invoices\/payments/],
  ['receivable accounts are tenant scoped', /customer_receivable_accounts[\s\S]*tenant_id uuid NOT NULL/],
  ['credit policy has explicit limit and hold', /credit_limit numeric[\s\S]*hold boolean/],
  ['policy supports terms and overdue controls', /terms text[\s\S]*overdue_block boolean[\s\S]*warn_threshold_percent/],
  ['operations have a tenant idempotency key', /UNIQUE \(tenant_id, operation_id\)/],
  ['receipts are immutable status records', /status text NOT NULL DEFAULT 'completed'[\s\S]*reversed_at/],
  ['receipt tenders support split settlement', /method text NOT NULL CHECK \(method IN \('cash', 'card', 'bank_transfer', 'other', 'split'\)\)/],
  ['allocation rows require one source', /CHECK \(\(receipt_id IS NOT NULL AND credit_note_invoice_id IS NULL\)/],
  ['adjustments are explicit and approved', /customer_receivable_adjustments[\s\S]*approved_by uuid NOT NULL/],
  ['invoice and payment source links are ledger-backed', /source_kind, source_id[\s\S]*'invoice'/],
  ['server role matrix includes operational roles', /actor_role text[\s\S]*'owner', 'admin', 'manager', 'accountant', 'cashier', 'branch'/],
  ['scope verifies tenant and branch', /v_actor\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/],
  ['inactive customers are rejected', /AR_CUSTOMER_NOT_ACTIVE_OR_OUT_OF_SCOPE/],
  ['suspended tenants are rejected', /AR_BRANCH_NOT_ACTIVE/],
  ['operation fingerprints conflict safely', /AR_OPERATION_CONFLICT/],
  ['operations serialize with advisory locks', /pg_advisory_xact_lock\(hashtextextended\(/],
  ['credit checkout requires a customer', /AR_CHECKOUT_IDENTIFIERS_REQUIRED/],
  ['credit checkout uses the authoritative document classifier', /resolve_pos_checkout_document_internal_v1\(\s*auth\.uid\(\)/],
  ['credit checkout does not create a fiscal walk-in credit sale', /v_customer_id IS NULL/],
  ['credit checkout separates fiscal and settlement fields', /It does not alter fiscal totals, XML, QR, signature/],
  ['due date is optional internal metadata', /v_due_date := nullif\(btrim\(p_payload->>'due_date'/],
  ['aging falls back to invoice date', /coalesce\(due_date, invoice_date\)/],
  ['overdue requires an explicit due date', /due_date IS NOT NULL AND due_date < v_today/],
  ['oldest-first allocation is deterministic', /ORDER BY i\.invoice_date, i\.created_at, i\.id/],
  ['overpayment remains unapplied', /'unapplied_amount', v_remaining/],
  ['receipt reversal is a separate operation', /action <> 'payment_reversal'/],
  ['reversal preserves an immutable original receipt', /Reversal of receipt/],
  ['credit notes use the existing fiscal engine', /create_partial_credit_note\(v_base_payload\)/],
  ['credit-note settlement is idempotent and server-authoritative', /create_customer_credit_note_settlement_v1[\s\S]*AR_OPERATION_CONFLICT/],
  ['statement is a dedicated print surface', /CustomerStatementPrintPage/],
  ['statement exports a genuine workbook with frozen headers and autofilter', /zipSync[\s\S]*state="frozen"[\s\S]*autoFilter/],
  ['receipt provides 58 mm, 80 mm, and A4 print formats', /size: 58mm[\s\S]*size: 80mm[\s\S]*size: A4/],
  ['receipt documents explicitly exclude ZATCA QR', /contains no ZATCA QR code/],
  ['client financial operations persist operation identity', /kubri:ar-/],
  ['manual allocation and split tender controls use the receipt RPC', /manualAllocation[\s\S]*splitTenders[\s\S]*recordCustomerPaymentReceipt/],
  ['payment reversal is exposed only to an authorized UI capability', /canReversePayment[\s\S]*reverseCustomerPaymentReceipt/],
  ['credit-note AR settlement is explicit and keeps the normal atomic path separate', /settleWithReceivables[\s\S]*createCustomerCreditNoteSettlement[\s\S]*atomicSimplifiedCreditEligible/],
  ['receivables reporting is a dedicated scoped RPC route', /loadCustomerReceivablesReport[\s\S]*branchComparison[\s\S]*totalReceivables/],
  ['stateful certification creates and rolls back three branch fixtures', /AR branch A[\s\S]*AR branch B[\s\S]*AR branch C[\s\S]*AR_CERTIFICATION_ROLLBACK/],
  ['Arabic statement direction is supported', /dir=\{locale === 'ar-SA' \? 'rtl' : 'ltr'\}/],
]

for (const [name, pattern] of cases) {
  if (pattern instanceof RegExp) assert.match(allSql + panel + client + receipt + statement + reportPage + creditNoteModal + xlsx + statefulFixture + enLocale + arLocale, pattern, name)
  else assert.ok(pattern, name)
}

assert.doesNotMatch(controls, /INSERT\s+INTO\s+public\.invoices/i, 'controls migration must not create invoices directly')
assert.doesNotMatch(controls, /INSERT\s+INTO\s+public\.payments/i, 'controls migration must not create payments directly')
assert.doesNotMatch(client, /\.from\(['"]customer_(?:receivable|payment)/, 'client has no direct receivable table inserts')
assert.match(rpcs, /DELETE FROM public\.payments WHERE invoice_id = v_invoice_id/, 'credit bridge cleanup is scoped to its own temporary payment')
assert.match(rpcs, /SET payment_method = CASE[\s\S]*due_date = v_due_date[\s\S]*payment_status = CASE/, 'settlement updates only non-fiscal settlement state')

console.log(`customer receivables contract tests passed (${cases.length + 4} checks)`)
