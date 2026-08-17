import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const page = read('src/pages/invoices/InvoicesPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/invoices.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/invoices.json'))

assert.match(page, /grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4/)
assert.match(page, /min-h-\[96px\][\s\S]*sm:min-h-\[104px\]/)
assert.match(page, /mt-1\.5 text-xl font-black/)
assert.match(page, /mt-1 text-\[11px\] font-medium/)
const summaryStart = page.indexOf("<section className=\"grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4\"")
const summarySource = page.slice(summaryStart, page.indexOf('</section>', summaryStart))
const labels = [
  "t('invoices:netRevenue')",
  "t('invoices:creditNotes')",
  "t('invoices:netVat')",
  "t('invoices:documents')",
]
for (const label of labels) assert.ok(summarySource.includes(label), `${label} is required in the invoice KPI strip`)
for (let index = 1; index < labels.length; index += 1) {
  assert.ok(summarySource.indexOf(labels[index - 1]) < summarySource.indexOf(labels[index]), 'invoice KPI order must remain Net Revenue, Credit Notes, Net VAT, Documents')
}
assert.doesNotMatch(summarySource, /grossSales|Gross Sales/i)
assert.match(page, /netRevenue: 'bg-gradient-to-br from-\[#1B6B3A\] to-\[#0F2419\]'/)
assert.match(page, /creditNotes: 'bg-gradient-to-br from-\[#334155\] to-\[#1e293b\]'/)
assert.match(page, /netVat: 'bg-gradient-to-br from-\[#285e61\] to-\[#1f3f43\]'/)
assert.match(page, /documents: 'bg-gradient-to-br from-\[#334155\] to-\[#1e293b\]'/)
assert.match(page, /creditNotes: filtered\.reduce\(\(s, r\) => s \+ \(r\.documentType === 'credit_note' \? r\.totalAmount : 0\), 0\)/)
assert.match(page, /creditNoteCount: filtered\.filter\(r => r\.documentType === 'credit_note'\)\.length/)
assert.match(page, /data-invoice-compact-filters/)
assert.match(page, /documentNumber[\s\S]*beforeVat[\s\S]*zatcaStatus/)
assert.match(page, /border-\[#0B1C13\] bg-\[#173F2A\][\s\S]*text-\[#FFF8E7\]/)
assert.match(page, /isCreditNote \? 'bg-amber-50\/25' : ''/)
for (const locale of [en, ar]) {
  for (const key of ['netRevenue', 'creditNotes', 'netVat', 'documents', 'creditNotesCount_other']) {
    assert.equal(typeof locale[key], 'string', `missing localized ${key}`)
  }
}

console.log('Invoice summary visual contract passed')
