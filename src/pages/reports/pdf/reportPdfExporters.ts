import type { Branch, Tenant, UserProfile } from '@/types'
import i18n from '@/localization/i18n'
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
const pt = (key: string, options?: Record<string, unknown>) => i18n.t(`reports:pdf.${key}`, options)

interface PhaseAReportMeta {
  titleKey: string
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
    titleKey: 'reports:pdf.sessions.title',
    slug: 'register-sessions',
  },
  sales: {
    titleKey: 'reports:pdf.sales.title',
    slug: 'sales-report',
  },
  vat: {
    titleKey: 'reports:pdf.vat.title',
    slug: 'vat-support',
  },
  pl: {
    titleKey: 'reports:pdf.profit.title',
    slug: 'profit-estimate',
  },
}

function statusLabel(session: RegisterSessionSummary): string {
  if (session.isLongOpen) return i18n.t('reports:status.open')
  if (session.status === 'open') return i18n.t('reports:status.open')
  if (session.status === 'closed') return i18n.t('reports:status.closed')
  return '-'
}

function amountCell(value: unknown): string {
  return formatCurrencyAmountPdf(value)
}

function paymentValue(data: SalesExportData, label: string): number {
  return data.byMethod.find(row => row.name.toLowerCase() === label.toLowerCase())?.value ?? 0
}

function vatImpactLabel(value: number): string {
  return pt(value >= 0 ? 'vat.payableEstimate' : 'vat.creditEstimate')
}

function vatImpactSub(value: number): string {
  return pt(value >= 0 ? 'vat.payableSub' : 'vat.creditSub')
}

function createContext(input: ExportPhaseAReportPdfInput): ReportPdfContext {
  const meta = REPORT_META[input.reportKind]
  return buildReportPdfContext({
    reportKind: input.reportKind,
    reportTitle: i18n.t(meta.titleKey),
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
    { label: pt('sessions.totalSessions'), value: formatNumberPdf(sessions.length), tone: 'green' },
    { label: pt('sessions.totalSales'), value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'totalSales')), tone: 'gold' },
    { label: pt('common.invoices'), value: formatNumberPdf(sumRegisterSessionField(sessions, 'invoiceCount')), tone: 'blue' },
    { label: pt('common.cash'), value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'cashTotal')), tone: 'teal' },
    { label: pt('common.card'), value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'cardTotal')), tone: 'slate' },
    { label: pt('common.vat'), value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'vatTotal')), tone: 'amber' },
    { label: pt('sessions.creditNotes'), value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'creditNoteTotal')), tone: 'slate' },
    { label: pt('common.expenses'), value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'expensesTotal')), tone: 'amber' },
    { label: pt('sessions.expectedCash'), value: formatCurrencyPdf(sumRegisterSessionField(sessions, 'expectedCash')), tone: 'green' },
    {
      label: pt('sessions.actualCash'),
      value: hasActualCash ? formatCurrencyPdf(sumRegisterSessionField(sessions, 'actualCash')) : '-',
      sub: hasActualCash ? `${actualCashCount} closed sessions` : 'closed sessions only',
      tone: 'teal',
    },
    {
      label: pt('sessions.cashDifference'),
      value: hasActualCash ? formatCurrencyPdf(sumRegisterSessionField(sessions, 'cashDifference')) : '-',
      sub: 'actual minus expected',
      tone: 'blue',
    },
  ]

  let nextY = addSectionTitle(doc, context, y, pt('common.summary'))
  nextY = addKpiGrid(doc, context, nextY, kpis)

  if (sessions.length === 0) {
    addCompactMessage(doc, context, nextY, pt('sessions.noData'))
    saveReportDoc(doc, context)
    return
  }

  nextY = addSectionTitle(doc, context, nextY, pt('sessions.sessions'), pt('common.amountsSar'))
  nextY = addAutoTable(doc, context, {
    startY: nextY,
    fontSize: 6.1,
    head: [
      pt('common.status'), pt('sessions.opened'), pt('sessions.closed'), pt('common.sales'), pt('common.invoices'), pt('common.cash'), pt('common.card'), pt('common.vat'), pt('sessions.credit'), pt('common.expenses'), pt('common.expected'), pt('common.actual'), pt('common.difference'),
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
      pt('common.total'),
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
    pt('sessions.note'),
  ])
  saveReportDoc(doc, context)
}

