const HIDDEN_RECEIPT_PRINT_TIMEOUT_MS = 20_000

let activeHiddenReceiptPrint: Promise<void> | null = null

export function receiptPreviewUrl(invoiceId: string, autoPrint = true) {
  return `/print/receipt/${encodeURIComponent(invoiceId)}${autoPrint ? '?autoprint=1' : ''}`
}

export function openReceiptPreview(invoiceId: string, autoPrint = true) {
  const opened = window.open('about:blank', '_blank')
  if (!opened) return false
  try {
    opened.location.replace(receiptPreviewUrl(invoiceId, autoPrint))
    return true
  } catch {
    opened.close()
    return false
  }
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

    const cleanup = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId)
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
      timeoutId = window.setTimeout(() => settle(), HIDDEN_RECEIPT_PRINT_TIMEOUT_MS)
    }

    iframe.onerror = () => settle(new Error('Receipt print frame failed to load.'))
    iframe.src = receiptPreviewUrl(invoiceId, true)
    document.body.appendChild(iframe)
  })

  try {
    await activeHiddenReceiptPrint
  } finally {
    activeHiddenReceiptPrint = null
  }
}
