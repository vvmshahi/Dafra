import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, Loader2, ReceiptText, RefreshCw, Search, WalletCards, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/localization/useLocale'
import { Button } from '@/components/ui/Button'
import { ContentState } from '@/components/ui/ContentState'
import { FilterPanel, FilterPresetRow, ResponsiveFilterGrid } from '@/components/ui/FilterPanel'
import { Rial } from '@/components/ui/RiyalSymbol'
import { WorkspaceMetric } from '@/components/ui/WorkspaceMetric'
import { WorkspaceTabNav, type WorkspaceTabItem } from '@/components/ui/WorkspaceTabNav'
import { loadCustomerReceivableWorkspace, loadCustomerReceivablesReport } from '@/lib/customers/receivables'
import { formatSaudiDate, formatSaudiDateTime, saudiDatePresetRange, saudiDateStr, type SaudiDatePreset } from '@/lib/utils/date'
import type { Branch } from '@/types'

const PAGE_SIZE = 50
type WorkspaceTab = 'overview' | 'payments'
type QuickRange = SaudiDatePreset | 'custom'
type BalanceAsOfPreset = 'today' | 'yesterday' | 'custom'

type ReportData = {
  summary: { totalReceivables: number; customerCredit: number; customerCount: number; paymentsReceived: number; unappliedCredit: number; overdueReceivables: number }
  balances: Array<{ receivableAccountId: string; name: string; nameAr: string | null; balance: number }>
  branchComparison: Array<{ branchId: string; debits: number; credits: number; balance: number }>
  filters: { ownerConsolidated: boolean }
}

type CustomerRow = {
  id: string
  name: string
  nameAr: string | null
  businessName: string | null
  companyName: string | null
  phone: string | null
  branchId: string | null
  accountId: string
  active: boolean
  balance: number
  lastCreditInvoice: string | null
  lastPayment: string | null
  totalInvoiced: number
  totalPaid: number
}

type PaymentRow = {
  id: string
  customerId: string
  receiptNumber: string
  amount: number
  method: string
  reference: string | null
  receivedAt: string
  branchId: string
  status: string
}

function asNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeReport(value: any): ReportData {
  return {
    summary: {
      totalReceivables: asNumber(value?.summary?.totalReceivables),
      customerCredit: asNumber(value?.summary?.customerCredit),
      customerCount: asNumber(value?.summary?.customerCount),
      paymentsReceived: asNumber(value?.summary?.paymentsReceived),
      unappliedCredit: asNumber(value?.summary?.unappliedCredit),
      overdueReceivables: asNumber(value?.summary?.overdueReceivables),
    },
    balances: (value?.balances ?? []).map((row: any) => ({
      receivableAccountId: String(row.receivableAccountId), name: String(row.name ?? '—'),
      nameAr: row.nameAr ? String(row.nameAr) : null, balance: asNumber(row.balance),
    })),
    branchComparison: (value?.branchComparison ?? []).map((row: any) => ({
      branchId: String(row.branchId), debits: asNumber(row.debits), credits: asNumber(row.credits), balance: asNumber(row.balance),
    })),
    filters: { ownerConsolidated: Boolean(value?.filters?.ownerConsolidated) },
  }
}

function customerLabel(customer: CustomerRow, isRtl: boolean) {
  return isRtl
    ? customer.businessName || customer.companyName || customer.nameAr || customer.name
    : customer.businessName || customer.companyName || customer.name
}

function dateLabel(value: string | null, isRtl: boolean, withTime = false) {
  if (!value) return '—'
  return withTime
    ? formatSaudiDateTime(value, isRtl ? 'ar-SA' : 'en-GB')
    : formatSaudiDate(value, isRtl ? 'ar-SA' : 'en-GB')
}

