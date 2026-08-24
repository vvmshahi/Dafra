import { supabase } from '@/lib/supabase'
import { getZatcaConnectionState } from '@/lib/zatca/api'
import {
  invokeAuthenticatedZatca,
  ZatcaEdgeAuthenticationError,
} from '@/lib/zatca/authenticatedEdge'

export type EffectiveZatcaRoute = 'production' | 'sandbox_branch_specific' | 'blocked'

export function isPermanentDemoSandboxBranch(_tenantId: string | null | undefined, _branchId: string | null | undefined): boolean {
  // Historical UI compatibility only. Authoritative routing below resolves the
  // branch environment and active backend credential; it never uses a UUID list.
  return false
}
export type ZatcaSubmitSource = 'auto_checkout' | 'auto_credit_note' | 'manual_retry' | 'bulk_retry'
export const ZATCA_FINALIZATION_CLIENT_VERSION = '2.1.0'
export const ZATCA_FINALIZATION_EDGE_VERSION = '2.1.0'
export const ZATCA_OUTPUT_STATE_READ_VERSION = '2.0.0'
export const ZATCA_FINALIZATION_SCHEMA_VERSION = 2
export type ZatcaCheckoutMode = 'legacy' | 'v2'
export type ZatcaDocumentKind = 'simplified' | 'standard'
export type PosCheckoutPath = 'atomic' | 'legacy' | 'demo' | 'sandbox' | 'generation'
export type ZatcaFunctionalityMap = '0100' | '1000' | '1100'

export interface PosCheckoutDocumentDecision {
  status: 'allowed' | 'blocked'
  code: string | null
  missingFields: string[]
  invalidFields: string[]
  documentType: ZatcaDocumentKind | null
  checkoutPath: PosCheckoutPath | null
  capability: ZatcaFunctionalityMap | null
  classificationReason: string | null
  atomicEligible: boolean
  atomicEligibilityReason: string
  readinessStatus: string
  readinessReason: string | null
  productionConnected: boolean
  isDemo: boolean
  nonFiscal: boolean
  fiscalRegime: 'generation' | 'integration' | null
  fiscalActivationState: string | null
  fiscalPolicyRevision: number | null
  demoMode: 'not_demo' | 'non_fiscal' | 'sandbox_compliance'
}
export type ZatcaCapabilityAcknowledgementStatus =
  | 'written'
  | 'refreshed'
  | 'rejected'
  | 'write_failed'
  | 'version_mismatch'

export interface ZatcaFinalizationCapabilities {
  schemaVersion: number | null
  edgeFunctionVersion: string
  minimumClientVersion: string
  immutableFinalizationEnabled: boolean
  databaseFeatureEnabled: boolean
  legacySubmitAvailable: boolean
  edgeKillSwitchEnabled: boolean
  simplifiedEnabled: boolean
  standardEnabled: boolean
  supportsLocalSimplifiedFinalization: boolean
  supportsStandardClearanceGating: boolean
  supportsLeasedClaims: boolean
  supportsSerializedChainAllocator: boolean
  compatible: boolean
  acknowledged: boolean
  branchReady: boolean
  branchBlocked: boolean
  chainHeadExists: boolean
  productionConnected: boolean
  branchV2Ready: boolean
  atomicSimplifiedEligible: boolean
  atomicSimplifiedEnabled: boolean
  atomicBranchGateEnabled: boolean
  atomicEligibilityReason: string
  atomicGateSyncAction: 'inserted' | 'updated' | 'unchanged' | 'unavailable'
  standardEligibilityReason: string
  acknowledgementStatus: ZatcaCapabilityAcknowledgementStatus
  acknowledgementReason: string
  acknowledgementExpiresAt: string | null
  checkoutMode: ZatcaCheckoutMode
  simplifiedCheckoutMode: ZatcaCheckoutMode
  standardCheckoutMode: ZatcaCheckoutMode
  effectiveRoute: EffectiveZatcaRoute
}

