import type { Branch, Tenant, UserProfile } from '@/types'
import type { RegisterSessionSummary } from '@/lib/registerSessions'
import {
  addAutoTable,
  addCompactMessage,
  addFinalNotes,
  addKpiGrid,
  addSectionTitle,
  createReportDoc,
  saveReportDoc,
  type PdfKpi,
} from './reportPdfLayout'
import {
  buildReportPdfContext,
  formatCurrencyAmountPdf,
  formatCurrencyPdf,
  formatDatePdf,
  formatDateTimePdf,
  formatMonthPdf,
  formatNumberPdf,
  formatPercentPdf,
  formatSignedImpactPdf,
  numberOrZero,
  safePdfText,
  type ReportPdfContext,
  type ReportPdfKind,
} from './reportPdfTheme'
import {
  countClosedCashValues,
  loadProfitEstimateExport,
  loadRegisterSessionsExport,
  loadSalesExport,
  loadVatSupportExport,
  sumRegisterSessionField,
  type ProfitEstimateExportData,
  type ReportExportParams,
  type SalesExportData,
  type VatSupportExportData,
  type VatMonthRow,
} from './reportExportData'

export type PhaseAReportKind = ReportPdfKind

interface PhaseAReportMeta {
  title: string
  slug: string
}

interface ExportPhaseAReportPdfInput extends ReportExportParams {
  reportKind: PhaseAReportKind
  tenant: Tenant | null
  branch: Branch | null
  profile: UserProfile | null
  branchLabel?: string | null
}

const REPORT_META: Record<PhaseAReportKind, PhaseAReportMeta> = {
  sessions: {
    title: 'Register Sessions Report',
    slug: 'register-sessions',
  },
  sales: {
    title: 'Sales Report',
    slug: 'sales-report',
  },
  vat: {
    title: 'VAT Support Report',
    slug: 'vat-support',
  },
  pl: {
    title: 'Profit Estimate Report',
    slug: 'profit-estimate',
  },
}

function statusLabel(session: RegisterSessionSummary): string {
  if (session.isLongOpen) return 'Long open'
  if (session.status === 'open') return 'Open'
  if (session.status === 'closed') return 'Closed'
  return '-'
}

function amountCell(value: unknown): string {
  return formatCurrencyAmountPdf(value)
}

function paymentValue(data: SalesExportData, label: string): number {
  return data.byMethod.find(row => row.name.toLowerCase() === label.toLowerCase())?.value ?? 0
}

function vatImpactLabel(value: number): string {
  return value >= 0 ? 'Net VAT Payable Estimate' : 'Net VAT Credit Estimate'
}

function vatImpactSub(value: number): string {
  return value >= 0 ? 'separate VAT provision' : 'credit/refund estimate'
}

function createContext(input: ExportPhaseAReportPdfInput): ReportPdfContext {
  const meta = REPORT_META[input.reportKind]
  return buildReportPdfContext({
    reportKind: input.reportKind,
    reportTitle: meta.title,
    reportSlug: meta.slug,
    startDate: input.startDate,
    endDate: input.endDate,
    tenant: input.tenant,
    branch: input.branch,
    profile: input.profile,
    branchLabel: input.branchLabel,
  })
}

