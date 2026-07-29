import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  ArrowLeft, TrendingUp, FileText, Banknote, CreditCard,
  AlertTriangle, Package, ShieldCheck, Store, CheckCircle2,
  AlertCircle, Clock, ShoppingBag, Loader2, Receipt,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { formatSaudiDate, formatSaudiTime, saudiNow, saudiDateStr } from '@/lib/utils/date'
import { isLowStockProduct } from '@/lib/products/lowStock'
import { Badge } from '@/components/ui/Badge'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { getCachedProductionStatus, productionStatusLabel, readCachedProductionStatus } from '@/lib/zatca/status'
import type { ProductionOnboardingResponse } from '@/lib/zatca/api'
import { asArray, loadReportSummary } from '@/pages/reports/reportingRpc'
import { useTranslation } from 'react-i18next'

const db = () => supabase as any

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, gradient, loading }: {
  label: string; value: React.ReactNode; sub?: string
  icon: React.ElementType; gradient: string; loading?: boolean
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-5 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/70">{label}</p>
          {loading
            ? <div className="mt-1.5 h-6 w-20 bg-white/20 rounded animate-pulse" />
            : <p className="mt-1 text-xl font-bold text-white tracking-tight tabular-nums">{value}</p>
          }
          {sub && <p className="mt-0.5 text-[11px] text-white/60">{sub}</p>}
        </div>
        <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0 ml-3">
          <Icon size={17} className="text-white" />
        </div>
      </div>
      <div className="absolute -bottom-3 -right-3 w-20 h-20 rounded-full bg-white/5" />
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

const statusConfig = {
  posted:    { variant: 'success' as const, icon: CheckCircle2 },
  draft:     { variant: 'neutral' as const, icon: AlertCircle },
  paid:      { variant: 'success' as const, icon: CheckCircle2 },
  pending:   { variant: 'warning' as const, icon: Clock },
  cancelled: { variant: 'danger'  as const, icon: AlertCircle },
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
  branchStats: unknown[]
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BranchDetailPage() {
  const { t, i18n } = useTranslation('branches')
  const { branchId } = useParams<{ branchId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const tid = profile?.tenant_id

  // Branch info
  const [branch, setBranch]   = useState<any>(null)
  const [branchLoading, setBranchLoading] = useState(true)
  const [productionStatus, setProductionStatus] = useState<ProductionOnboardingResponse | null>(null)

  // KPIs
  const [statsLoading, setStatsLoading] = useState(true)
  const [todaySales,   setTodaySales]   = useState(0)
  const [todayCount,   setTodayCount]   = useState(0)
  const [todayCash,    setTodayCash]    = useState(0)
  const [todayCard,    setTodayCard]    = useState(0)
  const [todayVat,     setTodayVat]     = useState(0)
  const [todayExpenses, setTodayExpenses] = useState(0)

  // Recent invoices
  const [invLoading,  setInvLoading]  = useState(true)
  const [recentInvs,  setRecentInvs]  = useState<any[]>([])

  // Chart
  const [chartLoading, setChartLoading] = useState(true)
  const [salesData,    setSalesData]    = useState<{ day: string; sales: number }[]>([])

  // Low stock
  const [lowStockLoading, setLowStockLoading] = useState(true)
  const [lowStock,        setLowStock]        = useState<any[]>([])

  // Recent expenses
  const [expLoading,  setExpLoading]  = useState(true)
  const [recentExps,  setRecentExps]  = useState<any[]>([])

  const loadBranch = useCallback(async () => {
    if (!branchId) return
    setBranchLoading(true)
    const { data } = await db()
      .from('branches')
      .select('id, name, name_ar, logo_url, is_active, is_main_branch, zatca_phase, phone, email, address, city')
      .eq('id', branchId)
      .eq('tenant_id', tid)
      .maybeSingle()
    setBranch(data)
    if ((data?.zatca_phase ?? 1) === 2) {
      setProductionStatus(readCachedProductionStatus(branchId))
    } else {
      setProductionStatus(null)
    }
    setBranchLoading(false)
  }, [branchId, tid])

  const loadStats = useCallback(async () => {
    if (!tid || !branchId) { setStatsLoading(false); return }
    setStatsLoading(true)
    const today = saudiDateStr()
    try {
      const summary = await loadReportSummary<DashboardSummary>(
        'get_dashboard_summary',
        { p_branch_id: branchId, p_start_date: today, p_end_date: today },
        EMPTY_DASHBOARD_SUMMARY,
      )
      setTodaySales(Number(summary.totalSales ?? 0))
      setTodayCount(Number(summary.totalCount ?? 0))
      setTodayCash(Number(summary.totalCash ?? 0))
      setTodayCard(Number(summary.totalCard ?? 0))
      setTodayVat(Number(summary.totalVat ?? 0))
      setTodayExpenses(Number(summary.totalExpenses ?? 0))
    } catch (error) {
      console.error('[BranchDetailPage] failed to load dashboard summary', error)
      setTodaySales(0)
      setTodayCount(0)
      setTodayCash(0)
      setTodayCard(0)
      setTodayVat(0)
      setTodayExpenses(0)
    } finally {
      setStatsLoading(false)
    }
  }, [tid, branchId])

  const loadInvoices = useCallback(async () => {
    if (!tid || !branchId) { setInvLoading(false); return }
    setInvLoading(true)
    const { data } = await db()
      .from('invoices')
      .select('id, invoice_number, total_amount, status, invoice_date, created_at, payment_method, customers(name), payments(method)')
      .eq('tenant_id', tid)
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(10)
    setRecentInvs(data ?? [])
    setInvLoading(false)
  }, [tid, branchId])

  const loadChart = useCallback(async () => {
    if (!tid || !branchId) { setChartLoading(false); return }
    setChartLoading(true)
    const from = saudiNow(); from.setUTCDate(from.getUTCDate() - 6)
    try {
      const summary = await loadReportSummary<DashboardSummary>(
        'get_dashboard_summary',
        {
          p_branch_id: branchId,
          p_start_date: from.toISOString().slice(0, 10),
          p_end_date: saudiDateStr(),
        },
        EMPTY_DASHBOARD_SUMMARY,
      )
      setSalesData(asArray<DashboardDailySale>(summary.dailySales).map(row => ({
        day: new Date(row.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
        sales: Number(row.sales ?? 0),
      })))
    } catch (error) {
      console.error('[BranchDetailPage] failed to load dashboard chart', error)
      setSalesData([])
    } finally {
      setChartLoading(false)
    }
  }, [tid, branchId])

  const loadLowStock = useCallback(async () => {
    if (!tid) { setLowStockLoading(false); return }
    setLowStockLoading(true)
    const { data } = await db()
      .from('products')
      .select('id, name, stock_quantity, min_stock_alert, track_stock, is_service, is_active, is_available')
      .eq('tenant_id', tid)
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .eq('is_available', true)
      .eq('track_stock', true)
      .eq('is_service', false)
      .gt('min_stock_alert', 0)
      .not('min_stock_alert', 'is', null)
      .order('stock_quantity', { ascending: true })
      .limit(50)
    setLowStock((data ?? []).filter(isLowStockProduct).slice(0, 5))
    setLowStockLoading(false)
  }, [tid])

  const loadExpenses = useCallback(async () => {
    if (!tid || !branchId) { setExpLoading(false); return }
    setExpLoading(true)
    const today = saudiDateStr()
    const { data } = await db()
      .from('expenses')
      .select('id, description, total_paid, payment_method, expense_date, expense_categories(name)')
      .eq('tenant_id', tid)
      .eq('branch_id', branchId)
      .eq('expense_date', today)
      .order('created_at', { ascending: false })
      .limit(5)
    setRecentExps(data ?? [])
    setExpLoading(false)
  }, [tid, branchId])

  useEffect(() => { loadBranch() },   [loadBranch])
  useEffect(() => { loadStats() },    [loadStats])
  useEffect(() => { loadInvoices() }, [loadInvoices])
  useEffect(() => { loadChart() },    [loadChart])
  useEffect(() => { loadLowStock() }, [loadLowStock])
  useEffect(() => { loadExpenses() }, [loadExpenses])

  useEffect(() => {
    if (!branchId || (branch?.zatca_phase ?? 1) !== 2) return
    let cancelled = false
    getCachedProductionStatus(branchId)
      .then(status => { if (!cancelled) setProductionStatus(status) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [branchId, branch?.zatca_phase])

  const zatcaStatus = productionStatusLabel(productionStatus)

  // Realtime: update stats + recent invoices when this branch creates a sale
  useEffect(() => {
    if (!tid || !branchId) return
    const channel = supabase
      .channel(`branch-detail-live-${branchId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'invoices',
        filter: `branch_id=eq.${branchId}`,
      }, () => { loadStats(); loadInvoices(); loadChart() })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'expenses',
        filter: `branch_id=eq.${branchId}`,
      }, () => { loadStats(); loadExpenses() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tid, branchId, loadStats, loadInvoices, loadChart, loadExpenses])

  return (
    <div className="space-y-6">

      {/* ── Branch header ───────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 mb-4 transition-colors"
        >
          <ArrowLeft size={13} /> {t('detail.back')}
        </button>

        {branchLoading ? (
          <div className="flex items-center gap-4 animate-pulse">
            <div className="w-14 h-14 rounded-xl bg-gray-100" />
            <div className="space-y-2">
              <div className="h-5 w-40 bg-gray-100 rounded" />
              <div className="h-3 w-24 bg-gray-100 rounded" />
            </div>
          </div>
        ) : branch ? (
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
              {branch.logo_url
                ? <img src={branch.logo_url} alt={branch.name} className="w-full h-full object-cover" />
                : <Store size={22} className="text-gray-400" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-gray-900" dir="auto">{branch.name}</h1>
                {branch.is_main_branch && (
                  <span className="text-[9px] font-bold bg-gold-500/10 text-gold-700 px-1.5 py-0.5 rounded-full ring-1 ring-gold-500/20">
                    {t('detail.main')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <Badge variant={branch.is_active ? 'success' : 'neutral'} dot className="text-[11px]">
                  {t(`status.${branch.is_active ? 'active' : 'inactive'}`)}
                </Badge>
                <span className="flex items-center gap-1 text-[11px] text-gray-400">
                  <ShieldCheck size={11} className={(branch.zatca_phase ?? 1) === 2 && zatcaStatus.tone === 'success' ? 'text-emerald-500' : 'text-violet-400'} />
                  {(branch.zatca_phase ?? 1) === 2 ? zatcaStatus.label : t('detail.zatcaPhase1')}
                </span>
                {branch.city && (
                  <span className="text-[11px] text-gray-400" dir="auto">{branch.city}</span>
                )}
                {branch.phone && (
                  <span className="text-[11px] text-gray-400" dir="ltr">{branch.phone}</span>
                )}
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-xs text-gray-400">
                {new Date().toLocaleDateString(i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <p className="text-[11px] text-gray-300 mt-0.5">{t('detail.readOnly')}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-gray-400">
            <AlertCircle size={16} />
            <span className="text-sm">{t('detail.notFound')}</span>
          </div>
        )}
      </div>

      {/* ── 6 KPI cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiCard
          label={t('detail.todaySales')} icon={TrendingUp}
          gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]"
          value={<Rial amount={todaySales} />}
          sub={t('detail.invoiceCount', { count: todayCount })}
          loading={statsLoading}
        />
        <KpiCard
          label={t('detail.invoicesToday')} icon={FileText}
          gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]"
          value={String(todayCount)}
          sub={t('detail.postedSession')}
          loading={statsLoading}
        />
        <KpiCard
          label={t('detail.cashToday')} icon={Banknote}
          gradient="bg-gradient-to-br from-[#059669] to-[#047857]"
          value={<Rial amount={todayCash} />}
          sub={t('detail.cashPayments')}
          loading={statsLoading}
        />
        <KpiCard
          label={t('detail.cardToday')} icon={CreditCard}
          gradient="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6]"
          value={<Rial amount={todayCard} />}
          sub={t('detail.cardPayments')}
          loading={statsLoading}
        />
        <KpiCard
          label={t('detail.vatCollected')} icon={ShieldCheck}
          gradient="bg-gradient-to-br from-[#d97706] to-[#b45309]"
          value={<Rial amount={todayVat} />}
          sub={t('detail.vatToday')}
          loading={statsLoading}
        />
        <KpiCard
          label={t('detail.expensesToday')} icon={Receipt}
          gradient="bg-gradient-to-br from-[#dc2626] to-[#b91c1c]"
          value={<Rial amount={todayExpenses} />}
          sub={t('detail.recordedToday')}
          loading={statsLoading}
        />
      </div>

      {/* ── Chart + Low stock ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Sales chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">{t('detail.sales7Days')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t('detail.dailyRevenue')}</p>
          </div>
          {chartLoading ? (
            <div className="h-[200px] flex items-center justify-center">
              <Loader2 size={22} className="animate-spin text-gray-300" />
            </div>
          ) : salesData.every(d => d.sales === 0) ? (
            <div className="h-[200px] flex flex-col items-center justify-center text-gray-300">
              <ShoppingBag size={28} className="mb-2" />
              <p className="text-sm">{t('detail.noSales')}</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={salesData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="branchDetailGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1B6B3A" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1B6B3A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#1B6B3A', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="sales" stroke="#1B6B3A" strokeWidth={2}
                  fill="url(#branchDetailGrad)" dot={false}
                  activeDot={{ r: 4, fill: '#1B6B3A', strokeWidth: 2, stroke: '#fff' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Low stock alerts */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('detail.lowStock')}</h2>
          {lowStockLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-9 bg-gray-50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : lowStock.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 py-8">
              <Package size={26} className="mb-2" />
              <p className="text-xs text-center">{t('detail.wellStocked')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {lowStock.map(p => (
                <div key={p.id} className="flex items-center gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-amber-800 truncate">{p.name}</p>
                    <p className="text-[10px] text-amber-600">
                      {t('detail.stockLeft', { count: p.stock_quantity, min: p.min_stock_alert })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent invoices ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('detail.recentInvoices')}</h2>
          <span className="text-xs text-gray-400">{t('detail.last10')}</span>
        </div>

        {invLoading ? (
          <div className="divide-y divide-gray-50">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 bg-gray-100 rounded w-20" />
                <div className="flex-1 h-3 bg-gray-100 rounded" />
                <div className="h-3 bg-gray-100 rounded w-16" />
                <div className="h-5 bg-gray-100 rounded w-14" />
              </div>
            ))}
          </div>
        ) : recentInvs.length === 0 ? (
          <div className="py-10 text-center">
            <FileText size={28} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">{t('detail.noInvoices')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50">
                  {(['invoice', 'customer', 'amount', 'method', 'statusLabel', 'date'] as const).map((h, i) => (
                    <th key={h} className={`px-6 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide ${
                      i === 2 ? 'text-right' : 'text-left'
                    }`}>{t(`detail.${h}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {recentInvs.map(inv => {
                  const cfg = statusConfig[inv.status as keyof typeof statusConfig] ?? statusConfig.draft
                  const payments = Array.isArray(inv.payments) ? inv.payments : []
                  const isSplitPayment = payments.length > 1
                    && payments.some((payment: any) => payment.method === 'cash')
                    && payments.some((payment: any) => payment.method === 'card')
                  const displayPaymentMethod = isSplitPayment ? 'split' : inv.payment_method
                  return (
                    <tr key={inv.id}
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                      className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                      <td className="px-6 py-3.5 text-xs font-mono font-semibold text-primary-600">
                        {inv.invoice_number}
                      </td>
                      <td className="px-6 py-3.5 text-sm text-gray-700 max-w-[160px] truncate">
                        <span dir="auto">{inv.customers?.name ?? t('detail.walkIn')}</span>
                      </td>
                      <td className="px-6 py-3.5 text-sm font-semibold text-gray-900 text-right tabular-nums">
                        <Rial amount={Number(inv.total_amount)} />
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          displayPaymentMethod === 'cash'
                            ? 'bg-emerald-50 text-emerald-700'
                            : displayPaymentMethod === 'card'
                            ? 'bg-blue-50 text-blue-700'
                            : displayPaymentMethod === 'split'
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-gray-50 text-gray-600'
                        }`}>
                          {displayPaymentMethod === 'cash'
                            ? <><Banknote size={10} /> {t('detail.cash')}</>
                            : displayPaymentMethod === 'card'
                            ? <><CreditCard size={10} /> {t('detail.card')}</>
                            : displayPaymentMethod === 'split'
                            ? <><CreditCard size={10} /> {t('detail.split')}</>
                            : displayPaymentMethod ?? '—'
                          }
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge variant={cfg.variant} dot>{t(`detail.invoiceStatus.${inv.status}`, { defaultValue: t('unknown') })}</Badge>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-gray-500">
                        <span className="grid gap-0.5 whitespace-nowrap">
                          <span>{formatSaudiDate(inv.created_at, i18n.language)}</span>
                          <span className="font-medium text-gray-400" dir="ltr">{formatSaudiTime(inv.created_at, i18n.language)}</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Expense summary ──────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{t('detail.expensesToday')}</h2>
          {!expLoading && recentExps.length > 0 && (
            <span className="text-xs font-medium text-gray-500">
              <Rial amount={todayExpenses} /> {t('detail.total')}
            </span>
          )}
        </div>

        {expLoading ? (
          <div className="divide-y divide-gray-50">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 bg-gray-100 rounded flex-1" />
                <div className="h-3 bg-gray-100 rounded w-16" />
              </div>
            ))}
          </div>
        ) : recentExps.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-400">{t('detail.noExpenses')}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {recentExps.map(exp => (
              <div key={exp.id} className="px-6 py-3.5 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700 truncate">
                    <span dir="auto">{exp.description || exp.expense_categories?.name || t('detail.expense')}</span>
                  </p>
                  {exp.expense_categories?.name && exp.description && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{exp.expense_categories.name}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    exp.payment_method === 'cash'
                      ? 'bg-emerald-50 text-emerald-700'
                      : exp.payment_method === 'card'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-gray-50 text-gray-600'
                  }`}>
                    {exp.payment_method === 'cash' ? t('detail.cash') : exp.payment_method === 'card' ? t('detail.card') : exp.payment_method ?? '—'}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">
                    <Rial amount={Number(exp.total_paid ?? 0)} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
