import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp, FileText, Loader2, Building2, Store,
  Plus, ArrowRight, CreditCard, Banknote,
  ShieldCheck, Eye, BadgePercent, Receipt, AlertCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Rial } from '@/components/ui/RiyalSymbol'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { saudiDateStr } from '@/lib/utils/date'
import { useAuth } from '@/hooks/useAuth'
import { productionStatusLabel } from '@/lib/zatca/status'
import type { ProductionOnboardingResponse } from '@/lib/zatca/api'
import { asArray, loadReportSummary } from '@/pages/reports/reportingRpc'
import {
  type RegisterSessionSummary,
  logRegisterSessionRpcError,
  normalizeRegisterSessionList,
  registerSessionLabel,
  registerSessionRpcErrorMessage,
  registerSessionTimeRange,
} from '@/lib/registerSessions'


// ── KPI stat card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, gradient, loading }: {
  label: string; value: React.ReactNode; sub: string
  icon: React.ElementType; gradient: string; loading?: boolean
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/70">{label}</p>
          {loading
            ? <div className="mt-1.5 h-7 w-24 bg-white/20 rounded animate-pulse" />
            : <p className="mt-1 text-xl font-bold text-white tracking-tight tabular-nums">{value}</p>
          }
          <p className="mt-0.5 text-[11px] text-white/60">{sub}</p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0 ml-3">
          <Icon size={17} className="text-white" />
        </div>
      </div>
      <div className="absolute -bottom-3 -right-3 w-20 h-20 rounded-full bg-white/5" />
    </div>
  )
}

// ── Branch detail card ────────────────────────────────────────────────────────

interface BranchStat {
  id: string
  name: string
  logo_url: string | null
  is_active: boolean
  is_main_branch: boolean
  zatca_phase: number
  todaySales: number
  todayCount: number
  todayCash:  number
  todayCard:  number
  sessionOpen: boolean
  sessionOpenedAt: string | null
  metricsAvailable: boolean
  registerSession?: RegisterSessionSummary | null
  registerSessionAvailable?: boolean
  productionStatus?: ProductionOnboardingResponse | null
  productionStatusReadable?: boolean
}

interface DashboardDailySale {
  date: string
  sales: number
}

interface BranchRow {
  id: string
  name: string
  logo_url: string | null
  is_active: boolean
  is_main_branch: boolean
  zatca_phase: number | null
}

interface DashboardSummary {
  totalSales: number
  totalCount: number
  totalCash: number
  totalCard: number
  totalVat: number
  totalExpenses: number
  dailySales: DashboardDailySale[]
  branchStats: BranchStat[]
}

const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  totalSales: 0,
  totalCount: 0,
  totalCash: 0,
  totalCard: 0,
  totalVat: 0,
  totalExpenses: 0,
  dailySales: [],
  branchStats: [],
}

function branchRowToStat(branch: BranchRow): BranchStat {
  return {
    id: branch.id,
    name: branch.name,
    logo_url: branch.logo_url,
    is_active: branch.is_active,
    is_main_branch: branch.is_main_branch,
    zatca_phase: branch.zatca_phase ?? 1,
    todaySales: 0,
    todayCount: 0,
    todayCash: 0,
    todayCard: 0,
    sessionOpen: false,
    sessionOpenedAt: null,
    metricsAvailable: false,
    registerSession: null,
    registerSessionAvailable: false,
    productionStatus: null,
    productionStatusReadable: (branch.zatca_phase ?? 1) !== 2,
  }
}

