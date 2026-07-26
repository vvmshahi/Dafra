import { supabase } from '@/lib/supabase'
import { saudiNow } from '@/lib/utils/date'

export type SupplierPaymentStatus = 'paid' | 'partial' | 'unpaid'
export type SupplierPaymentStatusFilter = 'all' | SupplierPaymentStatus
export type SupplierActivityFilter = 'all' | 'active' | 'no_activity'
export type SupplierSortKey =
  | 'supplier_name'
  | 'gross_purchases'
  | 'purchase_count'
  | 'average_purchase'
  | 'last_purchase'
  | 'days_since_last_purchase'
export type SortDirection = 'asc' | 'desc'
export type IntelligenceDatePreset =
  | 'today'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'previousMonth'
  | 'thisYear'
  | 'custom'

export interface SupplierIntelligenceFilters {
  startDate: string
  endDate: string
  branchId: string | null
  productId: string | null
  productUnitId: string | null
  paymentStatus: SupplierPaymentStatusFilter
}

export interface SupplierIdentity {
  id: string
  name: string
  nameAr: string | null
  phone: string | null
  email: string | null
  vatNumber: string | null
  crNumber: string | null
  contactPerson: string | null
  paymentTerms: string
  isActive: boolean
  branchId: string
}

export interface SupplierLastPurchase {
  id: string
  reference: string | null
  purchaseDate: string
  createdAt: string
  branchId: string
  branchName: string
  branchNameAr: string | null
  total: number
  paymentStatus: SupplierPaymentStatus
  status: string
  receivingStatus: string
}

export interface SupplierIntelligenceSummary {
  grossPurchases: number
  purchaseCount: number
  averagePurchaseValue: number
  averageDaysBetweenPurchases: number | null
  purchasesLast30Days: number
  purchasesPrevious30Days: number
  daysSinceLastPurchase: number | null
  lastPurchase: SupplierLastPurchase | null
}

export interface SupplierRecentComparison {
  recentGross: number
  recentPurchaseCount: number
  previousGross: number
  previousPurchaseCount: number
  grossPercentChange: number | null
  purchasePercentChange: number | null
}

export interface SupplierPaymentStatusSummary {
  status: SupplierPaymentStatus
  purchaseCount: number
  grossPurchases: number
}

export interface SupplierTopProduct {
  productId: string | null
  productUnitId: string | null
  name: string
  nameAr: string | null
  unitName: string
  unitNameAr: string | null
  unitCode: string | null
  quantity: number
  baseQuantity: number | null
  baseUnitName: string | null
  grossAmount: number
  purchaseCount: number
  lastPurchased: string
  averageUnitCost: number | null
}

export interface SupplierTimelinePoint {
  bucketStart: string
  grossPurchases: number
  purchaseCount: number
}

export interface SupplierMostActiveBranch {
  branchId: string
  branchName: string
  branchNameAr: string | null
  purchaseCount: number
  grossPurchases: number
}

export interface SupplierIntelligenceResponse {
  supplier: SupplierIdentity
  summary: SupplierIntelligenceSummary
  recentComparison: SupplierRecentComparison
  paymentStatusSummary: SupplierPaymentStatusSummary[]
  topProducts: SupplierTopProduct[]
  timeline: SupplierTimelinePoint[]
  timelineGranularity: 'day' | 'week' | 'month'
  mostActiveBranch: SupplierMostActiveBranch | null
  filters: SupplierIntelligenceFilters
  scope: {
    tenantId: string
    branchId: string | null
    tenantScope: boolean
    callerRole: string
  }
}

export interface SupplierHistoryRow {
  id: string
  reference: string | null
  purchaseDate: string
  createdAt: string
  branchId: string
  branchName: string
  branchNameAr: string | null
  itemCount: number
  grossAmount: number
  paymentStatus: SupplierPaymentStatus
  paymentMethod: string
  status: string
  receivingStatus: string
  purchaseMode: string
}

