export const QR_RENDER_TIMEOUT_MS = 5_000
export const QR_DISPLAY_TIMEOUT_MS = 8_000

function hasFinalStoredOutput(outputState) {
  if (!outputState || outputState.canPrint !== true) {
    return false
  }

  if (outputState.contractMode === 'legacy') {
    const accepted = outputState.invoiceStatus === 'reported'
      || outputState.invoiceStatus === 'cleared'
    const finalMarker = outputState.artifactStage === 'legacy_final'
      || outputState.finalizationStatus === 'legacy_reported'
      || outputState.finalizationStatus === 'legacy_cleared'
      || outputState.finalizationStatus === 'legacy_final'
    return outputState.legacyCompatible === true && accepted && finalMarker
  }

  if (outputState.contractMode !== 'v2') return false
  if (outputState.documentKind === 'simplified') {
    return outputState.artifactStage === 'simplified_final'
  }
  if (outputState.documentKind === 'standard') {
    return outputState.invoiceStatus === 'cleared'
      && outputState.artifactStage === 'standard_cleared'
      && outputState.finalizationStatus === 'cleared_final'
  }
  return false
}

/**
 * Select the finalized QR exposed by the authenticated output-state contract.
 * The Edge response has already selected the correct stored legacy/v2 field;
 * the browser must not reinterpret or regenerate that payload. Capability,
 * readiness, and checkout-version metadata must not erase a printable output
 * that the authenticated server contract has already finalized.
 */
export function selectStoredOutputStateQr(outputState) {
  if (!hasFinalStoredOutput(outputState)) return null

  const payload = typeof outputState.qrCode === 'string' ? outputState.qrCode.trim() : ''
  return payload || null
}

/**
 * Printing is permitted only after the authenticated finalized payload has
 * rendered to a non-empty QR image. A missing or failed QR is visible but can
 * never produce a customer print without its finalized QR.
 */
export function canOpenStoredInvoicePrint(
  outputStateCanPrint,
  storedQrPayload,
  qrStatus,
  qrDataUrl,
) {
  return outputStateCanPrint === true
    && typeof storedQrPayload === 'string'
    && storedQrPayload.trim().length > 0
    && qrStatus === 'ready'
    && typeof qrDataUrl === 'string'
    && qrDataUrl.trim().length > 0
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
