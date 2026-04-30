import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt, fmtMonth, generateMonths,
  StatCard, SkeletonCard, SkeletonChart, SkeletonTable,
  EmptyChart, SectionHeader, ChartTooltip, CHART_COLORS,
} from './reportUtils'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthRow {
  month:       string
  revenue:     number
  cogs:        number
  grossProfit: number
  expenses:    number
  netProfit:   number
}

interface ExpenseCat { name: string; value: number }

interface PLData {
  totalRevenue:  number
  totalCOGS:     number
  grossProfit:   number
  totalExpenses: number
  netProfit:     number
  margin:        number
  monthlyRows:   MonthRow[]
  expenseByCat:  ExpenseCat[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProfitLossReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<PLData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      const bid = branchId ?? profile?.branch_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      try {
        // Filter clause helpers
        const invFilter = (q: any) => (branchId ? q.eq('branch_id', branchId) : q.eq('tenant_id', tid))
          .neq('status', 'cancelled').gte('invoice_date', startDate).lte('invoice_date', endDate)
        const purFilter = (q: any) => (branchId ? q.eq('branch_id', branchId) : q.eq('tenant_id', tid))
          .gte('purchase_date', startDate).lte('purchase_date', endDate)
        const expFilter = (q: any) => (branchId ? q.eq('branch_id', branchId) : q.eq('tenant_id', tid))
          .gte('expense_date', startDate).lte('expense_date', endDate)

        const [
          { data: invData },
          { data: purData },
          { data: expData },
          { data: fixedData },
        ] = await Promise.all([
          invFilter(supabase.from('invoices').select('invoice_date, total_amount')),
          purFilter(supabase.from('purchases').select('purchase_date, total_amount')),
          expFilter(supabase.from('expenses').select('expense_date, total_paid, category_id, expense_categories(name,color)')),
          (branchId ? supabase.from('fixed_expenses').eq('branch_id', branchId) : supabase.from('fixed_expenses').eq('tenant_id', tid))
            .select('monthly_amount, is_active').eq('is_active', true),
        ])

        if (cancelled) return

        const invoices     = (invData   ?? []) as any[]
        const purchases    = (purData   ?? []) as any[]
        const expenses     = (expData   ?? []) as any[]
        const fixedMonthly = ((fixedData ?? []) as any[]).reduce((s: number, f: any) => s + Number(f.monthly_amount), 0)

        // Estimate fixed expenses for the date range (# of months × monthly total)
        const months = generateMonths(startDate, endDate)
        const fixedTotal = fixedMonthly * months.length

        const totalRevenue  = invoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0)
        const totalCOGS     = purchases.reduce((s: number, p: any) => s + Number(p.total_amount), 0)
        const varExpenses   = expenses.reduce((s: number, e: any) => s + Number(e.total_paid), 0)
        const totalExpenses = varExpenses + fixedTotal
        const grossProfit   = totalRevenue - totalCOGS
        const netProfit     = grossProfit  - totalExpenses
        const margin        = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

        // Monthly rows
        const monthlyRows: MonthRow[] = months.map(m => {
          const rev  = invoices.filter((i: any)  => (i.invoice_date  as string).startsWith(m)).reduce((s: number, i: any) => s + Number(i.total_amount), 0)
          const cogs = purchases.filter((p: any) => (p.purchase_date as string).startsWith(m)).reduce((s: number, p: any) => s + Number(p.total_amount), 0)
          const exp  = expenses.filter((e: any)  => (e.expense_date  as string).startsWith(m)).reduce((s: number, e: any) => s + Number(e.total_paid), 0) + fixedMonthly
          const gp   = rev - cogs
          const np   = gp - exp
          return { month: m, revenue: rev, cogs, grossProfit: gp, expenses: exp, netProfit: np }
        })

        // Expense by category
        const catMap = new Map<string, number>()
        for (const e of expenses) {
          const cat = (e.expense_categories as any)?.name ?? 'Uncategorized'
          catMap.set(cat, (catMap.get(cat) ?? 0) + Number(e.total_paid))
        }
        if (fixedMonthly > 0) catMap.set('Fixed Costs', (catMap.get('Fixed Costs') ?? 0) + fixedTotal)
        const expenseByCat: ExpenseCat[] = Array.from(catMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)

        setData({ totalRevenue, totalCOGS, grossProfit, totalExpenses, netProfit, margin, monthlyRows, expenseByCat })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [startDate, endDate, branchId, profile?.tenant_id, profile?.branch_id])

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-3">{[0,1,2,3,4,5].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonChart />
        <SkeletonTable />
      </div>
    )
  }

  const noData = !data || (data.totalRevenue === 0 && data.totalCOGS === 0 && data.totalExpenses === 0)

  if (noData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-700 font-semibold">No data for this period</p>
        <p className="text-gray-400 text-sm mt-1">Try a different date range</p>
      </div>
    )
  }

  const chartData = (data!.monthlyRows ?? []).map(r => ({
    month:    fmtMonth(r.month),
    Revenue:  r.revenue,
    Expenses: r.expenses + r.cogs,
    'Net P&L': r.netProfit,
  }))

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard label="Total Revenue"    value={<Rial amount={data!.totalRevenue} />}   primary />
        <StatCard label="Total Purchases"  value={<Rial amount={data!.totalCOGS} />}      accent="amber" sub="cost of goods" />
        <StatCard label="Gross Profit"     value={<Rial amount={data!.grossProfit} />}    accent={data!.grossProfit >= 0 ? 'emerald' : 'red'} />
        <StatCard label="Total Expenses"   value={<Rial amount={data!.totalExpenses} />}  accent="red" />
        <StatCard label="Net Profit"       value={<Rial amount={data!.netProfit} />}      accent={data!.netProfit >= 0 ? 'emerald' : 'red'} sub="revenue − COGS − expenses" />
        <StatCard label="Net Margin"       value={`${data!.margin.toFixed(1)}%`}          accent={data!.margin >= 0 ? 'emerald' : 'red'} />
      </div>

      {/* ── Charts row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Monthly bar chart */}
        <div className="lg:col-span-2 card p-4 space-y-3">
          <SectionHeader title="Revenue vs Expenses by Month" />
          {chartData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={60}
                  tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Revenue"  fill="#10b981" radius={[3,3,0,0]} />
                <Bar dataKey="Expenses" fill="#f59e0b" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Expense breakdown donut */}
        <div className="card p-4 space-y-3">
          <SectionHeader title="Expense Breakdown" />
          {data!.expenseByCat.length === 0 ? <EmptyChart message="No expenses" /> : (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={data!.expenseByCat} cx="50%" cy="50%"
                    innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={2}>
                    {data!.expenseByCat.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => [sarStr(Number(v)), '']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {data!.expenseByCat.map((c, i) => (
                  <div key={c.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="flex-1 text-gray-600 truncate">{c.name}</span>
                    <span className="font-semibold text-gray-800 tabular-nums"><Rial amount={c.value} /></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Monthly P&L table ───────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <SectionHeader title="Monthly P&L Summary" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Month','Revenue','Purchases','Gross Profit','Expenses','Net Profit'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data!.monthlyRows.map(r => (
                <tr key={r.month} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-700">{fmtMonth(r.month)}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600 font-semibold"><Rial amount={r.revenue} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-600"><Rial amount={r.cogs} /></td>
                  <td className={`px-4 py-3 tabular-nums font-semibold ${r.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>
                    <Rial amount={r.grossProfit} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-red-500"><Rial amount={r.expenses} /></td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${r.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    <Rial amount={r.netProfit} />
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                <td className="px-4 py-3 text-gray-700">Total</td>
                <td className="px-4 py-3 tabular-nums text-emerald-600"><Rial amount={data!.totalRevenue} /></td>
                <td className="px-4 py-3 tabular-nums text-amber-600"><Rial amount={data!.totalCOGS} /></td>
                <td className={`px-4 py-3 tabular-nums ${data!.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>
                  <Rial amount={data!.grossProfit} />
                </td>
                <td className="px-4 py-3 tabular-nums text-red-500"><Rial amount={data!.totalExpenses} /></td>
                <td className={`px-4 py-3 tabular-nums ${data!.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  <Rial amount={data!.netProfit} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
