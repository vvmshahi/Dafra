import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  Search,
  Truck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/localization/useLocale'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { Badge } from '@/components/ui/Badge'
import {
  SupplierIntelligenceFiltersPanel,
  type SupplierFilterOption,
} from '@/components/suppliers/SupplierIntelligenceFilters'
import {
  intelligenceDateRange,
  loadSupplierReport,
  type IntelligenceDatePreset,
  type SortDirection,
  type SupplierActivityFilter,
  type SupplierIntelligenceFilters,
  type SupplierReportResponse,
  type SupplierSortKey,
} from '@/lib/suppliers/supplierIntelligence'
import type { Branch } from '@/types'

const PAGE_SIZE = 25

function formatDate(value: string | null, locale: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(
    locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA',
    { dateStyle: 'medium' },
  )
}

export default function SupplierIntelligenceReportsPage() {
  const { t, i18n } = useTranslation(['supplierIntelligence', 'common'])
  const { profile } = useAuth()
  const { isRtl } = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const locale = i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA' : 'en'
  const defaultRange = intelligenceDateRange('last30')
  const initialStart = searchParams.get('start') || defaultRange.startDate
  const initialEnd = searchParams.get('end') || defaultRange.endDate
  const paymentParam = searchParams.get('payment')

  const [preset, setPreset] = useState<IntelligenceDatePreset>(
    searchParams.has('start') ? 'custom' : 'last30',
  )
  const [filters, setFilters] = useState<SupplierIntelligenceFilters>({
    startDate: initialStart,
    endDate: initialEnd,
    branchId: searchParams.get('branch') || (profile?.role === 'branch' ? profile.branch_id : null),
    productId: searchParams.get('product'),
    productUnitId: searchParams.get('unit'),
    paymentStatus: paymentParam === 'paid' || paymentParam === 'partial' || paymentParam === 'unpaid'
      ? paymentParam
      : 'all',
  })
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<SupplierFilterOption[]>([])
  const [units, setUnits] = useState<SupplierFilterOption[]>([])
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '')
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [activity, setActivity] = useState<SupplierActivityFilter>(
    (searchParams.get('activity') as SupplierActivityFilter) || 'all',
  )
  const [minimumGross, setMinimumGross] = useState(searchParams.get('minGross') ?? '')
  const [sort, setSort] = useState<SupplierSortKey>(
    (searchParams.get('sort') as SupplierSortKey) || 'gross_purchases',
  )
  const [direction, setDirection] = useState<SortDirection>(
    (searchParams.get('direction') as SortDirection) || 'desc',
  )
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1))
  const [data, setData] = useState<SupplierReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const canChooseBranch = profile?.role !== 'branch'

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!profile?.tenant_id) return
    let stale = false
    void supabase
      .from('branches')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('name')
      .then(({ data: rows }) => {
        if (!stale) setBranches((rows ?? []) as unknown as Branch[])
      })
    return () => { stale = true }
  }, [profile?.tenant_id])

  useEffect(() => {
    if (!profile?.tenant_id) return
    let stale = false
    let query = supabase
      .from('products')
      .select('id, name, name_ar')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('name')
      .limit(500)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    void query.then(({ data: rows }) => {
      if (!stale) {
        setProducts((rows ?? []).map(row => ({
          id: String(row.id),
          name: String(row.name),
          nameAr: row.name_ar ? String(row.name_ar) : null,
        })))
      }
    })
    return () => { stale = true }
  }, [filters.branchId, profile?.tenant_id])

  useEffect(() => {
    if (!filters.productId) {
      setUnits([])
      return
    }
    let stale = false
    void supabase
      .from('product_units')
      .select('id, name, name_ar')
      .eq('product_id', filters.productId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(100)
      .then(({ data: rows }) => {
        if (!stale) {
          setUnits((rows ?? []).map(row => ({
            id: String(row.id),
            name: String(row.name),
            nameAr: row.name_ar ? String(row.name_ar) : null,
          })))
        }
      })
    return () => { stale = true }
  }, [filters.productId])

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    void loadSupplierReport({
      filters,
      search,
      activity,
      minimumGross: minimumGross.trim() ? Number(minimumGross) : null,
      sort,
      direction,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(result => {
        if (!stale) setData(result)
      })
      .catch(loadError => {
        console.error('Unable to load supplier intelligence report', loadError)
        if (!stale) {
          setData(null)
          setError(t('supplierIntelligence:errors.report'))
        }
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => { stale = true }
  }, [activity, direction, filters, minimumGross, page, refreshKey, search, sort, t])

  useEffect(() => {
    const next = new URLSearchParams({
      start: filters.startDate,
      end: filters.endDate,
      activity,
      sort,
      direction,
      page: String(page),
    })
    if (filters.branchId) next.set('branch', filters.branchId)
    if (filters.productId) next.set('product', filters.productId)
    if (filters.productUnitId) next.set('unit', filters.productUnitId)
    if (filters.paymentStatus !== 'all') next.set('payment', filters.paymentStatus)
    if (search) next.set('search', search)
    if (minimumGross) next.set('minGross', minimumGross)
    setSearchParams(next, { replace: true })
  }, [activity, direction, filters, minimumGross, page, search, setSearchParams, sort])

  const handlePreset = (nextPreset: IntelligenceDatePreset) => {
    setPreset(nextPreset)
    setPage(1)
    if (nextPreset !== 'custom') {
      setFilters(current => ({ ...current, ...intelligenceDateRange(nextPreset) }))
    }
  }

  const updateFilters = (next: SupplierIntelligenceFilters) => {
    setPreset('custom')
    setPage(1)
    setFilters(next)
  }

  const sortOptions: { value: SupplierSortKey; label: string }[] = [
    { value: 'supplier_name', label: t('supplierIntelligence:reports.sortSupplier') },
    { value: 'gross_purchases', label: t('supplierIntelligence:reports.sortGross') },
    { value: 'purchase_count', label: t('supplierIntelligence:reports.sortPurchases') },
    { value: 'average_purchase', label: t('supplierIntelligence:reports.sortAverage') },
    { value: 'last_purchase', label: t('supplierIntelligence:reports.sortLastPurchase') },
    { value: 'days_since_last_purchase', label: t('supplierIntelligence:reports.sortDaysSince') },
  ]

  const detailQuery = useMemo(() => {
    const params = new URLSearchParams({
      start: filters.startDate,
      end: filters.endDate,
    })
    if (filters.branchId) params.set('branch', filters.branchId)
    if (filters.productId) params.set('product', filters.productId)
    if (filters.productUnitId) params.set('unit', filters.productUnitId)
    if (filters.paymentStatus !== 'all') params.set('payment', filters.paymentStatus)
    return params.toString()
  }, [filters])

  const activeSortLabel = sortOptions.find(option => option.value === sort)?.label ?? sort
  const directionLabel = t(`supplierIntelligence:reports.${direction === 'asc' ? 'ascending' : 'descending'}`)

  return (
    <div className="space-y-5 max-w-[1600px]">
      <header className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <BarChart3 size={19} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t('supplierIntelligence:reports.title')}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{t('supplierIntelligence:reports.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3 text-sm font-semibold">
          <Link to="/suppliers" className="text-primary-600 hover:text-primary-700">
            {t('supplierIntelligence:actions.backToSuppliers')}
          </Link>
          <Link to="/reports" className="text-gray-500 hover:text-gray-800">
            {t('supplierIntelligence:reports.backToReports')}
          </Link>
        </div>
      </header>

      <SupplierIntelligenceFiltersPanel
        filters={filters}
        preset={preset}
        branches={branches.map(branch => ({
          id: branch.id,
          name: branch.name,
          nameAr: branch.name_ar,
        }))}
        products={products}
        units={units}
        canChooseBranch={canChooseBranch}
        isArabic={isRtl}
        onPreset={handlePreset}
        onChange={updateFilters}
      />

      <section className="card p-4 space-y-3" aria-label={t('supplierIntelligence:reports.title')}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_13rem_13rem_14rem_auto] gap-3 items-end">
          <label>
            <span className="label">{t('supplierIntelligence:reports.search')}</span>
            <span className="relative block">
              <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                className="input ps-9"
                value={searchInput}
                placeholder={t('supplierIntelligence:reports.searchPlaceholder')}
                onChange={event => setSearchInput(event.target.value)}
              />
            </span>
          </label>
          <label>
            <span className="label">{t('supplierIntelligence:reports.activity')}</span>
            <select
              className="input"
              value={activity}
              onChange={event => {
                setActivity(event.target.value as SupplierActivityFilter)
                setPage(1)
              }}
            >
              <option value="all">{t('supplierIntelligence:reports.allActivity')}</option>
              <option value="active">{t('supplierIntelligence:reports.active')}</option>
              <option value="no_activity">{t('supplierIntelligence:reports.noActivity')}</option>
            </select>
          </label>
          <label>
            <span className="label">{t('supplierIntelligence:reports.minimumGross')}</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={minimumGross}
              onChange={event => {
                setMinimumGross(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <label>
            <span className="label">{t('supplierIntelligence:reports.sort')}</span>
            <select
              className="input"
              value={sort}
              onChange={event => {
                setSort(event.target.value as SupplierSortKey)
                setPage(1)
              }}
            >
              {sortOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            aria-label={directionLabel}
            aria-pressed={direction === 'asc'}
            onClick={() => {
              setDirection(current => current === 'asc' ? 'desc' : 'asc')
              setPage(1)
            }}
          >
            {direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            {directionLabel}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">
          {t('supplierIntelligence:reports.sortAnnouncement', {
            sort: activeSortLabel,
            direction: directionLabel,
          })}
        </p>
      </section>

      {data && !loading && (
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label={t('supplierIntelligence:reports.title')}>
          <article className="card p-3.5">
            <p className="text-xs font-semibold text-gray-500">{t('supplierIntelligence:metrics.activeSuppliers')}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{data.totals.activeSupplierCount}</p>
          </article>
          <article className="card p-3.5 lg:col-span-2 border-emerald-100">
            <p className="text-xs font-semibold text-emerald-700">{t('supplierIntelligence:metrics.grossPurchases')}</p>
            <p className="text-xl font-bold text-emerald-800 mt-1"><Rial amount={data.totals.grossPurchases} /></p>
          </article>
          <article className="card p-3.5">
            <p className="text-xs font-semibold text-gray-500">{t('supplierIntelligence:metrics.purchaseCount')}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{data.totals.purchaseCount}</p>
          </article>
          <article className="card p-3.5">
            <p className="text-xs font-semibold text-gray-500">{t('supplierIntelligence:metrics.averageActiveSupplier')}</p>
            <p className="text-xl font-bold text-gray-900 mt-1"><Rial amount={data.totals.averagePerActiveSupplier} /></p>
          </article>
        </section>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="card min-h-72 flex items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : error ? (
          <div className="card p-8 text-center" role="alert">
            <p className="text-sm text-red-600">{error}</p>
            <Button className="mt-4" onClick={() => setRefreshKey(key => key + 1)}>
              {t('supplierIntelligence:actions.retry')}
            </Button>
          </div>
        ) : !data?.rows.length ? (
          <div className="card py-16 text-center">
            <Truck size={26} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm font-semibold text-gray-700">{t('supplierIntelligence:empty.noSuppliers')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('supplierIntelligence:empty.adjustFilters')}</p>
          </div>
        ) : (
          <section className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-700">
                {t('supplierIntelligence:reports.suppliersFound', { count: data.totalCount })}
              </p>
              <p className="text-xs text-gray-400 tabular-nums">
                {data.page} / {Math.max(data.totalPages, 1)}
              </p>
            </div>

            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full min-w-[1160px] text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start">{t('supplierIntelligence:reports.supplier')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:reports.gross')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:reports.purchases')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:reports.average')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:reports.lastPurchase')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:reports.daysSince')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:reports.frequency')}</th>
                    <th scope="col" className="px-4 py-2.5 text-start">{t('supplierIntelligence:reports.topProduct')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map(row => {
                    const name = isRtl ? row.nameAr || row.name : row.name || row.nameAr
                    const branchName = isRtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr
                    const productName = isRtl
                      ? row.topProductNameAr || row.topProductName
                      : row.topProductName || row.topProductNameAr
                    const unitName = isRtl
                      ? row.topUnitNameAr || row.topUnitName
                      : row.topUnitName || row.topUnitNameAr
                    return (
                      <tr key={row.supplierId} className="hover:bg-amber-50/30">
                        <td className="px-4 py-3">
                          <Link
                            to={`/suppliers/${row.supplierId}?${detailQuery}`}
                            className="group flex items-center gap-2.5 min-w-0"
                          >
                            <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
                              <Building2 size={14} />
                            </span>
                            <span className="min-w-0">
                              <span className="block font-semibold text-gray-900 group-hover:text-primary-700 break-words" dir="auto">{name}</span>
                              <span className="block text-[11px] text-gray-400" dir="auto">{branchName}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-end font-bold text-gray-900"><Rial amount={row.grossPurchases} /></td>
                        <td className="px-3 py-3 text-end tabular-nums">{row.purchaseCount}</td>
                        <td className="px-3 py-3 text-end"><Rial amount={row.averagePurchaseValue} /></td>
                        <td className="px-3 py-3 text-end text-gray-600">{formatDate(row.lastPurchase, locale)}</td>
                        <td className="px-3 py-3 text-end tabular-nums">{row.daysSinceLastPurchase ?? '—'}</td>
                        <td className="px-3 py-3 text-end text-gray-600">
                          {row.averageDaysBetweenPurchases == null
                            ? t('supplierIntelligence:reports.noFrequency')
                            : t('supplierIntelligence:metrics.averageDays', { days: row.averageDaysBetweenPurchases })}
                        </td>
                        <td className="px-4 py-3">
                          {productName ? (
                            <div>
                              <p className="font-medium text-gray-800 break-words" dir="auto">{productName}</p>
                              <p className="text-[11px] text-gray-400" dir="auto">
                                {unitName} · {t('supplierIntelligence:reports.products', { count: row.productCount })}
                              </p>
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-gray-100">
              {data.rows.map(row => {
                const name = isRtl ? row.nameAr || row.name : row.name || row.nameAr
                const branchName = isRtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr
                return (
                  <Link
                    key={row.supplierId}
                    to={`/suppliers/${row.supplierId}?${detailQuery}`}
                    className="block p-4 active:bg-amber-50"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
                        <Building2 size={15} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="font-semibold text-gray-900 break-words" dir="auto">{name}</span>
                        <span className="block text-xs text-gray-400 mt-0.5" dir="auto">{branchName}</span>
                      </span>
                      <Badge variant={row.purchaseCount ? 'success' : 'neutral'}>
                        {row.purchaseCount}
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <dt className="text-[10px] uppercase text-gray-400">{t('supplierIntelligence:reports.gross')}</dt>
                        <dd className="text-sm font-bold text-gray-900 mt-0.5"><Rial amount={row.grossPurchases} /></dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase text-gray-400">{t('supplierIntelligence:reports.lastPurchase')}</dt>
                        <dd className="text-sm text-gray-700 mt-0.5">{formatDate(row.lastPurchase, locale)}</dd>
                      </div>
                    </dl>
                  </Link>
                )
              })}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => setPage(current => Math.max(1, current - 1))}
              >
                <ChevronLeft size={14} className={isRtl ? 'rotate-180' : ''} />
                {t('supplierIntelligence:reports.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => setPage(current => current + 1)}
              >
                {t('supplierIntelligence:reports.next')}
                <ChevronRight size={14} className={isRtl ? 'rotate-180' : ''} />
              </Button>
            </div>
          </section>
        )}
      </div>

      <p className="text-xs text-gray-400 leading-relaxed">
        {t('supplierIntelligence:notPayables')} {t('supplierIntelligence:returnsDeferred')}
      </p>
    </div>
  )
}
