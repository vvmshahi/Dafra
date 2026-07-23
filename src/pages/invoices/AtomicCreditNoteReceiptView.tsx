import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import { Rial } from '@/components/ui/RiyalSymbol'
import { getPrinterSettings } from '@/lib/electron'
import { printAtomicReceiptSnapshot } from '@/lib/atomicReceiptPrint'
import { documentFromAtomicReceipt } from '@/lib/invoices/documentViewAdapters'
import {
  renderStoredQrDataUrl,
  type QrDisplayStatus,
} from '@/lib/zatca/qrDisplay.mjs'
import type { AtomicReceiptPayload } from '@/lib/zatca/atomicCheckout'

const CREDIT_NOTE_RECEIPT_ID = 'atomic-credit-note-receipt'

function printFailureKey(errorType?: string | null): string {
  if (errorType === 'NO_PRINTER_CONFIGURED') return 'printer.notConfigured'
  if (errorType === 'PRINTER_NOT_FOUND') return 'printer.notFound'
  return 'printer.receiptFailed'
}

export default function AtomicCreditNoteReceiptView({
  receipt,
  onClose,
  onOpenPrinterSettings,
}: {
  receipt: AtomicReceiptPayload
  onClose: () => void
  onOpenPrinterSettings: () => void
}) {
  const { t } = useTranslation(['creditNotes', 'payments', 'printing', 'pos', 'common'])
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<QrDisplayStatus>('loading')
  const [printing, setPrinting] = useState(false)
  const [printErrorKey, setPrintErrorKey] = useState<string | null>(null)
  const automaticPrintRef = useRef(false)
  const printAttemptedRef = useRef(false)
  const printInFlightRef = useRef(false)
  const model = useMemo(() => documentFromAtomicReceipt(receipt), [receipt])
  const printReady = receipt.can_print === true && qrStatus === 'ready' && Boolean(qrDataUrl)

  useEffect(() => {
    let cancelled = false
    setQrStatus('loading')
    void renderStoredQrDataUrl(
      receipt.qr_code,
      payload => QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        width: 160,
        margin: 1,
        color: { dark: '#0F2419', light: '#FFFFFF' },
      }),
    ).then(result => {
      if (cancelled) return
      setQrDataUrl(result.dataUrl)
      setQrStatus(result.status)
    })
    return () => { cancelled = true }
  }, [receipt.qr_code])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      console.info('[zatca-timing]', {
        event: 'receipt_rendered',
        invoiceId: receipt.invoice_id,
        reportingDisplayState: receipt.reporting_display_state,
        source: 'atomic_credit_note_snapshot',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [receipt.invoice_id, receipt.reporting_display_state])

  const printSnapshot = useCallback(async () => {
    if (!printReady || printInFlightRef.current) return
    printAttemptedRef.current = true
    printInFlightRef.current = true
    setPrinting(true)
    setPrintErrorKey(null)
    try {
      const result = await printAtomicReceiptSnapshot({
        invoiceId: receipt.invoice_id,
        receiptElementId: CREDIT_NOTE_RECEIPT_ID,
        source: 'atomic_credit_note_snapshot',
      })
      if (result.success) {
        toast.success(t('pos:printer.receiptSent'), { duration: 1800 })
        return
      }
      const errorKey = printFailureKey(result.errorType)
      console.warn('[AtomicCreditNoteReceiptView] snapshot print failed', result.errorType)
      setPrintErrorKey(errorKey)
      toast.error(t(`pos:${errorKey}`))
    } catch (error) {
      console.warn('[AtomicCreditNoteReceiptView] snapshot print failed', error)
      setPrintErrorKey('printer.receiptFailed')
      toast.error(t('pos:printer.receiptFailed'))
    } finally {
      printInFlightRef.current = false
      setPrinting(false)
    }
  }, [printReady, receipt.invoice_id, t])

  useEffect(() => {
    if (!printReady || automaticPrintRef.current) return
    automaticPrintRef.current = true
    void getPrinterSettings()
      .then(settings => {
        if (settings.autoPrintReceiptAfterSale && !printAttemptedRef.current) {
          void printSnapshot()
        }
      })
      .catch(error => {
        console.warn('[AtomicCreditNoteReceiptView] printer settings unavailable', error)
        setPrintErrorKey('printer.receiptFailed')
      })
  }, [printReady, printSnapshot])

  return (
    <>
      <ThermalReceipt
        model={model}
        options={{ id: CREDIT_NOTE_RECEIPT_ID, qrImageUrl: qrDataUrl }}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2419]/90">
        <div className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="bg-gradient-to-br from-emerald-400 to-emerald-600 px-6 py-8 text-center text-white">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
              <Check size={32} strokeWidth={3} />
            </div>
            <p className="text-xl font-bold">{t('creditNotes:createdReportingPending')}</p>
            <p className="mt-1 text-sm text-emerald-100">
              <bdi dir="ltr">{receipt.invoice_number}</bdi>
            </p>
          </div>

          <div className="space-y-3 p-6">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="text-slate-500">ZATCA</span>
              <span className="font-semibold text-slate-700">
                {t('pos:zatca.reporting_pending')}
              </span>
            </div>
            {receipt.invoice_reference && (
              <p className="text-sm text-gray-600">
                {t('creditNotes:creditsOriginal', { number: receipt.invoice_reference })}
              </p>
            )}
            <div className="flex justify-between border-t border-gray-100 pt-3 text-lg font-bold">
              <span>{t('creditNotes:creditTotal')}</span>
              <span className="text-emerald-600" dir="ltr">
                <Rial amount={Number(receipt.total)} />
              </span>
            </div>

            {printErrorKey && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-red-700">
                  <AlertCircle size={14} />
                  <span>{t(`pos:${printErrorKey}`)}</span>
                </div>
                <button
                  type="button"
                  onClick={onOpenPrinterSettings}
                  className="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  {t('pos:printer.choose')}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2 px-6 pb-6">
            <button
              type="button"
              onClick={() => void printSnapshot()}
              disabled={printing || !printReady}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {printing ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              {printing ? t('payments:printing') : t('payments:printReceipt')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-gradient-to-r from-[#1a3a28] to-primary-600 py-3 font-semibold text-white transition-opacity hover:opacity-90"
            >
              {t('common:close')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
