import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Eye, LayoutTemplate, Maximize2, PackageCheck, Printer, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import {
  barcodePrintDocument,
  browserBarcodePrintAdapter,
  type BarcodeLabel,
  type BarcodePrintDocument,
} from '@/lib/barcodes/labelPrint'
import {
  applyLabelSize,
  LABEL_PRESETS,
  labelSizeOptions,
  PRIMARY_LABEL_PRESET_IDS,
  settingsFromPreset,
  type BarcodeDeviceCalibration,
  type BarcodeLabelSettings,
  type LabelContentSettings,
  type RetailLabelPresetId,
} from '@/lib/barcodes/labelSettings'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  DocumentStudioPreviewToolbar,
  DocumentStudioSectionNav,
  DocumentStudioWorkspace,
} from '@/components/printing/DocumentStudioShell'

interface Props {
  labels: BarcodeLabel[]
  settings: BarcodeLabelSettings
  calibration: BarcodeDeviceCalibration
  onChange: (settings: BarcodeLabelSettings) => void
  previewDataLabel?: string
  compact?: boolean
  studio?: {
    actionFooter: ReactNode
    printerAdjustment: ReactNode
  }
}

type BarcodeStudioSection = 'layout' | 'size' | 'information' | 'appearance' | 'printer'
const BARCODE_STUDIO_SECTIONS: readonly BarcodeStudioSection[] = ['layout', 'size', 'information', 'appearance', 'printer']

const optionalContent: (keyof LabelContentSettings)[] = [
  'unitName',
  'sku',
  'businessName',
]

function LayoutMiniature({ id }: { id: RetailLabelPresetId }) {
  if (id === 'compact_sticker') return <span className="grid h-11 w-[76px] grid-rows-[auto_1fr_auto] gap-1 rounded border border-gray-300 bg-white p-1" aria-hidden="true"><i className="h-1 w-3/5 bg-gray-800" /><i className="w-full bg-[repeating-linear-gradient(90deg,#111_0_1px,transparent_1px_3px)]" /><i className="ms-auto h-1.5 w-1/3 bg-emerald-700" /></span>
  if (id === 'standard_product') return <span className="grid h-12 w-[82px] grid-cols-[1fr_auto] grid-rows-[auto_1fr] gap-1 rounded border border-gray-300 bg-white p-1" aria-hidden="true"><i className="col-span-2 h-1 border-b border-gray-500" /><i className="bg-[repeating-linear-gradient(90deg,#111_0_1px,transparent_1px_3px)]" /><i className="h-5 w-5 border border-gray-500 bg-emerald-50" /></span>
  if (id === 'detailed_product') return <span className="grid h-12 w-[88px] grid-cols-[1.4fr_.8fr] grid-rows-[auto_1fr] gap-1 rounded border border-gray-400 bg-white p-1" aria-hidden="true"><i className="col-span-2 h-2 border-b border-gray-500 bg-gray-100" /><i className="border border-gray-400 bg-[repeating-linear-gradient(90deg,#111_0_1px,transparent_1px_3px)]" /><i className="border-2 border-gray-700 bg-emerald-50" /></span>
  return <span className="grid h-10 w-24 grid-cols-[1fr_.8fr] gap-1.5 rounded border border-gray-400 bg-white p-1" aria-hidden="true"><i className="border-e-2 border-gray-700 bg-gray-100" /><i className="bg-[repeating-linear-gradient(90deg,#111_0_1px,transparent_1px_3px)]" /></span>
}

