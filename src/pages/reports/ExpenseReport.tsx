import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmtDate,
  StatCard, SkeletonCard, SkeletonChart,
  EmptyChart, ReportErrorState, SectionHeader, CHART_COLORS,
} from './reportUtils'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { asArray, loadReportSummary, reportErrorMessage, reportParams } from './reportingRpc'

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

const EMPTY_EXPENSE_DATA: ExpData = {
  totalVariable: 0,
  totalFixed: 0,
  grandTotal: 0,
  catBars: [],
  log: [],
  monthlyFixed: 0,
}

const PAY_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank', other: 'Other',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExpenseReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<ExpData | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const summary = await loadReportSummary<ExpData>(
          'get_expense_report_summary',
          reportParams(startDate, endDate, branchId),
          EMPTY_EXPENSE_DATA,
        )
        if (cancelled) return
        setData({
          ...summary,
          catBars: asArray<CatBar>(summary.catBars),
          log: asArray<ExpenseLog>(summary.log),
        })
      } catch (error) {
        console.error('Unable to load expense report summary', error)
        if (!cancelled) {
          setData(null)
          setError(reportErrorMessage(error))
        }
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

  if (error) return <ReportErrorState message={error} />

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard label="Total Expenses"    value={<Rial amount={data?.grandTotal ?? 0} />}    primary />
        <StatCard label="Variable Expenses" value={<Rial amount={data?.totalVariable ?? 0} />} accent="red"   sub="daily/one-off" />
        <StatCard label="Fixed Expenses"    value={<Rial amount={data?.totalFixed ?? 0} />}    accent="amber" sub="recurring monthly" />
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
                formatter={(v: any) => [sarStr(Number(v)), 'Amount']}
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
          <p className="text-2xl font-bold text-red-500 mt-1"><Rial amount={data?.totalVariable ?? 0} /></p>
          <p className="text-xs text-gray-400 mt-1">{data?.log.length ?? 0} expense entries</p>
          <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-red-400 rounded-full transition-all"
              style={{ width: `${data?.grandTotal ? (data.totalVariable / data.grandTotal) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Fixed</p>
          <p className="text-2xl font-bold text-amber-500 mt-1"><Rial amount={data?.totalFixed ?? 0} /></p>
          <p className="text-xs text-gray-400 mt-1"><Rial amount={data?.monthlyFixed ?? 0} />/mo recurring</p>
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
                    <Rial amount={e.amount} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
              <div className="flex-1 text-xs font-semibold text-gray-500">{data.log.length} variable expenses</div>
              <div className="w-24 text-right text-sm font-bold text-red-600 tabular-nums">
                <Rial amount={data.totalVariable} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
