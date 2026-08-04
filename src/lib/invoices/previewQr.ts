import QRCode from 'qrcode'

export type PreviewQrState =
  | 'eligible_simplified'
  | 'eligible_standard'
  | 'demo'
  | 'unavailable'

const PREVIEW_PAYLOADS: Record<Exclude<PreviewQrState, 'demo' | 'unavailable'>, string> = {
  eligible_simplified: 'KUBRI_PREVIEW_ONLY|SIMPLIFIED|SAMPLE-0042|2026-01-15T13:30:00+03:00|SAR58.00',
  eligible_standard: 'KUBRI_PREVIEW_ONLY|STANDARD_CLEARED|SAMPLE-0042|2026-01-15T13:30:00+03:00|SAR58.00',
}

export async function createPreviewQrDataUrl(state: PreviewQrState): Promise<string | null> {
  if (state === 'demo' || state === 'unavailable') return null
  return QRCode.toDataURL(PREVIEW_PAYLOADS[state], {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  })
}