async function exportRegisterSessionsPdf(context: ReportPdfContext, sessions: RegisterSessionSummary[]) {
  const { doc, y } = await createReportDoc(context)
  const actualCashCount = countClosedCashValues(sessions)
  const hasActualCash = actualCashCount > 0

  const kpis: PdfKpi[] = [
    { label: 'Total sessions', value: formatNumberPdf(sessions.length), tone: 'green' },
    { label: 'Total sales', value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'totalSales')), tone: 'gold' },
    { label: 'Invoices', value: formatNumberPdf(sumRegisterSessionField(sessions, 'invoiceCount')), tone: 'blue' },
    { label: 'Cash', value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'cashTotal')), tone: 'teal' },
    { label: 'Card', value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'cardTotal')), tone: 'slate' },
    { label: 'VAT', value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'vatTotal')), tone: 'amber' },
    { label: 'Credit notes', value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'creditNoteTotal')), tone: 'slate' },
    { label: 'Expenses', value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'expensesTotal')), tone: 'amber' },
    { label: 'Expected cash', value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'expectedCash')), tone: 'green' },
    {
      label: 'Actual cash',
      value: hasActualCash ? formatCurrencyPdf(sumRegisterSessionField(sessions, 'actualCash')) : '-',
      sub: hasActualCash ? `${actualCashCount} closed sessions` : 'closed sessions only',
      tone: 'teal',
    },
    {
      label: 'Cash difference',
      value: hasActualCash ? formatCurrencyPdf(sumRegisterSessionField(sessions, 'cashDifference')) : '-',
      sub: 'actual minus expected',
      tone: 'blue',
    },
  ]

  let nextY = addSectionTitle(doc, context, y, 'Summary')
  nextY = addKpiGrid(doc, context, nextY, kpis)

  if (sessions.length === 0) {
    addCompactMessage(doc, context, nextY, 'No register sessions found for this period.')
    saveReportDoc(doc, context)
    return
  }

  nextY = addSectionTitle(doc, context, nextY, 'Sessions', 'Amounts in SAR.')
  nextY = addAutoTable(doc, context, {
    startY: nextY,
    fontSize: 6.1,
    head: [
      'Status',
      'Opened',
      'Closed',
      'Sales',
      'Inv.',
      'Cash',
      'Card',
      'VAT',
      'Credit',
      'Exp.',
      'Expected',
      'Actual',
      'Diff.',
    ],
    body: sessions.map(session => [
      statusLabel(session),
      formatDateTimePdf(session.openedAt),
      session.closedAt ? formatDateTimePdf(session.closedAt) : '-',
      amountCell(session.totalSales),
      formatNumberPdf(session.invoiceCount),
      amountCell(session.cashTotal),
      amountCell(session.cardTotal),
      amountCell(session.vatTotal),
      amountCell(session.creditNoteTotal),
      amountCell(session.expensesTotal),
      amountCell(session.expectedCash),
      session.actualCash === null ? '-' : amountCell(session.actualCash),
      session.cashDifference === null ? '-' : amountCell(session.cashDifference),
    ]),
    foot: [
      'Total',
      '',
      '',
      amountCell(sumRegisterSessionField(sessions, 'totalSales')),
      formatNumberPdf(sumRegisterSessionField(sessions, 'invoiceCount')),
      amountCell(sumRegisterSessionField(sessions, 'cashTotal')),
      amountCell(sumRegisterSessionField(sessions, 'cardTotal')),
      amountCell(sumRegisterSessionField(sessions, 'vatTotal')),
      amountCell(sumRegisterSessionField(sessions, 'creditNoteTotal')),
      amountCell(sumRegisterSessionField(sessions, 'expensesTotal')),
      amountCell(sumRegisterSessionField(sessions, 'expectedCash')),
      hasActualCash ? amountCell(sumRegisterSessionField(sessions, 'actualCash')) : '-',
      hasActualCash ? amountCell(sumRegisterSessionField(sessions, 'cashDifference')) : '-',
    ],
    columnStyles: {
      0: { cellWidth: 14 },
      1: { cellWidth: 22 },
      2: { cellWidth: 22 },
      4: { cellWidth: 8, halign: 'right' },
      3: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
      11: { halign: 'right' },
      12: { halign: 'right' },
    },
  })

  addFinalNotes(doc, context, nextY, [
    'Register session totals use the current backend session summary data for the selected period.',
  ])
  saveReportDoc(doc, context)
}

async function exportVatSupportPdf(context: ReportPdfContext, data: VatSupportExportData) {
  const { doc, y } = await createReportDoc(context)
  const purchaseInputVat = data.monthlyRows.reduce((sum, row) => sum + numberOrZero(row.vatPaidPur), 0)
  const expenseInputVat = data.monthlyRows.reduce((sum, row) => sum + numberOrZero(row.vatPaidExp), 0)

  const kpis: PdfKpi[] = [
    { label: 'Output VAT', value: formatCurrencyPdf(data.vatOnSales), sub: 'VAT before credit notes', tone: 'green' },
    { label: 'VAT credited', value: formatCurrencyPdf(data.vatCredited), sub: 'VAT reduced by returns', tone: 'slate' },
    { label: 'Net VAT on sales', value: formatCurrencyPdf(data.vatCollected), sub: 'output minus credited VAT', tone: 'teal' },
    { label: 'Input VAT support', value: formatCurrencyPdf(data.vatPaidTotal), sub: 'claimable purchases + expenses', tone: 'blue' },
    {
      label: vatImpactLabel(data.netPayable),
      value: formatCurrencyPdf(Math.abs(data.netPayable)),
      sub: vatImpactSub(data.netPayable),
      tone: 'gold',
    },
  ]

  let nextY = addSectionTitle(doc, context, y, 'Summary')
  nextY = addKpiGrid(doc, context, nextY, kpis)

  if (data.monthlyRows.length === 0) {
    nextY = addCompactMessage(doc, context, nextY, 'No VAT rows found for this period.')
    addFinalNotes(doc, context, nextY, [
      'This report is for VAT support and accountant review. Please verify before filing.',
    ])
    saveReportDoc(doc, context)
    return
  }

  nextY = addSectionTitle(doc, context, nextY, 'Monthly VAT Breakdown', 'Amounts in SAR.')
  nextY = addAutoTable(doc, context, {
    startY: nextY,
    fontSize: 6.8,
    head: [
      'Month',
      'Sales',
      'Output VAT',
      'VAT credited',
      'Purchase input',
      'Expense input',
      'Net VAT est.',
    ],
    body: data.monthlyRows.map(row => [
      formatMonthPdf(row.month),
      amountCell(row.salesAmount),
      amountCell(row.vatOnSales),
      amountCell(row.vatCredited),
      amountCell(row.vatPaidPur),
      amountCell(row.vatPaidExp),
      formatSignedImpactPdf(row.netPayable),
    ]),
    foot: [
      'Total',
      amountCell(data.salesTotal),
      amountCell(data.vatOnSales),
      amountCell(data.vatCredited),
      amountCell(purchaseInputVat),
      amountCell(expenseInputVat),
      formatSignedImpactPdf(data.netPayable),
    ],
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
  })

  addFinalNotes(doc, context, nextY, [
    'This report is for VAT support and accountant review. Please verify before filing.',
  ])
  saveReportDoc(doc, context)
}

