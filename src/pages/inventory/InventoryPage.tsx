import { useState } from 'react'
import StockOverviewTab from './StockOverviewTab'
import PurchaseHistoryTab from './PurchaseHistoryTab'

type Tab = 'stock' | 'purchases'

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock')

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 flex-1">Inventory</h1>
      </div>

      {/* ── Tab switcher ────────────────────────────────────── */}
      <div className="flex items-center bg-white border border-gray-100 rounded-2xl p-1 w-fit shadow-card">
        {([
          { key: 'stock',     label: 'Stock Overview'   },
          { key: 'purchases', label: 'Purchase History' },
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
