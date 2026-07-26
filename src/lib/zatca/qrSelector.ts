import type { ZatcaEnvironment } from '@/types/database'

export interface StoredQrInvoice {
  zatca_finalization_version?: number | null
  zatca_artifact_provenance?: string | null
  zatca_document_kind?: string | null
  zatca_lifecycle_state?: string | null
  zatca_artifact_stage?: string | null
  zatca_simplified_qr?: string | null
  zatca_cleared_qr?: string | null
  /** Legacy-only. Never selected for production v2 customer output. */
  zatca_qr_code?: string | null
}

export interface QrSelectionOptions {
  /** Only true for an explicitly sandbox-generated document. */
  sandboxGenerated?: boolean
  sandboxQrCode?: string | null
}

/**
 * Selects a compliance QR for display without generating or persisting a
 * replacement. Production documents are always read from the stored final
 * server value. Sandbox values are allowed only for explicitly sandbox-origin
 * documents and never override a stored production QR.
 */
export function selectStoredInvoiceQr(
  invoice: StoredQrInvoice | null | undefined,
  environment: ZatcaEnvironment,
  options: QrSelectionOptions = {},
): string | null {
  const verifiedV2 = invoice?.zatca_finalization_version === 2
    && invoice?.zatca_artifact_provenance === 'server_v2'
  if (verifiedV2 && invoice?.zatca_document_kind === 'simplified'
      && invoice?.zatca_artifact_stage === 'simplified_final') {
    const simplified = typeof invoice.zatca_simplified_qr === 'string' ? invoice.zatca_simplified_qr.trim() : ''
    return simplified || null
  }
  if (verifiedV2 && invoice?.zatca_document_kind === 'standard'
      && invoice?.zatca_artifact_stage === 'standard_cleared'
      && invoice?.zatca_lifecycle_state === 'cleared_final') {
    const cleared = typeof invoice.zatca_cleared_qr === 'string' ? invoice.zatca_cleared_qr.trim() : ''
    return cleared || null
  }
  if (environment === 'sandbox' && options.sandboxGenerated) {
    const sandbox = typeof options.sandboxQrCode === 'string' ? options.sandboxQrCode.trim() : ''
    return sandbox || null
  }
  return null
}
