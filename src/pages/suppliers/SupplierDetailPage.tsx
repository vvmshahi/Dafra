import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarClock,
  Download,
  FileText,
  Mail,
  Pencil,
  Phone,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/localization/useLocale'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { SupplierIntelligenceFiltersPanel } from '@/components/suppliers/SupplierIntelligenceFilters'
import SupplierModal from './SupplierModal'
import type { Branch, Supplier } from '@/types'
import {
  buildSupplierInsights,
  intelligenceDateRange,
  loadSupplierHistory,
  loadSupplierIntelligence,
  supplierDisplayName,
  type IntelligenceDatePreset,
  type SupplierHistoryResponse,
  type SupplierInsight,
  type SupplierIntelligenceFilters,
  type SupplierIntelligenceResponse,
} from '@/lib/suppliers/supplierIntelligence'
import {
  openSupplierReportWindow,
  renderSupplierIntelligenceReport,
  SUPPLIER_REPORT_HISTORY_LIMIT,
  type SupplierReportCopy,
} from '@/lib/suppliers/supplierIntelligencePrint'

const PAGE_SIZE = 20

interface FilterOption {
  id: string
  name: string
  nameAr: string | null
}

function formatDate(value: string | null, locale: string, withTime = false) {
  if (!value) return '—'
  return new Date(value).toLocaleString(
    locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA',
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  )
}

function formatRange(startDate: string, endDate: string, locale: string) {
  return `${formatDate(startDate, locale)} – ${formatDate(endDate, locale)}`
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  detail: string
  tone?: 'neutral' | 'emerald' | 'amber'
  icon: React.ElementType
}) {
  const styles = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50/60 text-amber-900'
      : 'border-gray-100 bg-white text-gray-900'
  const iconStyles = tone === 'emerald'
    ? 'bg-emerald-100 text-emerald-700'
    : tone === 'amber'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-500'
  return (
    <article className={`rounded-xl border p-3.5 shadow-card min-w-0 ${styles}`} aria-label={label}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold opacity-70 leading-snug">{label}</p>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconStyles}`}>
          <Icon size={14} />
        </span>
      </div>
      <div className="text-xl font-bold mt-2 tabular-nums break-words">{value}</div>
      <p className="text-[11px] mt-1 opacity-65 leading-snug min-h-8">{detail}</p>
    </article>
  )
}

