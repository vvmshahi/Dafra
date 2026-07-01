import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import StockOverviewTab from './StockOverviewTab'
import PurchaseHistoryTab from './PurchaseHistoryTab'
import { useAuth } from '@/hooks/useAuth'
import { resolveBusinessType } from '@/lib/utils/businessType'

type Tab = 'stock' | 'purchases'

export default function InventoryPage() {
  const { tenant } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'purchases' ? 'purchases' : 'stock'
  const [tab, setTabState] = useState<Tab>(initialTab)

  useEffect(() => {
    setTabState(searchParams.get('tab') === 'purchases' ? 'purchases' : 'stock')
  }, [searchParams])

  function setTab(nextTab: Tab) {
    setTabState(nextTab)
    setSearchParams({ tab: nextTab })
  }
  const isService = resolveBusinessType(tenant?.business_type) === 'service'

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 flex-1">
          {tab === 'purchases' ? 'Purchases' : 'Stock'}
        </h1>
      </div>
      <p className="text-xs text-gray-400 -mt-3">
        {isService
          ? 'Service business: use purchases for materials and business purchases. Stock remains available when needed.'
          : 'Trading business: use stock and purchases to track products and suppliers.'}
      </p>

      {/* ── Tab switcher ────────────────────────────────────── */}
      <div className="flex items-center bg-white border border-gray-100 rounded-2xl p-1 w-fit shadow-card">
        {([
          { key: 'stock',     label: 'Stock Overview'   },
          { key: 'purchases', label: 'Purchases' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2 text-sm font-semibold rounded-xl transition-all duration-150 ${
              tab === t.key
                ? 'bg-primary-500 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────────── */}
      {tab === 'stock' ? <StockOverviewTab /> : <PurchaseHistoryTab />}
    </div>
  )
}
