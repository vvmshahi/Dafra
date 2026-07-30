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
  riyalAccessible?: string
}

export interface BarcodePrintDocumentOptions {
  preview?: boolean
  calibrationPattern?: boolean
  copy?: BarcodePrintDocumentCopy
  locale?: string
  allowPrint?: boolean
}

export type BarcodeLabelFitStatus = 'safe' | 'tight' | 'overflow'

export interface BarcodePrintLayout {
  labelCount: number
  pageCount: number
  labelsOnFinalPage: number
  labelsPerPage: number
  leadingEmptyCells: number
  pageWidthMm: number
  pageHeightMm: number
  fits: boolean
  contentFitStatus: BarcodeLabelFitStatus
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
    // Preserve a library-owned white quiet zone in addition to the renderer's
    // physical padding so printer scaling cannot erase scan clearance.
    margin: 10,
    height,
    fontSize: 12,
    xmlDocument: document,
  })
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', value)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  return svg.outerHTML
}

export const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;')

const copies = (value: unknown) => Math.max(1, Math.min(500, Math.floor(Number(value)) || 1))

const PT_TO_MM = 0.3528
const MIN_PRODUCT_NAME_FONT_PT = 7
const NAME_LINE_HEIGHT = 1.32
const NAME_FONT_BY_SIZE = { small: 8, normal: 10, large: 13 } as const
const NAME_LINES_BY_TEMPLATE = { compact: 1, standard: 2, detailed: 4 } as const
const MIN_BARCODE_HEIGHT_MM = 8

interface BarcodeLabelFit {
  status: BarcodeLabelFitStatus
  nameFontPt: number
  nameLineLimit: number
  totalNameLines: number
}

const visibleLabelNames = (label: BarcodeLabel, settings: BarcodeLabelSettings): string[] => {
  const values: string[] = []
  const seen = new Set<string>()
  const generic = label.productName.trim()
  const english = label.productNameEn?.trim() || ''
  const arabic = label.productNameAr?.trim() || ''
  const add = (value: string) => {
    if (value && !seen.has(value)) {
      seen.add(value)
      values.push(value)
    }
  }
  if (settings.content.productName) add(arabic || english || generic)
  if (settings.content.productNameAr) add(arabic || english || generic)
  if (settings.content.productNameEn) add(english || arabic || generic)
  return values
}

const textUnits = (value: string): number => Array.from(value.trim()).reduce((total, character) => {
  if (/\s/u.test(character)) return total + 0.34
  if (/[\u0600-\u06ff]/u.test(character)) return total + 0.94
  if (/[A-Z0-9]/u.test(character)) return total + 0.68
  return total + 0.56
}, 0)

const estimatedTextWidthMm = (value: string, fontPt: number): number =>
  textUnits(value) * fontPt * PT_TO_MM

const labelDimensions = (settings: BarcodeLabelSettings) => ({
  width: settings.orientation === 'landscape'
    ? Math.max(settings.widthMm, settings.heightMm)
    : Math.min(settings.widthMm, settings.heightMm),
  height: settings.orientation === 'landscape'
    ? Math.min(settings.widthMm, settings.heightMm)
    : Math.max(settings.widthMm, settings.heightMm),
})

/**
 * Deterministic fit estimate shared by preview and printed markup.
 * It deliberately reserves the barcode before allocating space to dynamic text.
 */
