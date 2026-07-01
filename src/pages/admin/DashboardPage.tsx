import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, FileText, Loader2, Building2, Store,
  Plus, ArrowRight, ShoppingBag, CreditCard, Banknote,
  ShieldCheck, Eye, BadgePercent, Receipt,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { saudiNow, saudiDateStr } from '@/lib/utils/date'
import { useAuth } from '@/hooks/useAuth'
import { getCachedProductionStatus, productionStatusLabel, readCachedProductionStatus } from '@/lib/zatca/status'
import type { ProductionOnboardingResponse } from '@/lib/zatca/api'
import { asArray, loadReportSummary } from '@/pages/reports/reportingRpc'


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

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3.5 py-2.5">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900">{sarStr(Number(payload[0].value))}</p>
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

function BranchCard({ branch, loading, onView }: { branch: BranchStat; loading: boolean; onView: () => void }) {
  const zatca = productionStatusLabel(branch.productionStatus)

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
            <span className={`flex items-center gap-0.5 text-[10px] ${
              branch.zatca_phase === 2 && zatca.tone === 'success'
                ? 'text-emerald-600'
                : branch.zatca_phase === 2
                ? 'text-amber-600'
                : 'text-gray-400'
            }`}>
              <ShieldCheck size={10} className={branch.zatca_phase === 2 && zatca.tone === 'success' ? 'text-emerald-500' : 'text-violet-400'} />
              {branch.zatca_phase === 2 ? zatca.label : 'Phase 1'}
            </span>
            {branch.sessionOpen ? (
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

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-primary-50 rounded-xl p-3">
          <p className="text-[10px] text-primary-600 font-medium">Today's Sales</p>
          {loading
            ? <div className="h-5 w-16 bg-primary-100 rounded animate-pulse mt-1" />
            : <p className="text-base font-bold text-primary-700 mt-0.5 tabular-nums"><Rial amount={branch.todaySales} /></p>
          }
        </div>
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[10px] text-gray-500 font-medium">Invoices</p>
          {loading
            ? <div className="h-5 w-8 bg-gray-100 rounded animate-pulse mt-1" />
            : <p className="text-base font-bold text-gray-800 mt-0.5">{branch.todayCount}</p>
          }
        </div>
        <div className="bg-emerald-50 rounded-xl p-3">
          <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1"><Banknote size={10} />Cash</p>
          {loading
            ? <div className="h-5 w-16 bg-emerald-100 rounded animate-pulse mt-1" />
            : <p className="text-sm font-bold text-emerald-700 mt-0.5 tabular-nums"><Rial amount={branch.todayCash} /></p>
          }
        </div>
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-[10px] text-blue-600 font-medium flex items-center gap-1"><CreditCard size={10} />Card</p>
          {loading
            ? <div className="h-5 w-16 bg-blue-100 rounded animate-pulse mt-1" />
            : <p className="text-sm font-bold text-blue-700 mt-0.5 tabular-nums"><Rial amount={branch.todayCard} /></p>
          }
        </div>
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
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d')

  const [statsLoading,  setStatsLoading]  = useState(true)
  const [branchLoading, setBranchLoading] = useState(true)
  const [chartLoading,  setChartLoading]  = useState(true)

  const [totalSales,    setTotalSales]    = useState(0)
  const [totalCount,    setTotalCount]    = useState(0)
  const [totalCash,     setTotalCash]     = useState(0)
  const [totalCard,     setTotalCard]     = useState(0)
  const [totalVat,      setTotalVat]      = useState(0)
  const [totalExpenses, setTotalExpenses] = useState(0)
  const [branchStats,   setBranchStats]   = useState<BranchStat[]>([])
  const [salesData,     setSalesData]     = useState<{ day: string; sales: number }[]>([])

  const tid = profile?.tenant_id

  const loadStats = useCallback(async () => {
    // Don't update state if profile hasn't loaded yet — keeps loading=true so
    // we show skeletons instead of the "no branches" empty state.
    if (!tid) return
    setStatsLoading(true)
    setBranchLoading(true)
    const today = saudiDateStr()
    try {
      const summary = await loadReportSummary<DashboardSummary>(
        'get_dashboard_summary',
        { p_branch_id: null, p_start_date: today, p_end_date: today },
        EMPTY_DASHBOARD_SUMMARY,
      )

      setTotalSales(Number(summary.totalSales ?? 0))
      setTotalCount(Number(summary.totalCount ?? 0))
      setTotalCash(Number(summary.totalCash ?? 0))
      setTotalCard(Number(summary.totalCard ?? 0))
      setTotalVat(Number(summary.totalVat ?? 0))
      setTotalExpenses(Number(summary.totalExpenses ?? 0))

      const stats = asArray<BranchStat>(summary.branchStats).map(branch => ({
        ...branch,
        todaySales: Number(branch.todaySales ?? 0),
        todayCount: Number(branch.todayCount ?? 0),
        todayCash: Number(branch.todayCash ?? 0),
        todayCard: Number(branch.todayCard ?? 0),
        productionStatus: (branch.zatca_phase ?? 1) === 2 ? readCachedProductionStatus(branch.id) : null,
      }))
      setBranchStats(stats)

      stats
        .filter(branch => (branch.zatca_phase ?? 1) === 2)
        .forEach(branch => {
          getCachedProductionStatus(branch.id)
            .then(status => {
              setBranchStats(prev => prev.map(item => (
                item.id === branch.id ? { ...item, productionStatus: status } : item
              )))
            })
            .catch(() => {})
        })
    } catch (error) {
      console.error('[DashboardPage] failed to load dashboard summary', error)
      setTotalSales(0)
      setTotalCount(0)
      setTotalCash(0)
      setTotalCard(0)
      setTotalVat(0)
      setTotalExpenses(0)
      setBranchStats([])
    } finally {
      setStatsLoading(false)
      setBranchLoading(false)
    }
  }, [tid])

  const loadChart = useCallback(async () => {
    if (!tid) { setChartLoading(false); return }
    setChartLoading(true)
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const fromDay = saudiNow(); fromDay.setUTCDate(fromDay.getUTCDate() - (days - 1))
    try {
      const summary = await loadReportSummary<DashboardSummary>(
        'get_dashboard_summary',
        {
          p_branch_id: null,
          p_start_date: fromDay.toISOString().split('T')[0],
          p_end_date: saudiDateStr(),
        },
        EMPTY_DASHBOARD_SUMMARY,
      )

      setSalesData(asArray<DashboardDailySale>(summary.dailySales).map(row => {
        const d = new Date(row.date + 'T12:00:00Z')
        const label = days <= 7
          ? d.toLocaleDateString('en-US', { weekday: 'short' })
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        return { day: label, sales: Number(row.sales ?? 0) }
      }))
    } catch (error) {
      console.error('[DashboardPage] failed to load dashboard chart', error)
      setSalesData([])
    } finally {
      setChartLoading(false)
    }
  }, [tid, period])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadChart() }, [loadChart])

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
      }, () => { loadStats(); loadChart() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tid, loadStats, loadChart])

  // Show WelcomeState ONLY after loading completes with zero branches.
  // While branchLoading===true (profile not yet loaded, or fetch in flight)
  // we fall through to the full layout with skeleton cards — never flash
  // the empty state prematurely.
  if (!branchLoading && branchStats.length === 0) {
    return <WelcomeState onAddBranch={() => navigate('/settings')} />
  }

  return (
    <div className="space-y-6">

      {/* ── Summary KPIs ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Total Sales Today" value={<Rial amount={totalSales} />}
          sub={`${totalCount} invoice${totalCount !== 1 ? 's' : ''} across all branches`}
          icon={TrendingUp} gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]" loading={statsLoading} />
        <StatCard label="Total Invoices" value={String(totalCount)}
          sub="All branches combined"
          icon={FileText} gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]" loading={statsLoading} />
        <StatCard label="Cash Today" value={<Rial amount={totalCash} />}
          sub="Cash payments"
          icon={Banknote} gradient="bg-gradient-to-br from-[#059669] to-[#047857]" loading={statsLoading} />
        <StatCard label="Card Today" value={<Rial amount={totalCard} />}
          sub="Card payments"
          icon={CreditCard} gradient="bg-gradient-to-br from-[#0891b2] to-[#0e7490]" loading={statsLoading} />
        <StatCard label="VAT Collected" value={<Rial amount={totalVat} />}
          sub="Tax on today's sales"
          icon={BadgePercent} gradient="bg-gradient-to-br from-[#b45309] to-[#92400e]" loading={statsLoading} />
        <StatCard label="Expenses Today" value={<Rial amount={totalExpenses} />}
          sub="All branches combined"
          icon={Receipt} gradient="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6]" loading={statsLoading} />
      </div>

      {/* ── Branch grid ──────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Building2 size={15} className="text-gray-400" /> Branches — Today
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {branchStats.map(b => (
              <BranchCard
                key={b.id}
                branch={b}
                loading={false}
                onView={() => navigate(`/dashboard/branches/${b.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Sales trend chart ────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Sales Trend</h2>
            <p className="text-xs text-gray-400 mt-0.5">All branches combined</p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  period === p ? 'bg-white text-gray-900 shadow-card' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {p === '7d' ? '7 days' : p === '30d' ? '30 days' : '90 days'}
              </button>
            ))}
          </div>
        </div>
        {chartLoading ? (
          <div className="h-[220px] flex items-center justify-center">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : salesData.every(d => d.sales === 0) ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-gray-300">
            <ShoppingBag size={32} className="mb-2" />
            <p className="text-sm">No sales data for this period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={salesData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
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
                fill="url(#salesGrad)" dot={false}
                activeDot={{ r: 5, fill: '#1B6B3A', strokeWidth: 2, stroke: '#fff' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
