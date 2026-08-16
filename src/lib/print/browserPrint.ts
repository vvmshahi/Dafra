export const PRINT_POPUP_BLOCKED = 'PRINT_POPUP_BLOCKED'

const PREPARING_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><title>Preparing document</title></head><body style="margin:0;padding:2rem;font:600 16px system-ui;color:#334155;background:#f8fafc">Preparing document…</body></html>`

export function isAndroidBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

export function openPrintPopup(path: string): Window {
  const popup = window.open('about:blank', '_blank', 'noopener,noreferrer')
  if (!popup) throw new Error(PRINT_POPUP_BLOCKED)
  try {
    popup.document.open()
    popup.document.write(PREPARING_DOCUMENT)
    popup.document.close()
    popup.location.replace(path)
  } catch {
    try { popup.close() } catch { /* best effort */ }
    throw new Error('PRINT_POPUP_OPEN_FAILED')
  }
  return popup
}

export async function waitForPrintableAssets(
  root: Document | HTMLElement = document,
  timeoutMs = 7000,
): Promise<void> {
  const documentRoot = typeof Document !== 'undefined' && root instanceof Document
    ? root
    : root.ownerDocument ?? document
  const images = Array.from(root.querySelectorAll('img'))
  const imageReady = images.map(image => image.complete && image.naturalWidth > 0
    ? Promise.resolve()
    : new Promise<void>(resolve => {
      const finish = () => {
        image.removeEventListener('load', finish)
        image.removeEventListener('error', finish)
        resolve()
      }
      image.addEventListener('load', finish, { once: true })
      image.addEventListener('error', finish, { once: true })
    }))
  const fontsReady = documentRoot.fonts?.ready?.catch(() => undefined) ?? Promise.resolve()
  const ready = Promise.all([...imageReady, fontsReady]).then(() => new Promise<boolean>(resolve => {
    const checkLayout = () => {
      const element = typeof HTMLElement !== 'undefined' && root instanceof HTMLElement ? root : documentRoot.body
      const rect = element?.getBoundingClientRect()
      if ((rect?.width ?? 0) > 0 && (rect?.height ?? 0) > 0) {
        resolve(true)
        return
      }
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(false)))
    }
    requestAnimationFrame(checkLayout)
  }))
  const readyInTime = await Promise.race([
    ready,
    new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), timeoutMs)),
  ])
  if (!readyInTime) throw new Error('PRINT_DOCUMENT_NOT_READY')
}

export function printCurrentDocument(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let afterPrintDelayId: number | null = null
    const finish = () => {
      if (settled) return
      // Android Chrome can dispatch afterprint while its preview is still
      // taking the snapshot. Keep the print-only DOM and CSS alive briefly.
      afterPrintDelayId = window.setTimeout(() => {
        if (settled) return
        settled = true
        window.removeEventListener('afterprint', finish)
        if (fallbackId !== null) window.clearTimeout(fallbackId)
        const temporaryPrintContext = window.opener && window.opener !== window
          && (window.location.pathname.startsWith('/print/') || window.location.search.includes('print=1'))
        if (temporaryPrintContext) {
          try { window.close() } catch { /* browser may refuse to close it */ }
        }
        resolve()
      }, 750)
    }
    let fallbackId: number | null = null
    window.addEventListener('afterprint', finish, { once: true })
    try {
      window.print()
      fallbackId = window.setTimeout(finish, 15_000)
    } catch (error) {
      window.removeEventListener('afterprint', finish)
      if (afterPrintDelayId !== null) window.clearTimeout(afterPrintDelayId)
      reject(error)
    }
  })
}
