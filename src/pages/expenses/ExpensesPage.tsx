import { useState } from 'react'
import DailyExpensesTab from './DailyExpensesTab'
import FixedExpensesTab from './FixedExpensesTab'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Plus } from 'lucide-react'

type Tab = 'daily' | 'fixed'

export default function ExpensesPage() {
  const { t } = useTranslation('expenses')
  const [tab, setTab] = useState<Tab>('daily')
  const [addRequest, setAddRequest] = useState({ id: 0, tab: 'daily' as Tab })

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <PageHeader
        title={t('title')}
        description={t(tab === 'daily' ? 'dailyDescription' : 'fixedDescription')}
        actions={
          <Button onClick={() => setAddRequest(value => ({ id: value.id + 1, tab }))} className="bg-[#173f2a] hover:bg-[#22563b]">
            <Plus size={15} />
            {t(tab === 'daily' ? 'add' : 'addFixed')}
          </Button>
        }
      />

      {/* ── Tab switcher ────────────────────────────────────── */}
      <div className="flex items-center bg-white border border-primary-800/70 rounded-2xl p-1 w-fit shadow-card" role="tablist" aria-label={t('title')}>
        {([
          { key: 'daily',  label: t('tabs.daily') },
          { key: 'fixed',  label: t('tabs.fixed') },
        ] as { key: Tab; label: string }[]).map(tabOption => (
          <button
            key={tabOption.key}
            onClick={() => setTab(tabOption.key)}
            role="tab"
            aria-selected={tab === tabOption.key}
            className={`px-5 py-2 text-sm font-semibold rounded-xl transition-all duration-150 ${
              tab === tabOption.key
                ? 'bg-[#173f2a] text-white shadow-sm'
                : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {tabOption.label}
          </button>
        ))}
      </div>
      {/* ── Tab content ─────────────────────────────────────── */}
      {tab === 'daily'
        ? <DailyExpensesTab addRequest={addRequest.tab === 'daily' ? addRequest.id : 0} />
        : <FixedExpensesTab addRequest={addRequest.tab === 'fixed' ? addRequest.id : 0} />}
    </div>
  )
}