export interface SupplierHistoryResponse {
  rows: SupplierHistoryRow[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface SupplierReportRow {
  supplierId: string
  name: string
  nameAr: string | null
  phone: string | null
  email: string | null
  vatNumber: string | null
  isActive: boolean
  branchId: string
  branchName: string
  branchNameAr: string | null
  grossPurchases: number
  purchaseCount: number
  averagePurchaseValue: number
  lastPurchase: string | null
  daysSinceLastPurchase: number | null
  averageDaysBetweenPurchases: number | null
  topProductName: string | null
  topProductNameAr: string | null
  topUnitName: string | null
  topUnitNameAr: string | null
  productCount: number
}

export interface SupplierReportTotals {
  supplierCount: number
  activeSupplierCount: number
  grossPurchases: number
  purchaseCount: number
  averagePerActiveSupplier: number
}

export interface SupplierReportResponse {
  rows: SupplierReportRow[]
  totals: SupplierReportTotals
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface SupplierInsight {
  key:
    | 'topProduct'
    | 'recentTrend'
    | 'frequency'
    | 'lastPurchase'
    | 'unitPreference'
    | 'mostActiveBranch'
    | 'noRecentActivity'
    | 'insufficient'
  values: Record<string, string | number>
}

const asNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const nullableNumber = (value: unknown) => (
  value == null ? null : asNumber(value)
)

function normalizeLastPurchase(
  value: SupplierLastPurchase | null,
): SupplierLastPurchase | null {
  return value ? { ...value, total: asNumber(value.total) } : null
}

export function normalizeSupplierIntelligence(
  value: SupplierIntelligenceResponse,
): SupplierIntelligenceResponse {
  return {
    ...value,
    summary: {
      ...value.summary,
      grossPurchases: asNumber(value.summary.grossPurchases),
      purchaseCount: asNumber(value.summary.purchaseCount),
      averagePurchaseValue: asNumber(value.summary.averagePurchaseValue),
      averageDaysBetweenPurchases: nullableNumber(value.summary.averageDaysBetweenPurchases),
      purchasesLast30Days: asNumber(value.summary.purchasesLast30Days),
      purchasesPrevious30Days: asNumber(value.summary.purchasesPrevious30Days),
      daysSinceLastPurchase: nullableNumber(value.summary.daysSinceLastPurchase),
      lastPurchase: normalizeLastPurchase(value.summary.lastPurchase),
    },
    recentComparison: {
      ...value.recentComparison,
      recentGross: asNumber(value.recentComparison.recentGross),
      recentPurchaseCount: asNumber(value.recentComparison.recentPurchaseCount),
      previousGross: asNumber(value.recentComparison.previousGross),
      previousPurchaseCount: asNumber(value.recentComparison.previousPurchaseCount),
      grossPercentChange: nullableNumber(value.recentComparison.grossPercentChange),
      purchasePercentChange: nullableNumber(value.recentComparison.purchasePercentChange),
    },
    paymentStatusSummary: (value.paymentStatusSummary ?? []).map(row => ({
      ...row,
      purchaseCount: asNumber(row.purchaseCount),
      grossPurchases: asNumber(row.grossPurchases),
    })),
    topProducts: (value.topProducts ?? []).map(product => ({
      ...product,
      quantity: asNumber(product.quantity),
      baseQuantity: nullableNumber(product.baseQuantity),
      grossAmount: asNumber(product.grossAmount),
      purchaseCount: asNumber(product.purchaseCount),
      averageUnitCost: nullableNumber(product.averageUnitCost),
    })),
    timeline: (value.timeline ?? []).map(point => ({
      ...point,
      grossPurchases: asNumber(point.grossPurchases),
      purchaseCount: asNumber(point.purchaseCount),
    })),
  }
}

function rpcPayload(filters: SupplierIntelligenceFilters) {
  return {
    start_date: filters.startDate,
    end_date: filters.endDate,
    branch_id: filters.branchId,
    product_id: filters.productId,
    product_unit_id: filters.productUnitId,
    payment_status: filters.paymentStatus === 'all' ? null : filters.paymentStatus,
  }
}

export async function loadSupplierIntelligence(
  supplierId: string,
  filters: SupplierIntelligenceFilters,
): Promise<SupplierIntelligenceResponse> {
  const { data, error } = await supabase.rpc('get_supplier_intelligence' as never, {
    p_payload: { supplier_id: supplierId, ...rpcPayload(filters) },
  } as never)
  if (error) throw error
  return normalizeSupplierIntelligence(data as unknown as SupplierIntelligenceResponse)
}

export async function loadSupplierHistory(
  supplierId: string,
  filters: SupplierIntelligenceFilters,
  page: number,
  pageSize = 20,
): Promise<SupplierHistoryResponse> {
  const { data, error } = await supabase.rpc('get_supplier_intelligence_history' as never, {
    p_payload: {
      supplier_id: supplierId,
      ...rpcPayload(filters),
      page,
      page_size: pageSize,
    },
  } as never)
  if (error) throw error
  const result = data as unknown as SupplierHistoryResponse
  return {
    ...result,
    rows: (result.rows ?? []).map(row => ({
      ...row,
      grossAmount: asNumber(row.grossAmount),
      itemCount: asNumber(row.itemCount),
    })),
  }
}

export async function loadSupplierReport(payload: {
  filters: SupplierIntelligenceFilters
  search: string
  activity: SupplierActivityFilter
  minimumGross: number | null
  sort: SupplierSortKey
  direction: SortDirection
  page: number
  pageSize?: number
}): Promise<SupplierReportResponse> {
  const { data, error } = await supabase.rpc('list_supplier_intelligence' as never, {
    p_payload: {
      ...rpcPayload(payload.filters),
      search: payload.search,
      activity: payload.activity,
      min_gross: payload.minimumGross,
      sort: payload.sort,
      direction: payload.direction,
      page: payload.page,
      page_size: payload.pageSize ?? 25,
    },
  } as never)
  if (error) throw error
  const result = data as unknown as SupplierReportResponse
  return {
    ...result,
    rows: (result.rows ?? []).map(row => ({
      ...row,
      grossPurchases: asNumber(row.grossPurchases),
      purchaseCount: asNumber(row.purchaseCount),
      averagePurchaseValue: asNumber(row.averagePurchaseValue),
      daysSinceLastPurchase: nullableNumber(row.daysSinceLastPurchase),
      averageDaysBetweenPurchases: nullableNumber(row.averageDaysBetweenPurchases),
      productCount: asNumber(row.productCount),
    })),
    totals: {
      ...result.totals,
      supplierCount: asNumber(result.totals.supplierCount),
      activeSupplierCount: asNumber(result.totals.activeSupplierCount),
      grossPurchases: asNumber(result.totals.grossPurchases),
      purchaseCount: asNumber(result.totals.purchaseCount),
      averagePerActiveSupplier: asNumber(result.totals.averagePerActiveSupplier),
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

export function supplierDisplayName(
  supplier: Pick<SupplierIdentity, 'name' | 'nameAr'>,
  isArabic: boolean,
): string {
  return isArabic
    ? supplier.nameAr?.trim() || supplier.name
    : supplier.name.trim() || supplier.nameAr?.trim() || '—'
}

export function buildSupplierInsights(
  data: SupplierIntelligenceResponse,
  isArabic = false,
): SupplierInsight[] {
  const insights: SupplierInsight[] = []
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
    insights.push({
      key: 'unitPreference',
      values: {
        unit: isArabic ? top.unitNameAr || top.unitName : top.unitName || top.unitNameAr || '—',
      },
    })
  }

  const recent = data.recentComparison
  if (recent.previousPurchaseCount > 0) {
    insights.push({
      key: 'recentTrend',
      values: {
        recent: recent.recentPurchaseCount,
        previous: recent.previousPurchaseCount,
      },
    })
  }

  if (data.summary.averageDaysBetweenPurchases != null) {
    insights.push({
      key: 'frequency',
      values: { days: data.summary.averageDaysBetweenPurchases },
    })
  }

  if (data.summary.daysSinceLastPurchase != null) {
    insights.push({
      key: data.summary.daysSinceLastPurchase >= 90 ? 'noRecentActivity' : 'lastPurchase',
      values: { days: data.summary.daysSinceLastPurchase },
    })
  }

  if (data.mostActiveBranch) {
    insights.push({
      key: 'mostActiveBranch',
      values: {
        branch: isArabic
          ? data.mostActiveBranch.branchNameAr || data.mostActiveBranch.branchName
          : data.mostActiveBranch.branchName || data.mostActiveBranch.branchNameAr || '—',
        count: data.mostActiveBranch.purchaseCount,
      },
    })
  }

  if (!insights.length) insights.push({ key: 'insufficient', values: {} })
  return insights.slice(0, 5)
}

export function timelineReconciles(data: SupplierIntelligenceResponse): boolean {
  const gross = data.timeline.reduce((sum, point) => sum + point.grossPurchases, 0)
  return Math.abs(gross - data.summary.grossPurchases) < 0.005
}
