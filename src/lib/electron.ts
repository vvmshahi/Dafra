export type ReceiptPaperPreset = '80mm' | '58mm' | 'custom'
export type ReceiptFontSize = 'small' | 'normal' | 'large'
export type ReceiptDensity = 'compact' | 'normal' | 'spacious'

export interface PrinterSettings {
  receiptPrinterName: string | null
  receiptPaperPreset: ReceiptPaperPreset
  receiptPaperWidthMm: number
  receiptPrintableWidthMm: number
  receiptScalePercent: number
  receiptMarginLeftMm: number
  receiptMarginRightMm: number
  receiptMarginTopMm: number
  receiptMarginBottomMm: number
  receiptHorizontalOffsetMm: number
  receiptVerticalOffsetMm: number
  receiptFontSize: ReceiptFontSize
  receiptDensity: ReceiptDensity
  receiptCopies: number
  autoPrintReceiptAfterSale: boolean
  fallbackToPreview: boolean
  a4PrinterName: string | null
  a4Copies: number
  updatedAt?: string
  selectedPrinterName?: string | null
  paperWidth?: 58 | 80
  autoPrintAfterSale?: boolean
  copies?: number
}

export interface PrintResult {
  success: boolean
  errorType?: string | null
  message?: string | null
  settings?: PrinterSettings
}

export interface PrintReceiptRequest {
  invoiceId: string
  options?: Partial<PrinterSettings>
}

interface ReceiptReadyPayload {
  invoiceId: string
  jobId: string | null
  error?: string
}

interface ElectronApi {
  isElectron: true
  printSilent: () => Promise<{ success: boolean; errorType?: string | null }>
  getPrinters: () => Promise<any[]>
  getDefaultPrinter: () => Promise<string | null>
  savePrinter: (name: string) => Promise<{ success?: boolean } | void>
  clearPrinter: () => Promise<{ success?: boolean } | void>
  getPrinterSettings: () => Promise<PrinterSettings>
  savePrinterSettings: (settings: Partial<PrinterSettings>) => Promise<{ success?: boolean; settings?: PrinterSettings } | PrinterSettings>
  clearPrinterSettings: () => Promise<{ success?: boolean; settings?: PrinterSettings } | PrinterSettings>
  testPrint: (settings?: Partial<PrinterSettings>) => Promise<PrintResult>
  testPrintA4: (settings?: Partial<PrinterSettings>) => Promise<PrintResult>
  printReceipt: (request: PrintReceiptRequest) => Promise<PrintResult>
  printA4Invoice: () => Promise<PrintResult>
  receiptReady: (payload: ReceiptReadyPayload) => void
  receiptFailed: (payload: ReceiptReadyPayload) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronApi
  }
}

export const isElectron = (): boolean =>
  typeof window !== 'undefined' && window.electronAPI?.isElectron === true

export const isDesktopApp = (): boolean => isElectron()

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  receiptPrinterName: null,
  receiptPaperPreset: '80mm',
  receiptPaperWidthMm: 80,
  receiptPrintableWidthMm: 72,
  receiptScalePercent: 100,
  receiptMarginLeftMm: 2,
  receiptMarginRightMm: 2,
  receiptMarginTopMm: 0,
  receiptMarginBottomMm: 0,
  receiptHorizontalOffsetMm: 0,
  receiptVerticalOffsetMm: 0,
  receiptFontSize: 'normal',
  receiptDensity: 'normal',
  receiptCopies: 1,
  autoPrintReceiptAfterSale: false,
  fallbackToPreview: true,
  a4PrinterName: null,
  a4Copies: 1,
  selectedPrinterName: null,
  paperWidth: 80,
  autoPrintAfterSale: false,
  copies: 1,
}

const copies = (value: unknown): number =>
  Math.max(1, Math.min(3, Math.floor(Number(value)) || 1))

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

