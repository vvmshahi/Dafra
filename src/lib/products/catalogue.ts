import type { VatTreatment } from '@/types'

export const PRODUCTS_DEFAULT_VIEW = 'list' as const

export type CatalogueStockTone = 'success' | 'warning' | 'danger' | 'neutral'
export type CatalogueStockKey =
  | 'status.stockCount'
  | 'status.lowStock'
  | 'status.outOfStock'
  | 'status.notTracked'
  | 'status.serviceItem'
  | 'status.branchStockDisabled'

export interface CatalogueStockInput {
  stockQuantity: number | null | undefined
  trackStock: boolean
  isService: boolean
  branchStockEnabled: boolean
  lowStockThreshold: number | null | undefined
}

export interface CatalogueStockStatus {
  key: CatalogueStockKey
  tone: CatalogueStockTone
  count?: string
}

export function formatCatalogueStockQuantity(value: number | null | undefined): string {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0'
  if (Number.isInteger(numeric)) return String(numeric)
  return numeric.toFixed(3).replace(/\.?0+$/, '')
}

export function catalogueStockStatus(input: CatalogueStockInput): CatalogueStockStatus {
  if (!input.branchStockEnabled) return { key: 'status.branchStockDisabled', tone: 'neutral' }
  if (input.isService) return { key: 'status.serviceItem', tone: 'neutral' }
  if (!input.trackStock) return { key: 'status.notTracked', tone: 'neutral' }

  const quantity = Number(input.stockQuantity ?? 0)
  if (quantity <= 0) return { key: 'status.outOfStock', tone: 'danger' }

  const threshold = Number(input.lowStockThreshold)
  if (
    input.lowStockThreshold !== null
    && input.lowStockThreshold !== undefined
    && Number.isFinite(threshold)
    && threshold > 0
    && quantity <= threshold
  ) {
    return {
      key: 'status.lowStock',
      tone: 'warning',
      count: formatCatalogueStockQuantity(quantity),
    }
  }

  return {
    key: 'status.stockCount',
    tone: 'success',
    count: formatCatalogueStockQuantity(quantity),
  }
}

export const CATALOGUE_VAT_TONES: Record<VatTreatment, 'success' | 'warning' | 'neutral' | 'teal'> = {
  inherit: 'neutral',
  exclusive: 'warning',
  inclusive: 'success',
  exempt: 'teal',
}

export function normalizeCatalogueText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

export function normalizeCatalogueArabic(value: string): string {
  return normalizeCatalogueText(value)
    .normalize('NFKC')
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/gu, '')
    .replace(/\u0640/gu, '')
    .replace(/[أإآٱ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
}

export function catalogueTextMatches(
  query: string,
  product: {
    name: string
    name_ar: string | null
    sku: string | null
    barcode: string | null
  },
): boolean {
  const normalized = normalizeCatalogueText(query)
  if (!normalized) return true
  const arabic = normalizeCatalogueArabic(query)
  return normalizeCatalogueText(product.name).includes(normalized)
    || normalizeCatalogueArabic(product.name_ar ?? '').includes(arabic)
    || normalizeCatalogueText(product.sku ?? '').includes(normalized)
    || normalizeCatalogueText(product.barcode ?? '').includes(normalized)
}
