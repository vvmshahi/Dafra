export type PrinterPaperWidth = 58 | 80

export interface PrinterSettings {
  selectedPrinterName: string | null
  paperWidth: PrinterPaperWidth
  autoPrintAfterSale: boolean
  copies: number
  fallbackToPreview: boolean
  updatedAt?: string
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
  printReceipt: (request: PrintReceiptRequest) => Promise<PrintResult>
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
  selectedPrinterName: null,
  paperWidth: 80,
  autoPrintAfterSale: false,
  copies: 1,
  fallbackToPreview: true,
}

const normalizePrinterSettings = (settings?: Partial<PrinterSettings> | null): PrinterSettings => ({
  ...DEFAULT_PRINTER_SETTINGS,
  ...settings,
  paperWidth: settings?.paperWidth === 58 ? 58 : 80,
  copies: Math.max(1, Math.min(3, Math.floor(Number(settings?.copies ?? DEFAULT_PRINTER_SETTINGS.copies)) || 1)),
  selectedPrinterName: typeof settings?.selectedPrinterName === 'string' && settings.selectedPrinterName.trim()
    ? settings.selectedPrinterName.trim()
    : null,
})

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
    return (await getPrinterSettings()).selectedPrinterName
  }
  return window.electronAPI?.getDefaultPrinter() ?? null
}

export const savePrinter = async (name: string): Promise<void> => {
  if (!isElectron()) return
  if (window.electronAPI?.savePrinterSettings) {
    await savePrinterSettings({ selectedPrinterName: name })
    return
  }
  await window.electronAPI?.savePrinter(name)
}

export const clearPrinter = async (): Promise<void> => {
  if (!isElectron()) return
  if (window.electronAPI?.savePrinterSettings) {
    await savePrinterSettings({ selectedPrinterName: null })
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

export const printReceipt = async (request: PrintReceiptRequest): Promise<PrintResult> => {
  if (!isElectron()) {
    return { success: false, errorType: 'NOT_ELECTRON', message: 'Direct receipt printing is available in the Kubri desktop app.' }
  }
  return window.electronAPI?.printReceipt?.(request) ?? { success: false, errorType: 'IPC_UNAVAILABLE', message: 'Printer bridge is unavailable.' }
}
