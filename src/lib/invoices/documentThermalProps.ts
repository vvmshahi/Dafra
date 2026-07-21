import type { ThermalRenderOptions } from '@/components/print/ThermalReceipt'
import type { DocumentViewModel } from './documentViewModel'

/** Only image resolution belongs outside the snapshot-driven renderer. */
export function thermalRenderOptions(_model: DocumentViewModel, qrImageUrl: string | null, preview = false): ThermalRenderOptions {
  return { preview, qrImageUrl }
}
