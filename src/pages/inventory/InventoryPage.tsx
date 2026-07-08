import { Link } from 'react-router-dom'
import StockOverviewTab from './StockOverviewTab'
import { useAuth } from '@/hooks/useAuth'
import { isStockModuleVisible } from '@/lib/utils/businessType'

export default function InventoryPage() {
  const { tenant, branch } = useAuth()
  const stockVisible = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })

  if (!stockVisible) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Stock</h1>
          <p className="mt-1 text-xs text-gray-400">
            Track physical inventory items and current quantities.
          </p>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/70 p-5 shadow-card">
          <p className="text-sm font-semibold text-amber-900">
            Stock is disabled for this branch.
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-amber-700">
            Purchases are still available for supplier bills and materials.
          </p>
          <Link
            to="/purchases"
            className="mt-4 inline-flex items-center rounded-xl bg-primary-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-600"
          >
            Go to Purchases
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 flex-1">Stock</h1>
      </div>
      <p className="text-xs text-gray-400 -mt-3">
        Track physical inventory items and current quantities.
      </p>

      <StockOverviewTab />
    </div>
  )
}
