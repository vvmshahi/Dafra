import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt,
  StatCard, SkeletonCard, SkeletonTable, SkeletonChart,
  EmptyChart, SectionHeader, ChartTooltip, CHART_COLORS,
} from './reportUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DaySale      { date: string; revenue: number; invoices: number }
interface MethodData   { name: string; value: number }
interface TopProduct   { name: string; quantity: number; revenue: number; pct: number }
interface CatPerf      { name: string; items: number; revenue: number; pct: number }

interface SalesData {
  totalRevenue:  number
  invoiceCount:  number
  avgOrderValue: number
  vatCollected:  number
  dailySales:    DaySale[]
  byMethod:      MethodData[]
  topProducts:   TopProduct[]
  catPerformance: CatPerf[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank Transfer', other: 'Other',
}
const METHOD_COLORS: Record<string, string> = {
  cash: '#10b981', card: '#6366f1', bank_transfer: '#f59e0b', other: '#9ca3af',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SalesReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<SalesData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) return
      setLoading(true)
      try {
        // 1. Invoices in range (non-cancelled)
        let invQuery = supabase
          .from('invoices')
          .select('id, invoice_date, total_amount, tax_amount')
          .neq('status', 'cancelled')
          .gte('invoice_date', startDate)
          .lte('invoice_date', endDate)
        invQuery = branchId
          ? invQuery.eq('branch_id', branchId)
          : invQuery.eq('tenant_id', tid)
        const { data: invData } = await invQuery

        const invoices = (invData ?? []) as any[]
        const invoiceIds = invoices.map(i => i.id)

        // 2. Payments + items (skip if no invoices)
        let payments: any[] = []
        let items:    any[] = []
        let products: any[] = []

        if (invoiceIds.length > 0) {
          const [{ data: payData }, { data: itemData }] = await Promise.all([
            supabase.from('payments').select('method, amount').in('invoice_id', invoiceIds),
            supabase.from('invoice_items').select('name, quantity, total, product_id').in('invoice_id', invoiceIds),
          ])
          payments = (payData ?? []) as any[]
          items    = (itemData ?? []) as any[]

          // 3. Products for category info
          const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))]
          if (productIds.length > 0) {
            const { data: prodData } = await supabase
              .from('products')
              .select('id, categories(name)')
              .in('id', productIds)
            products = (prodData ?? []) as any[]
          }
        }

        if (cancelled) return

        // Totals
        const totalRevenue = invoices.reduce((s, i) => s + Number(i.total_amount), 0)
        const vatCollected = invoices.reduce((s, i) => s + Number(i.tax_amount), 0)

        // Daily sales
        const dayMap = new Map<string, DaySale>()
        for (const inv of invoices) {
          const d = inv.invoice_date as string
          const curr = dayMap.get(d) ?? { date: d, revenue: 0, invoices: 0 }
          curr.revenue  += Number(inv.total_amount)
          curr.invoices += 1
          dayMap.set(d, curr)
        }
        const dailySales = Array.from(dayMap.values())
          .sort((a, b) => a.date.localeCompare(b.date))

        // Payment method breakdown
        const methodMap = new Map<string, number>()
        for (const p of payments) {
          methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + Number(p.amount))
        }
        const byMethod: MethodData[] = Array.from(methodMap.entries())
          .map(([name, value]) => ({ name: METHOD_LABELS[name] ?? name, value }))

        // Top products
        const prodMap = new Map<string, { quantity: number; revenue: number }>()
        for (const item of items) {
          const curr = prodMap.get(item.name) ?? { quantity: 0, revenue: 0 }
          curr.quantity += Number(item.quantity)
          curr.revenue  += Number(item.total)
          prodMap.set(item.name, curr)
        }
        const topProducts: TopProduct[] = Array.from(prodMap.entries())
          .map(([name, s]) => ({ name, ...s, pct: totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0 }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)

        // Category performance
        const catIdMap = new Map<string, string>()
        for (const p of products) {
          catIdMap.set(p.id, (p.categories as any)?.name ?? 'Uncategorized')
        }
        const catMap = new Map<string, { items: number; revenue: number }>()
        for (const item of items) {
          const cat = (item.product_id && catIdMap.get(item.product_id)) ?? 'Uncategorized'
          const curr = catMap.get(cat) ?? { items: 0, revenue: 0 }
          curr.items   += Number(item.quantity)
          curr.revenue += Number(item.total)
          catMap.set(cat, curr)
        }
        const catPerformance: CatPerf[] = Array.from(catMap.entries())
          .map(([name, s]) => ({ name, ...s, pct: totalRevenue > 0 ? (s.revenue / totalRevenue) * 100 : 0 }))
          .sort((a, b) => b.revenue - a.revenue)

        setData({
          totalRevenue,
          invoiceCount: invoices.length,
          avgOrderValue: invoices.length > 0 ? totalRevenue / invoices.length : 0,
          vatCollected,
          dailySales,
          byMethod,
          topProducts,
          catPerformance,
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [startDate, endDate, branchId, profile?.tenant_id])

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex gap-3 flex-wrap">{[0,1,2,3].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonChart />
        <SkeletonTable />
      </div>
    )
  }

  if (!data || data.invoiceCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-700 font-semibold">No sales data for this period</p>
        <p className="text-gray-400 text-sm mt-1">Try a different date range</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <StatCard label="Total Revenue"    value={`SAR ${fmt(data.totalRevenue)}`}  primary />
        <StatCard label="Total Invoices"   value={String(data.invoiceCount)}         sub="non-cancelled" />
        <StatCard label="Average Order"    value={`SAR ${fmt(data.avgOrderValue)}`}  accent="emerald" />
        <StatCard label="VAT Collected"    value={`SAR ${fmt(data.vatCollected)}`}   accent="amber" />
      </div>

      {/* ── Charts row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Daily sales area chart */}
        <div className="lg:col-span-2 card p-4 space-y-3">
          <SectionHeader title="Daily Sales Trend" sub={`${data.dailySales.length} days`} />
          {data.dailySales.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.dailySales} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickFormatter={d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={60}
                  tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981"
                  strokeWidth={2} fill="url(#salesGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payment method donut */}
        <div className="card p-4 space-y-3">
          <SectionHeader title="By Payment Method" />
          {data.byMethod.length === 0 ? <EmptyChart message="No payments recorded" /> : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={data.byMethod} cx="50%" cy="50%"
                    innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={2}>
                    {data.byMethod.map((entry, i) => (
                      <Cell key={i} fill={
                        Object.entries(METHOD_LABELS).find(([, v]) => v === entry.name)?.[0]
                          ? METHOD_COLORS[Object.entries(METHOD_LABELS).find(([, v]) => v === entry.name)![0]]
                          : CHART_COLORS[i]
                      } />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`SAR ${fmt(Number(v))}`, '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5">
                {data.byMethod.map((m, i) => {
                  const total = data.byMethod.reduce((s, x) => s + x.value, 0)
                  const pct   = total > 0 ? (m.value / total) * 100 : 0
                  const color = Object.entries(METHOD_LABELS).find(([, v]) => v === m.name)?.[0]
                    ? METHOD_COLORS[Object.entries(METHOD_LABELS).find(([, v]) => v === m.name)![0]]
                    : CHART_COLORS[i]
                  return (
                    <div key={m.name} className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="flex-1 text-gray-600">{m.name}</span>
                      <span className="font-semibold text-gray-800 tabular-nums">SAR {fmt(m.value)}</span>
                      <span className="text-gray-400 w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Tables row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Top products */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <SectionHeader title="Top Selling Products" sub={`by revenue`} />
          </div>
          {data.topProducts.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No items sold</div>
          ) : (
            <>
              <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                <div className="flex-1">Product</div>
                <div className="w-14 text-right">Qty</div>
                <div className="w-24 text-right">Revenue</div>
                <div className="w-10 text-right">%</div>
              </div>
              {data.topProducts.map((p, i) => (
                <div key={p.name} className="flex gap-2 px-4 py-2.5 border-t border-gray-50 hover:bg-gray-50/50">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-300 w-4">{i + 1}</span>
                    <p className="text-sm text-gray-800 truncate">{p.name}</p>
                  </div>
                  <div className="w-14 text-right text-sm text-gray-600 tabular-nums">
                    {fmtQty(p.quantity)}
                  </div>
                  <div className="w-24 text-right text-sm font-semibold text-gray-900 tabular-nums">
                    SAR {fmt(p.revenue)}
                  </div>
                  <div className="w-10 text-right text-xs text-emerald-600 font-medium tabular-nums">
                    {p.pct.toFixed(1)}%
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Category performance */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <SectionHeader title="Category Performance" />
          </div>
          {data.catPerformance.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No category data</div>
          ) : (
            <>
              <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                <div className="flex-1">Category</div>
                <div className="w-14 text-right">Items</div>
                <div className="w-24 text-right">Revenue</div>
                <div className="w-10 text-right">%</div>
              </div>
              {data.catPerformance.map((c, i) => (
                <div key={c.name} className="flex gap-2 px-4 py-2.5 border-t border-gray-50 hover:bg-gray-50/50">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <p className="text-sm text-gray-800 truncate">{c.name}</p>
                  </div>
                  <div className="w-14 text-right text-sm text-gray-600 tabular-nums">
                    {fmtQty(c.items)}
                  </div>
                  <div className="w-24 text-right text-sm font-semibold text-gray-900 tabular-nums">
                    SAR {fmt(c.revenue)}
                  </div>
                  <div className="w-10 text-right text-xs text-emerald-600 font-medium tabular-nums">
                    {c.pct.toFixed(1)}%
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function fmtQty(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
