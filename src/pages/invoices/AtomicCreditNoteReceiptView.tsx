import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Clock3, Loader2, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import ThermalReceipt from '@/components/print/ThermalReceipt'
import { Rial } from '@/components/ui/RiyalSymbol'
import { getPrinterSettings } from '@/lib/electron'
import { printAtomicReceiptSnapshot } from '@/lib/atomicReceiptPrint'
import { printReceiptInHiddenFrame } from '@/lib/receiptPrint'
import { documentFromAtomicReceipt } from '@/lib/invoices/documentViewAdapters'
import { creditNotePresentationState } from '@/lib/zatca/creditNotePresentation.mjs'
import {
  renderStoredQrDataUrl,
  type QrDisplayStatus,
} from '@/lib/zatca/qrDisplay.mjs'
import type { CreditNoteCreatedResult } from './CreateCreditNoteModal'

const CREDIT_NOTE_RECEIPT_ID = 'atomic-credit-note-receipt'

function printFailureKey(errorType?: string | null): string {
  if (errorType === 'NO_PRINTER_CONFIGURED') return 'printer.notConfigured'
  if (errorType === 'PRINTER_NOT_FOUND') return 'printer.notFound'
  return 'printer.receiptFailed'
}

export default function AtomicCreditNoteReceiptView({
  result,
  onClose,
  onOpenPrinterSettings,
}: {
  result: CreditNoteCreatedResult
  onClose: () => void
  onOpenPrinterSettings: () => void
}) {
  const { t } = useTranslation(['creditNotes', 'payments', 'printing', 'pos', 'common'])
  const receipt = result.atomicReceipt
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<QrDisplayStatus>('loading')
  const [printing, setPrinting] = useState(false)
  const [printErrorKey, setPrintErrorKey] = useState<string | null>(null)
  const automaticPrintRef = useRef(false)
  const printAttemptedRef = useRef(false)
  const printInFlightRef = useRef(false)
  const model = useMemo(
    () => receipt ? documentFromAtomicReceipt(receipt) : null,
    [receipt],
  )
  const presentation = useMemo(
    () => creditNotePresentationState(result),
    [result],
  )
  const printReady = presentation.printAllowed
    && (
      receipt
        ? receipt.can_print === true && qrStatus === 'ready' && Boolean(qrDataUrl)
        : true
    )

  useEffect(() => {
    if (!receipt) {
      setQrDataUrl(null)
      setQrStatus('missing')
      return
    }
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
  }, [receipt])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      console.info('[zatca-timing]', {
        event: 'receipt_rendered',
        invoiceId: result.creditNoteId,
        reportingDisplayState: result.reportingDisplayState,
        source: receipt ? 'atomic_credit_note_snapshot' : 'stored_credit_note',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [receipt, result.creditNoteId, result.reportingDisplayState])

  const printSnapshot = useCallback(async () => {
    if (!printReady || printInFlightRef.current) return
    printAttemptedRef.current = true
    printInFlightRef.current = true
    setPrinting(true)
    setPrintErrorKey(null)
    try {
      if (!receipt) {
        await printReceiptInHiddenFrame(result.creditNoteId)
        toast.success(t('pos:printer.receiptSent'), { duration: 1800 })
        return
      }
      const printResult = await printAtomicReceiptSnapshot({
        invoiceId: result.creditNoteId,
        receiptElementId: CREDIT_NOTE_RECEIPT_ID,
        source: 'atomic_credit_note_snapshot',
      })
      if (printResult.success) {
        toast.success(t('pos:printer.receiptSent'), { duration: 1800 })
        return
      }
      const errorKey = printFailureKey(printResult.errorType)
      console.warn('[AtomicCreditNoteReceiptView] snapshot print failed', printResult.errorType)
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
  }, [printReady, receipt, result.creditNoteId, t])

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
      {model && (
        <ThermalReceipt
          model={model}
          options={{ id: CREDIT_NOTE_RECEIPT_ID, qrImageUrl: qrDataUrl }}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F2419]/90">
        <div className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className={`px-6 py-8 text-center text-white ${
            presentation.tone === 'success'
              ? 'bg-gradient-to-br from-emerald-400 to-emerald-600'
              : presentation.tone === 'progress'
              ? 'bg-gradient-to-br from-sky-500 to-blue-600'
              : presentation.tone === 'warning'
              ? 'bg-gradient-to-br from-amber-400 to-amber-600'
              : 'bg-gradient-to-br from-red-500 to-red-700'
          }`}>
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
              {presentation.tone === 'success' ? (
                <Check size={32} strokeWidth={3} />
              ) : presentation.tone === 'progress' ? (
                <Clock3 size={30} />
              ) : (
                <AlertCircle size={30} />
              )}
            </div>
            <p className="text-xl font-bold">{t(presentation.headingKey)}</p>
            <p className="mt-1 text-sm text-white/85">
              <bdi dir="ltr">{result.creditNoteNumber}</bdi>
            </p>
          </div>

          <div className="space-y-3 p-6">
            {presentation.messageKey && (
              <div className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
                presentation.tone === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : presentation.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}>
                {t(presentation.messageKey)}
              </div>
            )}
            {presentation.statusKey && (
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs">
                <span className="text-emerald-700">ZATCA</span>
                <span className="font-semibold text-emerald-800">
                  {t(presentation.statusKey)}
                </span>
              </div>
            )}
            {result.originalInvoiceNumber && (
              <p className="text-sm text-gray-600">
                {t('creditNotes:creditsOriginal', { number: result.originalInvoiceNumber })}
              </p>
            )}
            <div className="flex justify-between border-t border-gray-100 pt-3 text-lg font-bold">
              <span>{t('creditNotes:creditTotal')}</span>
              <span className="text-emerald-600" dir="ltr">
                <Rial amount={Number(result.total)} />
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
