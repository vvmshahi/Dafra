import { supabase } from '@/lib/supabase'
import {
  type RegisterSessionSummary,
  logRegisterSessionRpcError,
  normalizeRegisterSessionList,
} from '@/lib/registerSessions'
import { asArray, loadReportSummary, reportParams } from '../reportingRpc'
import { intOrZero, numberOrZero, safeText } from './reportPdfTheme'

export interface ReportExportParams {
  startDate: string
  endDate: string
  branchId: string | null
}

export interface VatMonthRow {
  month: string
  grossSales: number
  creditNotes: number
  salesAmount: number
  vatOnSales: number
  vatCredited: number
  vatCollected: number
  purchaseAmount: number
  vatPaidPur: number
  expenseAmount: number
  vatPaidExp: number
  netPayable: number
}

export interface SalesDayRow {
  date: string
  revenue: number
  invoices: number
}

export interface SalesMethodRow {
  name: string
  value: number
}

export interface SalesTopProductRow {
  itemKey?: string
  productId?: string | null
  name: string
  nameAr?: string | null
  lineType?: 'product' | 'service' | 'custom' | 'legacy'
  quantity: number
  baseQuantity?: number
  vat?: number
  revenue: number
  pct: number
  packageBreakdown?: {
    productUnitId: string | null
    productUnitVersion: number | null
    sellingUnit: string
    unitCode: string
    conversionToBase: number
    packageUnitPrice: number
    packageQuantity: number
    baseQuantity: number
    revenue: number
  }[]
}

export interface SalesCategoryRow {
  name: string
  items: number
  revenue: number
  pct: number
}

export interface SalesExportData {
  grossSales: number
  creditNotes: number
  totalRevenue: number
  invoiceCount: number
  avgOrderValue: number
  vatOnSales: number
  vatCredited: number
  vatCollected: number
  dailySales: SalesDayRow[]
  byMethod: SalesMethodRow[]
  topItems?: SalesTopProductRow[]
  topProducts: SalesTopProductRow[]
  catPerformance: SalesCategoryRow[]
}

export interface VatSupportExportData {
  grossSales: number
  creditNotes: number
  vatOnSales: number
  vatCredited: number
  vatCollected: number
  vatPaidTotal: number
  netPayable: number
  salesTotal: number
  monthlyRows: VatMonthRow[]
}

export interface ProfitMonthRow {
  month: string
  grossSales: number
  creditNotes: number
  revenue: number
  cogs: number
  grossProfit: number
  expenses: number
  netProfit: number
}

export interface ProfitEstimateExportData {
  reportLabel?: string
  grossSales: number
  creditNotes: number
  totalRevenue: number
  totalCOGS: number
  grossProfit: number
  totalExpenses: number
  netProfit: number
  margin: number
  monthlyRows: ProfitMonthRow[]
}

export interface ExpenseExportData {
  totalVariable: number
  totalFixed: number
  grandTotal: number
  monthlyFixed: number
  log: { date: string; description: string; category: string; amount: number; method: string }[]
}

export interface PurchaseExportData {
  totalPurchased: number
  totalVat: number
  supplierCount: number
  bySupplier: { name: string; total: number; count: number; lastDate: string | null }[]
  topItems: { name: string; quantity: number; total: number }[]
  monthlyBars: { month: string; Purchases: number }[]
}

const EMPTY_VAT_DATA: VatSupportExportData = {
  grossSales: 0,
  creditNotes: 0,
  vatOnSales: 0,
  vatCredited: 0,
  vatCollected: 0,
  vatPaidTotal: 0,
  netPayable: 0,
  salesTotal: 0,
  monthlyRows: [],
}

const EMPTY_PROFIT_DATA: ProfitEstimateExportData = {
  reportLabel: 'Simple Profit Estimate',
  grossSales: 0,
  creditNotes: 0,
  totalRevenue: 0,
  totalCOGS: 0,
  grossProfit: 0,
  totalExpenses: 0,
  netProfit: 0,
  margin: 0,
  monthlyRows: [],
}

const EMPTY_SALES_DATA: SalesExportData = {
  grossSales: 0,
  creditNotes: 0,
  totalRevenue: 0,
  invoiceCount: 0,
  avgOrderValue: 0,
  vatOnSales: 0,
  vatCredited: 0,
  vatCollected: 0,
  dailySales: [],
  byMethod: [],
  topProducts: [],
  catPerformance: [],
}

const EMPTY_EXPENSE_EXPORT_DATA: ExpenseExportData = { totalVariable: 0, totalFixed: 0, grandTotal: 0, monthlyFixed: 0, log: [] }
const EMPTY_PURCHASE_EXPORT_DATA: PurchaseExportData = { totalPurchased: 0, totalVat: 0, supplierCount: 0, bySupplier: [], topItems: [], monthlyBars: [] }

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function salesDayRow(row: SalesDayRow): SalesDayRow {
  return {
    date: safeText(row.date),
    revenue: numberOrZero(row.revenue),
    invoices: intOrZero(row.invoices),
  }
}

