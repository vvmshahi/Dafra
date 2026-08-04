import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarClock,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  User,
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
import { WorkspaceTabNav } from '@/components/ui/WorkspaceTabNav'
import { CustomerIntelligenceFiltersPanel } from '@/components/customers/CustomerIntelligenceFilters'
import { CustomerReceivablesPanel } from '@/components/customers/CustomerReceivablesPanel'
import { loadBranchCustomerCreditSettings, loadCustomerReceivableWorkspace } from '@/lib/customers/receivables'
import CustomerModal from './CustomerModal'
import type { CustomerWithStats } from './CustomersPage'
import type { Branch } from '@/types'
import {
  buildCustomerInsights,
  customerDisplayName,
  intelligenceDateRange,
  loadCustomerHistory,
  loadCustomerIntelligence,
  type CustomerActivityType,
  type CustomerHistoryResponse,
  type CustomerInsight,
  type CustomerIntelligenceFilters,
  type CustomerIntelligenceResponse,
  type IntelligenceDatePreset,
} from '@/lib/customers/customerIntelligence'
import {
  CUSTOMER_REPORT_HISTORY_LIMIT,
  openCustomerReportWindow,
  renderCustomerIntelligenceReport,
  type CustomerReportCopy,
} from '@/lib/customers/customerIntelligencePrint'

// Safe-read contract note: invoice_number, invoice_date, total_amount now come
// from scoped customer-intelligence RPC output instead of a browser invoice query.
const PAGE_SIZE = 20

interface FilterOption {
  id: string
  name: string
  nameAr: string | null
}

type CustomerProfileSection = 'overview' | 'products' | 'credit'

const PROFILE_SECTIONS: CustomerProfileSection[] = ['overview', 'products', 'credit']

function normalizeProfileSection(value: string | null): CustomerProfileSection {
  if (value === 'documents' || value === 'report' || value === 'invoices') return 'overview'
  return value !== null && PROFILE_SECTIONS.includes(value as CustomerProfileSection)
    ? value as CustomerProfileSection
    : 'overview'
}

function formatDate(value: string | null, locale: string, withTime = false) {
  if (!value) return '—'
  return new Date(value).toLocaleString(
    locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA',
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  )
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
    ? 'bg-gradient-to-br from-[#1B6B3A] to-[#0F2419] text-white'
    : tone === 'amber'
      ? 'bg-gradient-to-br from-[#9a3412] to-[#5c1d0b] text-white'
      : 'bg-gradient-to-br from-[#334155] to-[#1e293b] text-white'
  const iconStyles = tone === 'emerald'
    ? 'bg-white/15 text-emerald-100'
    : tone === 'amber'
      ? 'bg-white/15 text-orange-100'
      : 'bg-white/10 text-white/70'
  return (
    <article className={`min-w-0 rounded-xl p-3.5 shadow-card ${styles}`} aria-label={label}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold opacity-70 leading-snug">{label}</p>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconStyles}`}>
          <Icon size={14} />
        </span>
      </div>
      <div className="text-xl font-bold mt-2 tabular-nums truncate">{value}</div>
      <p className="text-[11px] mt-1 opacity-65 leading-snug min-h-8">{detail}</p>
    </article>
  )
}

