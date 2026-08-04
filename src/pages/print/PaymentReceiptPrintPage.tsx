import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, Printer, Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { loadCustomerPaymentReceiptDocument } from '@/lib/customers/receivables'

function displayDate(value: string, locale: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(locale === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-SA', { dateStyle: 'medium', timeStyle: 'short' })
    : '—'
}

export default function PaymentReceiptPrintPage() {
  const { receiptId } = useParams<{ receiptId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const format = searchParams.get('format') === '58' || searchParams.get('format') === '80' ? searchParams.get('format') : 'a4'
  const setFormat = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'a4') next.delete('format')
    else next.set('format', value)
    setSearchParams(next)
  }
  const share = async () => {
    const payload = { title: `${t('document.title')} ${receipt.number}`, text: `${t('document.title')} ${receipt.number}`, url: window.location.href }
    if (navigator.share) {
      try { await navigator.share(payload) } catch { /* dismissing the native dialog is not an error */ }
    } else {
      await navigator.clipboard?.writeText(window.location.href)
    }
  }
  const pageRule = format === '58'
    ? '@page { size: 58mm auto; margin: 3mm; } .receipt-sheet { width: 52mm; padding: 0; font-size: 10px; } .receipt-sheet h1 { font-size: 16px; } .receipt-sheet header { gap: 8px; padding-bottom: 10px; }'
    : format === '80'
      ? '@page { size: 80mm auto; margin: 4mm; } .receipt-sheet { width: 72mm; padding: 0; font-size: 11px; } .receipt-sheet h1 { font-size: 17px; } .receipt-sheet header { gap: 10px; padding-bottom: 10px; }'
      : '@page { size: A4; margin: 12mm; } .receipt-sheet { max-width: none; }'
  return (
    <main className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0" dir={locale === 'ar-SA' ? 'rtl' : 'ltr'}>
      <style>{`@media print { ${pageRule} .receipt-actions { display:none!important; } }`}</style>
      <div className="receipt-actions mx-auto mb-4 flex max-w-[760px] justify-between gap-3">
        <Link to={`/customers/${receipt.customerId ?? ''}`} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-950"><ArrowLeft size={15} /> {t('document.back')}</Link>
        <div className="flex flex-wrap justify-end gap-2">
          <label className="sr-only" htmlFor="payment-receipt-format">{t('document.format')}</label>
          <select id="payment-receipt-format" value={format} onChange={event => setFormat(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">
            <option value="58">{t('document.format58')}</option><option value="80">{t('document.format80')}</option><option value="a4">{t('document.formatA4')}</option>
          </select>
          <Button size="sm" variant="secondary" onClick={() => void share()}><Share2 size={14} /> {t('document.share')}</Button>
          <Button size="sm" variant="secondary" onClick={() => window.print()}><Download size={14} /> {t('document.savePdf')}</Button>
          <Button size="sm" onClick={() => window.print()}><Printer size={14} /> {t('document.print')}</Button>
        </div>
      </div>
      <article className={`receipt-sheet mx-auto rounded-sm bg-white p-7 shadow-sm print:shadow-none sm:p-10 ${format === 'a4' ? 'max-w-[760px] print:max-w-none' : 'max-w-[80mm]'}`}>
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