function salesMethodRow(row: SalesMethodRow): SalesMethodRow {
  return {
    name: stringOrFallback(row.name, 'Other'),
    value: numberOrZero(row.value),
  }
}

function salesTopProductRow(row: SalesTopProductRow): SalesTopProductRow {
  return {
    itemKey: typeof row.itemKey === 'string' ? row.itemKey : undefined,
    productId: typeof row.productId === 'string' ? row.productId : null,
    name: stringOrFallback(row.name, 'Product'),
    nameAr: typeof row.nameAr === 'string' && row.nameAr.trim() ? row.nameAr : null,
    lineType: row.lineType === 'product' || row.lineType === 'service' || row.lineType === 'custom' || row.lineType === 'legacy'
      ? row.lineType
      : 'legacy',
    quantity: numberOrZero(row.quantity),
    baseQuantity: numberOrZero(row.baseQuantity ?? row.quantity),
    vat: numberOrZero(row.vat),
    revenue: numberOrZero(row.revenue),
    pct: numberOrZero(row.pct),
    packageBreakdown: asArray<NonNullable<SalesTopProductRow['packageBreakdown']>[number]>(
      row.packageBreakdown,
    ).map(unit => ({
      productUnitId: typeof unit.productUnitId === 'string' ? unit.productUnitId : null,
      productUnitVersion: unit.productUnitVersion == null ? null : intOrZero(unit.productUnitVersion),
      sellingUnit: stringOrFallback(unit.sellingUnit, 'Unit'),
      unitCode: stringOrFallback(unit.unitCode, 'PCE'),
      conversionToBase: numberOrZero(unit.conversionToBase ?? 1),
      packageUnitPrice: numberOrZero(unit.packageUnitPrice),
      packageQuantity: numberOrZero(unit.packageQuantity),
      baseQuantity: numberOrZero(unit.baseQuantity),
      revenue: numberOrZero(unit.revenue),
    })),
  }
}

function salesCategoryRow(row: SalesCategoryRow): SalesCategoryRow {
  return {
    name: stringOrFallback(row.name, 'Category'),
    items: numberOrZero(row.items),
    revenue: numberOrZero(row.revenue),
    pct: numberOrZero(row.pct),
  }
}

function vatMonthRow(row: VatMonthRow): VatMonthRow {
  return {
    month: safeText(row.month),
    grossSales: numberOrZero(row.grossSales),
    creditNotes: numberOrZero(row.creditNotes),
    salesAmount: numberOrZero(row.salesAmount),
    vatOnSales: numberOrZero(row.vatOnSales),
    vatCredited: numberOrZero(row.vatCredited),
    vatCollected: numberOrZero(row.vatCollected),
    purchaseAmount: numberOrZero(row.purchaseAmount),
    vatPaidPur: numberOrZero(row.vatPaidPur),
    expenseAmount: numberOrZero(row.expenseAmount),
    vatPaidExp: numberOrZero(row.vatPaidExp),
    netPayable: numberOrZero(row.netPayable),
  }
}

function profitMonthRow(row: ProfitMonthRow): ProfitMonthRow {
  return {
    month: safeText(row.month),
    grossSales: numberOrZero(row.grossSales),
    creditNotes: numberOrZero(row.creditNotes),
    revenue: numberOrZero(row.revenue),
    cogs: numberOrZero(row.cogs),
    grossProfit: numberOrZero(row.grossProfit),
    expenses: numberOrZero(row.expenses),
    netProfit: numberOrZero(row.netProfit),
  }
}

export async function loadRegisterSessionsExport(params: ReportExportParams): Promise<RegisterSessionSummary[]> {
  const rpcParams = {
    ...(params.branchId ? { p_branch_id: params.branchId } : {}),
    p_limit: 200,
    p_start_date: params.startDate,
    p_end_date: params.endDate,
  }

  const { data, error } = await (supabase as any).rpc('get_register_sessions_filtered', rpcParams)
  if (error) {
    logRegisterSessionRpcError('get_register_sessions_filtered', rpcParams, error)
    throw error
  }

  return normalizeRegisterSessionList(data)
}

export async function loadSalesExport(params: ReportExportParams): Promise<SalesExportData> {
  const summary = await loadReportSummary<SalesExportData>(
    'get_sales_report_summary_v2',
    reportParams(params.startDate, params.endDate, params.branchId),
    EMPTY_SALES_DATA,
  )

  return {
    grossSales: numberOrZero(summary.grossSales),
    creditNotes: numberOrZero(summary.creditNotes),
    totalRevenue: numberOrZero(summary.totalRevenue),
    invoiceCount: intOrZero(summary.invoiceCount),
    avgOrderValue: numberOrZero(summary.avgOrderValue),
    vatOnSales: numberOrZero(summary.vatOnSales),
    vatCredited: numberOrZero(summary.vatCredited),
    vatCollected: numberOrZero(summary.vatCollected),
    dailySales: asArray<SalesDayRow>(summary.dailySales).map(salesDayRow),
    byMethod: asArray<SalesMethodRow>(summary.byMethod).map(salesMethodRow),
    topProducts: asArray<SalesTopProductRow>(summary.topItems ?? summary.topProducts).map(salesTopProductRow),
    catPerformance: asArray<SalesCategoryRow>(summary.catPerformance).map(salesCategoryRow),
  }
}