export interface ZatcaSubmitResult {
  ok: boolean
  invoiceStatus: string
  retryable: boolean
  contractMode: ZatcaCheckoutMode
  legacyCompatible: boolean
  finalizationStatus: string
  artifactStage: string
  documentKind: 'simplified' | 'standard' | null
  canPrint: boolean
  canShare: boolean
  qrCode: string | null
}

export interface ZatcaSubmitOptions {
  source?: ZatcaSubmitSource
  contractMode?: ZatcaCheckoutMode
  documentKind: ZatcaDocumentKind
}

export interface ZatcaFinalizationResult {
  ok: boolean
  invoiceStatus: string
  finalizationStatus: string
  artifactStage: string
  documentKind: 'simplified' | 'standard' | null
  canPrint: boolean
  canShare: boolean
  retryAvailable: boolean
  reconciliationRequired: boolean
  qrCode: string | null
  error: string | null
  failureStage?: string | null
  correlationId?: string | null
}

interface GenerationFinalizerDiagnostic {
  error: string | null
  failureStage: string | null
  correlationId: string | null
}

function safeDiagnosticValue(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120 || !pattern.test(value)) return null
  return value
}

async function readGenerationFinalizerDiagnostic(error: unknown): Promise<GenerationFinalizerDiagnostic> {
  const context = (error as { context?: unknown } | null)?.context
  if (!(context instanceof Response)) return { error: null, failureStage: null, correlationId: null }
  try {
    const body = await context.clone().json() as Record<string, unknown>
    return {
      error: safeDiagnosticValue(body.error, /^[A-Z0-9_]+$/),
      failureStage: safeDiagnosticValue(body.failure_stage, /^[a-z0-9_]+$/),
      correlationId: safeDiagnosticValue(body.correlation_id, /^[0-9a-f-]{36}$/i),
    }
  } catch {
    return { error: null, failureStage: null, correlationId: null }
  }
}

export type GenerationFinalizerError = Error & GenerationFinalizerDiagnostic

export interface ZatcaOutputState {
  invoiceId: string
  contractMode: ZatcaCheckoutMode
  legacyCompatible: boolean
  schemaVersion: number | null
  edgeFunctionVersion: string
  minimumClientVersion: string
  compatible: boolean
  immutableFinalizationEnabled: boolean
  invoiceStatus: string
  finalizationStatus: string
  artifactStage: string
  documentKind: 'simplified' | 'standard' | null
  reportingDisplayState: string
  canPrint: boolean
  canShare: boolean
  retryAvailable: boolean
  reconciliationRequired: boolean
  qrCode: string | null
  error: string | null
}

export { ZatcaEdgeAuthenticationError as ZatcaOutputStateAuthenticationError }

export async function resolvePosCheckoutDocument(
  branchId: string,
  customerId: string | null,
): Promise<PosCheckoutDocumentDecision> {
  const { data, error } = await (supabase as any).rpc(
    'resolve_pos_checkout_document_v1',
    {
      p_branch_id: branchId,
      p_customer_id: customerId,
    },
  )
  if (error) throw new Error(error.message)

  const status = data?.status === 'allowed' ? 'allowed' : 'blocked'
  const documentType = data?.documentType === 'simplified'
    || data?.documentType === 'standard'
    ? data.documentType
    : null
  const checkoutPath = data?.checkoutPath === 'atomic'
    || data?.checkoutPath === 'legacy'
    || data?.checkoutPath === 'demo'
    || data?.checkoutPath === 'sandbox'
    || data?.checkoutPath === 'generation'
    ? data.checkoutPath
    : null
  const capability = data?.capability === '0100'
    || data?.capability === '1000'
    || data?.capability === '1100'
    ? data.capability
    : null

  return {
    status,
    code: typeof data?.code === 'string' ? data.code : null,
    missingFields: Array.isArray(data?.missingFields)
      ? data.missingFields.filter((field: unknown): field is string => typeof field === 'string')
      : [],
    invalidFields: Array.isArray(data?.invalidFields)
      ? data.invalidFields.filter((field: unknown): field is string => typeof field === 'string')
      : [],
    documentType,
    checkoutPath,
    capability,
    classificationReason: typeof data?.classificationReason === 'string'
      ? data.classificationReason
      : null,
    atomicEligible: data?.atomicEligible === true,
    atomicEligibilityReason: String(
      data?.atomicEligibilityReason ?? 'not_evaluated',
    ),
    readinessStatus: String(data?.readinessStatus ?? 'missing'),
    readinessReason: typeof data?.readinessReason === 'string'
      ? data.readinessReason
      : null,
    productionConnected: data?.productionConnected === true,
    isDemo: data?.isDemo === true,
    nonFiscal: data?.nonFiscal === true,
    fiscalRegime: data?.fiscalRegime === 'generation' || data?.fiscalRegime === 'integration'
      ? data.fiscalRegime
      : null,
    fiscalActivationState: typeof data?.fiscalActivationState === 'string'
      ? data.fiscalActivationState
      : null,
    fiscalPolicyRevision: Number.isInteger(data?.fiscalPolicyRevision)
      ? data.fiscalPolicyRevision
      : null,
    demoMode: data?.demoMode === 'non_fiscal' || data?.demoMode === 'sandbox_compliance'
      ? data.demoMode
      : 'not_demo',
  }
}

