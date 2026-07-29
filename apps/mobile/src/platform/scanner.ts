import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner'

let lastScan = { value: '', at: 0 }

export async function scanSingleBarcode() {
  const result = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.ALL,
    scanInstructions: 'Align one product barcode inside the frame',
    cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
    scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
  })
  const value = result.ScanResult?.trim() ?? ''
  const now = Date.now()
  if (value && value === lastScan.value && now - lastScan.at < 1500) return null
  lastScan = { value, at: now }
  return value || null
}
