import type { ZatcaOutputState } from '@/lib/zatca/submission'
import { getInvoiceZatcaOutputState } from '@/lib/zatca/submission'
import { canOpenStoredInvoicePrint, renderStoredQrDataUrl, type QrDisplayStatus } from '@/lib/zatca/qrDisplay.mjs'

export type IssuedDocumentReadiness = 'loading_document' | 'loading_qr' | 'ready' | 'qr_failed'

const OUTPUT_CACHE_TTL_MS = 5 * 60_000
const outputCache = new Map<string, ZatcaOutputState>()
const qrRenderCache = new Map<string, Promise<{ status: QrDisplayStatus; dataUrl: string | null }>>()
const storageKey = (invoiceId: string) => `kubri:issued-output:${invoiceId}`

export async function readIssuedDocumentOutputState(params: { invoiceId: string; branchId: string; refresh?: boolean }): Promise<ZatcaOutputState> {
  if (!params.refresh) {
    const memory = outputCache.get(params.invoiceId)
    if (memory) return memory
    try {
      const cached = JSON.parse(window.sessionStorage.getItem(storageKey(params.invoiceId)) ?? 'null') as { expiresAt?: number; state?: ZatcaOutputState } | null
      if (cached?.state?.invoiceId === params.invoiceId && cached.expiresAt && cached.expiresAt > Date.now() && cached.state.canPrint && cached.state.qrCode) {
        outputCache.set(params.invoiceId, cached.state)
        return cached.state
      }
    } catch { /* session cache is optional */ }
  }
  const state = await getInvoiceZatcaOutputState(params)
  // Only final printable output is immutable enough to reuse. No credentials or
  // signing material is retained in the browser cache.
  if (state.canPrint && state.qrCode) {
    outputCache.set(state.invoiceId, state)
    try { window.sessionStorage.setItem(storageKey(state.invoiceId), JSON.stringify({ expiresAt: Date.now() + OUTPUT_CACHE_TTL_MS, state })) } catch { /* optional */ }
  }
  return state
}

export function renderIssuedDocumentQr(invoiceId: string, payload: string | null, renderer: (payload: string) => Promise<string>) {
  const key = `${invoiceId}:${payload ?? ''}`
  let pending = qrRenderCache.get(key)
  if (!pending) {
    pending = renderStoredQrDataUrl(payload, renderer)
    qrRenderCache.set(key, pending)
  }
  return pending
}

export function resolveIssuedDocumentReadiness(input: { modelReady: boolean; nonFiscalDemo: boolean; outputCanPrint: boolean; qrPayload: string | null; qrStatus: QrDisplayStatus; qrDataUrl: string | null }) {
  if (!input.modelReady) return { phase: 'loading_document' as IssuedDocumentReadiness, printable: false }
  if (input.nonFiscalDemo) return { phase: 'ready' as IssuedDocumentReadiness, printable: true }
  if (input.qrStatus === 'loading') return { phase: 'loading_qr' as IssuedDocumentReadiness, printable: false }
  const printable = canOpenStoredInvoicePrint(input.outputCanPrint, input.qrPayload, input.qrStatus, input.qrDataUrl)
  return { phase: printable ? 'ready' as IssuedDocumentReadiness : 'qr_failed' as IssuedDocumentReadiness, printable }
}