export async function getZatcaFinalizationCapabilities(branchId: string): Promise<ZatcaFinalizationCapabilities> {
  const { data, error } = await supabase.functions.invoke('zatca-submit', {
    body: {
      action: 'capabilities',
      branchId,
      clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION,
    },
  })
  if (error) throw new Error(error.message)
  return {
    schemaVersion: typeof data?.schemaVersion === 'number' ? data.schemaVersion : null,
    edgeFunctionVersion: String(data?.edgeFunctionVersion ?? ''),
    minimumClientVersion: String(data?.minimumClientVersion ?? ''),
    immutableFinalizationEnabled: data?.immutableFinalizationEnabled === true,
    databaseFeatureEnabled: data?.databaseFeatureEnabled === true,
    legacySubmitAvailable: data?.legacySubmitAvailable === true,
    edgeKillSwitchEnabled: data?.edgeKillSwitchEnabled === true,
    simplifiedEnabled: data?.simplifiedEnabled === true,
    standardEnabled: data?.standardEnabled === true,
    supportsLocalSimplifiedFinalization: data?.supportsLocalSimplifiedFinalization === true,
    supportsStandardClearanceGating: data?.supportsStandardClearanceGating === true,
    supportsLeasedClaims: data?.supportsLeasedClaims === true,
    supportsSerializedChainAllocator: data?.supportsSerializedChainAllocator === true,
    compatible: data?.compatible === true,
    acknowledged: data?.acknowledged === true,
    branchReady: data?.branchReady === true,
    branchBlocked: data?.branchBlocked === true,
    chainHeadExists: data?.chainHeadExists === true,
    productionConnected: data?.productionConnected === true,
    branchV2Ready: data?.branchV2Ready === true,
    atomicSimplifiedEligible: data?.atomicSimplifiedEligible === true,
    atomicSimplifiedEnabled: data?.atomicSimplifiedEnabled === true,
    atomicBranchGateEnabled: data?.atomicBranchGateEnabled === true,
    atomicEligibilityReason: String(data?.atomicEligibilityReason ?? 'eligibility_unknown'),
    atomicGateSyncAction: data?.atomicGateSyncAction === 'inserted'
      || data?.atomicGateSyncAction === 'updated'
      || data?.atomicGateSyncAction === 'unchanged'
      ? data.atomicGateSyncAction
      : 'unavailable',
    standardEligibilityReason: String(data?.standardEligibilityReason ?? 'standard_disabled'),
    acknowledgementStatus: data?.acknowledgementStatus === 'written'
      || data?.acknowledgementStatus === 'refreshed'
      || data?.acknowledgementStatus === 'rejected'
      || data?.acknowledgementStatus === 'write_failed'
      || data?.acknowledgementStatus === 'version_mismatch'
      ? data.acknowledgementStatus
      : 'write_failed',
    acknowledgementReason: String(
      data?.acknowledgementReason ?? 'acknowledgement_status_missing',
    ),
    acknowledgementExpiresAt: typeof data?.acknowledgementExpiresAt === 'string'
      ? data.acknowledgementExpiresAt
      : null,
    checkoutMode: data?.checkoutMode === 'v2' ? 'v2' : 'legacy',
    simplifiedCheckoutMode: data?.simplifiedCheckoutMode === 'v2' ? 'v2' : 'legacy',
    standardCheckoutMode: data?.standardCheckoutMode === 'v2' ? 'v2' : 'legacy',
    // v148 did not expose an effective-route field. Keep its established
    // Production capability behavior intact; branch-specific routing occurs
    // in submitInvoiceForBranch through resolve-zatca-connection.
    effectiveRoute: data?.effectiveRoute === 'production' || data?.effectiveRoute === 'sandbox_branch_specific' || data?.effectiveRoute === 'blocked'
      ? data.effectiveRoute
      : 'production',
  }
}

