import type { DocumentViewModel } from './documentViewModel'

export type DocumentPresentationReadiness =
  | 'ready'
  | 'legacy_standard_buyer_snapshot_missing'
  | 'standard_buyer_identity_incomplete'

/**
 * Presentation may only expose a Tax Invoice when its buyer block comes from
 * the immutable issue-time snapshot and satisfies Kubri's existing Standard
 * buyer contract. Simplified documents can remain readable when historical
 * buyer identity was never captured, because they do not require that block.
 */
export function resolveDocumentPresentationReadiness(model: DocumentViewModel): DocumentPresentationReadiness {
  if (model.identity.invoiceType !== 'standard') return 'ready'
  if (model.buyer.snapshotState !== 'captured') return 'legacy_standard_buyer_snapshot_missing'
  return model.buyer.name
    && model.buyer.address
    && model.buyer.vatNumber
    && model.buyer.identifierValue
    ? 'ready'
    : 'standard_buyer_identity_incomplete'
}

export function canRenderFiscalDocument(model: DocumentViewModel): boolean {
  return resolveDocumentPresentationReadiness(model) === 'ready'
}
