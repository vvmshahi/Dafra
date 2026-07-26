import { supabase } from '@/lib/supabase'
import { saudiNow } from '@/lib/utils/date'

export type CustomerActivityType = 'all' | 'invoice' | 'credit_note'
export type CustomerActivityFilter = 'all' | 'active' | 'no_activity'
export type CustomerSortKey =
  | 'customer_name'
  | 'gross_purchases'
  | 'net_purchases'
  | 'invoice_count'
  | 'last_purchase'
  | 'average_invoice'
export type SortDirection = 'asc' | 'desc'
export type IntelligenceDatePreset =
  | 'today'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'previousMonth'
  | 'thisYear'
  | 'custom'

export interface CustomerIntelligenceFilters {
  startDate: string
  endDate: string
  branchId: string | null
  productId: string | null
  productUnitId: string | null
}

export interface CustomerIdentity {
  id: string
  name: string
  nameAr: string | null
  customerType: 'individual' | 'business'
  businessName: string | null
  businessNameAr: string | null
  phone: string | null
  email: string | null
  vatNumber: string | null
  isActive: boolean
  branchId: string
}

export interface LastPurchase {
  id: string
  reference: string
  invoiceDate: string
  createdAt: string
  branchId: string
  branchName: string
  branchNameAr: string | null
  total: number
}

export interface CustomerIntelligenceSummary {
  grossPurchases: number
  creditedAmount: number
  netPurchases: number
  invoiceCount: number
  creditNoteCount: number
  averageInvoiceValue: number
  averageDaysBetweenPurchases: number | null
  lastPurchase: LastPurchase | null
}

export interface RecentComparison {
  recentGross: number
  recentInvoiceCount: number
  previousGross: number
  previousInvoiceCount: number
  grossPercentChange: number | null
  invoicePercentChange: number | null
}

export interface CustomerTopProduct {
  productId: string | null
  productUnitId: string | null
  name: string
  nameAr: string | null
  unitName: string
  unitNameAr: string | null
  unitCode: string | null
  quantity: number
  grossAmount: number
  invoiceCount: number
  lastPurchased: string
}

export interface CustomerTimelinePoint {
  bucketStart: string
  grossPurchases: number
  creditedAmount: number
  netPurchases: number
  invoiceCount: number
  creditNoteCount: number
}

export interface MostActiveBranch {
  branchId: string
  branchName: string
  branchNameAr: string | null
  invoiceCount: number
  grossPurchases: number
}

export interface CustomerIntelligenceResponse {
  customer: CustomerIdentity
  summary: CustomerIntelligenceSummary
  recentComparison: RecentComparison
  topProducts: CustomerTopProduct[]
  timeline: CustomerTimelinePoint[]
  timelineGranularity: 'day' | 'week' | 'month'
  mostActiveBranch: MostActiveBranch | null
  filters: CustomerIntelligenceFilters
  scope: {
    tenantId: string
    branchId: string | null
    tenantScope: boolean
    callerRole: string
  }
}

export interface CustomerHistoryRow {
  id: string
  reference: string
  invoiceDate: string
  createdAt: string
  documentType: 'simplified' | 'standard' | 'credit_note'
  status: string
  zatcaStatus: string
  branchId: string
  branchName: string
  branchNameAr: string | null
  itemCount: number
  grossAmount: number
  creditedAmount: number
  netEffect: number
}

