import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmtDate, fmtMonth,
  StatCard, SkeletonCard, SkeletonChart, SkeletonTable,
  EmptyChart, ReportErrorState, SectionHeader, ChartTooltip,
} from './reportUtils'
import { Rial } from '@/components/ui/RiyalSymbol'
import { asArray, loadReportSummary, reportErrorMessage, reportParams } from './reportingRpc'
import { resolveBusinessType } from '@/lib/utils/businessType'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BySupplier  { name: string; total: number; count: number; lastDate: string | null }
interface TopItem     { name: string; quantity: number; total: number }
interface MonthBar    { month: string; Purchases: number }

interface PurchData {
  totalPurchased: number
  totalVat:       number
  supplierCount:  number
  bySupplier:     BySupplier[]
  topItems:       TopItem[]
  monthlyBars:    MonthBar[]
}

const EMPTY_PURCHASE_DATA: PurchData = {
  totalPurchased: 0,
  totalVat: 0,
  supplierCount: 0,
  bySupplier: [],
  topItems: [],
  monthlyBars: [],
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile, tenant } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<PurchData | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const summary = await loadReportSummary<PurchData>(
          'get_purchase_report_summary',
          reportParams(startDate, endDate, branchId),
          EMPTY_PURCHASE_DATA,
        )
        if (cancelled) return
        setData({
          ...summary,
          bySupplier: asArray<BySupplier>(summary.bySupplier),
          topItems: asArray<TopItem>(summary.topItems),
          monthlyBars: asArray<MonthBar>(summary.monthlyBars).map(row => ({
            ...row,
            month: fmtMonth(row.month),
          })),
        })
      } catch (error) {
        console.error('Unable to load purchase report summary', error)
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
        <SkeletonTable />
      </div>
    )
  }

  if (error) return <ReportErrorState message={error} />

  const noData = !data || (data.totalPurchased === 0 && data.topItems.length === 0)
  const businessType = resolveBusinessType(tenant?.business_type)
  const isService = businessType === 'service'
  const purchasesLabel = isService ? 'Materials / Purchases' : 'Counted Purchases'
  const trendTitle = isService ? 'Monthly Materials / Purchase Trend' : 'Monthly Purchase Trend'
  const topItemsTitle = isService ? 'Top Purchased Materials / Items' : 'Top Purchased Items'
  const topItemsSub = isService ? 'materials and business purchases' : 'by total cost'

  if (noData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-700 font-semibold">No purchase data for this period</p>
        <p className="text-gray-400 text-sm mt-1">Try a different date range</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard label={purchasesLabel} value={<Rial amount={data!.totalPurchased} />} primary />
        <StatCard label="Input VAT Support" value={<Rial amount={data!.totalVat} />}      accent="amber" sub="counted purchases only" />
        <StatCard label="Suppliers Used"   value={String(data!.supplierCount)}           sub="unique vendors" />
      </div>

      {/* ── Monthly trend chart ─────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <SectionHeader title={trendTitle} />
        {!data!.monthlyBars.length ? <EmptyChart /> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data!.monthlyBars} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={60}
                tickFormatter={v => `${(Number(v)/1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="Purchases" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Tables row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* By supplier */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <SectionHeader title="Purchases by Supplier" />
          </div>
          {!data!.bySupplier.length ? (
            <div className="py-10 text-center text-sm text-gray-400">No purchases</div>
          ) : (
            <>
              <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                <div className="flex-1">Supplier</div>
                <div className="w-14 text-right hidden sm:block">Orders</div>
                <div className="w-24 text-right">Total</div>
              </div>
              {data!.bySupplier.map((s, i) => (
                <div key={i} className="flex gap-2 px-4 py-3 border-t border-gray-50 hover:bg-gray-50/50 items-center">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                    {s.lastDate && (
                      <p className="text-[10px] text-gray-400">Last: {fmtDate(s.lastDate)}</p>
                    )}
                  </div>
                  <div className="w-14 text-right text-sm text-gray-600 tabular-nums hidden sm:block">
                    {s.count}
                  </div>
                  <div className="w-24 text-right text-sm font-bold text-amber-600 tabular-nums">
                    <Rial amount={s.total} />
                  </div>
                </div>
              ))}
              <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
                <div className="flex-1 text-xs font-semibold text-gray-500">
                  {data!.bySupplier.length} suppliers
                </div>
                <div className="w-24 text-right text-sm font-bold text-amber-600 tabular-nums">
                  <Rial amount={data!.totalPurchased} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Top purchased items */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <SectionHeader title={topItemsTitle} sub={topItemsSub} />
          </div>
          {!data!.topItems.length ? (
            <div className="py-10 text-center text-sm text-gray-400">No items recorded</div>
          ) : (
            <>
              <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                <div className="w-5">#</div>
                <div className="flex-1">Item</div>
                <div className="w-16 text-right">Qty</div>
                <div className="w-24 text-right">Total</div>
              </div>
              {data!.topItems.map((it, i) => (
                <div key={i} className="flex gap-2 px-4 py-3 border-t border-gray-50 hover:bg-gray-50/50 items-center">
                  <div className="w-5 text-[10px] font-bold text-gray-300">{i + 1}</div>
                  <div className="flex-1 min-w-0 text-sm text-gray-800 truncate">{it.name}</div>
                  <div className="w-16 text-right text-sm text-gray-600 tabular-nums">
                    {it.quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                  </div>
                  <div className="w-24 text-right text-sm font-bold text-amber-600 tabular-nums">
                    <Rial amount={it.total} />
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
