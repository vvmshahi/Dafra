export const QR_RENDER_TIMEOUT_MS: number
export const QR_DISPLAY_TIMEOUT_MS: number

export type QrDisplayStatus = 'loading' | 'ready' | 'missing' | 'failed'

export interface StoredOutputStateQr {
  contractMode?: 'legacy' | 'v2' | null
  legacyCompatible?: boolean
  compatible?: boolean
  canPrint?: boolean
  qrCode?: string | null
}

export interface QrRenderResult {
  status: Exclude<QrDisplayStatus, 'loading'>
  dataUrl: string | null
}

export function selectStoredOutputStateQr(
  outputState: StoredOutputStateQr | null | undefined,
): string | null

export function canOpenStoredInvoicePrint(
  invoiceStatus: string | null | undefined,
  outputStateCanPrint: boolean,
): boolean

export function renderStoredQrDataUrl(
  payload: string | null | undefined,
  renderer: (payload: string) => Promise<string>,
  timeoutMs?: number,
): Promise<QrRenderResult>