export interface CustomerHistoryResponse {
  rows: CustomerHistoryRow[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface CustomerReportRow {
  customerId: string
  name: string
  nameAr: string | null
  customerType: 'individual' | 'business'
  businessName: string | null
  businessNameAr: string | null
  phone: string | null
  vatNumber: string | null
  isActive: boolean
  branchId: string
  branchName: string
  branchNameAr: string | null
  grossPurchases: number
  creditedAmount: number
  netPurchases: number
  invoiceCount: number
  creditNoteCount: number
  averageInvoiceValue: number
  lastPurchase: string | null
  daysSinceLastPurchase: number | null
}

export interface CustomerReportTotals {
  customerCount: number
  activeCustomerCount: number
  grossPurchases: number
  creditedAmount: number
  netPurchases: number
  invoiceCount: number
  averagePerActiveCustomer: number
}

export interface CustomerReportResponse {
  rows: CustomerReportRow[]
  totals: CustomerReportTotals
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface CustomerInsight {
  key: 'topProduct' | 'recentTrend' | 'frequency' | 'lastPurchase' | 'unitPreference' | 'insufficient'
  values: Record<string, string | number>
}

const asNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeCustomerIntelligence(
  value: CustomerIntelligenceResponse,
): CustomerIntelligenceResponse {
  return {
    ...value,
    summary: {
      ...value.summary,
      grossPurchases: asNumber(value.summary.grossPurchases),
      creditedAmount: asNumber(value.summary.creditedAmount),
      netPurchases: asNumber(value.summary.netPurchases),
      invoiceCount: asNumber(value.summary.invoiceCount),
      creditNoteCount: asNumber(value.summary.creditNoteCount),
      averageInvoiceValue: asNumber(value.summary.averageInvoiceValue),
      averageDaysBetweenPurchases: value.summary.averageDaysBetweenPurchases == null
        ? null
        : asNumber(value.summary.averageDaysBetweenPurchases),
      lastPurchase: value.summary.lastPurchase
        ? { ...value.summary.lastPurchase, total: asNumber(value.summary.lastPurchase.total) }
        : null,
    },
    recentComparison: {
      ...value.recentComparison,
      recentGross: asNumber(value.recentComparison.recentGross),
      recentInvoiceCount: asNumber(value.recentComparison.recentInvoiceCount),
      previousGross: asNumber(value.recentComparison.previousGross),
      previousInvoiceCount: asNumber(value.recentComparison.previousInvoiceCount),
      grossPercentChange: value.recentComparison.grossPercentChange == null
        ? null
        : asNumber(value.recentComparison.grossPercentChange),
      invoicePercentChange: value.recentComparison.invoicePercentChange == null
        ? null
        : asNumber(value.recentComparison.invoicePercentChange),
    },
    topProducts: (value.topProducts ?? []).map(product => ({
      ...product,
      quantity: asNumber(product.quantity),
      grossAmount: asNumber(product.grossAmount),
      invoiceCount: asNumber(product.invoiceCount),
    })),
    timeline: (value.timeline ?? []).map(point => ({
      ...point,
      grossPurchases: asNumber(point.grossPurchases),
      creditedAmount: asNumber(point.creditedAmount),
      netPurchases: asNumber(point.netPurchases),
      invoiceCount: asNumber(point.invoiceCount),
      creditNoteCount: asNumber(point.creditNoteCount),
    })),
  }
}

function rpcPayload(filters: CustomerIntelligenceFilters) {
  return {
    start_date: filters.startDate,
    end_date: filters.endDate,
    branch_id: filters.branchId,
    product_id: filters.productId,
    product_unit_id: filters.productUnitId,
  }
}

export async function loadCustomerIntelligence(
  customerId: string,
  filters: CustomerIntelligenceFilters,
): Promise<CustomerIntelligenceResponse> {
  const { data, error } = await supabase.rpc('get_customer_intelligence' as never, {
    p_payload: { customer_id: customerId, ...rpcPayload(filters) },
  } as never)
  if (error) throw error
  return normalizeCustomerIntelligence(data as unknown as CustomerIntelligenceResponse)
}

export async function loadCustomerHistory(
  customerId: string,
  filters: CustomerIntelligenceFilters,
  activityType: CustomerActivityType,
  page: number,
  pageSize = 20,
): Promise<CustomerHistoryResponse> {
  const { data, error } = await supabase.rpc('get_customer_intelligence_history' as never, {
    p_payload: {
      customer_id: customerId,
      ...rpcPayload(filters),
      activity_type: activityType,
      page,
      page_size: pageSize,
    },
  } as never)
  if (error) throw error
  const result = data as unknown as CustomerHistoryResponse
  return {
    ...result,
    rows: (result.rows ?? []).map(row => ({
      ...row,
      grossAmount: asNumber(row.grossAmount),
      creditedAmount: asNumber(row.creditedAmount),
      netEffect: asNumber(row.netEffect),
      itemCount: asNumber(row.itemCount),
    })),
  }
}

export async function loadCustomerReport(payload: {
  filters: CustomerIntelligenceFilters
  search: string
  activity: CustomerActivityFilter
  minNet: number | null
  sort: CustomerSortKey
  direction: SortDirection
  page: number
  pageSize?: number
}): Promise<CustomerReportResponse> {
  const { data, error } = await supabase.rpc('list_customer_intelligence' as never, {
    p_payload: {
      ...rpcPayload(payload.filters),
      search: payload.search,
      activity: payload.activity,
      min_net: payload.minNet,
      sort: payload.sort,
      direction: payload.direction,
      page: payload.page,
      page_size: payload.pageSize ?? 25,
    },
  } as never)
  if (error) throw error
  const result = data as unknown as CustomerReportResponse
  return {
    ...result,
    rows: (result.rows ?? []).map(row => ({
      ...row,
      grossPurchases: asNumber(row.grossPurchases),
      creditedAmount: asNumber(row.creditedAmount),
      netPurchases: asNumber(row.netPurchases),
      invoiceCount: asNumber(row.invoiceCount),
      creditNoteCount: asNumber(row.creditNoteCount),
      averageInvoiceValue: asNumber(row.averageInvoiceValue),
    })),
    totals: {
      ...result.totals,
      customerCount: asNumber(result.totals.customerCount),
      activeCustomerCount: asNumber(result.totals.activeCustomerCount),
      grossPurchases: asNumber(result.totals.grossPurchases),
      creditedAmount: asNumber(result.totals.creditedAmount),
      netPurchases: asNumber(result.totals.netPurchases),
      invoiceCount: asNumber(result.totals.invoiceCount),
      averagePerActiveCustomer: asNumber(result.totals.averagePerActiveCustomer),
    },
  }
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

export function intelligenceDateRange(
  preset: IntelligenceDatePreset,
  today = saudiNow(),
): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const start = new Date(end)
  switch (preset) {
    case 'last7':
      start.setUTCDate(start.getUTCDate() - 6)
      break
    case 'last30':
      start.setUTCDate(start.getUTCDate() - 29)
      break
    case 'thisMonth':
      start.setUTCDate(1)
      break
    case 'previousMonth':
      start.setUTCDate(1)
      start.setUTCMonth(start.getUTCMonth() - 1)
      end.setUTCDate(0)
      break
    case 'thisYear':
      start.setUTCMonth(0, 1)
      break
    case 'today':
    case 'custom':
      break
  }
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

export function customerDisplayName(
  customer: Pick<CustomerIdentity, 'customerType' | 'businessName' | 'businessNameAr' | 'name' | 'nameAr'>,
  isArabic: boolean,
): string {
  const clean = (value: string | null | undefined) => value?.trim() || null
  const values = customer.customerType === 'business'
    ? isArabic
      ? [customer.businessNameAr, customer.businessName, customer.nameAr, customer.name]
      : [customer.businessName, customer.businessNameAr, customer.name, customer.nameAr]
    : isArabic
      ? [customer.nameAr, customer.name]
      : [customer.name, customer.nameAr]
  return values.map(clean).find(Boolean) ?? '—'
}

export function buildCustomerInsights(
  data: CustomerIntelligenceResponse,
  isArabic = false,
): CustomerInsight[] {
  const insights: CustomerInsight[] = []
  const top = data.topProducts[0]
  if (top) {
    insights.push({
      key: 'topProduct',
      values: {
        product: isArabic ? top.nameAr || top.name : top.name || top.nameAr || '—',
        unit: isArabic ? top.unitNameAr || top.unitName : top.unitName || top.unitNameAr || '—',
        quantity: top.quantity,
      },
    })
  }

  const recent = data.recentComparison
  if (recent.previousInvoiceCount > 0) {
    insights.push({
      key: 'recentTrend',
      values: {
        recent: recent.recentInvoiceCount,
        previous: recent.previousInvoiceCount,
      },
    })
  }

  if (data.summary.averageDaysBetweenPurchases != null) {
    insights.push({
      key: 'frequency',
      values: { days: data.summary.averageDaysBetweenPurchases },
    })
  }

  if (data.summary.lastPurchase) {
    const today = saudiNow()
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    const purchaseDate = new Date(`${data.summary.lastPurchase.invoiceDate}T00:00:00Z`)
    const days = Math.max(
      0,
      Math.floor((todayUtc - purchaseDate.getTime()) / 86_400_000),
    )
    insights.push({ key: 'lastPurchase', values: { days } })
  }

  if (!insights.length) insights.push({ key: 'insufficient', values: {} })
  return insights.slice(0, 4)
}

export function timelineReconciles(data: CustomerIntelligenceResponse): boolean {
  const gross = data.timeline.reduce((sum, point) => sum + point.grossPurchases, 0)
  const credited = data.timeline.reduce((sum, point) => sum + point.creditedAmount, 0)
  return Math.abs(gross - data.summary.grossPurchases) < 0.005
    && Math.abs(credited - data.summary.creditedAmount) < 0.005
}
