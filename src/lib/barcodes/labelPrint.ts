import JsBarcode from 'jsbarcode'
import type { BarcodeType } from './barcode'
import { validateBarcode } from './barcode'
import {
  DEFAULT_BARCODE_DEVICE_CALIBRATION,
  DEFAULT_BARCODE_LABEL_SETTINGS,
  normalizeBarcodeDeviceCalibration,
  normalizeBarcodeLabelSettings,
  type BarcodeDeviceCalibration,
  type BarcodeLabelSettings,
} from './labelSettings'

export interface BarcodeLabel {
  barcode: string
  barcodeType: BarcodeType
  barcodeId?: string
  productId?: string
  productUnitId?: string
  businessName?: string | null
  productName: string
  productNameAr?: string | null
  productNameEn?: string | null
  unitName: string
  price?: string
  sku?: string | null
  printDate?: string | null
  copies?: number
}

/** Legacy settings remain accepted by the original product-level call site. */
export interface LabelPrintSettings {
  widthMm: number
  heightMm: number
  marginMm: number
  columns: number
  copies: number
  template: string
}

export const DEFAULT_LABEL_SETTINGS: LabelPrintSettings = {
  widthMm: 50,
  heightMm: 30,
  marginMm: 2,
  columns: 1,
  copies: 1,
  template: 'standard',
}

export interface BarcodePrintDocumentCopy {
  title: string
  print: string
  saveAsPdf: string
  dialogGuidance: string
  previewData?: string
}

export interface BarcodePrintDocumentOptions {
  preview?: boolean
  calibrationPattern?: boolean
  copy?: BarcodePrintDocumentCopy
}

export interface BarcodePrintLayout {
  labelCount: number
  pageCount: number
  labelsOnFinalPage: number
  labelsPerPage: number
  leadingEmptyCells: number
  pageWidthMm: number
  pageHeightMm: number
  fits: boolean
  warnings: string[]
}

export interface BarcodePrintDocument {
  html: string
  layout: BarcodePrintLayout
}

const FORMAT_BY_TYPE: Partial<Record<BarcodeType, string>> = {
  ean13: 'EAN13',
  ean8: 'EAN8',
  upca: 'UPC',
  code39: 'CODE39',
  code128: 'CODE128',
  unknown: 'CODE128',
}

export function renderBarcodeSvg(
  value: string,
  barcodeType: BarcodeType,
  displayValue = false,
  height = 46,
): string {
  const error = validateBarcode(value, barcodeType)
  if (error) throw new Error(error)
  const format = FORMAT_BY_TYPE[barcodeType]
  if (!format) throw new Error('unsupportedPrintSymbology')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, value, {
    format,
    displayValue,
    lineColor: '#000000',
    background: '#ffffff',
    margin: 0,
    height,
    fontSize: 12,
    xmlDocument: document,
  })
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', value)
  return svg.outerHTML
}

export const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;')

const copies = (value: unknown) => Math.max(1, Math.min(500, Math.floor(Number(value)) || 1))