async function exportSalesPdf(context: ReportPdfContext, data: SalesExportData) {
  const { doc, y } = await createReportDoc(context)
  const otherPayments = data.byMethod
    .filter(row => !['cash', 'card'].includes(row.name.toLowerCase()))
    .reduce((sum, row) => sum + numberOrZero(row.value), 0)

  const kpis: PdfKpi[] = [
    { label: 'Gross Sales', value: formatCurrencyPdf(data.grossSales), tone: 'green' },
    { label: 'Credit Notes', value: formatCurrencyPdf(data.creditNotes), tone: 'slate' },
    { label: 'Net Sales', value: formatCurrencyPdf(data.totalRevenue), tone: 'gold' },
    { label: 'VAT', value: formatCurrencyPdf(data.vatCollected), sub: `sales ${formatCurrencyPdf(data.vatOnSales)} | credited ${formatCurrencyPdf(data.vatCredited)}`, tone: 'amber' },
    { label: 'Documents', value: formatNumberPdf(data.invoiceCount), sub: 'non-cancelled', tone: 'blue' },
    { label: 'Average Sale', value: formatCurrencyPdf(data.avgOrderValue), tone: 'teal' },
    { label: 'Cash', value: formatCurrencyPdf(paymentValue(data, 'Cash')), tone: 'green' },
    { label: 'Card', value: formatCurrencyPdf(paymentValue(data, 'Card')), tone: 'blue' },
    { label: 'Other payments', value: formatCurrencyPdf(otherPayments), tone: 'slate' },
  ]

  let nextY = addSectionTitle(doc, context, y, 'Summary')
  nextY = addKpiGrid(doc, context, nextY, kpis)

  if (data.dailySales.length > 0) {
    nextY = addSectionTitle(doc, context, nextY, 'Daily Sales', 'Amounts in SAR.')
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: ['Date', 'Revenue', 'Invoices'],
      body: data.dailySales.map(row => [
        formatDatePdf(`${row.date}T00:00:00+03:00`),
        amountCell(row.revenue),
        formatNumberPdf(row.invoices),
      ]),
      foot: [
        'Total',
        amountCell(data.dailySales.reduce((sum, row) => sum + numberOrZero(row.revenue), 0)),
        formatNumberPdf(data.dailySales.reduce((sum, row) => sum + numberOrZero(row.invoices), 0)),
      ],
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
      },
    })
  }

  if (data.byMethod.length > 0) {
    nextY = addSectionTitle(doc, context, nextY, 'Payment Method Breakdown', 'Amounts in SAR.')
    const totalPayments = data.byMethod.reduce((sum, row) => sum + numberOrZero(row.value), 0)
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: ['Method', 'Amount', 'Share'],
      body: data.byMethod.map(row => [
        safePdfText(row.name, 'Other'),
        amountCell(row.value),
        formatPercentPdf(totalPayments !== 0 ? (numberOrZero(row.value) / totalPayments) * 100 : 0),
      ]),
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
      },
    })
  }

  if (data.topProducts.length > 0) {
    nextY = addSectionTitle(doc, context, nextY, 'Top Products', 'By revenue. Amounts in SAR.')
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: ['Product', 'Qty', 'Revenue', 'Share'],
      body: data.topProducts.map(row => [
        safePdfText(row.name, 'Product'),
        formatNumberPdf(row.quantity, 2),
        amountCell(row.revenue),
        formatPercentPdf(row.pct),
      ]),
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
    })
  }

  if (data.catPerformance.length > 0) {
    nextY = addSectionTitle(doc, context, nextY, 'Category Performance', 'Amounts in SAR.')
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: ['Category', 'Items', 'Revenue', 'Share'],
      body: data.catPerformance.map(row => [
        safePdfText(row.name, 'Category'),
        formatNumberPdf(row.items, 2),
        amountCell(row.revenue),
        formatPercentPdf(row.pct),
      ]),
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
    })
  }

  if (
    data.dailySales.length === 0
    && data.byMethod.length === 0
    && data.topProducts.length === 0
    && data.catPerformance.length === 0
  ) {
    nextY = addCompactMessage(doc, context, nextY, 'No sales details found for this period.')
  }

  addFinalNotes(doc, context, nextY, [
    'Sales totals use posted, counted invoice documents from the existing reporting summary.',
    'Credit notes reduce net sales and VAT according to the backend reporting rules.',
  ])
  saveReportDoc(doc, context)
}

