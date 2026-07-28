export type StockAdjustmentOperation = 'add' | 'remove'

export interface StockAdjustmentProjection {
  quantity: number | null
  delta: number | null
  projectedStock: number | null
  error: 'invalid' | 'exceedsAvailable' | null
}

export function isPositiveQuantityInputDraft(value: string): boolean {
  return value === '' || /^\d*(?:\.\d{0,3})?$/.test(value)
}

export function projectStockAdjustment(
  currentStock: number,
  input: string,
  operation: StockAdjustmentOperation,
): StockAdjustmentProjection {
  if (!input.trim()) {
    return { quantity: null, delta: null, projectedStock: null, error: null }
  }

  const quantity = Number(input)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { quantity: null, delta: null, projectedStock: null, error: 'invalid' }
  }

  const delta = operation === 'add' ? quantity : -quantity
  const projectedStock = currentStock + delta
  if (projectedStock < 0) {
    return { quantity, delta, projectedStock, error: 'exceedsAvailable' }
  }

  return { quantity, delta, projectedStock, error: null }
}
