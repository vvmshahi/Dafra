import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const dashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const printing = read('src/pages/branch/PrintingDocumentsPage.tsx')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const barcodeDesigner = read('src/components/barcodes/BarcodeLabelDesigner.tsx')
const calibration = read('src/components/barcodes/BarcodePrinterSetupPanel.tsx')
const reports = read('src/pages/reports/ReportsPage.tsx')
const purchases = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
const appLayout = read('src/components/layout/AppLayout.tsx')
const expenses = read('src/pages/expenses/DailyExpensesTab.tsx')
const profile = read('src/pages/settings/AccountTab.tsx')

assert.match(dashboard, /grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4/)
assert.equal((dashboard.match(/<StatCard/g) ?? []).length, 8)
assert.match(dashboard, /border border-\[#173f2a\]/)
assert.match(dashboard, /@media\(max-height:740px\)/)
assert.match(dashboard, /data-branch-header-action-stack/)
assert.match(dashboard, /branch\.newSale/)
assert.match(dashboard, /register\.longOpenWarning[\s\S]*register\.manage/)
assert.match(dashboard, /role="region" aria-label=\{t\('recent\.title'\)\} tabIndex=\{0\}/)

assert.match(printing, /grid-cols-2[\s\S]*lg:grid-cols-4/)
assert.match(invoiceSettings, /xl:grid-cols-\[minmax\(0,0\.9fr\)_minmax\(0,1\.1fr\)\]/)
assert.match(barcodeDesigner, /h-\[clamp\(280px,48vh,460px\)\]/)
assert.match(calibration, /h-\[clamp\(300px,52vh,520px\)\]/)
assert.match(barcodeDesigner, /barcodePrintDocument/)
assert.match(calibration, /barcodePrintDocument/)

assert.match(reports, /role="region" aria-label=\{t\('tabs\.label'\)\} tabIndex=\{0\}/)
assert.match(reports, /document\.documentElement\.dir === 'rtl'/)
assert.match(reports, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/)
assert.match(reports, /flex flex-col items-stretch[\s\S]*sm:flex-row/)
assert.match(reports, /exportPhaseAReportPdf/)

assert.match(purchases, /md:hidden/)
assert.match(purchases, /hidden overflow-hidden md:block/)
for (const essential of [
  /p\.suppliers/,
  /p\.bill_number/,
  /p\.purchase_date/,
  /p\.total_amount/,
  /p\.payment_method/,
  /purchaseStatusLabel\(p\)/,
  /viewDetails\(p\)/,
  /openBillAttachment\(p\)/,
]) assert.match(purchases, essential)
assert.match(purchases, /openEdit\(p\)/)
assert.match(purchases, /openDelete\(p\)/)

assert.match(sidebar, /flex-1 px-2 py-4[\s\S]*overflow-y-auto/)
assert.match(appLayout, /px-4 py-5 sm:p-6/)
assert.match(expenses, /absolute start-3/)
assert.match(expenses, /absolute end-3/)
assert.match(profile, /absolute start-3\.5/)
assert.match(profile, /absolute end-3/)

for (const forbidden of [
  'supabase/migrations',
  '.rpc(',
  '.from(',
]) assert.doesNotMatch(barcodeDesigner, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

console.log('P2 Batch 3 responsive, short-height, RTL, table, printing, and state checks passed')
