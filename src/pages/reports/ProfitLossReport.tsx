import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { Info } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmtMonth,
  SkeletonCard, SkeletonChart, SkeletonTable,
  EmptyChart, ReportErrorState, SectionHeader, ChartTooltip, CHART_COLORS,
} from './reportUtils'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { asArray, loadReportSummary, reportErrorMessage, reportParams } from './reportingRpc'
import { resolveBusinessType } from '@/lib/utils/businessType'
import { useTranslation } from 'react-i18next'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthRow {
  month:       string
  grossSales:  number
  creditNotes: number
  revenue:     number
  cogs:        number
  grossProfit: number
  expenses:    number
  netProfit:   number
}

interface ExpenseCat { name: string; value: number }

interface PLData {
  reportLabel?:   string
  grossSales:    number
  creditNotes:   number
  totalRevenue:  number
  totalCOGS:     number
  grossProfit:   number
  totalExpenses: number
  netProfit:     number
  margin:        number
  monthlyRows:   MonthRow[]
  expenseByCat:  ExpenseCat[]
}

const EMPTY_PL_DATA: PLData = {
  reportLabel: 'Simple Profit Estimate',
  grossSales: 0,
  creditNotes: 0,
  totalRevenue: 0,
  totalCOGS: 0,
  grossProfit: 0,
  totalExpenses: 0,
  netProfit: 0,
  margin: 0,
  monthlyRows: [],
  expenseByCat: [],
}

