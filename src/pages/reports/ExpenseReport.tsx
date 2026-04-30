import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt, fmtDate, generateMonths,
  StatCard, SkeletonCard, SkeletonChart,
  EmptyChart, SectionHeader, CHART_COLORS,
} from './reportUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatBar     { name: string; value: number; color: string }
interface ExpenseLog { date: string; description: string; category: string; amount: number; method: string }

interface ExpData {
  totalVariable: number
  totalFixed:    number
  grandTotal:    number
  catBars:       CatBar[]
  log:           ExpenseLog[]
  monthlyFixed:  number
}

const PAY_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank', other: 'Other',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExpenseReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<ExpData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) return
      setLoading(true)
      try {
        const [{ data: expData }, { data: fixData }] = await Promise.all([
          (branchId
            ? supabase.from('expenses').eq('branch_id', branchId)
            : supabase.from('expenses').eq('tenant_id', tid))
            .select('expense_date, description, total_paid, payment_method, expense_categories(name,color,icon)')
            .gte('expense_date', startDate)
            .lte('expense_date', endDate)
            .order('expense_date', { ascending: false }),
          (branchId
            ? supabase.from('fixed_expenses').eq('branch_id', branchId)
            : supabase.from('fixed_expenses').eq('tenant_id', tid))
            .select('monthly_amount, is_active')
            .eq('is_active', true),
        ])

        if (cancelled) return

        const expenses  = (expData  ?? []) as any[]
        const fixedList = (fixData  ?? []) as any[]

        const months       = generateMonths(startDate, endDate)
        const monthlyFixed = fixedList.reduce((s: number, f: any) => s + Number(f.monthly_amount), 0)
        const totalFixed   = monthlyFixed * months.length
        const totalVariable = expenses.reduce((s: number, e: any) => s + Number(e.total_paid), 0)
        const grandTotal    = totalVariable + totalFixed

        // Category bars
        const catMap = new Map<string, { value: number; color: string }>()
        for (const e of expenses) {
          const cat   = (e.expense_categories as any)?.name  ?? 'Uncategorized'
          const color = (e.expense_categories as any)?.color ?? '#6b7280'
          const curr  = catMap.get(cat) ?? { value: 0, color }
          curr.value += Number(e.total_paid)
          catMap.set(cat, curr)
        }
        if (totalFixed > 0) catMap.set('Fixed Costs', { value: totalFixed, color: '#6366f1' })
        const catBars: CatBar[] = Array.from(catMap.entries())
          .map(([name, { value, color }]) => ({ name, value, color }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10)

        // Expense log
        const log: ExpenseLog[] = expenses.map((e: any) => ({
          date:        e.expense_date,
          description: e.description,
          category:    (e.expense_categories as any)?.name ?? '—',
          amount:      Number(e.total_paid),
          method:      e.payment_method,
        }))

        setData({ totalVariable, totalFixed, grandTotal, catBars, log, monthlyFixed })
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
        <div className="flex flex-wrap gap-3">{[0,1,2].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonChart />
        <div className="h-64 animate-pulse bg-gray-100 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard label="Total Expenses"    value={`SAR ${fmt(data?.grandTotal ?? 0)}`}    primary />
        <StatCard label="Variable Expenses" value={`SAR ${fmt(data?.totalVariable ?? 0)}`} accent="red"   sub="daily/one-off" />
        <StatCard label="Fixed Expenses"    value={`SAR ${fmt(data?.totalFixed ?? 0)}`}    accent="amber" sub="recurring monthly" />
      </div>

      {/* ── Category bar chart ──────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <SectionHeader title="Expenses by Category" />
        {!data?.catBars.length ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.catBars} layout="vertical"
              margin={{ top: 0, right: 20, bottom: 0, left: 100 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickFormatter={v => `${(Number(v)/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={95} />
              <Tooltip
                formatter={(v: any) => [`SAR ${fmt(Number(v))}`, 'Amount']}
                contentStyle={{ borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }}
              />
              <Bar dataKey="value" name="Amount" radius={[0, 3, 3, 0]}>
                {data.catBars.map((c, i) => (
                  <Cell key={i} fill={c.color !== '#6b7280' ? c.color : CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Fixed vs Variable breakdown ─────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Variable</p>
          <p className="text-2xl font-bold text-red-500 mt-1">SAR {fmt(data?.totalVariable ?? 0)}</p>
          <p className="text-xs text-gray-400 mt-1">{data?.log.length ?? 0} expense entries</p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-red-400 rounded-full transition-all"
              style={{ width: `${data?.grandTotal ? (data.totalVariable / data.grandTotal) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Fixed</p>
          <p className="text-2xl font-bold text-amber-500 mt-1">SAR {fmt(data?.totalFixed ?? 0)}</p>
          <p className="text-xs text-gray-400 mt-1">SAR {fmt(data?.monthlyFixed ?? 0)}/mo recurring</p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-all"
              style={{ width: `${data?.grandTotal ? (data.totalFixed / data.grandTotal) * 100 : 0}%` }} />
          </div>
        </div>
      </div>

      {/* ── Expense log ─────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <SectionHeader title="Expense Log" sub={`${data?.log.length ?? 0} entries`} />
        </div>
        {!data?.log.length ? (
          <div className="py-12 text-center text-sm text-gray-400">No expenses in this period</div>
        ) : (
          <>
            <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              <div className="w-20">Date</div>
              <div className="flex-1">Description</div>
              <div className="w-28 hidden sm:block">Category</div>
              <div className="w-16 hidden md:block">Method</div>
              <div className="w-24 text-right">Amount</div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data.log.map((e, i) => (
                <div key={i} className="flex gap-2 px-4 py-2.5 border-t border-gray-50 hover:bg-gray-50/50">
                  <div className="w-20 text-xs text-gray-500 whitespace-nowrap pt-0.5">{fmtDate(e.date)}</div>
                  <div className="flex-1 min-w-0 text-sm text-gray-800 truncate">{e.description}</div>
                  <div className="w-28 hidden sm:block text-xs text-gray-500 truncate pt-0.5">{e.category}</div>
                  <div className="w-16 hidden md:block text-xs text-gray-500 pt-0.5">{PAY_LABEL[e.method] ?? e.method}</div>
                  <div className="w-24 text-right text-sm font-semibold text-gray-900 tabular-nums">
                    SAR {fmt(e.amount)}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
              <div className="flex-1 text-xs font-semibold text-gray-500">{data.log.length} variable expenses</div>
              <div className="w-24 text-right text-sm font-bold text-red-600 tabular-nums">
                SAR {fmt(data.totalVariable)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