function insightText(
  insight: SupplierInsight,
  t: ReturnType<typeof useTranslation>['t'],
) {
  return t(`supplierIntelligence:insights.${insight.key}`, insight.values)
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { t, i18n } = useTranslation(['supplierIntelligence', 'suppliers', 'common'])
  const { profile, tenant, branch: authBranch } = useAuth()
  const { isRtl } = useLocale()
  const locale = i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA' : 'en'
  const queryStart = searchParams.get('start')
  const queryEnd = searchParams.get('end')
  const defaultRange = intelligenceDateRange('last30')

  const [preset, setPreset] = useState<IntelligenceDatePreset>(
    queryStart && queryEnd ? 'custom' : 'last30',
  )
  const [filters, setFilters] = useState<SupplierIntelligenceFilters>({
    startDate: queryStart || defaultRange.startDate,
    endDate: queryEnd || defaultRange.endDate,
    branchId: searchParams.get('branch') || (profile?.role === 'branch' ? profile.branch_id : null),
    productId: searchParams.get('product'),
    productUnitId: searchParams.get('unit'),
    paymentStatus: (
      searchParams.get('payment') === 'paid'
      || searchParams.get('payment') === 'partial'
      || searchParams.get('payment') === 'unpaid'
    ) ? searchParams.get('payment') as SupplierIntelligenceFilters['paymentStatus'] : 'all',
  })
  const [data, setData] = useState<SupplierIntelligenceResponse | null>(null)
  const [history, setHistory] = useState<SupplierHistoryResponse | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<FilterOption[]>([])
  const [units, setUnits] = useState<FilterOption[]>([])
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [preparingPdf, setPreparingPdf] = useState(false)

  const canChooseBranch = profile?.role !== 'branch'

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

  const reloadSummary = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setData(await loadSupplierIntelligence(id, filters))
    } catch (loadError) {
      console.error('Unable to load supplier intelligence', loadError)
      setData(null)
      setError(t('supplierIntelligence:errors.load'))
    } finally {
      setLoading(false)
    }
  }, [filters, id, t])

  useEffect(() => {
    let stale = false
    if (!id) {
      setError(t('supplierIntelligence:errors.notFound'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    void loadSupplierIntelligence(id, filters)
      .then(result => {
        if (!stale) setData(result)
      })
      .catch(loadError => {
        console.error('Unable to load supplier intelligence', loadError)
        if (!stale) {
          setData(null)
          setError(t('supplierIntelligence:errors.load'))
        }
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => { stale = true }
  }, [filters, id, t])

  useEffect(() => {
    let stale = false
    if (!id) return
    setHistoryLoading(true)
    setHistoryError(null)
    void loadSupplierHistory(id, filters, historyPage, PAGE_SIZE)
      .then(result => {
        if (!stale) setHistory(result)
      })
      .catch(loadError => {
        console.error('Unable to load supplier history', loadError)
        if (!stale) {
          setHistory(null)
          setHistoryError(t('supplierIntelligence:errors.history'))
        }
      })
      .finally(() => {
        if (!stale) setHistoryLoading(false)
      })
    return () => { stale = true }
  }, [filters, historyPage, historyRefreshKey, id, t])

  useEffect(() => {
    setHistoryPage(1)
    const next = new URLSearchParams({
      start: filters.startDate,
      end: filters.endDate,
    })
    if (filters.branchId) next.set('branch', filters.branchId)
    if (filters.productId) next.set('product', filters.productId)
    if (filters.productUnitId) next.set('unit', filters.productUnitId)
    if (filters.paymentStatus !== 'all') next.set('payment', filters.paymentStatus)
    setSearchParams(next, { replace: true })
  }, [filters, setSearchParams])

  const handlePreset = (nextPreset: IntelligenceDatePreset) => {
    setPreset(nextPreset)
    if (nextPreset !== 'custom') {
      setFilters(current => ({ ...current, ...intelligenceDateRange(nextPreset) }))
    }
  }

  const handleFilterChange = (next: SupplierIntelligenceFilters) => {
    setPreset('custom')
    setFilters(next)
  }

  const handleEdit = async () => {
    if (!id) return
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (supplier) setEditingSupplier(supplier as unknown as Supplier)
  }

  const selectedBranch = filters.branchId
    ? branches.find(branch => branch.id === filters.branchId)
      ?? (authBranch?.id === filters.branchId ? authBranch : null)
    : data?.supplier.branchId
      ? branches.find(branch => branch.id === data.supplier.branchId)
        ?? (authBranch?.id === data.supplier.branchId ? authBranch : null)
      : null
  const selectedProduct = products.find(product => product.id === filters.productId)
  const selectedUnit = units.find(unit => unit.id === filters.productUnitId)
  const localizedOption = (option: { name: string; nameAr?: string | null } | null | undefined) => (
    option ? (isRtl ? option.nameAr?.trim() || option.name : option.name || option.nameAr || '—') : null
  )

  const insights = useMemo(
    () => data ? buildSupplierInsights(data, isRtl) : [],
    [data, isRtl],
  )

  const handlePdf = async () => {
    if (!id || !data) return
    const reportWindow = openSupplierReportWindow(t('supplierIntelligence:pdf.preparing'))
    if (!reportWindow) {
      toast.error(t('supplierIntelligence:pdf.blocked'))
      return
    }
    setPreparingPdf(true)
    try {
      const fullHistory = await loadSupplierHistory(
        id,
        filters,
        1,
        SUPPLIER_REPORT_HISTORY_LIMIT,
      )
      const copy: SupplierReportCopy = {
        title: t('supplierIntelligence:pdf.title'),
        generatedAt: t('supplierIntelligence:pdf.generatedAt'),
        selectedPeriod: t('supplierIntelligence:pdf.selectedPeriod'),
        filters: t('supplierIntelligence:pdf.filters'),
        allBranches: t('supplierIntelligence:filters.allBranches'),
        allProducts: t('supplierIntelligence:filters.allProducts'),
        allUnits: t('supplierIntelligence:filters.allUnits'),
        allPaymentStatuses: t('supplierIntelligence:paymentStatus.all'),
        supplier: t('supplierIntelligence:pdf.supplier'),
        phone: t('supplierIntelligence:pdf.phone'),
        email: t('supplierIntelligence:pdf.email'),
        vatNumber: t('supplierIntelligence:pdf.vatNumber'),
        grossPurchases: t('supplierIntelligence:metrics.grossPurchases'),
        purchaseCount: t('supplierIntelligence:metrics.purchaseCount'),
        averagePurchase: t('supplierIntelligence:metrics.averagePurchase'),
        lastPurchase: t('supplierIntelligence:metrics.lastPurchase'),
        purchaseFrequency: t('supplierIntelligence:metrics.purchaseFrequency'),
        daysSinceLastPurchase: t('supplierIntelligence:metrics.daysSinceLastPurchase'),
        days: t('supplierIntelligence:days'),
        topProducts: t('supplierIntelligence:products.title'),
        product: t('supplierIntelligence:products.product'),
        unit: t('supplierIntelligence:products.unit'),
        quantity: t('supplierIntelligence:products.quantity'),
        baseQuantity: t('supplierIntelligence:products.baseQuantity'),
        amount: t('supplierIntelligence:products.amount'),
        averageCost: t('supplierIntelligence:products.averageCost'),
        purchases: t('supplierIntelligence:products.purchases'),
        purchaseTimeline: t('supplierIntelligence:timeline.title'),
        period: t('supplierIntelligence:timeline.period'),
        supplierInsights: t('supplierIntelligence:pdf.supplierInsights'),
        paymentStatus: t('supplierIntelligence:paymentStatus.title'),
        purchaseHistory: t('supplierIntelligence:pdf.purchaseHistory'),
        date: t('supplierIntelligence:history.date'),
        reference: t('supplierIntelligence:history.reference'),
        referenceMissing: t('supplierIntelligence:history.referenceMissing'),
        branch: t('supplierIntelligence:history.branch'),
        items: t('supplierIntelligence:history.items'),
        documentStatus: t('supplierIntelligence:history.documentStatus'),
        disclaimer: t('supplierIntelligence:pdf.disclaimer'),
        limitedHistory: t('supplierIntelligence:pdf.limitedHistory'),
        informationalPayment: t('supplierIntelligence:paymentStatus.informational'),
        print: t('supplierIntelligence:pdf.print'),
        close: t('supplierIntelligence:pdf.close'),
        noData: t('supplierIntelligence:pdf.noData'),
        paymentStatuses: {
          paid: t('supplierIntelligence:paymentStatus.paid'),
          partial: t('supplierIntelligence:paymentStatus.partial'),
          unpaid: t('supplierIntelligence:paymentStatus.unpaid'),
        },
        statuses: {
          posted: t('supplierIntelligence:status.posted'),
          confirmed: t('supplierIntelligence:status.confirmed'),
          confirmed_legacy: t('supplierIntelligence:status.confirmed_legacy'),
          not_applicable: t('supplierIntelligence:status.not_applicable'),
          draft: t('supplierIntelligence:status.draft'),
          pending_confirmation: t('supplierIntelligence:status.pending_confirmation'),
          cancelled: t('supplierIntelligence:status.cancelled'),
          reversed: t('supplierIntelligence:status.reversed'),
        },
        insightText: insight => insightText(insight, t),
      }
      renderSupplierIntelligenceReport(reportWindow, {
        data,
        history: fullHistory.rows,
        historyTotalCount: fullHistory.totalCount,
        filters,
        filterLabels: {
          branch: localizedOption(selectedBranch) ?? copy.allBranches,
          product: localizedOption(selectedProduct) ?? copy.allProducts,
          unit: localizedOption(selectedUnit) ?? copy.allUnits,
          paymentStatus: filters.paymentStatus === 'all'
            ? copy.allPaymentStatuses
            : copy.paymentStatuses[filters.paymentStatus],
          dateRange: formatRange(filters.startDate, filters.endDate, locale),
        },
        tenant,
        branch: selectedBranch,
        locale,
        copy,
        insights,
      })
    } catch (pdfError) {
      console.error('Unable to prepare supplier report', pdfError)
      reportWindow.close()
      toast.error(t('supplierIntelligence:pdf.failed'))
    } finally {
      setPreparingPdf(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" aria-live="polite">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4" role="alert">
        <div className="card p-7 max-w-md w-full text-center">
          <Building2 size={28} className="mx-auto text-amber-500" />
          <h1 className="mt-3 text-lg font-bold text-gray-900">
            {t('supplierIntelligence:errors.notFound')}
          </h1>
          <p className="mt-2 text-sm text-gray-500">{error}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/suppliers')}>
              {t('supplierIntelligence:actions.backToSuppliers')}
            </Button>
            <Button onClick={reloadSummary}>
              <RefreshCw size={14} />
              {t('supplierIntelligence:actions.retry')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const supplierName = supplierDisplayName(data.supplier, isRtl)
  const maxTimeline = Math.max(...data.timeline.map(point => Math.abs(point.grossPurchases)), 1)
  const noActivity = data.summary.purchaseCount === 0
  const historyFrom = history && history.totalCount
    ? (history.page - 1) * history.pageSize + 1
    : 0
  const historyTo = history
    ? Math.min(history.page * history.pageSize, history.totalCount)
    : 0

  return (
    <div className="space-y-5 max-w-[1600px]">
      <header className="card overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-amber-400 via-gold-500 to-primary-500" aria-hidden="true" />
        <div className="p-4 sm:p-5 flex flex-col xl:flex-row xl:items-start gap-4">
          <div className="flex-1 min-w-0">
            <Link
              to="/suppliers"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
            >
              <ArrowLeft size={13} className={isRtl ? 'rotate-180' : ''} />
              {t('supplierIntelligence:actions.backToSuppliers')}
            </Link>
            <div className="mt-3 flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
                <Building2 size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900 break-words" dir="auto">{supplierName}</h1>
                  <Badge variant={data.supplier.isActive ? 'success' : 'neutral'} dot>
                    {t(`supplierIntelligence:status.${data.supplier.isActive ? 'active' : 'inactive'}`)}
                  </Badge>
                </div>
                {data.supplier.nameAr && data.supplier.nameAr !== supplierName && (
                  <p className="text-sm text-gray-500 mt-0.5 break-words" dir="auto">{data.supplier.nameAr}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                  {data.supplier.phone && (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone size={12} /><bdi dir="ltr">{data.supplier.phone}</bdi>
                    </span>
                  )}
                  {data.supplier.email && (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Mail size={12} /><bdi className="break-all" dir="ltr">{data.supplier.email}</bdi>
                    </span>
                  )}
                  {data.supplier.vatNumber && (
                    <span><span className="font-semibold">{t('suppliers:vatShort')}:</span> <bdi dir="ltr">{data.supplier.vatNumber}</bdi></span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleEdit}>
              <Pencil size={14} />
              {t('supplierIntelligence:actions.editSupplier')}
            </Button>
            <Button variant="secondary" size="sm" onClick={handlePdf} loading={preparingPdf}>
              <Download size={14} />
              {t('supplierIntelligence:pdf.action')}
            </Button>
            <Link to={`/reports/suppliers?start=${filters.startDate}&end=${filters.endDate}`}>
              <Button size="sm">
                <BarChart3 size={14} />
                {t('supplierIntelligence:reports.openReports')}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {!data.supplier.isActive && (
        <div className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-600" role="status">
          {t('supplierIntelligence:empty.inactive')}
        </div>
      )}

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
        onChange={handleFilterChange}
      />

      <div className="sr-only" aria-live="polite">
        {loading ? t('common:loading') : t('supplierIntelligence:filters.activeRange', {
          range: formatRange(filters.startDate, filters.endDate, locale),
        })}
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3" aria-label={t('supplierIntelligence:detailTitle')}>
        <MetricCard
          label={t('supplierIntelligence:metrics.grossPurchases')}
          value={<Rial amount={data.summary.grossPurchases} />}
          detail={t('supplierIntelligence:metrics.grossDefinition')}
          tone="emerald"
          icon={ShoppingCart}
        />
        <MetricCard
          label={t('supplierIntelligence:metrics.purchaseCount')}
          value={data.summary.purchaseCount.toLocaleString('en-US')}
          detail={t('supplierIntelligence:metrics.countDefinition')}
          icon={Receipt}
        />
        <MetricCard
          label={t('supplierIntelligence:metrics.averagePurchase')}
          value={<Rial amount={data.summary.averagePurchaseValue} />}
          detail={t('supplierIntelligence:metrics.averageDefinition')}
          icon={TrendingUp}
        />
        <MetricCard
          label={t('supplierIntelligence:metrics.lastPurchase')}
          value={data.summary.lastPurchase
            ? formatDate(data.summary.lastPurchase.purchaseDate, locale)
            : '—'}
          detail={t('supplierIntelligence:metrics.lastDefinition')}
          icon={CalendarClock}
        />
        <MetricCard
          label={t('supplierIntelligence:metrics.purchaseFrequency')}
          value={data.summary.averageDaysBetweenPurchases == null
            ? '—'
            : t('supplierIntelligence:metrics.averageDays', {
                days: data.summary.averageDaysBetweenPurchases.toLocaleString('en-US'),
              })}
          detail={data.summary.averageDaysBetweenPurchases == null
            ? t('supplierIntelligence:metrics.notEnoughFrequency')
            : t('supplierIntelligence:metrics.countDefinition')}
          tone="amber"
          icon={RefreshCw}
        />
        <MetricCard
          label={t('supplierIntelligence:metrics.daysSinceLastPurchase')}
          value={data.summary.daysSinceLastPurchase == null
            ? '—'
            : data.summary.daysSinceLastPurchase.toLocaleString('en-US')}
          detail={t('supplierIntelligence:metrics.daysDefinition')}
          icon={CalendarClock}
        />
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <FileText size={15} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-xs leading-relaxed text-amber-900">
            <p className="font-semibold">{t('supplierIntelligence:notPayables')}</p>
            <p className="mt-0.5 text-amber-800">{t('supplierIntelligence:returnsDeferred')}</p>
          </div>
        </div>
      </section>

      {noActivity && (
        <section className="card py-12 px-5 text-center">
          <Receipt size={24} className="mx-auto text-gray-300" />
          <h2 className="mt-3 text-sm font-bold text-gray-800">
            {filters.productId || filters.productUnitId
              ? t('supplierIntelligence:empty.noProduct')
              : t('supplierIntelligence:empty.noActivity')}
          </h2>
          <p className="mt-1 text-xs text-gray-500">{t('supplierIntelligence:empty.adjustFilters')}</p>
        </section>
      )}

      {!noActivity && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <section className="card p-4 xl:col-span-2" aria-labelledby="supplier-timeline-title">
              <div className="mb-4">
                <h2 id="supplier-timeline-title" className="text-sm font-bold text-gray-900">
                  {t('supplierIntelligence:timeline.title')}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t('supplierIntelligence:timeline.subtitle', {
                    granularity: t(`supplierIntelligence:timeline.${data.timelineGranularity}`),
                  })}
                </p>
              </div>
              <div className="space-y-3" role="img" aria-label={t('supplierIntelligence:timeline.title')}>
                {data.timeline.map(point => {
                  const width = Math.max(3, Math.abs(point.grossPurchases) / maxTimeline * 100)
                  return (
                    <div key={point.bucketStart} className="grid grid-cols-[6rem_1fr_auto] sm:grid-cols-[8rem_1fr_auto] gap-3 items-center">
                      <span className="text-xs text-gray-500">{formatDate(point.bucketStart, locale)}</span>
                      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${width}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-gray-700 tabular-nums" dir="ltr">
                        {sarStr(point.grossPurchases)}
                      </span>
                      <span className="sr-only">
                        {t('supplierIntelligence:timeline.accessibleSummary', {
                          period: formatDate(point.bucketStart, locale),
                          gross: sarStr(point.grossPurchases),
                          count: point.purchaseCount,
                        })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="card p-4" aria-labelledby="supplier-recent-title">
              <h2 id="supplier-recent-title" className="text-sm font-bold text-gray-900">
                {t('supplierIntelligence:recent.title')}
              </h2>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl bg-amber-50 p-3">
                  <p className="text-xs text-amber-700">{t('supplierIntelligence:recent.last30')}</p>
                  <p className="text-lg font-bold text-amber-900 mt-1"><Rial amount={data.recentComparison.recentGross} /></p>
                  <p className="text-xs text-amber-700 mt-1">
                    {t('supplierIntelligence:recent.purchases', {
                      count: data.recentComparison.recentPurchaseCount,
                    })}
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">{t('supplierIntelligence:recent.previous30')}</p>
                  <p className="text-lg font-bold text-gray-800 mt-1"><Rial amount={data.recentComparison.previousGross} /></p>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('supplierIntelligence:recent.purchases', {
                      count: data.recentComparison.previousPurchaseCount,
                    })}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500 leading-relaxed">
                {data.recentComparison.grossPercentChange == null
                  ? t('supplierIntelligence:recent.noComparable')
                  : data.recentComparison.grossPercentChange > 0
                    ? t('supplierIntelligence:recent.increase', {
                        percent: Math.abs(data.recentComparison.grossPercentChange).toLocaleString('en-US'),
                      })
                    : data.recentComparison.grossPercentChange < 0
                      ? t('supplierIntelligence:recent.decrease', {
                          percent: Math.abs(data.recentComparison.grossPercentChange).toLocaleString('en-US'),
                        })
                      : t('supplierIntelligence:recent.unchanged')}
              </p>
            </section>
          </div>

          <section className="card p-4" aria-labelledby="supplier-insights-title">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center">
                <Sparkles size={15} />
              </span>
              <div>
                <h2 id="supplier-insights-title" className="text-sm font-bold text-gray-900">
                  {t('supplierIntelligence:insights.title')}
                </h2>
                <p className="text-xs text-gray-400">{t('supplierIntelligence:insights.subtitle')}</p>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {insights.map((insight, index) => (
                <li key={`${insight.key}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 leading-relaxed">
                  {insightText(insight, t)}
                </li>
              ))}
            </ul>
          </section>

          <section className="card overflow-hidden" aria-labelledby="supplier-top-products-title">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 id="supplier-top-products-title" className="text-sm font-bold text-gray-900">
                {t('supplierIntelligence:products.title')}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{t('supplierIntelligence:products.subtitle')}</p>
            </div>
            {data.topProducts.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-start">{t('supplierIntelligence:products.product')}</th>
                      <th scope="col" className="px-3 py-2.5 text-start">{t('supplierIntelligence:products.unit')}</th>
                      <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:products.quantity')}</th>
                      <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:products.baseQuantity')}</th>
                      <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:products.amount')}</th>
                      <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:products.averageCost')}</th>
                      <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:products.purchases')}</th>
                      <th scope="col" className="px-4 py-2.5 text-end">{t('supplierIntelligence:products.lastPurchase')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.topProducts.map((product, index) => (
                      <tr key={`${product.productId ?? product.name}-${product.productUnitId ?? product.unitName}-${index}`}>
                        <td className="px-4 py-3 font-semibold text-gray-900 break-words" dir="auto">
                          {isRtl ? product.nameAr || product.name : product.name || product.nameAr}
                        </td>
                        <td className="px-3 py-3 text-gray-600" dir="auto">
                          {isRtl ? product.unitNameAr || product.unitName : product.unitName || product.unitNameAr}
                          {product.unitCode && <span className="ms-1 text-[10px] text-gray-400" dir="ltr">({product.unitCode})</span>}
                        </td>
                        <td className="px-3 py-3 text-end tabular-nums">{product.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                        <td className="px-3 py-3 text-end tabular-nums text-gray-500">
                          {product.baseQuantity == null ? '—' : product.baseQuantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                        </td>
                        <td className="px-3 py-3 text-end font-semibold"><Rial amount={product.grossAmount} /></td>
                        <td className="px-3 py-3 text-end">{product.averageUnitCost == null ? '—' : <Rial amount={product.averageUnitCost} />}</td>
                        <td className="px-3 py-3 text-end tabular-nums">{product.purchaseCount}</td>
                        <td className="px-4 py-3 text-end text-gray-500">{formatDate(product.lastPurchased, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-gray-400">{t('supplierIntelligence:empty.noProduct')}</div>
            )}
          </section>

          <section className="card overflow-hidden" aria-labelledby="supplier-payment-title">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 id="supplier-payment-title" className="text-sm font-bold text-gray-900">
                {t('supplierIntelligence:paymentStatus.title')}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{t('supplierIntelligence:paymentStatus.informational')}</p>
            </div>
            {data.paymentStatusSummary.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-gray-100">
                {data.paymentStatusSummary.map(row => (
                  <article key={row.status} className="bg-white px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500">{t(`supplierIntelligence:paymentStatus.${row.status}`)}</p>
                    <p className="mt-1 text-base font-bold text-gray-900"><Rial amount={row.grossPurchases} /></p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {t('supplierIntelligence:paymentStatus.purchaseCount', { count: row.purchaseCount })}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-gray-400">{t('supplierIntelligence:empty.noPaymentData')}</div>
            )}
          </section>
        </>
      )}

      <section className="card overflow-hidden" aria-labelledby="supplier-history-title">
        <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h2 id="supplier-history-title" className="text-sm font-bold text-gray-900">
              {t('supplierIntelligence:history.title')}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{t('supplierIntelligence:history.subtitle')}</p>
          </div>
          {history && history.totalCount > 0 && (
            <p className="text-xs text-gray-500 tabular-nums" aria-live="polite">
              {t('supplierIntelligence:history.showing', {
                from: historyFrom,
                to: historyTo,
                total: history.totalCount,
              })}
            </p>
          )}
        </div>
        {historyLoading ? (
          <div className="py-12 flex justify-center" aria-live="polite"><LoadingSpinner /></div>
        ) : historyError ? (
          <div className="py-10 text-center" role="alert">
            <p className="text-sm text-red-600">{historyError}</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setHistoryRefreshKey(key => key + 1)}>
              {t('supplierIntelligence:actions.retry')}
            </Button>
          </div>
        ) : history?.rows.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start">{t('supplierIntelligence:history.date')}</th>
                    <th scope="col" className="px-3 py-2.5 text-start">{t('supplierIntelligence:history.reference')}</th>
                    <th scope="col" className="px-3 py-2.5 text-start">{t('supplierIntelligence:history.branch')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:history.items')}</th>
                    <th scope="col" className="px-3 py-2.5 text-end">{t('supplierIntelligence:history.gross')}</th>
                    <th scope="col" className="px-3 py-2.5 text-start">{t('supplierIntelligence:history.paymentStatus')}</th>
                    <th scope="col" className="px-4 py-2.5 text-start">{t('supplierIntelligence:history.documentStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.rows.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(row.createdAt, locale, true)}</td>
                      <td className="px-3 py-3 font-medium text-gray-800 break-words" dir="auto">
                        {row.reference || t('supplierIntelligence:history.referenceMissing')}
                      </td>
                      <td className="px-3 py-3 text-gray-600" dir="auto">
                        {isRtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr}
                      </td>
                      <td className="px-3 py-3 text-end tabular-nums">{row.itemCount}</td>
                      <td className="px-3 py-3 text-end font-semibold"><Rial amount={row.grossAmount} /></td>
                      <td className="px-3 py-3">
                        <Badge variant={row.paymentStatus === 'paid' ? 'success' : row.paymentStatus === 'partial' ? 'warning' : 'neutral'}>
                          {t(`supplierIntelligence:paymentStatus.${row.paymentStatus}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="neutral">
                          {t(`supplierIntelligence:status.${row.receivingStatus}`, {
                            defaultValue: t(`supplierIntelligence:status.${row.status}`, {
                              defaultValue: t('supplierIntelligence:status.unknown'),
                            }),
                          })}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={history.page <= 1}
                aria-label={t('supplierIntelligence:history.previous')}
                onClick={() => setHistoryPage(page => Math.max(1, page - 1))}
              >
                {t('supplierIntelligence:history.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={history.page >= history.totalPages}
                aria-label={t('supplierIntelligence:history.next')}
                onClick={() => setHistoryPage(page => page + 1)}
              >
                {t('supplierIntelligence:history.next')}
              </Button>
            </div>
          </>
        ) : (
          <div className="py-10 text-center text-sm text-gray-400">{t('supplierIntelligence:empty.noActivity')}</div>
        )}
      </section>

      <SupplierModal
        open={editingSupplier !== null}
        supplier={editingSupplier}
        onClose={() => setEditingSupplier(null)}
        onSaved={() => {
          setEditingSupplier(null)
          void reloadSummary()
        }}
      />
    </div>
  )
}
