import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ChevronLeft, ChevronRight, FileText, Loader2, ReceiptText, RefreshCw, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/localization/useLocale'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { loadCustomerReceivablesReport } from '@/lib/customers/receivables'
import type { Branch } from '@/types'

const PAGE_SIZE = 50
type WorkspaceTab = 'overview' | 'customers' | 'payments' | 'statements'

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
  receivedAt: string
  branchId: string
  status: string
}

type InvoiceRow = {
  id: string
  customerId: string
  invoiceNumber: string
  totalAmount: number
  invoiceDate: string
  status: string
}

function isoDate(offsetDays = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return value.toISOString().slice(0, 10)
}

function asNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatShortDate(value: string | null, isRtl: boolean) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(isRtl ? 'ar-SA-u-nu-latn' : 'en-SA')
}

function normalizeReport(value: any): ReportData {
  return {
    summary: {
      totalReceivables: asNumber(value?.summary?.totalReceivables), customerCredit: asNumber(value?.summary?.customerCredit),
      customerCount: asNumber(value?.summary?.customerCount), paymentsReceived: asNumber(value?.summary?.paymentsReceived),
      unappliedCredit: asNumber(value?.summary?.unappliedCredit), overdueReceivables: asNumber(value?.summary?.overdueReceivables),
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

function Metric({ label, value, tone = 'slate' }: { label: string; value: React.ReactNode; tone?: 'slate' | 'amber' | 'emerald' }) {
  const classes = tone === 'amber' ? 'border-amber-100 bg-amber-50 text-amber-950' : tone === 'emerald' ? 'border-emerald-100 bg-emerald-50 text-emerald-950' : 'border-slate-100 bg-slate-50 text-slate-950'
  return <div className={`rounded-2xl border p-4 ${classes}`}><p className="text-xs font-semibold text-current/65">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>
}

export default function CustomerReceivablesReportPage() {
  const { t, i18n } = useTranslation('receivables')
  const { profile } = useAuth()
  const { isRtl } = useLocale()
  const [tab, setTab] = useState<WorkspaceTab>('overview')
  const [startDate, setStartDate] = useState(() => isoDate(-30))
  const [endDate, setEndDate] = useState(() => isoDate())
  const [quickRange, setQuickRange] = useState<'today' | '7d' | '30d' | '90d' | 'custom'>('30d')
  const [branchId, setBranchId] = useState<string | null>(profile?.role === 'branch' ? profile.branch_id : null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ReportData | null>(null)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canChooseBranch = ['owner', 'admin', 'accountant'].includes(profile?.role ?? '')

  const applyQuickRange = (range: Exclude<typeof quickRange, 'custom'>) => {
    const days = range === 'today' ? 0 : range === '7d' ? 6 : range === '30d' ? 29 : 89
    setStartDate(isoDate(-days))
    setEndDate(isoDate())
    setQuickRange(range)
    setPage(1)
  }

  useEffect(() => {
    if (!profile?.tenant_id) return
    let stale = false
    void supabase.from('branches').select('*').eq('tenant_id', profile.tenant_id).eq('is_active', true).order('name')
      .then(({ data: rows }) => { if (!stale) setBranches((rows ?? []) as unknown as Branch[]) })
    return () => { stale = true }
  }, [profile?.tenant_id])

  useEffect(() => { if (profile?.role === 'branch' && profile.branch_id) setBranchId(profile.branch_id) }, [profile?.branch_id, profile?.role])

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
        .select('id,customer_id,receipt_number,amount,method,received_at,branch_id,status')
        .gte('received_at', `${startDate}T00:00:00.000Z`)
        .lte('received_at', `${endDate}T23:59:59.999Z`)
        .order('received_at', { ascending: false }).limit(100)
      if (branchId) paymentQuery = paymentQuery.eq('branch_id', branchId)
      const [{ data: customerRows, error: customerError }, { data: paymentRows, error: paymentError }] = await Promise.all([customerQuery, paymentQuery])
      if (customerError) throw customerError
      if (paymentError) throw paymentError
      const customerIds = (customerRows ?? []).map((row: any) => String(row.id))
      let invoiceQuery: any = customerIds.length
        ? (supabase as any).from('invoices').select('id,customer_id,invoice_number,total_amount,invoice_date,status').in('customer_id', customerIds)
          .gte('invoice_date', startDate).lte('invoice_date', endDate).neq('status', 'cancelled').order('invoice_date', { ascending: false }).limit(500)
        : Promise.resolve({ data: [], error: null })
      if (branchId) invoiceQuery = invoiceQuery.eq('branch_id', branchId)
      const { data: invoiceRows, error: invoiceError } = await invoiceQuery
      if (invoiceError) throw invoiceError
      const balanceByAccount = new Map(report.balances.map(row => [row.receivableAccountId, row.balance]))
      const invoicesByCustomer = new Map<string, InvoiceRow[]>()
      ;(invoiceRows ?? []).forEach((row: any) => {
        const customerId = String(row.customer_id)
        const list = invoicesByCustomer.get(customerId) ?? []
        list.push({ id: String(row.id), customerId, invoiceNumber: String(row.invoice_number ?? '—'), totalAmount: asNumber(row.total_amount), invoiceDate: String(row.invoice_date), status: String(row.status ?? '') })
        invoicesByCustomer.set(customerId, list)
      })
      const paymentsByCustomer = new Map<string, PaymentRow[]>()
      ;(paymentRows ?? []).forEach((row: any) => {
        const payment = { id: String(row.id), customerId: String(row.customer_id), receiptNumber: String(row.receipt_number ?? '—'), amount: asNumber(row.amount), method: String(row.method ?? 'other'), receivedAt: String(row.received_at), branchId: String(row.branch_id), status: String(row.status ?? 'completed') }
        const list = paymentsByCustomer.get(payment.customerId) ?? []
        list.push(payment)
        paymentsByCustomer.set(payment.customerId, list)
      })
      const businessCustomerIds = new Set(customerIds)
      setCustomers((customerRows ?? []).map((row: any) => {
        const customerId = String(row.id)
        const invoiceList = invoicesByCustomer.get(customerId) ?? []
        const paymentList = (paymentsByCustomer.get(customerId) ?? []).filter(payment => businessCustomerIds.has(payment.customerId))
        return {
        id: customerId, name: String(row.name ?? '—'), nameAr: row.name_ar ? String(row.name_ar) : null,
        businessName: row.business_name ? String(row.business_name) : null, companyName: row.company_name ? String(row.company_name) : null,
        phone: row.phone ? String(row.phone) : null,
        branchId: row.branch_id ? String(row.branch_id) : null, accountId: String(row.receivable_account_id),
        active: row.is_active !== false, balance: asNumber(balanceByAccount.get(String(row.receivable_account_id))),
        lastCreditInvoice: invoiceList[0]?.invoiceNumber ?? null,
        lastPayment: paymentList[0]?.receivedAt ?? null,
        totalInvoiced: invoiceList.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
        totalPaid: paymentList.reduce((sum, payment) => sum + payment.amount, 0),
        }
      }))
      setPayments((paymentRows ?? []).map((row: any) => ({
        id: String(row.id), customerId: String(row.customer_id), receiptNumber: String(row.receipt_number ?? '—'),
        amount: asNumber(row.amount), method: String(row.method ?? 'other'), receivedAt: String(row.received_at),
        branchId: String(row.branch_id), status: String(row.status ?? 'completed'),
      })))
    } catch (loadError) {
      console.error('Unable to load customer credit workspace', loadError)
      setData(null); setCustomers([]); setPayments([]); setError(t('report.loadFailed'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [branchId, endDate, page, startDate])

  const branchNames = useMemo(() => new Map(branches.map(branch => [branch.id, isRtl ? branch.name_ar || branch.name : branch.name])), [branches, isRtl])
  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.id, isRtl ? customer.businessName || customer.companyName || customer.name : customer.businessName || customer.companyName || customer.name])), [customers, isRtl])
  const summary = data?.summary
  const canGoNext = (data?.balances.length ?? 0) === PAGE_SIZE
  const tabItems: Array<{ id: WorkspaceTab; icon: React.ElementType }> = [
    { id: 'overview', icon: BarChart3 }, { id: 'customers', icon: WalletCards }, { id: 'payments', icon: ReceiptText }, { id: 'statements', icon: FileText },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><BarChart3 size={20} /></span><div><h1 className="text-xl font-bold text-slate-950">{t('report.title')}</h1><p className="mt-0.5 text-sm text-slate-500">{t('report.subtitle')}</p></div></div>
        <Link to="/reports" className="text-sm font-semibold text-primary-700 hover:text-primary-800">{t('report.back')}</Link>
      </header>

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5" role="tablist" aria-label={t('report.workspaceTabs.label')}>
        {tabItems.map(item => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${tab === item.id ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}><Icon size={15} />{t(`report.workspaceTabs.${item.id}`)}</button> })}
      </nav>

      <section className="card space-y-4 p-4" aria-label={t('report.filters')}>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('report.quick.label')}>
          <span className="me-1 text-xs font-semibold text-slate-600">{t('report.quick.label')}</span>
          {(['today', '7d', '30d', '90d'] as const).map(range => <button key={range} type="button" onClick={() => applyQuickRange(range)} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${quickRange === range ? 'bg-primary-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{t(`report.quick.${range}`)}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs font-semibold text-slate-700"><span>{t('report.from')}</span><input type="date" className="input w-full" value={startDate} onChange={event => { setStartDate(event.target.value); setQuickRange('custom'); setPage(1) }} /></label>
        <label className="space-y-1 text-xs font-semibold text-slate-700"><span>{t('report.to')}</span><input type="date" className="input w-full" value={endDate} onChange={event => { setEndDate(event.target.value); setQuickRange('custom'); setPage(1) }} /></label>
        {canChooseBranch && <label className="space-y-1 text-xs font-semibold text-slate-700"><span>{t('report.branch')}</span><select className="input w-full" value={branchId ?? ''} onChange={event => { setBranchId(event.target.value || null); setPage(1) }}><option value="">{t('report.allBranches')}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{isRtl ? branch.name_ar || branch.name : branch.name}</option>)}</select></label>}
        <div className="flex items-end"><Button variant="secondary" className="w-full" onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{t('report.refresh')}</Button></div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      {tab === 'overview' && <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('report.summary')}>
          <Metric label={t('report.totalReceivables')} value={<Rial amount={summary?.totalReceivables ?? 0} />} tone="amber" />
          <Metric label={t('report.customerCredit')} value={<Rial amount={summary?.customerCredit ?? 0} />} tone="emerald" />
          <Metric label={t('report.overdue')} value={<Rial amount={summary?.overdueReceivables ?? 0} />} tone={(summary?.overdueReceivables ?? 0) > 0 ? 'amber' : 'slate'} />
          <Metric label={t('report.paymentsReceived')} value={<Rial amount={summary?.paymentsReceived ?? 0} />} tone="emerald" />
          <Metric label={t('report.unappliedCredit')} value={<Rial amount={summary?.unappliedCredit ?? 0} />} tone="emerald" />
          <Metric label={t('report.customerCount')} value={(summary?.customerCount ?? 0).toLocaleString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US')} />
        </section>
        <section className="card overflow-hidden" aria-labelledby="ar-branches-heading">
          <div className="border-b border-slate-100 px-4 py-3"><h2 id="ar-branches-heading" className="font-bold text-slate-950">{t('report.branchComparison')}</h2></div>
          {data?.branchComparison.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 text-start font-semibold">{t('report.branch')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.debits')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.credits')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.balance')}</th></tr></thead><tbody>{data.branchComparison.map(row => <tr key={row.branchId} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-800">{branchNames.get(row.branchId) ?? row.branchId}</td><td className="px-4 py-3 text-end"><Rial amount={row.debits} /></td><td className="px-4 py-3 text-end"><Rial amount={row.credits} /></td><td className="px-4 py-3 text-end font-semibold"><Rial amount={row.balance} /></td></tr>)}</tbody></table></div> : <p className="px-4 py-8 text-center text-sm text-slate-500">{t('report.noBranchActivity')}</p>}
        </section>
      </>}

      {tab === 'customers' && <section className="card overflow-hidden" aria-labelledby="credit-customers-heading">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h2 id="credit-customers-heading" className="font-bold text-slate-950">{t('report.customersTab.title')}</h2><p className="text-xs text-slate-500">{data?.filters.ownerConsolidated ? t('report.consolidated') : t('report.branchScoped')}</p></div><WalletCards size={18} className="text-slate-400" /></div>
        {loading ? <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-primary-600" /></div> : customers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 text-start font-semibold">{t('report.customersTab.customer')}</th><th className="px-4 py-3 text-start font-semibold">{t('report.customersTab.phone')}</th><th className="px-4 py-3 text-start font-semibold">{t('report.customersTab.lastCreditInvoice')}</th><th className="px-4 py-3 text-start font-semibold">{t('report.customersTab.lastPayment')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.customersTab.totalInvoiced')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.customersTab.totalPaid')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.customersTab.balance')}</th><th className="px-4 py-3 text-center font-semibold">{t('report.customersTab.status')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.customersTab.actions')}</th></tr></thead><tbody>{customers.map(customer => <tr key={customer.id} className="border-t border-slate-100"><td className="px-4 py-3"><Link to={`/customers/${customer.id}`} className="font-semibold text-primary-700 hover:text-primary-900">{isRtl ? customer.businessName || customer.companyName || customer.name : customer.businessName || customer.companyName || customer.name}</Link><p className="mt-0.5 text-xs text-slate-500">{customer.branchId ? branchNames.get(customer.branchId) ?? customer.branchId : '—'}</p></td><td className="px-4 py-3 text-slate-600">{customer.phone ?? '—'}</td><td className="px-4 py-3 text-slate-600">{customer.lastCreditInvoice ?? '—'}</td><td className="px-4 py-3 text-slate-600">{formatShortDate(customer.lastPayment, isRtl)}</td><td className="px-4 py-3 text-end font-semibold"><Rial amount={customer.totalInvoiced} /></td><td className="px-4 py-3 text-end font-semibold text-emerald-700"><Rial amount={customer.totalPaid} /></td><td className={`px-4 py-3 text-end font-semibold ${customer.balance > 0 ? 'text-amber-800' : 'text-emerald-700'}`}><Rial amount={Math.abs(customer.balance)} /></td><td className="px-4 py-3 text-center"><span className={customer.active ? 'text-emerald-700' : 'text-slate-500'}>{customer.active ? t('report.customersTab.active') : t('report.customersTab.inactive')}</span></td><td className="px-4 py-3 text-end"><Link to={`/print/customer-statement/${customer.id}${customer.branchId ? `?branch=${encodeURIComponent(customer.branchId)}` : ''}`} className="font-semibold text-primary-700 hover:text-primary-900">{t('report.customersTab.statement')}</Link></td></tr>)}</tbody></table></div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('report.empty')}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3"><Button size="sm" variant="secondary" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={15} />{t('report.previous')}</Button><Button size="sm" variant="secondary" disabled={loading || !canGoNext} onClick={() => setPage(value => value + 1)}>{t('report.next')}<ChevronRight size={15} /></Button></div>
      </section>}

      {tab === 'payments' && <section className="card overflow-hidden" aria-labelledby="credit-payments-heading">
        <div className="border-b border-slate-100 px-4 py-3"><h2 id="credit-payments-heading" className="font-bold text-slate-950">{t('report.paymentsTab.title')}</h2><p className="text-xs text-slate-500">{t('report.paymentsTab.subtitle')}</p></div>
        {loading ? <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-primary-600" /></div> : payments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 text-start font-semibold">{t('report.paymentsTab.receipt')}</th><th className="px-4 py-3 text-start font-semibold">{t('report.customersTab.customer')}</th><th className="px-4 py-3 text-start font-semibold">{t('report.paymentsTab.method')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.paymentsTab.amount')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.paymentsTab.date')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.customersTab.actions')}</th></tr></thead><tbody>{payments.map(payment => <tr key={payment.id} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold text-slate-800">{payment.receiptNumber}</td><td className="px-4 py-3 text-slate-700">{customerNames.get(payment.customerId) ?? '—'}</td><td className="px-4 py-3 text-slate-600">{t(`methods.${payment.method}`, { defaultValue: payment.method })}</td><td className="px-4 py-3 text-end font-semibold"><Rial amount={payment.amount} /></td><td className="px-4 py-3 text-end text-slate-500">{new Date(payment.receivedAt).toLocaleDateString(isRtl ? 'ar-SA-u-nu-latn' : 'en-SA')}</td><td className="px-4 py-3 text-end"><Link to={`/print/payment-receipt/${payment.id}`} className="font-semibold text-primary-700 hover:text-primary-900">{t('report.paymentsTab.openReceipt')}</Link></td></tr>)}</tbody></table></div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('report.paymentsTab.empty')}</p>}
      </section>}

      {tab === 'statements' && <section className="card overflow-hidden" aria-labelledby="credit-statements-heading">
        <div className="border-b border-slate-100 px-4 py-3"><h2 id="credit-statements-heading" className="font-bold text-slate-950">{t('report.statementsTab.title')}</h2><p className="text-xs text-slate-500">{t('report.statementsTab.subtitle')}</p></div>
        {customers.length ? <div className="divide-y divide-slate-100">{customers.map(customer => <div key={customer.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><Link to={`/customers/${customer.id}`} className="font-semibold text-primary-700 hover:text-primary-900">{isRtl ? customer.businessName || customer.companyName || customer.name : customer.businessName || customer.companyName || customer.name}</Link><p className="mt-0.5 text-xs text-slate-500">{customer.branchId ? branchNames.get(customer.branchId) ?? customer.branchId : '—'} · {t('report.statementsTab.range', { start: startDate, end: endDate })}</p></div><Link to={`/print/customer-statement/${customer.id}?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}${customer.branchId ? `&branch=${encodeURIComponent(customer.branchId)}` : ''}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><FileText size={14} />{t('report.statementsTab.open')}</Link></div>)}</div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('report.statementsTab.empty')}</p>}
      </section>}
    </div>
  )
}
