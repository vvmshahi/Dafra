const HIDDEN_RECEIPT_PRINT_TIMEOUT_MS = 20_000
const AFTER_PRINT_FALLBACK_MS = 2_000

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
  if (activeHiddenReceiptPrint) return activeHiddenReceiptPrint

  activeHiddenReceiptPrint = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Receipt printing is unavailable in this environment.'))
      return
    }

    const iframe = document.createElement('iframe')
    let settled = false
    let timeoutId: number | null = null
    let afterPrintFallbackId: number | null = null

    const cleanup = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
      if (afterPrintFallbackId !== null) window.clearTimeout(afterPrintFallbackId)
      window.removeEventListener('message', handleMessage)
      iframe.contentWindow?.removeEventListener('afterprint', handleAfterPrint)
      iframe.remove()
    }

    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }

    const handleAfterPrint = () => settle()
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || event.origin !== window.location.origin) return
      if (event.data?.invoiceId !== invoiceId) return
      if (event.data?.type === RECEIPT_FRAME_FAILED) {
        settle(new Error(
          typeof event.data?.error === 'string'
            ? event.data.error
            : 'Receipt content could not be prepared for printing.',
        ))
        return
      }
      if (event.data?.type !== RECEIPT_FRAME_READY) return
      const frameWindow = iframe.contentWindow
      if (!frameWindow) {
        settle(new Error('Receipt print frame could not be loaded.'))
        return
      }
      try {
        frameWindow.focus()
        frameWindow.print()
        afterPrintFallbackId = window.setTimeout(() => settle(), AFTER_PRINT_FALLBACK_MS)
      } catch {
        settle(new Error('Receipt print dialog could not be opened.'))
      }
    }

    iframe.title = 'Receipt print frame'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '1px'
    iframe.style.height = '1px'
    iframe.style.border = '0'
    iframe.style.opacity = '0'
    iframe.style.pointerEvents = 'none'

    iframe.onload = () => {
      const frameWindow = iframe.contentWindow
      if (!frameWindow) {
        settle(new Error('Receipt print frame could not be loaded.'))
        return
      }
      frameWindow.addEventListener('afterprint', handleAfterPrint, { once: true })
    }

    iframe.onerror = () => settle(new Error('Receipt print frame failed to load.'))
    window.addEventListener('message', handleMessage)
    timeoutId = window.setTimeout(
      () => settle(new Error('Receipt print content did not become ready in time.')),
      HIDDEN_RECEIPT_PRINT_TIMEOUT_MS,
    )
    iframe.src = receiptPreviewUrl(invoiceId, false, true)
    document.body.appendChild(iframe)
  })

  try {
    await activeHiddenReceiptPrint
  } finally {
    activeHiddenReceiptPrint = null
  }
}
