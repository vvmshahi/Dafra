export interface LowStockProduct {
  stock_quantity: number | string | null
  min_stock_alert: number | string | null
  track_stock: boolean | null
  is_service: boolean | null
  is_active: boolean | null
  is_available: boolean | null
}

/**
 * Product stock is held in base units. Alternate packages inherit that stock;
 * they do not create an independent inventory balance.
 */
export function isLowStockProduct(product: LowStockProduct): boolean {
  if (product.is_service === true) return false
  if (product.track_stock !== true) return false
  if (product.is_active !== true) return false
  if (product.is_available !== true) return false

  const quantity = Number(product.stock_quantity)
  const threshold = Number(product.min_stock_alert)
  return Number.isFinite(quantity)
    && Number.isFinite(threshold)
    && threshold > 0
    && quantity <= threshold
}