async function exportVatSupportPdf(context: ReportPdfContext, data: VatSupportExportData) {
  const { doc, y } = await createReportDoc(context)
  const purchaseInputVat = data.monthlyRows.reduce((sum, row) => sum + numberOrZero(row.vatPaidPur), 0)
  const expenseInputVat = data.monthlyRows.reduce((sum, row) => sum + numberOrZero(row.vatPaidExp), 0)

  const kpis: PdfKpi[] = [
    { label: pt('vat.output'), value: formatCurrencyPdf(data.vatOnSales), sub: pt('vat.beforeCredits'), tone: 'green' },
    { label: pt('vat.credited'), value: formatCurrencyPdf(data.vatCredited), sub: pt('vat.reducedReturns'), tone: 'slate' },
    { label: pt('vat.netSales'), value: formatCurrencyPdf(data.vatCollected), sub: pt('vat.outputMinus'), tone: 'teal' },
    { label: pt('vat.input'), value: formatCurrencyPdf(data.vatPaidTotal), sub: pt('vat.claimable'), tone: 'blue' },
    {
      label: vatImpactLabel(data.netPayable),
      value: formatCurrencyPdf(Math.abs(data.netPayable)),
      sub: vatImpactSub(data.netPayable),
      tone: 'gold',
    },
  ]

  let nextY = addSectionTitle(doc, context, y, pt('common.summary'))
  nextY = addKpiGrid(doc, context, nextY, kpis)

  if (data.monthlyRows.length === 0) {
    nextY = addCompactMessage(doc, context, nextY, pt('vat.noData'))
    addFinalNotes(doc, context, nextY, [
      pt('vat.reviewNote'),
    ])
    saveReportDoc(doc, context)
    return
  }

  nextY = addSectionTitle(doc, context, nextY, pt('vat.monthly'), pt('common.amountsSar'))
  nextY = addAutoTable(doc, context, {
    startY: nextY,
    fontSize: 6.8,
    head: [
      pt('common.month'), pt('common.sales'), pt('vat.output'), pt('vat.credited'), pt('vat.purchaseInput'), pt('vat.expenseInput'), pt('vat.netEstimate'),
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
      pt('common.total'),
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
    pt('vat.reviewNote'),
  ])
  saveReportDoc(doc, context)
}

async function exportSalesPdf(context: ReportPdfContext, data: SalesExportData) {
  const { doc, y } = await createReportDoc(context)
  const otherPayments = data.byMethod
    .filter(row => !['cash', 'card'].includes(row.name.toLowerCase()))
    .reduce((sum, row) => sum + numberOrZero(row.value), 0)

  const kpis: PdfKpi[] = [
    { label: pt('sales.grossSales'), value: formatCurrencyPdf(data.grossSales), tone: 'green' },
    { label: pt('sales.creditNotes'), value: formatCurrencyPdf(data.creditNotes), tone: 'slate' },
    { label: pt('sales.netSales'), value: formatCurrencyPdf(data.totalRevenue), tone: 'gold' },
    { label: pt('common.vat'), value: formatCurrencyPdf(data.vatCollected), sub: pt('sales.vatSub', { sales: formatCurrencyPdf(data.vatOnSales), credited: formatCurrencyPdf(data.vatCredited) }), tone: 'amber' },
    { label: pt('sales.documents'), value: formatNumberPdf(data.invoiceCount), sub: pt('sales.nonCancelled'), tone: 'blue' },
    { label: pt('sales.averageSale'), value: formatCurrencyPdf(data.avgOrderValue), tone: 'teal' },
    { label: pt('common.cash'), value: formatCurrencyPdf(paymentValue(data, 'Cash')), tone: 'green' },
    { label: pt('common.card'), value: formatCurrencyPdf(paymentValue(data, 'Card')), tone: 'blue' },
    { label: pt('sales.otherPayments'), value: formatCurrencyPdf(otherPayments), tone: 'slate' },
  ]

  let nextY = addSectionTitle(doc, context, y, pt('common.summary'))
  nextY = addKpiGrid(doc, context, nextY, kpis)

  if (data.dailySales.length > 0) {
    nextY = addSectionTitle(doc, context, nextY, pt('sales.daily'), pt('common.amountsSar'))
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: [pt('common.date'), pt('common.revenue'), pt('common.invoices')],
      body: data.dailySales.map(row => [
        formatDatePdf(`${row.date}T00:00:00+03:00`),
        amountCell(row.revenue),
        formatNumberPdf(row.invoices),
      ]),
      foot: [
        pt('common.total'),
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
    nextY = addSectionTitle(doc, context, nextY, pt('sales.payments'), pt('common.amountsSar'))
    const totalPayments = data.byMethod.reduce((sum, row) => sum + numberOrZero(row.value), 0)
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: [pt('common.method'), pt('common.amount'), pt('common.share')],
      body: data.byMethod.map(row => [
        safePdfText(i18n.t(`reports:status.${row.name.toLowerCase().replaceAll(' ', '_')}`, { defaultValue: row.name || pt('common.other') }), pt('common.other')),
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
    nextY = addSectionTitle(doc, context, nextY, pt('sales.topProducts'), pt('sales.byRevenue'))
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: [pt('common.product'), pt('sales.baseQuantitySold'), pt('common.revenue'), pt('common.share')],
      body: data.topProducts.map(row => [
        safePdfText(
          row.packageBreakdown?.length
            ? `${row.name}\n${row.packageBreakdown
              .map(unit => `${formatNumberPdf(unit.packageQuantity, 6)} ${unit.sellingUnit} × SAR ${formatNumberPdf(unit.packageUnitPrice, 2)}`)
              .join(' · ')}`
            : row.name,
          pt('common.product'),
        ),
        formatNumberPdf(row.quantity, 3),
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
    nextY = addSectionTitle(doc, context, nextY, pt('sales.categoryPerformance'), pt('common.amountsSar'))
    nextY = addAutoTable(doc, context, {
      startY: nextY,
      head: [pt('common.category'), pt('sales.baseQuantitySold'), pt('common.revenue'), pt('common.share')],
      body: data.catPerformance.map(row => [
        safePdfText(row.name, pt('common.category')),
        formatNumberPdf(row.items, 3),
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
    nextY = addCompactMessage(doc, context, nextY, pt('sales.noData'))
  }

  addFinalNotes(doc, context, nextY, [
    pt('sales.noteTotals'), pt('sales.noteCredits'),
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
    { label: pt('profit.netSalesVat'), value: formatCurrencyPdf(data.totalRevenue), tone: 'green' },
    { label: pt('profit.netVatSales'), value: formatCurrencyPdf(vatData.vatCollected), tone: 'amber' },
    { label: pt('profit.salesExVat'), value: formatCurrencyPdf(estimatedSalesExVat), tone: 'gold' },
  ]
  const costKpis: PdfKpi[] = [
    { label: pt('profit.purchasesExVat'), value: formatCurrencyPdf(data.totalCOGS), tone: 'teal' },
    { label: pt('profit.expensesExVat'), value: formatCurrencyPdf(data.totalExpenses), tone: 'slate' },
    { label: pt('profit.operatingCosts'), value: formatCurrencyPdf(totalOperatingCosts), tone: 'amber' },
  ]
  const profitKpis: PdfKpi[] = [
    { label: pt('profit.businessProfit'), value: formatCurrencyPdf(estimatedBusinessProfit), tone: 'green' },
    { label: pt('profit.margin'), value: formatPercentPdf(estimatedMargin), tone: 'blue' },
  ]
  const vatKpis: PdfKpi[] = [
    { label: pt('vat.output'), value: formatCurrencyPdf(vatData.vatOnSales), tone: 'amber' },
    { label: pt('vat.input'), value: formatCurrencyPdf(vatData.vatPaidTotal), tone: 'teal' },
    {
      label: vatImpactLabel(netVatEstimate),
      value: formatCurrencyPdf(Math.abs(netVatEstimate)),
      sub: vatImpactSub(netVatEstimate),
      tone: 'gold',
    },
  ]
  const ownerKpis: PdfKpi[] = [
    {
      label: pt('profit.cashAfterVat'),
      value: formatCurrencyPdf(cashAfterVatProvision),
      sub: netVatEstimate >= 0 ? 'business profit minus VAT payable' : 'business profit plus VAT credit',
      tone: 'gold',
    },
  ]

  let nextY = addSectionTitle(doc, context, y, pt('profit.salesVatSummary'))
  nextY = addKpiGrid(doc, context, nextY, salesKpis)
  nextY = addSectionTitle(doc, context, nextY, pt('profit.costSummary'))
  nextY = addKpiGrid(doc, context, nextY, costKpis)
  nextY = addSectionTitle(doc, context, nextY, pt('profit.profitEstimate'))
  nextY = addKpiGrid(doc, context, nextY, profitKpis)
  nextY = addSectionTitle(doc, context, nextY, pt('profit.vatProvision'))
  nextY = addKpiGrid(doc, context, nextY, vatKpis)
  nextY = addSectionTitle(doc, context, nextY, pt('profit.ownerCash'))
  nextY = addKpiGrid(doc, context, nextY, ownerKpis)

  if (data.monthlyRows.length === 0) {
    nextY = addCompactMessage(doc, context, nextY, pt('profit.noData'))
    addFinalNotes(doc, context, nextY, [
      pt('profit.disclaimer'), pt('profit.vatDisclaimer'),
    ])
    saveReportDoc(doc, context)
    return
  }

  const vatRowsByMonth = monthlyVatByMonth(vatData)

  nextY = addSectionTitle(doc, context, nextY, pt('profit.monthlyOwner'), pt('profit.monthlyHint'))
  nextY = addAutoTable(doc, context, {
    startY: nextY,
    fontSize: 6.2,
    head: [
      pt('common.month'), pt('profit.salesVat'), pt('profit.salesExVat'), pt('profit.purchases'), pt('profit.expenses'), pt('profit.profit'), pt('profit.vatProvision'), pt('profit.cashAfter'),
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
      pt('common.total'),
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
    pt('profit.disclaimer'), pt('profit.vatDisclaimer'), pt('profit.salesDisclaimer'),
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
    return pt('errors.notReady')
  }

  if (/unauthorized|permission|42501|jwt|session/i.test(combined)) {
    return pt('errors.permission')
  }

  if (/22023|invalid report date range|invalid/i.test(combined)) {
    return pt('errors.range')
  }

  return i18n.t('reports:export.failed')
}
