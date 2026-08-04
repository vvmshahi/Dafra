import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const invoices = read('src/pages/invoices/InvoicesPage.tsx')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const a4 = read('src/components/print/A4Document.tsx')
const thermal = read('src/components/print/ThermalReceiptCompositions.tsx')
const projection = read('src/lib/invoices/customerCreditPayment.ts')
const readModel = read('src/lib/invoices/customerCreditReadModel.ts')
const receiptView = pos.match(/function ReceiptView\([\s\S]*?\n}\n\n\/\/ ── Product card/)?.[0] ?? ''

assert.match(pos, /max-w-md/, 'POS success modal should remain receipt-sized')
assert.doesNotMatch(pos, /shareWhatsApp|payments:whatsapp|onClick=\{shareWhatsApp\}/, 'POS success modal must not expose WhatsApp')
assert.doesNotMatch(pos, /demo\.noZatca|receiptLabelBilingual/, 'POS success modal must not repeat large Demo warnings')
assert.doesNotMatch(receiptView, /onOpenInvoiceStatus|pos:zatca\.viewInvoice/, 'POS success modal must not expose View invoice')
assert.match(receiptView, /w-full[\s\S]*?payments:newSale/, 'POS success modal must retain the primary New sale action')
assert.match(receiptView, /hasReceiptAction && hasInvoiceAction/, 'POS success modal should handle both print actions')
assert.match(receiptView, /hasReceiptAction \?/, 'POS success modal should handle receipt-only actions')
assert.match(receiptView, /hasInvoiceAction \?/, 'POS success modal should handle invoice-only actions')
assert.match(invoices, /credit: \{ label: 'Customer credit'/, 'Invoices must have a distinct credit payment badge')
assert.match(invoices, /partial_credit.*Customer credit/, 'Partial credit must remain visibly credit')
assert.match(invoices, /payments:customerCredit/, 'Credit payment label must use translations')
assert.match(invoices, /customer_receivable_operations/, 'Invoice list must use invoice-specific credit operations for projection')
assert.match(detail, /customerCreditPaymentSummary|customerCredit/, 'Invoice detail must render the credit read model')
assert.match(readModel, /customer_receivable_operations/, 'Credit read model must use the invoice-specific credit operation')
assert.match(readModel, /customer_payment_allocations|customer_payment_receipts|customer_payment_receipt_tenders/, 'Credit read model must include authoritative allocations and tenders')
assert.match(projection, /checkout_initial/, 'Credit projection must identify initial settlement receipts')
assert.match(projection, /creditOperations/, 'Credit projection must require an invoice-specific credit operation')
assert.match(pos, /selectedCustomerIsBusiness/, 'POS credit visibility must resolve customer type before eligibility UI')
assert.match(pos, /\{selectedCustomerIsBusiness && \(/, 'POS credit UI must be absent for Walk-in and Individual customers')
for (const key of ['customerCredit', 'paymentStatus', 'unpaid', 'partiallyPaid', 'initialPayment', 'initialPaymentMethod', 'amountPaid', 'balanceDue']) {
  assert.match(a4, new RegExp(key), `A4 should render ${key}`)
  assert.match(thermal, new RegExp(key), `Thermal should render ${key}`)
}
assert.doesNotMatch(detail, /DEMO — NOT A TAX INVOICE|sampleLabel: nonFiscalDemo/, 'Invoice detail must not render the large Demo warning')
assert.doesNotMatch(a4, /DEMO — NOT A TAX INVOICE/, 'A4 title must not render the large Demo warning')
assert.doesNotMatch(thermal, /DEMO — NOT A TAX INVOICE/, 'Thermal title must not render the large Demo warning')

console.log('Sandbox ZATCA and POS success refinement checks passed.')
