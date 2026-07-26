import { useState } from 'react'
import DailyExpensesTab from './DailyExpensesTab'
import FixedExpensesTab from './FixedExpensesTab'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/PageHeader'

type Tab = 'daily' | 'fixed'

export default function ExpensesPage() {
  const { t } = useTranslation('expenses')
  const [tab, setTab] = useState<Tab>('daily')

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <PageHeader title={t('title')} />

      {/* ── Tab switcher ────────────────────────────────────── */}
      <div className="flex items-center bg-white border border-gray-100 rounded-2xl p-1 w-fit shadow-card">
        {([
          { key: 'daily',  label: t('daily') },
          { key: 'fixed',  label: t('fixed') },
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