export default function CustomerReceivablesReportPage() {
  const { t, i18n } = useTranslation('receivables')
  const { profile } = useAuth()
  const { isRtl } = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuick = (searchParams.get('quick') as QuickRange | null) ?? 'this_month'
  const initialAsOfPreset = (searchParams.get('asofPreset') as BalanceAsOfPreset | null) ?? 'today'
  const initialAsOfDate = searchParams.get('asof') ?? (initialAsOfPreset === 'yesterday' ? saudiDatePresetRange('yesterday').end : saudiDateStr())
  const initialDates = searchParams.get('start') && searchParams.get('end')
    ? { start: searchParams.get('start')!, end: searchParams.get('end')! }
    : saudiDatePresetRange(initialQuick === 'custom' ? 'this_month' : initialQuick)
  const [tab, setTab] = useState<WorkspaceTab>(searchParams.get('tab') === 'payments' ? 'payments' : 'overview')
  const [startDate, setStartDate] = useState(initialDates.start)
  const [endDate, setEndDate] = useState(initialDates.end)
  const [quickRange, setQuickRange] = useState<QuickRange>(initialQuick)
  const [balanceAsOfPreset, setBalanceAsOfPreset] = useState<BalanceAsOfPreset>(initialAsOfPreset)
  const [balanceAsOfDate, setBalanceAsOfDate] = useState(initialAsOfDate)
  const [branchId, setBranchId] = useState<string | null>(searchParams.get('branch') || (profile?.role === 'branch' ? profile.branch_id : null))
  const [branches, setBranches] = useState<Branch[]>([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ReportData | null>(null)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('all')
  const [paymentStatus, setPaymentStatus] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canChooseBranch = ['owner', 'admin', 'accountant'].includes(profile?.role ?? '')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim().toLocaleLowerCase()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!profile?.tenant_id) return
    let stale = false
    void supabase.from('branches').select('*').eq('tenant_id', profile.tenant_id).eq('is_active', true).order('name')
      .then(({ data: rows }) => { if (!stale) setBranches((rows ?? []) as unknown as Branch[]) })
    return () => { stale = true }
  }, [profile?.tenant_id])

  useEffect(() => { if (profile?.role === 'branch' && profile.branch_id) setBranchId(profile.branch_id) }, [profile?.branch_id, profile?.role])

  const updateUrl = (patch: Record<string, string | null>, replace = true) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(patch).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    setSearchParams(next, { replace })
  }

  const selectTab = (nextTab: string) => {
    const value: WorkspaceTab = nextTab === 'payments' ? 'payments' : 'overview'
    setTab(value)
    updateUrl({ tab: value }, false)
  }

  const applyQuickRange = (range: Exclude<QuickRange, 'custom'>) => {
    const dates = saudiDatePresetRange(range)
    setStartDate(dates.start)
    setEndDate(dates.end)
    setQuickRange(range)
    setPage(1)
    updateUrl({ quick: range, start: dates.start, end: dates.end }, true)
  }

  const applyBalanceAsOf = (preset: BalanceAsOfPreset) => {
    setBalanceAsOfPreset(preset)
    if (preset === 'today') setBalanceAsOfDate(saudiDateStr())
    if (preset === 'yesterday') setBalanceAsOfDate(saudiDatePresetRange('yesterday').end)
    setPage(1)
  }

  const clearFilters = () => {
    const dates = saudiDatePresetRange('this_month')
    setStartDate(dates.start); setEndDate(dates.end); setQuickRange('this_month')
    setBalanceAsOfPreset('today'); setBalanceAsOfDate(saudiDateStr())
    setSearch(''); setPaymentMethod('all'); setPaymentStatus('all'); setBranchId(profile?.role === 'branch' ? profile.branch_id : null); setPage(1)
  }

  const refresh = async () => {
    if (!startDate || !endDate || startDate > endDate) { setError(t('report.invalidRange')); return }
    setLoading(true)
    setError(null)
    try {
      const report = normalizeReport(await loadCustomerReceivablesReport({ branchId, startDate, endDate, asOfDate: balanceAsOfDate, page, pageSize: PAGE_SIZE }))
      setData(report)
      const accountIds = report.balances.map(row => row.receivableAccountId)
      const customerQuery = accountIds.length
        ? (supabase as any).from('customers').select('id,name,name_ar,business_name,company_name,phone,branch_id,receivable_account_id,is_active,customer_type').in('receivable_account_id', accountIds).eq('customer_type', 'business').eq('is_active', true)
        : Promise.resolve({ data: [], error: null })
      let paymentQuery: any = (supabase as any).from('customer_payment_receipts')
        .select('id,customer_id,receipt_number,amount,method,reference,received_at,branch_id,status')
        .gte('received_at', `${startDate}T00:00:00.000Z`).lte('received_at', `${endDate}T23:59:59.999Z`)
        .order('received_at', { ascending: false }).limit(100)
      if (branchId) paymentQuery = paymentQuery.eq('branch_id', branchId)
      const [{ data: customerRows, error: customerError }, { data: paymentRows, error: paymentError }] = await Promise.all([customerQuery, paymentQuery])
      if (customerError) throw customerError
      if (paymentError) throw paymentError
      const customerIds = (customerRows ?? []).map((row: any) => String(row.id))
      const balanceByAccount = new Map(report.balances.map(row => [row.receivableAccountId, row.balance]))
      const authoritativeWorkspaces = await Promise.all((customerRows ?? []).map((row: any) => loadCustomerReceivableWorkspace({ customerId: String(row.id), branchId: row.branch_id ? String(row.branch_id) : branchId, startDate, endDate, page: 1, pageSize: 1 })))
      const workspaceByCustomer = new Map(authoritativeWorkspaces.map(workspace => [workspace.customer.id, workspace]))
      const paymentsByCustomer = new Map<string, PaymentRow[]>()
      ;(paymentRows ?? []).forEach((row: any) => {
        const payment: PaymentRow = { id: String(row.id), customerId: String(row.customer_id), receiptNumber: String(row.receipt_number ?? '—'), amount: asNumber(row.amount), method: String(row.method ?? 'other'), reference: row.reference ? String(row.reference) : null, receivedAt: String(row.received_at), branchId: String(row.branch_id), status: String(row.status ?? 'completed') }
        const list = paymentsByCustomer.get(payment.customerId) ?? []
        list.push(payment)
        paymentsByCustomer.set(payment.customerId, list)
      })
      setCustomers((customerRows ?? []).map((row: any) => {
        const customerId = String(row.id)
        const workspace = workspaceByCustomer.get(customerId)
        const lastInvoice = workspace?.openInvoices[0]
        const paymentList = paymentsByCustomer.get(customerId) ?? []
        return {
          id: customerId, name: String(row.name ?? '—'), nameAr: row.name_ar ? String(row.name_ar) : null,
          businessName: row.business_name ? String(row.business_name) : null, companyName: row.company_name ? String(row.company_name) : null,
          phone: row.phone ? String(row.phone) : null, branchId: row.branch_id ? String(row.branch_id) : null, accountId: String(row.receivable_account_id),
          active: row.is_active !== false, balance: asNumber(balanceByAccount.get(String(row.receivable_account_id))),
          lastCreditInvoice: lastInvoice?.invoiceNumber ?? null, lastPayment: workspace?.summary.lastPaymentAt ?? paymentList[0]?.receivedAt ?? null,
          totalInvoiced: workspace?.summary.totalInvoiced ?? 0, totalPaid: workspace?.summary.totalCollected ?? 0,
        }
      }))
      setPayments((paymentRows ?? []).map((row: any) => ({ id: String(row.id), customerId: String(row.customer_id), receiptNumber: String(row.receipt_number ?? '—'), amount: asNumber(row.amount), method: String(row.method ?? 'other'), reference: row.reference ? String(row.reference) : null, receivedAt: String(row.received_at), branchId: String(row.branch_id), status: String(row.status ?? 'completed') })))
      updateUrl({ start: startDate, end: endDate, branch: branchId, quick: quickRange === 'custom' ? null : quickRange, asof: balanceAsOfDate, asofPreset: balanceAsOfPreset === 'today' ? null : balanceAsOfPreset }, true)
    } catch (loadError) {
      console.error('Unable to load customer credit workspace', loadError)
      setData(null); setCustomers([]); setPayments([]); setError(t('report.loadFailed'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [balanceAsOfDate, branchId, endDate, page, startDate])

  const branchNames = useMemo(() => new Map(branches.map(branch => [branch.id, isRtl ? branch.name_ar || branch.name : branch.name])), [branches, isRtl])
  const filteredCustomers = useMemo(() => customers.filter(customer => !debouncedSearch || `${customerLabel(customer, isRtl)} ${customer.phone ?? ''}`.toLocaleLowerCase().includes(debouncedSearch)), [customers, debouncedSearch, isRtl])
  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.id, customerLabel(customer, isRtl)])), [customers, isRtl])
  const filteredPayments = useMemo(() => payments.filter(payment => (!debouncedSearch || `${payment.receiptNumber} ${payment.reference ?? ''} ${customerNames.get(payment.customerId) ?? ''}`.toLocaleLowerCase().includes(debouncedSearch)) && (paymentMethod === 'all' || payment.method === paymentMethod) && (paymentStatus === 'all' || payment.status === paymentStatus)), [customerNames, debouncedSearch, paymentMethod, paymentStatus, payments])
  const summary = data?.summary
  const canGoNext = (data?.balances.length ?? 0) === PAGE_SIZE
  const tabItems: WorkspaceTabItem[] = [
    { id: 'overview', icon: BarChart3, label: t('report.workspaceTabs.overview') },
    { id: 'payments', icon: ReceiptText, label: t('report.workspaceTabs.payments') },
  ]
  const quickItems: Array<{ id: Exclude<QuickRange, 'custom'>; label: string }> = [
    { id: 'today', label: t('report.quick.today') }, { id: 'yesterday', label: t('report.quick.yesterday') }, { id: 'last7', label: t('report.quick.last7') },
    { id: 'this_month', label: t('report.quick.thisMonth') }, { id: 'last_month', label: t('report.quick.lastMonth') }, { id: 'this_year', label: t('report.quick.thisYear') },
  ]

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#173d2a] text-emerald-100"><BarChart3 size={19} /></span><div className="min-w-0"><h1 className="truncate text-xl font-bold text-gray-950">{t('report.title')}</h1><p className="mt-0.5 text-xs text-gray-500">{t('report.subtitle')}</p></div></div>
      </header>

      <WorkspaceTabNav items={tabItems} activeId={tab} onSelect={selectTab} label={t('report.workspaceTabs.label')} className="order-1 mx-auto w-fit max-w-full" />

      <FilterPanel id="customer-credit-filters" title={t('report.filtersCompact')} icon={Search} compact className="order-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          {tab === 'overview' && <label className="min-w-[150px] flex-1 space-y-1"><span className="label">{t('report.balanceAsOf')}</span><select className="input h-9" value={balanceAsOfPreset} onChange={event => applyBalanceAsOf(event.target.value as BalanceAsOfPreset)}><option value="today">{t('report.today')}</option><option value="yesterday">{t('report.yesterday')}</option><option value="custom">{t('report.customDate')}</option></select></label>}
          <label className="min-w-[180px] flex-1 space-y-1"><span className="label">{t('report.activityPeriod')}</span><select className="input h-9" value={quickRange} onChange={event => event.target.value === 'custom' ? setQuickRange('custom') : applyQuickRange(event.target.value as Exclude<QuickRange, 'custom'>)}>{quickItems.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}<option value="custom">{t('report.quick.custom')}</option></select></label>
          <label className="min-w-[210px] flex-[1.5] space-y-1"><span className="label">{t('report.search')}</span><span className="relative block"><Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className="input h-9 ps-9" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('report.searchPlaceholder')} /></span></label>
          {tab === 'payments' && <><label className="min-w-[125px] flex-1 space-y-1"><span className="label">{t('report.paymentMethod')}</span><select className="input h-9" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}><option value="all">{t('report.allMethods')}</option>{['cash', 'card', 'bank_transfer', 'other'].map(method => <option value={method} key={method}>{t(`methods.${method}`, { defaultValue: method })}</option>)}</select></label><label className="min-w-[115px] flex-1 space-y-1"><span className="label">{t('report.paymentStatus')}</span><select className="input h-9" value={paymentStatus} onChange={event => setPaymentStatus(event.target.value)}><option value="all">{t('report.allStatuses')}</option><option value="completed">{t('report.completed')}</option><option value="reversed">{t('report.reversed')}</option></select></label></>}
          {canChooseBranch && <label className="min-w-[145px] flex-1 space-y-1"><span className="label">{t('report.branch')}</span><select className="input h-9" value={branchId ?? ''} onChange={event => { setBranchId(event.target.value || null); setPage(1) }}><option value="">{t('report.allBranches')}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{isRtl ? branch.name_ar || branch.name : branch.name}</option>)}</select></label>}
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9"><X size={14} />{t('report.clear')}</Button><Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading} className="h-9">{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{t('report.refresh')}</Button>
        </div>
        {(balanceAsOfPreset === 'custom' || quickRange === 'custom') && <ResponsiveFilterGrid columns={4} className="pt-1">
          {tab === 'overview' && balanceAsOfPreset === 'custom' && <label className="space-y-1"><span className="label">{t('report.asOfDate')}</span><input type="date" className="input h-9" value={balanceAsOfDate} max={saudiDateStr()} onChange={event => { setBalanceAsOfDate(event.target.value); setPage(1) }} /></label>}
          {quickRange === 'custom' && <label className="space-y-1"><span className="label">{t('report.from')}</span><input type="date" className="input h-9" value={startDate} max={endDate} onChange={event => { setStartDate(event.target.value); setQuickRange('custom'); setPage(1) }} /></label>}
          {quickRange === 'custom' && <label className="space-y-1"><span className="label">{t('report.to')}</span><input type="date" className="input h-9" value={endDate} min={startDate} onChange={event => { setEndDate(event.target.value); setQuickRange('custom'); setPage(1) }} /></label>}
        </ResponsiveFilterGrid>}
      </FilterPanel>

      {error && <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert"><span>{error}</span><Button size="sm" variant="secondary" onClick={() => void refresh()}>{t('report.retry')}</Button></div>}

      {tab === 'overview' && <section id="workspace-panel-overview" role="tabpanel" className="order-2 space-y-4" aria-label={t('report.workspaceTabs.overview')}>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('report.summary')}>
          <WorkspaceMetric label={t('report.totalReceivables')} value={<Rial amount={summary?.totalReceivables ?? 0} />} tone="debt" detail={t('report.balanceDefinition')} />
          <WorkspaceMetric label={t('report.paymentsReceived')} value={<Rial amount={summary?.paymentsReceived ?? 0} />} tone="green" />
          <WorkspaceMetric label={t('report.customerCredit')} value={<Rial amount={summary?.customerCredit ?? 0} />} tone="teal" />
          <WorkspaceMetric label={t('report.customerCount')} value={(summary?.customerCount ?? 0).toLocaleString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US')} tone="slate" />
        </section>
        <section className="hidden card overflow-hidden" aria-labelledby="ar-branches-heading">
          <div className="border-b border-gray-100 px-4 py-3"><h2 id="ar-branches-heading" className="text-sm font-bold text-gray-950">{t('report.branchComparison')}</h2><p className="mt-0.5 text-xs text-gray-500">{data?.filters.ownerConsolidated ? t('report.consolidated') : t('report.branchScoped')}</p></div>
          {data?.branchComparison.length ? <div className="divide-y divide-gray-100">{data.branchComparison.map(row => { const max = Math.max(...data.branchComparison.map(item => Math.abs(item.balance)), 1); return <div key={row.branchId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_120px] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-800">{branchNames.get(row.branchId) ?? row.branchId}</p><div className="mt-1 h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full bg-[#1B6B3A]" style={{ width: `${Math.max(4, Math.abs(row.balance) / max * 100)}%` }} /></div></div><span className="text-xs text-gray-500 sm:text-end">{t('report.debits')} <Rial amount={row.debits} /> · {t('report.credits')} <Rial amount={row.credits} /></span><span className="text-sm font-bold tabular-nums text-gray-900 sm:text-end"><Rial amount={row.balance} /></span></div> })}</div> : <ContentState kind="empty" title={t('report.noBranchActivity')} />}
        </section>
      </section>}

      {tab === 'overview' && <section id="workspace-panel-customers" role="tabpanel" className="order-4 card overflow-hidden" aria-labelledby="credit-customers-heading">
        <div className="flex items-center justify-between gap-3 rounded-t-xl bg-[#173d2a] px-4 py-2.5 text-white"><div><h2 id="credit-customers-heading" className="text-sm font-bold">{t('report.customersTab.title')}</h2><p className="text-xs text-emerald-100/75">{filteredCustomers.length} · {data?.filters.ownerConsolidated ? t('report.consolidated') : t('report.branchScoped')}</p></div><WalletCards size={18} className="text-emerald-100" /></div>
        {loading ? <ContentState kind="loading" /> : filteredCustomers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-xs"><thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.customer')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.branch')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.lastCreditInvoice')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.lastPayment')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.totalInvoiced')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.totalPaid')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.balance')}</th><th className="px-4 py-2.5 text-center font-bold">{t('report.customersTab.status')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.actions')}</th></tr></thead><tbody>{filteredCustomers.map(customer => <tr key={customer.id} className="border-t border-gray-100 hover:bg-gray-50/70"><td className="px-4 py-3"><Link to={`/customers/${customer.id}?section=credit`} className="font-semibold text-primary-700 hover:text-primary-900">{customerLabel(customer, isRtl)}</Link>{customer.phone && <p className="mt-0.5 text-[11px] text-gray-500" dir="ltr">{customer.phone}</p>}</td><td className="px-4 py-3 text-gray-600">{customer.branchId ? branchNames.get(customer.branchId) ?? customer.branchId : '—'}</td><td className="px-4 py-3 text-gray-600">{customer.lastCreditInvoice ?? '—'}</td><td className="px-4 py-3 text-gray-600">{dateLabel(customer.lastPayment, isRtl)}</td><td className="px-4 py-3 text-end font-semibold tabular-nums"><Rial amount={customer.totalInvoiced} /></td><td className="px-4 py-3 text-end font-semibold tabular-nums text-emerald-700"><Rial amount={customer.totalPaid} /></td><td className={`px-4 py-3 text-end font-semibold tabular-nums ${customer.balance > 0 ? 'text-amber-800' : 'text-emerald-700'}`}><Rial amount={Math.abs(customer.balance)} /></td><td className="px-4 py-3 text-center"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${customer.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{customer.active ? t('report.customersTab.active') : t('report.customersTab.inactive')}</span></td><td className="px-4 py-3 text-end"><details className="relative inline-block text-start"><summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 font-semibold text-gray-700 hover:bg-gray-50" aria-label={t('report.customersTab.actions')}><ChevronDown size={13} />{t('report.customersTab.actions')}</summary><div className="absolute end-0 z-10 mt-1 w-40 rounded-lg border border-gray-200 bg-white p-1 text-start shadow-lg"><Link className="block rounded-md px-2.5 py-2 text-gray-700 hover:bg-gray-50" to={`/customers/${customer.id}?section=credit`}>{t('report.openAccount')}</Link><Link className="block rounded-md px-2.5 py-2 text-gray-700 hover:bg-gray-50" to={`/customers/${customer.id}?section=credit&payment=open`}>{t('report.receivePayment')}</Link><Link className="block rounded-md px-2.5 py-2 text-gray-700 hover:bg-gray-50" to={`/customers/${customer.id}?section=credit&statement=open`}>{t('report.statementAction')}</Link></div></details></td></tr>)}</tbody></table></div> : <ContentState kind="empty" title={t('report.empty')} description={debouncedSearch ? t('report.searchNoMatch') : undefined} />}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3"><Button size="sm" variant="secondary" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} />{t('report.previous')}</Button><Button size="sm" variant="secondary" disabled={loading || !canGoNext} onClick={() => setPage(value => value + 1)}>{t('report.next')}<ChevronRight size={14} /></Button></div>
      </section>}

      {tab === 'payments' && <section id="workspace-panel-payments" role="tabpanel" className="order-4 card overflow-hidden" aria-labelledby="credit-payments-heading">
        <div className="flex items-center justify-between gap-3 rounded-t-xl bg-[#173d2a] px-4 py-2.5 text-white"><div><h2 id="credit-payments-heading" className="text-sm font-bold">{t('report.paymentsTab.title')}</h2><p className="text-xs text-emerald-100/75">{t('report.paymentsTab.subtitle')}</p></div><ReceiptText size={18} className="text-emerald-100" /></div>
        {loading ? <ContentState kind="loading" /> : filteredPayments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-xs"><thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.receipt')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.customer')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.branch')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.method')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.reference')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.paymentsTab.amount')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.date')}</th><th className="px-4 py-2.5 text-center font-bold">{t('report.paymentsTab.status')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.actions')}</th></tr></thead><tbody>{filteredPayments.map(payment => <tr key={payment.id} className="border-t border-gray-100 hover:bg-gray-50/70"><td className="px-4 py-3 font-semibold text-gray-800">{payment.receiptNumber}</td><td className="px-4 py-3 text-gray-700">{customerNames.get(payment.customerId) ?? '—'}</td><td className="px-4 py-3 text-gray-600">{branchNames.get(payment.branchId) ?? payment.branchId}</td><td className="px-4 py-3 text-gray-600">{t(`methods.${payment.method}`, { defaultValue: payment.method })}</td><td className="px-4 py-3 text-gray-600">{payment.reference ?? '—'}</td><td className="px-4 py-3 text-end font-semibold tabular-nums"><Rial amount={payment.amount} /></td><td className="px-4 py-3 whitespace-nowrap text-gray-600">{dateLabel(payment.receivedAt, isRtl, true)}</td><td className="px-4 py-3 text-center"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${payment.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{payment.status}</span></td><td className="px-4 py-3 text-end"><Link to={`/print/payment-receipt/${payment.id}`} className="font-semibold text-primary-700 hover:text-primary-900">{t('report.paymentsTab.openReceipt')}</Link></td></tr>)}</tbody></table></div> : <ContentState kind="empty" title={t('report.paymentsTab.empty')} />}
      </section>}

    </div>
  )
}
