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
import { useAuth } from '@/hooks/useAuth'
import { Badge } from '@/components/ui/Badge'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'

const db = () => supabase as any

function todayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end   = new Date(); end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

function last7Days() {
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
  posted:  { variant: 'success' as const, label: 'Posted',  icon: CheckCircle2 },
  draft:   { variant: 'neutral' as const, label: 'Draft',   icon: AlertCircle },
  paid:    { variant: 'success' as const, label: 'Paid',    icon: CheckCircle2 },
  pending: { variant: 'warning' as const, label: 'Pending', icon: Clock },
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

  const loadStats = useCallback(async () => {
    if (!tid || !bid) { setStatsLoading(false); return }
    setStatsLoading(true)
    const { start, end } = todayRange()
    const [invRes, expRes, branchRes] = await Promise.all([
      db().from('invoices')
        .select('total_amount, id, payment_method, tax_amount')
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .gte('created_at', start)
        .lte('created_at', end),
      db().from('expenses')
        .select('amount')
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .gte('expense_date', start.slice(0, 10))
        .lte('expense_date', end.slice(0, 10)),
      db().from('branches').select('name').eq('id', bid).maybeSingle(),
    ])
    const invs = invRes.data ?? []
    setTodaySales(invs.reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0))
    setTodayCount(invs.length)
    setTodayCash(invs.filter((i: any) => i.payment_method === 'cash').reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0))
    setTodayCard(invs.filter((i: any) => i.payment_method === 'card').reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0))
    setTodayVat(invs.reduce((s: number, i: any) => s + Number(i.tax_amount ?? 0), 0))
    setTodayExpenses((expRes.data ?? []).reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0))
    setBranchName(branchRes.data?.name ?? '')
    setStatsLoading(false)
  }, [tid, bid])

  const loadChart = useCallback(async () => {
    if (!tid || !bid) { setChartLoading(false); return }
    setChartLoading(true)
    const from = new Date(); from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0)
    const { data } = await db()
      .from('invoices')
      .select('invoice_date, total_amount')
      .eq('tenant_id', tid)
      .eq('branch_id', bid)
      .gte('invoice_date', from.toISOString().slice(0, 10))
      .order('invoice_date', { ascending: true })

    const buckets: Record<string, number> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      buckets[d.toISOString().slice(0, 10)] = 0
    }
    for (const inv of data ?? []) {
      const key = inv.invoice_date?.slice(0, 10)
      if (key && key in buckets) buckets[key] += Number(inv.total_amount ?? 0)
    }
    setSalesData(Object.entries(buckets).map(([date, sales]) => ({
      day: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      sales,
    })))
    setChartLoading(false)
  }, [tid, bid])

  const loadInvoices = useCallback(async () => {
    if (!tid || !bid) { setInvLoading(false); return }
    setInvLoading(true)
    const { data } = await db()
      .from('invoices')
      .select('id, invoice_number, total_amount, status, invoice_date, customers(name)')
      .eq('tenant_id', tid)
      .eq('branch_id', bid)
      .order('created_at', { ascending: false })
      .limit(6)
    setRecentInvs(data ?? [])
    setInvLoading(false)
  }, [tid, bid])

  const loadLowStock = useCallback(async () => {
    if (!tid) { setLowStockLoading(false); return }
    setLowStockLoading(true)
    const { data } = await db()
      .from('products')
      .select('id, name, stock_quantity, min_stock_level')
      .eq('tenant_id', tid)
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

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-[#0F2419] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold-500 flex items-center justify-center flex-shrink-0">
            <span className="text-[#0F2419] font-black text-base leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>د</span>
          </div>
          <div>
            <p className="text-white font-bold text-lg leading-none" style={{ fontFamily: 'Cairo, sans-serif' }}>دفرة</p>
            <p className="text-white/50 text-xs mt-0.5">{branchName || tenant?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            label="Today's Sales"
            value={<Rial amount={todaySales} />}
            sub={`${todayCount} invoice${todayCount !== 1 ? 's' : ''}`}
            icon={TrendingUp}
            gradient="bg-gradient-to-br from-[#1B6B3A] to-[#0F4A28]"
            loading={statsLoading}
          />
          <StatCard
            label="Invoices Today"
            value={String(todayCount)}
            sub="Posted this session"
            icon={FileText}
            gradient="bg-gradient-to-br from-[#1e40af] to-[#1d3a8a]"
            loading={statsLoading}
          />
          <StatCard
            label="Today's Expenses"
            value={<Rial amount={todayExpenses} />}
            sub="Recorded today"
            icon={CreditCard}
            gradient="bg-gradient-to-br from-[#7c3aed] to-[#5b21b6]"
            loading={statsLoading}
          />
          <StatCard
            label="Cash Today"
            value={<Rial amount={todayCash} />}
            sub="Cash payments"
            icon={Banknote}
            gradient="bg-gradient-to-br from-[#059669] to-[#047857]"
            loading={statsLoading}
          />
          <StatCard
            label="Card Today"
            value={<Rial amount={todayCard} />}
            sub="Card payments"
            icon={CreditCard}
            gradient="bg-gradient-to-br from-[#0891b2] to-[#0e7490]"
            loading={statsLoading}
          />
          <StatCard
            label="VAT Collected"
            value={<Rial amount={todayVat} />}
            sub="Tax on today's sales"
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
                          <Rial amount={Number(inv.total_amount)} />
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
    </div>
  )
}
