import A4Document from './A4Document'
import ThermalReceipt from './ThermalReceipt'
import type { DocumentViewModel } from '@/lib/invoices/documentViewModel'

/**
 * Compatibility wrapper for older preview callers. Presentation resolution,
 * totals, QR placement, and footer rendering all remain in the canonical
 * document renderers; this component intentionally contains no fallback data.
 */
export default function DocumentPreview({ model, mode }: { model: DocumentViewModel; mode: 'thermal' | 'a4'; logoSrc?: string | null; copy?: Record<string, string> }) {
  return mode === 'thermal'
    ? <ThermalReceipt model={model} options={{ preview: true }} />
    : <A4Document model={model} options={{ preview: true }} />
}
