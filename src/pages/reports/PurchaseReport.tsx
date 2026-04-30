import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt, fmtDate, fmtMonth, generateMonths,
  StatCard, SkeletonCard, SkeletonChart, SkeletonTable,
  EmptyChart, SectionHeader, ChartTooltip,
} from './reportUtils'

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<PurchData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) return
      setLoading(true)
      try {
        // Purchases in range
        const { data: purData } = await (branchId
          ? supabase.from('purchases').eq('branch_id', branchId)
          : supabase.from('purchases').eq('tenant_id', tid))
          .select('id, purchase_date, total_amount, vat_amount, supplier_id, suppliers(name)')
          .gte('purchase_date', startDate)
          .lte('purchase_date', endDate)
          .order('purchase_date', { ascending: false })

        const purchases = (purData ?? []) as any[]
        const ids       = purchases.map(p => p.id)

        // Purchase items for top items
        let items: any[] = []
        if (ids.length > 0) {
          const { data: itemData } = await supabase
            .from('purchase_items')
            .select('name, quantity, total')
            .in('purchase_id', ids)
          items = (itemData ?? []) as any[]
        }

        if (cancelled) return

        const totalPurchased = purchases.reduce((s: number, p: any) => s + Number(p.total_amount), 0)
        const totalVat       = purchases.reduce((s: number, p: any) => s + Number(p.vat_amount),   0)

        // By supplier
        const supMap = new Map<string, { name: string; total: number; count: number; lastDate: string }>()
        for (const p of purchases) {
          const sid  = p.supplier_id ?? '__none__'
          const name = (p.suppliers as any)?.name ?? 'No Supplier'
          const curr = supMap.get(sid) ?? { name, total: 0, count: 0, lastDate: '' }
          curr.total += Number(p.total_amount)
          curr.count += 1
          if (!curr.lastDate || p.purchase_date > curr.lastDate) curr.lastDate = p.purchase_date
          supMap.set(sid, curr)
        }
        const bySupplier: BySupplier[] = Array.from(supMap.values())
          .sort((a, b) => b.total - a.total)

        // Top items
        const itemMap = new Map<string, { quantity: number; total: number }>()
        for (const it of items) {
          const curr = itemMap.get(it.name) ?? { quantity: 0, total: 0 }
          curr.quantity += Number(it.quantity)
          curr.total    += Number(it.total)
          itemMap.set(it.name, curr)
        }
        const topItems: TopItem[] = Array.from(itemMap.entries())
          .map(([name, s]) => ({ name, ...s }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 10)

        // Monthly bars
        const months = generateMonths(startDate, endDate)
        const monthlyBars: MonthBar[] = months.map(m => ({
          month:     fmtMonth(m),
          Purchases: purchases
            .filter((p: any) => (p.purchase_date as string).startsWith(m))
            .reduce((s: number, p: any) => s + Number(p.total_amount), 0),
        }))

        setData({
          totalPurchased,
          totalVat,
          supplierCount: new Set(purchases.map(p => p.supplier_id).filter(Boolean)).size,
          bySupplier,
          topItems,
          monthlyBars,
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
        <div className="flex flex-wrap gap-3">{[0,1,2].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonChart />
        <SkeletonTable />
      </div>
    )
  }

  const noData = !data || (data.totalPurchased === 0 && data.topItems.length === 0)

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
        <StatCard label="Total Purchased"  value={`SAR ${fmt(data!.totalPurchased)}`}  primary />
        <StatCard label="VAT Paid"         value={`SAR ${fmt(data!.totalVat)}`}         accent="amber" sub="input VAT" />
        <StatCard label="Suppliers Used"   value={String(data!.supplierCount)}          sub="unique vendors" />
      </div>

      {/* ── Monthly trend chart ─────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <SectionHeader title="Monthly Purchase Trend" />
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
                    SAR {fmt(s.total)}
                  </div>
                </div>
              ))}
              <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
                <div className="flex-1 text-xs font-semibold text-gray-500">
                  {data!.bySupplier.length} suppliers
                </div>
                <div className="w-24 text-right text-sm font-bold text-amber-600 tabular-nums">
                  SAR {fmt(data!.totalPurchased)}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Top purchased items */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <SectionHeader title="Top Purchased Items" sub="by total cost" />
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
                    SAR {fmt(it.total)}
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
