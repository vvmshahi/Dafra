export type FiscalRegime = 'generation' | 'integration'
export type IntegrationEnvironment = 'sandbox' | 'production'

export type FiscalActivationState =
  | 'generation_active'
  | 'integration_setup'
  | 'integration_active'

export type FiscalLifecycleState =
  | 'generation_issued'
  | 'generation_failed'
  | 'not_submitted'
  | 'pending'
  | 'reported'
  | 'cleared'
  | 'failed'

export type FiscalArtifactStage = 'none' | 'generation_final' | 'integration_final'

export type FiscalPolicy = {
  branchId: string
  tenantId: string
  regime: FiscalRegime
  integrationEnvironment: IntegrationEnvironment | null
  policyRevision: number
  activationState: FiscalActivationState
  effectiveAt: string | null
}

export type FiscalDocumentResult = {
  invoiceId: string
  invoiceNumber: string
  documentKind: 'simplified' | 'standard' | 'credit_note' | 'debit_note'
  fiscalRegime: FiscalRegime
  lifecycleState: FiscalLifecycleState
  artifactStage: FiscalArtifactStage
  qrCode: string | null
  canPrint: boolean
  canShare: boolean
  policyRevision: number
}

export type FiscalDocumentForPolicy = Pick<
  FiscalDocumentResult,
  'fiscalRegime' | 'lifecycleState' | 'artifactStage' | 'qrCode' | 'canPrint' | 'canShare'
>

export const FISCAL_POLICY_ERRORS = Object.freeze({
  unauthorized: 'FISCAL_POLICY_UNAUTHORIZED',
  branchAccessDenied: 'BRANCH_ACCESS_DENIED',
  invalid: 'FISCAL_POLICY_INVALID',
  notConfigured: 'FISCAL_POLICY_NOT_CONFIGURED',
  changed: 'FISCAL_POLICY_CHANGED',
  crossRegimeNote: 'CROSS_REGIME_NOTE_NOT_ALLOWED',
} as const)

export const CREDIT_NOTE_POLICY_ERRORS = Object.freeze({
  generationFinalizationRequired: 'GENERATION_FINALIZATION_REQUIRED',
  integrationNotAccepted: 'INTEGRATION_NOT_ACCEPTED',
} as const)

export type CreditNoteEligibility =
  | { allowed: true; regime: FiscalRegime }
  | { allowed: false; code: typeof FISCAL_POLICY_ERRORS.crossRegimeNote | typeof FISCAL_POLICY_ERRORS.invalid | typeof CREDIT_NOTE_POLICY_ERRORS.generationFinalizationRequired | typeof CREDIT_NOTE_POLICY_ERRORS.integrationNotAccepted }

/**
 * Client-side presentation contract for the server-authoritative credit-note
 * policy. The Generation finalizer and the Integration credit RPC re-check all
 * of these fields from persisted rows before creating anything.
 */
export function resolveCreditNoteEligibility(input: {
  parentRegime: FiscalRegime | null | undefined
  parentLifecycle: string | null | undefined
  currentRegime: FiscalRegime | null | undefined
  integrationAccepted: boolean
}): CreditNoteEligibility {
  if (input.parentRegime === 'generation') {
    if (input.currentRegime === 'integration') {
      return { allowed: false, code: FISCAL_POLICY_ERRORS.crossRegimeNote }
    }
    if (input.currentRegime !== 'generation') {
      return { allowed: false, code: FISCAL_POLICY_ERRORS.invalid }
    }
    if (input.parentLifecycle !== 'generation_issued') {
      return { allowed: false, code: CREDIT_NOTE_POLICY_ERRORS.generationFinalizationRequired }
    }
    return { allowed: true, regime: 'generation' }
  }

  if (input.parentRegime === 'integration' && input.currentRegime !== 'integration') {
    return { allowed: false, code: FISCAL_POLICY_ERRORS.invalid }
  }
  if (input.integrationAccepted) return { allowed: true, regime: 'integration' }
  return { allowed: false, code: CREDIT_NOTE_POLICY_ERRORS.integrationNotAccepted }
}

/** Generation Debit Notes use the same branch/lifecycle boundary as Credit
 * Notes, but are intentionally never eligible for Integration invoices. */
export function resolveDebitNoteEligibility(input: {
  parentRegime: FiscalRegime | null | undefined
  parentLifecycle: string | null | undefined
  currentRegime: FiscalRegime | null | undefined
}): CreditNoteEligibility {
  if (input.parentRegime !== 'generation') return { allowed: false, code: FISCAL_POLICY_ERRORS.invalid }
  if (input.currentRegime === 'integration') return { allowed: false, code: FISCAL_POLICY_ERRORS.crossRegimeNote }
  if (input.currentRegime !== 'generation') return { allowed: false, code: FISCAL_POLICY_ERRORS.invalid }
  if (input.parentLifecycle !== 'generation_issued') {
    return { allowed: false, code: CREDIT_NOTE_POLICY_ERRORS.generationFinalizationRequired }
  }
  return { allowed: true, regime: 'generation' }
}

export function isGenerationIssued(document: FiscalDocumentForPolicy): boolean {
  return document.fiscalRegime === 'generation'
    && document.lifecycleState === 'generation_issued'
}

export function isIntegrationAccepted(document: FiscalDocumentForPolicy): boolean {
  return document.fiscalRegime === 'integration'
    && (document.lifecycleState === 'reported' || document.lifecycleState === 'cleared')
}

export function isFiscalDocumentFinal(document: FiscalDocumentForPolicy): boolean {
  return isGenerationIssued(document) || isIntegrationAccepted(document)
}

export function isFiscalDocumentPrintable(document: FiscalDocumentForPolicy): boolean {
  return isFiscalDocumentFinal(document) && document.canPrint
    && (document.fiscalRegime === 'generation'
      ? document.artifactStage === 'generation_final'
      : document.artifactStage === 'integration_final')
}

export function canCreateAdjustmentNote(
  parent: Pick<FiscalDocumentForPolicy, 'fiscalRegime'>,
  currentPolicy: Pick<FiscalPolicy, 'regime'>,
): { allowed: true } | { allowed: false; code: typeof FISCAL_POLICY_ERRORS.crossRegimeNote } {
  if (parent.fiscalRegime === 'generation' && currentPolicy.regime === 'integration') {
    return { allowed: false, code: FISCAL_POLICY_ERRORS.crossRegimeNote }
  }
  if (parent.fiscalRegime === 'integration' && currentPolicy.regime === 'generation') {
    return { allowed: false, code: FISCAL_POLICY_ERRORS.invalid }
  }
  return { allowed: true }
}

export function resolveLegacyFiscalPolicy(input: {
  branchId: string
  tenantId: string
  zatcaPhase: 1 | 2 | number | null | undefined
  zatcaEnvironment: string | null | undefined
  policyRevision?: number | null
  activationState?: FiscalActivationState | null
  effectiveAt?: string | null
}): FiscalPolicy {
  const environment = input.zatcaEnvironment === 'sandbox' ? 'sandbox' : 'production'
  // B1 intentionally maps legacy phase values to Integration. Generation must
  // be an explicit future fiscal_regime state, never inferred from phase=1.
  return {
    branchId: input.branchId,
    tenantId: input.tenantId,
    regime: 'integration',
    integrationEnvironment: environment,
    policyRevision: input.policyRevision && input.policyRevision > 0 ? input.policyRevision : 1,
    activationState: input.activationState ?? 'integration_active',
    effectiveAt: input.effectiveAt ?? null,
  }
}
