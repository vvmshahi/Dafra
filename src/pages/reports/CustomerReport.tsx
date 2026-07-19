import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmtDate,
  StatCard, SkeletonCard, SkeletonTable, ReportErrorState, SectionHeader,
} from './reportUtils'
import { Rial } from '@/components/ui/RiyalSymbol'
import { asArray, loadReportSummary, reportErrorMessage, reportParams } from './reportingRpc'
import { useTranslation } from 'react-i18next'

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

const EMPTY_CUSTOMER_DATA: CustData = {
  totalCount: 0,
  newThisPeriod: 0,
  individualCount: 0,
  businessCount: 0,
  totalRevenue: 0,
  topCustomers: [],
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerReport({ startDate, endDate, branchId }: ReportProps) {
  const { t } = useTranslation('reports')
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<CustData | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const summary = await loadReportSummary<CustData>(
          'get_customer_report_summary',
          reportParams(startDate, endDate, branchId),
          EMPTY_CUSTOMER_DATA,
        )
        if (cancelled) return
        setData({
          ...summary,
          topCustomers: asArray<TopCustomer>(summary.topCustomers),
        })
      } catch (error) {
        console.error('Unable to load customer report summary', error)
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
        <div className="flex flex-wrap gap-3">{[0,1,2,3].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonTable />
      </div>
    )
  }

  if (error) return <ReportErrorState message={error} />

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard label={t('metrics.totalCustomers')} value={String(data?.totalCount ?? 0)} primary />
        <StatCard label={t('metrics.newCustomers')} value={String(data?.newThisPeriod ?? 0)} accent="emerald" sub={t('customers.joined')} />
        <StatCard label={t('metrics.customerRevenue')} value={<Rial amount={data?.totalRevenue ?? 0} />} accent="emerald" sub={t('customers.creditDeducted')} />
        <StatCard label={t('metrics.avgCustomer')} value={data?.topCustomers.length
          ? <Rial amount={data.totalRevenue / Math.max(data.topCustomers.length, 1)} />
          : <Rial amount={0} />}
        />
      </div>

      {/* ── Type breakdown ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-xl flex-shrink-0">👤</div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('customers.individual')}</p>
            <p className="text-2xl font-bold text-gray-900">{data?.individualCount ?? 0}</p>
            <p className="text-xs text-gray-400">
              {data?.totalCount ? ((data.individualCount / data.totalCount) * 100).toFixed(0) : 0}% of total
            </p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center text-xl flex-shrink-0">🏢</div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('customers.business')}</p>
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
            title={t('customers.top')}
            sub={`${data?.topCustomers.length ?? 0} customers with purchases this period`}
          />
        </div>
        {!data?.topCustomers.length ? (
          <div className="py-12 text-center text-sm text-gray-400">{t('customers.empty')}</div>
        ) : (
          <>
            <div className="flex gap-2 px-4 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              <div className="w-6">#</div>
              <div className="flex-1">{t('common.customer')}</div><div className="w-16 text-center hidden sm:block">{t('common.status')}</div><div className="w-16 text-end hidden md:block">{t('common.orders')}</div><div className="w-28 hidden lg:block text-end">{t('customers.lastPurchase')}</div><div className="w-28 text-end">{t('customers.totalSpent')}</div>
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
