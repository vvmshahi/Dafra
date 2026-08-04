import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const detail = read('src/pages/customers/CustomerDetailPage.tsx')
const panel = read('src/components/customers/CustomerReceivablesPanel.tsx')
const report = read('src/pages/reports/CustomerReceivablesReportPage.tsx')
const metrics = read('src/components/ui/WorkspaceMetric.tsx')
const filters = read('src/components/ui/FilterPanel.tsx')

assert.match(detail, /className="order-1" aria-labelledby="customer-summary-title"/)
assert.match(detail, /className="order-2 flex items-center/)
assert.match(detail, /order-3 card overflow-hidden.*history-title/s)
assert.match(detail, /bg-\[#173d2a\].*history-title/s)
assert.match(panel, /role="dialog" aria-modal="true"/)
assert.match(panel, /receive-payment-title/)
assert.match(panel, /fixed inset-0 z-50/)
assert.match(panel, /bg-\[#173d2a\].*receive-payment-title/s)
assert.match(panel, /hidden mt-3 flex-wrap items-center/)
assert.match(panel, /rounded-t-2xl bg-\[#173d2a\].*ledger\.title/s)
assert.match(report, /className="order-1 mx-auto w-fit max-w-full"/)
assert.match(report, /className="order-3 space-y-2"/)
assert.match(report, /tone="debt"/)
assert.match(report, /rounded-t-xl bg-\[#173d2a\].*credit-customers-heading/s)
assert.match(report, /rounded-t-xl bg-\[#173d2a\].*credit-payments-heading/s)
assert.match(metrics, /debt:/)
assert.match(filters, /compact\?: boolean/)

console.log('Customer Credit visual consistency contract passed')