function ProfitKpi({ label, value, sub, primary = false, positive = false, quiet = false }: {
  label: string
  value: React.ReactNode
  sub?: string
  primary?: boolean
  positive?: boolean
  quiet?: boolean
}) {
  return (
    <div className={`min-h-[5.5rem] rounded-xl border px-3 py-2.5 ${primary ? 'border-[#0F2419] bg-[#0F2419] text-[#FFF9E8]' : 'border-[#1B6B3A]/20 bg-[#fffdf7] text-slate-900'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wide ${primary ? 'text-[#F3D98B]' : 'text-slate-500'}`}>{label}</p>
      <p className={`mt-1 text-base font-black tabular-nums ${primary ? 'text-[#FFF9E8]' : quiet ? 'text-slate-400' : positive ? 'text-[#1B6B3A]' : 'text-[#0F2419]'}`}>{value}</p>
      {sub && <p className={`mt-0.5 text-[10px] leading-4 ${primary ? 'text-white/60' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProfitLossReport({ startDate, endDate, branchId }: ReportProps) {
  const { t } = useTranslation('reports')
  const { profile, tenant } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<PLData | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const summary = await loadReportSummary<PLData>(
          'get_profit_report_summary',
          reportParams(startDate, endDate, branchId),
          EMPTY_PL_DATA,
        )
        if (cancelled) return
        setData({
          ...summary,
          monthlyRows: asArray<MonthRow>(summary.monthlyRows),
          expenseByCat: asArray<ExpenseCat>(summary.expenseByCat),
        })
      } catch (error) {
        console.error('Unable to load profit summary', error)
        if (!cancelled) {
          setData(null)
          setError(t('reports:errors.load'))
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
        <div className="flex flex-wrap gap-3">{[0,1,2,3,4,5].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonChart />
        <SkeletonTable />
      </div>
    )
  }

  if (error) return <ReportErrorState message={error} />

  const noData = !data || (data.totalRevenue === 0 && data.totalCOGS === 0 && data.totalExpenses === 0)

  if (noData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-700 font-semibold">{t('profit.empty')}</p><p className="text-gray-400 text-sm mt-1">{t('common.tryRange')}</p>
      </div>
    )
  }

  const chartData = (data!.monthlyRows ?? []).map(r => ({
    month:    fmtMonth(r.month),
    Revenue:  r.revenue,
    Expenses: r.expenses + r.cogs,
    'Net Estimate': r.netProfit,
  }))
  const businessType = resolveBusinessType(tenant?.business_type)
  const isService = businessType === 'service'
  const reportTitle = isService ? 'Simple Profit Estimate' : 'Profit Estimate'
  const purchaseCostLabel = isService ? 'Materials / Purchases' : 'Purchase Costs'
  const purchaseCostSub = isService ? 'materials and purchase-period costs' : 'counted purchase estimate'
  const monthlySub = isService
    ? 'Materials and purchases are simple period costs, not recipe/BOM costing'
    : 'Purchase-period costs are not true stock COGS'

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[#1B6B3A]/20 bg-[#f8fbf7] px-3 py-2.5">
        <Info className="mt-0.5 shrink-0 text-[#1B6B3A]" size={15} aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold text-[#0F2419]">
            Sales figures include VAT. Use VAT Support for output VAT details.
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
            Estimated gross profit is based on current reporting totals; detailed VAT-exclusive profit can be added in a later accounting phase.
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ProfitKpi label={t('metrics.grossSalesVat')} value={<Rial amount={data!.grossSales} />} primary />
        <ProfitKpi label={t('metrics.creditNotes')} value={<Rial amount={data!.creditNotes} />} quiet={data!.creditNotes === 0} />
        <ProfitKpi label={t('metrics.netSalesVat')} value={<Rial amount={data!.totalRevenue} />} positive />
        <ProfitKpi label={purchaseCostLabel} value={<Rial amount={data!.totalCOGS} />} sub={purchaseCostSub} quiet={data!.totalCOGS === 0} />
        <ProfitKpi label={t('metrics.grossProfit')} value={<Rial amount={data!.grossProfit} />} positive={data!.grossProfit >= 0} />
        <ProfitKpi label={t('metrics.totalExpenses')} value={<Rial amount={data!.totalExpenses} />} quiet={data!.totalExpenses === 0} />
        <ProfitKpi label={t('metrics.netEstimate')} value={<Rial amount={data!.netProfit} />} positive={data!.netProfit >= 0} sub={t('profit.formula')} />
        <ProfitKpi label={t('metrics.netMargin')} value={`${data!.margin.toFixed(1)}%`} positive={data!.margin >= 0} />
      </div>

      {/* ── Charts row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-stretch">

        {/* Monthly bar chart */}
        <div className="lg:col-span-2 card p-4 space-y-3">
          <SectionHeader title={`${reportTitle} by Month`} />
          {chartData.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={60}
                  tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar dataKey="Revenue"  fill="#1B6B3A" radius={[3,3,0,0]} />
                <Bar dataKey="Expenses" fill="#b45355" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Expense breakdown donut */}
        <div className="card flex h-full flex-col p-4">
          <SectionHeader title={t('profit.expenseBreakdown')} />
          {data!.expenseByCat.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-[#1B6B3A]/10 bg-[#f8fbf7] px-4 text-center">
              <Info size={16} className="mb-2 text-[#1B6B3A]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#0F2419]">{t('profit.noExpenses')}</p>
              <p className="mt-1 text-xs text-slate-500">{t('profit.noExpensesHint')}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
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
            </div>
          )}
        </div>
      </div>

      {/* ── Monthly P&L table ───────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <SectionHeader title={`Monthly ${reportTitle} Summary`} sub={monthlySub} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Month','Gross Sales incl. VAT','Credit Notes','Net Sales incl. VAT', isService ? 'Materials / Purchases' : 'Purchases','Estimated Gross Profit','Expenses','Net Profit'].map(h => (
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
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.grossSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={r.creditNotes} /></td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-[#1B6B3A]"><Rial amount={r.revenue} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={r.cogs} /></td>
                  <td className={`px-4 py-3 tabular-nums font-semibold ${r.grossProfit >= 0 ? 'text-[#1B6B3A]' : 'text-red-500'}`}>
                    <Rial amount={r.grossProfit} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-red-500"><Rial amount={r.expenses} /></td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${r.netProfit >= 0 ? 'text-[#0F2419]' : 'text-red-600'}`}>
                    <Rial amount={r.netProfit} />
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="border-t-2 border-[#1B6B3A]/20 bg-[#f8fbf7] font-bold">
                <td className="px-4 py-3 text-gray-700">{t('common.total')}</td>
                <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={data!.grossSales} /></td>
                <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={data!.creditNotes} /></td>
                <td className="px-4 py-3 tabular-nums text-[#1B6B3A]"><Rial amount={data!.totalRevenue} /></td>
                <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={data!.totalCOGS} /></td>
                <td className={`px-4 py-3 tabular-nums ${data!.grossProfit >= 0 ? 'text-[#1B6B3A]' : 'text-red-500'}`}>
                  <Rial amount={data!.grossProfit} />
                </td>
                <td className="px-4 py-3 tabular-nums text-red-500"><Rial amount={data!.totalExpenses} /></td>
                <td className={`px-4 py-3 tabular-nums ${data!.netProfit >= 0 ? 'text-[#0F2419]' : 'text-red-600'}`}>
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
