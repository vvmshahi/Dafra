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
