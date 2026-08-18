import {
  loadExpenseExport, loadProfitEstimateExport, loadPurchaseExport, loadRegisterSessionsExport, loadSalesExport, loadVatSupportExport,
  type ReportExportParams,
} from '../pdf/reportExportData'
import { formatDateTimePdf, formatMonthPdf, numberOrZero } from '../pdf/reportPdfTheme'

export type ReportCsvKind = 'sessions' | 'sales' | 'pl' | 'vat' | 'expenses' | 'purchases'

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function decimal(value: unknown): string {
  return numberOrZero(value).toFixed(2)
}

function downloadCsv(fileName: string, rows: unknown[][]) {
  const csv = `\uFEFF${rows.map(row => row.map(escapeCsv).join(',')).join('\r\n')}\r\n`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}

export async function exportReportCsv(input: ReportExportParams & { reportKind: ReportCsvKind }): Promise<void> {
  const fileName = `kubri-${({ sessions: 'register-sessions', sales: 'sales', pl: 'profit-estimate', vat: 'vat-support', expenses: 'expenses', purchases: 'purchases' } as const)[input.reportKind]}-${input.startDate}-to-${input.endDate}.csv`
  if (input.reportKind === 'sessions') {
    const sessions = await loadRegisterSessionsExport(input)
    downloadCsv(fileName, [['Session status', 'Opened at', 'Closed at', 'Gross sales', 'Credit notes', 'Net sales', 'Invoice count', 'Cash', 'Card', 'Bank transfer', 'Other', 'Net VAT', 'Expenses', 'Opening cash', 'Expected cash', 'Actual cash', 'Difference'], ...sessions.map(s => [s.status, formatDateTimePdf(s.openedAt), s.closedAt ? formatDateTimePdf(s.closedAt) : '', decimal(s.totalSales), decimal(s.creditNoteTotal), decimal(s.totalSales - s.creditNoteTotal), s.invoiceCount, decimal(s.cashTotal), decimal(s.cardTotal), '', '', decimal(s.vatTotal), decimal(s.expensesTotal), decimal(s.openingCash), decimal(s.expectedCash), s.actualCash === null ? '' : decimal(s.actualCash), s.cashDifference === null ? '' : decimal(s.cashDifference)])])
    return
  }
  if (input.reportKind === 'sales') {
    const data = await loadSalesExport(input)
    downloadCsv(fileName, [['Date', 'Net sales', 'Documents'], ...data.dailySales.map(row => [row.date, decimal(row.revenue), row.invoices])])
    return
  }
  if (input.reportKind === 'vat') {
    const data = await loadVatSupportExport(input)
    downloadCsv(fileName, [['Month', 'Sales', 'Output VAT', 'Credited VAT', 'Purchase input VAT', 'Expense input VAT', 'Net VAT estimate'], ...data.monthlyRows.map(row => [formatMonthPdf(row.month), decimal(row.salesAmount), decimal(row.vatOnSales), decimal(row.vatCredited), decimal(row.vatPaidPur), decimal(row.vatPaidExp), decimal(row.netPayable)])])
    return
  }
  if (input.reportKind === 'pl') {
    const data = await loadProfitEstimateExport(input)
    downloadCsv(fileName, [['Month', 'Gross sales', 'Credit notes', 'Net sales', 'COGS', 'Gross profit', 'Expenses', 'Net profit'], ...data.monthlyRows.map(row => [formatMonthPdf(row.month), decimal(row.grossSales), decimal(row.creditNotes), decimal(row.revenue), decimal(row.cogs), decimal(row.grossProfit), decimal(row.expenses), decimal(row.netProfit)])])
    return
  }
  if (input.reportKind === 'expenses') {
    const data = await loadExpenseExport(input)
    downloadCsv(fileName, [['Date', 'Description', 'Category', 'Payment method', 'Amount'], ...data.log.map(row => [row.date, row.description, row.category, row.method, decimal(row.amount)])])
    return
  }
  const data = await loadPurchaseExport(input)
  downloadCsv(fileName, [['Supplier', 'Purchase count', 'Total purchased', 'Last purchase date'], ...data.bySupplier.map(row => [row.name, row.count, decimal(row.total), row.lastDate ?? ''])])
}
