import { useState, useEffect } from 'react'
import { TrendingUp, BarChart2, FileText, CreditCard, Users, ShoppingCart, Download } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Branch } from '@/types'
import { type DatePreset, getDateRange } from './reportUtils'
import SalesReport      from './SalesReport'
import ProfitLossReport from './ProfitLossReport'
import VatReport        from './VatReport'
import ExpenseReport    from './ExpenseReport'
import CustomerReport   from './CustomerReport'
import PurchaseReport   from './PurchaseReport'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'sales' | 'pl' | 'vat' | 'expenses' | 'customers' | 'purchases'

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'sales',     label: 'Sales',         icon: TrendingUp  },
  { id: 'pl',        label: 'Profit Estimate', icon: BarChart2   },
  { id: 'vat',       label: 'VAT Support',     icon: FileText    },
  { id: 'expenses',  label: 'Expenses',      icon: CreditCard  },
  { id: 'customers', label: 'Customers',     icon: Users       },
  { id: 'purchases', label: 'Purchases',     icon: ShoppingCart },
]

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today',      label: 'Today'      },
  { id: 'yesterday',  label: 'Yesterday'  },
  { id: 'this_week',  label: 'This Week'  },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'custom',     label: 'Custom'     },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { profile } = useAuth()

  const [tab,       setTab]       = useState<TabId>('sales')
  const [preset,    setPreset]    = useState<DatePreset>('this_month')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [branchId,  setBranchId]  = useState<string | null>(null)
  const [branches,  setBranches]  = useState<Branch[]>([])

  // Init date range from preset
  useEffect(() => {
    const { start, end } = getDateRange('this_month')
    setStartDate(start)
    setEndDate(end)
  }, [])

  // Fetch branches
  useEffect(() => {
    const tid = profile?.tenant_id
    if (!tid) return
    supabase.from('branches').select('*').eq('tenant_id', tid).eq('is_active', true).order('name')
      .then(({ data }) => {
        const list = (data ?? []) as unknown as Branch[]
        setBranches(list)
        // Default to user's own branch
        if (profile?.branch_id) setBranchId(profile.branch_id)
      })
  }, [profile?.tenant_id, profile?.branch_id])

  const handlePreset = (p: DatePreset) => {
    setPreset(p)
    if (p !== 'custom') {
      const { start, end } = getDateRange(p)
      setStartDate(start)
      setEndDate(end)
    }
  }

  const reportProps = { startDate, endDate, branchId }

  return (
    <div className="space-y-4">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 flex-1">Reports</h1>
        <button
          disabled
          title="Export — coming soon"
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-400 cursor-not-allowed opacity-60"
        >
          <Download size={14} />
          Export
        </button>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center bg-white border border-gray-100 rounded-2xl p-1 w-max shadow-card">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-150 whitespace-nowrap ${
                  tab === t.id
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={13} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Date range + branch filter ───────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Preset pills */}
        <div className="flex items-center gap-1 p-1 bg-white border border-gray-100 rounded-xl shadow-card flex-wrap">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => handlePreset(p.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                preset === p.id
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="input py-1.5 text-sm w-36"
              value={startDate}
              max={endDate}
              onChange={e => setStartDate(e.target.value)}
            />
            <span className="text-gray-400 text-sm">→</span>
            <input
              type="date"
              className="input py-1.5 text-sm w-36"
              value={endDate}
              min={startDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        )}

        {/* Branch selector */}
        {branches.length > 1 && (
          <select
            className="input py-1.5 text-sm w-auto ml-auto"
            value={branchId ?? ''}
            onChange={e => setBranchId(e.target.value || null)}
          >
            <option value="">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Date range label ─────────────────────────────────── */}
      {startDate && endDate && (
        <p className="text-xs text-gray-400">
          Showing data from{' '}
          <span className="font-medium text-gray-600">
            {new Date(startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          {' '}to{' '}
          <span className="font-medium text-gray-600">
            {new Date(endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </span>
          {branchId && branches.length > 1 && (
            <> · <span className="font-medium text-gray-600">{branches.find(b => b.id === branchId)?.name}</span></>
          )}
        </p>
      )}

      {/* ── Active report ────────────────────────────────────── */}
      {startDate && endDate && (
        <>
          {tab === 'sales'     && <SalesReport      {...reportProps} />}
          {tab === 'pl'        && <ProfitLossReport  {...reportProps} />}
          {tab === 'vat'       && <VatReport         {...reportProps} />}
          {tab === 'expenses'  && <ExpenseReport     {...reportProps} />}
          {tab === 'customers' && <CustomerReport    {...reportProps} />}
          {tab === 'purchases' && <PurchaseReport    {...reportProps} />}
        </>
      )}
    </div>
  )
}