function insightText(
  insight: CustomerInsight,
  t: ReturnType<typeof useTranslation>['t'],
) {
  return t(`insights.${insight.key}`, insight.values)
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { t, i18n } = useTranslation(['customerIntelligence', 'customers', 'common'])
  const { profile, tenant, branch: authBranch } = useAuth()
  const { isRtl } = useLocale()
  const locale = i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA' : 'en'
  const queryStart = searchParams.get('start')
  const queryEnd = searchParams.get('end')
  const defaultRange = intelligenceDateRange('thisMonth')

  const [preset, setPreset] = useState<IntelligenceDatePreset>(
    queryStart && queryEnd ? 'custom' : 'thisMonth',
  )
  const [filters, setFilters] = useState<CustomerIntelligenceFilters>({
    startDate: queryStart || defaultRange.startDate,
    endDate: queryEnd || defaultRange.endDate,
    branchId: searchParams.get('branch') || (profile?.role === 'branch' ? profile.branch_id : null),
    productId: searchParams.get('product'),
    productUnitId: searchParams.get('unit'),
  })
  const [data, setData] = useState<CustomerIntelligenceResponse | null>(null)
  const [history, setHistory] = useState<CustomerHistoryResponse | null>(null)
  const [historyType, setHistoryType] = useState<CustomerActivityType>('all')
  const [historyPage, setHistoryPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [branches, setBranches] = useState<Branch[]>([])
  const [products, setProducts] = useState<FilterOption[]>([])
  const [units, setUnits] = useState<FilterOption[]>([])
  const [editingCustomer, setEditingCustomer] = useState<CustomerWithStats | null>(null)
  const [preparingPdf, setPreparingPdf] = useState(false)
  const [customerCreditVisible, setCustomerCreditVisible] = useState(false)
  const [customerMeta, setCustomerMeta] = useState<{ city: string | null; cityAr: string | null; crNumber: string | null } | null>(null)
  const requestedProfileSection = searchParams.get('section')
  const activeProfileSection = (normalizeProfileSection(requestedProfileSection) !== 'credit' || customerCreditVisible)
    ? normalizeProfileSection(requestedProfileSection)
    : 'overview'

  useEffect(() => {
    if (requestedProfileSection === 'documents' || requestedProfileSection === 'report' || requestedProfileSection === 'invoices') {
      const next = new URLSearchParams(searchParams)
      next.set('section', normalizeProfileSection(requestedProfileSection))
      setSearchParams(next, { replace: true })
    }
  }, [requestedProfileSection, searchParams, setSearchParams])

  const canChooseBranch = profile?.role !== 'branch'

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void supabase.from('customers').select('city, city_ar, cr_number').eq('id', id).maybeSingle().then(({ data: row }) => {
      if (!cancelled) setCustomerMeta(row ? { city: row.city, cityAr: row.city_ar, crNumber: row.cr_number } : null)
    })
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (!data?.customer.branchId || data.customer.customerType !== 'business') {
      setCustomerCreditVisible(false)
      return
    }
    let cancelled = false
    void Promise.all([
      loadBranchCustomerCreditSettings(data.customer.branchId),
      loadCustomerReceivableWorkspace({ customerId: data.customer.id, branchId: data.customer.branchId, page: 1, pageSize: 1 }),
    ]).then(([settings, workspace]) => {
      if (!cancelled) setCustomerCreditVisible(settings.branchCreditEnabled || workspace.ledger.length > 0)
    }).catch(() => { if (!cancelled) setCustomerCreditVisible(false) })
    return () => { cancelled = true }
  }, [data?.customer.branchId, data?.customer.customerType, data?.customer.id])

  function selectProfileSection(section: CustomerProfileSection) {
    const next = new URLSearchParams(searchParams)
    if (section === 'overview') next.delete('section')
    else next.set('section', section)
    setSearchParams(next)
  }

  useEffect(() => {
    if (!profile?.tenant_id) return
    let cancelled = false
    void supabase
      .from('branches')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('name')
      .then(({ data: branchRows }) => {
        if (!cancelled) setBranches((branchRows ?? []) as unknown as Branch[])
      })
    return () => { cancelled = true }
  }, [profile?.tenant_id])

  useEffect(() => {
    if (!profile?.tenant_id) return
    let cancelled = false
    let query = supabase
      .from('products')
      .select('id, name, name_ar')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('name')
      .limit(500)
    if (filters.branchId) query = query.eq('branch_id', filters.branchId)
    void query.then(({ data: productRows }) => {
      if (!cancelled) {
        setProducts((productRows ?? []).map(row => ({
          id: String(row.id),
          name: String(row.name),
          nameAr: row.name_ar ? String(row.name_ar) : null,
        })))
      }
    })
    return () => { cancelled = true }
  }, [profile?.tenant_id, filters.branchId])

  useEffect(() => {
    if (!filters.productId) {
      setUnits([])
      return
    }
    let cancelled = false
    void supabase
      .from('product_units')
      .select('id, name, name_ar')
      .eq('product_id', filters.productId)
      .eq('is_active', true)
      .order('sort_order')
      .limit(100)
      .then(({ data: unitRows }) => {
        if (!cancelled) {
          setUnits((unitRows ?? []).map(row => ({
            id: String(row.id),
            name: String(row.name),
            nameAr: row.name_ar ? String(row.name_ar) : null,
          })))
        }
      })
    return () => { cancelled = true }
  }, [filters.productId])

  const loadSummary = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const result = await loadCustomerIntelligence(id, filters)
      setData(result)
    } catch (loadError) {
      console.error('Unable to load customer intelligence', loadError)
      setData(null)
      setError(t('customerIntelligence:errors.load'))
    } finally {
      setLoading(false)
    }
  }, [filters, id, t])

  useEffect(() => {
    let stale = false
    if (!id) {
      setError(t('customerIntelligence:errors.load'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    void loadCustomerIntelligence(id, filters)
      .then(result => {
        if (!stale) setData(result)
      })
      .catch(loadError => {
        console.error('Unable to load customer intelligence', loadError)
        if (!stale) {
          setData(null)
          setError(t('customerIntelligence:errors.load'))
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
    void loadCustomerHistory(id, filters, historyType, historyPage, PAGE_SIZE)
      .then(result => {
        if (!stale) setHistory(result)
      })
      .catch(loadError => {
        console.error('Unable to load customer history', loadError)
        if (!stale) {
          setHistory(null)
          setHistoryError(t('customerIntelligence:errors.history'))
        }
      })
      .finally(() => {
        if (!stale) setHistoryLoading(false)
      })
    return () => { stale = true }
  }, [filters, historyPage, historyRefreshKey, historyType, id, t])

  useEffect(() => {
    setHistoryPage(1)
    const next = new URLSearchParams(searchParams)
    next.set('start', filters.startDate)
    next.set('end', filters.endDate)
    if (filters.branchId) next.set('branch', filters.branchId)
    if (filters.productId) next.set('product', filters.productId)
    else next.delete('product')
    if (filters.productUnitId) next.set('unit', filters.productUnitId)
    else next.delete('unit')
    setSearchParams(next, { replace: true })
  }, [filters, searchParams, setSearchParams])

  const handlePreset = (nextPreset: IntelligenceDatePreset) => {
    setPreset(nextPreset)
    if (nextPreset !== 'custom') {
      const range = intelligenceDateRange(nextPreset)
      setFilters(current => ({ ...current, ...range }))
    }
  }

  const handleFilterChange = (next: CustomerIntelligenceFilters) => {
    setPreset('custom')
    setFilters(next)
  }

  const handleEdit = async () => {
    if (!id) return
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (customer) {
      setEditingCustomer({
        ...(customer as unknown as CustomerWithStats),
        total_purchases: data?.summary.grossPurchases ?? 0,
        last_purchase_date: data?.summary.lastPurchase?.invoiceDate ?? null,
        purchase_count: data?.summary.invoiceCount ?? 0,
      })
    }
  }

  const selectedBranch = filters.branchId
    ? branches.find(branch => branch.id === filters.branchId)
      ?? (authBranch?.id === filters.branchId ? authBranch : null)
    : null
  const selectedProduct = products.find(product => product.id === filters.productId)
  const selectedUnit = units.find(unit => unit.id === filters.productUnitId)
  const localizedOption = (option: { name: string; nameAr?: string | null } | null | undefined) => (
    option ? (isRtl ? option.nameAr?.trim() || option.name : option.name || option.nameAr || '—') : null
  )

  const insights = useMemo(() => data ? buildCustomerInsights(data, isRtl) : [], [data, isRtl])

  const handlePdf = async () => {
    if (!id || !data) return
    const reportWindow = openCustomerReportWindow(t('customerIntelligence:pdf.preparing'))
    if (!reportWindow) {
      toast.error(t('customerIntelligence:pdf.blocked'))
      return
    }
    setPreparingPdf(true)
    try {
      const fullHistory = await loadCustomerHistory(
        id,
        filters,
        'all',
        1,
        CUSTOMER_REPORT_HISTORY_LIMIT,
      )
      const copy: CustomerReportCopy = {
        title: t('customerIntelligence:pdf.title'),
        generatedAt: t('customerIntelligence:pdf.generatedAt'),
        selectedPeriod: t('customerIntelligence:pdf.selectedPeriod'),
        filters: t('customerIntelligence:pdf.filters'),
        allBranches: t('customerIntelligence:filters.allBranches'),
        allProducts: t('customerIntelligence:filters.allProducts'),
        allUnits: t('customerIntelligence:filters.allUnits'),
        customer: t('customerIntelligence:pdf.customer'),
        phone: t('customerIntelligence:pdf.phone'),
        vatNumber: t('customerIntelligence:pdf.vatNumber'),
        grossPurchases: t('customerIntelligence:metrics.grossPurchases'),
        creditedAmount: t('customerIntelligence:metrics.creditedAmount'),
        netPurchases: t('customerIntelligence:metrics.netPurchases'),
        invoiceCount: t('customerIntelligence:metrics.invoiceCount'),
        creditNoteCount: t('customerIntelligence:metrics.creditNoteCount'),
        averageInvoice: t('customerIntelligence:metrics.averageInvoice'),
        lastPurchase: t('customerIntelligence:metrics.lastPurchase'),
        purchaseFrequency: t('customerIntelligence:metrics.purchaseFrequency'),
        days: t('customerIntelligence:days'),
        topProducts: t('customerIntelligence:products.title'),
        product: t('customerIntelligence:products.product'),
        unit: t('customerIntelligence:products.unit'),
        quantity: t('customerIntelligence:products.quantity'),
        amount: t('customerIntelligence:products.amount'),
        invoices: t('customerIntelligence:products.invoices'),
        purchaseTimeline: t('customerIntelligence:timeline.title'),
        period: t('customerIntelligence:timeline.period'),
        gross: t('customerIntelligence:timeline.gross'),
        credited: t('customerIntelligence:timeline.credited'),
        net: t('customerIntelligence:timeline.net'),
        customerInsights: t('customerIntelligence:insights.title'),
        documentHistory: t('customerIntelligence:history.title'),
        date: t('customerIntelligence:history.date'),
        document: t('customerIntelligence:history.document'),
        branch: t('customerIntelligence:history.branch'),
        items: t('customerIntelligence:history.items'),
        disclaimer: t('customerIntelligence:pdf.disclaimer'),
        limitedHistory: t('customerIntelligence:pdf.limitedHistory'),
        print: t('customerIntelligence:pdf.print'),
        close: t('customerIntelligence:pdf.close'),
        noData: t('customerIntelligence:empty.noData'),
        documentTypes: {
          simplified: t('customerIntelligence:history.simplified'),
          standard: t('customerIntelligence:history.standard'),
          credit_note: t('customerIntelligence:history.credit_note'),
        },
        insightText: insight => insightText(insight, t),
      }
      renderCustomerIntelligenceReport(reportWindow, {
        data,
        history: fullHistory.rows,
        historyTotalCount: fullHistory.totalCount,
        filters,
        filterLabels: {
          branch: localizedOption(selectedBranch) || t('customerIntelligence:filters.allBranches'),
          product: localizedOption(selectedProduct) || t('customerIntelligence:filters.allProducts'),
          unit: localizedOption(selectedUnit) || t('customerIntelligence:filters.allUnits'),
          dateRange: `${formatDate(filters.startDate, locale)} – ${formatDate(filters.endDate, locale)}`,
        },
        tenant,
        branch: selectedBranch,
        locale,
        copy,
        insights,
      })
    } catch (pdfError) {
      reportWindow.close()
      console.error('Unable to prepare customer report', pdfError)
      toast.error(t('customerIntelligence:pdf.failed'))
    } finally {
      setPreparingPdf(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="min-h-[55vh] flex items-center justify-center" role="status" aria-live="polite">
        <LoadingSpinner size="lg" />
        <span className="sr-only">{t('common:loading')}</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-[55vh] flex flex-col items-center justify-center text-center px-4" role="alert">
        <div className="w-12 h-12 rounded-xl bg-red-50 text-red-500 flex items-center justify-center">
          <RefreshCw size={20} />
        </div>
        <p className="mt-4 text-sm font-semibold text-gray-800">{error ?? t('customerIntelligence:errors.load')}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void loadSummary()}>
          {t('customerIntelligence:actions.retry')}
        </Button>
      </div>
    )
  }

  const displayName = customerDisplayName(data.customer, isRtl)
  const secondaryName = isRtl ? data.customer.name : data.customer.nameAr
  const maxTimeline = Math.max(...data.timeline.map(point => Math.abs(point.netPurchases)), 1)
  const profileTabItems = PROFILE_SECTIONS
    .filter(section => section !== 'credit' || customerCreditVisible)
    .map(section => ({ id: section, label: t(`customerIntelligence:profileTabs.${section}`) }))
  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <button
        type="button"
        onClick={() => navigate('/customers')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft size={15} className={isRtl ? 'rotate-180' : ''} />
        {t('customerIntelligence:actions.back')}
      </button>

      <header className="rounded-2xl bg-[#173d2a] px-4 py-3 text-white shadow-card sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              data.customer.customerType === 'business'
                ? 'bg-white/15 text-emerald-100'
                : 'bg-white/15 text-emerald-100'
            }`}>
              {data.customer.customerType === 'business' ? <Building2 size={21} /> : <User size={21} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="break-words text-lg font-bold text-white sm:text-xl" dir="auto">
                  {displayName}
                </h1>
                <Badge variant={data.customer.isActive ? 'success' : 'neutral'} dot>
                  {t(`customerIntelligence:status.${data.customer.isActive ? 'active' : 'inactive'}`)}
                </Badge>
                <Badge variant={data.customer.customerType === 'business' ? 'info' : 'neutral'}>
                  {t(`customers:${data.customer.customerType}`)}
                </Badge>
              </div>
              {secondaryName?.trim() && secondaryName.trim() !== displayName && (
                <p className="text-sm text-emerald-100/75 mt-1" dir="auto">{secondaryName}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-emerald-50/85">
                {data.customer.phone && (
                  <span className="inline-flex items-center gap-1.5" dir="ltr"><Phone size={14} />{data.customer.phone}</span>
                )}
                {data.customer.email && (
                  <span className="inline-flex items-center gap-1.5"><Mail size={14} />{data.customer.email}</span>
                )}
                {(data.customer.vatNumber || customerMeta?.crNumber) && (
                  <span className="inline-flex items-center gap-1.5" dir="ltr"><FileText size={14} />{data.customer.vatNumber || customerMeta?.crNumber}</span>
                )}
                {(customerMeta?.crNumber || customerMeta?.city || customerMeta?.cityAr) && (
                  <span className="inline-flex items-center gap-1.5"><MapPin size={14} />{isRtl ? customerMeta?.cityAr || customerMeta?.city : customerMeta?.city || customerMeta?.cityAr}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void handleEdit()}>
              <Pencil size={14} />
              {t('customerIntelligence:actions.edit')}
            </Button>
          </div>
        </div>
      </header>

      <WorkspaceTabNav
        items={profileTabItems}
        activeId={activeProfileSection === 'credit' && !customerCreditVisible ? 'overview' : activeProfileSection}
        onSelect={section => selectProfileSection(section as CustomerProfileSection)}
        label={t('customerIntelligence:profileTabs.label')}
        className="mx-auto w-fit max-w-full"
      />

      <div id={`workspace-panel-${activeProfileSection}`} role="tabpanel" aria-label={t(`customerIntelligence:profileTabs.${activeProfileSection}`)}>
      {activeProfileSection === 'credit' && customerCreditVisible && <div id="customer-credit-settings"><CustomerReceivablesPanel
        customerId={id}
        branchId={data.customer.branchId}
        isOwner={profile?.role === 'owner' || profile?.role === 'admin'}
        canReversePayment={['owner', 'admin', 'accountant', 'manager'].includes(profile?.role ?? '')}
        canAdjustReceivables={['owner', 'admin', 'accountant'].includes(profile?.role ?? '')}
      /></div>}

      {activeProfileSection === 'overview' && <div className="flex flex-col gap-4"><div className="contents"><CustomerIntelligenceFiltersPanel
        filters={filters}
        preset={preset}
        branches={branches.map(branch => ({ id: branch.id, name: branch.name, nameAr: branch.name_ar }))}
        products={products}
        units={units}
        canChooseBranch={canChooseBranch}
        isArabic={isRtl}
        onPreset={handlePreset}
        onChange={handleFilterChange}
        className="order-2"
      />
      </div>

      <div className="order-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-gray-500">
            {t('customerIntelligence:filters.activeRange', {
              range: `${formatDate(filters.startDate, locale)} – ${formatDate(filters.endDate, locale)}`,
            })}
          </p>
          {(filters.productId || filters.productUnitId) && (
            <p className="text-[11px] text-gray-400 mt-1 max-w-3xl">
              {t('customerIntelligence:filters.productDocumentBasis')}
            </p>
          )}
        </div>
        {loading && <LoadingSpinner size="sm" />}
      </div>

      <section className="order-1" aria-labelledby="customer-summary-title">
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <h2 id="customer-summary-title" className="text-sm font-bold text-gray-900">
              {t('customerIntelligence:commercialActivity')}
            </h2>
            <p className="text-xs text-gray-400">{t('customerIntelligence:notBalance')}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard
            label={t('customerIntelligence:metrics.grossPurchases')}
            value={<Rial amount={data.summary.grossPurchases} />}
            detail={t('customerIntelligence:metrics.grossDefinition')}
            icon={ShoppingBag}
          />
          <MetricCard
            label={t('customerIntelligence:metrics.creditedAmount')}
            value={<Rial amount={data.summary.creditedAmount} />}
            detail={`${data.summary.creditNoteCount} ${t('customerIntelligence:metrics.creditNoteCount')}`}
            tone="amber"
            icon={RotateCcw}
          />
          <MetricCard
            label={t('customerIntelligence:metrics.netPurchases')}
            value={<Rial amount={data.summary.netPurchases} />}
            detail={t('customerIntelligence:metrics.netDefinition')}
            tone="emerald"
            icon={TrendingUp}
          />
          <MetricCard
            label={t('customerIntelligence:metrics.invoiceCount')}
            value={data.summary.invoiceCount.toLocaleString('en-US')}
            detail={t('customerIntelligence:metrics.grossDefinition')}
            icon={Receipt}
          />
          {false && <MetricCard
            label={t('customerIntelligence:metrics.averageInvoice')}
            value={<Rial amount={data.summary.averageInvoiceValue} />}
            detail={data.summary.invoiceCount
              ? t('customerIntelligence:metrics.invoiceCount')
              : t('customerIntelligence:metrics.notEnoughFrequency')}
            icon={BarChart3}
          />}
          {false && <MetricCard
            label={t('customerIntelligence:metrics.lastPurchase')}
            value={formatDate(data.summary.lastPurchase?.createdAt ?? null, locale)}
            detail={data.summary.lastPurchase?.reference ?? '—'}
            icon={CalendarClock}
          />}
        </div>
        <div className="hidden mt-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{t('customerIntelligence:metrics.purchaseFrequency')}:</span>{' '}
            {data.summary.averageDaysBetweenPurchases == null
              ? t('customerIntelligence:metrics.notEnoughFrequency')
              : t('customerIntelligence:metrics.averageDays', {
                  days: data.summary.averageDaysBetweenPurchases.toLocaleString('en-US'),
                })}
          </p>
          <p className="text-xs text-gray-500 tabular-nums" dir="ltr">
            {sarStr(data.summary.grossPurchases)} − {sarStr(data.summary.creditedAmount)} = {sarStr(data.summary.netPurchases)}
          </p>
        </div>
      </section>

      <div className="hidden grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section className="card p-4 xl:col-span-2" aria-labelledby="timeline-title">
          <div className="mb-4">
            <h2 id="timeline-title" className="text-sm font-bold text-gray-900">
              {t('customerIntelligence:timeline.title')}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('customerIntelligence:timeline.subtitle', {
                granularity: t(`customerIntelligence:timeline.${data.timelineGranularity}`),
              })}
            </p>
          </div>
          {data.timeline.length ? (
            <div className="space-y-3" role="img" aria-label={t('customerIntelligence:timeline.title')}>
              {data.timeline.map(point => {
                const width = Math.max(3, Math.abs(point.netPurchases) / maxTimeline * 100)
                const accessible = t('customerIntelligence:timeline.accessibleSummary', {
                  period: formatDate(point.bucketStart, locale),
                  gross: sarStr(point.grossPurchases),
                  credited: sarStr(point.creditedAmount),
                  net: sarStr(point.netPurchases),
                  count: point.invoiceCount,
                })
                return (
                  <div key={point.bucketStart} className="grid grid-cols-[6rem_1fr_auto] sm:grid-cols-[8rem_1fr_auto] gap-3 items-center">
                    <span className="text-xs text-gray-500">{formatDate(point.bucketStart, locale)}</span>
                    <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                      <div
                        className={`h-full rounded-full ${point.netPurchases < 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 tabular-nums" dir="ltr">
                      {sarStr(point.netPurchases)}
                    </span>
                    <span className="sr-only">{accessible}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-gray-400">
              {t('customerIntelligence:empty.noActivity')}
            </div>
          )}
        </section>

        <section className="card p-4" aria-labelledby="recent-title">
          <h2 id="recent-title" className="text-sm font-bold text-gray-900">
            {t('customerIntelligence:recent.title')}
          </h2>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-emerald-50 p-3">
              <p className="text-xs text-emerald-700">{t('customerIntelligence:recent.last30')}</p>
              <p className="text-lg font-bold text-emerald-900 mt-1"><Rial amount={data.recentComparison.recentGross} /></p>
              <p className="text-xs text-emerald-700 mt-1">
                {t('customerIntelligence:recent.invoices', { count: data.recentComparison.recentInvoiceCount })}
              </p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">{t('customerIntelligence:recent.previous30')}</p>
              <p className="text-lg font-bold text-gray-800 mt-1"><Rial amount={data.recentComparison.previousGross} /></p>
              <p className="text-xs text-gray-500 mt-1">
                {t('customerIntelligence:recent.invoices', { count: data.recentComparison.previousInvoiceCount })}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500 leading-relaxed">
            {data.recentComparison.grossPercentChange == null
              ? t('customerIntelligence:recent.noComparable')
              : data.recentComparison.grossPercentChange > 0
                ? t('customerIntelligence:recent.increase', {
                    percent: Math.abs(data.recentComparison.grossPercentChange).toLocaleString('en-US'),
                  })
                : data.recentComparison.grossPercentChange < 0
                  ? t('customerIntelligence:recent.decrease', {
                      percent: Math.abs(data.recentComparison.grossPercentChange).toLocaleString('en-US'),
                    })
                  : t('customerIntelligence:recent.unchanged')}
          </p>
        </section>
      </div>
      </div>}

      {activeProfileSection === 'products' && <section className="card overflow-hidden" aria-labelledby="top-products-title">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 id="top-products-title" className="text-sm font-bold text-gray-900">
            {t('customerIntelligence:products.title')}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('customerIntelligence:products.subtitle')}</p>
        </div>
        {data.topProducts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th scope="col" className="text-start font-semibold px-4 py-2.5">{t('customerIntelligence:products.product')}</th>
                  <th scope="col" className="text-start font-semibold px-4 py-2.5">{t('customerIntelligence:products.unit')}</th>
                  <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:products.quantity')}</th>
                  <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:products.amount')}</th>
                  <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:products.invoices')}</th>
                  <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:products.lastPurchased')}</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map(product => (
                  <tr key={`${product.productId}:${product.productUnitId}:${product.unitName}`} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!product.productId}
                        title={t('customerIntelligence:products.filter')}
                        onClick={() => product.productId && setFilters(current => ({
                          ...current,
                          productId: product.productId,
                          productUnitId: product.productUnitId,
                        }))}
                        className="font-semibold text-gray-900 hover:text-primary-600 text-start disabled:cursor-default disabled:hover:text-gray-900"
                      >
                        {isRtl ? product.nameAr || product.name : product.name || product.nameAr}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {isRtl ? product.unitNameAr || product.unitName : product.unitName || product.unitNameAr}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums" dir="ltr">{product.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                    <td className="px-4 py-3 text-end font-semibold"><Rial amount={product.grossAmount} /></td>
                    <td className="px-4 py-3 text-end tabular-nums">{product.invoiceCount.toLocaleString('en-US')}</td>
                    <td className="px-4 py-3 text-end text-gray-500">{formatDate(product.lastPurchased, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-gray-400">{t('customerIntelligence:empty.noProducts')}</div>
        )}
      </section>}

      {activeProfileSection === 'overview' && <section className="order-3 card overflow-hidden" aria-labelledby="history-title">
        <div className="px-4 py-2.5 rounded-t-xl bg-[#173d2a] text-white flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 id="history-title" className="text-sm font-bold">
              {t('customerIntelligence:history.title')}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('customerIntelligence:history.subtitle', { count: history?.totalCount ?? 0 })}
            </p>
          </div>
          <label>
            <span className="sr-only">{t('customerIntelligence:filters.activityType')}</span>
              <select
              className="h-8 rounded-lg border border-white/20 bg-white/10 px-2 text-xs text-white"
              value={historyType}
              onChange={event => {
                setHistoryType(event.target.value as CustomerActivityType)
                setHistoryPage(1)
              }}
            >
              <option value="all">{t('customerIntelligence:filters.allActivity')}</option>
              <option value="invoice">{t('customerIntelligence:filters.invoicesOnly')}</option>
              <option value="credit_note">{t('customerIntelligence:filters.creditsOnly')}</option>
            </select>
          </label>
        </div>

        <div aria-live="polite" aria-busy={historyLoading}>
          {historyLoading ? (
            <div className="py-16 flex justify-center"><LoadingSpinner /></div>
          ) : historyError ? (
            <div className="py-12 text-center" role="alert">
              <p className="text-sm text-red-600">{historyError}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => setHistoryRefreshKey(key => key + 1)}>
                {t('customerIntelligence:actions.retry')}
              </Button>
            </div>
          ) : history?.rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th scope="col" className="text-start font-semibold px-4 py-2.5">{t('customerIntelligence:history.date')}</th>
                    <th scope="col" className="text-start font-semibold px-4 py-2.5">{t('customerIntelligence:history.document')}</th>
                    <th scope="col" className="text-start font-semibold px-4 py-2.5">{t('customerIntelligence:history.branch')}</th>
                    <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:history.items')}</th>
                    <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:history.gross')}</th>
                    <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:history.credited')}</th>
                    <th scope="col" className="text-end font-semibold px-4 py-2.5">{t('customerIntelligence:history.net')}</th>
                    <th scope="col" className="text-center font-semibold px-4 py-2.5">{t('customerIntelligence:history.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map(row => (
                    <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(row.createdAt, locale, true)}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/invoices/${row.id}`}
                          className="font-semibold text-primary-600 hover:text-primary-700"
                          aria-label={t('customerIntelligence:history.openDocument', { reference: row.reference })}
                        >
                          {row.reference}
                        </Link>
                        <p className="text-xs text-gray-400 mt-0.5">{t(`customerIntelligence:history.${row.documentType}`)}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{isRtl ? row.branchNameAr || row.branchName : row.branchName || row.branchNameAr}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{row.itemCount}</td>
                      <td className="px-4 py-3 text-end"><Rial amount={row.grossAmount} /></td>
                      <td className="px-4 py-3 text-end text-amber-700"><Rial amount={row.creditedAmount} /></td>
                      <td className={`px-4 py-3 text-end font-semibold ${row.netEffect < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        <Rial amount={row.netEffect} />
                      </td>
                      <td className="px-4 py-3 text-center"><Badge variant="success">{t('customerIntelligence:history.posted')}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-14 text-center">
              <Receipt size={22} className="mx-auto text-gray-300" />
              <p className="text-sm font-medium text-gray-500 mt-3">
                {data.summary.invoiceCount === 0 && data.summary.creditNoteCount === 0
                  ? t('customerIntelligence:empty.noPurchases')
                  : historyType === 'invoice' && data.summary.creditNoteCount > 0
                    ? t('customerIntelligence:empty.onlyCredits')
                    : t('customerIntelligence:empty.noActivity')}
              </p>
              <p className="text-xs text-gray-400 mt-1">{t('customerIntelligence:empty.noActivityHint')}</p>
            </div>
          )}
        </div>

        {!!history?.totalPages && history.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              disabled={historyPage <= 1 || historyLoading}
              onClick={() => setHistoryPage(page => Math.max(1, page - 1))}
            >
              {t('customerIntelligence:actions.previous')}
            </Button>
            <p className="text-xs text-gray-500" aria-live="polite">
              {t('customerIntelligence:history.page', { page: historyPage, pages: history.totalPages })}
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={historyPage >= history.totalPages || historyLoading}
              onClick={() => setHistoryPage(page => page + 1)}
            >
              {t('customerIntelligence:actions.next')}
            </Button>
          </div>
        )}
      </section>}

      {activeProfileSection === 'overview' && <p className="text-xs text-gray-400 leading-relaxed">{t('customerIntelligence:pdf.disclaimer')}</p>}
      </div>

      <CustomerModal
        open={editingCustomer !== null}
        customer={editingCustomer}
        onClose={() => setEditingCustomer(null)}
        onSaved={() => void loadSummary()}
      />
    </div>
  )
}
