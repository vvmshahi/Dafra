import type { InvoiceType, ZatcaStatus } from '@/types/database'
import type { SandboxValidationStatus } from '@/lib/zatca/api'

export type InvoiceListDisplayStatus = ZatcaStatus | SandboxValidationStatus | 'sandbox_not_validated'

export interface InvoiceListRow {
  id: string
  branchId: string
  invoiceNumber: string
  date: string
  createdAt: string
  sessionId?: string | null
  customerName: string | null
  itemsCount: number
  subtotal: number
  taxAmount: number
  totalAmount: number
  paymentMethod: string | null
  zatcaStatus: ZatcaStatus
  displayZatcaStatus: InvoiceListDisplayStatus
  status: string
  documentType: InvoiceType
  invoiceReference: string | null
  linkedCreditNoteId: string | null
  linkedCreditNoteNumber: string | null
  creditNoteCount: number
  creditStatus: 'none' | 'partial' | 'full'
  remainingRefundableQuantity: number
}

export interface InvoiceListScope {
  tenantId: string
  branchId: string
  startDate: string
  endDate: string
  page: number
  pageSize: number
  sessionId?: string | null
}

interface CacheEntry {
  rows: InvoiceListRow[]
  updatedAt: number
}

const cache = new Map<string, CacheEntry>()
const listeners = new Set<() => void>()
export const INVOICE_LIST_STALE_MS = 30_000
export const INVOICE_LIST_CACHE_MS = 10 * 60_000

export function invoiceListCacheKey(scope: InvoiceListScope) {
  return [
    scope.tenantId,
    scope.branchId,
    scope.startDate,
    scope.endDate,
    scope.page,
    scope.pageSize,
    scope.sessionId ?? 'date',
  ].join('|')
}

export function invoiceListViewKey(scope: InvoiceListScope, filters: {
  search: string
  paymentMethod: string
  zatcaStatus: string
  documentType?: string
}) {
  return `${invoiceListCacheKey(scope)}|${filters.search.trim().toLowerCase()}|${filters.paymentMethod}|${filters.zatcaStatus}|${filters.documentType ?? 'all'}`
}

export function getCachedInvoiceRows(scope: InvoiceListScope): CacheEntry | null {
  const key = invoiceListCacheKey(scope)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > INVOICE_LIST_CACHE_MS) {
    cache.delete(key)
    return null
  }
  return entry
}

export function setCachedInvoiceRows(scope: InvoiceListScope, rows: InvoiceListRow[]) {
  const deduped = [...new Map(rows.map(row => [row.id, row])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, scope.pageSize)
  cache.set(invoiceListCacheKey(scope), { rows: deduped, updatedAt: Date.now() })
  listeners.forEach(listener => listener())
}

export function upsertInvoiceListRow(tenantId: string, row: InvoiceListRow) {
  let matched = false
  for (const [key, entry] of cache) {
    const [cachedTenant, cachedBranch, startDate, endDate, page, pageSize, cachedSessionId] = key.split('|')
    if (cachedTenant !== tenantId || cachedBranch !== row.branchId || row.date < startDate || row.date > endDate) continue
    if (cachedSessionId !== 'date' && cachedSessionId !== (row.sessionId ?? '')) continue
    if (page !== '0') continue
    matched = true
    const rows = [row, ...entry.rows.filter(existing => existing.id !== row.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Number(pageSize))
    cache.set(key, { rows, updatedAt: entry.updatedAt })
  }
  if (!matched) {
    const scope: InvoiceListScope = {
      tenantId,
      branchId: row.branchId,
      startDate: row.date,
      endDate: row.date,
      page: 0,
      pageSize: 100,
    }
    cache.set(invoiceListCacheKey(scope), { rows: [row], updatedAt: 0 })
  }
  listeners.forEach(listener => listener())
}

export function updateCachedInvoiceRows(tenantId: string, branchId: string, update: (rows: InvoiceListRow[]) => InvoiceListRow[]) {
  for (const [key, entry] of cache) {
    const [cachedTenant, cachedBranch] = key.split('|')
    if (cachedTenant !== tenantId || cachedBranch !== branchId) continue
    cache.set(key, { ...entry, rows: update(entry.rows) })
  }
  listeners.forEach(listener => listener())
}

export function subscribeInvoiceListCache(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