function numberOrZero(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeDashboardBranchStat(value: unknown): BranchStat | null {
  if (!isRecord(value)) return null
  const id = stringOrNull(pick(value, 'id', 'branch_id'))
  if (!id) return null
  const zatcaPhase = Math.trunc(numberOrZero(pick(value, 'zatca_phase', 'zatcaPhase'))) || 1
  const productionStatusValue = pick(value, 'productionStatus', 'production_status')
  return {
    id,
    name: stringOrNull(pick(value, 'name', 'branch_name')) ?? '',
    logo_url: stringOrNull(pick(value, 'logo_url', 'logoUrl')),
    is_active: booleanOr(pick(value, 'is_active', 'isActive'), true),
    is_main_branch: booleanOr(pick(value, 'is_main_branch', 'isMainBranch'), false),
    zatca_phase: zatcaPhase,
    todaySales: numberOrZero(pick(value, 'todaySales', 'today_sales')),
    todayCount: Math.trunc(numberOrZero(pick(value, 'todayCount', 'invoice_count', 'today_count'))),
    todayCash: numberOrZero(pick(value, 'todayCash', 'cash_total', 'cash_today')),
    todayCard: numberOrZero(pick(value, 'todayCard', 'card_total', 'card_today')),
    sessionOpen: booleanOr(pick(value, 'sessionOpen', 'session_open'), false),
    sessionOpenedAt: stringOrNull(pick(value, 'sessionOpenedAt', 'session_opened_at')),
    metricsAvailable: booleanOr(pick(value, 'metricsAvailable', 'metrics_available'), true),
    productionStatus: normalizeProductionStatus(productionStatusValue),
    productionStatusReadable: booleanOr(
      pick(value, 'productionStatusReadable', 'production_status_readable'),
      zatcaPhase === 2 ? hasProductionStatusField(productionStatusValue) : true,
    ),
  }
}

function normalizeProductionStatus(value: unknown): ProductionOnboardingResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const onboardingStatus = typeof record.onboardingStatus === 'string'
    ? record.onboardingStatus
    : typeof record.onboarding_status === 'string'
    ? record.onboarding_status
    : null

  if (!onboardingStatus) return null

  return {
    ok: onboardingStatus === 'production_connected',
    branchId: typeof record.branchId === 'string' ? record.branchId : typeof record.branch_id === 'string' ? record.branch_id : '',
    environment: 'production',
    onboardingStatus: onboardingStatus as ProductionOnboardingResponse['onboardingStatus'],
    connectedAt: typeof record.connectedAt === 'string' ? record.connectedAt : typeof record.connected_at === 'string' ? record.connected_at : null,
    disconnectedAt: typeof record.disconnectedAt === 'string' ? record.disconnectedAt : typeof record.disconnected_at === 'string' ? record.disconnected_at : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : typeof record.updated_at === 'string' ? record.updated_at : null,
  }
}