export async function requireZatcaFinalizationCapability(
  branchId: string,
  documentKind: ZatcaDocumentKind,
): Promise<ZatcaFinalizationCapabilities & { checkoutMode: ZatcaCheckoutMode }> {
  const capability = await getZatcaFinalizationCapabilities(branchId)
  if (capability.effectiveRoute === 'blocked') {
    throw new Error('ZATCA route is blocked for this branch. No payment was recorded.')
  }
  const serverCheckoutMode = documentKind === 'standard'
    ? capability.standardCheckoutMode
    : capability.simplifiedCheckoutMode
  const v2Ready = capability.schemaVersion === ZATCA_FINALIZATION_SCHEMA_VERSION
    && capability.edgeFunctionVersion === ZATCA_FINALIZATION_EDGE_VERSION
    && capability.minimumClientVersion === ZATCA_FINALIZATION_CLIENT_VERSION
    && capability.compatible
    && capability.acknowledged
    && serverCheckoutMode === 'v2'
    && capability.branchV2Ready
    && capability.branchReady
    && !capability.branchBlocked
    && capability.chainHeadExists
    && capability.productionConnected
    && capability.immutableFinalizationEnabled
    && capability.simplifiedEnabled
    && capability.supportsLocalSimplifiedFinalization
    && capability.supportsStandardClearanceGating
    && capability.supportsLeasedClaims
    && capability.supportsSerializedChainAllocator
    && (documentKind === 'simplified' || capability.standardEnabled)
  if (v2Ready) return { ...capability, checkoutMode: 'v2' }
  if (serverCheckoutMode === 'legacy' && capability.legacySubmitAvailable) {
    return { ...capability, checkoutMode: 'legacy' }
  }
  throw new Error('ZATCA finalization is unavailable or version-incompatible. No payment was recorded.')
}

export type RoutedZatcaResult =
  | { mode: 'sandbox_submission'; result: ZatcaSubmitResult }
  | { mode: 'production_submission'; result: ZatcaSubmitResult }

/**
 * Performs server-only local Phase 2 finalization. No ZATCA network request is
 * made by this operation; the returned QR is the immutable stored value used
 * by the first customer copy.
 */
export async function finalizeInvoiceForZatca(params: {
  invoiceId: string
  branchId: string
  options?: Pick<ZatcaSubmitOptions, 'source'>
}): Promise<ZatcaFinalizationResult> {
  const { data, error } = await supabase.functions.invoke('zatca-submit', {
    body: {
      invoiceId: params.invoiceId,
      branchId: params.branchId,
      source: params.options?.source ?? 'auto_checkout',
      action: 'finalize',
      clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION,
    },
  })
  if (error) throw new Error(error.message)
  const finalizationStatus = String(data?.finalizationStatus ?? 'finalization_failed')
  return {
    ok: ['locally_finalized', 'provisional_signed', 'cleared_final'].includes(finalizationStatus),
    invoiceStatus: String(data?.invoiceStatus ?? 'pending'),
    finalizationStatus,
    artifactStage: String(data?.artifactStage ?? 'none'),
    documentKind: data?.documentKind === 'simplified' || data?.documentKind === 'standard' ? data.documentKind : null,
    canPrint: data?.canPrint === true,
    canShare: data?.canShare === true,
    retryAvailable: data?.retryAvailable === true,
    reconciliationRequired: data?.reconciliationRequired === true,
    qrCode: typeof data?.qrCode === 'string' ? data.qrCode : null,
    error: typeof data?.error === 'string' ? data.error : null,
  }
}

