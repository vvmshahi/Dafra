import { normalizeBarcode } from '@/lib/barcodes/barcode'

export interface ScannerIndexEntry<TProduct, TUnit> {
  product: TProduct
  unit: TUnit
  source: 'barcode' | 'sku' | 'unit'
}

export type ScannerResolution<TProduct, TUnit> =
  | { status: 'found'; entry: ScannerIndexEntry<TProduct, TUnit> }
  | { status: 'conflict'; entries: ScannerIndexEntry<TProduct, TUnit>[] }
  | { status: 'unknown' }

export function createScannerIndex<TProduct, TUnit>(
  entries: Array<{ code: string | null | undefined; product: TProduct; unit: TUnit; source: ScannerIndexEntry<TProduct, TUnit>['source']; active?: boolean }>,
): Map<string, ScannerIndexEntry<TProduct, TUnit>[]> {
  const index = new Map<string, ScannerIndexEntry<TProduct, TUnit>[]>()
  for (const candidate of entries) {
    if (candidate.active === false) continue
    const code = normalizeBarcode(candidate.code ?? '').toLocaleLowerCase('en-US')
    if (!code) continue
    const current = index.get(code) ?? []
    current.push({ product: candidate.product, unit: candidate.unit, source: candidate.source })
    index.set(code, current)
  }
  return index
}

export function resolveScannerCode<TProduct, TUnit>(
  index: Map<string, ScannerIndexEntry<TProduct, TUnit>[]>,
  rawCode: string,
): ScannerResolution<TProduct, TUnit> {
  const entries = index.get(normalizeBarcode(rawCode).toLocaleLowerCase('en-US')) ?? []
  if (entries.length === 0) return { status: 'unknown' }
  if (entries.length > 1) return { status: 'conflict', entries }
  return { status: 'found', entry: entries[0] }
}

export interface ScannerCartLine {
  cartLineId: string
  productId: string
  quantity: number
  conversionToBase: number
}

export type ScannerCartMutation<TLine extends ScannerCartLine> =
  | { status: 'inserted' | 'incremented'; cart: TLine[]; quantity: number }
  | { status: 'out_of_stock'; cart: TLine[]; quantity: number }

export function applyScannerCartMutation<TLine extends ScannerCartLine>({
  cart,
  line,
  quantity = 1,
  stockQuantity,
  enforceStock,
}: {
  cart: TLine[]
  line: TLine
  quantity?: number
  stockQuantity: number | null
  enforceStock: boolean
}): ScannerCartMutation<TLine> {
  const existing = cart.find(item => item.cartLineId === line.cartLineId)
  const nextQuantity = (existing?.quantity ?? 0) + quantity
  const currentBaseQuantity = cart
    .filter(item => item.productId === line.productId)
    .reduce((total, item) => total + item.quantity * item.conversionToBase, 0)
  const nextBaseQuantity = currentBaseQuantity + quantity * line.conversionToBase
  if (
    enforceStock
    && stockQuantity !== null
    && nextBaseQuantity > stockQuantity + Number.EPSILON
  ) {
    return { status: 'out_of_stock', cart, quantity: existing?.quantity ?? 0 }
  }
  if (existing) {
    return {
      status: 'incremented',
      quantity: nextQuantity,
      cart: cart.map(item => item.cartLineId === line.cartLineId
        ? { ...item, quantity: nextQuantity }
        : item),
    }
  }
  return { status: 'inserted', quantity, cart: [...cart, { ...line, quantity }] }
}
