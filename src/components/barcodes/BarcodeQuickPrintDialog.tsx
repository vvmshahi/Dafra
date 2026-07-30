import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Layers3, Printer, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import BarcodeLabelDesigner from './BarcodeLabelDesigner'
import { getBranchBarcodeLabelSettings, recordBarcodePrintBatch } from '@/lib/barcodes/labelApi'
import {
  barcodePrintDocument,
  browserBarcodePrintAdapter,
  type BarcodeLabel,
} from '@/lib/barcodes/labelPrint'
import { printBarcodeDocumentNative } from '@/lib/barcodes/nativePrint'
import {
  DEFAULT_BARCODE_LABEL_SETTINGS,
  loadBarcodeDeviceCalibration,
  type BarcodeLabelSettings,
} from '@/lib/barcodes/labelSettings'
import type { BarcodeType } from '@/lib/barcodes/barcode'

export interface BarcodeQuickPrintChoice {
  barcodeId: string
  barcode: string
  barcodeType: BarcodeType
  unitId: string
  unitName: string
  price: string
  hasPrinted: boolean | null
}

interface Props {
  open: boolean
  branchId: string
  barcodeId: string
  barcode: string
  barcodeType: BarcodeType
  productId: string
  productName: string
  productNameAr: string | null
  unitId: string
  unitName: string
  price: string
  sku: string | null
  businessName: string | null
  hasPrinted: boolean | null
  onClose: () => void
  onPrinted: () => void
  onAddToBatch?: () => void
  choices?: BarcodeQuickPrintChoice[]
}

