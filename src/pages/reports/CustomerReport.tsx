import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt, fmtDate,
  StatCard, SkeletonCard, SkeletonTable, SectionHeader,
} from './reportUtils'
import { Rial } from '@/components/ui/RiyalSymbol'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TopCustomer {
  id:           string
  name:         string
  type:         string
  totalSpent:   number
  orderCount:   number
  lastPurchase: string | null
}

interface CustData {
  totalCount:     number
  newThisPeriod:  number
  individualCount: number
  businessCount:  number
  totalRevenue:   number
  topCustomers:   TopCustomer[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<CustData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      try {
        // Customers are tenant-scoped, not branch-scoped
        const [{ data: custData }, { data: invData }] = await Promise.all([
          supabase
            .from('customers')
            .select('id, name, customer_type, created_at')
            .eq('tenant_id', tid)
            .eq('is_active', true),
          (branchId
            ? supabase.from('invoices').eq('branch_id', branchId)
            : supabase.from('invoices').eq('tenant_id', tid))
            .select('customer_id, total_amount, invoice_date')
            .neq('status', 'cancelled')
            .gte('invoice_date', startDate)
            .lte('invoice_date', endDate),
        ])

        if (cancelled) return

        const customers = (custData ?? []) as any[]
        const invoices  = (invData  ?? []) as any[]

        const totalCount      = customers.length
        const newThisPeriod   = customers.filter((c: any) => {
          const created = (c.created_at as string).slice(0, 10)
          return created >= startDate && created <= endDate
        }).length
        const individualCount = customers.filter((c: any) => c.customer_type === 'individual').length
        const businessCount   = customers.filter((c: any) => c.customer_type === 'business').length
        const totalRevenue    = invoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0)

        // Top customers by spend
        const aggMap = new Map<string, { total: number; count: number; lastDate: string }>()
        for (const inv of invoices) {
          if (!inv.customer_id) continue
          const curr = aggMap.get(inv.customer_id) ?? { total: 0, count: 0, lastDate: '' }
          curr.total += Number(inv.total_amount)
          curr.count += 1
          if (!curr.lastDate || inv.invoice_date > curr.lastDate) curr.lastDate = inv.invoice_date
          aggMap.set(inv.customer_id, curr)
        }

        const custMap = new Map(customers.map((c: any) => [c.id, c]))
        const topCustomers: TopCustomer[] = Array.from(aggMap.entries())
          .map(([id, stats]) => {
            const cust = custMap.get(id)
            return {
              id,
              name:         cust?.name ?? 'Unknown',
              type:         cust?.customer_type ?? 'individual',
              totalSpent:   stats.total,
              orderCount:   stats.count,
              lastPurchase: stats.lastDate || null,
            }
          })
          .sort((a, b) => b.totalSpent - a.totalSpent)
          .slice(0, 15)

        setData({ totalCount, newThisPeriod, individualCount, businessCount, totalRevenue, topCustomers })
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
        <div className="flex flex-wrap gap-3">{[0,1,2,3].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonTable />
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard label="Total Customers"   value={String(data?.totalCount ?? 0)}          primary />
        <StatCard label="New This Period"   value={String(data?.newThisPeriod ?? 0)}       accent="emerald" sub="joined during range" />
        <StatCard label="Total Revenue"     value={<Rial amount={data?.totalRevenue ?? 0} />}  accent="emerald" sub="from invoices" />
        <StatCard label="Avg per Customer"  value={data?.topCustomers.length
          ? <Rial amount={data.totalRevenue / Math.max(data.topCustomers.length, 1)} />
          : <Rial amount={0} />}
        />
      </div>

      {/* ── Type breakdown ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-xl flex-shrink-0">👤</div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Individual</p>
            <p className="text-2xl font-bold text-gray-900">{data?.individualCount ?? 0}</p>
            <p className="text-xs text-gray-400">
              {data?.totalCount ? ((data.individualCount / data.totalCount) * 100).toFixed(0) : 0}% of total
            </p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-xl flex-shrink-0">🏢</div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Business</p>
            <p className="text-2xl font-bold text-gray-900">{data?.businessCount ?? 0}</p>
            <p className="text-xs text-gray-400">
              {data?.totalCount ? ((data.businessCount / data.totalCount) * 100).toFixed(0) : 0}% of total
            </p>
          </div>
        </div>
      </div>

      {/* ── Top customers table ─────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <SectionHeader
            title="Top Customers by Spend"
            sub={`${data?.topCustomers.length ?? 0} customers with purchases this period`}
          />
        </div>
        {!data?.topCustomers.length ? (
          <div className="py-12 text-center text-sm text-gray-400">No customer purchases in this period</div>
        ) : (
          <>
            <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              <div className="w-6">#</div>
              <div className="flex-1">Customer</div>
              <div className="w-16 text-center hidden sm:block">Type</div>
              <div className="w-16 text-right hidden md:block">Orders</div>
              <div className="w-28 hidden lg:block text-right">Last Purchase</div>
              <div className="w-28 text-right">Total Spent</div>
            </div>
            {data.topCustomers.map((c, i) => (
              <div key={c.id}
                className="flex gap-2 px-4 py-3 border-t border-gray-50 hover:bg-gray-50/50 items-center">
                <div className="w-6 text-[10px] font-bold text-gray-300">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                </div>
                <div className="w-16 text-center hidden sm:block">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    c.type === 'business'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}>
                    {c.type === 'business' ? 'Biz' : 'Ind'}
                  </span>
                </div>
                <div className="w-16 text-right text-sm text-gray-600 tabular-nums hidden md:block">
                  {c.orderCount}
                </div>
                <div className="w-28 text-right text-xs text-gray-400 hidden lg:block">
                  {c.lastPurchase ? fmtDate(c.lastPurchase) : '—'}
                </div>
                <div className="w-28 text-right text-sm font-bold text-emerald-600 tabular-nums">
                  <Rial amount={c.totalSpent} />
                </div>
              </div>
            ))}
            <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
              <div className="flex-1 text-xs font-semibold text-gray-500">
                {data.topCustomers.length} customers shown
              </div>
              <div className="w-28 text-right text-sm font-bold text-emerald-600 tabular-nums">
                <Rial amount={data.totalRevenue} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
