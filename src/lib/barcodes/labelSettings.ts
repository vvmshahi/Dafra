export type LabelPresetId =
  | 'compact_sticker'
  | 'standard_product'
  | 'detailed_product'
  | 'carton_label'
  | 'a4_sheet'
  | 'custom'

export type LabelTemplateId = 'compact' | 'standard' | 'detailed'
export type LabelOutputMode = 'thermal' | 'a4'
export type LabelOrientation = 'portrait' | 'landscape'
export type LabelTextAlignment = 'start' | 'center'
export type LabelPriceStyle = 'normal' | 'large'
export type LabelNameSize = 'small' | 'normal' | 'large'

export interface LabelContentSettings {
  productName: boolean
  productNameAr: boolean
  productNameEn: boolean
  sellingPrice: boolean
  unitName: boolean
  sku: boolean
  businessName: boolean
  barcodeValue: boolean
  printDate: boolean
}

export interface A4SheetSettings {
  orientation: LabelOrientation
  columns: number
  rows: number
  marginLeftMm: number
  marginRightMm: number
  marginTopMm: number
  marginBottomMm: number
  horizontalGapMm: number
  verticalGapMm: number
  startRow: number
  startColumn: number
}

export interface BarcodeLabelSettings {
  schemaVersion: 1
  presetId: LabelPresetId
  templateId: LabelTemplateId
  outputMode: LabelOutputMode
  widthMm: number
  heightMm: number
  marginMm: number
  barcodeHeightMm: number
  orientation: LabelOrientation
  textAlignment: LabelTextAlignment
  productNameSize: LabelNameSize
  priceStyle: LabelPriceStyle
  content: LabelContentSettings
  a4: A4SheetSettings
  defaultCopies: number
}

export interface BarcodeDeviceCalibration {
  schemaVersion: 1
  printerName: string | null
  orientationOverride: 'branch' | LabelOrientation
  horizontalOffsetMm: number
  verticalOffsetMm: number
  widthScalePercent: number
  heightScalePercent: number
  quality: 'draft' | 'normal' | 'high'
  updatedAt: string | null
}

export interface LabelPreset {
  id: LabelPresetId
  widthMm: number
  heightMm: number
  marginMm: number
  barcodeHeightMm: number
  templateId: LabelTemplateId
  outputMode: LabelOutputMode
  orientation: LabelOrientation
  productNameSize: LabelNameSize
  priceStyle: LabelPriceStyle
  content: LabelContentSettings
  a4: A4SheetSettings
}

const content = (value: Partial<LabelContentSettings>): LabelContentSettings => ({
  productName: value.productName ?? true,
  productNameAr: value.productNameAr ?? false,
  productNameEn: value.productNameEn ?? false,
  sellingPrice: value.sellingPrice ?? true,
  unitName: value.unitName ?? true,
  sku: value.sku ?? false,
  businessName: value.businessName ?? false,
  barcodeValue: value.barcodeValue ?? true,
  printDate: value.printDate ?? false,
})

const defaultA4 = (): A4SheetSettings => ({
  orientation: 'portrait',
  columns: 3,
  rows: 8,
  marginLeftMm: 7,
  marginRightMm: 7,
  marginTopMm: 8,
  marginBottomMm: 8,
  horizontalGapMm: 2,
  verticalGapMm: 2,
  startRow: 1,
  startColumn: 1,
})

const preset = (value: LabelPreset): Readonly<LabelPreset> => Object.freeze({
  ...value,
  content: Object.freeze({ ...value.content }),
  a4: Object.freeze({ ...value.a4 }),
})

