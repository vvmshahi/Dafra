export const QR_RENDER_TIMEOUT_MS = 5_000
export const QR_DISPLAY_TIMEOUT_MS = 8_000

/**
 * Select the finalized QR exposed by the authenticated output-state contract.
 * The Edge response has already selected the correct stored legacy/v2 field;
 * the browser must not reinterpret or regenerate that payload.
 */
export function selectStoredOutputStateQr(outputState) {
  if (!outputState || outputState.compatible !== true || outputState.canPrint !== true) return null
  if (outputState.contractMode === 'legacy') {
    if (outputState.legacyCompatible !== true) return null
  } else if (outputState.contractMode !== 'v2') {
    return null
  }

  const payload = typeof outputState.qrCode === 'string' ? outputState.qrCode.trim() : ''
  return payload || null
}

/**
 * Reported/cleared invoices remain printable if QR image rendering fails.
 * A positive authenticated output-state decision also covers finalized v2
 * output that is printable before the invoice status changes.
 */
export function canOpenStoredInvoicePrint(invoiceStatus, outputStateCanPrint) {
  return outputStateCanPrint === true
    || invoiceStatus === 'reported'
    || invoiceStatus === 'cleared'
}

/**
 * Render only a supplied stored QR payload, with a terminal result for missing
 * values, renderer failures, and renderer promises that never settle.
 */
export async function renderStoredQrDataUrl(
  payload,
  renderer,
  timeoutMs = QR_RENDER_TIMEOUT_MS,
) {
  const storedPayload = typeof payload === 'string' ? payload.trim() : ''
  if (!storedPayload) return { status: 'missing', dataUrl: null }

  let timeoutId
  try {
    const dataUrl = await Promise.race([
      renderer(storedPayload),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Stored QR rendering timed out.')), timeoutMs)
      }),
    ])
    if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
      return { status: 'failed', dataUrl: null }
    }
    return { status: 'ready', dataUrl }
  } catch {
    return { status: 'failed', dataUrl: null }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