/**
 * Finalizes a Generation invoice through the fiscal-domain finalizer. This
 * path deliberately does not invoke the protected ZATCA submitter or read
 * Production capability/acknowledgement state.
 */
export async function finalizeGenerationInvoice(params: {
  invoiceId: string
  branchId: string
  checkoutIdempotencyKey: string
  expectedPolicyRevision: number
}): Promise<ZatcaFinalizationResult> {
  const { data, error } = await supabase.functions.invoke('fiscal-finalize-generation', {
    body: {
      invoice_id: params.invoiceId,
      branch_id: params.branchId,
      checkout_idempotency_key: params.checkoutIdempotencyKey,
      expected_policy_revision: params.expectedPolicyRevision,
    },
  })
  if (error) {
    const diagnostic = await readGenerationFinalizerDiagnostic(error)
    const failure = new Error(diagnostic.error ?? error.message) as GenerationFinalizerError
    failure.name = 'GenerationFinalizerError'
    failure.failureStage = diagnostic.failureStage
    failure.correlationId = diagnostic.correlationId
    throw failure
  }
  const finalizationStatus = String(
    data?.lifecycleState === 'generation_issued' ? 'generation_issued' : 'finalization_failed',
  )
  return {
    ok: data?.lifecycleState === 'generation_issued' && data?.canPrint === true,
    invoiceStatus: 'posted',
    finalizationStatus,
    artifactStage: String(data?.artifactStage ?? 'none'),
    documentKind: data?.documentKind === 'simplified' || data?.documentKind === 'standard'
      ? data.documentKind
      : null,
    canPrint: data?.canPrint === true,
    canShare: data?.canShare === true,
    retryAvailable: false,
    reconciliationRequired: false,
    qrCode: typeof data?.qrCode === 'string' ? data.qrCode : null,
    error: typeof data?.error === 'string' ? data.error : null,
    failureStage: typeof data?.failure_stage === 'string' ? data.failure_stage : null,
    correlationId: typeof data?.correlation_id === 'string' ? data.correlation_id : null,
  }
}

