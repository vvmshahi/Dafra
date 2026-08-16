import { isAndroidBrowser, openPrintPopup } from '@/lib/print/browserPrint'

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

/**
 * Opens the visible receipt document used by browser printing.  This must run
 * directly from the click handler so browsers retain the user gesture needed
 * to allow the popup.  The route itself waits for receipt assets and layout
 * readiness before it asks the browser to print.
 */
export function openBrowserReceiptPrint(invoiceId: string): void {
  if (typeof window === 'undefined') throw new Error('Receipt printing is unavailable in this environment.')
  openPrintPopup(receiptPreviewUrl(invoiceId, true))
}

export async function printReceiptInHiddenFrame(invoiceId: string): Promise<void> {
  if (typeof window === 'undefined') throw new Error('Receipt printing is unavailable in this environment.')
  if (activeHiddenReceiptPrint) return activeHiddenReceiptPrint
  // Chrome on Android can snapshot a transparent one-pixel iframe as blank.
  // Its normal receipt route stays visibly rendered until its own ready check
  // completes, then invokes the system print UI.
  if (isAndroidBrowser()) {
    openBrowserReceiptPrint(invoiceId)
    return
  }
  activeHiddenReceiptPrint = new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe')
    const frameUrl = receiptPreviewUrl(invoiceId, false, true)
    let printFallbackId: number | null = null
    let settled = false

    frame.title = 'Receipt print frame'
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.src = frameUrl
    frame.style.position = 'fixed'
    frame.style.inset = '0 auto auto -10000px'
    frame.style.width = '1px'
    frame.style.height = '1px'
    frame.style.border = '0'
    frame.style.opacity = '0'
    frame.style.pointerEvents = 'none'

    const cleanup = () => {
      if (printFallbackId !== null) window.clearTimeout(printFallbackId)
      window.removeEventListener('message', handleMessage)
      frame.remove()
    }
    const finish = () => {
      if (settled) return
      settled = true
      window.setTimeout(() => {
        cleanup()
        resolve()
      }, 750)
    }
    const fail = (error: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(error))
    }
    const handleMessage = (event: MessageEvent<{ type?: string; invoiceId?: string; error?: string }>) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow || event.data?.invoiceId !== invoiceId) return
      if (event.data.type === RECEIPT_FRAME_FAILED) {
        fail(event.data.error || 'PRINT_DOCUMENT_NOT_READY')
        return
      }
      if (event.data.type !== RECEIPT_FRAME_READY || settled) return
      try {
        frame.contentWindow?.addEventListener('afterprint', finish, { once: true })
        frame.contentWindow?.print()
        printFallbackId = window.setTimeout(finish, 15_000)
      } catch {
        fail('PRINT_FAILED')
      }
    }

    window.addEventListener('message', handleMessage)
    document.body.appendChild(frame)
  })
  try { await activeHiddenReceiptPrint } finally { activeHiddenReceiptPrint = null }
}