export const LABEL_PRESETS: Readonly<Record<LabelPresetId, Readonly<LabelPreset>>> = Object.freeze({
  compact_sticker: preset({
    id: 'compact_sticker', widthMm: 38, heightMm: 25, marginMm: 1.2,
    barcodeHeightMm: 10, templateId: 'compact', outputMode: 'thermal',
    orientation: 'landscape', productNameSize: 'small', priceStyle: 'normal',
    content: content({ productName: true, sellingPrice: true, unitName: false, barcodeValue: true }),
    a4: { ...defaultA4(), columns: 4, rows: 10 },
  }),
  standard_product: preset({
    id: 'standard_product', widthMm: 50, heightMm: 30, marginMm: 1.5,
    barcodeHeightMm: 12, templateId: 'standard', outputMode: 'thermal',
    orientation: 'landscape', productNameSize: 'normal', priceStyle: 'large',
    content: content({ businessName: true, productName: true, sellingPrice: true, unitName: true, barcodeValue: true }),
    a4: defaultA4(),
  }),
  detailed_product: preset({
    id: 'detailed_product', widthMm: 60, heightMm: 40, marginMm: 2,
    barcodeHeightMm: 14, templateId: 'detailed', outputMode: 'thermal',
    orientation: 'landscape', productNameSize: 'normal', priceStyle: 'large',
    content: content({
      businessName: true, productName: false, productNameAr: true, productNameEn: true,
      sellingPrice: true, unitName: true, sku: true, barcodeValue: true, printDate: false,
    }),
    a4: { ...defaultA4(), rows: 6 },
  }),
  carton_label: preset({
    id: 'carton_label', widthMm: 100, heightMm: 50, marginMm: 3,
    barcodeHeightMm: 20, templateId: 'detailed', outputMode: 'thermal',
    orientation: 'landscape', productNameSize: 'large', priceStyle: 'normal',
    content: content({
      businessName: true, productName: true, sellingPrice: false, unitName: true,
      sku: true, barcodeValue: true,
    }),
    a4: {
      ...defaultA4(),
      orientation: 'landscape',
      columns: 2,
      rows: 3,
      horizontalGapMm: 4,
      verticalGapMm: 4,
    },
  }),
  a4_sheet: preset({
    id: 'a4_sheet', widthMm: 63.5, heightMm: 33.9, marginMm: 1.8,
    barcodeHeightMm: 13, templateId: 'standard', outputMode: 'a4',
    orientation: 'landscape', productNameSize: 'normal', priceStyle: 'large',
    content: content({ businessName: true, productName: true, sellingPrice: true, unitName: true, barcodeValue: true }),
    a4: {
      ...defaultA4(),
      marginTopMm: 12.5,
      marginBottomMm: 12.5,
      verticalGapMm: 0,
    },
  }),
  custom: preset({
    id: 'custom', widthMm: 50, heightMm: 30, marginMm: 1.5,
    barcodeHeightMm: 12, templateId: 'standard', outputMode: 'thermal',
    orientation: 'landscape', productNameSize: 'normal', priceStyle: 'large',
    content: content({ businessName: true, productName: true, sellingPrice: true, unitName: true, barcodeValue: true }),
    a4: defaultA4(),
  }),
})

export const DEFAULT_BARCODE_LABEL_SETTINGS: BarcodeLabelSettings = settingsFromPreset('standard_product')

export const DEFAULT_BARCODE_DEVICE_CALIBRATION: BarcodeDeviceCalibration = {
  schemaVersion: 1,
  printerName: null,
  orientationOverride: 'branch',
  horizontalOffsetMm: 0,
  verticalOffsetMm: 0,
  widthScalePercent: 100,
  heightScalePercent: 100,
  quality: 'normal',
  updatedAt: null,
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const finite = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback
}

const whole = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.floor(finite(value, fallback, min, max))

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback

export function settingsFromPreset(id: LabelPresetId): BarcodeLabelSettings {
  const selected = LABEL_PRESETS[id] ?? LABEL_PRESETS.standard_product
  return {
    schemaVersion: 1,
    presetId: selected.id,
    templateId: selected.templateId,
    outputMode: selected.outputMode,
    widthMm: selected.widthMm,
    heightMm: selected.heightMm,
    marginMm: selected.marginMm,
    barcodeHeightMm: selected.barcodeHeightMm,
    orientation: selected.orientation,
    textAlignment: 'start',
    productNameSize: selected.productNameSize,
    priceStyle: selected.priceStyle,
    content: { ...selected.content },
    a4: { ...selected.a4 },
    defaultCopies: 1,
  }
}

