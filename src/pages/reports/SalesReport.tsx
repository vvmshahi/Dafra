import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt,
  StatCard, SkeletonCard, SkeletonTable, SkeletonChart,
  EmptyChart, ReportErrorState, SectionHeader, ChartTooltip, CHART_COLORS,
} from './reportUtils'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { loadReportSummary, reportErrorMessage, reportParams } from './reportingRpc'
import { useTranslation } from 'react-i18next'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DaySale      { date: string; revenue: number; invoices: number }
interface MethodData   { name: string; value: number }
interface TopProduct   { name: string; quantity: number; revenue: number; pct: number }
interface CatPerf      { name: string; items: number; revenue: number; pct: number }

interface SalesData {
  grossSales:    number
  creditNotes:   number
  totalRevenue:  number
  invoiceCount:  number
  avgOrderValue: number
  vatOnSales:    number
  vatCredited:   number
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

const EMPTY_SALES_DATA: SalesData = {
  grossSales: 0,
  creditNotes: 0,
  totalRevenue: 0,
  invoiceCount: 0,
  avgOrderValue: 0,
  vatOnSales: 0,
  vatCredited: 0,
  vatCollected: 0,
  dailySales: [],
  byMethod: [],
  topProducts: [],
  catPerformance: [],
}

function numberOrZero(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function arrayFromKeys<T>(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

function normalizeSalesSummary(summary: SalesData): SalesData {
  const record = summary as unknown as Record<string, unknown>

  return {
    grossSales: numberOrZero(record.grossSales),
    creditNotes: numberOrZero(record.creditNotes),
    totalRevenue: numberOrZero(record.totalRevenue),
    invoiceCount: Math.trunc(numberOrZero(record.invoiceCount)),
    avgOrderValue: numberOrZero(record.avgOrderValue),
    vatOnSales: numberOrZero(record.vatOnSales),
    vatCredited: numberOrZero(record.vatCredited),
    vatCollected: numberOrZero(record.vatCollected),
    dailySales: arrayFromKeys<Record<string, unknown>>(record, 'dailySales').map(row => ({
      date: stringOrFallback(row.date, ''),
      revenue: numberOrZero(row.revenue),
      invoices: Math.trunc(numberOrZero(row.invoices)),
    })),
    byMethod: arrayFromKeys<Record<string, unknown>>(record, 'byMethod', 'paymentBreakdown').map(row => ({
      name: stringOrFallback(row.name, 'Other'),
      value: numberOrZero(row.value),
    })),
    topProducts: arrayFromKeys<Record<string, unknown>>(record, 'topProducts').map(row => ({
      name: stringOrFallback(row.name, 'Unknown item'),
      quantity: numberOrZero(row.quantity),
      revenue: numberOrZero(row.revenue),
      pct: numberOrZero(row.pct),
    })),
    catPerformance: arrayFromKeys<Record<string, unknown>>(record, 'catPerformance', 'categoryBreakdown').map(row => ({
      name: stringOrFallback(row.name, 'Uncategorized'),
      items: numberOrZero(row.items),
      revenue: numberOrZero(row.revenue),
      pct: numberOrZero(row.pct),
    })),
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SalesReport({ startDate, endDate, branchId }: ReportProps) {
  const { t } = useTranslation('reports')
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<SalesData | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const summary = await loadReportSummary<SalesData>(
          'get_sales_report_summary',
          reportParams(startDate, endDate, branchId),
          EMPTY_SALES_DATA,
        )
        if (cancelled) return
        setData(normalizeSalesSummary(summary))
      } catch (error) {
        console.error('Unable to load sales report summary', error)
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
        <div className="flex gap-3 flex-wrap">{[0,1,2,3].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonChart />
        <SkeletonTable />
      </div>
    )
  }

  if (error) return <ReportErrorState message={error} />

  if (!data || data.invoiceCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-700 font-semibold">{t('sales.empty')}</p>
        <p className="text-gray-400 text-sm mt-1">{t('common.tryRange')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <StatCard label={t('metrics.grossSales')} value={<Rial amount={data.grossSales} />} primary />
        <StatCard label={t('metrics.creditNotes')} value={<Rial amount={data.creditNotes} />} accent="amber" />
        <StatCard label={t('metrics.netSales')} value={<Rial amount={data.totalRevenue} />} accent="emerald" />
        <StatCard label={t('metrics.netVat')} value={<Rial amount={data.vatCollected} />} accent="amber" sub={t('sales.vatSub', { sales: sarStr(data.vatOnSales), credited: sarStr(data.vatCredited) })} />
        <StatCard label={t('metrics.documents')} value={String(data.invoiceCount)} sub={t('sales.nonCancelled')} />
        <StatCard label={t('metrics.averageOrder')} value={<Rial amount={data.avgOrderValue} />} accent="emerald" />
      </div>

      {/* ── Charts row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Daily sales area chart */}
        <div className="lg:col-span-2 card p-4 space-y-3">
          <SectionHeader title={t('sales.dailyTrend')} sub={t('sales.days', { count: data.dailySales.length })} />
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
                <Area type="monotone" dataKey="revenue" name={t('common.revenue')} stroke="#10b981"
                  strokeWidth={2} fill="url(#salesGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Payment method donut */}
        <div className="card p-4 space-y-3">
          <SectionHeader title={t('sales.byPayment')} />
          {data.byMethod.length === 0 ? <EmptyChart message={t('sales.noPayments')} /> : (
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
                  <Tooltip formatter={(v: any) => [sarStr(Number(v)), '']} />
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
                      <span className="font-semibold text-gray-800 tabular-nums"><Rial amount={m.value} /></span>
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
            <SectionHeader title={t('sales.topProducts')} sub={t('sales.byRevenue')} />
          </div>
          {data.topProducts.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">{t('sales.noItems')}</div>
          ) : (
            <>
              <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                <div className="flex-1">{t('common.product')}</div><div className="w-14 text-end">{t('common.quantity')}</div><div className="w-24 text-end">{t('common.revenue')}</div>
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
                    <Rial amount={p.revenue} />
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
            <SectionHeader title={t('sales.categoryPerformance')} />
          </div>
          {data.catPerformance.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">{t('sales.noCategories')}</div>
          ) : (
            <>
              <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                <div className="flex-1">{t('common.category')}</div><div className="w-14 text-end">{t('common.items')}</div><div className="w-24 text-end">{t('common.revenue')}</div>
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
                    <Rial amount={c.revenue} />
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