function monthlyVatByMonth(vatData: VatSupportExportData): Map<string, VatMonthRow> {
  return new Map(vatData.monthlyRows.map(row => [row.month, row]))
}

async function exportProfitEstimatePdf(context: ReportPdfContext, data: ProfitEstimateExportData, vatData: VatSupportExportData) {
  const { doc, y } = await createReportDoc(context)
  const estimatedSalesExVat = data.totalRevenue - vatData.vatCollected
  const totalOperatingCosts = data.totalCOGS + data.totalExpenses
  const estimatedBusinessProfit = estimatedSalesExVat - totalOperatingCosts
  const estimatedMargin = estimatedSalesExVat !== 0 ? (estimatedBusinessProfit / estimatedSalesExVat) * 100 : 0
  const netVatEstimate = vatData.netPayable
  const cashAfterVatProvision = estimatedBusinessProfit - netVatEstimate

  const salesKpis: PdfKpi[] = [
    { label: 'Net sales incl. VAT', value: formatCurrencyPdf(data.totalRevenue), tone: 'green' },
    { label: 'Net VAT on sales', value: formatCurrencyPdf(vatData.vatCollected), tone: 'amber' },
    { label: 'Estimated sales excl. VAT', value: formatCurrencyPdf(estimatedSalesExVat), tone: 'gold' },
  ]
  const costKpis: PdfKpi[] = [
    { label: 'Purchases / materials excl. VAT', value: formatCurrencyPdf(data.totalCOGS), tone: 'teal' },
    { label: 'Expenses excl. VAT', value: formatCurrencyPdf(data.totalExpenses), tone: 'slate' },
    { label: 'Total operating costs excl. VAT', value: formatCurrencyPdf(totalOperatingCosts), tone: 'amber' },
  ]
  const profitKpis: PdfKpi[] = [
    { label: 'Estimated Business Profit', value: formatCurrencyPdf(estimatedBusinessProfit), tone: 'green' },
    { label: 'Estimated Margin', value: formatPercentPdf(estimatedMargin), tone: 'blue' },
  ]
  const vatKpis: PdfKpi[] = [
    { label: 'Output VAT', value: formatCurrencyPdf(vatData.vatOnSales), tone: 'amber' },
    { label: 'Input VAT Support', value: formatCurrencyPdf(vatData.vatPaidTotal), tone: 'teal' },
    {
      label: vatImpactLabel(netVatEstimate),
      value: formatCurrencyPdf(Math.abs(netVatEstimate)),
      sub: vatImpactSub(netVatEstimate),
      tone: 'gold',
    },
  ]
  const ownerKpis: PdfKpi[] = [
    {
      label: 'Estimated Cash After VAT Provision',
      value: formatCurrencyPdf(cashAfterVatProvision),
      sub: netVatEstimate >= 0 ? 'business profit minus VAT payable' : 'business profit plus VAT credit',
      tone: 'gold',
    },
  ]

  let nextY = addSectionTitle(doc, context, y, 'Sales & VAT Summary')
  nextY = addKpiGrid(doc, context, nextY, salesKpis)
  nextY = addSectionTitle(doc, context, nextY, 'Cost Summary')
  nextY = addKpiGrid(doc, context, nextY, costKpis)
  nextY = addSectionTitle(doc, context, nextY, 'Business Profit Estimate')
  nextY = addKpiGrid(doc, context, nextY, profitKpis)
  nextY = addSectionTitle(doc, context, nextY, 'VAT Provision')
  nextY = addKpiGrid(doc, context, nextY, vatKpis)
  nextY = addSectionTitle(doc, context, nextY, 'Owner Cash View')
  nextY = addKpiGrid(doc, context, nextY, ownerKpis)

  if (data.monthlyRows.length === 0) {
    nextY = addCompactMessage(doc, context, nextY, 'No profit estimate rows found for this period.')
    addFinalNotes(doc, context, nextY, [
      'This is a management estimate based on current reporting data. It is not an audited Profit & Loss statement.',
      'VAT payable is shown separately as a provision, not as a normal operating expense.',
    ])
    saveReportDoc(doc, context)
    return
  }

  const vatRowsByMonth = monthlyVatByMonth(vatData)

  nextY = addSectionTitle(doc, context, nextY, 'Monthly Owner View', 'Amounts in SAR. VAT provision uses matching monthly VAT support rows when available.')
  nextY = addAutoTable(doc, context, {
    startY: nextY,
    fontSize: 6.2,
    head: [
      'Month',
      'Sales incl. VAT',
      'Est. sales excl. VAT',
      'Purchases',
      'Expenses',
      'Est. business profit',
      'VAT provision',
      'Est. cash after VAT',
    ],
    body: data.monthlyRows.map(row => {
      const vatRow = vatRowsByMonth.get(row.month)
      const monthSalesExVat = row.revenue - numberOrZero(vatRow?.vatCollected)
      const monthBusinessProfit = monthSalesExVat - row.cogs - row.expenses
      const monthVatProvision = numberOrZero(vatRow?.netPayable)
      const monthCashAfterVat = monthBusinessProfit - monthVatProvision

      return [
        formatMonthPdf(row.month),
        amountCell(row.revenue),
        amountCell(monthSalesExVat),
        amountCell(row.cogs),
        amountCell(row.expenses),
        amountCell(monthBusinessProfit),
        formatSignedImpactPdf(monthVatProvision),
        amountCell(monthCashAfterVat),
      ]
    }),
    foot: [
      'Total',
      amountCell(data.totalRevenue),
      amountCell(estimatedSalesExVat),
      amountCell(data.totalCOGS),
      amountCell(data.totalExpenses),
      amountCell(estimatedBusinessProfit),
      formatSignedImpactPdf(netVatEstimate),
      amountCell(cashAfterVatProvision),
    ],
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
  })

  addFinalNotes(doc, context, nextY, [
    'This is a management estimate based on current reporting data. It is not an audited Profit & Loss statement.',
    'VAT payable is shown separately as a provision, not as a normal operating expense.',
    'Sales figures include VAT unless explicitly shown as estimated sales excluding VAT.',
  ])
  saveReportDoc(doc, context)
}

