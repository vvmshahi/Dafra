import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp, FileText, Receipt, CreditCard, AlertTriangle,
  ArrowRight, CheckCircle2, Clock, AlertCircle, Loader2,
  Package, Banknote, BadgePercent,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { saudiDateStr } from '@/lib/utils/date'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import { Rial } from '@/components/ui/RiyalSymbol'
import { productionStatusLabel } from '@/lib/zatca/status'
import { isPermanentDemoSandboxBranch } from '@/lib/zatca/submission'
import type { ProductionOnboardingResponse } from '@/lib/zatca/api'
import { asArray, loadReportSummary } from '@/pages/reports/reportingRpc'
import {
  type RegisterSessionSummary,
  formatSaudiSessionDateTime,
  logRegisterSessionRpcError,
  normalizeRegisterSession,
  registerSessionLabel,
  registerSessionRpcErrorMessage,
  registerSessionTimeRange,
} from '@/lib/registerSessions'

const db = () => supabase as any

const statusConfig = {
  posted:  { variant: 'success' as const, label: 'Posted',  icon: CheckCircle2 },
  draft:   { variant: 'neutral' as const, label: 'Draft',   icon: AlertCircle },
  paid:    { variant: 'success' as const, label: 'Paid',    icon: CheckCircle2 },
  pending: { variant: 'warning' as const, label: 'Pending', icon: Clock },
}

const zatcaIndicatorClass = {
  success: 'bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.72)]',
  warning: 'bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.70)]',
  danger: 'bg-red-300 shadow-[0_0_16px_rgba(252,165,165,0.70)]',
  neutral: 'bg-white/55 shadow-[0_0_14px_rgba(255,255,255,0.38)]',
  info: 'bg-blue-300 shadow-[0_0_16px_rgba(147,197,253,0.70)]',
} as const

interface DashboardBranchStat {
  id: string
  name: string
  zatca_phase: number
  todaySales: number
  todayCount: number
  todayCash: number
  todayCard: number
  productionStatus?: ProductionOnboardingResponse | null
}

interface DashboardDailySale {
  date: string
  sales: number
}

interface DashboardSummary {
  totalSales: number
  totalCount: number
  totalCash: number
  totalCard: number
  totalVat: number
  totalExpenses: number
  dailySales: DashboardDailySale[]
  branchStats: DashboardBranchStat[]
}