const printerName = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const receiptPresetDefaults = (preset: ReceiptPaperPreset): Pick<PrinterSettings, 'receiptPaperWidthMm' | 'receiptPrintableWidthMm'> => {
  if (preset === '58mm') return { receiptPaperWidthMm: 58, receiptPrintableWidthMm: 48 }
  return { receiptPaperWidthMm: 80, receiptPrintableWidthMm: 72 }
}

const normalizePrinterSettings = (settings?: Partial<PrinterSettings> | null): PrinterSettings => {
  const source = settings ?? {}
  const legacyPaperWidth = source.paperWidth === 58 ? 58 : 80
  const derivedPreset: ReceiptPaperPreset = Number(source.receiptPaperWidthMm ?? legacyPaperWidth) === 58 ? '58mm' : '80mm'
  const preset: ReceiptPaperPreset = source.receiptPaperPreset === '58mm' || source.receiptPaperPreset === '80mm' || source.receiptPaperPreset === 'custom'
    ? source.receiptPaperPreset
    : derivedPreset
  const presetDefaults = receiptPresetDefaults(preset)
  const paperWidth = preset === 'custom'
    ? clamp(source.receiptPaperWidthMm, presetDefaults.receiptPaperWidthMm, 40, 120)
    : presetDefaults.receiptPaperWidthMm
  const printableWidth = Math.min(
    clamp(source.receiptPrintableWidthMm, presetDefaults.receiptPrintableWidthMm, 30, Math.max(30, paperWidth - 1)),
    paperWidth - 1,
  )
  const receiptPrinterName = printerName(source.receiptPrinterName ?? source.selectedPrinterName)
  const autoPrintReceiptAfterSale = typeof source.autoPrintReceiptAfterSale === 'boolean'
    ? source.autoPrintReceiptAfterSale
    : typeof source.autoPrintAfterSale === 'boolean'
      ? source.autoPrintAfterSale
      : DEFAULT_PRINTER_SETTINGS.autoPrintReceiptAfterSale
  const receiptCopies = copies(source.receiptCopies ?? source.copies ?? DEFAULT_PRINTER_SETTINGS.receiptCopies)

  return {
    ...DEFAULT_PRINTER_SETTINGS,
    ...source,
    receiptPrinterName,
    receiptPaperPreset: preset,
    receiptPaperWidthMm: paperWidth,
    receiptPrintableWidthMm: printableWidth,
    receiptScalePercent: Math.round(clamp(source.receiptScalePercent, 100, 70, 110)),
    receiptMarginLeftMm: clamp(source.receiptMarginLeftMm, 2, 0, 10),
    receiptMarginRightMm: clamp(source.receiptMarginRightMm, 2, 0, 10),
    receiptMarginTopMm: clamp(source.receiptMarginTopMm, 0, 0, 10),
    receiptMarginBottomMm: clamp(source.receiptMarginBottomMm, 0, 0, 10),
    receiptHorizontalOffsetMm: clamp(source.receiptHorizontalOffsetMm, 0, -10, 10),
    receiptVerticalOffsetMm: clamp(source.receiptVerticalOffsetMm, 0, -10, 10),
    receiptFontSize: source.receiptFontSize === 'small' || source.receiptFontSize === 'large' ? source.receiptFontSize : 'normal',
    receiptDensity: source.receiptDensity === 'compact' || source.receiptDensity === 'spacious' ? source.receiptDensity : 'normal',
    receiptCopies,
    autoPrintReceiptAfterSale,
    fallbackToPreview: typeof source.fallbackToPreview === 'boolean' ? source.fallbackToPreview : DEFAULT_PRINTER_SETTINGS.fallbackToPreview,
    a4PrinterName: printerName(source.a4PrinterName),
    a4Copies: copies(source.a4Copies ?? DEFAULT_PRINTER_SETTINGS.a4Copies),
    selectedPrinterName: receiptPrinterName,
    paperWidth: paperWidth === 58 ? 58 : 80,
    autoPrintAfterSale: autoPrintReceiptAfterSale,
    copies: receiptCopies,
  }
}