export function barcodeLabelFit(
  label: BarcodeLabel,
  rawSettings: BarcodeLabelSettings,
): BarcodeLabelFit {
  const settings = normalizeBarcodeLabelSettings(rawSettings)
  const dimensions = labelDimensions(settings)
  const innerWidth = Math.max(0, dimensions.width - settings.marginMm * 2)
  const innerHeight = Math.max(0, dimensions.height - settings.marginMm * 2)
  const names = visibleLabelNames(label, settings)
  const maximumNameLines = NAME_LINES_BY_TEMPLATE[settings.templateId]
  const perNameLineLimit = Math.max(1, Math.floor(maximumNameLines / Math.max(1, names.length)))
  const preferredFontPt = NAME_FONT_BY_SIZE[settings.productNameSize]
  const barcodeHeight = Math.max(MIN_BARCODE_HEIGHT_MM, settings.barcodeHeightMm)
  const fixedHeight = settings.presetId === 'carton_label'
    ? Math.max(barcodeHeight + (settings.content.barcodeValue ? 3.4 : 0), 12)
    : settings.presetId === 'detailed_product'
      ? barcodeHeight + (settings.content.barcodeValue ? 2.8 : 0) + 6
      : settings.presetId === 'compact_sticker'
        ? barcodeHeight + (settings.content.barcodeValue ? 2.3 : 0) + (settings.content.sellingPrice && label.price ? 3.2 : 0) + .3
        : barcodeHeight + (settings.content.barcodeValue ? 2.8 : 0) + 4.5
  const availableNameHeight = Math.max(0, innerHeight - fixedHeight)

  let nameFontPt = preferredFontPt
  let totalNameLines = 0
  let namesFit = names.length === 0
  for (let candidate = preferredFontPt; candidate >= MIN_PRODUCT_NAME_FONT_PT; candidate -= 0.5) {
    const lines = names.map(name => Math.max(
      1,
      Math.ceil(estimatedTextWidthMm(name, candidate) / Math.max(innerWidth, 1)),
    ))
    const totalLines = lines.reduce((sum, lineCount) => sum + lineCount, 0)
    const requiredHeight = totalLines * candidate * PT_TO_MM * NAME_LINE_HEIGHT
    nameFontPt = candidate
    totalNameLines = totalLines
    if (lines.every(lineCount => lineCount <= perNameLineLimit)
      && totalLines <= maximumNameLines
      && requiredHeight <= availableNameHeight + 0.01) {
      namesFit = true
      break
    }
  }

  const metaWidth = [
    settings.content.unitName ? label.unitName : '',
    settings.content.sellingPrice ? label.price ?? '' : '',
  ].filter(Boolean).reduce((sum, value) => sum + estimatedTextWidthMm(value, 7.5), 0)
  const footerWidth = [
    settings.content.sku ? label.sku ?? '' : '',
    settings.content.printDate ? label.printDate ?? '0000-00-00' : '',
  ].filter(Boolean).reduce((sum, value) => sum + estimatedTextWidthMm(value, 6.5), 0)
  const minimumBarcodeWidth = label.barcodeType === 'ean13' || label.barcodeType === 'upca'
    ? 29.8
    : label.barcodeType === 'ean8'
      ? 21.4
      : 18
  const scanRegionWidth = settings.presetId === 'standard_product'
    ? innerWidth * .68
    : settings.presetId === 'detailed_product'
      ? innerWidth * .58
      : settings.presetId === 'carton_label'
        ? innerWidth * .44
        : innerWidth
  const fixedRegionsFit = innerWidth >= 18
    && scanRegionWidth >= minimumBarcodeWidth
    && fixedHeight <= innerHeight + 0.01
  const horizontalOverflow = metaWidth > innerWidth * 1.35 || footerWidth > innerWidth * 1.35
  if (!fixedRegionsFit || !namesFit || horizontalOverflow) {
    return {
      status: 'overflow',
      nameFontPt: Math.max(MIN_PRODUCT_NAME_FONT_PT, nameFontPt),
      nameLineLimit: perNameLineLimit,
      totalNameLines,
    }
  }

  const nameHeight = totalNameLines * nameFontPt * PT_TO_MM * NAME_LINE_HEIGHT
  const usedHeightRatio = innerHeight > 0 ? (fixedHeight + nameHeight) / innerHeight : 1
  const tight = nameFontPt < preferredFontPt
    || usedHeightRatio > 0.86
    || metaWidth > innerWidth
    || footerWidth > innerWidth
  return {
    status: tight ? 'tight' : 'safe',
    nameFontPt,
    nameLineLimit: perNameLineLimit,
    totalNameLines,
  }
}

const fitRank: Record<BarcodeLabelFitStatus, number> = {
  safe: 0,
  tight: 1,
  overflow: 2,
}

function worstFitStatus(
  labels: BarcodeLabel[],
  settings: BarcodeLabelSettings,
): BarcodeLabelFitStatus {
  const candidates = labels.length ? labels : [{
    barcode: '4006381333931',
    barcodeType: 'ean13' as const,
    productName: 'Sample product',
    productNameAr: 'منتج تجريبي',
    productNameEn: 'Sample product',
    unitName: 'Piece',
    price: '84.00',
    sku: 'SKU-0000',
  }]
  return candidates.reduce<BarcodeLabelFitStatus>((worst, label) => {
    const status = barcodeLabelFit(label, settings).status
    return fitRank[status] > fitRank[worst] ? status : worst
  }, 'safe')
}

