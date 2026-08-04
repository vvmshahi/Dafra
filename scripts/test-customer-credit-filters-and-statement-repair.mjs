import fs from 'node:fs'

const report = fs.readFileSync('src/pages/reports/CustomerReceivablesReportPage.tsx', 'utf8')
const panel = fs.readFileSync('src/components/customers/CustomerReceivablesPanel.tsx', 'utf8')
const detail = fs.readFileSync('src/pages/customers/CustomerDetailPage.tsx', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260804000100_customer_receivables_balance_as_of.sql', 'utf8')
const en = JSON.parse(fs.readFileSync('src/localization/locales/en/receivables.json', 'utf8'))
const ar = JSON.parse(fs.readFileSync('src/localization/locales/ar-SA/receivables.json', 'utf8'))

for (const token of ['balanceAsOf', 'activityPeriod', 'paymentMethod', 'paymentStatus', 'statementAction', 'openPayment', 'asOfDate']) {
  if (!(report.includes(token) || panel.includes(token) || detail.includes(token) || migration.includes(token))) throw new Error(`missing contract token: ${token}`)
}
if (!report.includes('loadCustomerReceivableWorkspace') || !report.includes('summary.totalInvoiced')) throw new Error('customer table is not mapped from authoritative workspace data')
if (report.includes('Back to reports') || report.includes('/print/customer-statement/')) throw new Error('report page retains a divergent statement entry point')
if (!migration.includes("e.effective_at < (v_as_of_date + 1)::timestamptz") || !migration.includes("'asOfDate', v_as_of_date")) throw new Error('as-of cutoff is not server enforced')
if (migration.includes('INSERT ') || migration.includes('UPDATE ') || migration.includes('DELETE ')) throw new Error('read-only migration contains a row mutation')
if (en.report.totalReceivables !== 'Balance due' || en.report.customerCredit !== 'Credit sales' || ar.report.totalReceivables !== 'الرصيد المستحق') throw new Error('KPI terminology regression')
console.log('Customer Credit filters and shared statement contract: PASS')
