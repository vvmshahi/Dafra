import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp, FileText, Receipt, CreditCard, AlertTriangle,
  ArrowRight, CheckCircle2, Clock, AlertCircle, Loader2,
  LogOut, Package, Banknote, BadgePercent,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { saudiDateStr } from '@/lib/utils/date'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MeemLogo } from '@/components/MeemLogo'
import { productionStatusLabel } from '@/lib/zatca/status'
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

const zatcaToneClass = {
  success: 'bg-emerald-500/20 border-emerald-400/20 text-emerald-300',
  warning: 'bg-amber-500/20 border-amber-400/20 text-amber-300',
  danger: 'bg-red-500/20 border-red-400/20 text-red-300',
  neutral: 'bg-gray-500/20 border-gray-400/20 text-gray-300',
  info: 'bg-blue-500/20 border-blue-400/20 text-blue-300',
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
    <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white/70">{label}</p>
          {loading
            ? <div className="mt-1.5 h-7 w-24 bg-white/20 rounded animate-pulse" />
            : <p className="mt-1.5 text-2xl font-bold text-white tracking-tight">{value}</p>
          }
          <p className="mt-1 text-xs text-white/60">{sub}</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <Icon size={18} className="text-white" />
        </div>
      </div>
      <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-white/5" />
    </div>
  )
}

function RegisterSessionPanel({ session, loading, error }: {
  session: RegisterSessionSummary | null
  loading: boolean
  error: string
}) {
  const title = registerSessionLabel(session)
  const hasSession = !!session?.sessionId
  const isOpen = session?.status === 'open'
  const labelPrefix = isOpen ? 'Session' : 'Last Session'
  const cashFinalLabel = session?.status === 'closed' && session.actualCash !== null ? 'Difference' : 'Expected Cash'
  const cashFinalValue = session?.status === 'closed' && session.actualCash !== null
    ? session.cashDifference ?? 0
    : session?.expectedCash ?? 0
  return (
    <section className="space-y-4">
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-28 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : !hasSession ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-5 py-6 shadow-sm">
          <h2 className="text-sm font-bold text-gray-900">No Register Session</h2>
          <p className="mt-1 text-sm text-gray-500">Open a register to start tracking sales for this shift.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard
              label={`${labelPrefix} Sales`}
              value={<Rial amount={session.totalSales} />}
              sub={`${session.invoiceCount} invoice${session.invoiceCount !== 1 ? 's' : ''}`}
              icon={TrendingUp}
              gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]"
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
              label={`${labelPrefix} VAT`}
              value={<Rial amount={session.vatTotal} />}
              sub="Session VAT"
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

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">{title}</h2>
                <p className="mt-1 text-xs text-gray-500">{registerSessionTimeRange(session)}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {session.status === 'open' ? (
                    <>
                      Opening cash: <Rial amount={session.openingCash} /> · Expected cash: <Rial amount={session.expectedCash} />
                    </>
                  ) : (
                    <>
                      Actual cash: <Rial amount={session.actualCash ?? 0} /> · Difference: <Rial amount={session.cashDifference ?? 0} />
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Credit notes/refunds: <Rial amount={session.creditNoteTotal} /> · Expenses: <Rial amount={session.expensesTotal} />
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
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

          {session.isLongOpen && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-3">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                This register session has been open since {session.openedAt ? formatSaudiSessionDateTime(session.openedAt) : 'earlier'}. Close it before starting a new shift.
              </p>
            </div>
          )}
        </>
      )}
    </section>
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
  const { profile, tenant, signOut } = useAuth()

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

  const zatcaStatus = zatcaPhase === 2 && !productionStatusReadable
    ? { label: 'Phase 2 status unavailable', tone: 'neutral' as const }
    : productionStatusLabel(productionStatus, hasActiveCert)

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
      <header className="bg-[#0F2419] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <MeemLogo size="md" />
          {(branchName || tenant?.name) && (
            <span className="text-white/50 text-xs">{branchName || tenant?.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {zatcaPhase === 2 ? (
            <span className={`text-[10px] border px-2.5 py-1 rounded-lg ${zatcaToneClass[zatcaStatus.tone]}`}>
              {zatcaStatus.label}
            </span>
          ) : (
            <span className="text-[10px] bg-blue-500/20 border border-blue-400/20 text-blue-300 px-2.5 py-1 rounded-lg">
              Phase 1 — QR Compliant
            </span>
          )}
          <button
            onClick={() => navigate('/pos')}
            className="flex items-center gap-2 px-4 py-2 bg-gold-500 text-[#0F2419] text-sm font-bold rounded-xl hover:bg-gold-400 transition-colors"
          >
            <Receipt size={15} />
            New Sale
          </button>
          <button
            onClick={signOut}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Welcome */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {statsLoading ? 'Loading…' : branchName ? `${branchName}` : 'My Branch'}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

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
        />

        {/* Quick actions */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'New Sale',     desc: 'Open POS terminal',     icon: Receipt,    path: '/pos',       primary: true },
              { label: 'Add Expense',  desc: 'Record branch expense',  icon: CreditCard, path: '/expenses',  primary: false },
              { label: 'View Invoices',desc: 'All branch invoices',    icon: FileText,   path: '/invoices',  primary: false },
            ].map(action => (
              <button key={action.label} onClick={() => navigate(action.path)}
                className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-left transition-all ${
                  action.primary
                    ? 'bg-primary-500 hover:bg-primary-600 text-white shadow-sm'
                    : 'bg-gray-50 hover:bg-gray-100 border border-gray-100'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  action.primary ? 'bg-white/20' : 'bg-white border border-gray-200'
                }`}>
                  <action.icon size={15} className={action.primary ? 'text-white' : 'text-gray-500'} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold truncate ${action.primary ? 'text-white' : 'text-gray-800'}`}>
                    {action.label}
                  </p>
                  <p className={`text-[11px] truncate ${action.primary ? 'text-white/70' : 'text-gray-400'}`}>
                    {action.desc}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Low stock alert */}
          {!lowStockLoading && lowStock.length > 0 && (
            <div className="mt-3 flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-3">
              <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-800">{lowStock.length} product{lowStock.length !== 1 ? 's' : ''} low on stock</p>
                <p className="text-[11px] text-amber-600 mt-0.5 truncate">
                  {lowStock.map(p => p.name).join(', ')}
                </p>
              </div>
            </div>
          )}
        </div>

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