export function barcodePrintLayout(
  labelCount: number,
  rawSettings: BarcodeLabelSettings,
): BarcodePrintLayout {
  const settings = normalizeBarcodeLabelSettings(rawSettings)
  const labelWidthMm = settings.orientation === 'landscape'
    ? Math.max(settings.widthMm, settings.heightMm)
    : Math.min(settings.widthMm, settings.heightMm)
  const labelHeightMm = settings.orientation === 'landscape'
    ? Math.min(settings.widthMm, settings.heightMm)
    : Math.max(settings.widthMm, settings.heightMm)
  const nameRows = Number(settings.content.productName)
    + Number(settings.content.productNameAr)
    + Number(settings.content.productNameEn)
  const contentRows = Number(settings.content.businessName)
    + nameRows
    + Number(settings.content.unitName || settings.content.sellingPrice)
    + Number(settings.content.barcodeValue)
    + Number(settings.content.sku || settings.content.printDate)
  const estimatedTextHeightMm = contentRows * 3
    + (settings.productNameSize === 'large' && nameRows ? 1.5 : 0)
    + (settings.priceStyle === 'large' && settings.content.sellingPrice ? 1 : 0)
  const contentMayClip = settings.marginMm * 2 + settings.barcodeHeightMm
    + estimatedTextHeightMm > labelHeightMm
    || settings.marginMm * 2 + 10 > labelWidthMm
  const count = Math.max(0, Math.min(500, Math.floor(labelCount)))
  if (settings.outputMode === 'thermal') {
    return {
      labelCount: count,
      pageCount: count,
      labelsOnFinalPage: count ? 1 : 0,
      labelsPerPage: 1,
      leadingEmptyCells: 0,
      pageWidthMm: labelWidthMm,
      pageHeightMm: labelHeightMm,
      fits: true,
      warnings: contentMayClip ? ['contentMayClip'] : [],
    }
  }

  const pageWidthMm = settings.a4.orientation === 'landscape' ? 297 : 210
  const pageHeightMm = settings.a4.orientation === 'landscape' ? 210 : 297
  const requiredWidth = settings.a4.marginLeftMm + settings.a4.marginRightMm
    + settings.a4.columns * labelWidthMm
    + (settings.a4.columns - 1) * settings.a4.horizontalGapMm
  const requiredHeight = settings.a4.marginTopMm + settings.a4.marginBottomMm
    + settings.a4.rows * labelHeightMm
    + (settings.a4.rows - 1) * settings.a4.verticalGapMm
  const labelsPerPage = settings.a4.columns * settings.a4.rows
  const leadingEmptyCells = (settings.a4.startRow - 1) * settings.a4.columns + settings.a4.startColumn - 1
  const occupiedCells = leadingEmptyCells + count
  const pageCount = count ? Math.ceil(occupiedCells / labelsPerPage) : 0
  const remainder = occupiedCells % labelsPerPage
  return {
    labelCount: count,
    pageCount,
    labelsOnFinalPage: count ? (remainder || labelsPerPage) - (pageCount === 1 ? leadingEmptyCells : 0) : 0,
    labelsPerPage,
    leadingEmptyCells,
    pageWidthMm,
    pageHeightMm,
    fits: requiredWidth <= pageWidthMm + 0.001 && requiredHeight <= pageHeightMm + 0.001,
    warnings: [
      ...(requiredWidth > pageWidthMm + 0.001 ? ['sheetWidthOverflow'] : []),
      ...(requiredHeight > pageHeightMm + 0.001 ? ['sheetHeightOverflow'] : []),
      ...(contentMayClip ? ['contentMayClip'] : []),
    ],
  }
}

function expandedLabels(labels: BarcodeLabel[]): BarcodeLabel[] {
  const expanded: BarcodeLabel[] = []
  for (const label of labels) {
    for (let index = 0; index < copies(label.copies); index += 1) {
      if (expanded.length >= 500) break
      expanded.push(label)
    }
    if (expanded.length >= 500) break
  }
  return expanded
}

function labelNames(label: BarcodeLabel, settings: BarcodeLabelSettings): string {
  const parts: string[] = []
  const seen = new Set<string>()
  const generic = label.productName.trim()
  const en = label.productNameEn?.trim() || ''
  const ar = label.productNameAr?.trim() || ''
  const add = (value: string, className: string, direction: 'auto' | 'ltr' | 'rtl') => {
    if (!value || seen.has(value)) return
    seen.add(value)
    parts.push(`<div class="product-name ${className}" dir="${direction}">${escapeHtml(value)}</div>`)
  }
  if (settings.content.productName) add(ar || en || generic, '', 'auto')
  if (settings.content.productNameAr) {
    add(ar || en || generic, ar ? 'product-name--ar' : en ? 'product-name--en' : '', ar ? 'rtl' : en ? 'ltr' : 'auto')
  }
  if (settings.content.productNameEn) {
    add(en || ar || generic, en ? 'product-name--en' : ar ? 'product-name--ar' : '', en ? 'ltr' : ar ? 'rtl' : 'auto')
  }
  return parts.join('')
}

function labelMarkup(
  label: BarcodeLabel,
  settings: BarcodeLabelSettings,
  svg: string,
  calibrationPattern: boolean,
): string {
  const c = settings.content
  const printDate = label.printDate || new Date().toLocaleDateString('en-CA')
  return `<article class="label label--${settings.templateId} label--name-${settings.productNameSize} label--price-${settings.priceStyle}" data-barcode-id="${escapeHtml(label.barcodeId ?? '')}">
    ${calibrationPattern ? '<div class="calibration-cross" aria-hidden="true"></div><i class="edge edge--tl"></i><i class="edge edge--tr"></i><i class="edge edge--bl"></i><i class="edge edge--br"></i>' : ''}
    ${c.businessName && label.businessName ? `<div class="business" dir="auto">${escapeHtml(label.businessName)}</div>` : ''}
    ${labelNames(label, settings)}
    <div class="label-meta">
      ${c.unitName && label.unitName ? `<span class="unit" dir="auto">${escapeHtml(label.unitName)}</span>` : ''}
      ${c.sellingPrice && label.price ? `<strong class="price" dir="ltr">${escapeHtml(label.price)}</strong>` : ''}
    </div>
    <div class="barcode-graphic barcode-graphic--${escapeHtml(label.barcodeType)}" dir="ltr">${svg}</div>
    ${c.barcodeValue ? `<div class="barcode-value" dir="ltr">${escapeHtml(label.barcode)}</div>` : ''}
    <div class="label-footer">
      ${c.sku && label.sku ? `<span class="sku" dir="ltr">${escapeHtml(label.sku)}</span>` : ''}
      ${c.printDate ? `<time dir="ltr">${escapeHtml(printDate)}</time>` : ''}
    </div>
    ${calibrationPattern ? '<div class="ruler" aria-hidden="true"><span>0</span><span>10</span><span>20</span></div>' : ''}
  </article>`
}