function hasProductionStatusField(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function rpcErrorDebug(error: unknown) {
  if (error && typeof error === 'object') {
    const rpcError = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    return {
      code: typeof rpcError.code === 'string' ? rpcError.code : null,
      message: typeof rpcError.message === 'string' ? rpcError.message : null,
      details: typeof rpcError.details === 'string' ? rpcError.details : null,
      hint: typeof rpcError.hint === 'string' ? rpcError.hint : null,
      error,
    }
  }
  return {
    code: null,
    message: error instanceof Error ? error.message : String(error ?? ''),
    details: null,
    hint: null,
    error,
  }
}

function logDashboardRpcError(functionName: string, params: Record<string, unknown>, error: unknown) {
  console.error('[DashboardPage] RPC failed', {
    functionName,
    params,
    ...rpcErrorDebug(error),
  })
}

function BranchCard({ branch, onView }: { branch: BranchStat; onView: () => void }) {
  const zatca = productionStatusLabel(branch.productionStatus)
  const session = branch.registerSession ?? null
  const hasSession = !!session?.sessionId
  const isOpen = session?.status === 'open'
  const sessionPrefix = isOpen ? 'Current Session' : 'Last Session'
  const cashFinalLabel = session?.status === 'closed' && session.actualCash !== null ? 'Difference' : 'Expected Cash'
  const cashFinalValue = session?.status === 'closed' && session.actualCash !== null
    ? session.cashDifference ?? 0
    : session?.expectedCash ?? 0
  const zatcaUnavailable = branch.zatca_phase === 2 && branch.productionStatusReadable === false
  const zatcaLabel = zatcaUnavailable ? 'Phase 2 status unavailable' : branch.zatca_phase === 2 ? zatca.label : 'Phase 1'
  const zatcaTone = zatcaUnavailable ? 'text-gray-400' : branch.zatca_phase === 2 && zatca.tone === 'success'
    ? 'text-emerald-600'
    : branch.zatca_phase === 2
    ? 'text-amber-600'
    : 'text-gray-400'

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4 ${!branch.is_active ? 'opacity-60' : ''}`}>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
          {branch.logo_url
            ? <img src={branch.logo_url} alt={branch.name} className="w-full h-full object-cover" />
            : <Store size={18} className="text-gray-400" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm text-gray-900 truncate">{branch.name}</span>
            {branch.is_main_branch && (
              <span className="text-[9px] font-bold bg-gold-500/10 text-gold-700 px-1.5 py-0.5 rounded-full ring-1 ring-gold-500/20 flex-shrink-0">
                MAIN
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Badge variant={branch.is_active ? 'success' : 'neutral'} dot className="text-[10px]">
              {branch.is_active ? 'Active' : 'Inactive'}
            </Badge>
            <span className={`flex items-center gap-0.5 text-[10px] ${zatcaTone}`}>
              <ShieldCheck size={10} className={branch.zatca_phase === 2 && !zatcaUnavailable && zatca.tone === 'success' ? 'text-emerald-500' : 'text-violet-400'} />
              {zatcaLabel}
            </span>
            {isOpen ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                Open
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
                Closed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Register Session */}
      <div className={`rounded-xl border px-3 py-3 ${
        session?.isLongOpen
          ? 'border-amber-200 bg-amber-50'
          : session?.status === 'open'
          ? 'border-emerald-100 bg-emerald-50'
          : 'border-gray-100 bg-gray-50'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
              {registerSessionLabel(session)}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-gray-600">
              {registerSessionTimeRange(session)}
            </p>
          </div>
          {session?.status && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              session.isLongOpen
                ? 'bg-amber-100 text-amber-700'
                : session.status === 'open'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-gray-200 text-gray-600'
            }`}>
              {session.isLongOpen ? 'Long open' : session.status === 'open' ? 'Open' : 'Closed'}
            </span>
          )}
        </div>
        {session?.isLongOpen && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-800">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            Close this register before starting a new shift.
          </p>
        )}
        {hasSession ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <p className="text-gray-400">{sessionPrefix} sales</p>
              <p className="font-bold text-gray-900 tabular-nums"><Rial amount={session.totalSales} /></p>
            </div>
            <div>
              <p className="text-gray-400">{cashFinalLabel}</p>
              <p className="font-bold text-gray-900 tabular-nums"><Rial amount={cashFinalValue} /></p>
            </div>
            <div>
              <p className="text-gray-400">Cash</p>
              <p className="font-semibold text-emerald-700 tabular-nums"><Rial amount={session.cashTotal} /></p>
            </div>
            <div>
              <p className="text-gray-400">Card</p>
              <p className="font-semibold text-blue-700 tabular-nums"><Rial amount={session.cardTotal} /></p>
            </div>
            <div>
              <p className="text-gray-400">Invoices</p>
              <p className="font-semibold text-gray-800 tabular-nums">{session.invoiceCount}</p>
            </div>
            <div>
              <p className="text-gray-400">VAT</p>
              <p className="font-semibold text-amber-700 tabular-nums"><Rial amount={session.vatTotal} /></p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-gray-400">No register session yet.</p>
        )}
      </div>

      {/* View Details */}
      <button
        onClick={onView}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all"
      >
        <Eye size={14} /> View Details
      </button>
    </div>
  )
}

// ── Welcome / no-branches state ───────────────────────────────────────────────

function WelcomeState({ onAddBranch }: { onAddBranch: () => void }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        {/* Illustration */}
        <div className="relative mx-auto mb-8 w-28 h-28">
          <div className="w-28 h-28 rounded-3xl bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28] flex items-center justify-center shadow-xl">
            <Building2 size={48} className="text-white/90" />
          </div>
          <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-2xl bg-gold-500 flex items-center justify-center shadow-md">
            <Plus size={18} className="text-[#0F2419]" />
          </div>
        </div>

        <h2 className="text-2xl font-black text-gray-900">Welcome to Meem!</h2>
        <p className="text-base font-medium text-gray-500 mt-2">
          You have not added any branches yet.
        </p>
        <p className="text-sm text-gray-400 mt-1 mb-8 leading-relaxed">
          Add your first branch to start selling, generate ZATCA-ready invoices, and use the POS.
        </p>

        <button
          onClick={onAddBranch}
          className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#1B6B3A] hover:bg-[#0F4A28] text-white font-bold rounded-2xl transition-colors shadow-lg text-sm"
        >
          <Plus size={16} /> Add Branch
        </button>

        <p className="text-xs text-gray-400 mt-5 leading-relaxed">
          Each branch gets its own invoices, POS terminal, and ZATCA credentials.
        </p>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [statsLoading,  setStatsLoading]  = useState(true)
  const [branchLoading, setBranchLoading] = useState(true)

  const [branchStats,   setBranchStats]   = useState<BranchStat[]>([])
  const [branchLoadError, setBranchLoadError] = useState('')
  const [dashboardLoadError, setDashboardLoadError] = useState('')
  const [registerSessionLoadError, setRegisterSessionLoadError] = useState('')

  const tid = profile?.tenant_id

  const loadStats = useCallback(async () => {
    // Don't update state if profile hasn't loaded yet — keeps loading=true so
    // we show skeletons instead of the "no branches" empty state.
    if (!tid) return
    setStatsLoading(true)
    setBranchLoading(true)
    setBranchLoadError('')
    setDashboardLoadError('')
    setRegisterSessionLoadError('')
    const today = saudiDateStr()
    let fallbackBranchStats: BranchStat[] = []
    let registerSessionsByBranch = new Map<string, RegisterSessionSummary>()
    let registerSessionAvailable = false
    try {
      const { data: branchRows, error: branchError } = await supabase
        .from('branches')
        .select('id, name, logo_url, is_active, is_main_branch, zatca_phase')
        .eq('tenant_id', tid)
        .order('is_main_branch', { ascending: false })
        .order('created_at', { ascending: true })

      if (branchError) {
        console.error('[DashboardPage] failed to load branches', branchError)
        setBranchLoadError('Branches could not be loaded. Refresh the page or open Settings > Branches to verify access.')
      } else {
        fallbackBranchStats = ((branchRows as BranchRow[]) ?? []).map(branchRowToStat)
      }

      try {
        const { data, error } = await (supabase as any).rpc('get_register_session_summary', {
        })
        if (error) throw error
        registerSessionsByBranch = new Map(
          normalizeRegisterSessionList(data).map(session => [session.branchId, session]),
        )
        registerSessionAvailable = true
      } catch (sessionError) {
        logRegisterSessionRpcError('get_register_session_summary', {}, sessionError)
        setRegisterSessionLoadError(registerSessionRpcErrorMessage(sessionError))
      }

      const summaryParams = { p_branch_id: null, p_start_date: today, p_end_date: today }
      let summaryRecord: Record<string, unknown> = EMPTY_DASHBOARD_SUMMARY as unknown as Record<string, unknown>
      try {
        const summary = await loadReportSummary<DashboardSummary>(
          'get_dashboard_summary',
          summaryParams,
          EMPTY_DASHBOARD_SUMMARY,
        )
        summaryRecord = summary as Record<string, unknown>
      } catch (summaryError) {
        logDashboardRpcError('get_dashboard_summary', summaryParams, summaryError)
        setDashboardLoadError('Branch metadata could not be refreshed. Register Session totals are still shown.')
      }

      const rpcStats = asArray<unknown>(pick(summaryRecord, 'branchStats', 'branch_stats'))
        .map(normalizeDashboardBranchStat)
        .filter((branch): branch is BranchStat => !!branch)
      const rpcStatsById = new Map(rpcStats.map(branch => [branch.id, branch]))
      const stats = fallbackBranchStats.length > 0
        ? fallbackBranchStats.map(fallback => {
            const branch = rpcStatsById.get(fallback.id)
            return {
              ...fallback,
              ...branch,
              todaySales: numberOrZero(branch?.todaySales),
              todayCount: Math.trunc(numberOrZero(branch?.todayCount)),
              todayCash: numberOrZero(branch?.todayCash),
              todayCard: numberOrZero(branch?.todayCard),
              metricsAvailable: !!branch,
              registerSession: registerSessionsByBranch.get(fallback.id) ?? null,
              registerSessionAvailable,
              productionStatus: branch?.productionStatus ?? null,
              productionStatusReadable: (fallback.zatca_phase ?? 1) === 2
                ? Boolean(branch?.productionStatusReadable)
                : true,
            }
          })
        : rpcStats.map(branch => ({
            ...branch,
            todaySales: numberOrZero(branch.todaySales),
            todayCount: Math.trunc(numberOrZero(branch.todayCount)),
            todayCash: numberOrZero(branch.todayCash),
            todayCard: numberOrZero(branch.todayCard),
            metricsAvailable: true,
            registerSession: registerSessionsByBranch.get(branch.id) ?? null,
            registerSessionAvailable,
            productionStatus: branch.productionStatus,
            productionStatusReadable: (branch.zatca_phase ?? 1) === 2
              ? Boolean(branch.productionStatusReadable)
              : true,
          }))
      setBranchStats(stats)
    } catch (error) {
      logDashboardRpcError('dashboard_register_session_load', { p_branch_id: null }, error)
      setDashboardLoadError('Dashboard register session data could not be loaded. Refresh and try again.')
      setBranchStats(fallbackBranchStats)
    } finally {
      setStatsLoading(false)
      setBranchLoading(false)
    }
  }, [tid])

  useEffect(() => { loadStats() }, [loadStats])

  // Realtime: re-fetch when branches or invoices change so the dashboard
  // updates immediately when a branch creates a sale at the POS.
  useEffect(() => {
    if (!tid) return
    const channel = supabase
      .channel(`dashboard-live-${tid}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'branches',
        filter: `tenant_id=eq.${tid}`,
      }, () => loadStats())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'invoices',
        filter: `tenant_id=eq.${tid}`,
      }, () => loadStats())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payments',
        filter: `tenant_id=eq.${tid}`,
      }, () => loadStats())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `tenant_id=eq.${tid}`,
      }, () => loadStats())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'pos_sessions',
        filter: `tenant_id=eq.${tid}`,
      }, () => loadStats())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tid, loadStats])

  // Show WelcomeState ONLY after loading completes with zero branches.
  // While branchLoading===true (profile not yet loaded, or fetch in flight)
  // we fall through to the full layout with skeleton cards — never flash
  // the empty state prematurely.
  if (!branchLoading && !branchLoadError && branchStats.length === 0) {
    return <WelcomeState onAddBranch={() => navigate('/settings')} />
  }

  const sessionSummaries = branchStats
    .map(branch => branch.registerSession ?? null)
    .filter((session): session is RegisterSessionSummary => !!session?.sessionId)
  const openSessionCount = sessionSummaries.filter(session => session.status === 'open').length
  const lastSessionCount = sessionSummaries.filter(session => session.status !== 'open').length
  const sessionTotals = sessionSummaries.reduce(
    (totals, session) => ({
      sales: totals.sales + session.totalSales,
      invoices: totals.invoices + session.invoiceCount,
      cash: totals.cash + session.cashTotal,
      card: totals.card + session.cardTotal,
      vat: totals.vat + session.vatTotal,
      expectedCash: totals.expectedCash + session.expectedCash,
    }),
    { sales: 0, invoices: 0, cash: 0, card: 0, vat: 0, expectedCash: 0 },
  )
  const sessionSub = registerSessionLoadError
    ? 'Retry to load register sessions'
    : sessionSummaries.length === 0
    ? 'No register sessions yet'
    : `${openSessionCount} current · ${lastSessionCount} last`
  const sessionAmount = (amount: number) => registerSessionLoadError ? 'Unavailable' : <Rial amount={amount} />
  const sessionCount = registerSessionLoadError ? 'Unavailable' : String(sessionTotals.invoices)

  return (
    <div className="space-y-6">

      {/* ── Register Session KPIs ────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Session Sales" value={sessionAmount(sessionTotals.sales)}
          sub={sessionSub}
          icon={TrendingUp} gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]" loading={statsLoading} />
        <StatCard label="Session Invoices" value={sessionCount}
          sub={sessionSub}
          icon={FileText} gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]" loading={statsLoading} />
        <StatCard label="Session Cash" value={sessionAmount(sessionTotals.cash)}
          sub="Cash and split cash"
          icon={Banknote} gradient="bg-gradient-to-br from-[#059669] to-[#047857]" loading={statsLoading} />
        <StatCard label="Session Card" value={sessionAmount(sessionTotals.card)}
          sub="Card and split card"
          icon={CreditCard} gradient="bg-gradient-to-br from-[#0891b2] to-[#0e7490]" loading={statsLoading} />
        <StatCard label="Session VAT" value={sessionAmount(sessionTotals.vat)}
          sub="Register-session VAT"
          icon={BadgePercent} gradient="bg-gradient-to-br from-[#b45309] to-[#92400e]" loading={statsLoading} />
        <StatCard label="Expected Cash" value={sessionAmount(sessionTotals.expectedCash)}
          sub="Across shown sessions"
          icon={Receipt} gradient="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6]" loading={statsLoading} />
      </div>

      {(branchLoadError || dashboardLoadError || registerSessionLoadError) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
          <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Dashboard data needs a refresh</p>
            <p className="text-xs text-amber-800 mt-0.5">{branchLoadError || dashboardLoadError || registerSessionLoadError}</p>
          </div>
          <button
            type="button"
            onClick={loadStats}
            className="text-xs font-semibold text-amber-900 hover:text-amber-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Branch grid ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Building2 size={15} className="text-gray-400" /> Branch Register Sessions
          </h2>
          <button onClick={() => navigate('/settings')}
            className="text-xs text-primary-600 font-medium hover:text-primary-700 flex items-center gap-1">
            Manage <ArrowRight size={12} />
          </button>
        </div>
        {branchLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 h-52 animate-pulse" />
            ))}
          </div>
        ) : branchLoadError && branchStats.length === 0 ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-900">Branches could not be loaded</p>
                <p className="text-xs text-amber-800 mt-1">{branchLoadError}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {branchStats.map(b => (
              <BranchCard
                key={b.id}
                branch={b}
                onView={() => navigate(`/dashboard/branches/${b.id}`)}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
