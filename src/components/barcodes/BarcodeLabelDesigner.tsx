import { useDeferredValue, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Eye, Printer, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import {
  barcodePrintDocument,
  browserBarcodePrintAdapter,
  type BarcodeLabel,
  type BarcodePrintDocument,
} from '@/lib/barcodes/labelPrint'
import {
  LABEL_PRESETS,
  settingsFromPreset,
  type BarcodeDeviceCalibration,
  type BarcodeLabelSettings,
  type LabelContentSettings,
  type LabelPresetId,
  type LabelTemplateId,
} from '@/lib/barcodes/labelSettings'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface Props {
  labels: BarcodeLabel[]
  settings: BarcodeLabelSettings
  calibration: BarcodeDeviceCalibration
  onChange: (settings: BarcodeLabelSettings) => void
  previewDataLabel?: string
  compact?: boolean
}

const presetIds = Object.keys(LABEL_PRESETS) as LabelPresetId[]
const templates: LabelTemplateId[] = ['compact', 'standard', 'detailed']
const contentKeys: (keyof LabelContentSettings)[] = [
  'productName', 'productNameAr', 'productNameEn', 'sellingPrice', 'unitName',
  'sku', 'businessName', 'barcodeValue', 'printDate',
]

function NumberField({
  label, value, min, max, step = 1, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return <label className="space-y-1.5 text-xs font-semibold text-gray-600">
    <span>{label}</span>
    <input
      type="number"
      className="input h-10 tabular-nums"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={event => onChange(Number(event.target.value))}
    />
  </label>
}

export function BarcodeLabelPreview({
  document,
  title,
}: {
  document: BarcodePrintDocument | null
  title: string
}) {
  const { t } = useTranslation('printing')
  if (!document) {
    return <div className="grid min-h-72 place-items-center rounded-2xl border border-red-100 bg-red-50 p-5 text-center text-xs text-red-700" role="alert">
      {t('barcodeLabels.preview.invalidBarcode')}
    </div>
  }
  const fitStatus = !document.layout.fits || document.layout.contentFitStatus === 'overflow'
    ? 'overflow'
    : document.layout.contentFitStatus
  const statusClass = fitStatus === 'safe'
    ? 'bg-emerald-50 text-emerald-700'
    : fitStatus === 'tight'
      ? 'bg-amber-50 text-amber-800'
      : 'bg-red-50 text-red-700'
  return <div className="overflow-hidden rounded-2xl border border-gray-200 bg-[#e9eeeb] shadow-inner">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
      <div>
        <p className="text-xs font-bold text-gray-900">{title}</p>
        <p className="text-[10px] text-gray-500">
          {t('barcodeLabels.preview.pageSummary', {
            pages: document.layout.pageCount,
            labels: document.layout.labelCount,
            final: document.layout.labelsOnFinalPage,
          })}
        </p>
      </div>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass}`} role="status" aria-live="polite">
        {fitStatus === 'safe'
          ? <Check size={11} aria-hidden="true" />
          : <AlertTriangle size={11} aria-hidden="true" />}
        {t(`barcodeLabels.preview.fitStatus.${fitStatus}`)}
      </span>
    </div>
    <iframe
      title={title}
      sandbox="allow-scripts allow-modals"
      srcDoc={document.html}
      className="h-[clamp(280px,48vh,460px)] w-full bg-white [@media(max-height:740px)]:h-[300px]"
    />
  </div>
}

export default function BarcodeLabelDesigner({
  labels,
  settings,
  calibration,
  onChange,
  previewDataLabel,
  compact = false,
}: Props) {
  const { t, i18n } = useTranslation('printing')
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')
  const [resetPresetOpen, setResetPresetOpen] = useState(false)
  const deferredLabels = useDeferredValue(labels)
  const deferredSettings = useDeferredValue(settings)
  const preview = useMemo(() => {
    try {
      return barcodePrintDocument(deferredLabels, deferredSettings, calibration, {
        preview: true,
        allowPrint: false,
        locale: i18n.language,
        copy: {
          title: t('barcodeLabels.preview.title'),
          print: t('barcodeLabels.actions.print'),
          saveAsPdf: t('barcodeLabels.preview.saveAsPdf'),
          dialogGuidance: t('barcodeLabels.preview.dialogGuidance'),
          previewData: previewDataLabel,
          riyalAccessible: t('barcodeLabels.currency.accessible'),
        },
      })
    } catch {
      return null
    }
  }, [deferredLabels, deferredSettings, calibration, t, previewDataLabel, i18n.language])

  const update = <K extends keyof BarcodeLabelSettings>(key: K, value: BarcodeLabelSettings[K]) =>
    onChange({ ...settings, [key]: value })
  const updateContent = (key: keyof LabelContentSettings, value: boolean) => {
    const next = { ...settings.content, [key]: value }
    if (!Object.values(next).some(Boolean)) return
    update('content', next)
  }
  const updateA4 = <K extends keyof BarcodeLabelSettings['a4']>(
    key: K,
    value: BarcodeLabelSettings['a4'][K],
  ) => update('a4', { ...settings.a4, [key]: value })
  const applyPreset = (id: LabelPresetId) => onChange(settingsFromPreset(id))
  const printPreview = () => {
    if (!preview || printing) return
    setPrinting(true)
    setPrintError('')
    try {
      const printable = barcodePrintDocument(labels, settings, calibration, {
        locale: i18n.language,
        copy: {
          title: t('barcodeLabels.preview.title'),
          print: t('barcodeLabels.actions.print'),
          saveAsPdf: t('barcodeLabels.preview.saveAsPdf'),
          dialogGuidance: t('barcodeLabels.preview.dialogGuidance'),
          previewData: previewDataLabel,
          riyalAccessible: t('barcodeLabels.currency.accessible'),
        },
      })
      browserBarcodePrintAdapter.print(printable.html)
    } catch {
      setPrintError(t('barcodeLabels.errors.printFailed'))
    } finally {
      setPrinting(false)
    }
  }

  return <div className={`grid items-start gap-5 ${compact ? '' : 'xl:grid-cols-[minmax(0,1fr)_minmax(340px,.9fr)]'}`}>
    <div className="min-w-0 space-y-5">
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.design.title')}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{t('barcodeLabels.design.help')}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {presetIds.map(id => {
            const preset = LABEL_PRESETS[id]
            const selected = settings.presetId === id
            return <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => applyPreset(id)}
              className={`relative min-h-20 rounded-2xl border p-3 text-start outline-none transition-[border-color,background-color,transform] duration-150 active:scale-[.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${
                selected ? 'border-emerald-600 bg-emerald-50/70' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {selected && <Check size={14} className="absolute end-2.5 top-2.5 text-emerald-700" aria-hidden="true" />}
              <span className="block pe-5 text-xs font-bold text-gray-900">{t(`barcodeLabels.presets.${id}.name`)}</span>
              <span className="mt-1 block text-[10px] tabular-nums text-gray-500" dir="ltr">
                {id === 'a4_sheet'
                  ? t('barcodeLabels.presets.a4_sheet.dimensions')
                  : `${preset.widthMm} × ${preset.heightMm} ${t('barcodeLabels.units.mm')}`}
              </span>
            </button>
          })}
        </div>
        <button
          type="button"
          onClick={() => setResetPresetOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-100"
        >
          <RotateCcw size={13} aria-hidden="true" />
          {t('barcodeLabels.actions.resetPreset')}
        </button>
      </section>
      <ConfirmDialog open={resetPresetOpen} kind="resetLabelPreset" onClose={() => setResetPresetOpen(false)} onConfirm={() => { applyPreset(settings.presetId); setResetPresetOpen(false) }} />

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.templates.title')}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {templates.map(template => <button
            key={template}
            type="button"
            aria-pressed={settings.templateId === template}
            onClick={() => update('templateId', template)}
            className={`rounded-xl border px-2 py-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 ${
              settings.templateId === template
                ? 'border-primary-600 bg-primary-50 text-primary-800'
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {t(`barcodeLabels.templates.${template}`)}
          </button>)}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.content.title')}</h3>
        <p className="mt-0.5 text-[11px] text-gray-500">{t('barcodeLabels.content.help')}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {contentKeys.map(key => <label key={key} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <span className="text-xs font-medium text-gray-700">{t(`barcodeLabels.content.${key}`)}</span>
            <input
              type="checkbox"
              checked={settings.content[key]}
              onChange={event => updateContent(key, event.target.checked)}
              className="h-4 w-4 accent-primary-700"
            />
          </label>)}
        </div>
        <p className="mt-2 text-[10px] text-gray-400">{t('barcodeLabels.content.barcodeAlwaysIncluded')}</p>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.output.title')}</h3>
            <p className="mt-0.5 text-[11px] text-gray-500">{t('barcodeLabels.output.help')}</p>
          </div>
          <Printer size={17} className="text-gray-400" aria-hidden="true" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['thermal', 'a4'] as const).map(mode => <button
            key={mode}
            type="button"
            aria-pressed={settings.outputMode === mode}
            onClick={() => update('outputMode', mode)}
            className={`rounded-xl border px-3 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
              settings.outputMode === mode ? 'border-primary-600 bg-primary-50' : 'border-gray-200'
            }`}
          >
            <span className="block text-xs font-bold text-gray-900">{t(`barcodeLabels.output.${mode}.name`)}</span>
            <span className="mt-0.5 block text-[10px] text-gray-500">{t(`barcodeLabels.output.${mode}.help`)}</span>
          </button>)}
        </div>

        {settings.outputMode === 'a4' && <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-semibold text-gray-600">
              <span>{t('barcodeLabels.a4.orientation')}</span>
              <select className="input h-10" value={settings.a4.orientation} onChange={event => updateA4('orientation', event.target.value as 'portrait' | 'landscape')}>
                <option value="portrait">{t('barcodeLabels.orientation.portrait')}</option>
                <option value="landscape">{t('barcodeLabels.orientation.landscape')}</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t('barcodeLabels.a4.columns')} value={settings.a4.columns} min={1} max={10} onChange={value => updateA4('columns', Math.floor(value))} />
              <NumberField label={t('barcodeLabels.a4.rows')} value={settings.a4.rows} min={1} max={20} onChange={value => updateA4('rows', Math.floor(value))} />
            </div>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
            <p className="text-xs font-bold text-amber-900">{t('barcodeLabels.a4.startingPosition')}</p>
            <p className="mt-0.5 text-[10px] text-amber-800">{t('barcodeLabels.a4.startingPositionHelp')}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumberField label={t('barcodeLabels.a4.startRow')} value={settings.a4.startRow} min={1} max={settings.a4.rows} onChange={value => updateA4('startRow', Math.floor(value))} />
              <NumberField label={t('barcodeLabels.a4.startColumn')} value={settings.a4.startColumn} min={1} max={settings.a4.columns} onChange={value => updateA4('startColumn', Math.floor(value))} />
            </div>
          </div>
        </div>}
      </section>

      <details className="group rounded-2xl border border-gray-200 bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-gray-900">
          <SlidersHorizontal size={15} aria-hidden="true" />
          {t('barcodeLabels.advanced.title')}
          <ChevronDown size={14} className="ms-auto text-gray-400 group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="grid gap-3 border-t border-gray-100 p-4 sm:grid-cols-2">
          <NumberField label={t('barcodeLabels.advanced.width')} value={settings.widthMm} min={20} max={200} step={0.1} onChange={value => update('widthMm', value)} />
          <NumberField label={t('barcodeLabels.advanced.height')} value={settings.heightMm} min={15} max={200} step={0.1} onChange={value => update('heightMm', value)} />
          <NumberField label={t('barcodeLabels.advanced.margin')} value={settings.marginMm} min={0} max={10} step={0.1} onChange={value => update('marginMm', value)} />
          <NumberField label={t('barcodeLabels.advanced.barcodeHeight')} value={settings.barcodeHeightMm} min={6} max={40} step={0.5} onChange={value => update('barcodeHeightMm', value)} />
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.advanced.textAlignment')}</span>
            <select className="input h-10" value={settings.textAlignment} onChange={event => update('textAlignment', event.target.value as 'start' | 'center')}>
              <option value="start">{t('barcodeLabels.alignment.start')}</option>
              <option value="center">{t('barcodeLabels.alignment.center')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.advanced.priceStyle')}</span>
            <select className="input h-10" value={settings.priceStyle} onChange={event => update('priceStyle', event.target.value as 'normal' | 'large')}>
              <option value="normal">{t('barcodeLabels.priceStyle.normal')}</option>
              <option value="large">{t('barcodeLabels.priceStyle.large')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.advanced.orientation')}</span>
            <select className="input h-10" value={settings.orientation} onChange={event => update('orientation', event.target.value as 'portrait' | 'landscape')}>
              <option value="portrait">{t('barcodeLabels.orientation.portrait')}</option>
              <option value="landscape">{t('barcodeLabels.orientation.landscape')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.advanced.productNameSize')}</span>
            <select className="input h-10" value={settings.productNameSize} onChange={event => update('productNameSize', event.target.value as 'small' | 'normal' | 'large')}>
              <option value="small">{t('barcodeLabels.nameSize.small')}</option>
              <option value="normal">{t('barcodeLabels.nameSize.normal')}</option>
              <option value="large">{t('barcodeLabels.nameSize.large')}</option>
            </select>
          </label>
          {settings.outputMode === 'a4' && <>
            <NumberField label={t('barcodeLabels.a4.leftMargin')} value={settings.a4.marginLeftMm} min={0} max={30} step={0.1} onChange={value => updateA4('marginLeftMm', value)} />
            <NumberField label={t('barcodeLabels.a4.rightMargin')} value={settings.a4.marginRightMm} min={0} max={30} step={0.1} onChange={value => updateA4('marginRightMm', value)} />
            <NumberField label={t('barcodeLabels.a4.topMargin')} value={settings.a4.marginTopMm} min={0} max={30} step={0.1} onChange={value => updateA4('marginTopMm', value)} />
            <NumberField label={t('barcodeLabels.a4.bottomMargin')} value={settings.a4.marginBottomMm} min={0} max={30} step={0.1} onChange={value => updateA4('marginBottomMm', value)} />
            <NumberField label={t('barcodeLabels.a4.horizontalGap')} value={settings.a4.horizontalGapMm} min={0} max={20} step={0.1} onChange={value => updateA4('horizontalGapMm', value)} />
            <NumberField label={t('barcodeLabels.a4.verticalGap')} value={settings.a4.verticalGapMm} min={0} max={20} step={0.1} onChange={value => updateA4('verticalGapMm', value)} />
          </>}
        </div>
      </details>
    </div>

    <aside className={`${compact ? '' : 'xl:sticky xl:top-4'} min-w-0`}>
      {previewDataLabel && <div className="mb-2 flex items-start gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-[11px] text-primary-800">
        <Eye size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span><strong className="block font-semibold">{t('barcodeLabels.preview.sampleTitle')}</strong>{t('barcodeLabels.preview.sampleHelp')}</span>
      </div>}
      <BarcodeLabelPreview document={preview} title={t('barcodeLabels.preview.title')} />
      {preview?.layout.warnings.length ? <div className="mt-2 rounded-xl border border-amber-200 border-s-4 bg-[#fffaf0] p-3 text-[11px] leading-5 text-gray-700" role="status" aria-live="polite">
        <p className="flex items-start gap-1.5 font-bold">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t(!preview.layout.fits || preview.layout.contentFitStatus === 'overflow' ? 'barcodeLabels.preview.denseTitleOverflow' : 'barcodeLabels.preview.denseTitle')}
        </p>
        {preview.layout.warnings.map(warning => <p key={warning}>{t(`barcodeLabels.preview.warnings.${warning}`)}</p>)}
        <details className="mt-1"><summary className="cursor-pointer font-semibold text-primary-800">{t('barcodeLabels.preview.recommendations')}</summary>
          <p className="mt-1">{t('barcodeLabels.preview.fitGuidance')}</p>
          <p className="font-semibold">{t('barcodeLabels.preview.testPrintWarning')}</p>
        </details>
      </div> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={printPreview} loading={printing} disabled={!preview || printing}
          className="bg-primary-700 hover:bg-primary-800 active:scale-[0.97]">
          <Printer size={15} aria-hidden="true" /> {t('barcodeLabels.actions.print')}
        </Button>
        {!preview && <span className="text-[11px] text-red-700">{t('barcodeLabels.preview.printUnavailable')}</span>}
        {printError && <span role="alert" className="text-[11px] text-red-700">{printError}</span>}
      </div>
    </aside>
  </div>
}
