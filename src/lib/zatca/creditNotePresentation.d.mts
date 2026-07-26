export interface CreditNotePresentationInput {
  documentKind?: 'simplified' | 'standard' | null
  invoiceStatus?: string | null
  finalizationStatus?: string | null
  artifactStage?: string | null
  reportingDisplayState?: string | null
  canPrint?: boolean
  retryAvailable?: boolean
  reconciliationRequired?: boolean
}

export interface CreditNotePresentation {
  documentKind: 'simplified' | 'standard'
  state:
    | 'reporting_pending'
    | 'reported'
    | 'reporting_rejected'
    | 'reconciliation_required'
    | 'clearance_pending'
    | 'cleared'
    | 'clearance_retryable'
    | 'clearance_failed'
  tone: 'success' | 'progress' | 'warning' | 'error'
  headingKey: string
  messageKey: string | null
  statusKey: string | null
  printAllowed: boolean
  localCreationAcknowledged: boolean
  finalSuccess: boolean
}

export function creditNotePresentationState(
  input: CreditNotePresentationInput,
): CreditNotePresentation
