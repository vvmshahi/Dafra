import { RotateCcw, Scissors, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LetterheadCrop, LetterheadSource } from '@/lib/invoices/letterheadArtwork'
import { formatArtworkBytes } from '@/lib/invoices/letterheadArtwork'

interface Props {
  readonly source: LetterheadSource
  readonly header: LetterheadCrop
  readonly footer: LetterheadCrop
  readonly includeFooter: boolean
  readonly zoom: number
  readonly disabled?: boolean
  readonly onHeaderChange: (crop: LetterheadCrop) => void
  readonly onFooterChange: (crop: LetterheadCrop) => void
  readonly onIncludeFooterChange: (enabled: boolean) => void
  readonly onZoomChange: (zoom: number) => void
  readonly onReset: () => void
  readonly onClear: () => void
  readonly onApply: () => void
}

function CropInputs({ label, topLabel, heightLabel, crop, onChange }: { label: string; topLabel: string; heightLabel: string; crop: LetterheadCrop; onChange: (crop: LetterheadCrop) => void }) {
  const maxHeight = Math.max(1, 100 - crop.top)
  return <fieldset className="grid grid-cols-[minmax(0,1fr)_88px_88px] items-end gap-2">
    <legend className="sr-only">{label}</legend>
    <div>
      <span className="text-[11px] font-bold text-gray-800">{label}</span>
      <input aria-label={`${label} top`} type="range" min="0" max="99" value={crop.top} onChange={event => onChange({ top: Number(event.target.value), height: Math.min(crop.height, 100 - Number(event.target.value)) })} className="mt-2 w-full accent-primary-700" />
    </div>
    <label className="text-[10px] font-semibold text-gray-600">{topLabel}
      <input type="number" min="0" max="99" value={crop.top} onChange={event => onChange({ top: Number(event.target.value), height: Math.min(crop.height, 100 - Number(event.target.value)) })} className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-xs" />
    </label>
    <label className="text-[10px] font-semibold text-gray-600">{heightLabel}
      <input type="number" min="1" max={maxHeight} value={crop.height} onChange={event => onChange({ top: crop.top, height: Math.max(1, Math.min(maxHeight, Number(event.target.value))) })} className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-xs" />
    </label>
  </fieldset>
}

export default function LetterheadCropPanel(props: Props) {
  const { t } = useTranslation('printing')
  const { source, header, footer } = props
  return <section className="space-y-4 rounded-xl border border-primary-200 bg-primary-50/40 p-3" aria-label={t('invoiceSettings.a4.cropPanel')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-gray-900">{source.fileName}</p>
        <p className="mt-0.5 text-[10px] text-gray-600">{formatArtworkBytes(source.fileSize)} · {source.width} × {source.height} px · {source.kind === 'pdf' ? t('invoiceSettings.a4.pdfRasterPreview') : t('invoiceSettings.a4.imageSource')}</p>
        {source.qualityWarning === 'low_resolution' && <p className="mt-1 text-[10px] font-semibold text-amber-700">{t('invoiceSettings.a4.qualityWarning')}</p>}
      </div>
      <button type="button" onClick={props.onClear} className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-white" aria-label={t('invoiceSettings.a4.clearSource')}><X size={14} /></button>
    </div>
    <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white p-2">
      <div className="relative mx-auto origin-top overflow-hidden bg-white shadow-sm" style={{ width: `${props.zoom * 100}%`, maxWidth: 'none' }}>
        <img src={source.previewUrl} alt={t('invoiceSettings.a4.sourcePreview')} className="block h-auto w-full" />
        <div className="pointer-events-none absolute inset-x-0 border-2 border-blue-600 bg-blue-500/10" style={{ top: `${header.top}%`, height: `${header.height}%` }}><span className="absolute start-1 top-1 rounded bg-blue-700 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">{t('invoiceSettings.a4.header')}</span></div>
        {props.includeFooter && <div className="pointer-events-none absolute inset-x-0 border-2 border-emerald-600 bg-emerald-500/10" style={{ top: `${footer.top}%`, height: `${footer.height}%` }}><span className="absolute start-1 top-1 rounded bg-emerald-700 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">{t('invoiceSettings.a4.footer')}</span></div>}
      </div>
    </div>
    <label className="block text-[10px] font-semibold text-gray-600">{t('invoiceSettings.a4.sourceZoom', { value: Math.round(props.zoom * 100) })}
      <input type="range" min=".6" max="1.6" step=".1" value={props.zoom} onChange={event => props.onZoomChange(Number(event.target.value))} className="mt-1 w-full accent-primary-700" />
    </label>
    <CropInputs label={t('invoiceSettings.a4.headerCrop')} topLabel={t('invoiceSettings.a4.cropTop')} heightLabel={t('invoiceSettings.a4.cropHeight')} crop={header} onChange={props.onHeaderChange} />
    <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800">{t('invoiceSettings.a4.extractFooter')}
      <input type="checkbox" checked={props.includeFooter} onChange={event => props.onIncludeFooterChange(event.target.checked)} className="h-4 w-4 accent-primary-700" />
    </label>
    {props.includeFooter && <CropInputs label={t('invoiceSettings.a4.footerCrop')} topLabel={t('invoiceSettings.a4.cropTop')} heightLabel={t('invoiceSettings.a4.cropHeight')} crop={footer} onChange={props.onFooterChange} />}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={props.onReset} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700"><RotateCcw size={13} />{t('invoiceSettings.a4.resetCrops')}</button>
      <button type="button" disabled={props.disabled} onClick={props.onApply} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-700 px-3 text-xs font-semibold text-white disabled:opacity-50"><Scissors size={13} />{t('invoiceSettings.a4.extractUpload')}</button>
    </div>
  </section>
}