export function barcodePrintLayout(
  labelCount: number,
  rawSettings: BarcodeLabelSettings,
  labels: BarcodeLabel[] = [],
): BarcodePrintLayout {
  const settings = normalizeBarcodeLabelSettings(rawSettings)
  const { width: labelWidthMm, height: labelHeightMm } = labelDimensions(settings)
  const contentFitStatus = worstFitStatus(labels, settings)
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
      contentFitStatus,
      warnings: contentFitStatus === 'overflow'
        ? ['contentOverflow']
        : contentFitStatus === 'tight'
          ? ['contentTight']
          : [],
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
    contentFitStatus,
    warnings: [
      ...(requiredWidth > pageWidthMm + 0.001 ? ['sheetWidthOverflow'] : []),
      ...(requiredHeight > pageHeightMm + 0.001 ? ['sheetHeightOverflow'] : []),
      ...(contentFitStatus === 'overflow' ? ['contentOverflow'] : []),
      ...(contentFitStatus === 'tight' ? ['contentTight'] : []),
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

function labelNames(label: BarcodeLabel, settings: BarcodeLabelSettings, locale: string): string {
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
  const arabicPrimary = locale.toLowerCase().startsWith('ar')
  const primary = arabicPrimary ? ar || en || generic : en || ar || generic
  if (settings.content.productName) {
    add(primary, primary === ar ? 'product-name--ar' : primary === en ? 'product-name--en' : '', primary === ar ? 'rtl' : primary === en ? 'ltr' : 'auto')
  }
  const secondaryEnabled = settings.content.productNameAr || settings.content.productNameEn
  if (secondaryEnabled) {
    const secondary = arabicPrimary ? en : ar
    add(secondary, secondary === ar ? 'product-name--ar product-name--secondary' : 'product-name--en product-name--secondary', secondary === ar ? 'rtl' : 'ltr')
  }
  return parts.join('')
}

export interface BarcodeLabelCurrency {
  amount: string
  fallback: string
  isArabic: boolean
}

/**
 * Barcode-label-only currency formatter. The official glyph is rendered from
 * the approved local SaudiRiyal.woff2 asset; this text fallback remains visible
 * until that font is confirmed loaded in the isolated print document.
 */
export function formatBarcodeLabelCurrency(
  rawValue: string,
  locale = 'en',
): BarcodeLabelCurrency {
  const amount = String(rawValue ?? '')
    .trim()
    .replace(/^SAR\s*/i, '')
    .replace(/\s*ر\.?\s*س\.?$/u, '')
    .replace(/^[ê]\s*/u, '')
    .trim()
  const isArabic = locale.toLowerCase().startsWith('ar')
  return {
    amount: amount || String(rawValue ?? '').trim(),
    fallback: isArabic ? 'ر.س' : 'SAR',
    isArabic,
  }
}

function priceMarkup(
  rawValue: string,
  locale: string,
  accessibleCurrencyName: string,
): string {
  const currency = formatBarcodeLabelCurrency(rawValue, locale)
  const fallback = currency.isArabic
    ? `${escapeHtml(currency.amount)}&nbsp;<span dir="rtl">${currency.fallback}</span>`
    : `${currency.fallback}&nbsp;${escapeHtml(currency.amount)}`
  return `<bdi class="price" dir="ltr" aria-label="${escapeHtml(`${currency.amount} ${accessibleCurrencyName}`)}">
    <span class="riyal-official" aria-hidden="true"><span class="riyal-symbol">ê</span>&nbsp;${escapeHtml(currency.amount)}</span>
    <span class="riyal-fallback" aria-hidden="true">${fallback}</span>
  </bdi>`
}

interface LabelRenderContext {
  label: BarcodeLabel
  settings: BarcodeLabelSettings
  svg: string
  locale: string
  accessibleCurrencyName: string
}

const businessMarkup = ({ label, settings }: LabelRenderContext) =>
  settings.content.businessName && label.businessName
    ? `<div class="business" dir="auto">${escapeHtml(label.businessName)}</div>`
    : ''

const namesMarkup = (context: LabelRenderContext) =>
  `<div class="product-names">${labelNames(context.label, context.settings, context.locale)}</div>`

const unitMarkup = ({ label, settings }: LabelRenderContext) =>
  settings.content.unitName && label.unitName
    ? `<span class="unit" dir="auto">${escapeHtml(label.unitName)}</span>`
    : ''

const price = ({ label, settings, locale, accessibleCurrencyName }: LabelRenderContext) =>
  settings.content.sellingPrice && label.price
    ? priceMarkup(label.price, locale, accessibleCurrencyName)
    : ''

const barcodeMarkup = ({ label, settings, svg }: LabelRenderContext) => `
  <div class="barcode-graphic barcode-graphic--${escapeHtml(label.barcodeType)}" dir="ltr">${svg}</div>
  ${settings.content.barcodeValue ? `<div class="barcode-value" dir="ltr">${escapeHtml(label.barcode)}</div>` : ''}`

const skuMarkup = ({ label, settings }: LabelRenderContext) =>
  settings.content.sku && label.sku
    ? `<span class="sku" dir="ltr">${escapeHtml(label.sku)}</span>`
    : ''

const LABEL_RENDERERS = {
  compact_sticker: (context: LabelRenderContext) => `
    <div class="compact-price-composition">
      ${businessMarkup(context)}
      ${namesMarkup(context)}
      <div class="compact-price-composition__scan">${barcodeMarkup(context)}</div>
      <div class="compact-price-composition__footer"><span>${unitMarkup(context)}</span>${price(context)}</div>
    </div>`,
  standard_product: (context: LabelRenderContext) => `
    <div class="standard-product-composition">
      <div class="standard-product-composition__info">${namesMarkup(context)}${unitMarkup(context)}</div>
      <div class="standard-product-composition__scan">${barcodeMarkup(context)}</div>
      <div class="standard-product-composition__price">${price(context)}</div>
      <div class="standard-product-composition__footer">${businessMarkup(context)}${skuMarkup(context)}</div>
    </div>`,
  detailed_product: (context: LabelRenderContext) => `
    <div class="detailed-product-composition">
      <div class="detailed-product-composition__identity">${businessMarkup(context)}${namesMarkup(context)}</div>
      <div class="detailed-product-composition__details">${unitMarkup(context)}${skuMarkup(context)}</div>
      <div class="detailed-product-composition__scan">${barcodeMarkup(context)}</div>
      <div class="detailed-product-composition__price">${price(context)}</div>
    </div>`,
  carton_label: (context: LabelRenderContext) => `
    <div class="carton-label-composition">
      <div class="carton-label-composition__identity">${businessMarkup(context)}${namesMarkup(context)}<div class="carton-label-composition__meta">${unitMarkup(context)}${skuMarkup(context)}</div></div>
      <div class="carton-label-composition__scan">${barcodeMarkup(context)}</div>
      <div class="carton-label-composition__price">${price(context)}</div>
    </div>`,
} as const

export const BARCODE_LABEL_RENDERER_REGISTRY = Object.freeze({
  compact_sticker: Object.freeze({ landmark: 'compact-price-composition', renderer: LABEL_RENDERERS.compact_sticker }),
  standard_product: Object.freeze({ landmark: 'standard-product-composition', renderer: LABEL_RENDERERS.standard_product }),
  detailed_product: Object.freeze({ landmark: 'detailed-product-composition', renderer: LABEL_RENDERERS.detailed_product }),
  carton_label: Object.freeze({ landmark: 'carton-label-composition', renderer: LABEL_RENDERERS.carton_label }),
})

function labelMarkup(
  label: BarcodeLabel,
  settings: BarcodeLabelSettings,
  svg: string,
  calibrationPattern: boolean,
  locale: string,
  accessibleCurrencyName: string,
): string {
  const printDate = label.printDate || new Date().toLocaleDateString('en-CA')
  const fit = barcodeLabelFit(label, settings)
  const registryEntry = BARCODE_LABEL_RENDERER_REGISTRY[settings.presetId as keyof typeof BARCODE_LABEL_RENDERER_REGISTRY]
    ?? BARCODE_LABEL_RENDERER_REGISTRY.standard_product
  const context = { label, settings, svg, locale, accessibleCurrencyName }
  return `<article class="label label--${settings.templateId} label--preset-${settings.presetId} label--name-${settings.productNameSize} label--price-${settings.priceStyle}" data-fit-status="${fit.status}" data-barcode-id="${escapeHtml(label.barcodeId ?? '')}" style="--fitted-name-size:${fit.nameFontPt}pt;--name-line-limit:${fit.nameLineLimit}">
    ${calibrationPattern ? '<div class="calibration-title">PRINTER TEST / اختبار الطابعة</div><div class="calibration-cross" aria-hidden="true"></div><i class="edge edge--tl"></i><i class="edge edge--tr"></i><i class="edge edge--bl"></i><i class="edge edge--br"></i>' : ''}
    ${registryEntry.renderer(context)}
    ${settings.content.printDate ? `<time class="label-print-date" dir="ltr">${escapeHtml(printDate)}</time>` : ''}
    ${calibrationPattern ? '<div class="ruler" aria-hidden="true"><span>0</span><span>10</span><span>20</span></div>' : ''}
  </article>`
}

function pagesMarkup(
  labels: BarcodeLabel[],
  settings: BarcodeLabelSettings,
  layout: BarcodePrintLayout,
  barcodeMarkup: Map<string, string>,
  calibrationPattern: boolean,
  locale: string,
  accessibleCurrencyName: string,
): string {
  const render = (label: BarcodeLabel) => labelMarkup(
    label,
    settings,
    barcodeMarkup.get(`${label.barcodeType}:${label.barcode}`) ?? '',
    calibrationPattern,
    locale,
    accessibleCurrencyName,
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
  const layout = barcodePrintLayout(labels.length, settings, labels)
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
  const locale = options.locale
    || (typeof document === 'undefined' ? 'en' : document.documentElement.lang)
    || 'en'
  const accessibleCurrencyName = copy.riyalAccessible
    || (locale.toLowerCase().startsWith('ar') ? 'ريال سعودي' : 'Saudi Riyals')
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
    <button type="button" onclick="window.print()"${options.allowPrint === false ? ' disabled aria-disabled="true"' : ''}>${escapeHtml(copy.print)}</button>
    <small>${escapeHtml(copy.saveAsPdf)}</small>
  </nav>` : ''

  const nativePageWidth = settings.outputMode === 'a4' ? layout.pageWidthMm : width
  const nativePageHeight = settings.outputMode === 'a4' ? layout.pageHeightMm : height
  const html = `<!doctype html><html lang="${escapeHtml(locale)}" class="riyal-fallback-active" data-kubri-barcode-print="v1" data-kubri-page-width-mm="${nativePageWidth}" data-kubri-page-height-mm="${nativePageHeight}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.title)}</title>
  <style>
    @page { size: ${pageSize}; margin: 0; }
    @font-face { font-family:"SaudiRiyal"; src:url("/fonts/SaudiRiyal.woff2") format("woff2"); font-weight:normal; font-style:normal; font-display:block; }
    @font-face { font-family:"KubriArabic"; src:url("/fonts/NotoNaskhArabic-Regular.ttf") format("truetype"); font-weight:400 800; font-style:normal; font-display:swap; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; color: #000; background: ${options.preview ? '#e5e7eb' : '#fff'}; font-family: Arial, "KubriArabic", "Noto Sans Arabic", sans-serif; }
    .preview-toolbar { position: sticky; inset-block-start: 0; z-index: 5; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 16px; align-items: center; padding: 12px 16px; color:#fff; background:#10261a; box-shadow:0 4px 18px rgba(0,0,0,.14); }
    .preview-toolbar strong,.preview-toolbar span { display:block; } .preview-toolbar span,.preview-toolbar small { color:#cbd5d1; font-size:12px; }
    .preview-toolbar button { grid-row:1 / span 2; grid-column:2; border:0; border-radius:10px; padding:9px 18px; color:#fff; background:#27864b; font-weight:700; cursor:pointer; }
    .preview-toolbar button:disabled { cursor:not-allowed; opacity:.45; }
    .document${previewClass} { padding:${options.preview ? '18px' : '0'}; }
    .print-page { position:relative; overflow:hidden; break-after:page; page-break-after:always; background:#fff; }
    .print-page:last-child { break-after:auto; page-break-after:auto; }
    .print-page--thermal { width:${width}mm; height:${height}mm; }
    .print-page--a4 { width:${layout.pageWidthMm}mm; height:${layout.pageHeightMm}mm; padding:${pagePadding}; display:grid; grid-template-columns:${gridColumns}; grid-template-rows:${gridRows}; gap:${gap}; align-content:start; justify-content:start; }
    .is-preview .print-page { zoom:${previewScale}; margin:0 auto 18px; box-shadow:0 10px 30px rgba(15,36,25,.12); }
    .label { position:relative; width:${width}mm; height:${height}mm; overflow:hidden; display:flex; flex-direction:column; padding:${settings.marginMm}mm; color:#000; background:#fff; text-align:${align}; transform:translate(${calibration.horizontalOffsetMm}mm,${calibration.verticalOffsetMm}mm) scale(${calibration.widthScalePercent / 100},${calibration.heightScalePercent / 100}); transform-origin:center; border:${options.preview || options.calibrationPattern ? '.2mm dashed #94a3b8' : '0'}; }
    .is-preview .label::after { content:""; position:absolute; inset:${settings.marginMm}mm; pointer-events:none; border:.15mm dotted #cbd5e1; }
    .business,.unit,.price,.sku,time,.barcode-value { position:relative; z-index:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .business { font-size:7.5pt; font-weight:700; letter-spacing:.02em; }
    .product-names { min-block-size:0; overflow:hidden; }
    .product-name { position:relative; z-index:1; display:-webkit-box; overflow:hidden; overflow-wrap:anywhere; word-break:normal; -webkit-box-orient:vertical; -webkit-line-clamp:var(--name-line-limit); font-size:var(--fitted-name-size); font-weight:800; line-height:${NAME_LINE_HEIGHT}; text-overflow:ellipsis; }
    .product-name--ar { padding-block:.04em .1em; font-family:"KubriArabic",Arial,"Noto Sans Arabic",sans-serif; line-height:1.38; }
    .unit { min-inline-size:0; }
    .price { flex:none; font-size:10pt; direction:ltr; font-variant-numeric:tabular-nums; } .label--price-large .price { font-size:14pt; }
    .riyal-official { display:none; white-space:nowrap; } .riyal-fallback { display:inline; white-space:nowrap; }
    .riyal-symbol-ready .riyal-official { display:inline; } .riyal-symbol-ready .riyal-fallback { display:none; }
    .riyal-symbol { display:inline-block; font-family:"SaudiRiyal"; font-weight:400; line-height:1; vertical-align:baseline; }
    .barcode-graphic { flex:0 0 ${Math.max(MIN_BARCODE_HEIGHT_MM, settings.barcodeHeightMm)}mm; min-block-size:${Math.max(MIN_BARCODE_HEIGHT_MM, settings.barcodeHeightMm)}mm; block-size:${Math.max(MIN_BARCODE_HEIGHT_MM, settings.barcodeHeightMm)}mm; inline-size:100%; max-inline-size:100%; margin-block:${settings.templateId === 'compact' ? '.4mm' : '.8mm'}; padding-inline:2.5mm; display:flex; align-items:stretch; justify-content:center; overflow:hidden; image-rendering:${quality}; }
    .barcode-graphic--ean13,.barcode-graphic--ean8,.barcode-graphic--upca { padding-inline:3.6mm; }
    .barcode-graphic svg { display:block; width:auto; max-width:100%; height:100%; overflow:visible; shape-rendering:crispEdges; }
    .barcode-value { text-align:center; font-family:"Courier New",monospace; font-size:7pt; letter-spacing:.04em; font-variant-numeric:tabular-nums; }
    .label-print-date { position:absolute; inset:auto ${settings.marginMm}mm .4mm auto; font-size:5.5pt; }
    .compact-price-composition { display:grid; grid-template-rows:auto minmax(0,auto) 1fr auto; height:100%; min-height:0; }
    .compact-price-composition .business { font-size:5.5pt; }
    .compact-price-composition .product-name { line-height:1.15; }
    .compact-price-composition__scan { min-height:0; display:flex; flex-direction:column; justify-content:center; }
    .compact-price-composition__scan .barcode-graphic { margin-block:.15mm; }
    .compact-price-composition__footer { display:flex; min-height:3.1mm; align-items:end; justify-content:space-between; gap:1mm; font-size:6.5pt; font-weight:700; }
    .compact-price-composition__footer .price { margin-inline-start:auto; font-size:10pt; font-weight:900; }
    .standard-product-composition { display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto 1fr auto; column-gap:2mm; height:100%; min-height:0; }
    .standard-product-composition__info { grid-column:1 / -1; display:flex; align-items:baseline; justify-content:space-between; gap:1.5mm; padding-block-end:.5mm; border-block-end:.18mm solid #111; }
    .standard-product-composition__info .product-names { flex:1; }
    .standard-product-composition__info .unit { font-size:7pt; }
    .standard-product-composition__scan { grid-column:1; grid-row:2; min-width:0; display:flex; flex-direction:column; justify-content:center; }
    .standard-product-composition__price { grid-column:2; grid-row:2; align-self:center; padding-inline-start:1.8mm; border-inline-start:.18mm solid #111; }
    .standard-product-composition__price .price { font-size:14pt; font-weight:900; }
    .standard-product-composition__footer { grid-column:1 / -1; display:flex; justify-content:space-between; gap:2mm; min-height:2.5mm; font-size:6pt; }
    .detailed-product-composition { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(20mm,.85fr); grid-template-rows:auto auto 1fr; gap:1mm 2.5mm; height:100%; min-height:0; border:.2mm solid #111; padding:1.2mm; }
    .detailed-product-composition__identity { grid-column:1 / -1; padding-block-end:.7mm; border-block-end:.2mm solid #111; }
    .detailed-product-composition__identity .business { margin-block-end:.3mm; font-size:6.5pt; letter-spacing:.04em; }
    .detailed-product-composition__details { grid-column:1; display:flex; justify-content:space-between; gap:2mm; font-size:7pt; }
    .detailed-product-composition__scan { grid-column:1; min-height:0; display:flex; flex-direction:column; justify-content:center; border:.15mm solid #777; padding:.5mm; }
    .detailed-product-composition__price { grid-column:2; grid-row:2 / span 2; display:grid; place-items:center; border:.25mm solid #111; text-align:center; }
    .detailed-product-composition__price .price { font-size:13pt; font-weight:900; }
    .carton-label-composition { display:grid; grid-template-columns:minmax(0,1fr) minmax(44%,.9fr); grid-template-rows:1fr auto; gap:2mm 5mm; height:100%; min-height:0; align-items:stretch; }
    .carton-label-composition__identity { grid-row:1 / -1; display:flex; min-width:0; flex-direction:column; padding-inline-end:4mm; border-inline-end:.4mm solid #111; }
    .carton-label-composition__identity .business { padding-block-end:1mm; border-block-end:.2mm solid #111; font-size:8pt; }
    .carton-label-composition__identity .product-names { margin-block:auto; }
    .carton-label-composition__identity .product-name { font-size:max(var(--fitted-name-size),14pt); line-height:1.18; }
    .carton-label-composition__meta { display:flex; justify-content:space-between; gap:3mm; font-size:9pt; font-weight:700; }
    .carton-label-composition__scan { display:flex; min-height:0; flex-direction:column; justify-content:center; }
    .carton-label-composition__scan .barcode-graphic { min-block-size:22mm; block-size:auto; flex:1 1 auto; margin:0; padding-inline:5mm; }
    .carton-label-composition__scan .barcode-value { font-size:10pt; font-weight:700; letter-spacing:.08em; }
    .carton-label-composition__price { text-align:center; }
    .carton-label-composition__price .price { font-size:15pt; font-weight:900; }
    .calibration-cross { position:absolute; z-index:2; inset:50% auto auto 50%; width:10mm; height:10mm; translate:-50% -50%; border:.15mm solid #64748b; border-radius:50%; }
    .calibration-title { position:absolute; z-index:3; inset:1.5mm 1.5mm auto; text-align:center; font-size:5.5pt; font-weight:800; }
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
  </style>
  <script>
    if (document.fonts && document.fonts.load) {
      document.fonts.load('12px SaudiRiyal').then(function (fonts) {
        if (fonts.length) document.documentElement.classList.add('riyal-symbol-ready');
      }).catch(function () {});
    }
  </script></head><body>${toolbar}<main class="document${previewClass}${patternClass}">${pagesMarkup(labels, settings, layout, barcodeMarkup, options.calibrationPattern === true, locale, accessibleCurrencyName)}</main></body></html>`
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
  if (autoPrint) {
    const fontsReady = preview.document.fonts?.ready ?? Promise.resolve()
    void fontsReady.finally(() => preview.setTimeout(() => preview.print(), 50))
  }
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
      const print = () => {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
        window.setTimeout(() => frame.remove(), 1000)
      }
      const fontsReady = frame.contentDocument?.fonts?.ready
      if (fontsReady) void fontsReady.finally(print)
      else print()
    }
    return null
  },
  silentPrintingSupported: false,
}
