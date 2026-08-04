import { openPrintPopup } from '@/lib/print/browserPrint'

let activeHiddenReceiptPrint: Promise<void> | null = null

export const RECEIPT_FRAME_READY = 'dafra:receipt-frame-ready'
export const RECEIPT_FRAME_FAILED = 'dafra:receipt-frame-failed'

export function receiptPreviewUrl(invoiceId: string, autoPrint = true, embedded = false) {
  const params = new URLSearchParams()
  if (autoPrint) params.set('auto', '1')
  if (embedded) params.set('embedded', '1')
  const query = params.toString()
  return `/print/receipt/${encodeURIComponent(invoiceId)}${query ? `?${query}` : ''}`
}

export function openReceiptPreview(invoiceId: string, autoPrint = true) {
  const opened = window.open(receiptPreviewUrl(invoiceId, autoPrint), '_blank', 'noopener,noreferrer')
  return !!opened
}

export async function printReceiptInHiddenFrame(invoiceId: string): Promise<void> {
  if (typeof window === 'undefined') throw new Error('Receipt printing is unavailable in this environment.')
  if (activeHiddenReceiptPrint) return activeHiddenReceiptPrint
  activeHiddenReceiptPrint = Promise.resolve().then(() => {
    openPrintPopup(receiptPreviewUrl(invoiceId, true))
  })
  try { await activeHiddenReceiptPrint } finally { activeHiddenReceiptPrint = null }
}
