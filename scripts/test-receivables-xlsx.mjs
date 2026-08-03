import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { buildCustomerStatementXlsx, customerStatementFilename } from '../src/lib/customers/receivablesXlsx.ts'

const workbook = buildCustomerStatementXlsx({
  customerName: 'Al Noor Wholesale',
  companyName: 'Kubri',
  branchLabel: 'Main Branch',
  locale: 'en',
  generatedAt: new Date('2026-08-03T08:00:00.000Z'),
  workspace: {
    statement: { openingBalance: 10000, closingBalance: 5000, startDate: '2026-08-01', endDate: '2026-08-03' },
    ledger: [{ id: 'entry-1', type: 'payment_receipt', sourceKind: 'payment_receipt', sourceId: 'receipt-1', branchId: 'branch-1', debit: 0, credit: 3000, effectiveAt: '2026-08-03T08:00:00.000Z', description: 'Payment receipt PR-0001', runningBalance: 5000 }],
  },
})
const files = unzipSync(workbook)
assert.ok(files['[Content_Types].xml'])
assert.ok(files['xl/workbook.xml'])
assert.ok(files['xl/styles.xml'])
assert.ok(files['xl/worksheets/sheet1.xml'])
const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
const styles = strFromU8(files['xl/styles.xml'])
assert.match(sheet, /autoFilter ref="A8:J9"/)
assert.match(sheet, /state="frozen"/)
assert.match(sheet, /Payment receipt PR-0001/)
assert.match(sheet, /t="n"><v>3000\.00<\/v>/)
assert.match(styles, /yyyy-mm-dd hh:mm/)
assert.equal(customerStatementFilename('Al Noor Wholesale', 'en', new Date('2026-08-03T00:00:00.000Z')), 'customer-statement-Al-Noor-Wholesale-2026-08-03.xlsx')

const defensiveFiles = unzipSync(buildCustomerStatementXlsx({
  customerName: '=HYPERLINK("https://example.test", "unsafe")', locale: 'en', workspace: {
    statement: { openingBalance: 0, closingBalance: 0, startDate: '2026-08-01', endDate: '2026-08-03' },
    ledger: [{ id: 'entry-unsafe', type: 'unknown', sourceKind: 'legacy', sourceId: 'legacy-1', branchId: 'branch-1', debit: 0, credit: 0, effectiveAt: 'not-a-date', description: '@unsafe formula', runningBalance: 0 }],
  },
}))
const defensiveSheet = strFromU8(defensiveFiles['xl/worksheets/sheet1.xml'])
assert.match(defensiveSheet, /\u200B=HYPERLINK/)
assert.match(defensiveSheet, /\u200B@unsafe formula/)
assert.doesNotMatch(defensiveSheet, /NaN/)
assert.match(defensiveSheet, />—<\/t>/)

const arabicFiles = unzipSync(buildCustomerStatementXlsx({
  customerName: 'النور', locale: 'ar', workspace: { statement: { openingBalance: 0, closingBalance: 0, startDate: '2026-08-01', endDate: '2026-08-03' }, ledger: [] },
}))
assert.match(strFromU8(arabicFiles['xl/worksheets/sheet1.xml']), /rightToLeft="1"/)
console.log('receivables XLSX tests passed')
