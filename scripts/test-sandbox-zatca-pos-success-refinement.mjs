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

assert.match(pos, /max-w-md/, 'POS success modal should remain receipt-sized')
assert.doesNotMatch(pos, /shareWhatsApp|payments:whatsapp|onClick=\{shareWhatsApp\}/, 'POS success modal must not expose WhatsApp')
assert.doesNotMatch(pos, /demo\.noZatca|receiptLabelBilingual/, 'POS success modal must not repeat large Demo warnings')
assert.match(pos, /t\('pos:demo\.badge'\)/, 'Demo status must use a translated concise label')
assert.match(invoices, /credit: \{ label: 'Customer credit'/, 'Invoices must have a distinct credit payment badge')
assert.match(invoices, /partial_credit.*Customer credit/, 'Partial credit must remain visibly credit')
assert.match(invoices, /payments:customerCredit/, 'Credit payment label must use translations')
assert.doesNotMatch(detail, /DEMO — NOT A TAX INVOICE|sampleLabel: nonFiscalDemo/, 'Invoice detail must not render the large Demo warning')
assert.doesNotMatch(a4, /DEMO — NOT A TAX INVOICE/, 'A4 title must not render the large Demo warning')
assert.doesNotMatch(thermal, /DEMO — NOT A TAX INVOICE/, 'Thermal title must not render the large Demo warning')

console.log('Sandbox ZATCA and POS success refinement checks passed.')