export async function getInvoiceZatcaOutputState(params: {
  invoiceId: string
  branchId: string
}): Promise<ZatcaOutputState> {
  const connection = await getZatcaConnectionState(params.branchId)
  if (connection.environment === 'sandbox') {
    const { data, error } = await supabase.functions.invoke('zatca-submit-sandbox-demo', {
      body: { action: 'status', invoiceId: params.invoiceId },
    })
    if (error) throw new Error(error.message)
    const upstreamStatus: ZatcaOutputState = {
      invoiceId: String(data?.invoiceId ?? ''), contractMode: 'legacy', legacyCompatible: false,
      schemaVersion: null, edgeFunctionVersion: 'sandbox-demo', minimumClientVersion: ZATCA_FINALIZATION_CLIENT_VERSION,
      compatible: true, immutableFinalizationEnabled: true, invoiceStatus: String(data?.invoiceStatus ?? 'pending'),
      finalizationStatus: String(data?.finalizationStatus ?? 'sandbox_pending'),
      artifactStage: String(data?.artifactStage ?? 'sandbox_pending'),
      documentKind: data?.documentKind === 'standard' ? 'standard' : 'simplified',
      reportingDisplayState: String(data?.reportingDisplayState ?? 'reporting_pending'),
      canPrint: data?.canPrint === true, canShare: data?.canShare === true, retryAvailable: data?.retryAvailable === true,
      reconciliationRequired: data?.reconciliationRequired === true,
      qrCode: data?.canPrint === true && typeof data?.qrCode === 'string' ? data.qrCode : null, error: null,
    }

    // Sandbox v34 status is the authorized canonical read path. Do not add a
    // browser-side invoices SELECT here: the table is intentionally not
    // directly readable by authenticated clients.
    return upstreamStatus
  }
  const { data, error } = await invokeAuthenticatedZatca({
    invoiceId: params.invoiceId,
    branchId: params.branchId,
    action: 'status',
    clientVersion: ZATCA_OUTPUT_STATE_READ_VERSION,
  })
  if (error) throw new Error(error.message)
  const invoiceId = String(data?.invoiceId ?? '')
  if (invoiceId !== params.invoiceId) {
    throw new Error('Invoice output-state identity mismatch')
  }
  const schemaVersion = typeof data?.schemaVersion === 'number' ? data.schemaVersion : null
  const edgeFunctionVersion = String(data?.edgeFunctionVersion ?? '')
  const minimumClientVersion = String(data?.minimumClientVersion ?? '')
  const v2Compatible = data?.compatible === true
    && schemaVersion === ZATCA_FINALIZATION_SCHEMA_VERSION
    && edgeFunctionVersion === ZATCA_FINALIZATION_EDGE_VERSION
    && minimumClientVersion === ZATCA_FINALIZATION_CLIENT_VERSION
  const contractMode: ZatcaCheckoutMode = data?.contractMode === 'legacy' ? 'legacy' : 'v2'
  const legacyCompatible = contractMode === 'legacy'
    && data?.legacyCompatible === true
  const legacyVersionCompatible = legacyCompatible
    && edgeFunctionVersion === ZATCA_FINALIZATION_EDGE_VERSION
    && minimumClientVersion === ZATCA_FINALIZATION_CLIENT_VERSION
  const compatible = v2Compatible || legacyVersionCompatible
  const finalizationStatus = String(data?.finalizationStatus ?? 'not_started')
  const canPrint = data?.canPrint === true
  return {
    invoiceId,
    contractMode,
    legacyCompatible,
    schemaVersion,
    edgeFunctionVersion,
    minimumClientVersion,
    compatible,
    immutableFinalizationEnabled: data?.immutableFinalizationEnabled === true,
    invoiceStatus: String(data?.invoiceStatus ?? 'pending'),
    finalizationStatus,
    artifactStage: String(data?.artifactStage ?? 'none'),
    documentKind: data?.documentKind === 'simplified' || data?.documentKind === 'standard' ? data.documentKind : null,
    reportingDisplayState: typeof data?.reportingDisplayState === 'string'
      ? data.reportingDisplayState
      : 'reporting_pending',
    canPrint,
    canShare: data?.canShare === true,
    retryAvailable: data?.retryAvailable === true,
    reconciliationRequired: data?.reconciliationRequired === true,
    qrCode: canPrint && typeof data?.qrCode === 'string' ? data.qrCode : null,
    error: typeof data?.error === 'string' ? data.error : null,
  }
}

export async function retryStoredSimplifiedArtifact(params: {
  invoiceId: string
  branchId: string
  source?: 'manual_retry' | 'bulk_retry'
}): Promise<ZatcaSubmitResult> {
  const { data, error } = await supabase.functions.invoke('zatca-submit', {
    body: {
      invoiceId: params.invoiceId,
      branchId: params.branchId,
      source: params.source ?? 'manual_retry',
      action: 'retry',
      clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION,
    },
  })
  if (error) throw new Error(error.message)
  const invoiceStatus = String(data?.invoiceStatus ?? 'pending')
  return {
    ok: invoiceStatus === 'reported',
    invoiceStatus,
    retryable: data?.retryAvailable === true,
    contractMode: 'v2',
    legacyCompatible: false,
    finalizationStatus: String(data?.finalizationStatus ?? 'locally_finalized'),
    artifactStage: String(data?.artifactStage ?? 'simplified_final'),
    documentKind: data?.documentKind === 'simplified' ? 'simplified' : null,
    canPrint: data?.canPrint === true,
    canShare: data?.canShare === true,
    qrCode: data?.canPrint === true && typeof data?.qrCode === 'string' ? data.qrCode : null,
  }
}

