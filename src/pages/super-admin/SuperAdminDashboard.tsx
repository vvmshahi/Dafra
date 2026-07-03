import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Users, TrendingUp, ArrowRight,
  AlertTriangle, Star,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { supabase } from '@/lib/supabase'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalTenants:   number
  activeTenants:  number
  totalBranches:  number
  totalUsers:     number
  mrr:            number
  newThisMonth:   number
  lifetimeFree:   number
}

interface RecentTenant {
  id:        string
  name:      string
  is_active: boolean
  suspended_at: string | null
  created_at: string
  plan:      string | null
  subStatus: string | null
}

interface MrrPoint { month: string; mrr: number }
interface PlanSlice { name: string; value: number; color: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthLabel(iso: string) {
  return new Date(iso).toLocaleString('en', { month: 'short', year: '2-digit' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string; value: React.ReactNode; sub: string
  icon: React.ElementType; iconClass: string; bgClass: string
}
function StatCard({ label, value, sub, icon: Icon, iconClass, bgClass }: StatCardProps) {
  return (
    <div className="card p-6 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${bgClass}`}>
        <Icon size={20} className={iconClass} />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5 tracking-tight">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
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

const PLAN_COLORS: Record<string, string> = {
  'Phase 1': '#C8A96E',
  'Phase 2': '#0F2419',
}

function tenantStatus(t: RecentTenant): { label: string; variant: 'success' | 'warning' | 'danger' | 'default' } {
  if (t.suspended_at)                          return { label: 'Suspended', variant: 'danger'  }
  if (t.is_active && t.subStatus === 'active') return { label: 'Active',    variant: 'success' }
  return { label: 'Inactive', variant: 'default' }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SuperAdminDashboard() {
  const navigate = useNavigate()
  const [stats,   setStats]   = useState<DashboardStats | null>(null)
  const [recent,  setRecent]  = useState<RecentTenant[]>([])
  const [mrrData, setMrrData] = useState<MrrPoint[]>([])
  const [planData,setPlanData]= useState<PlanSlice[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const loadStats = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [
        { count: totalTenants },
        { count: activeTenants },
        { count: totalBranches },
        { count: totalUsers },
        { data: subs },
        { data: recentRaw },
      ] = await Promise.all([
        supabase.from('tenants').select('id', { count: 'exact', head: true }),
        supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('is_active', true).is('suspended_at', null),
        supabase.from('branches').select('id', { count: 'exact', head: true }),
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }).neq('role', 'super_admin'),
        (supabase as any).from('tenant_subscriptions')
          .select('status, ends_at, subscription_plans(name, price_monthly)')
          .in('status', ['active', 'lifetime_free']),
        (supabase as any).from('tenants')
          .select('id, name, is_active, suspended_at, created_at, tenant_subscriptions(status, subscription_plans(name))')
          .order('created_at', { ascending: false })
          .limit(6),
      ])

      // MRR = sum of price_monthly for paid active subs (excludes lifetime_free)
      let mrr = 0
      let lifetimeFreeCount = 0
      const planCounts: Record<string, number> = {}
      for (const s of (subs ?? [])) {
        const price = s.subscription_plans?.price_monthly ?? 0
        const name  = s.subscription_plans?.name ?? 'Phase 1'
        const isLifetimeFree = s.status === 'lifetime_free' || (s.status === 'active' && s.ends_at === null)
        if (isLifetimeFree) {
          lifetimeFreeCount++
        } else if (s.status === 'active') {
          mrr += price
          planCounts[name] = (planCounts[name] ?? 0) + 1
        }
      }

      // New this month
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
      const { count: newThisMonth } = await supabase
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart.toISOString())

      setStats({
        totalTenants:  totalTenants  ?? 0,
        activeTenants: activeTenants ?? 0,
        totalBranches: totalBranches ?? 0,
        totalUsers:    totalUsers    ?? 0,
        mrr,
        newThisMonth:  newThisMonth  ?? 0,
        lifetimeFree:  lifetimeFreeCount,
      })

      setPlanData(
        Object.entries(planCounts).map(([name, value]) => ({
          name, value, color: PLAN_COLORS[name] ?? '#6b7280',
        }))
      )

      setRecent((recentRaw ?? []).map((r: any) => {
        const sub = r.tenant_subscriptions?.[0]
        return {
          id:          r.id,
          name:        r.name,
          is_active:   r.is_active,
          suspended_at:r.suspended_at,
          created_at:  r.created_at,
          plan:        sub?.subscription_plans?.name ?? null,
          subStatus:   sub?.status ?? null,
        }
      }))

      // Revenue trend — last 6 months of posted invoices
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
      sixMonthsAgo.setDate(1); sixMonthsAgo.setHours(0,0,0,0)

      const { data: invoiceMonths } = await (supabase as any)
        .from('invoices')
        .select('invoice_date, total_amount')
        .gte('invoice_date', sixMonthsAgo.toISOString().slice(0, 10))
        .eq('status', 'posted')

      const byMonth: Record<string, number> = {}
      for (const inv of (invoiceMonths ?? [])) {
        const key = inv.invoice_date.slice(0, 7)
        byMonth[key] = (byMonth[key] ?? 0) + inv.total_amount
      }

      const points: MrrPoint[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
        const key = d.toISOString().slice(0, 7)
        points.push({ month: d.toLocaleString('en', { month: 'short' }), mrr: Math.round(byMonth[key] ?? 0) })
      }
      setMrrData(points)

      if (!silent) setLoading(false)
    } catch (err: any) {
      console.error('[SuperAdmin] dashboard load failed:', err)
      setError('Failed to load dashboard data. Please refresh.')
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  // Realtime: silently refresh when tenants or invoices change
  useEffect(() => {
    const channel = supabase
      .channel('super-admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants' },  () => loadStats(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => loadStats(true))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadStats])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card h-24" />)}
        </div>
        <div className="card h-64" />
      </div>
    )
  }

  const s = stats!

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Kubri Super Admin</p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900">Platform overview</h1>
        <p className="text-sm text-gray-500">Clients, branches, subscriptions, and revenue signals.</p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={15} className="flex-shrink-0 text-red-500" />
          {error}
          <button onClick={() => loadStats()} className="ml-auto text-xs font-medium underline hover:no-underline">Retry</button>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard
          label="Total Clients"
          value={s.totalTenants.toString()}
          sub={`${s.activeTenants} active · ${s.newThisMonth} new this month`}
          icon={Building2} iconClass="text-primary-600" bgClass="bg-primary-50"
        />
        <StatCard
          label="MRR"
          value={<Rial amount={s.mrr} />}
          sub={`${s.activeTenants - s.lifetimeFree} paying clients`}
          icon={TrendingUp} iconClass="text-emerald-600" bgClass="bg-emerald-50"
        />
        <StatCard
          label="Total Branches"
          value={s.totalBranches.toString()}
          sub="across all clients"
          icon={Building2} iconClass="text-gold-600" bgClass="bg-gold-50"
        />
        <StatCard
          label="Total Users"
          value={s.totalUsers.toString()}
          sub="active accounts"
          icon={Users} iconClass="text-violet-600" bgClass="bg-violet-50"
        />
        <StatCard
          label="Lifetime Free"
          value={s.lifetimeFree.toString()}
          sub="not counted in MRR"
          icon={Star} iconClass="text-purple-600" bgClass="bg-purple-50"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Revenue trend */}
        <div className="xl:col-span-2 card p-6">
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-900">Revenue Trend (last 6 months)</h2>
            <p className="text-xs text-gray-400 mt-0.5">Total invoice amounts from posted invoices</p>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={mrrData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#C8A96E" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#C8A96E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#C8A96E', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Area type="monotone" dataKey="mrr" stroke="#C8A96E" strokeWidth={2}
                fill="url(#mrrGrad)" dot={false}
                activeDot={{ r: 5, fill: '#C8A96E', strokeWidth: 2, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Plan distribution */}
        <div className="card p-6 flex flex-col">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Plan Distribution</h2>
            <p className="text-xs text-gray-400 mt-0.5">Active subscriptions by plan</p>
          </div>
          {planData.length > 0 ? (
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={planData} cx="50%" cy="45%" innerRadius={50} outerRadius={75}
                  dataKey="value" paddingAngle={3}>
                  {planData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Legend
                  formatter={(v, entry: any) => (
                    <span className="text-xs text-gray-600">{v} ({entry.payload.value})</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-gray-400">No active subscriptions</p>
            </div>
          )}
        </div>
      </div>

      {/* Platform notices */}
      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl p-4">
        <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-800">Production readiness reminder</p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            Review subscriptions, branch status, and ZATCA setup before enabling live operations for a client.
          </p>
        </div>
      </div>

      {/* Recent clients table */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Recent Clients</h2>
          <button
            onClick={() => navigate('/super-admin/clients')}
            className="text-xs text-primary-600 font-medium hover:text-primary-700 flex items-center gap-1"
          >
            View all <ArrowRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {['Business Name', 'Plan', 'Joined', 'Status'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recent.map(t => {
                const st = tenantStatus(t)
                return (
                  <tr
                    key={t.id}
                    className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                    onClick={() => navigate(`/super-admin/clients/${t.id}`)}
                  >
                    <td className="px-6 py-3.5 text-sm font-medium text-gray-800">{t.name}</td>
                    <td className="px-6 py-3.5">
                      {t.plan ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          t.plan === 'Phase 2' ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700'
                        }`}>{t.plan}</span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-gray-400">{t.created_at.slice(0, 10)}</td>
                    <td className="px-6 py-3.5">
                      <Badge variant={st.variant} dot>{st.label}</Badge>
                    </td>
                  </tr>
                )
              })}
              {recent.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-400">No clients yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
