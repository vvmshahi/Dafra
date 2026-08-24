import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Loader2, Printer } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { loadCustomerStatementWorkspace, type CustomerReceivableWorkspace } from '@/lib/customers/receivables'
import { downloadCustomerStatementXlsx } from '@/lib/customers/receivablesXlsx'
import { useAuth } from '@/hooks/useAuth'
import { formatSaudiDateTime } from '@/lib/utils/date'

function dateLabel(value: string | null | undefined, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? formatSaudiDateTime(value, locale)
    : '—'
}

function downloadStatementPdf(input: { customerName: string; companyName?: string | null; branchLabel?: string | null; locale: 'en' | 'ar'; workspace: CustomerReceivableWorkspace }) {
  return import('@/lib/customers/receivablesPdf').then(module => module.downloadCustomerStatementPdf(input))
}

export default function CustomerStatementPrintPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const [searchParams] = useSearchParams()
  const { t, i18n } = useTranslation('receivables')
  const { tenant, branch } = useAuth()
  const locale = i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA' : 'en'
  const [workspace, setWorkspace] = useState<CustomerReceivableWorkspace | null>(null)
  const [error, setError] = useState(false)
  const autoDownload = useRef<string | null>(null)

  useEffect(() => {
    if (!customerId) return
    let stale = false
    void loadCustomerStatementWorkspace({
      customerId,
      branchId: searchParams.get('branch'),
      startDate: searchParams.get('start') || undefined,
      endDate: searchParams.get('end') || undefined,
      allActivity: !searchParams.get('start') && !searchParams.get('end'),
    }).then(value => {
      if (!stale) setWorkspace(value)
    }).catch(() => {
      if (!stale) setError(true)
    })
    return () => { stale = true }
  }, [customerId, searchParams])

  useEffect(() => {
    if (!workspace || !customerId) return
    const action = searchParams.get('download')
    if (!action || autoDownload.current === action) return
    autoDownload.current = action
    const customerName = locale === 'ar-SA' ? (workspace.customer.nameAr || workspace.customer.name) : workspace.customer.name
    const common = { customerName, companyName: tenant?.name ?? null, branchLabel: workspace.scope.ownerConsolidated ? (locale === 'ar-SA' ? 'موحد' : 'Consolidated') : (locale === 'ar-SA' ? (branch?.name_ar || branch?.name) : branch?.name) ?? workspace.scope.branchId, locale: locale === 'ar-SA' ? 'ar' as const : 'en' as const, workspace }
    if (action === 'xlsx') downloadCustomerStatementXlsx(common)
    if (action === 'pdf') void downloadStatementPdf(common)
  }, [branch, customerId, locale, searchParams, tenant?.name, workspace])

  if (!workspace && !error) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-primary-500" /></div>
  if (error || !workspace) return <div className="min-h-screen grid place-items-center p-6 text-center text-sm text-slate-600">{t('statement.notFound')}</div>

  const customerName = locale === 'ar-SA' ? (workspace.customer.nameAr || workspace.customer.name) : workspace.customer.name
  const exportXlsx = () => downloadCustomerStatementXlsx({
    customerName,
    companyName: tenant?.name ?? null,
    branchLabel: workspace.scope.ownerConsolidated
      ? (locale === 'ar-SA' ? 'موحد' : 'Consolidated')
      : (locale === 'ar-SA' ? (branch?.name_ar || branch?.name) : branch?.name) ?? workspace.scope.branchId,
    locale: locale === 'ar-SA' ? 'ar' : 'en',
    workspace,
  })
  const exportPdf = () => void downloadStatementPdf({
    customerName, companyName: tenant?.name ?? null, branchLabel: workspace.scope.ownerConsolidated ? (locale === 'ar-SA' ? 'موحد' : 'Consolidated') : (locale === 'ar-SA' ? (branch?.name_ar || branch?.name) : branch?.name) ?? workspace.scope.branchId, locale: locale === 'ar-SA' ? 'ar' : 'en', workspace,
  })
  return (
    <main className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0" dir={locale === 'ar-SA' ? 'rtl' : 'ltr'}>
      <style>{`@media print { @page { size: A4; margin: 12mm; } .statement-actions { display:none!important; } }`}</style>
      <div className="statement-actions mx-auto mb-4 flex max-w-[900px] justify-between gap-3">
        <Link to={`/customers/${customerId}`} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-950"><ArrowLeft size={15} /> {t('statement.back')}</Link>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={exportXlsx}><Download size={14} /> {t('statement.exportXlsx')}</Button>
          <Button size="sm" variant="secondary" onClick={exportPdf}><Download size={14} /> {t('statement.pdf')}</Button>
          <Button size="sm" onClick={() => window.print()}><Printer size={14} /> {t('statement.print')}</Button>
        </div>
      </div>
      <article className="mx-auto max-w-[900px] rounded-sm bg-white p-7 shadow-sm print:max-w-none print:shadow-none sm:p-10">
        <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-700">{t('statement.eyebrow')}</p><h1 className="mt-1 text-2xl font-bold text-slate-950">{t('statement.title')}</h1><p className="mt-1 text-sm text-slate-600" dir="auto">{customerName}</p></div>
          <div className="text-right text-xs text-slate-500"><p>{t('statement.period')}</p><p className="mt-1">{dateLabel(workspace.statement.startDate, locale)} — {dateLabel(workspace.statement.endDate, locale)}</p><p className="mt-1">{workspace.scope.ownerConsolidated ? t('consolidated') : t('branchScope')}</p></div>
        </header>
        <section className="grid gap-3 py-6 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{t('metrics.balance')}</p><p className="mt-1 font-bold tabular-nums"><Rial amount={workspace.summary.balance} /></p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{t('metrics.totalInvoiced')}</p><p className="mt-1 font-bold tabular-nums"><Rial amount={workspace.summary.totalInvoiced} /></p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{t('metrics.totalCollected')}</p><p className="mt-1 font-bold tabular-nums"><Rial amount={workspace.summary.totalCollected} /></p></div>
          <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{t('metrics.unappliedCredit')}</p><p className="mt-1 font-bold tabular-nums"><Rial amount={workspace.summary.unappliedReceipts} /></p></div>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-bold text-slate-900">{t('ledger.title')}</h2>
          <div className="overflow-hidden border border-slate-200">
            <div className="grid min-w-[720px] grid-cols-[1.45fr_90px_120px_86px_86px_100px] gap-2 bg-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600"><span>{t('statement.entry')}</span><span>{t('statement.branch')}</span><span>{t('statement.reference')}</span><span className="text-right">{t('statement.debit')}</span><span className="text-right">{t('statement.credit')}</span><span className="text-right">{t('statement.balanceColumn')}</span></div>
            {workspace.ledger.length === 0 ? <p className="px-3 py-8 text-center text-sm text-slate-500">{t('ledger.empty')}</p> : workspace.ledger.map(row => { const sourceHref = row.sourceKind === 'invoice' || row.sourceKind === 'credit_note' || row.sourceKind === 'debit_note' ? `/invoices/${row.sourceId}` : row.sourceKind === 'payment_receipt' || row.sourceKind === 'payment_reversal' ? `/print/payment-receipt/${row.sourceId}` : null; const reference = row.sourceKind.replaceAll('_', ' '); return <div className="grid min-w-[720px] grid-cols-[1.45fr_90px_120px_86px_86px_100px] gap-2 border-t border-slate-100 px-3 py-2 text-xs" key={row.id}><span><span className="block text-slate-800">{sourceHref ? <Link className="font-semibold text-primary-700" to={sourceHref}>{row.description || reference}</Link> : row.description || reference}</span><span className="block text-slate-500">{dateLabel(row.effectiveAt, locale)}</span></span><span className="truncate text-slate-600">{row.branchId}</span><span className="truncate capitalize text-slate-500">{reference}</span><span className="text-right tabular-nums">{row.debit > 0 ? <Rial amount={row.debit} /> : '—'}</span><span className="text-right tabular-nums">{row.credit > 0 ? <Rial amount={row.credit} /> : '—'}</span><span className="text-right font-semibold tabular-nums"><Rial amount={row.runningBalance} /></span></div> })}
          </div>
        </section>
        <footer className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">{t('statement.disclaimer')}</footer>
      </article>
    </main>
  )
}