interface RecentInvoiceRow {
  id: string
  invoiceNumber?: string
  invoice_number?: string
  customerName?: string | null
  customer_name?: string | null
  totalAmount?: number
  total_amount?: number
  displayTotal?: number
  display_total?: number
  status: string
  invoiceDate?: string
  invoice_date?: string
  documentType?: string
  zatca_invoice_type?: string
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

function StatCard({ label, value, sub, icon: Icon, gradient, loading }: {
  label: string; value: React.ReactNode; sub: string
  icon: React.ElementType; gradient: string; loading?: boolean
}) {
  return (
    <div className={`relative min-h-[122px] overflow-hidden rounded-2xl p-4 shadow-sm ${gradient}`}>
      <div className="flex h-full items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/70">{label}</p>
          {loading
            ? <div className="mt-1.5 h-7 w-24 bg-white/20 rounded animate-pulse" />
            : <p className="mt-2 text-2xl font-black text-white tracking-tight tabular-nums">{value}</p>
          }
          <p className="mt-2 text-xs leading-5 text-white/65">{sub}</p>
        </div>
        <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0 shadow-inner shadow-white/10">
          <Icon size={17} className="text-white" />
        </div>
      </div>
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-white/5" />
    </div>
  )
}

function RegisterSessionPanel({ session, loading, error, children }: {
  session: RegisterSessionSummary | null
  loading: boolean
  error: string
  children?: React.ReactNode
}) {
  const title = registerSessionLabel(session)
  const hasSession = !!session?.sessionId
  const isOpen = session?.status === 'open'
  const labelPrefix = isOpen ? 'Session' : 'Last Session'
  const cashFinalLabel = session?.status === 'closed' && session.actualCash !== null ? 'Difference' : 'Expected Cash'
  const cashFinalValue = session?.status === 'closed' && session.actualCash !== null
    ? session.cashDifference ?? 0
    : session?.expectedCash ?? 0
  const grossSales = session ? session.totalSales + session.creditNoteTotal : 0
  return (
    <section className="space-y-4">
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <div key={i} className="h-28 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
          {children}
        </div>
      ) : !hasSession ? (
        <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
          <div className="rounded-2xl border border-gray-100 bg-white px-5 py-6 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900">No Register Session</h2>
            <p className="mt-1 text-sm text-gray-500">Open a register to start tracking sales for this shift.</p>
          </div>
          {children}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <StatCard
              label="Gross Sales"
              value={<Rial amount={grossSales} />}
              sub={`${session.invoiceCount} invoice${session.invoiceCount !== 1 ? 's' : ''}`}
              icon={TrendingUp}
              gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]"
            />
            <StatCard
              label="Credit Notes"
              value={<Rial amount={session.creditNoteTotal} />}
              sub="Refund documents"
              icon={Receipt}
              gradient="bg-gradient-to-br from-[#64748b] to-[#334155]"
            />
            <StatCard
              label="Net Sales"
              value={<Rial amount={session.totalSales} />}
              sub="Gross less credit notes"
              icon={TrendingUp}
              gradient="bg-gradient-to-br from-[#0e6f53] to-[#0F4A28]"
            />
            <StatCard
              label={`${labelPrefix} Invoices`}
              value={String(session.invoiceCount)}
              sub={isOpen ? 'Current register' : 'Closed register'}
              icon={FileText}
              gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]"
            />
            <StatCard
              label={`${labelPrefix} Cash`}
              value={<Rial amount={session.cashTotal} />}
              sub="Cash and split cash"
              icon={Banknote}
              gradient="bg-gradient-to-br from-[#059669] to-[#047857]"
            />
            <StatCard
              label={`${labelPrefix} Card`}
              value={<Rial amount={session.cardTotal} />}
              sub="Card and split card"
              icon={CreditCard}
              gradient="bg-gradient-to-br from-[#0891b2] to-[#0e7490]"
            />
            <StatCard
              label="Net VAT"
              value={<Rial amount={session.vatTotal} />}
              sub="Session net VAT"
              icon={BadgePercent}
              gradient="bg-gradient-to-br from-[#b45309] to-[#92400e]"
            />
            <StatCard
              label={cashFinalLabel}
              value={<Rial amount={cashFinalValue} />}
              sub={session.status === 'closed' && session.actualCash !== null ? 'Actual vs expected' : 'Expected in drawer'}
              icon={Receipt}
              gradient="bg-gradient-to-br from-[#4f46e5] to-[#3730a3]"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[3fr_1fr]">
            <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 bg-gradient-to-r from-[#F7FAF6] to-white px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-600">Current Register Session</p>
                    <h2 className="mt-1 text-lg font-black text-gray-950">{title}</h2>
                    <p className="mt-1 text-xs text-gray-500">{registerSessionTimeRange(session)}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${
                    session.isLongOpen
                      ? 'bg-amber-100 text-amber-700'
                      : session.status === 'open'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {session.isLongOpen ? 'Long open' : session.status === 'open' ? 'Open' : 'Closed'}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                {(session.status === 'open'
                  ? [
                    { label: 'Opened', value: session.openedAt ? formatSaudiSessionDateTime(session.openedAt) : 'Earlier' },
                    { label: 'Opening cash', value: <Rial amount={session.openingCash} /> },
                    { label: 'Expected cash', value: <Rial amount={session.expectedCash} />, emphasis: true },
                    { label: 'Credit notes/refunds', value: <Rial amount={session.creditNoteTotal} /> },
                    { label: 'Expenses', value: <Rial amount={session.expensesTotal} /> },
                  ]
                  : [
                    { label: 'Closed', value: session.closedAt ? formatSaudiSessionDateTime(session.closedAt) : 'Closed register' },
                    { label: 'Opening cash', value: <Rial amount={session.openingCash} /> },
                    { label: 'Actual cash', value: <Rial amount={session.actualCash ?? 0} /> },
                    { label: 'Difference', value: <Rial amount={session.cashDifference ?? 0} />, emphasis: true },
                    { label: 'Credit notes/refunds', value: <Rial amount={session.creditNoteTotal} /> },
                    { label: 'Expenses', value: <Rial amount={session.expensesTotal} /> },
                  ]).map(item => (
                  <div key={item.label} className={`rounded-2xl border px-4 py-3 ${
                    item.emphasis
                      ? 'border-primary-100 bg-primary-50'
                      : 'border-gray-100 bg-gray-50/70'
                  }`}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{item.label}</p>
                    <p className={`mt-1 text-sm font-black tabular-nums ${item.emphasis ? 'text-primary-700' : 'text-gray-900'}`}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              {session.isLongOpen && (
                <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-3">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                  <p className="text-xs text-amber-800">
                    This register session has been open since {session.openedAt ? formatSaudiSessionDateTime(session.openedAt) : 'earlier'}. Close it before starting a new shift.
                  </p>
                </div>
              )}
            </div>
            {children}
          </div>
        </>
      )}
    </section>
  )
}

function QuickActionsPanel({ onNavigate, lowStock, lowStockLoading }: {
  onNavigate: (path: string) => void
  lowStock: Array<{ name: string }>
  lowStockLoading: boolean
}) {
  const actions = [
    { label: 'New Sale', desc: 'Open POS', icon: Receipt, path: '/pos', primary: true },
    { label: 'Expenses', desc: 'Record costs', icon: CreditCard, path: '/expenses', primary: false },
    { label: 'Invoices', desc: 'Review receipts', icon: FileText, path: '/invoices', primary: false },
  ]

  return (
    <div className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-black text-gray-900">Quick Actions</h2>
        <p className="mt-0.5 text-xs text-gray-400">Daily branch workflow</p>
      </div>

      <div className="grid gap-2.5">
        {actions.map(action => (
          <button key={action.label} onClick={() => onNavigate(action.path)}
            className={`group flex min-h-[68px] w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-all ${
              action.primary
                ? 'bg-[#0F2419] text-white shadow-sm hover:bg-[#173F2F]'
                : 'border border-gray-100 bg-gray-50/80 hover:border-primary-100 hover:bg-primary-50/60'
            }`}
          >
            <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
              action.primary ? 'bg-gold-400/20 text-gold-200' : 'border border-gray-200 bg-white text-gray-500 group-hover:text-primary-600'
            }`}>
              <action.icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-black ${action.primary ? 'text-white' : 'text-gray-900'}`}>
                {action.label}
              </p>
              <p className={`truncate text-[11px] font-medium ${action.primary ? 'text-white/65' : 'text-gray-400'}`}>
                {action.desc}
              </p>
            </div>
          </button>
        ))}
      </div>

      {!lowStockLoading && lowStock.length > 0 && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-800">{lowStock.length} product{lowStock.length !== 1 ? 's' : ''} low on stock</p>
            <p className="mt-0.5 truncate text-[11px] text-amber-600">
              {lowStock.map(p => p.name).join(', ')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
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

function hasObject(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeBranchSummary(value: unknown): DashboardBranchStat | null {
  if (!isRecord(value)) return null
  const id = typeof pick(value, 'id', 'branch_id') === 'string'
    ? String(pick(value, 'id', 'branch_id'))
    : ''
  return {
    id,
    todaySales: numberOrZero(pick(value, 'todaySales', 'today_sales')),
    todayCount: Math.trunc(numberOrZero(pick(value, 'todayCount', 'invoice_count', 'today_count'))),
    todayCash: numberOrZero(pick(value, 'todayCash', 'cash_total', 'cash_today')),
    todayCard: numberOrZero(pick(value, 'todayCard', 'card_total', 'card_today')),
    productionStatus: normalizeProductionStatus(pick(value, 'productionStatus', 'production_status')),
  }
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

function logBranchDashboardFailure(name: string, params: Record<string, unknown>, error: unknown) {
  console.error('[BranchDashboardPage] data load failed', {
    name,
    params,
    ...rpcErrorDebug(error),
  })
}

export default function BranchDashboardPage() {
  const navigate = useNavigate()
  const { profile, tenant } = useAuth()

  const tid = profile?.tenant_id
  const bid = profile?.branch_id

  const [statsLoading, setStatsLoading] = useState(true)
  const [invLoading,   setInvLoading]   = useState(true)
  const [lowStockLoading, setLowStockLoading] = useState(true)

  const [recentInvs,   setRecentInvs]   = useState<any[]>([])
  const [lowStock,     setLowStock]     = useState<any[]>([])
  const [branchName,   setBranchName]   = useState('')
  const [zatcaPhase,   setZatcaPhase]   = useState<1 | 2>(1)
  const [hasActiveCert, setHasActiveCert] = useState(false)
  const [productionStatus, setProductionStatus] = useState<ProductionOnboardingResponse | null>(null)
  const [productionStatusReadable, setProductionStatusReadable] = useState(true)
  const [registerSession, setRegisterSession] = useState<RegisterSessionSummary | null>(null)
  const [registerSessionError, setRegisterSessionError] = useState('')
  const [statsError, setStatsError] = useState('')
  const [invoiceError, setInvoiceError] = useState('')

  const loadStats = useCallback(async () => {
    if (!tid || !bid) { setStatsLoading(false); return }
    setStatsLoading(true)
    setStatsError('')
    setRegisterSessionError('')
    const today = saudiDateStr()
    const summaryParams = { p_branch_id: bid, p_start_date: today, p_end_date: today }
    try {
      const [branchRes, registerRes] = await Promise.all([
        db().from('branches').select('name, zatca_phase').eq('id', bid).maybeSingle(),
        (supabase as any).rpc('get_register_session_summary', {
          p_branch_id: bid,
        }),
      ])

      if (registerRes.error) {
        logRegisterSessionRpcError('get_register_session_summary', { p_branch_id: bid }, registerRes.error)
        setRegisterSession(null)
        setRegisterSessionError(registerSessionRpcErrorMessage(registerRes.error))
      } else {
        const sessionValue = isRecord(registerRes.data)
          ? pick(registerRes.data, 'session')
          : null
        setRegisterSession(normalizeRegisterSession(sessionValue))
      }

      setBranchName(branchRes.data?.name ?? '')
      const branchZatcaPhase = branchRes.data?.zatca_phase ?? 1
      setZatcaPhase(branchZatcaPhase)
      setHasActiveCert(false)

      try {
        const summary = await loadReportSummary<DashboardSummary>(
          'get_dashboard_summary',
          summaryParams,
          EMPTY_DASHBOARD_SUMMARY,
        )
        const summaryRecord = summary as Record<string, unknown>
        const branchSummary = asArray<unknown>(pick(summaryRecord, 'branchStats', 'branch_stats'))
          .map(normalizeBranchSummary)
          .find(row => row?.id === bid) ?? null
        setProductionStatus(normalizeProductionStatus(branchSummary?.productionStatus))
        setProductionStatusReadable(branchZatcaPhase === 2
          ? hasObject(branchSummary?.productionStatus)
          : true)
      } catch (summaryError) {
        logBranchDashboardFailure('get_dashboard_summary', summaryParams, summaryError)
        setStatsError('Branch metadata could not be refreshed. Register Session totals are still shown.')
        setProductionStatus(null)
        setProductionStatusReadable(branchZatcaPhase !== 2)
      }
    } catch (error) {
      logBranchDashboardFailure('branch_register_session_load', { p_branch_id: bid }, error)
      setStatsError('Branch dashboard data could not be loaded. Refresh and try again.')
      setRegisterSession(null)
      try {
        const { data } = await db().from('branches').select('name, zatca_phase').eq('id', bid).maybeSingle()
        setBranchName(data?.name ?? '')
        setZatcaPhase(data?.zatca_phase ?? 1)
      } catch {}
    } finally {
      setStatsLoading(false)
    }
  }, [tid, bid])

  const loadInvoices = useCallback(async () => {
    if (!tid || !bid) { setInvLoading(false); return }
    setInvLoading(true)
    setInvoiceError('')
    const params = { p_branch_id: bid, p_limit: 6 }
    try {
      const { data, error } = await (supabase as any).rpc('get_branch_dashboard_recent_invoices', params)
      if (error) throw error
      setRecentInvs(asArray<RecentInvoiceRow>(data))
    } catch (error) {
      logBranchDashboardFailure('get_branch_dashboard_recent_invoices', params, error)
      setInvoiceError('Recent invoices could not be loaded.')
      setRecentInvs([])
    } finally {
      setInvLoading(false)
    }
  }, [tid, bid])

  const loadLowStock = useCallback(async () => {
    if (!tid || !bid) { setLowStockLoading(false); return }
    setLowStockLoading(true)
    const { data } = await db()
      .from('products')
      .select('id, name, stock_quantity, min_stock_level')
      .eq('tenant_id', tid)
      .eq('branch_id', bid)
      .eq('is_active', true)
      .not('min_stock_level', 'is', null)
      .order('stock_quantity', { ascending: true })
      .limit(50)
    setLowStock((data ?? []).filter((p: any) =>
      p.stock_quantity !== null && p.min_stock_level !== null &&
      Number(p.stock_quantity) <= Number(p.min_stock_level)
    ).slice(0, 5))
    setLowStockLoading(false)
  }, [tid])

  useEffect(() => { loadStats() },    [loadStats])
  useEffect(() => { loadInvoices() }, [loadInvoices])
  useEffect(() => { loadLowStock() }, [loadLowStock])

  const demoSandbox = isPermanentDemoSandboxBranch(tid, bid)
  const zatcaStatus = demoSandbox
    ? { label: 'ZATCA Connected', tone: 'success' as const }
    : zatcaPhase === 2 && !productionStatusReadable
    ? { label: 'Phase 2 status unavailable', tone: 'neutral' as const }
    : productionStatusLabel(productionStatus, hasActiveCert)
  const dashboardTitle = branchName || tenant?.name || 'My Branch'
  const dashboardSubtitle = tenant?.name && branchName && tenant.name !== branchName
    ? tenant.name
    : tenant?.name_ar || 'Branch dashboard'
  const dashboardDate = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  useEffect(() => {
    if (!bid) return
    const channel = supabase
      .channel('branch-dashboard-' + bid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices',  filter: `branch_id=eq.${bid}` }, () => loadStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses',  filter: `branch_id=eq.${bid}` }, () => loadStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_sessions',  filter: `branch_id=eq.${bid}` }, () => loadStats())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [bid, loadStats])

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="relative overflow-hidden bg-[#0F2419] px-5 py-5 shadow-[0_18px_50px_rgba(15,36,25,0.24)] sm:px-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(34,121,70,0.20),transparent_32%),radial-gradient(circle_at_85%_12%,rgba(216,183,106,0.11),transparent_30%),linear-gradient(135deg,rgba(7,21,16,0.94),rgba(15,36,25,0.98))]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-300/45 to-transparent" />
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative z-10 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-gold-300">Branch operations</p>
          <h1 className="mt-1 truncate text-2xl font-black tracking-tight text-white sm:text-3xl">
            {statsLoading ? 'Loading branch...' : dashboardTitle}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">
            <span className="font-semibold text-white/90" dir={tenant?.name_ar && dashboardSubtitle === tenant.name_ar ? 'rtl' : 'ltr'}>
              {dashboardSubtitle}
            </span>
            <span className="hidden text-white/35 sm:inline">/</span>
            <span className="text-white/70">{dashboardDate}</span>
          </div>
        </div>
        <div className="relative z-10 flex flex-col items-start gap-2 sm:items-end">
          <button
            onClick={() => navigate('/pos')}
            className="flex items-center gap-2 px-4 py-2.5 bg-gold-500 text-[#0F2419] text-sm font-black rounded-xl hover:bg-gold-400 transition-colors shadow-lg shadow-gold-950/20"
          >
            <Receipt size={15} />
            New Sale
          </button>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.065] px-3 py-1.5 text-xs font-black text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <span className={`h-2.5 w-2.5 rounded-full ${demoSandbox || zatcaPhase === 2 ? zatcaIndicatorClass[zatcaStatus.tone] : zatcaIndicatorClass.info}`} />
            <span>{demoSandbox || zatcaPhase === 2 ? zatcaStatus.label : 'Phase 1 — QR invoices'}</span>
          </div>
        </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {(statsError || invoiceError) && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
            <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">Branch dashboard data needs a refresh</p>
              <p className="text-xs text-amber-800 mt-0.5">{statsError || invoiceError}</p>
            </div>
            <button
              type="button"
              onClick={() => { loadStats(); loadInvoices() }}
              className="text-xs font-semibold text-amber-900 hover:text-amber-700"
            >
              Retry
            </button>
          </div>
        )}

        <RegisterSessionPanel
          session={registerSession}
          loading={statsLoading && !registerSession}
          error={registerSessionError}
        >
          <QuickActionsPanel
            onNavigate={navigate}
            lowStock={lowStock}
            lowStockLoading={lowStockLoading}
          />
        </RegisterSessionPanel>

        {/* Recent invoices */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Recent Invoices</h2>
            <button onClick={() => navigate('/invoices')}
              className="text-xs text-primary-600 font-medium hover:text-primary-700 flex items-center gap-1">
              View all <ArrowRight size={12} />
            </button>
          </div>

          {invLoading ? (
            <div className="divide-y divide-gray-50">
              {[1, 2, 3].map(i => (
                <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                  <div className="h-3 bg-gray-100 rounded w-20" />
                  <div className="flex-1 h-3 bg-gray-100 rounded" />
                  <div className="h-3 bg-gray-100 rounded w-16" />
                </div>
              ))}
            </div>
          ) : invoiceError ? (
            <div className="py-10 text-center">
              <AlertCircle size={28} className="text-amber-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">{invoiceError}</p>
              <button onClick={loadInvoices}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-xl transition-colors">
                Retry
              </button>
            </div>
          ) : recentInvs.length === 0 ? (
            <div className="py-10 text-center">
              <Package size={28} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No invoices yet</p>
              <p className="text-xs text-gray-400 mt-1">Start your first sale from the POS</p>
              <button onClick={() => navigate('/pos')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-xl transition-colors">
                <Receipt size={14} /> Open POS
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-50">
                    {['Invoice', 'Customer', 'Amount', 'Status', 'Date'].map((h, i) => (
                      <th key={h} className={`px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide ${
                        i === 2 ? 'text-right' : 'text-left'
                      }`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentInvs.map(inv => {
                    const cfg = statusConfig[inv.status as keyof typeof statusConfig] ?? statusConfig.draft
                    const invoiceNumber = inv.invoiceNumber ?? inv.invoice_number ?? ''
                    const customerName = inv.customerName ?? inv.customer_name ?? 'Walk-in Customer'
                    const amount = numberOrZero(inv.displayTotal ?? inv.display_total ?? inv.totalAmount ?? inv.total_amount)
                    const invoiceDate = inv.invoiceDate ?? inv.invoice_date ?? ''
                    const documentType = inv.documentType ?? inv.zatca_invoice_type ?? 'simplified'
                    return (
                      <tr key={inv.id}
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                        className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                        <td className="px-6 py-3.5 text-xs font-mono font-semibold text-primary-600">
                          {invoiceNumber}
                          {documentType === 'credit_note' && (
                            <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                              CREDIT
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5 text-sm text-gray-700">
                          {customerName}
                        </td>
                        <td className="px-6 py-3.5 text-sm font-semibold text-gray-900 text-right tabular-nums">
                          <Rial amount={amount} />
                        </td>
                        <td className="px-6 py-3.5">
                          <Badge variant={cfg.variant} dot>{cfg.label}</Badge>
                        </td>
                        <td className="px-6 py-3.5 text-xs text-gray-400">{invoiceDate}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