export function BarcodeLabelPreview({
  document,
  title,
  dimensions,
  bare = false,
}: {
  document: BarcodePrintDocument | null
  title: string
  dimensions?: string
  bare?: boolean
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
  return <div className={`overflow-hidden bg-[#e7ece8] ${bare ? 'flex min-h-full flex-col' : 'rounded-2xl border border-gray-200 shadow-inner'}`}>
    {!bare && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2.5">
      <div>
        <p className="text-xs font-bold text-gray-900">{title}</p>
        <p className="text-[10px] text-gray-500">
          {dimensions && <bdi className="font-semibold tabular-nums text-gray-700" dir="ltr">{dimensions}</bdi>}
          {dimensions && <span aria-hidden="true"> · </span>}
          {t('barcodeLabels.preview.safeBoundary')}
        </p>
      </div>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${statusClass}`} role="status" aria-live="polite">
        {fitStatus === 'safe' ? <Check size={11} aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />}
        {t(`barcodeLabels.preview.fitStatus.${fitStatus}`)}
      </span>
    </div>}
    <iframe
      title={title}
      sandbox="allow-scripts allow-modals"
      srcDoc={document.html}
      className={bare ? 'min-h-[420px] w-full flex-1 bg-white' : 'h-[clamp(300px,50vh,480px)] w-full bg-white [@media(max-height:740px)]:h-[310px]'}
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
  studio,
}: Props) {
  const { t, i18n } = useTranslation('printing')
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState('')
  const [resetPresetOpen, setResetPresetOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSection = searchParams.get('section') as BarcodeStudioSection | null
  const [activeSection, setActiveSection] = useState<BarcodeStudioSection>(
    requestedSection && BARCODE_STUDIO_SECTIONS.includes(requestedSection) ? requestedSection : 'layout',
  )
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
  useEffect(() => {
    if (!studio) return
    const requested = searchParams.get('section') as BarcodeStudioSection | null
    if (requested && BARCODE_STUDIO_SECTIONS.includes(requested)) {
      setActiveSection(requested)
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('section', 'layout')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, !!studio])

  const update = <K extends keyof BarcodeLabelSettings>(key: K, value: BarcodeLabelSettings[K]) =>
    onChange({ ...settings, [key]: value })
  const updateContent = (key: keyof LabelContentSettings, value: boolean) => {
    const next = { ...settings.content, [key]: value }
    if (!Object.values(next).some(Boolean)) return
    update('content', next)
  }
  const secondaryEnabled = settings.content.productNameAr || settings.content.productNameEn
  const applyPreset = (id: RetailLabelPresetId) => onChange(settingsFromPreset(id))
  const selectSection = (id: string) => {
    const nextSection = BARCODE_STUDIO_SECTIONS.includes(id as BarcodeStudioSection) ? id as BarcodeStudioSection : 'layout'
    setActiveSection(nextSection)
    const next = new URLSearchParams(searchParams)
    next.set('section', nextSection)
    setSearchParams(next)
  }
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

  const configuration = <div className="min-w-0 space-y-3">
      <section className={`${studio && activeSection !== 'layout' ? 'hidden' : ''} rounded-xl border border-gray-200 bg-[#fbfcfb] p-4`}>
        <div className="mb-3">
          <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.design.title')}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{t('barcodeLabels.design.help')}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRIMARY_LABEL_PRESET_IDS.map(id => {
            const selected = settings.presetId === id
            return <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => applyPreset(id)}
              className={`relative flex min-h-24 items-center gap-3 rounded-xl border p-3 text-start outline-none transition-[border-color,background-color,transform] duration-150 active:scale-[.98] focus-visible:ring-2 focus-visible:ring-primary-500 ${
                selected ? 'border-emerald-700 bg-emerald-50/80 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <LayoutMiniature id={id} />
              <span className="min-w-0 flex-1">
                <span className="block pe-5 text-xs font-bold text-gray-900">{t(`barcodeLabels.presets.${id}.name`)}</span>
                <span className="mt-1 block text-[10px] leading-4 text-gray-500">{t(`barcodeLabels.presets.${id}.use`)}</span>
              </span>
              {selected && <Check size={14} className="absolute end-2.5 top-2.5 text-emerald-700" aria-hidden="true" />}
            </button>
          })}
        </div>
      </section>

      <section className={`${studio && activeSection !== 'size' ? 'hidden' : ''} rounded-xl border border-gray-200 bg-white p-4`}>
        <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.size.title')}</h3>
        <p className="mt-0.5 text-[11px] text-gray-500">{t('barcodeLabels.size.help')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {labelSizeOptions(settings.presetId).map(size => {
            const selected = settings.widthMm === size.widthMm && settings.heightMm === size.heightMm
            return <button key={size.id} type="button" aria-pressed={selected} onClick={() => onChange(applyLabelSize(settings, size))}
              className={`rounded-xl border px-3 py-2 text-xs font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${selected ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}
              dir="ltr">
              {size.widthMm} × {size.heightMm} {t('barcodeLabels.units.mm')}
            </button>
          })}
        </div>
      </section>

      <section className={`${studio && activeSection !== 'information' ? 'hidden' : ''} rounded-xl border border-gray-200 bg-white p-4`}>
        <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.content.title')}</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(['productName', 'sellingPrice', 'barcodeValue'] as const).map(key => <label key={key} className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2">
            <span className="text-xs font-semibold text-gray-800">{t(`barcodeLabels.content.${key}`)}</span>
            <input type="checkbox" checked={settings.content[key]} onChange={event => updateContent(key, event.target.checked)} className="h-4 w-4 accent-primary-700" />
          </label>)}
          <div className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-xs font-semibold text-gray-800">{t('barcodeLabels.content.barcodeGraphic')}</span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"><Check size={12} />{t('barcodeLabels.content.required')}</span>
          </div>
          {optionalContent.map(key => <label key={key} className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <span className="text-xs font-medium text-gray-700">{t(`barcodeLabels.content.${key}`)}</span>
            <input type="checkbox" checked={settings.content[key]} onChange={event => updateContent(key, event.target.checked)} className="h-4 w-4 accent-primary-700" />
          </label>)}
          <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <span className="text-xs font-medium text-gray-700">{t('barcodeLabels.content.secondaryName')}</span>
            <input type="checkbox" checked={secondaryEnabled} onChange={event => update('content', { ...settings.content, productNameAr: event.target.checked, productNameEn: event.target.checked })} className="h-4 w-4 accent-primary-700" />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-gray-400">{t('barcodeLabels.content.barcodeAlwaysIncluded')}</p>
      </section>

      <section className={`${studio && activeSection !== 'appearance' ? 'hidden' : ''} rounded-xl border border-gray-200 bg-white p-4`}>
        <h3 className="text-sm font-bold text-gray-950">{t('barcodeLabels.appearance.title')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.appearance.textSize')}</span>
            <select className="input h-10" value={settings.productNameSize} onChange={event => update('productNameSize', event.target.value as BarcodeLabelSettings['productNameSize'])}>
              <option value="small">{t('barcodeLabels.nameSize.small')}</option><option value="normal">{t('barcodeLabels.nameSize.medium')}</option><option value="large">{t('barcodeLabels.nameSize.large')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.appearance.barcodeSize')}</span>
            <select className="input h-10" value={settings.barcodeHeightMm >= LABEL_PRESETS[settings.presetId].barcodeHeightMm + 4 ? 'large' : 'standard'} onChange={event => update('barcodeHeightMm', event.target.value === 'large' ? Math.min(40, LABEL_PRESETS[settings.presetId].barcodeHeightMm + 4) : LABEL_PRESETS[settings.presetId].barcodeHeightMm)}>
              <option value="standard">{t('barcodeLabels.appearance.standard')}</option><option value="large">{t('barcodeLabels.appearance.large')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.appearance.priceEmphasis')}</span>
            <select className="input h-10" value={settings.priceStyle} onChange={event => update('priceStyle', event.target.value as BarcodeLabelSettings['priceStyle'])}>
              <option value="normal">{t('barcodeLabels.priceStyle.normal')}</option><option value="large">{t('barcodeLabels.priceStyle.strong')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-semibold text-gray-600">
            <span>{t('barcodeLabels.appearance.alignment')}</span>
            <select className="input h-10" value={settings.textAlignment} onChange={event => update('textAlignment', event.target.value as BarcodeLabelSettings['textAlignment'])}>
              <option value="start">{t('barcodeLabels.alignment.start')}</option><option value="center">{t('barcodeLabels.alignment.center')}</option>
            </select>
          </label>
        </div>
        <button type="button" onClick={() => setResetPresetOpen(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-100">
          <RotateCcw size={13} aria-hidden="true" />{t('barcodeLabels.actions.resetPreset')}
        </button>
      </section>
      {studio && activeSection === 'printer' && <section className="rounded-xl border border-gray-200 bg-white p-3">{studio.printerAdjustment}</section>}
      <ConfirmDialog open={resetPresetOpen} kind="resetLabelPreset" onClose={() => setResetPresetOpen(false)} onConfirm={() => { applyPreset(settings.presetId as RetailLabelPresetId); setResetPresetOpen(false) }} />
    </div>

  const previewPanel = <aside className={`${compact ? '' : 'xl:sticky xl:top-4'} min-w-0`}>
      <BarcodeLabelPreview document={preview} title={t('barcodeLabels.preview.title')} dimensions={`${settings.widthMm} × ${settings.heightMm} ${t('barcodeLabels.units.mm')}`} />
      {preview?.layout.warnings.length ? <div className="mt-2 rounded-xl border border-amber-200 border-s-4 bg-[#fffaf0] p-3 text-[11px] leading-5 text-gray-700" role="status" aria-live="polite">
        <p className="flex items-start gap-1.5 font-bold"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{t(preview.layout.contentFitStatus === 'overflow' ? 'barcodeLabels.preview.denseTitleOverflow' : 'barcodeLabels.preview.denseTitle')}</p>
        {preview.layout.warnings.map(warning => <p key={warning}>{t(`barcodeLabels.preview.warnings.${warning}`)}</p>)}
        <p className="font-semibold">{t('barcodeLabels.preview.fitGuidance')}</p>
      </div> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={printPreview} loading={printing} disabled={!preview || printing} className="bg-primary-700 hover:bg-primary-800 active:scale-[0.97]">
          <Printer size={15} aria-hidden="true" /> {t('barcodeLabels.actions.print')}
        </Button>
        <span className="text-[10px] text-gray-500">{t('barcodeLabels.preview.saveAsPdf')}</span>
        {!preview && <span className="text-[11px] text-red-700">{t('barcodeLabels.preview.printUnavailable')}</span>}
        {printError && <span role="alert" className="text-[11px] text-red-700">{printError}</span>}
      </div>
    </aside>

  if (studio) {
    const fitStatus = !preview?.layout.fits || preview.layout.contentFitStatus === 'overflow'
      ? 'overflow'
      : preview.layout.contentFitStatus
    const statusClass = fitStatus === 'safe'
      ? 'bg-emerald-50 text-emerald-700'
      : fitStatus === 'tight'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-red-50 text-red-700'
    const sections = [
      { id: 'layout', label: t('barcodeLabels.studio.sections.layout'), icon: LayoutTemplate },
      { id: 'size', label: t('barcodeLabels.studio.sections.size'), icon: Maximize2 },
      { id: 'information', label: t('barcodeLabels.studio.sections.information'), icon: PackageCheck },
      { id: 'appearance', label: t('barcodeLabels.studio.sections.appearance'), icon: Eye },
      { id: 'printer', label: t('barcodeLabels.studio.sections.printer'), icon: SlidersHorizontal },
    ]
    return <DocumentStudioWorkspace
      configurationLabel={t('workspace.studio.configuration')}
      previewLabel={t('barcodeLabels.preview.title')}
      settingsLabel={t('workspace.studio.settings')}
      closeSettingsLabel={t('workspace.studio.closeSettings')}
      sectionNavigation={<DocumentStudioSectionNav sections={sections} activeSection={activeSection} onSelect={selectSection} label={t('barcodeLabels.studio.navigation')} />}
      configuration={configuration}
      previewToolbar={<DocumentStudioPreviewToolbar
        title={t('barcodeLabels.preview.title')}
        meta={<><bdi className="font-semibold tabular-nums text-gray-700" dir="ltr">{settings.widthMm} × {settings.heightMm} {t('barcodeLabels.units.mm')}</bdi><span aria-hidden="true"> · </span>{t(`barcodeLabels.presets.${settings.presetId}.name`)}</>}
      >
        <span className={`inline-flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-semibold ${statusClass}`} role="status">
          {fitStatus === 'safe' ? <Check size={11} aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />}
          {t(`barcodeLabels.preview.fitStatus.${fitStatus}`)}
        </span>
        <Button type="button" size="sm" onClick={printPreview} loading={printing} disabled={!preview || printing} className="h-8 bg-primary-700 active:scale-[.97]">
          <Printer size={14} aria-hidden="true" /> {t('barcodeLabels.actions.print')}
        </Button>
      </DocumentStudioPreviewToolbar>}
      preview={<div className="mx-auto flex min-h-full max-w-full flex-col justify-center">
        <BarcodeLabelPreview document={preview} title={t('barcodeLabels.preview.title')} dimensions={`${settings.widthMm} × ${settings.heightMm} ${t('barcodeLabels.units.mm')}`} bare />
        {preview?.layout.warnings.length ? <div className="mx-auto mt-2 w-full max-w-2xl rounded-xl border border-amber-200 border-s-4 bg-[#fffaf0] p-3 text-[11px] leading-5 text-gray-700" role="status" aria-live="polite">
          <p className="flex items-start gap-1.5 font-bold"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{t(preview.layout.contentFitStatus === 'overflow' ? 'barcodeLabels.preview.denseTitleOverflow' : 'barcodeLabels.preview.denseTitle')}</p>
          {preview.layout.warnings.map(warning => <p key={warning}>{t(`barcodeLabels.preview.warnings.${warning}`)}</p>)}
          <p className="font-semibold">{t('barcodeLabels.preview.fitGuidance')}</p>
        </div> : null}
        {printError && <p role="alert" className="mx-auto mt-2 text-[11px] text-red-700">{printError}</p>}
      </div>}
      actionFooter={studio.actionFooter}
    />
  }

  return <div className={`grid items-start gap-5 ${compact ? '' : 'xl:grid-cols-[minmax(0,1fr)_minmax(380px,.9fr)]'}`}>{configuration}{previewPanel}</div>
}
