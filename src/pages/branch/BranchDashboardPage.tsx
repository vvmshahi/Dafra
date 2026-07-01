import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, FileText, Receipt, CreditCard, AlertTriangle,
  ArrowRight, CheckCircle2, Clock, AlertCircle, Loader2,
  LogOut, Package, Banknote, BadgePercent,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { saudiNow, saudiDateStr } from '@/lib/utils/date'
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { MeemLogo } from '@/components/MeemLogo'
import { productionStatusLabel } from '@/lib/zatca/status'
import type { ProductionOnboardingResponse } from '@/lib/zatca/api'
import { asArray, loadReportSummary } from '@/pages/reports/reportingRpc'

const db = () => supabase as any

function last7Days() {
  const result = []
  for (let i = 6; i >= 0; i--) {
    const d = saudiNow(); d.setUTCDate(d.getUTCDate() - i)
    const date = d.toISOString().split('T')[0]
    result.push({
      day:   new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
      date,
      sales: 0,
    })
  }
  return result
}

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

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3.5 py-2.5">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900">{sarStr(Number(payload[0].value))}</p>
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
  const { profile, tenant, signOut } = useAuth()

  const tid = profile?.tenant_id
  const bid = profile?.branch_id

  const [statsLoading, setStatsLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(true)
  const [invLoading,   setInvLoading]   = useState(true)
  const [lowStockLoading, setLowStockLoading] = useState(true)

  const [todaySales,    setTodaySales]    = useState(0)
  const [todayCount,    setTodayCount]    = useState(0)
  const [todayCash,     setTodayCash]     = useState(0)
  const [todayCard,     setTodayCard]     = useState(0)
  const [todayVat,      setTodayVat]      = useState(0)
  const [todayExpenses, setTodayExpenses] = useState(0)
  const [salesData,    setSalesData]    = useState(last7Days())
  const [recentInvs,   setRecentInvs]   = useState<any[]>([])
  const [lowStock,     setLowStock]     = useState<any[]>([])
  const [branchName,   setBranchName]   = useState('')
  const [zatcaPhase,   setZatcaPhase]   = useState<1 | 2>(1)
  const [hasActiveCert, setHasActiveCert] = useState(false)
  const [productionStatus, setProductionStatus] = useState<ProductionOnboardingResponse | null>(null)
  const [productionStatusReadable, setProductionStatusReadable] = useState(true)
  const [statsAvailable, setStatsAvailable] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [chartError, setChartError] = useState('')
  const [invoiceError, setInvoiceError] = useState('')

  const loadStats = useCallback(async () => {
    if (!tid || !bid) { setStatsLoading(false); return }
    setStatsLoading(true)
    setStatsError('')
    setStatsAvailable(false)
    const today = saudiDateStr()
    const summaryParams = { p_branch_id: bid, p_start_date: today, p_end_date: today }
    try {
      const [summary, branchRes] = await Promise.all([
        loadReportSummary<DashboardSummary>(
          'get_dashboard_summary',
          summaryParams,
          EMPTY_DASHBOARD_SUMMARY,
        ),
        db().from('branches').select('name, zatca_phase').eq('id', bid).maybeSingle(),
      ])

      const summaryRecord = summary as Record<string, unknown>
      const branchSummary = asArray<unknown>(pick(summaryRecord, 'branchStats', 'branch_stats'))
        .map(normalizeBranchSummary)
        .find(row => row?.id === bid) ?? null
      setStatsAvailable(true)
      setTodaySales(numberOrZero(pick(summaryRecord, 'totalSales', 'total_sales') ?? branchSummary?.todaySales))
      setTodayCount(Math.trunc(numberOrZero(pick(summaryRecord, 'totalCount', 'total_invoices') ?? branchSummary?.todayCount)))
      setTodayCash(numberOrZero(pick(summaryRecord, 'totalCash', 'cash_total') ?? branchSummary?.todayCash))
      setTodayCard(numberOrZero(pick(summaryRecord, 'totalCard', 'card_total') ?? branchSummary?.todayCard))
      setTodayVat(numberOrZero(pick(summaryRecord, 'totalVat', 'vat_collected')))
      setTodayExpenses(numberOrZero(pick(summaryRecord, 'totalExpenses', 'expenses_total')))
      setBranchName(branchRes.data?.name ?? '')
      setZatcaPhase(branchRes.data?.zatca_phase ?? 1)
      setHasActiveCert(false)
      setProductionStatus(normalizeProductionStatus(branchSummary?.productionStatus))
      setProductionStatusReadable((branchRes.data?.zatca_phase ?? 1) === 2
        ? hasObject(branchSummary?.productionStatus)
        : true)
    } catch (error) {
      logBranchDashboardFailure('get_dashboard_summary', summaryParams, error)
      setStatsAvailable(false)
      setStatsError('Branch totals could not be loaded. Refresh and try again.')
      setTodaySales(0)
      setTodayCount(0)
      setTodayCash(0)
      setTodayCard(0)
      setTodayVat(0)
      setTodayExpenses(0)
      try {
        const { data } = await db().from('branches').select('name, zatca_phase').eq('id', bid).maybeSingle()
        setBranchName(data?.name ?? '')
        setZatcaPhase(data?.zatca_phase ?? 1)
      } catch {}
    } finally {
      setStatsLoading(false)
    }
  }, [tid, bid])

  const loadChart = useCallback(async () => {
    if (!tid || !bid) { setChartLoading(false); return }
    setChartLoading(true)
    setChartError('')
    const fromDay = saudiNow(); fromDay.setUTCDate(fromDay.getUTCDate() - 6)
    const params = {
      p_branch_id: bid,
      p_start_date: fromDay.toISOString().split('T')[0],
      p_end_date: saudiDateStr(),
    }
    try {
      const summary = await loadReportSummary<DashboardSummary>(
        'get_dashboard_summary',
        params,
        EMPTY_DASHBOARD_SUMMARY,
      )
      const summaryRecord = summary as Record<string, unknown>
      setSalesData(asArray<Record<string, unknown>>(pick(summaryRecord, 'dailySales', 'daily_sales')).map(row => ({
        day: new Date(String(pick(row, 'date', 'report_date') ?? '') + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
        sales: numberOrZero(pick(row, 'sales', 'sales_amount')),
      })))
    } catch (error) {
      logBranchDashboardFailure('get_dashboard_summary', params, error)
      setChartError('Sales chart could not be loaded.')
      setSalesData(last7Days())
    } finally {
      setChartLoading(false)
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
  useEffect(() => { loadChart() },    [loadChart])
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

        {(statsError || chartError || invoiceError) && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
            <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">Branch dashboard data needs a refresh</p>
              <p className="text-xs text-amber-800 mt-0.5">{statsError || chartError || invoiceError}</p>
            </div>
            <button
              type="button"
              onClick={() => { loadStats(); loadChart(); loadInvoices() }}
              className="text-xs font-semibold text-amber-900 hover:text-amber-700"
            >
              Retry
            </button>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            label="Today's Sales"
            value={statsAvailable ? <Rial amount={todaySales} /> : 'Unavailable'}
            sub={statsAvailable ? `${todayCount} invoice${todayCount !== 1 ? 's' : ''}` : 'Retry to load totals'}
            icon={TrendingUp}
            gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]"
            loading={statsLoading}
          />
          <StatCard
            label="Invoices Today"
            value={statsAvailable ? String(todayCount) : 'Unavailable'}
            sub={statsAvailable ? 'Posted today' : 'Retry to load totals'}
            icon={FileText}
            gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]"
            loading={statsLoading}
          />
          <StatCard
            label="Today's Expenses"
            value={statsAvailable ? <Rial amount={todayExpenses} /> : 'Unavailable'}
            sub={statsAvailable ? 'Recorded today' : 'Retry to load totals'}
            icon={CreditCard}
            gradient="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6]"
            loading={statsLoading}
          />
          <StatCard
            label="Cash Today"
            value={statsAvailable ? <Rial amount={todayCash} /> : 'Unavailable'}
            sub={statsAvailable ? 'Cash payments' : 'Retry to load totals'}
            icon={Banknote}
            gradient="bg-gradient-to-br from-[#059669] to-[#047857]"
            loading={statsLoading}
          />
          <StatCard
            label="Card Today"
            value={statsAvailable ? <Rial amount={todayCard} /> : 'Unavailable'}
            sub={statsAvailable ? 'Card payments' : 'Retry to load totals'}
            icon={CreditCard}
            gradient="bg-gradient-to-br from-[#0891b2] to-[#0e7490]"
            loading={statsLoading}
          />
          <StatCard
            label="VAT Collected"
            value={statsAvailable ? <Rial amount={todayVat} /> : 'Unavailable'}
            sub={statsAvailable ? "Tax on today's sales" : 'Retry to load totals'}
            icon={BadgePercent}
            gradient="bg-gradient-to-br from-[#b45309] to-[#92400e]"
            loading={statsLoading}
          />
        </div>

        {/* Chart + Quick actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Sales — Last 7 Days</h2>
              <p className="text-xs text-gray-400 mt-0.5">Your branch daily revenue</p>
            </div>
            {chartLoading ? (
              <div className="h-[200px] flex items-center justify-center">
                <Loader2 size={22} className="animate-spin text-gray-300" />
              </div>
            ) : chartError ? (
              <div className="h-[200px] flex flex-col items-center justify-center text-gray-300">
                <AlertCircle size={28} className="mb-2" />
                <p className="text-sm text-gray-400">{chartError}</p>
              </div>
            ) : salesData.every(d => d.sales === 0) ? (
              <div className="h-[200px] flex flex-col items-center justify-center text-gray-300">
                <TrendingUp size={28} className="mb-2" />
                <p className="text-sm">No sales this week yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={salesData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="branchSalesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#1B6B3A" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#1B6B3A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#1B6B3A', strokeWidth: 1, strokeDasharray: '4 4' }} />
                  <Area type="monotone" dataKey="sales"
                    stroke="#1B6B3A" strokeWidth={2}
                    fill="url(#branchSalesGrad)"
                    dot={false} activeDot={{ r: 4, fill: '#1B6B3A', strokeWidth: 2, stroke: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Quick Actions</h2>
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

            {/* Low stock alert */}
            {!lowStockLoading && lowStock.length > 0 && (
              <div className="mt-1 flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-3">
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
