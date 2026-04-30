import { useState } from 'react'
import DailyExpensesTab from './DailyExpensesTab'
import FixedExpensesTab from './FixedExpensesTab'

type Tab = 'daily' | 'fixed'

export default function ExpensesPage() {
  const [tab, setTab] = useState<Tab>('daily')

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 flex-1">Expenses</h1>
      </div>

      {/* ── Tab switcher ────────────────────────────────────── */}
      <div className="flex items-center bg-white border border-gray-100 rounded-2xl p-1 w-fit shadow-card">
        {([
          { key: 'daily',  label: 'Daily Expenses'  },
          { key: 'fixed',  label: 'Fixed Expenses'  },
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
      {tab === 'daily' ? <DailyExpensesTab /> : <FixedExpensesTab />}
    </div>
  )
}