export async function exportPhaseAReportPdf(input: ExportPhaseAReportPdfInput): Promise<void> {
  const context = createContext(input)

  if (input.reportKind === 'sessions') {
    const sessions = await loadRegisterSessionsExport(input)
    await exportRegisterSessionsPdf(context, sessions)
    return
  }

  if (input.reportKind === 'sales') {
    const data = await loadSalesExport(input)
    await exportSalesPdf(context, data)
    return
  }

  if (input.reportKind === 'vat') {
    const data = await loadVatSupportExport(input)
    await exportVatSupportPdf(context, data)
    return
  }

  const [profitData, vatData] = await Promise.all([
    loadProfitEstimateExport(input),
    loadVatSupportExport(input),
  ])
  await exportProfitEstimatePdf(context, profitData, vatData)
}

function errorFields(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return [record.code, record.message, record.details, record.hint]
      .filter(value => typeof value === 'string' && value.trim())
      .join(' ')
  }

  return error instanceof Error ? error.message : String(error ?? '')
}

export function reportPdfErrorMessage(error: unknown): string {
  const combined = errorFields(error)

  if (/PGRST202|PGRST204|schema cache|could not find the function|function .* not found/i.test(combined)) {
    return 'Report export is not ready. Please refresh after the latest database update.'
  }

  if (/unauthorized|permission|42501|jwt|session/i.test(combined)) {
    return 'Your session or report permissions could not be verified. Refresh or sign in again.'
  }

  if (/22023|invalid report date range|invalid/i.test(combined)) {
    return 'Choose a valid date range and try again.'
  }

  return 'PDF export failed. Please refresh and try again.'
}