export async function loadVatSupportExport(params: ReportExportParams): Promise<VatSupportExportData> {
  const summary = await loadReportSummary<VatSupportExportData>(
    'get_vat_support_summary',
    reportParams(params.startDate, params.endDate, params.branchId),
    EMPTY_VAT_DATA,
  )

  return {
    grossSales: numberOrZero(summary.grossSales),
    creditNotes: numberOrZero(summary.creditNotes),
    vatOnSales: numberOrZero(summary.vatOnSales),
    vatCredited: numberOrZero(summary.vatCredited),
    vatCollected: numberOrZero(summary.vatCollected),
    vatPaidTotal: numberOrZero(summary.vatPaidTotal),
    netPayable: numberOrZero(summary.netPayable),
    salesTotal: numberOrZero(summary.salesTotal),
    monthlyRows: asArray<VatMonthRow>(summary.monthlyRows).map(vatMonthRow),
  }
}

export async function loadProfitEstimateExport(params: ReportExportParams): Promise<ProfitEstimateExportData> {
  const summary = await loadReportSummary<ProfitEstimateExportData>(
    'get_profit_report_summary',
    reportParams(params.startDate, params.endDate, params.branchId),
    EMPTY_PROFIT_DATA,
  )

  return {
    reportLabel: safeText(summary.reportLabel, 'Simple Profit Estimate'),
    grossSales: numberOrZero(summary.grossSales),
    creditNotes: numberOrZero(summary.creditNotes),
    totalRevenue: numberOrZero(summary.totalRevenue),
    totalCOGS: numberOrZero(summary.totalCOGS),
    grossProfit: numberOrZero(summary.grossProfit),
    totalExpenses: numberOrZero(summary.totalExpenses),
    netProfit: numberOrZero(summary.netProfit),
    margin: numberOrZero(summary.margin),
    monthlyRows: asArray<ProfitMonthRow>(summary.monthlyRows).map(profitMonthRow),
  }
}

export async function loadExpenseExport(params: ReportExportParams): Promise<ExpenseExportData> {
  const summary = await loadReportSummary<ExpenseExportData>('get_expense_report_summary_v1', reportParams(params.startDate, params.endDate, params.branchId), EMPTY_EXPENSE_EXPORT_DATA)
  return {
    totalVariable: numberOrZero(summary.totalVariable), totalFixed: numberOrZero(summary.totalFixed), grandTotal: numberOrZero(summary.grandTotal), monthlyFixed: numberOrZero(summary.monthlyFixed),
    log: asArray<ExpenseExportData['log'][number]>(summary.log).map(row => ({ date: safeText(row.date), description: safeText(row.description), category: safeText(row.category), amount: numberOrZero(row.amount), method: safeText(row.method) })),
  }
}

export async function loadPurchaseExport(params: ReportExportParams): Promise<PurchaseExportData> {
  const summary = await loadReportSummary<PurchaseExportData>('get_purchase_report_summary', reportParams(params.startDate, params.endDate, params.branchId), EMPTY_PURCHASE_EXPORT_DATA)
  return {
    totalPurchased: numberOrZero(summary.totalPurchased), totalVat: numberOrZero(summary.totalVat), supplierCount: intOrZero(summary.supplierCount),
    bySupplier: asArray<PurchaseExportData['bySupplier'][number]>(summary.bySupplier).map(row => ({ name: safeText(row.name), total: numberOrZero(row.total), count: intOrZero(row.count), lastDate: row.lastDate ?? null })),
    topItems: asArray<PurchaseExportData['topItems'][number]>(summary.topItems).map(row => ({ name: safeText(row.name), quantity: numberOrZero(row.quantity), total: numberOrZero(row.total) })),
    monthlyBars: asArray<PurchaseExportData['monthlyBars'][number]>(summary.monthlyBars).map(row => ({ month: safeText(row.month), Purchases: numberOrZero(row.Purchases) })),
  }
}

export function countClosedCashValues(sessions: RegisterSessionSummary[]): number {
  return sessions.reduce((count, session) => count + (session.actualCash === null ? 0 : 1), 0)
}

export function sumRegisterSessionField(
  sessions: RegisterSessionSummary[],
  field: keyof Pick<
    RegisterSessionSummary,
    | 'totalSales'
    | 'invoiceCount'
    | 'cashTotal'
    | 'cardTotal'
    | 'vatTotal'
    | 'creditNoteTotal'
    | 'expensesTotal'
    | 'expectedCash'
    | 'actualCash'
    | 'cashDifference'
  >,
): number {
  return sessions.reduce((sum, session) => sum + (field === 'invoiceCount' ? intOrZero(session[field]) : numberOrZero(session[field])), 0)
}