function pagesMarkup(
  labels: BarcodeLabel[],
  settings: BarcodeLabelSettings,
  layout: BarcodePrintLayout,
  barcodeMarkup: Map<string, string>,
  calibrationPattern: boolean,
): string {
  const render = (label: BarcodeLabel) => labelMarkup(
    label,
    settings,
    barcodeMarkup.get(`${label.barcodeType}:${label.barcode}`) ?? '',
    calibrationPattern,
  )
  if (settings.outputMode === 'thermal') {
    return labels.map(label => `<section class="print-page print-page--thermal">${render(label)}</section>`).join('')
  }

  const cells: (BarcodeLabel | null)[] = [
    ...Array.from({ length: layout.leadingEmptyCells }, () => null),
    ...labels,
  ]
  while (cells.length % layout.labelsPerPage) cells.push(null)
  const pages: string[] = []
  for (let offset = 0; offset < cells.length; offset += layout.labelsPerPage) {
    const pageCells = cells.slice(offset, offset + layout.labelsPerPage)
    pages.push(`<section class="print-page print-page--a4">${pageCells.map(cell =>
      cell ? render(cell) : '<div class="empty-cell" aria-hidden="true"></div>').join('')}</section>`)
  }
  return pages.join('')
}

export function barcodePrintDocument(
  inputLabels: BarcodeLabel[],
  rawSettings: BarcodeLabelSettings,
  rawCalibration: BarcodeDeviceCalibration = DEFAULT_BARCODE_DEVICE_CALIBRATION,
  options: BarcodePrintDocumentOptions = {},
): BarcodePrintDocument {
  const calibration = normalizeBarcodeDeviceCalibration(rawCalibration)
  const branchSettings = normalizeBarcodeLabelSettings(rawSettings)
  const settings = calibration.orientationOverride === 'branch'
    ? branchSettings
    : { ...branchSettings, orientation: calibration.orientationOverride }
  const labels = expandedLabels(inputLabels)
  const layout = barcodePrintLayout(labels.length, settings)
  const barcodeMarkup = new Map<string, string>()
  for (const label of labels) {
    const cacheKey = `${label.barcodeType}:${label.barcode}`
    if (!barcodeMarkup.has(cacheKey)) {
      barcodeMarkup.set(cacheKey, renderBarcodeSvg(label.barcode, label.barcodeType, false, Math.max(24, settings.barcodeHeightMm * 4)))
    }
  }
  const copy = options.copy ?? {
    title: typeof document === 'undefined' ? '' : document.title,
    print: '',
    saveAsPdf: '',
    dialogGuidance: '',
  }
  const width = settings.orientation === 'landscape'
    ? Math.max(settings.widthMm, settings.heightMm)
    : Math.min(settings.widthMm, settings.heightMm)
  const height = settings.orientation === 'landscape'
    ? Math.min(settings.widthMm, settings.heightMm)
    : Math.max(settings.widthMm, settings.heightMm)
  const align = settings.textAlignment === 'center' ? 'center' : 'start'
  const a4 = settings.a4
  const pageSize = settings.outputMode === 'a4'
    ? `A4 ${a4.orientation}`
    : `${width}mm ${height}mm`
  const quality = calibration.quality === 'high' ? 'crisp-edges' : 'auto'
  const pagePadding = settings.outputMode === 'a4'
    ? `${a4.marginTopMm}mm ${a4.marginRightMm}mm ${a4.marginBottomMm}mm ${a4.marginLeftMm}mm`
    : '0'
  const gridColumns = settings.outputMode === 'a4' ? `repeat(${a4.columns}, ${width}mm)` : `${width}mm`
  const gridRows = settings.outputMode === 'a4' ? `repeat(${a4.rows}, ${height}mm)` : `${height}mm`
  const gap = settings.outputMode === 'a4' ? `${a4.verticalGapMm}mm ${a4.horizontalGapMm}mm` : '0'
  const previewClass = options.preview ? ' is-preview' : ''
  const patternClass = options.calibrationPattern ? ' is-calibration' : ''
  const previewScale = options.preview ? Math.min(1, 100 / layout.pageWidthMm) : 1
  const toolbar = options.preview ? `<nav class="preview-toolbar" aria-label="${escapeHtml(copy.title)}">
    <div><strong>${escapeHtml(copy.title)}</strong><span>${escapeHtml(copy.dialogGuidance)}</span></div>
    <button type="button" onclick="window.print()">${escapeHtml(copy.print)}</button>
    <small>${escapeHtml(copy.saveAsPdf)}</small>
  </nav>` : ''

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.title)}</title>
  <style>
    @page { size: ${pageSize}; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; color: #000; background: ${options.preview ? '#e5e7eb' : '#fff'}; font-family: Arial, "Noto Sans Arabic", sans-serif; }
    .preview-toolbar { position: sticky; inset-block-start: 0; z-index: 5; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 16px; align-items: center; padding: 12px 16px; color:#fff; background:#10261a; box-shadow:0 4px 18px rgba(0,0,0,.14); }
    .preview-toolbar strong,.preview-toolbar span { display:block; } .preview-toolbar span,.preview-toolbar small { color:#cbd5d1; font-size:12px; }
    .preview-toolbar button { grid-row:1 / span 2; grid-column:2; border:0; border-radius:10px; padding:9px 18px; color:#fff; background:#27864b; font-weight:700; cursor:pointer; }
    .document${previewClass} { padding:${options.preview ? '18px' : '0'}; }
    .print-page { position:relative; overflow:hidden; break-after:page; page-break-after:always; background:#fff; }
    .print-page:last-child { break-after:auto; page-break-after:auto; }
    .print-page--thermal { width:${width}mm; height:${height}mm; }
    .print-page--a4 { width:${layout.pageWidthMm}mm; height:${layout.pageHeightMm}mm; padding:${pagePadding}; display:grid; grid-template-columns:${gridColumns}; grid-template-rows:${gridRows}; gap:${gap}; align-content:start; justify-content:start; }
    .is-preview .print-page { zoom:${previewScale}; margin:0 auto 18px; box-shadow:0 10px 30px rgba(15,36,25,.12); }
    .label { position:relative; width:${width}mm; height:${height}mm; overflow:hidden; display:flex; flex-direction:column; padding:${settings.marginMm}mm; color:#000; background:#fff; text-align:${align}; transform:translate(${calibration.horizontalOffsetMm}mm,${calibration.verticalOffsetMm}mm) scale(${calibration.widthScalePercent / 100},${calibration.heightScalePercent / 100}); transform-origin:center; border:${options.preview || options.calibrationPattern ? '.2mm dashed #94a3b8' : '0'}; }
    .is-preview .label::after { content:""; position:absolute; inset:${settings.marginMm}mm; pointer-events:none; border:.15mm dotted #cbd5e1; }
    .business,.product-name,.unit,.price,.sku,time,.barcode-value { position:relative; z-index:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .business { font-size:7.5pt; font-weight:700; letter-spacing:.02em; }
    .product-name { font-weight:800; line-height:1.12; }
    .label--name-small .product-name { font-size:8pt; } .label--name-normal .product-name { font-size:10pt; } .label--name-large .product-name { font-size:13pt; }
    .product-name--ar { font-family:Arial,"Noto Sans Arabic",sans-serif; }
    .label-meta { display:flex; min-height:4mm; align-items:baseline; justify-content:space-between; gap:1.5mm; font-size:7.5pt; }
    .price { font-size:10pt; direction:ltr; font-variant-numeric:tabular-nums; } .label--price-large .price { font-size:14pt; }
    .barcode-graphic { min-height:${Math.max(6, settings.barcodeHeightMm)}mm; height:${settings.barcodeHeightMm}mm; margin-block:${settings.templateId === 'compact' ? '.4mm' : '.8mm'}; padding-inline:2.5mm; display:flex; align-items:stretch; justify-content:center; overflow:hidden; image-rendering:${quality}; }
    .barcode-graphic--ean13,.barcode-graphic--ean8,.barcode-graphic--upca { padding-inline:3.6mm; }
    .barcode-graphic svg { display:block; width:100%; height:100%; overflow:visible; shape-rendering:crispEdges; }
    .barcode-value { text-align:center; font-family:"Courier New",monospace; font-size:7pt; letter-spacing:.04em; font-variant-numeric:tabular-nums; }
    .label-footer { display:flex; justify-content:space-between; gap:2mm; min-height:2.5mm; font-size:6.5pt; }
    .label--compact .business,.label--compact .label-footer { font-size:5.5pt; }
    .label--detailed .business { padding-block-end:.5mm; border-block-end:.15mm solid #111; }
    .calibration-cross { position:absolute; z-index:2; inset:50% auto auto 50%; width:10mm; height:10mm; translate:-50% -50%; border:.15mm solid #64748b; border-radius:50%; }
    .calibration-cross::before,.calibration-cross::after { content:""; position:absolute; background:#64748b; }
    .calibration-cross::before { width:14mm; height:.15mm; inset:50% auto auto 50%; translate:-50% -50%; }
    .calibration-cross::after { height:14mm; width:.15mm; inset:50% auto auto 50%; translate:-50% -50%; }
    .edge { position:absolute; z-index:2; width:3mm; height:3mm; border-color:#111; }
    .edge--tl { inset:1mm auto auto 1mm; border-block-start:.3mm solid; border-inline-start:.3mm solid; }
    .edge--tr { inset:1mm 1mm auto auto; border-block-start:.3mm solid; border-inline-end:.3mm solid; }
    .edge--bl { inset:auto auto 1mm 1mm; border-block-end:.3mm solid; border-inline-start:.3mm solid; }
    .edge--br { inset:auto 1mm 1mm auto; border-block-end:.3mm solid; border-inline-end:.3mm solid; }
    .ruler { position:absolute; z-index:2; inset:auto 2mm .7mm 2mm; display:flex; justify-content:space-between; border-block-start:.2mm solid #111; padding-block-start:.3mm; font-size:5pt; }
    @media print {
      html,body { width:auto; min-height:0; background:#fff !important; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      .preview-toolbar { display:none !important; }
      .document { padding:0 !important; }
      .print-page { margin:0 !important; box-shadow:none !important; }
      .is-preview .print-page { zoom:1; }
      .label { border:0; }
      .label::after { display:none !important; }
    }
  </style></head><body>${toolbar}<main class="document${previewClass}${patternClass}">${pagesMarkup(labels, settings, layout, barcodeMarkup, options.calibrationPattern === true)}</main></body></html>`
  return { html, layout }
}

export function barcodeLabelDocument(label: BarcodeLabel, legacy: LabelPrintSettings): string {
  const settings = normalizeBarcodeLabelSettings({
    ...DEFAULT_BARCODE_LABEL_SETTINGS,
    widthMm: legacy.widthMm,
    heightMm: legacy.heightMm,
    marginMm: legacy.marginMm,
    templateId: legacy.template === 'compact' || legacy.template === 'detailed' ? legacy.template : 'standard',
    outputMode: legacy.columns > 1 ? 'a4' : 'thermal',
    a4: { ...DEFAULT_BARCODE_LABEL_SETTINGS.a4, columns: legacy.columns },
  })
  return barcodePrintDocument([{ ...label, copies: legacy.copies }], settings).html
}

export interface BarcodePrintAdapter {
  preview(documentHtml: string): Window | null
  print(documentHtml: string): Window | null
  enumeratePrinters?(): Promise<{ name: string; isDefault?: boolean }[]>
  selectedPrinter?: string | null
  silentPrintingSupported: boolean
}

function openDocument(documentHtml: string, autoPrint: boolean): Window | null {
  const preview = window.open('about:blank', '_blank')
  if (!preview) return null
  try {
    preview.opener = null
  } catch {
    // Some browser policies already sever the opener relationship.
  }
  preview.document.open()
  preview.document.write(documentHtml)
  preview.document.close()
  preview.focus()
  if (autoPrint) preview.setTimeout(() => preview.print(), 150)
  return preview
}

export const browserBarcodePrintAdapter: BarcodePrintAdapter = {
  preview(documentHtml) {
    return openDocument(documentHtml, false)
  },
  print(documentHtml) {
    const frame = document.createElement('iframe')
    frame.title = new DOMParser().parseFromString(documentHtml, 'text/html').title || document.title
    frame.style.position = 'fixed'
    frame.style.inset = '0'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.opacity = '0'
    frame.style.pointerEvents = 'none'
    frame.srcdoc = documentHtml
    document.body.appendChild(frame)
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      window.setTimeout(() => frame.remove(), 1000)
    }
    return null
  },
  silentPrintingSupported: false,
}
