import type { Branch, Invoice } from '@/types/database'

/**
 * Routes an already-issued fiscal document to its canonical read contract.
 *
 * A Sandbox fiscal document obtains its final QR through the authenticated
 * Sandbox status endpoint.  This is deliberately based on the persisted
 * branch environment, rather than a historical branch UUID allow-list.
 */
export function isSandboxFiscalDocument(
  invoice: Pick<Invoice, 'is_demo'> | null | undefined,
  branch: Pick<Branch, 'zatca_environment'> | null | undefined,
): boolean {
  return invoice?.is_demo !== true && branch?.zatca_environment === 'sandbox'
}