export async function submitInvoiceForBranch(params: {
  invoiceId: string
  tenantId: string
  branchId: string
  options: ZatcaSubmitOptions & { retryDelayMs?: number }
}): Promise<RoutedZatcaResult> {
  const connection = await getZatcaConnectionState(params.branchId)
  if (connection.environment === 'sandbox') {
    const { data, error } = await supabase.functions.invoke('zatca-submit-sandbox-demo', {
      body: { invoiceId: params.invoiceId, source: params.options.source ?? 'manual_retry' },
    })
    if (error) throw new Error(error.message)
    const invoiceStatus = String(data?.invoiceStatus ?? 'pending')
    const canPrint = data?.canPrint === true
    return {
      mode: 'sandbox_submission',
      result: {
        ok: invoiceStatus === 'reported' || invoiceStatus === 'cleared', invoiceStatus,
        retryable: invoiceStatus === 'pending' || invoiceStatus === 'error', contractMode: 'legacy', legacyCompatible: false,
        finalizationStatus: String(data?.finalizationStatus ?? `sandbox_${invoiceStatus}`),
        artifactStage: invoiceStatus === 'reported' || invoiceStatus === 'cleared' ? 'sandbox_final' : 'sandbox_pending',
        documentKind: data?.documentKind === 'standard' ? 'standard' : 'simplified',
        canPrint, canShare: data?.canShare === true,
        qrCode: canPrint && typeof data?.qrCode === 'string' ? data.qrCode : null,
      },
    }
  }
  if (connection.connection_state !== 'connected') {
    throw new Error(`ZATCA route is ${connection.connection_state} for this branch. No payment was recorded.`)
  }
  return {
    mode: 'production_submission',
    result: await submitInvoiceToZatcaWithRetry(params.invoiceId, params.branchId, params.options),
  }
}

export async function submitInvoiceToZatcaDetailed(
  invoiceId: string,
  branchId: string,
  options: ZatcaSubmitOptions,
): Promise<ZatcaSubmitResult> {
  const source = options.source ?? 'manual_retry'
  if (!options.contractMode && (source === 'manual_retry' || source === 'bulk_retry')) {
    const output = await getInvoiceZatcaOutputState({ invoiceId, branchId })
    if (
      output.contractMode === 'v2'
      && output.documentKind === 'simplified'
      && output.artifactStage === 'simplified_final'
    ) {
      return retryStoredSimplifiedArtifact({ invoiceId, branchId, source })
    }
  }
  const contractMode = options.contractMode
    ?? (await requireZatcaFinalizationCapability(branchId, options.documentKind)).checkoutMode
  const { data, error } = await supabase.functions.invoke('zatca-submit', {
    body: contractMode === 'legacy'
      ? { invoiceId, branchId, source }
      : {
        invoiceId,
        branchId,
        source,
        action: 'submit',
        clientVersion: ZATCA_FINALIZATION_CLIENT_VERSION,
      },
  })
  if (error) throw new Error(error.message)
  const invoiceStatus = String(data?.invoiceStatus ?? 'error')
  const resultContractMode: ZatcaCheckoutMode = data?.contractMode === 'legacy' ? 'legacy' : contractMode
  return {
    ok: invoiceStatus === 'reported' || invoiceStatus === 'cleared',
    invoiceStatus,
    retryable: invoiceStatus === 'pending' || invoiceStatus === 'error',
    contractMode: resultContractMode,
    legacyCompatible: resultContractMode === 'legacy' && data?.legacyCompatible === true,
    finalizationStatus: String(data?.finalizationStatus ?? `${resultContractMode}_${invoiceStatus}`),
    artifactStage: String(data?.artifactStage ?? (resultContractMode === 'legacy' ? 'legacy_pending' : 'none')),
    documentKind: data?.documentKind === 'simplified' || data?.documentKind === 'standard' ? data.documentKind : null,
    canPrint: data?.canPrint === true,
    canShare: data?.canShare === true,
    qrCode: data?.canPrint === true && typeof data?.qrCode === 'string' ? data.qrCode : null,
  }
}