export default function BarcodeQuickPrintDialog(props: Props) {
  const { t, i18n } = useTranslation('printing')
  const [settings, setSettings] = useState<BarcodeLabelSettings>(DEFAULT_BARCODE_LABEL_SETTINGS)
  const [copies, setCopies] = useState(1)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const [overflowAcknowledged, setOverflowAcknowledged] = useState(false)
  const [selectedChoiceId, setSelectedChoiceId] = useState(props.barcodeId)
  const activeChoice = props.choices?.find(choice => choice.barcodeId === selectedChoiceId) ?? {
    barcodeId: props.barcodeId,
    barcode: props.barcode,
    barcodeType: props.barcodeType,
    unitId: props.unitId,
    unitName: props.unitName,
    price: props.price,
    hasPrinted: props.hasPrinted,
  }
  const close = useCallback(() => {
    if (!printing) props.onClose()
  }, [printing, props.onClose])
  const dialogRef = useDialogFocus(props.open, close)
  const calibration = useMemo(() => loadBarcodeDeviceCalibration(), [props.open])
  const auditLabel = activeChoice.hasPrinted === null
    ? 'barcodeLabels.audit.printLabel'
    : activeChoice.hasPrinted
      ? 'barcodeLabels.audit.reprint'
      : 'barcodeLabels.audit.firstPrint'
  const label = useMemo<BarcodeLabel>(() => ({
    barcodeId: activeChoice.barcodeId,
    productId: props.productId,
    productUnitId: activeChoice.unitId,
    barcode: activeChoice.barcode,
    barcodeType: activeChoice.barcodeType,
    businessName: props.businessName,
    productName: props.productName,
    productNameEn: props.productName,
    productNameAr: props.productNameAr,
    unitName: activeChoice.unitName,
    price: activeChoice.price,
    sku: props.sku,
    copies,
  }), [props.productId, props.productName, props.productNameAr, props.businessName, props.sku, activeChoice, copies])

  useEffect(() => {
    if (!props.open) return
    setSelectedChoiceId(props.barcodeId)
    setLoading(true)
    setError('')
    setOverflowAcknowledged(false)
    void getBranchBarcodeLabelSettings(props.branchId)
      .then(result => {
        setSettings(result.settings)
        setCopies(1)
      })
      .catch(() => {
        setSettings(DEFAULT_BARCODE_LABEL_SETTINGS)
        setCopies(1)
        setError(t('barcodeLabels.errors.branchDefaultsUnavailable'))
      })
      .finally(() => setLoading(false))
  }, [props.open, props.branchId, t])

  const createDocument = (preview: boolean) => barcodePrintDocument([label], settings, calibration, {
    preview,
    allowPrint: fitStatus !== 'overflow' || overflowAcknowledged,
    locale: i18n.language,
    copy: {
      title: t('barcodeLabels.preview.title'),
      print: t('barcodeLabels.actions.print'),
      saveAsPdf: t('barcodeLabels.preview.saveAsPdf'),
      dialogGuidance: t('barcodeLabels.preview.dialogGuidance'),
      riyalAccessible: t('barcodeLabels.currency.accessible'),
    },
  })
  const fitStatus = useMemo(() => {
    try {
      return barcodePrintDocument([label], settings, calibration, {
        locale: i18n.language,
      }).layout.contentFitStatus
    } catch {
      return 'overflow'
    }
  }, [label, settings, calibration, i18n.language])

  useEffect(
    () => setOverflowAcknowledged(false),
    [
      fitStatus,
      settings,
      activeChoice.barcode,
      props.productName,
      props.productNameAr,
      activeChoice.unitName,
      activeChoice.price,
      props.sku,
      props.businessName,
    ],
  )

  const preview = () => {
    setError('')
    try {
      if (!browserBarcodePrintAdapter.preview(createDocument(true).html)) {
        setError(t('barcodeLabels.errors.previewBlocked'))
      }
    } catch {
      setError(t('barcodeLabels.errors.invalidBarcodeForPrint'))
    }
  }

  const print = async () => {
    const normalizedCopies = Math.floor(Number(copies))
    if (!Number.isInteger(normalizedCopies) || normalizedCopies < 1 || normalizedCopies > 500) {
      setError(t('barcodeLabels.errors.copies'))
      return
    }
    if (normalizedCopies > 50 && reason.trim().length < 3) {
      setError(t('barcodeLabels.errors.reasonRequired'))
      return
    }
    if (fitStatus === 'overflow' && !overflowAcknowledged) {
      setError(t('barcodeLabels.errors.overflowAcknowledgement'))
      return
    }
    setPrinting(true)
    setError('')
    try {
      const document = createDocument(false)
      if (!document.layout.fits) throw new Error('layout')
      const printResult = await printBarcodeDocumentNative(document.html, {
        printerName: calibration.printerName,
        copies: 1,
      })
      if (!printResult.success) throw new Error(printResult.message || 'barcode_print_failed')
      await recordBarcodePrintBatch(
        [{ barcodeId: activeChoice.barcodeId, copies: normalizedCopies }],
        `${settings.presetId}:${settings.templateId}`.slice(0, 40),
        normalizedCopies > 50 ? reason : null,
      )
      props.onPrinted()
      props.onClose()
    } catch {
      setError(t('barcodeLabels.errors.printFailed'))
    } finally {
      setPrinting(false)
    }
  }

  if (!props.open) return null
  return <div
    className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}
  >
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-quick-print-title"
      className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
            <Printer size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              {t(auditLabel)}
            </p>
            <h2 id="barcode-quick-print-title" className="truncate text-base font-bold text-gray-950">
              {t('barcodeLabels.quickPrint.title')}
            </h2>
            <p className="truncate text-xs text-gray-500" dir="auto">{props.productName} · {activeChoice.unitName}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('barcodeLabels.actions.close')}
          onClick={close}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? <div className="grid h-64 place-items-center text-sm text-gray-500">{t('barcodeLabels.loading')}</div> : <>
          {props.choices && props.choices.length > 1 && <label className="mb-4 block space-y-1.5 text-xs font-semibold text-gray-700">
            <span>{t('barcodeLabels.quickPrint.identity')}</span>
            <select
              className="input h-11"
              value={activeChoice.barcodeId}
              onChange={event => setSelectedChoiceId(event.target.value)}
            >
              {props.choices.map(choice => (
                <option key={choice.barcodeId} value={choice.barcodeId}>
                  {choice.unitName} · {choice.barcode}
                </option>
              ))}
            </select>
          </label>}
          <div className="mb-5 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <label className="space-y-1.5 text-xs font-semibold text-gray-700">
              <span>{t('barcodeLabels.copies')}</span>
              <input
                data-autofocus
                type="number"
                min={1}
                max={500}
                step={1}
                value={copies}
                onChange={event => setCopies(Math.floor(Number(event.target.value)))}
                className="input h-11 tabular-nums"
              />
            </label>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-800">{t('barcodeLabels.quickPrint.sameIdentity')}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">{t('barcodeLabels.quickPrint.sameIdentityHelp')}</p>
              <p className="mt-1.5 truncate font-mono text-[11px] font-semibold tabular-nums text-gray-700" dir="ltr">
                {activeChoice.barcode}
              </p>
            </div>
          </div>
          {copies > 50 && <label className="mb-5 block space-y-1.5 text-xs font-semibold text-gray-700">
            <span>{t('barcodeLabels.audit.reason')}</span>
            <input
              value={reason}
              maxLength={200}
              onChange={event => setReason(event.target.value)}
              placeholder={t('barcodeLabels.audit.reasonPlaceholder')}
              className="input"
            />
          </label>}
          {error && <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}
          </div>}
          <BarcodeLabelDesigner
            labels={[label]}
            settings={settings}
            calibration={calibration}
            onChange={setSettings}
            previewDataLabel={t('barcodeLabels.preview.actualData')}
          />
          {fitStatus === 'overflow' && <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <input
              type="checkbox"
              checked={overflowAcknowledged}
              onChange={event => setOverflowAcknowledged(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-amber-700"
            />
            <span>
              <span className="block font-bold">{t('barcodeLabels.preview.overflowAcknowledgement')}</span>
              <span className="mt-0.5 block text-[11px] leading-5">{t('barcodeLabels.preview.testPrintWarning')}</span>
            </span>
          </label>}
        </>}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
        {props.onAddToBatch && <Button type="button" variant="secondary" onClick={props.onAddToBatch} disabled={printing}>
          <Layers3 size={14} aria-hidden="true" /> {t('barcodeLabels.batch.addToQueue')}
        </Button>}
        <span className="min-w-0 flex-1 text-[10px] text-gray-500">{t('barcodeLabels.preview.dialogGuidance')}</span>
        <Button type="button" variant="secondary" onClick={preview} disabled={loading || printing}>
          {t('barcodeLabels.actions.preview')}
        </Button>
        <Button type="button" onClick={() => void print()} loading={printing} disabled={loading || (fitStatus === 'overflow' && !overflowAcknowledged)}>
          <Printer size={14} aria-hidden="true" />
          {t(props.hasPrinted ? 'barcodeLabels.audit.reprint' : 'barcodeLabels.audit.printLabel')}
        </Button>
      </footer>
    </div>
  </div>
}
