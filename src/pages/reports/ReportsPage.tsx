import { useState, useEffect } from 'react'
import { TrendingUp, BarChart2, FileText, CreditCard, Users, ShoppingCart, Download, Clock3, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Branch } from '@/types'
import {
  CompactDateRangeFilter,
  REPORT_DATE_PRESETS,
  type DatePreset,
  formatDateRangeLabel,
  getDateRange,
} from './reportUtils'
import SalesReport      from './SalesReport'
import ProfitLossReport from './ProfitLossReport'
import VatReport        from './VatReport'
import ExpenseReport    from './ExpenseReport'
import CustomerReport   from './CustomerReport'
import PurchaseReport   from './PurchaseReport'
import RegisterSessionsReport from './RegisterSessionsReport'
import type { PhaseAReportKind } from './pdf/reportPdfExporters'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'sessions' | 'sales' | 'pl' | 'vat' | 'expenses' | 'customers' | 'purchases'

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'sessions', label: 'Register Sessions', icon: Clock3 },
  { id: 'sales',     label: 'Sales',         icon: TrendingUp  },
  { id: 'pl',        label: 'Profit Estimate', icon: BarChart2   },
  { id: 'vat',       label: 'VAT Support',     icon: FileText    },
  { id: 'expenses',  label: 'Expenses',      icon: CreditCard  },
  { id: 'customers', label: 'Customers',     icon: Users       },
  { id: 'purchases', label: 'Purchases',     icon: ShoppingCart },
]

const PHASE_A_EXPORTS: Partial<Record<TabId, PhaseAReportKind>> = {
  sessions: 'sessions',
  sales: 'sales',
  pl: 'pl',
  vat: 'vat',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { profile, tenant, branch: authBranch } = useAuth()

  const [tab,       setTab]       = useState<TabId>('sessions')
  const [preset,    setPreset]    = useState<DatePreset>('today')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [branchId,  setBranchId]  = useState<string | null>(null)
  const [branches,  setBranches]  = useState<Branch[]>([])
  const [exporting, setExporting] = useState(false)

  // Init date range from preset
  useEffect(() => {
    const { start, end } = getDateRange('today')
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
        // Branch users default to their assigned branch. Owners/admin-style users
        // default to all tenant branches so reports do not silently filter to a stale profile branch.
        setBranchId(profile?.role === 'branch' && profile.branch_id ? profile.branch_id : null)
      })
  }, [profile?.tenant_id, profile?.branch_id, profile?.role])

  const handlePreset = (p: DatePreset) => {
    setPreset(p)
    if (p !== 'custom') {
      const { start, end } = getDateRange(p)
      setStartDate(start)
      setEndDate(end)
    }
  }

  const reportProps = { startDate, endDate, branchId }
  const exportKind = PHASE_A_EXPORTS[tab]
  const exportSupported = !!exportKind
  const selectedBranch = branchId
    ? branches.find(b => b.id === branchId) ?? (authBranch?.id === branchId ? authBranch : null)
    : branches.length === 1
      ? branches[0]
      : null
  const branchLabel = branchId
    ? selectedBranch?.name ?? 'Selected Branch'
    : branches.length === 1
      ? branches[0].name
      : 'All Branches'
  const exportDisabled = exporting || !startDate || !endDate

  const handleExport = async () => {
    if (!exportKind) {
      toast.info('PDF export for this report is coming in Phase PDF-B.')
      return
    }

    if (!startDate || !endDate) {
      toast.error('Choose a valid date range and try again.')
      return
    }

    setExporting(true)
    let pdfModule: typeof import('./pdf/reportPdfExporters') | null = null
    try {
      pdfModule = await import('./pdf/reportPdfExporters')
      await pdfModule.exportPhaseAReportPdf({
        reportKind: exportKind,
        startDate,
        endDate,
        branchId,
        tenant,
        branch: selectedBranch,
        profile,
        branchLabel,
      })
      toast.success('PDF report downloaded.')
    } catch (error) {
      console.error('Report PDF export failed', error)
      toast.error(pdfModule?.reportPdfErrorMessage(error) ?? 'PDF export failed. Please refresh and try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-gray-900 flex-1">Reports</h1>
        {exportSupported && (
          <button
            type="button"
            disabled={exportDisabled}
            onClick={handleExport}
            title="Download PDF report"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
              exportDisabled
                ? 'border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                : 'border-primary-200 bg-white text-primary-700 hover:bg-primary-50'
            }`}
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {exporting ? 'Exporting...' : 'Export PDF'}
          </button>
        )}
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
        <CompactDateRangeFilter
          preset={preset}
          startDate={startDate}
          endDate={endDate}
          presets={REPORT_DATE_PRESETS}
          onPreset={handlePreset}
          onStartDate={setStartDate}
          onEndDate={setEndDate}
        />

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
          Showing data from <span className="font-medium text-gray-600">{formatDateRangeLabel(startDate, endDate)}</span>
          {branchId && branches.length > 1 && (
            <> · <span className="font-medium text-gray-600">{branches.find(b => b.id === branchId)?.name}</span></>
          )}
        </p>
      )}

      {/* ── Active report ────────────────────────────────────── */}
      {tab === 'sessions' && startDate && endDate && (
        <RegisterSessionsReport branchId={branchId} startDate={startDate} endDate={endDate} />
      )}
      {tab !== 'sessions' && startDate && endDate && (
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