export async function submitInvoiceToZatca(invoiceId: string, branchId: string, options: ZatcaSubmitOptions): Promise<boolean> {
  const result = await submitInvoiceToZatcaDetailed(invoiceId, branchId, options)
  return result.ok
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function submitInvoiceToZatcaWithRetry(
  invoiceId: string,
  branchId: string,
  options: ZatcaSubmitOptions & { retryDelayMs?: number },
): Promise<ZatcaSubmitResult> {
  try {
    const first = await submitInvoiceToZatcaDetailed(invoiceId, branchId, options)
    if (
      first.ok
      || !first.retryable
      || (
        first.contractMode === 'v2'
        && first.documentKind === 'simplified'
        && first.artifactStage === 'simplified_final'
      )
    ) return first
  } catch (error) {
    console.warn('[zatca submission] first attempt failed', {
      invoiceId,
      branchId,
      source: options.source ?? 'manual_retry',
      message: error instanceof Error ? error.message : String(error ?? ''),
    })
  }

  await wait(options.retryDelayMs ?? 1500)
  return submitInvoiceToZatcaDetailed(invoiceId, branchId, options)
}

export interface ZatcaRetrySummary {
  attempted: number
  succeeded: number
  failed: number
  errors: string[]
}

function safeRetryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message || message.length > 180) return 'ZATCA retry failed. Please open the invoice for details.'
  if (/private[_ -]?key|secret|token|csid|certificate|authorization|csr|xml|signedInvoice/i.test(message)) {
    return 'ZATCA retry failed. Sensitive details were redacted.'
  }
  return message
}

export async function retryFailedSubmissions(tenantId: string, branchId?: string | null): Promise<ZatcaRetrySummary> {
  let query = supabase
    .from('invoices')
    .select('id, branch_id, invoice_number, zatca_status, zatca_invoice_type, original_invoice_id')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .in('zatca_status', ['failed', 'pending'])
    .order('created_at', { ascending: true })
    .limit(25)

  if (branchId) query = query.eq('branch_id', branchId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const originalInvoiceIds = [...new Set((data ?? [])
    .map(invoice => invoice.original_invoice_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const originalDocumentKindById = new Map<string, ZatcaDocumentKind>()
  if (originalInvoiceIds.length > 0) {
    const { data: originals, error: originalsError } = await supabase
      .from('invoices')
      .select('id, zatca_invoice_type')
      .eq('tenant_id', tenantId)
      .in('id', originalInvoiceIds)
    if (originalsError) throw new Error(originalsError.message)
    for (const original of originals ?? []) {
      if (original.zatca_invoice_type === 'standard' || original.zatca_invoice_type === 'simplified') {
        originalDocumentKindById.set(original.id, original.zatca_invoice_type)
      }
    }
  }

  const summary: ZatcaRetrySummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  }

  for (const invoice of data ?? []) {
    summary.attempted += 1
    try {
      const documentKind = invoice.zatca_invoice_type === 'standard' || invoice.zatca_invoice_type === 'simplified'
        ? invoice.zatca_invoice_type
        : invoice.original_invoice_id
          ? originalDocumentKindById.get(invoice.original_invoice_id)
          : undefined
      if (!documentKind) throw new Error('Unable to determine invoice document kind for retry')
      const ok = await submitInvoiceToZatca(invoice.id, invoice.branch_id, {
        source: 'bulk_retry',
        documentKind,
      })
      if (ok) summary.succeeded += 1
      else {
        summary.failed += 1
        summary.errors.push(`${invoice.invoice_number}: still pending`)
      }
    } catch (err) {
      summary.failed += 1
      summary.errors.push(`${invoice.invoice_number}: ${safeRetryErrorMessage(err)}`)
    }
  }

  return summary
}
