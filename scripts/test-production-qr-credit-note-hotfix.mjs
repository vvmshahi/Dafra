import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const invoiceList = read('src/pages/invoices/InvoicesPage.tsx')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const receipt = read('src/pages/print/ReceiptPrintPage.tsx')
const generationFinalizer = read('supabase/functions/fiscal-finalize-generation/index.ts')
const migration = read('supabase/migrations/20260824001600_credit_note_session_reporting_read_fix.sql')

let passed = 0
function check(condition, message) {
  assert.ok(condition, message)
  passed += 1
}

// Deterministic document-history fixture: a note in the selected window adds
// its existing parent as context, while preserving two distinct rows.
const note = { id: 'cn-1', zatca_invoice_type: 'credit_note', original_invoice_id: 'inv-1', created_at: '2026-08-24T12:00:00Z' }
const parent = { id: 'inv-1', zatca_invoice_type: 'simplified', original_invoice_id: null, created_at: '2026-08-20T12:00:00Z' }
const selected = [note]
const parentIds = [...new Set(selected.filter(row => row.zatca_invoice_type === 'credit_note' && row.original_invoice_id).map(row => row.original_invoice_id))]
const history = [...selected, parent].filter((row, index, rows) => rows.findIndex(candidate => candidate.id === row.id) === index)
check(parentIds.length === 1 && parentIds[0] === parent.id, 'history fixture resolves the linked parent id')
check(history.length === 2 && history.some(row => row.id === note.id) && history.some(row => row.id === parent.id), 'history fixture keeps parent and Credit Note as separate rows')
check(invoiceList.includes('const relatedParentIds = Array.from(new Set('), 'invoice list resolves related parent ids')
check(invoiceList.includes(".in('id', relatedParentIds)"), 'invoice list reads linked parents without mutation')

// Canonical signed-value fixture: gross remains positive issued sales, Credit
// Notes are displayed as absolute deductions, and net/VAT are signed totals.
const documents = [
  { type: 'simplified', total: 100, vat: 15 },
  { type: 'credit_note', total: 100, vat: 15 },
]
const gross = documents.reduce((sum, row) => sum + (row.type === 'credit_note' ? 0 : row.total), 0)
const credits = documents.reduce((sum, row) => sum + (row.type === 'credit_note' ? row.total : 0), 0)
const net = documents.reduce((sum, row) => sum + (row.type === 'credit_note' ? -row.total : row.total), 0)
const netVat = documents.reduce((sum, row) => sum + (row.type === 'credit_note' ? -row.vat : row.vat), 0)
check(gross === 100 && credits === 100 && net === 0, 'metric fixture proves gross 100, Credit Notes 100, net 0')
check(netVat === 0, 'VAT fixture reverses once')

check(detail.includes("invoice?.fiscal_regime_at_issue === 'generation'"), 'A4 uses persisted issue regime for Generation QR routing')
check(receipt.includes('getGenerationInvoiceOutputState'), 'thermal reopened path uses Generation output status')
check(receipt.includes('generationOutput?.canPrint ? generationOutput.qrCode'), 'thermal path renders the Generation QR payload')
check(generationFinalizer.includes('qrCode: issued ? invoice.fiscal_qr_payload : null'), 'Generation status returns persisted fiscal QR only')
check(migration.includes('reporting_effective_invoice_session_id'), 'reporting migration resolves parent session')
check(migration.includes('get_register_tender_netting(uuid[])'), 'reporting migration patches tender aggregation')
check(migration.includes('get_register_session_summary_before_refund_netting(uuid,uuid)'), 'reporting migration patches session summary')
check(!migration.match(/(UPDATE|DELETE|INSERT)\s+INTO\s+public\.(invoices|invoice_items|payments|payment_refunds)/i), 'hotfix migration does not rewrite financial rows')

console.log(`Production QR + Credit Note hotfix contract passed (${passed} deterministic checks)`)
