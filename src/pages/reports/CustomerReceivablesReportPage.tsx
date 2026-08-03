import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BarChart3, ChevronLeft, ChevronRight, FileText, Loader2, ReceiptText, RefreshCw, Search, WalletCards } from 'lucide-react'
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
import { loadCustomerReceivableWorkspace, loadCustomerReceivablesReport, type CustomerReceivableWorkspace } from '@/lib/customers/receivables'
import { downloadCustomerStatementXlsx } from '@/lib/customers/receivablesXlsx'
import { formatSaudiDate, formatSaudiDateTime, saudiDatePresetRange, type SaudiDatePreset } from '@/lib/utils/date'
import type { Branch } from '@/types'

const PAGE_SIZE = 50
type WorkspaceTab = 'overview' | 'customers' | 'payments' | 'statements'
type QuickRange = SaudiDatePreset | 'custom'

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

type InvoiceRow = { invoiceNumber: string; totalAmount: number }

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

function StatementPreview({
  customer,
  branchId,
  startDate,
  endDate,
  branchLabel,
  companyName,
  isRtl,
  t,
}: {
  customer: CustomerRow
  branchId: string | null
  startDate: string
  endDate: string
  branchLabel: string
  companyName: string | null
  isRtl: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const [workspace, setWorkspace] = useState<CustomerReceivableWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const statementPath = `/print/customer-statement/${customer.id}?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}${branchId ? `&branch=${encodeURIComponent(branchId)}` : ''}`

  const load = () => {
    setLoading(true)
    setError(false)
    void loadCustomerReceivableWorkspace({ customerId: customer.id, branchId, startDate, endDate, page: 1, pageSize: 200 })
      .then(setWorkspace)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(load, [customer.id, branchId, endDate, startDate])

  if (loading) return <ContentState kind="loading" title={t('report.statementsTab.loading')} />
  if (error || !workspace) return <ContentState kind="error" title={t('report.statementsTab.error')} action={<Button size="sm" variant="secondary" onClick={load}><RefreshCw size={14} />{t('report.refresh')}</Button>} />

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white" aria-labelledby="statement-preview-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h3 id="statement-preview-title" className="text-sm font-bold text-gray-950">{t('report.statementsTab.preview')}</h3>
          <p className="mt-0.5 text-xs text-gray-500" dir="auto">{customerLabel(customer, isRtl)} · {branchLabel} · {startDate} – {endDate}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={statementPath} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"><FileText size={13} />{t('report.statementsTab.print')}</a>
          <Button size="sm" variant="secondary" onClick={() => downloadCustomerStatementXlsx({ customerName: workspace.customer.name, companyName, branchLabel, locale: isRtl ? 'ar' : 'en', workspace })}><FileText size={13} />{t('statement.exportXlsx')}</Button>
        </div>
      </div>
      <div className="grid gap-2 border-b border-gray-100 bg-gray-50/70 p-3 sm:grid-cols-4">
        <WorkspaceMetric label={t('metrics.balance')} value={<Rial amount={workspace.summary.balance} />} tone={workspace.summary.balance > 0 ? 'amber' : 'green'} />
        <WorkspaceMetric label={t('metrics.totalInvoiced')} value={<Rial amount={workspace.summary.totalInvoiced} />} tone="slate" />
        <WorkspaceMetric label={t('metrics.totalCollected')} value={<Rial amount={workspace.summary.totalCollected} />} tone="green" />
        <WorkspaceMetric label={t('metrics.unappliedCredit')} value={<Rial amount={workspace.summary.unappliedReceipts} />} tone="teal" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="bg-white text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-2 text-start font-bold">{t('statement.entry')}</th><th className="px-4 py-2 text-start font-bold">{t('statement.branch')}</th><th className="px-4 py-2 text-start font-bold">{t('statement.reference')}</th><th className="px-4 py-2 text-end font-bold">{t('statement.debit')}</th><th className="px-4 py-2 text-end font-bold">{t('statement.credit')}</th><th className="px-4 py-2 text-end font-bold">{t('statement.balanceColumn')}</th></tr></thead>
          <tbody>{workspace.ledger.length ? workspace.ledger.map(row => <tr key={row.id} className="border-t border-gray-100"><td className="px-4 py-2.5"><p className="font-semibold text-gray-800">{row.description}</p><p className="mt-0.5 text-[11px] text-gray-500">{dateLabel(row.effectiveAt, isRtl, true)}</p></td><td className="px-4 py-2.5 text-gray-600">{row.branchId || branchLabel}</td><td className="px-4 py-2.5 text-gray-500">{row.sourceKind} · {row.sourceId.slice(0, 8)}</td><td className="px-4 py-2.5 text-end tabular-nums">{row.debit ? <Rial amount={row.debit} /> : '—'}</td><td className="px-4 py-2.5 text-end tabular-nums text-emerald-700">{row.credit ? <Rial amount={row.credit} /> : '—'}</td><td className="px-4 py-2.5 text-end font-bold tabular-nums"><Rial amount={row.runningBalance} /></td></tr>) : <tr><td colSpan={6}><ContentState kind="empty" title={t('report.statementsTab.emptyLedger')} /></td></tr>}</tbody>
        </table>
      </div>
    </section>
  )
}

export default function CustomerReceivablesReportPage() {
  const { t, i18n } = useTranslation('receivables')
  const { profile, tenant } = useAuth()
  const { isRtl } = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuick = (searchParams.get('quick') as QuickRange | null) ?? 'this_month'
  const initialDates = searchParams.get('start') && searchParams.get('end')
    ? { start: searchParams.get('start')!, end: searchParams.get('end')! }
    : saudiDatePresetRange(initialQuick === 'custom' ? 'this_month' : initialQuick)
  const [tab, setTab] = useState<WorkspaceTab>(['overview', 'customers', 'payments', 'statements'].includes(searchParams.get('tab') ?? '') ? searchParams.get('tab') as WorkspaceTab : 'overview')
  const [startDate, setStartDate] = useState(initialDates.start)
  const [endDate, setEndDate] = useState(initialDates.end)
  const [quickRange, setQuickRange] = useState<QuickRange>(initialQuick)
  const [branchId, setBranchId] = useState<string | null>(searchParams.get('branch') || (profile?.role === 'branch' ? profile.branch_id : null))
  const [branches, setBranches] = useState<Branch[]>([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ReportData | null>(null)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
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
    const value = nextTab as WorkspaceTab
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

  const refresh = async () => {
    if (!startDate || !endDate || startDate > endDate) { setError(t('report.invalidRange')); return }
    setLoading(true)
    setError(null)
    try {
      const report = normalizeReport(await loadCustomerReceivablesReport({ branchId, startDate, endDate, page, pageSize: PAGE_SIZE }))
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
      let invoiceQuery: any = customerIds.length
        ? (supabase as any).from('invoices').select('customer_id,invoice_number,total_amount').in('customer_id', customerIds).gte('invoice_date', startDate).lte('invoice_date', endDate).neq('status', 'cancelled').order('invoice_date', { ascending: false }).limit(500)
        : Promise.resolve({ data: [], error: null })
      if (branchId) invoiceQuery = invoiceQuery.eq('branch_id', branchId)
      const { data: invoiceRows, error: invoiceError } = await invoiceQuery
      if (invoiceError) throw invoiceError
      const balanceByAccount = new Map(report.balances.map(row => [row.receivableAccountId, row.balance]))
      const invoicesByCustomer = new Map<string, InvoiceRow[]>()
      ;(invoiceRows ?? []).forEach((row: any) => {
        const list = invoicesByCustomer.get(String(row.customer_id)) ?? []
        list.push({ invoiceNumber: String(row.invoice_number ?? '—'), totalAmount: asNumber(row.total_amount) })
        invoicesByCustomer.set(String(row.customer_id), list)
      })
      const paymentsByCustomer = new Map<string, PaymentRow[]>()
      ;(paymentRows ?? []).forEach((row: any) => {
        const payment: PaymentRow = { id: String(row.id), customerId: String(row.customer_id), receiptNumber: String(row.receipt_number ?? '—'), amount: asNumber(row.amount), method: String(row.method ?? 'other'), reference: row.reference ? String(row.reference) : null, receivedAt: String(row.received_at), branchId: String(row.branch_id), status: String(row.status ?? 'completed') }
        const list = paymentsByCustomer.get(payment.customerId) ?? []
        list.push(payment)
        paymentsByCustomer.set(payment.customerId, list)
      })
      setCustomers((customerRows ?? []).map((row: any) => {
        const customerId = String(row.id)
        const invoiceList = invoicesByCustomer.get(customerId) ?? []
        const paymentList = paymentsByCustomer.get(customerId) ?? []
        return {
          id: customerId, name: String(row.name ?? '—'), nameAr: row.name_ar ? String(row.name_ar) : null,
          businessName: row.business_name ? String(row.business_name) : null, companyName: row.company_name ? String(row.company_name) : null,
          phone: row.phone ? String(row.phone) : null, branchId: row.branch_id ? String(row.branch_id) : null, accountId: String(row.receivable_account_id),
          active: row.is_active !== false, balance: asNumber(balanceByAccount.get(String(row.receivable_account_id))),
          lastCreditInvoice: invoiceList[0]?.invoiceNumber ?? null, lastPayment: paymentList[0]?.receivedAt ?? null,
          totalInvoiced: invoiceList.reduce((sum, invoice) => sum + invoice.totalAmount, 0), totalPaid: paymentList.reduce((sum, payment) => sum + payment.amount, 0),
        }
      }))
      setPayments((paymentRows ?? []).map((row: any) => ({ id: String(row.id), customerId: String(row.customer_id), receiptNumber: String(row.receipt_number ?? '—'), amount: asNumber(row.amount), method: String(row.method ?? 'other'), reference: row.reference ? String(row.reference) : null, receivedAt: String(row.received_at), branchId: String(row.branch_id), status: String(row.status ?? 'completed') })))
      updateUrl({ start: startDate, end: endDate, branch: branchId, quick: quickRange === 'custom' ? null : quickRange }, true)
    } catch (loadError) {
      console.error('Unable to load customer credit workspace', loadError)
      setData(null); setCustomers([]); setPayments([]); setError(t('report.loadFailed'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [branchId, endDate, page, startDate])

  const branchNames = useMemo(() => new Map(branches.map(branch => [branch.id, isRtl ? branch.name_ar || branch.name : branch.name])), [branches, isRtl])
  const filteredCustomers = useMemo(() => customers.filter(customer => !debouncedSearch || `${customerLabel(customer, isRtl)} ${customer.phone ?? ''}`.toLocaleLowerCase().includes(debouncedSearch)), [customers, debouncedSearch, isRtl])
  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.id, customerLabel(customer, isRtl)])), [customers, isRtl])
  const filteredPayments = useMemo(() => payments.filter(payment => !debouncedSearch || `${payment.receiptNumber} ${payment.reference ?? ''} ${customerNames.get(payment.customerId) ?? ''}`.toLocaleLowerCase().includes(debouncedSearch)), [customerNames, debouncedSearch, payments])
  const summary = data?.summary
  const canGoNext = (data?.balances.length ?? 0) === PAGE_SIZE
  const selectedStatementId = searchParams.get('statement') ?? filteredCustomers[0]?.id ?? null
  const selectedStatement = customers.find(customer => customer.id === selectedStatementId) ?? null
  const tabItems: WorkspaceTabItem[] = [
    { id: 'overview', icon: BarChart3, label: t('report.workspaceTabs.overview') },
    { id: 'customers', icon: WalletCards, label: t('report.workspaceTabs.customers') },
    { id: 'payments', icon: ReceiptText, label: t('report.workspaceTabs.payments') },
    { id: 'statements', icon: FileText, label: t('report.workspaceTabs.statements') },
  ]
  const quickItems: Array<{ id: Exclude<QuickRange, 'custom'>; label: string }> = [
    { id: 'today', label: t('report.quick.today') }, { id: 'yesterday', label: t('report.quick.yesterday') }, { id: 'last7', label: t('report.quick.last7') },
    { id: 'this_month', label: t('report.quick.thisMonth') }, { id: 'last_month', label: t('report.quick.lastMonth') }, { id: 'this_year', label: t('report.quick.thisYear') },
  ]
  const branchLabel = selectedStatement?.branchId ? branchNames.get(selectedStatement.branchId) ?? selectedStatement.branchId : data?.filters.ownerConsolidated ? t('report.consolidated') : t('report.branchScoped')

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#173d2a] text-emerald-100"><BarChart3 size={19} /></span><div className="min-w-0"><h1 className="truncate text-xl font-bold text-gray-950">{t('report.title')}</h1><p className="mt-0.5 text-xs text-gray-500">{t('report.subtitle')}</p></div></div>
        <Link to="/reports" className="text-sm font-semibold text-primary-700 hover:text-primary-800">{t('report.back')}</Link>
      </header>

      <WorkspaceTabNav items={tabItems} activeId={tab} onSelect={selectTab} label={t('report.workspaceTabs.label')} />

      <FilterPanel id="customer-credit-filters" title={t('report.filters')} icon={Search} className="space-y-3">
        <FilterPresetRow label={t('report.quick.label')}>
          {quickItems.map(item => <button key={item.id} type="button" aria-pressed={quickRange === item.id} onClick={() => applyQuickRange(item.id)} className={`min-h-8 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${quickRange === item.id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{item.label}</button>)}
          <button type="button" aria-pressed={quickRange === 'custom'} onClick={() => setQuickRange('custom')} className={`min-h-8 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${quickRange === 'custom' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{t('report.quick.custom')}</button>
        </FilterPresetRow>
        <ResponsiveFilterGrid columns={4}>
          <label className="space-y-1"><span className="label">{t('report.from')}</span><input type="date" className="input" value={startDate} max={endDate} onChange={event => { setStartDate(event.target.value); setQuickRange('custom'); setPage(1) }} /></label>
          <label className="space-y-1"><span className="label">{t('report.to')}</span><input type="date" className="input" value={endDate} min={startDate} onChange={event => { setEndDate(event.target.value); setQuickRange('custom'); setPage(1) }} /></label>
          {canChooseBranch && <label className="space-y-1"><span className="label">{t('report.branch')}</span><select className="input" value={branchId ?? ''} onChange={event => { setBranchId(event.target.value || null); setPage(1) }}><option value="">{t('report.allBranches')}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{isRtl ? branch.name_ar || branch.name : branch.name}</option>)}</select></label>}
          <label className="space-y-1"><span className="label">{t('report.search')}</span><span className="relative block"><Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className="input ps-9" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('report.searchPlaceholder')} /></span></label>
        </ResponsiveFilterGrid>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-gray-500">{startDate} – {endDate}</span><Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{t('report.refresh')}</Button></div>
      </FilterPanel>

      {error && <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert"><span>{error}</span><Button size="sm" variant="secondary" onClick={() => void refresh()}>{t('report.retry')}</Button></div>}

      {tab === 'overview' && <section id="workspace-panel-overview" role="tabpanel" className="space-y-4" aria-label={t('report.workspaceTabs.overview')}>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label={t('report.summary')}>
          <WorkspaceMetric label={t('report.totalReceivables')} value={<Rial amount={summary?.totalReceivables ?? 0} />} tone="amber" detail={t('report.balanceDefinition')} />
          <WorkspaceMetric label={t('report.customerCredit')} value={<Rial amount={summary?.customerCredit ?? 0} />} tone="green" />
          <WorkspaceMetric label={t('report.overdue')} value={<Rial amount={summary?.overdueReceivables ?? 0} />} tone={(summary?.overdueReceivables ?? 0) > 0 ? 'amber' : 'slate'} />
          <WorkspaceMetric label={t('report.paymentsReceived')} value={<Rial amount={summary?.paymentsReceived ?? 0} />} tone="teal" />
          <WorkspaceMetric label={t('report.unappliedCredit')} value={<Rial amount={summary?.unappliedCredit ?? 0} />} tone="green" />
          <WorkspaceMetric label={t('report.customerCount')} value={(summary?.customerCount ?? 0).toLocaleString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US')} tone="slate" />
        </section>
        <section className="card overflow-hidden" aria-labelledby="ar-branches-heading">
          <div className="border-b border-gray-100 px-4 py-3"><h2 id="ar-branches-heading" className="text-sm font-bold text-gray-950">{t('report.branchComparison')}</h2><p className="mt-0.5 text-xs text-gray-500">{data?.filters.ownerConsolidated ? t('report.consolidated') : t('report.branchScoped')}</p></div>
          {data?.branchComparison.length ? <div className="divide-y divide-gray-100">{data.branchComparison.map(row => { const max = Math.max(...data.branchComparison.map(item => Math.abs(item.balance)), 1); return <div key={row.branchId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_120px] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-800">{branchNames.get(row.branchId) ?? row.branchId}</p><div className="mt-1 h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full bg-[#1B6B3A]" style={{ width: `${Math.max(4, Math.abs(row.balance) / max * 100)}%` }} /></div></div><span className="text-xs text-gray-500 sm:text-end">{t('report.debits')} <Rial amount={row.debits} /> · {t('report.credits')} <Rial amount={row.credits} /></span><span className="text-sm font-bold tabular-nums text-gray-900 sm:text-end"><Rial amount={row.balance} /></span></div> })}</div> : <ContentState kind="empty" title={t('report.noBranchActivity')} />}
        </section>
      </section>}

      {tab === 'customers' && <section id="workspace-panel-customers" role="tabpanel" className="card overflow-hidden" aria-labelledby="credit-customers-heading">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3"><div><h2 id="credit-customers-heading" className="text-sm font-bold text-gray-950">{t('report.customersTab.title')}</h2><p className="text-xs text-gray-500">{filteredCustomers.length} · {data?.filters.ownerConsolidated ? t('report.consolidated') : t('report.branchScoped')}</p></div><WalletCards size={18} className="text-gray-400" /></div>
        {loading ? <ContentState kind="loading" /> : filteredCustomers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-xs"><thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.customer')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.phone')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.branch')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.lastCreditInvoice')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.lastPayment')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.totalInvoiced')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.totalPaid')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.balance')}</th><th className="px-4 py-2.5 text-center font-bold">{t('report.customersTab.status')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.actions')}</th></tr></thead><tbody>{filteredCustomers.map(customer => <tr key={customer.id} className="border-t border-gray-100 hover:bg-gray-50/70"><td className="px-4 py-3"><Link to={`/customers/${customer.id}`} className="font-semibold text-primary-700 hover:text-primary-900">{customerLabel(customer, isRtl)}</Link></td><td className="px-4 py-3 text-gray-600" dir="ltr">{customer.phone ?? '—'}</td><td className="px-4 py-3 text-gray-600">{customer.branchId ? branchNames.get(customer.branchId) ?? customer.branchId : '—'}</td><td className="px-4 py-3 text-gray-600">{customer.lastCreditInvoice ?? '—'}</td><td className="px-4 py-3 text-gray-600">{dateLabel(customer.lastPayment, isRtl)}</td><td className="px-4 py-3 text-end font-semibold tabular-nums"><Rial amount={customer.totalInvoiced} /></td><td className="px-4 py-3 text-end font-semibold tabular-nums text-emerald-700"><Rial amount={customer.totalPaid} /></td><td className={`px-4 py-3 text-end font-semibold tabular-nums ${customer.balance > 0 ? 'text-amber-800' : 'text-emerald-700'}`}><Rial amount={Math.abs(customer.balance)} /></td><td className="px-4 py-3 text-center"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${customer.active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{customer.active ? t('report.customersTab.active') : t('report.customersTab.inactive')}</span></td><td className="px-4 py-3 text-end"><Link to={`/print/customer-statement/${customer.id}?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}${customer.branchId ? `&branch=${encodeURIComponent(customer.branchId)}` : ''}`} className="font-semibold text-primary-700 hover:text-primary-900">{t('report.customersTab.statement')}</Link></td></tr>)}</tbody></table></div> : <ContentState kind="empty" title={t('report.empty')} description={debouncedSearch ? t('report.searchNoMatch') : undefined} />}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3"><Button size="sm" variant="secondary" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} />{t('report.previous')}</Button><Button size="sm" variant="secondary" disabled={loading || !canGoNext} onClick={() => setPage(value => value + 1)}>{t('report.next')}<ChevronRight size={14} /></Button></div>
      </section>}

      {tab === 'payments' && <section id="workspace-panel-payments" role="tabpanel" className="card overflow-hidden" aria-labelledby="credit-payments-heading">
        <div className="border-b border-gray-100 px-4 py-3"><h2 id="credit-payments-heading" className="text-sm font-bold text-gray-950">{t('report.paymentsTab.title')}</h2><p className="text-xs text-gray-500">{t('report.paymentsTab.subtitle')}</p></div>
        {loading ? <ContentState kind="loading" /> : filteredPayments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-xs"><thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.receipt')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.customersTab.customer')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.branch')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.method')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.reference')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.paymentsTab.amount')}</th><th className="px-4 py-2.5 text-start font-bold">{t('report.paymentsTab.date')}</th><th className="px-4 py-2.5 text-center font-bold">{t('report.paymentsTab.status')}</th><th className="px-4 py-2.5 text-end font-bold">{t('report.customersTab.actions')}</th></tr></thead><tbody>{filteredPayments.map(payment => <tr key={payment.id} className="border-t border-gray-100 hover:bg-gray-50/70"><td className="px-4 py-3 font-semibold text-gray-800">{payment.receiptNumber}</td><td className="px-4 py-3 text-gray-700">{customerNames.get(payment.customerId) ?? '—'}</td><td className="px-4 py-3 text-gray-600">{branchNames.get(payment.branchId) ?? payment.branchId}</td><td className="px-4 py-3 text-gray-600">{t(`methods.${payment.method}`, { defaultValue: payment.method })}</td><td className="px-4 py-3 text-gray-600">{payment.reference ?? '—'}</td><td className="px-4 py-3 text-end font-semibold tabular-nums"><Rial amount={payment.amount} /></td><td className="px-4 py-3 whitespace-nowrap text-gray-600">{dateLabel(payment.receivedAt, isRtl, true)}</td><td className="px-4 py-3 text-center"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${payment.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{payment.status}</span></td><td className="px-4 py-3 text-end"><Link to={`/print/payment-receipt/${payment.id}`} className="font-semibold text-primary-700 hover:text-primary-900">{t('report.paymentsTab.openReceipt')}</Link></td></tr>)}</tbody></table></div> : <ContentState kind="empty" title={t('report.paymentsTab.empty')} />}
      </section>}

      {tab === 'statements' && <section id="workspace-panel-statements" role="tabpanel" aria-labelledby="credit-statements-heading">
        <div className="card overflow-hidden"><div className="border-b border-gray-100 px-4 py-3"><h2 id="credit-statements-heading" className="text-sm font-bold text-gray-950">{t('report.statementsTab.title')}</h2><p className="text-xs text-gray-500">{t('report.statementsTab.subtitle')}</p></div>{loading ? <ContentState kind="loading" /> : filteredCustomers.length ? <div className="grid divide-y divide-gray-100 lg:grid-cols-[minmax(260px,0.42fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0"><div className="max-h-[480px] overflow-y-auto">{filteredCustomers.map(customer => <button key={customer.id} type="button" onClick={() => updateUrl({ statement: customer.id }, false)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-gray-50 ${selectedStatementId === customer.id ? 'bg-[#f5f8f6]' : ''}`}><span className="min-w-0"><span className="block truncate text-sm font-semibold text-gray-900">{customerLabel(customer, isRtl)}</span><span className="mt-0.5 block truncate text-xs text-gray-500">{customer.branchId ? branchNames.get(customer.branchId) ?? customer.branchId : t('report.consolidated')}</span></span><span className="shrink-0 text-sm font-bold tabular-nums text-amber-800"><Rial amount={Math.abs(customer.balance)} /></span></button>)}</div><div className="min-w-0 p-3">{selectedStatement && <StatementPreview customer={selectedStatement} branchId={selectedStatement.branchId ?? branchId} startDate={startDate} endDate={endDate} branchLabel={branchLabel} companyName={tenant?.name ?? null} isRtl={isRtl} t={t} />}</div></div> : <ContentState kind="empty" title={t('report.statementsTab.empty')} />}</div>
      </section>}
    </div>
  )
}