export const printSilent = async (): Promise<void> => {
  if (isElectron()) {
    const result = await window.electronAPI?.printSilent()
    if (!result?.success) window.print()
  } else {
    window.print()
  }
}

export const getPrinters = async (): Promise<any[]> => {
  if (!isElectron()) return []
  return window.electronAPI?.getPrinters() ?? []
}

export const getDefaultPrinter = async (): Promise<string | null> => {
  if (!isElectron()) return null
  if (window.electronAPI?.getPrinterSettings) {
    return (await getPrinterSettings()).receiptPrinterName
  }
  return window.electronAPI?.getDefaultPrinter() ?? null
}

export const savePrinter = async (name: string): Promise<void> => {
  if (!isElectron()) return
  if (window.electronAPI?.savePrinterSettings) {
    await savePrinterSettings({ receiptPrinterName: name })
    return
  }
  await window.electronAPI?.savePrinter(name)
}

export const clearPrinter = async (): Promise<void> => {
  if (!isElectron()) return
  if (window.electronAPI?.savePrinterSettings) {
    await savePrinterSettings({ receiptPrinterName: null })
    return
  }
  await window.electronAPI?.clearPrinter()
}

export const getPrinterSettings = async (): Promise<PrinterSettings> => {
  if (!isElectron()) return DEFAULT_PRINTER_SETTINGS
  const settings = await window.electronAPI?.getPrinterSettings?.()
  return normalizePrinterSettings(settings)
}

export const savePrinterSettings = async (settings: Partial<PrinterSettings>): Promise<PrinterSettings> => {
  if (!isElectron()) return normalizePrinterSettings(settings)
  const result = await window.electronAPI?.savePrinterSettings?.(settings)
  if (result && 'settings' in result && result.settings) {
    return normalizePrinterSettings(result.settings)
  }
  return normalizePrinterSettings(result as PrinterSettings)
}

export const clearPrinterSettings = async (): Promise<PrinterSettings> => {
  if (!isElectron()) return DEFAULT_PRINTER_SETTINGS
  const result = await window.electronAPI?.clearPrinterSettings?.()
  if (result && 'settings' in result && result.settings) {
    return normalizePrinterSettings(result.settings)
  }
  return DEFAULT_PRINTER_SETTINGS
}

export const testPrint = async (settings?: Partial<PrinterSettings>): Promise<PrintResult> => {
  if (!isElectron()) {
    return { success: false, errorType: 'NOT_ELECTRON', message: 'Direct printing is available in the Kubri desktop app.' }
  }
  return window.electronAPI?.testPrint?.(settings) ?? { success: false, errorType: 'IPC_UNAVAILABLE', message: 'Printer bridge is unavailable.' }
}

export const testPrintA4 = async (settings?: Partial<PrinterSettings>): Promise<PrintResult> => {
  if (!isElectron()) {
    return { success: false, errorType: 'NOT_ELECTRON', message: 'A4 direct printing is available in the Kubri desktop app.' }
  }
  return window.electronAPI?.testPrintA4?.(settings) ?? { success: false, errorType: 'IPC_UNAVAILABLE', message: 'Printer bridge is unavailable.' }
}

export const printReceipt = async (request: PrintReceiptRequest): Promise<PrintResult> => {
  if (!isElectron()) {
    return { success: false, errorType: 'NOT_ELECTRON', message: 'Direct receipt printing is available in the Kubri desktop app.' }
  }
  return window.electronAPI?.printReceipt?.(request) ?? { success: false, errorType: 'IPC_UNAVAILABLE', message: 'Printer bridge is unavailable.' }
}

export const printA4Invoice = async (): Promise<PrintResult> => {
  if (!isElectron()) {
    window.print()
    return { success: true }
  }
  return window.electronAPI?.printA4Invoice?.() ?? { success: false, errorType: 'IPC_UNAVAILABLE', message: 'Printer bridge is unavailable.' }
}
