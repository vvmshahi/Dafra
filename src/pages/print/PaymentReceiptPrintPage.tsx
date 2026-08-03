import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { loadCustomerPaymentReceiptDocument } from '@/lib/customers/receivables'

function displayDate(value: string, locale: string) {
  return new Date(value).toLocaleString(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function PaymentReceiptPrintPage() {
  const { receiptId } = useParams<{ receiptId: string }>()
  const { t, i18n } = useTranslation('receivables')
  const locale = i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA' : 'en'
  const [document, setDocument] = useState<any>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!receiptId) return
    let stale = false
    void loadCustomerPaymentReceiptDocument(receiptId)
      .then(value => { if (!stale) setDocument(value) })
      .catch(() => { if (!stale) setError(true) })
    return () => { stale = true }
  }, [receiptId])

  if (!document && !error) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-primary-500" /></div>
  if (error || !document) return <div className="min-h-screen grid place-items-center p-6 text-center text-sm text-slate-600">{t('document.notFound')}</div>

  const receipt = document.receipt
  return (
    <main className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0" dir={locale === 'ar-SA' ? 'rtl' : 'ltr'}>
      <style>{`@media print { @page { size: A4; margin: 12mm; } .receipt-actions { display:none!important; } }`}</style>
      <div className="receipt-actions mx-auto mb-4 flex max-w-[760px] justify-between gap-3">
        <Link to={`/customers/${receipt.customerId ?? ''}`} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-950"><ArrowLeft size={15} /> {t('document.back')}</Link>
        <Button size="sm" onClick={() => window.print()}><Printer size={14} /> {t('document.print')}</Button>
      </div>
      <article className="mx-auto max-w-[760px] rounded-sm bg-white p-7 shadow-sm print:max-w-none print:shadow-none sm:p-10">
        <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-700">{document.company?.name}</p><h1 className="mt-1 text-2xl font-bold text-slate-950">{t('document.title')}</h1><p className="mt-1 text-sm text-slate-500">{document.branch?.name}</p></div>
          <div className="text-right"><p className="text-sm font-bold text-slate-950">{receipt.number}</p><p className="mt-1 text-xs text-slate-500">{displayDate(receipt.receivedAt, locale)}</p><p className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{receipt.status}</p></div>
        </header>
        <section className="grid gap-4 py-6 sm:grid-cols-2"><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('document.receivedFrom')}</p><p className="mt-1 font-semibold text-slate-950" dir="auto">{document.customer?.name}</p>{document.customer?.phone && <p className="mt-1 text-sm text-slate-600">{document.customer.phone}</p>}</div><div className="sm:text-right"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('document.amountReceived')}</p><p className="mt-1 text-2xl font-bold text-slate-950"><Rial amount={Number(receipt.amount ?? 0)} /></p><p className="mt-1 text-sm text-slate-600">{receipt.method}</p></div></section>
        <section className="border-t border-slate-200 py-5"><h2 className="text-sm font-bold text-slate-900">{t('document.tenders')}</h2><div className="mt-3 divide-y divide-slate-100">{(document.tenders ?? []).map((tender: any) => <div className="flex justify-between gap-3 py-2 text-sm" key={tender.method}><span className="text-slate-600">{tender.method}{tender.reference ? ` · ${tender.reference}` : ''}</span><span className="font-semibold tabular-nums text-slate-950"><Rial amount={Number(tender.amount ?? 0)} /></span></div>)}</div></section>
        <section className="border-t border-slate-200 py-5"><h2 className="text-sm font-bold text-slate-900">{t('document.allocations')}</h2>{(document.allocations ?? []).length ? <div className="mt-3 divide-y divide-slate-100">{document.allocations.map((allocation: any) => <div className="flex justify-between gap-3 py-2 text-sm" key={`${allocation.invoiceId}-${allocation.amount}`}><span className="text-slate-600">{allocation.invoiceNumber}</span><span className="font-semibold tabular-nums text-slate-950"><Rial amount={Number(allocation.amount ?? 0)} /></span></div>)}</div> : <p className="mt-2 text-sm text-slate-500">{t('document.unapplied')}</p>}<div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-slate-500">{t('document.previousBalance')}</p><p className="font-semibold tabular-nums"><Rial amount={Number(receipt.previousBalance ?? 0)} /></p></div><div><p className="text-xs text-slate-500">{t('document.remainingBalance')}</p><p className="font-semibold tabular-nums"><Rial amount={Number(receipt.remainingBalance ?? 0)} /></p></div><div><p className="text-xs text-slate-500">{t('document.unappliedCredit')}</p><p className="font-semibold tabular-nums"><Rial amount={Number(receipt.unappliedCredit ?? 0)} /></p></div></div></section>
        {receipt.notes && <section className="border-t border-slate-200 pt-5"><h2 className="text-sm font-bold text-slate-900">{t('document.notes')}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{receipt.notes}</p></section>}
        <footer className="mt-10 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">{t('document.disclaimer')}</footer>
      </article>
    </main>
  )
}
