import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import ProductStockTab from './ProductStockTab'
import StockOverviewTab from './StockOverviewTab'
import { useAuth } from '@/hooks/useAuth'
import { isStockModuleVisible, resolveBusinessType } from '@/lib/utils/businessType'

interface InventoryRouteState {
  stockTab?: 'product' | 'materials'
  openProductStockReceiptFor?: string
}

export default function InventoryPage() {
  const { tenant, branch } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const routeState = location.state as InventoryRouteState | null
  const businessType = resolveBusinessType(tenant?.business_type)
  const isTrading = businessType === 'trading'
  const requestedStockTab = routeState?.stockTab
  const initialReceiptProductId =
    typeof routeState?.openProductStockReceiptFor === 'string'
      ? routeState.openProductStockReceiptFor
      : null
  const stockVisible = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })
  const [activeTab, setActiveTab] = useState<'product' | 'materials'>(isTrading ? 'product' : 'materials')

  useEffect(() => {
    if (isTrading && requestedStockTab === 'product') {
      setActiveTab('product')
      return
    }

    setActiveTab(isTrading ? 'product' : 'materials')
  }, [isTrading, branch?.id, requestedStockTab])

  const clearInventoryRouteState = useCallback(() => {
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, navigate])

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

      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 flex-1">Stock</h1>
      </div>
      <p className="text-xs text-gray-400 -mt-3">
        {isTrading
          ? 'Manage stock for saleable products and keep raw materials separate.'
          : 'Track physical inventory items and current quantities.'}
      </p>

      {isTrading ? (
        <>
          <div className="inline-flex rounded-xl border border-gray-100 bg-white p-1 shadow-card">
            {[
              { key: 'product' as const, label: 'Product Stock' },
              { key: 'materials' as const, label: 'Raw Materials' },
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'product' ? (
            <ProductStockTab
              initialReceiptProductId={initialReceiptProductId}
              onInitialReceiptHandled={clearInventoryRouteState}
            />
          ) : (
            <StockOverviewTab />
          )}
        </>
      ) : (
        <StockOverviewTab />
      )}
    </div>
  )
}
