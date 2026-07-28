import type { BarcodeType } from './barcode'

export interface BarcodeQueueUnit {
  id: string
  name: string
  nameAr: string | null
  isBase: boolean
  price: string
}

export interface BarcodeQueueBarcode {
  id: string
  productUnitId: string
  value: string
  type: BarcodeType
  isPrimary: boolean
  isActive: boolean
}

export interface BarcodePrintQueueItem {
  key: string
  productId: string
  productName: string
  productNameAr: string | null
  sku: string | null
  unit: BarcodeQueueUnit
  barcode: BarcodeQueueBarcode | null
  copies: number
}

interface StoredQueue {
  schemaVersion: 1
  branchId: string
  savedAt: number
  items: BarcodePrintQueueItem[]
}

const MAX_QUEUE_AGE_MS = 8 * 60 * 60 * 1000
const key = (branchId: string) => `dafra:barcode-print-queue:v1:${branchId}`

const copies = (value: unknown) =>
  Math.max(1, Math.min(500, Math.floor(Number(value)) || 1))

export function queueItemKey(productId: string, unitId: string, barcodeId: string | null) {
  return `${productId}:${unitId}:${barcodeId ?? 'missing'}`
}

export function mergeBarcodePrintQueue(
  current: BarcodePrintQueueItem[],
  incoming: BarcodePrintQueueItem,
): BarcodePrintQueueItem[] {
  const keyValue = queueItemKey(incoming.productId, incoming.unit.id, incoming.barcode?.id ?? null)
  const index = current.findIndex(item => item.key === keyValue)
  const next = { ...incoming, key: keyValue, copies: copies(incoming.copies) }
  if (index < 0) return [...current, next]
  return current.map((item, itemIndex) => itemIndex === index
    ? { ...item, copies: Math.min(500, item.copies + next.copies) }
    : item)
}

export function updateBarcodeQueueCopies(
  current: BarcodePrintQueueItem[],
  itemKey: string,
  value: number,
): BarcodePrintQueueItem[] {
  return current.map(item => item.key === itemKey ? { ...item, copies: copies(value) } : item)
}

export function barcodeQueueTotal(items: BarcodePrintQueueItem[]): number {
  return items.reduce((total, item) => total + copies(item.copies), 0)
}

export function loadBarcodePrintQueue(
  branchId: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
  now = Date.now(),
): BarcodePrintQueueItem[] {
  try {
    const parsed = JSON.parse(storage.getItem(key(branchId)) ?? 'null') as StoredQueue | null
    if (!parsed || parsed.schemaVersion !== 1 || parsed.branchId !== branchId
      || now - parsed.savedAt > MAX_QUEUE_AGE_MS || !Array.isArray(parsed.items)) {
      storage.removeItem(key(branchId))
      return []
    }
    return parsed.items.slice(0, 100).map(item => ({
      ...item,
      copies: copies(item.copies),
      key: queueItemKey(item.productId, item.unit.id, item.barcode?.id ?? null),
    }))
  } catch {
    storage.removeItem(key(branchId))
    return []
  }
}

export function saveBarcodePrintQueue(
  branchId: string,
  items: BarcodePrintQueueItem[],
  storage: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage,
  now = Date.now(),
) {
  if (!items.length) {
    storage.removeItem(key(branchId))
    return
  }
  const payload: StoredQueue = {
    schemaVersion: 1,
    branchId,
    savedAt: now,
    items: items.slice(0, 100),
  }
  storage.setItem(key(branchId), JSON.stringify(payload))
}

export function clearBarcodePrintQueue(
  branchId: string,
  storage: Pick<Storage, 'removeItem'> = sessionStorage,
) {
  storage.removeItem(key(branchId))
}
