import { isElectron, printBarcode, type PrintResult } from '@/lib/electron'
import { browserBarcodePrintAdapter } from './labelPrint'

export interface NativeBarcodePrintOptions {
  printerName?: string | null
  copies?: number
}

export async function printBarcodeDocumentNative(
  documentHtml: string,
  options: NativeBarcodePrintOptions = {},
): Promise<PrintResult & { native: boolean }> {
  if (!isElectron()) {
    browserBarcodePrintAdapter.print(documentHtml)
    return { success: true, native: false }
  }

  const parsed = new DOMParser().parseFromString(documentHtml, 'text/html')
  const root = parsed.documentElement
  const pageWidthMm = Number(root.dataset.kubriPageWidthMm)
  const pageHeightMm = Number(root.dataset.kubriPageHeightMm)
  if (!root.matches('[data-kubri-barcode-print="v1"]') || !Number.isFinite(pageWidthMm) || !Number.isFinite(pageHeightMm)) {
    return { success: false, native: true, errorType: 'INVALID_BARCODE_DOCUMENT', message: 'Barcode document geometry is unavailable.' }
  }
  parsed.querySelectorAll('script').forEach(script => script.remove())
  return {
    ...(await printBarcode({
      documentHtml: `<!doctype html>${root.outerHTML}`,
      pageWidthMm,
      pageHeightMm,
      printerName: options.printerName,
      copies: options.copies,
    })),
    native: true,
  }
}