export function normalizeBarcodeLabelSettings(value: unknown): BarcodeLabelSettings {
  const raw = object(value)
  const presetId = oneOf(raw.presetId ?? raw.preset_id, Object.keys(LABEL_PRESETS) as LabelPresetId[], 'standard_product')
  const defaults = settingsFromPreset(presetId)
  const rawContent = object(raw.content)
  const rawA4 = object(raw.a4)
  const normalizedContent: LabelContentSettings = {
    productName: bool(rawContent.productName ?? rawContent.product_name, defaults.content.productName),
    productNameAr: bool(rawContent.productNameAr ?? rawContent.product_name_ar, defaults.content.productNameAr),
    productNameEn: bool(rawContent.productNameEn ?? rawContent.product_name_en, defaults.content.productNameEn),
    sellingPrice: bool(rawContent.sellingPrice ?? rawContent.selling_price, defaults.content.sellingPrice),
    unitName: bool(rawContent.unitName ?? rawContent.unit_name, defaults.content.unitName),
    sku: bool(rawContent.sku, defaults.content.sku),
    businessName: bool(rawContent.businessName ?? rawContent.business_name, defaults.content.businessName),
    barcodeValue: bool(rawContent.barcodeValue ?? rawContent.barcode_value, defaults.content.barcodeValue),
    printDate: bool(rawContent.printDate ?? rawContent.print_date, defaults.content.printDate),
  }
  if (!Object.values(normalizedContent).some(Boolean)) normalizedContent.productName = true

  const columns = whole(rawA4.columns, defaults.a4.columns, 1, 10)
  const rows = whole(rawA4.rows, defaults.a4.rows, 1, 20)
  return {
    schemaVersion: 1,
    presetId,
    templateId: oneOf(raw.templateId ?? raw.template_id, ['compact', 'standard', 'detailed'] as const, defaults.templateId),
    outputMode: oneOf(raw.outputMode ?? raw.output_mode, ['thermal', 'a4'] as const, defaults.outputMode),
    widthMm: finite(raw.widthMm ?? raw.width_mm, defaults.widthMm, 20, 200),
    heightMm: finite(raw.heightMm ?? raw.height_mm, defaults.heightMm, 15, 200),
    marginMm: finite(raw.marginMm ?? raw.margin_mm, defaults.marginMm, 0, 10),
    barcodeHeightMm: finite(raw.barcodeHeightMm ?? raw.barcode_height_mm, defaults.barcodeHeightMm, 6, 40),
    orientation: oneOf(raw.orientation, ['portrait', 'landscape'] as const, defaults.orientation),
    textAlignment: oneOf(raw.textAlignment ?? raw.text_alignment, ['start', 'center'] as const, defaults.textAlignment),
    productNameSize: oneOf(raw.productNameSize ?? raw.product_name_size, ['small', 'normal', 'large'] as const, defaults.productNameSize),
    priceStyle: oneOf(raw.priceStyle ?? raw.price_style, ['normal', 'large'] as const, defaults.priceStyle),
    content: normalizedContent,
    a4: {
      orientation: oneOf(rawA4.orientation, ['portrait', 'landscape'] as const, defaults.a4.orientation),
      columns,
      rows,
      marginLeftMm: finite(rawA4.marginLeftMm ?? rawA4.margin_left_mm, defaults.a4.marginLeftMm, 0, 30),
      marginRightMm: finite(rawA4.marginRightMm ?? rawA4.margin_right_mm, defaults.a4.marginRightMm, 0, 30),
      marginTopMm: finite(rawA4.marginTopMm ?? rawA4.margin_top_mm, defaults.a4.marginTopMm, 0, 30),
      marginBottomMm: finite(rawA4.marginBottomMm ?? rawA4.margin_bottom_mm, defaults.a4.marginBottomMm, 0, 30),
      horizontalGapMm: finite(rawA4.horizontalGapMm ?? rawA4.horizontal_gap_mm, defaults.a4.horizontalGapMm, 0, 20),
      verticalGapMm: finite(rawA4.verticalGapMm ?? rawA4.vertical_gap_mm, defaults.a4.verticalGapMm, 0, 20),
      startRow: whole(rawA4.startRow ?? rawA4.start_row, defaults.a4.startRow, 1, rows),
      startColumn: whole(rawA4.startColumn ?? rawA4.start_column, defaults.a4.startColumn, 1, columns),
    },
    defaultCopies: whole(raw.defaultCopies ?? raw.default_copies, defaults.defaultCopies, 1, 500),
  }
}

