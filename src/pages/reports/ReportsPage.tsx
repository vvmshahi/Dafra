import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { TrendingUp, BarChart2, FileText, CreditCard, Users, ShoppingCart, Download, Clock3, Loader2, Truck } from 'lucide-react'
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
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/ui/PageHeader'
import { resolveBranchDisplayName } from '@/lib/utils/localizedDisplayName.mjs'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TabId = 'sessions' | 'sales' | 'pl' | 'vat' | 'expenses' | 'customers' | 'purchases'

export const REPORT_TABS: { id: TabId; icon: React.ElementType }[] = [
  { id: 'sessions', icon: Clock3 }, { id: 'sales', icon: TrendingUp }, { id: 'pl', icon: BarChart2 },
  { id: 'vat', icon: FileText }, { id: 'expenses', icon: CreditCard }, { id: 'customers', icon: Users }, { id: 'purchases', icon: ShoppingCart },
]

export function ReportTabs({ active, onSelect }: { active: TabId; onSelect: (tab: TabId) => void }) {
  const { t } = useTranslation('reports')
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: TabId) {
    const currentIndex = REPORT_TABS.findIndex(item => item.id === current)
    let nextIndex: number | null = null
    const rtl = document.documentElement.dir === 'rtl'
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + (rtl ? -1 : 1) + REPORT_TABS.length) % REPORT_TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex + (rtl ? 1 : -1) + REPORT_TABS.length) % REPORT_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = REPORT_TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = REPORT_TABS[nextIndex].id
    onSelect(next)
    tabRefs.current[next]?.focus()
    tabRefs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" role="region" aria-label={t('tabs.label')} tabIndex={0}>
      <div className="flex items-center bg-white border border-gray-100 rounded-2xl p-1 w-max shadow-card" role="tablist" aria-label={t('tabs.label')}>
        {REPORT_TABS.map(tabItem => {
          const Icon = tabItem.icon
          return (
            <button
              key={tabItem.id}
              ref={node => { tabRefs.current[tabItem.id] = node }}
              id={`report-tab-${tabItem.id}`}
              type="button"
              role="tab"
              aria-selected={active === tabItem.id}
              aria-controls={`report-panel-${tabItem.id}`}
              tabIndex={active === tabItem.id ? 0 : -1}
              onClick={() => onSelect(tabItem.id)}
              onKeyDown={event => handleKeyDown(event, tabItem.id)}
              className={`flex min-h-10 items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl transition-[background-color,color,box-shadow] duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                active === tabItem.id
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={13} aria-hidden="true" />
              {t(`tabs.${tabItem.id}`)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const PHASE_A_EXPORTS: Partial<Record<TabId, PhaseAReportKind>> = {
  sessions: 'sessions',
  sales: 'sales',
  pl: 'pl',
  vat: 'vat',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { profile, tenant, branch: authBranch } = useAuth()
  const { t, i18n } = useTranslation('reports')
  const isArabic = i18n.resolvedLanguage?.startsWith('ar') === true

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
    ? resolveBranchDisplayName(selectedBranch, isArabic, t('filters.selectedBranch'))
    : branches.length === 1
      ? resolveBranchDisplayName(branches[0], isArabic, t('filters.selectedBranch'))
      : t('filters.allBranches')
  const exportDisabled = exporting || !startDate || !endDate

  const handleExport = async () => {
    if (!exportKind) {
      toast.info(t('export.unsupported'))
      return
    }

    if (!startDate || !endDate) {
      toast.error(t('export.invalidRange'))
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
      toast.success(t('export.success'))
    } catch (error) {
      console.error('Report PDF export failed', error)
      toast.error(pdfModule?.reportPdfErrorMessage(error) ?? t('export.failed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">

      {/* ── Page header ─────────────────────────────────────── */}
      <PageHeader
        title={t('title')}
        actions={(
          <>
          <Link
            to="/reports/suppliers"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <Truck size={14} />
            {t('tabs.suppliers')}
          </Link>
          {exportSupported && (
            <button
              type="button"
              disabled={exportDisabled}
              onClick={handleExport}
              title={t('export.download')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                exportDisabled
                  ? 'border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                  : 'border-primary-200 bg-white text-primary-700 hover:bg-primary-50'
              }`}
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t(exporting ? 'export.exporting' : 'export.pdf')}
            </button>
          )}
          </>
        )}
      />

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <ReportTabs active={tab} onSelect={setTab} />

      {/* ── Date range + branch filter ───────────────────────── */}
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
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
            className="input w-full py-1.5 text-sm sm:ms-auto sm:w-auto"
            value={branchId ?? ''}
            onChange={e => setBranchId(e.target.value || null)}
          >
            <option value="">{t('filters.allBranches')}</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{resolveBranchDisplayName(b, isArabic)}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Date range label ─────────────────────────────────── */}
      {startDate && endDate && (
        <p className="text-xs text-gray-400">
          {t('filters.showing', { range: formatDateRangeLabel(startDate, endDate, i18n.resolvedLanguage) })}
          {branchId && branches.length > 1 && (
            <> · <span className="font-medium text-gray-600">{branchLabel}</span></>
          )}
        </p>
      )}

      {/* ── Active report ────────────────────────────────────── */}
      {startDate && endDate && (
        <section id={`report-panel-${tab}`} role="tabpanel" aria-labelledby={`report-tab-${tab}`} tabIndex={0}>
          {tab === 'sessions' && <RegisterSessionsReport branchId={branchId} startDate={startDate} endDate={endDate} />}
          {tab === 'sales'     && <SalesReport      {...reportProps} />}
          {tab === 'pl'        && <ProfitLossReport  {...reportProps} />}
          {tab === 'vat'       && <VatReport         {...reportProps} />}
          {tab === 'expenses'  && <ExpenseReport     {...reportProps} />}
          {tab === 'customers' && <CustomerReport    {...reportProps} />}
          {tab === 'purchases' && <PurchaseReport    {...reportProps} />}
        </section>
      )}
    </div>
  )
}
