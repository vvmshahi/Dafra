import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Printer, RotateCcw, Save, TestTube2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { getPrinters, isElectron } from '@/lib/electron'
import { getBranchBarcodeLabelSettings } from '@/lib/barcodes/labelApi'
import {
  barcodePrintDocument,
  browserBarcodePrintAdapter,
  type BarcodeLabel,
} from '@/lib/barcodes/labelPrint'
import {
  DEFAULT_BARCODE_DEVICE_CALIBRATION,
  DEFAULT_BARCODE_LABEL_SETTINGS,
  loadBarcodeDeviceCalibration,
  resetBarcodeDeviceCalibration,
  saveBarcodeDeviceCalibration,
  type BarcodeDeviceCalibration,
  type BarcodeLabelSettings,
} from '@/lib/barcodes/labelSettings'

interface Props {
  branchId: string
  businessName: string | null
}

function CalibrationButton({
  label, icon: Icon, onClick,
}: {
  label: string
  icon: React.ElementType
  onClick: () => void
}) {
  return <button type="button" onClick={onClick} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 outline-none transition-[transform,border-color] duration-150 active:scale-[.97] focus-visible:ring-2 focus-visible:ring-primary-500">
    <Icon size={14} aria-hidden="true" /> {label}
  </button>
}

export default function BarcodePrinterSetupPanel({ branchId, businessName }: Props) {
  const { t, i18n } = useTranslation('printing')
  const [calibration, setCalibration] = useState<BarcodeDeviceCalibration>(DEFAULT_BARCODE_DEVICE_CALIBRATION)
  const [saved, setSaved] = useState<BarcodeDeviceCalibration>(DEFAULT_BARCODE_DEVICE_CALIBRATION)
  const [settings, setSettings] = useState<BarcodeLabelSettings>(DEFAULT_BARCODE_LABEL_SETTINGS)
  const [printers, setPrinters] = useState<{ name: string }[]>([])
  const [status, setStatus] = useState('')
  const dirty = JSON.stringify(calibration) !== JSON.stringify(saved)
  const sample = useMemo<BarcodeLabel>(() => ({
    barcode: 'DF001234567890123456',
    barcodeType: 'code128',
    businessName,
    productName: t('barcodeLabels.calibration.sampleProduct'),
    productNameAr: t('barcodeLabels.preview.sampleProductAr'),
    unitName: t('barcodeLabels.preview.sampleUnit'),
    price: t('barcodeLabels.preview.samplePrice'),
    sku: 'TEST-001',
    copies: 1,
  }), [businessName, t])
  const testSettings = useMemo(() => ({
    ...settings,
    orientation: calibration.orientationOverride === 'branch'
      ? settings.orientation
      : calibration.orientationOverride,
    outputMode: 'thermal' as const,
  }), [settings, calibration.orientationOverride])
  const preview = useMemo(() => {
    try {
      return barcodePrintDocument([sample], testSettings, calibration, {
        preview: true,
        calibrationPattern: true,
        locale: i18n.language,
        copy: {
          title: t('barcodeLabels.calibration.testPattern'),
          print: t('barcodeLabels.actions.print'),
          saveAsPdf: t('barcodeLabels.preview.saveAsPdf'),
          dialogGuidance: t('barcodeLabels.preview.dialogGuidance'),
          riyalAccessible: t('barcodeLabels.currency.accessible'),
        },
      })
    } catch {
      return null
    }
  }, [sample, testSettings, calibration, t, i18n.language])

  useEffect(() => {
    const local = loadBarcodeDeviceCalibration()
    setCalibration(local)
    setSaved(local)
    void getBranchBarcodeLabelSettings(branchId)
      .then(result => setSettings(result.settings))
      .catch(() => setSettings(DEFAULT_BARCODE_LABEL_SETTINGS))
    if (isElectron()) void getPrinters().then(list => setPrinters(list as { name: string }[])).catch(() => setPrinters([]))
  }, [branchId])

  const update = <K extends keyof BarcodeDeviceCalibration>(key: K, value: BarcodeDeviceCalibration[K]) =>
    setCalibration(current => ({ ...current, [key]: value }))
  const move = (axis: 'horizontalOffsetMm' | 'verticalOffsetMm', amount: number) =>
    setCalibration(current => ({ ...current, [axis]: Math.max(-10, Math.min(10, current[axis] + amount)) }))
  const scale = (axis: 'widthScalePercent' | 'heightScalePercent', amount: number) =>
    setCalibration(current => ({ ...current, [axis]: Math.max(90, Math.min(110, current[axis] + amount)) }))
  const save = () => {
    const next = saveBarcodeDeviceCalibration(calibration)
    setCalibration(next)
    setSaved(next)
    setStatus(t('barcodeLabels.calibration.saved'))
  }
  const reset = () => {
    const next = resetBarcodeDeviceCalibration()
    setCalibration(next)
    setSaved(next)
    setStatus(t('barcodeLabels.calibration.resetDone'))
  }
  const printTest = () => {
    if (!preview) return
    browserBarcodePrintAdapter.print(barcodePrintDocument([sample], testSettings, calibration, {
      calibrationPattern: true,
      locale: i18n.language,
      copy: {
        title: t('barcodeLabels.calibration.testPattern'),
        print: t('barcodeLabels.actions.print'),
        saveAsPdf: t('barcodeLabels.preview.saveAsPdf'),
        dialogGuidance: t('barcodeLabels.preview.dialogGuidance'),
        riyalAccessible: t('barcodeLabels.currency.accessible'),
      },
    }).html)
  }

  return <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
    <div className="space-y-5">
      <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-700 shadow-sm"><Printer size={18} aria-hidden="true" /></span>
          <div>
            <h2 className="text-base font-bold text-gray-950">{t('barcodeLabels.calibration.title')}</h2>
            <p className="mt-1 text-xs leading-5 text-gray-600">{t('barcodeLabels.calibration.help')}</p>
            <p className="mt-2 text-[10px] font-semibold text-blue-800">{t('barcodeLabels.calibration.deviceOnly')}</p>
          </div>
        </div>
      </section>

      {isElectron() && <label className="block space-y-1.5 text-xs font-semibold text-gray-700">
        <span>{t('barcodeLabels.calibration.printer')}</span>
        <select className="input" value={calibration.printerName ?? ''} onChange={event => update('printerName', event.target.value || null)}>
          <option value="">{t('barcodeLabels.calibration.systemDialog')}</option>
          {printers.map(printer => <option key={printer.name} value={printer.name}>{printer.name}</option>)}
        </select>
      </label>}

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.calibration.position')}</h3>
        <p className="mt-1 text-[11px] text-gray-500">{t('barcodeLabels.calibration.positionHelp')}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <CalibrationButton label={t('barcodeLabels.calibration.moveLeft')} icon={ArrowLeft} onClick={() => move('horizontalOffsetMm', -0.5)} />
          <CalibrationButton label={t('barcodeLabels.calibration.moveRight')} icon={ArrowRight} onClick={() => move('horizontalOffsetMm', 0.5)} />
          <CalibrationButton label={t('barcodeLabels.calibration.moveUp')} icon={ArrowUp} onClick={() => move('verticalOffsetMm', -0.5)} />
          <CalibrationButton label={t('barcodeLabels.calibration.moveDown')} icon={ArrowDown} onClick={() => move('verticalOffsetMm', 0.5)} />
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.calibration.size')}</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <CalibrationButton label={t('barcodeLabels.calibration.narrower')} icon={ArrowLeft} onClick={() => scale('widthScalePercent', -1)} />
          <CalibrationButton label={t('barcodeLabels.calibration.wider')} icon={ArrowRight} onClick={() => scale('widthScalePercent', 1)} />
          <CalibrationButton label={t('barcodeLabels.calibration.shorter')} icon={ArrowUp} onClick={() => scale('heightScalePercent', -1)} />
          <CalibrationButton label={t('barcodeLabels.calibration.taller')} icon={ArrowDown} onClick={() => scale('heightScalePercent', 1)} />
        </div>
      </section>

      <details className="rounded-2xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-900">{t('barcodeLabels.advanced.title')}</summary>
        <div className="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-2">
          {([
            ['horizontalOffsetMm', 'horizontalOffset', -10, 10, 0.1],
            ['verticalOffsetMm', 'verticalOffset', -10, 10, 0.1],
            ['widthScalePercent', 'widthScale', 90, 110, 0.5],
            ['heightScalePercent', 'heightScale', 90, 110, 0.5],
          ] as const).map(([key, label, min, max, step]) => <label key={key} className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t(`barcodeLabels.calibration.${label}`)}</span>
            <input type="number" min={min} max={max} step={step} value={calibration[key]} onChange={event => update(key, Number(event.target.value))} className="input tabular-nums" />
          </label>)}
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.calibration.orientation')}</span>
            <select className="input" value={calibration.orientationOverride} onChange={event => update('orientationOverride', event.target.value as BarcodeDeviceCalibration['orientationOverride'])}>
              <option value="branch">{t('barcodeLabels.calibration.useLabelSetting')}</option>
              <option value="portrait">{t('barcodeLabels.orientation.portrait')}</option>
              <option value="landscape">{t('barcodeLabels.orientation.landscape')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.calibration.quality')}</span>
            <select className="input" value={calibration.quality} onChange={event => update('quality', event.target.value as BarcodeDeviceCalibration['quality'])}>
              <option value="draft">{t('barcodeLabels.calibration.qualityDraft')}</option>
              <option value="normal">{t('barcodeLabels.calibration.qualityNormal')}</option>
              <option value="high">{t('barcodeLabels.calibration.qualityHigh')}</option>
            </select>
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={!dirty}><Save size={14} aria-hidden="true" /> {t('barcodeLabels.calibration.save')}</Button>
        <Button type="button" variant="secondary" onClick={printTest}><TestTube2 size={14} aria-hidden="true" /> {t('barcodeLabels.calibration.printTest')}</Button>
        <Button type="button" variant="ghost" onClick={reset}><RotateCcw size={14} aria-hidden="true" /> {t('barcodeLabels.calibration.reset')}</Button>
        {status && <span className="inline-flex items-center gap-1 text-xs text-emerald-700" role="status"><Check size={13} aria-hidden="true" /> {status}</span>}
      </div>
      <p className="rounded-xl bg-gray-50 px-3 py-2 text-[11px] leading-5 text-gray-600">{t('barcodeLabels.calibration.gapGuidance')}</p>
    </div>

    <aside className="xl:sticky xl:top-4">
      {preview && <div className="overflow-hidden rounded-2xl border border-gray-200 bg-[#e9eeeb]">
        <div className="border-b border-gray-200 bg-white px-3 py-2">
          <p className="text-xs font-bold text-gray-900">{t('barcodeLabels.calibration.liveTest')}</p>
          <p className="text-[10px] tabular-nums text-gray-500" dir="ltr">
            X {calibration.horizontalOffsetMm.toFixed(1)} {t('barcodeLabels.units.mm')} · Y {calibration.verticalOffsetMm.toFixed(1)} {t('barcodeLabels.units.mm')} · {calibration.widthScalePercent}% × {calibration.heightScalePercent}%
          </p>
        </div>
        <iframe title={t('barcodeLabels.calibration.liveTest')} sandbox="allow-scripts allow-modals" srcDoc={preview.html} className="h-[520px] w-full bg-white" />
      </div>}
    </aside>
  </div>
}