export function serializeBarcodeLabelSettings(value: BarcodeLabelSettings): Record<string, unknown> {
  const settings = normalizeBarcodeLabelSettings(value)
  return {
    schema_version: 1,
    preset_id: settings.presetId,
    template_id: settings.templateId,
    output_mode: settings.outputMode,
    width_mm: settings.widthMm,
    height_mm: settings.heightMm,
    margin_mm: settings.marginMm,
    barcode_height_mm: settings.barcodeHeightMm,
    orientation: settings.orientation,
    text_alignment: settings.textAlignment,
    product_name_size: settings.productNameSize,
    price_style: settings.priceStyle,
    content: {
      product_name: settings.content.productName,
      product_name_ar: settings.content.productNameAr,
      product_name_en: settings.content.productNameEn,
      selling_price: settings.content.sellingPrice,
      unit_name: settings.content.unitName,
      sku: settings.content.sku,
      business_name: settings.content.businessName,
      barcode_value: settings.content.barcodeValue,
      print_date: settings.content.printDate,
    },
    a4: {
      orientation: settings.a4.orientation,
      columns: settings.a4.columns,
      rows: settings.a4.rows,
      margin_left_mm: settings.a4.marginLeftMm,
      margin_right_mm: settings.a4.marginRightMm,
      margin_top_mm: settings.a4.marginTopMm,
      margin_bottom_mm: settings.a4.marginBottomMm,
      horizontal_gap_mm: settings.a4.horizontalGapMm,
      vertical_gap_mm: settings.a4.verticalGapMm,
      start_row: settings.a4.startRow,
      start_column: settings.a4.startColumn,
    },
    default_copies: settings.defaultCopies,
  }
}

export function normalizeBarcodeDeviceCalibration(value: unknown): BarcodeDeviceCalibration {
  const raw = object(value)
  const printerName = typeof raw.printerName === 'string' && raw.printerName.trim()
    ? raw.printerName.trim().slice(0, 512)
    : null
  return {
    schemaVersion: 1,
    printerName,
    orientationOverride: oneOf(raw.orientationOverride, ['branch', 'portrait', 'landscape'] as const, 'branch'),
    horizontalOffsetMm: finite(raw.horizontalOffsetMm, 0, -10, 10),
    verticalOffsetMm: finite(raw.verticalOffsetMm, 0, -10, 10),
    widthScalePercent: finite(raw.widthScalePercent, 100, 90, 110),
    heightScalePercent: finite(raw.heightScalePercent, 100, 90, 110),
    quality: oneOf(raw.quality, ['draft', 'normal', 'high'] as const, 'normal'),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

const DEVICE_CALIBRATION_KEY = 'dafra:barcode-label-device:v1'

export function loadBarcodeDeviceCalibration(storage: Pick<Storage, 'getItem'> = localStorage): BarcodeDeviceCalibration {
  try {
    return normalizeBarcodeDeviceCalibration(JSON.parse(storage.getItem(DEVICE_CALIBRATION_KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_BARCODE_DEVICE_CALIBRATION }
  }
}

export function saveBarcodeDeviceCalibration(
  value: BarcodeDeviceCalibration,
  storage: Pick<Storage, 'setItem'> = localStorage,
): BarcodeDeviceCalibration {
  const normalized = normalizeBarcodeDeviceCalibration({ ...value, updatedAt: new Date().toISOString() })
  storage.setItem(DEVICE_CALIBRATION_KEY, JSON.stringify(normalized))
  return normalized
}

export function resetBarcodeDeviceCalibration(storage: Pick<Storage, 'removeItem'> = localStorage): BarcodeDeviceCalibration {
  storage.removeItem(DEVICE_CALIBRATION_KEY)
  return { ...DEFAULT_BARCODE_DEVICE_CALIBRATION }
}
