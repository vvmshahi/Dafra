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
  Users,
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
  CustomerIntelligenceFiltersPanel,
  type IntelligenceFilterOption,
} from '@/components/customers/CustomerIntelligenceFilters'
import {
  intelligenceDateRange,
  loadCustomerReport,
  type CustomerActivityFilter,
  type CustomerIntelligenceFilters,
  type CustomerReportResponse,
  type CustomerSortKey,
  type IntelligenceDatePreset,
  type SortDirection,
} from '@/lib/customers/customerIntelligence'
import type { Branch } from '@/types'

const PAGE_SIZE = 25

function formatDate(value: string | null, locale: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(
    locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA',
    { dateStyle: 'medium' },
  )
}

export default function CustomerIntelligenceReportsPage() {
  const { t, i18n } = useTranslation(['customerIntelligence', 'common'])
  const { profile } = useAuth()
  const { isRtl } = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const locale = i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA' : 'en'
  const defaultRange = intelligenceDateRange('last30')
  const initialStart = searchParams.get('start') || defaultRange.startDate
  const initialEnd = searchParams.get('end') || defaultRange.endDate

  const [preset, setPreset] = useState<IntelligenceDatePreset>(
    searchParams.has('start') ? 'custom' : 'last30',
  )
  const [filters, setFilters] = useState<CustomerIntelligenceFilters>({
    startDate: initialStart,
    endDate: initialEnd,
    branchId: searchParams.get('branch') || (profile?.role === 'branch' ? profile.branch_id : null),
    productId: searchParams.get('product'),
    productUnitId: searchParams.get('unit'),
  })
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<IntelligenceFilterOption[]>([])
  const [units, setUnits] = useState<IntelligenceFilterOption[]>([])
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '')
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [activity, setActivity] = useState<CustomerActivityFilter>(
    (searchParams.get('activity') as CustomerActivityFilter) || 'all',
  )
  const [minimumNet, setMinimumNet] = useState(searchParams.get('minNet') ?? '')
  const [sort, setSort] = useState<CustomerSortKey>(
    (searchParams.get('sort') as CustomerSortKey) || 'net_purchases',
  )
  const [direction, setDirection] = useState<SortDirection>(
    (searchParams.get('direction') as SortDirection) || 'desc',
  )
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1))
  const [data, setData] = useState<CustomerReportResponse | null>(null)
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
    void loadCustomerReport({
      filters,
      search,
      activity,
      minNet: minimumNet.trim() ? Number(minimumNet) : null,
      sort,
      direction,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(result => {
        if (!stale) setData(result)
      })
      .catch(loadError => {
        console.error('Unable to load customer intelligence report', loadError)
        if (!stale) {
          setData(null)
          setError(t('customerIntelligence:errors.report'))
        }
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => { stale = true }
  }, [activity, direction, filters, minimumNet, page, refreshKey, search, sort, t])

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
    if (search) next.set('search', search)
    if (minimumNet) next.set('minNet', minimumNet)
    setSearchParams(next, { replace: true })
  }, [activity, direction, filters, minimumNet, page, search, setSearchParams, sort])

  const handlePreset = (nextPreset: IntelligenceDatePreset) => {
    setPreset(nextPreset)
    setPage(1)
    if (nextPreset !== 'custom') {
      const range = intelligenceDateRange(nextPreset)
      setFilters(current => ({ ...current, ...range }))
    }
  }

  const updateFilters = (next: CustomerIntelligenceFilters) => {
    setPreset('custom')
    setPage(1)
    setFilters(next)
  }

  const sortOptions: { value: CustomerSortKey; label: string }[] = [
    { value: 'customer_name', label: t('customerIntelligence:reports.sortCustomer') },
    { value: 'gross_purchases', label: t('customerIntelligence:reports.sortGross') },
    { value: 'net_purchases', label: t('customerIntelligence:reports.sortNet') },
    { value: 'invoice_count', label: t('customerIntelligence:reports.sortInvoices') },
    { value: 'last_purchase', label: t('customerIntelligence:reports.sortLastPurchase') },
    { value: 'average_invoice', label: t('customerIntelligence:reports.sortAverage') },
  ]

  const customerQuery = useMemo(() => {
    const params = new URLSearchParams({
      start: filters.startDate,
      end: filters.endDate,
    })
    if (filters.branchId) params.set('branch', filters.branchId)
    if (filters.productId) params.set('product', filters.productId)
    if (filters.productUnitId) params.set('unit', filters.productUnitId)
    return params.toString()
  }, [filters])

  return (
    <div className="space-y-5 max-w-[1600px]">
      <header className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <BarChart3 size={19} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{t('customerIntelligence:reports.title')}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{t('customerIntelligence:reports.subtitle')}</p>
            </div>
          </div>
        </div>
        <Link to="/reports" className="text-sm font-semibold text-primary-600 hover:text-primary-700">
          {t('common:back')}
        </Link>
      </header>

      <CustomerIntelligenceFiltersPanel
        filters={filters}
        preset={preset}
        branches={branches.map(branch => ({ id: branch.id, name: branch.name, nameAr: branch.name_ar }))}
        products={products}
        units={units}
        canChooseBranch={canChooseBranch}
        isArabic={isRtl}
        onPreset={handlePreset}
        onChange={updateFilters}
      />

      <section className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <label className="space-y-1 lg:col-span-2">
            <span className="label">{t('customerIntelligence:filters.search')}</span>
            <span className="relative block">
              <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input ps-9"
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                placeholder={t('customerIntelligence:filters.searchPlaceholder')}
              />
            </span>
          </label>
          <label className="space-y-1">
            <span className="label">{t('customerIntelligence:filters.activity')}</span>
            <select
              className="input"
              value={activity}
              onChange={event => {
                setActivity(event.target.value as CustomerActivityFilter)
                setPage(1)
              }}
            >
              <option value="all">{t('customerIntelligence:filters.allCustomers')}</option>
              <option value="active">{t('customerIntelligence:filters.activeInPeriod')}</option>
              <option value="no_activity">{t('customerIntelligence:filters.noActivityInPeriod')}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="label">{t('customerIntelligence:filters.minimumNet')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input tabular-nums"
              value={minimumNet}
              onChange={event => {
                setMinimumNet(event.target.value)
                setPage(1)
              }}
              dir="ltr"
            />
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="space-y-1">
              <span className="label">{t('customerIntelligence:reports.sort')}</span>
              <select
                className="input"
                value={sort}
                onChange={event => {
                  setSort(event.target.value as CustomerSortKey)
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
              size="icon"
              className="self-end mb-0.5"
              aria-label={t(`customerIntelligence:reports.${direction === 'asc' ? 'ascending' : 'descending'}`)}
              title={t(`customerIntelligence:reports.${direction === 'asc' ? 'ascending' : 'descending'}`)}
              onClick={() => {
                setDirection(current => current === 'asc' ? 'desc' : 'asc')
                setPage(1)
              }}
            >
              {direction === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="report-totals">
        <h2 id="report-totals" className="sr-only">{t('customerIntelligence:commercialActivity')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            {
              label: t('customerIntelligence:metrics.activeCustomers'),
              value: (data?.totals.activeCustomerCount ?? 0).toLocaleString('en-US'),
              className: 'text-gray-900',
            },
            {
              label: t('customerIntelligence:metrics.grossPurchases'),
              value: <Rial amount={data?.totals.grossPurchases ?? 0} />,
              className: 'text-gray-900',
            },
            {
              label: t('customerIntelligence:metrics.creditedAmount'),
              value: <Rial amount={data?.totals.creditedAmount ?? 0} />,
              className: 'text-amber-700',
            },
            {
              label: t('customerIntelligence:metrics.netPurchases'),
              value: <Rial amount={data?.totals.netPurchases ?? 0} />,
              className: 'text-emerald-700',
            },
            {
              label: t('customerIntelligence:metrics.invoiceCount'),
              value: (data?.totals.invoiceCount ?? 0).toLocaleString('en-US'),
              className: 'text-gray-900',
            },
            {
              label: t('customerIntelligence:metrics.averageActiveCustomer'),
              value: <Rial amount={data?.totals.averagePerActiveCustomer ?? 0} />,
              className: 'text-gray-900',
            },
          ].map(metric => (
            <article key={metric.label} className="card px-4 py-3">
              <p className="text-xs font-medium text-gray-400">{metric.label}</p>
              <p className={`text-lg font-bold mt-1 tabular-nums ${metric.className}`}>{metric.value}</p>
            </article>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">{t('customerIntelligence:notBalance')}</p>
        {(filters.productId || filters.productUnitId) && (
          <p className="text-[11px] text-gray-400 mt-1 max-w-3xl">
            {t('customerIntelligence:filters.productDocumentBasis')}
          </p>
        )}
      </section>

      <section className="card overflow-hidden" aria-labelledby="customer-report-results">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 id="customer-report-results" className="text-sm font-bold text-gray-900">
              {t('customerIntelligence:reports.title')}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('customerIntelligence:reports.filteredCustomers', { count: data?.totalCount ?? 0 })}
            </p>
          </div>
          {loading && <LoadingSpinner size="sm" />}
        </div>

        <div aria-live="polite" aria-busy={loading}>
          {error ? (
            <div className="py-16 text-center" role="alert">
              <p className="text-sm text-red-600">{error}</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setRefreshKey(key => key + 1)}>
                {t('common:retry')}
              </Button>
            </div>
          ) : loading && !data ? (
            <div className="py-16 flex justify-center"><LoadingSpinner /></div>
          ) : !data?.rows.length ? (
            <div className="py-16 text-center">
              <Users size={24} className="mx-auto text-gray-300" />
              <p className="text-sm font-medium text-gray-500 mt-3">{t('customerIntelligence:empty.noCustomers')}</p>
              <p className="text-xs text-gray-400 mt-1">{t('customerIntelligence:empty.noActivityHint')}</p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('customerIntelligence:reports.customer')}</th>
                      <th scope="col" className="px-4 py-2.5 text-start font-semibold">{t('customerIntelligence:history.branch')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('customerIntelligence:reports.gross')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('customerIntelligence:reports.credited')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('customerIntelligence:reports.net')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('customerIntelligence:reports.invoices')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('customerIntelligence:reports.average')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('customerIntelligence:reports.lastPurchase')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end font-semibold">{t('customerIntelligence:reports.frequency')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(row => {
                      const name = isRtl
                        ? row.businessNameAr || row.nameAr || row.businessName || row.name
                        : row.businessName || row.name || row.businessNameAr || row.nameAr
                      return (
                        <tr key={row.customerId} className="border-t border-gray-100 hover:bg-gray-50/60">
                          <td className="px-4 py-3">
                            <Link
                              to={`/customers/${row.customerId}?${customerQuery}`}
                              className="font-semibold text-gray-900 hover:text-primary-600"
                              aria-label={t('customerIntelligence:reports.openCustomer', { customer: name })}
                            >
                              {name}
                            </Link>
                            <div className="mt-1 flex items-center gap-2">
                              <Badge variant={row.isActive ? 'success' : 'neutral'}>
                                {t(`customerIntelligence:status.${row.isActive ? 'active' : 'inactive'}`)}
                              </Badge>
                              {row.phone && <span className="text-xs text-gray-400" dir="ltr">{row.phone}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {isRtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr}
                          </td>
                          <td className="px-4 py-3 text-end"><Rial amount={row.grossPurchases} /></td>
                          <td className="px-4 py-3 text-end text-amber-700"><Rial amount={row.creditedAmount} /></td>
                          <td className="px-4 py-3 text-end font-bold text-emerald-700"><Rial amount={row.netPurchases} /></td>
                          <td className="px-4 py-3 text-end tabular-nums">{row.invoiceCount}</td>
                          <td className="px-4 py-3 text-end"><Rial amount={row.averageInvoiceValue} /></td>
                          <td className="px-4 py-3 text-end text-gray-500">{formatDate(row.lastPurchase, locale)}</td>
                          <td className="px-4 py-3 text-end text-gray-500">
                            {row.daysSinceLastPurchase == null
                              ? t('customerIntelligence:reports.never')
                              : t('customerIntelligence:reports.daysAgo', { count: row.daysSinceLastPurchase })}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-gray-100">
                {data.rows.map(row => {
                  const name = isRtl
                    ? row.businessNameAr || row.nameAr || row.businessName || row.name
                    : row.businessName || row.name || row.businessNameAr || row.nameAr
                  return (
                    <article key={row.customerId} className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="w-9 h-9 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center">
                          {row.customerType === 'business' ? <Building2 size={15} /> : <Users size={15} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <Link to={`/customers/${row.customerId}?${customerQuery}`} className="font-semibold text-gray-900">
                            {name}
                          </Link>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {isRtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr}
                          </p>
                        </div>
                        <p className="font-bold text-emerald-700"><Rial amount={row.netPurchases} /></p>
                      </div>
                      <dl className="grid grid-cols-3 gap-2 mt-3 text-xs">
                        <div><dt className="text-gray-400">{t('customerIntelligence:reports.gross')}</dt><dd className="font-semibold mt-1"><Rial amount={row.grossPurchases} /></dd></div>
                        <div><dt className="text-gray-400">{t('customerIntelligence:reports.credited')}</dt><dd className="font-semibold text-amber-700 mt-1"><Rial amount={row.creditedAmount} /></dd></div>
                        <div><dt className="text-gray-400">{t('customerIntelligence:reports.invoices')}</dt><dd className="font-semibold mt-1">{row.invoiceCount}</dd></div>
                      </dl>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {!!data?.totalPages && data.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage(current => Math.max(1, current - 1))}
            >
              <ChevronLeft size={14} className={isRtl ? 'rotate-180' : ''} />
              {t('common:previous')}
            </Button>
            <p className="text-xs text-gray-500">
              {t('customerIntelligence:reports.page', { page, pages: data.totalPages })}
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.totalPages || loading}
              onClick={() => setPage(current => current + 1)}
            >
              {t('common:next')}
              <ChevronRight size={14} className={isRtl ? 'rotate-180' : ''} />
            </Button>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-400 leading-relaxed">{t('customerIntelligence:pdf.disclaimer')}</p>
    </div>
  )
}
