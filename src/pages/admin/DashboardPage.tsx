import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, ShoppingBag, Users, FileText,
  Plus, ArrowRight, CheckCircle2, Clock, AlertCircle,
  Receipt, Package, Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

const db = () => supabase as any

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end   = new Date(); end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

function last7Days(): { day: string; sales: number }[] {
  const result = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    result.push({
      day:   d.toLocaleDateString('en-US', { weekday: 'short' }),
      date:  d.toISOString().slice(0, 10),
      sales: 0,
    })
  }
  return result
}

const statusConfig = {
  posted:   { variant: 'success' as const, label: 'Posted',   icon: CheckCircle2 },
  draft:    { variant: 'neutral' as const, label: 'Draft',    icon: AlertCircle },
  paid:     { variant: 'success' as const, label: 'Paid',     icon: CheckCircle2 },
  pending:  { variant: 'warning' as const, label: 'Pending',  icon: Clock },
  void:     { variant: 'danger'  as const, label: 'Void',     icon: AlertCircle },
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, gradient, iconBg, loading }: {
  label: string; value: string; sub: string
  icon: React.ElementType; gradient: string; iconBg: string; loading?: boolean
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl p-6 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white/70">{label}</p>
          {loading
            ? <div className="mt-1.5 h-7 w-24 bg-white/20 rounded animate-pulse" />
            : <p className="mt-1.5 text-2xl font-bold text-white tracking-tight">{value}</p>
          }
          <p className="mt-1 text-xs text-white/60">{sub}</p>
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
      <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full bg-white/5" />
    </div>
  )
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-lg px-3.5 py-2.5">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900">SAR {Number(payload[0].value).toLocaleString()}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('7d')

  const [statsLoading, setStatsLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(true)
  const [invLoading,   setInvLoading]   = useState(true)

  const [todaySales,    setTodaySales]    = useState(0)
  const [todayCount,    setTodayCount]    = useState(0)
  const [productCount,  setProductCount]  = useState(0)
  const [customerCount, setCustomerCount] = useState(0)
  const [salesData,     setSalesData]     = useState(last7Days())
  const [recentInvs,    setRecentInvs]    = useState<any[]>([])

  const tid = profile?.tenant_id

  // KPI stats
  const loadStats = useCallback(async () => {
    if (!tid) return
    setStatsLoading(true)
    const { start, end } = todayRange()
    const [todayRes, prodRes, custRes] = await Promise.all([
      db().from('invoices')
        .select('total_amount, id')
        .eq('tenant_id', tid)
        .gte('created_at', start)
        .lte('created_at', end),
      db().from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('is_active', true),
      db().from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('is_active', true),
    ])
    const invs = todayRes.data ?? []
    setTodaySales(invs.reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0))
    setTodayCount(invs.length)
    setProductCount(prodRes.count ?? 0)
    setCustomerCount(custRes.count ?? 0)
    setStatsLoading(false)
  }, [tid])

  // Sales chart
  const loadChart = useCallback(async () => {
    if (!tid) return
    setChartLoading(true)
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const from = new Date(); from.setDate(from.getDate() - (days - 1)); from.setHours(0,0,0,0)

    const { data } = await db()
      .from('invoices')
      .select('invoice_date, total_amount')
      .eq('tenant_id', tid)
      .gte('invoice_date', from.toISOString().slice(0, 10))
      .order('invoice_date', { ascending: true })

    // Build daily buckets
    const buckets: Record<string, number> = {}
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      buckets[d.toISOString().slice(0, 10)] = 0
    }
    for (const inv of data ?? []) {
      const key = inv.invoice_date?.slice(0, 10)
      if (key && key in buckets) buckets[key] += Number(inv.total_amount ?? 0)
    }

    const grouped = Object.entries(buckets).map(([date, sales]) => {
      const d = new Date(date + 'T00:00:00')
      const label = days <= 7
        ? d.toLocaleDateString('en-US', { weekday: 'short' })
        : days <= 30
          ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return { day: label, sales }
    })
    setSalesData(grouped)
    setChartLoading(false)
  }, [tid, period])

  // Recent invoices
  const loadInvoices = useCallback(async () => {
    if (!tid) return
    setInvLoading(true)
    const { data } = await db()
      .from('invoices')
      .select('id, invoice_number, total_amount, status, invoice_date, customers(name)')
      .eq('tenant_id', tid)
      .order('created_at', { ascending: false })
      .limit(6)
    setRecentInvs(data ?? [])
    setInvLoading(false)
  }, [tid])

  useEffect(() => { loadStats() },   [loadStats])
  useEffect(() => { loadChart() },   [loadChart])
  useEffect(() => { loadInvoices() }, [loadInvoices])

  const fmtSAR = (n: number) => `SAR ${n.toLocaleString('en-SA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

  return (
    <div className="space-y-6">

      {/* ── KPI grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Today's Sales"
          value={fmtSAR(todaySales)}
          sub={`${todayCount} invoice${todayCount !== 1 ? 's' : ''} today`}
          icon={TrendingUp}
          gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]"
          iconBg="bg-white/15"
          loading={statsLoading}
        />
        <StatCard
          label="Products"
          value={String(productCount)}
          sub="Active products"
          icon={Package}
          gradient="bg-gradient-to-br from-[#C8A96E] to-[#a8893e]"
          iconBg="bg-white/15"
          loading={statsLoading}
        />
        <StatCard
          label="Invoices Today"
          value={String(todayCount)}
          sub="Posted this session"
          icon={FileText}
          gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]"
          iconBg="bg-white/15"
          loading={statsLoading}
        />
        <StatCard
          label="Customers"
          value={String(customerCount)}
          sub="Registered customers"
          icon={Users}
          gradient="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6]"
          iconBg="bg-white/15"
          loading={statsLoading}
        />
      </div>

      {/* ── Charts row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Sales chart */}
        <div className="xl:col-span-2 card p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Sales Trend</h2>
              <p className="text-xs text-gray-400 mt-0.5">Daily revenue</p>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              {(['7d', '30d', '90d'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    period === p ? 'bg-white text-gray-900 shadow-card' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
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
              <TrendingUp size={32} className="mb-2" />
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
                <Area type="monotone" dataKey="sales"
                  stroke="#1B6B3A" strokeWidth={2}
                  fill="url(#salesGrad)"
                  dot={false} activeDot={{ r: 5, fill: '#1B6B3A', strokeWidth: 2, stroke: '#fff' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Quick actions */}
        <div className="card p-6 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Quick Actions</h2>
          {[
            { label: 'New Invoice',  desc: 'Open POS terminal',     icon: Receipt,    path: '/pos',       primary: true },
            { label: 'Add Product',  desc: 'Add to catalog',         icon: Package,    path: '/products',  primary: false },
            { label: 'Add Customer', desc: 'Register new customer',  icon: Users,      path: '/customers', primary: false },
            { label: 'View Reports', desc: 'Sales & tax reports',    icon: TrendingUp, path: '/reports',   primary: false },
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
              <Plus size={14} className={action.primary ? 'text-white/70' : 'text-gray-300'} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Recent invoices ───────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Recent Invoices</h2>
          <button onClick={() => navigate('/invoices')}
            className="text-xs text-primary-600 font-medium hover:text-primary-700 flex items-center gap-1">
            View all <ArrowRight size={12} />
          </button>
        </div>

        {invLoading ? (
          <div className="divide-y divide-gray-50">
            {[1,2,3,4].map(i => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 bg-gray-100 rounded w-20" />
                <div className="flex-1 h-3 bg-gray-100 rounded" />
                <div className="h-3 bg-gray-100 rounded w-16" />
              </div>
            ))}
          </div>
        ) : recentInvs.length === 0 ? (
          <div className="py-12 text-center">
            <ShoppingBag size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No invoices yet</p>
            <p className="text-xs text-gray-400 mt-1">Start your first sale from the POS</p>
            <button onClick={() => navigate('/pos')}
              className="btn-primary mt-4 flex items-center gap-2 mx-auto">
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
                  return (
                    <tr key={inv.id}
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                      className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                      <td className="px-6 py-3.5 text-xs font-mono font-semibold text-primary-600">
                        {inv.invoice_number}
                      </td>
                      <td className="px-6 py-3.5 text-sm text-gray-700">
                        {inv.customers?.name ?? 'Walk-in Customer'}
                      </td>
                      <td className="px-6 py-3.5 text-sm font-semibold text-gray-900 text-right tabular-nums">
                        SAR {Number(inv.total_amount).toLocaleString('en-SA', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge variant={cfg.variant} dot>{cfg.label}</Badge>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-gray-400">{inv.invoice_date}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
