import { supabase } from '@/lib/supabase'
import { validateInvoiceInSandbox, type SandboxValidationResponse } from '@/lib/zatca/api'

export const PERMANENT_DEMO_TENANT_ID = 'ebf1144b-55ed-472a-99c9-23b5ee915351'
export const PERMANENT_DEMO_TRADING_BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'
export const PERMANENT_DEMO_SERVICE_BRANCH_ID = 'c30094d7-40ca-4d2e-833a-07aa18c4fa46'
export const PERMANENT_DEMO_SANDBOX_BRANCH_IDS = [
  PERMANENT_DEMO_TRADING_BRANCH_ID,
  PERMANENT_DEMO_SERVICE_BRANCH_ID,
] as const

export function isPermanentDemoSandboxBranch(tenantId: string | null | undefined, branchId: string | null | undefined): boolean {
  return tenantId === PERMANENT_DEMO_TENANT_ID &&
    PERMANENT_DEMO_SANDBOX_BRANCH_IDS.includes(branchId as typeof PERMANENT_DEMO_SANDBOX_BRANCH_IDS[number])
}

export type ZatcaSubmitSource = 'auto_checkout' | 'auto_credit_note' | 'manual_retry' | 'bulk_retry'
export const ZATCA_FINALIZATION_CLIENT_VERSION = '2.1.0'
export const ZATCA_FINALIZATION_EDGE_VERSION = '2.1.0'
export const ZATCA_OUTPUT_STATE_READ_VERSION = '2.0.0'
export const ZATCA_FINALIZATION_SCHEMA_VERSION = 2
export type ZatcaCheckoutMode = 'legacy' | 'v2'

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
  checkoutMode: ZatcaCheckoutMode
  simplifiedCheckoutMode: ZatcaCheckoutMode
  standardCheckoutMode: ZatcaCheckoutMode
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
}

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
    checkoutMode: data?.checkoutMode === 'v2' ? 'v2' : 'legacy',
    simplifiedCheckoutMode: data?.simplifiedCheckoutMode === 'v2' ? 'v2' : 'legacy',
    standardCheckoutMode: data?.standardCheckoutMode === 'v2' ? 'v2' : 'legacy',
  }
}

export async function requireZatcaFinalizationCapability(
  branchId: string,
  documentKind: 'simplified' | 'standard' = 'simplified',
): Promise<ZatcaFinalizationCapabilities & { checkoutMode: ZatcaCheckoutMode }> {
  const capability = await getZatcaFinalizationCapabilities(branchId)
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
  | { mode: 'sandbox_validation'; result: SandboxValidationResponse }
  | { mode: 'production_submission'; result: ZatcaSubmitResult }

/**
 * Performs server-only local Phase 2 finalization. No ZATCA network request is
 * made by this operation; the returned QR is the immutable stored value used
 * by the first customer copy.
 */
export async function finalizeInvoiceForZatca(params: {
  invoiceId: string
  branchId: string
  options?: ZatcaSubmitOptions
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

export async function getInvoiceZatcaOutputState(params: {
  invoiceId: string
  branchId: string
}): Promise<ZatcaOutputState> {
  const { data, error } = await supabase.functions.invoke('zatca-submit', {
    body: {
      invoiceId: params.invoiceId,
      branchId: params.branchId,
      action: 'status',
      clientVersion: ZATCA_OUTPUT_STATE_READ_VERSION,
    },
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
  options?: ZatcaSubmitOptions & { retryDelayMs?: number }
}): Promise<RoutedZatcaResult> {
  if (isPermanentDemoSandboxBranch(params.tenantId, params.branchId)) {
    return { mode: 'sandbox_validation', result: await validateInvoiceInSandbox(params.invoiceId) }
  }
  return {
    mode: 'production_submission',
    result: await submitInvoiceToZatcaWithRetry(params.invoiceId, params.branchId, params.options),
  }
}

export async function submitInvoiceToZatcaDetailed(
  invoiceId: string,
  branchId: string,
  options: ZatcaSubmitOptions = {},
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
    ?? (await requireZatcaFinalizationCapability(branchId)).checkoutMode
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

export async function submitInvoiceToZatca(invoiceId: string, branchId: string, options: ZatcaSubmitOptions = {}): Promise<boolean> {
  const result = await submitInvoiceToZatcaDetailed(invoiceId, branchId, options)
  return result.ok
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function submitInvoiceToZatcaWithRetry(
  invoiceId: string,
  branchId: string,
  options: ZatcaSubmitOptions & { retryDelayMs?: number } = {},
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
    .select('id, branch_id, invoice_number, zatca_status')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .in('zatca_status', ['failed', 'pending'])
    .order('created_at', { ascending: true })
    .limit(25)

  if (branchId) query = query.eq('branch_id', branchId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const summary: ZatcaRetrySummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  }

  for (const invoice of data ?? []) {
    summary.attempted += 1
    try {
      const ok = await submitInvoiceToZatca(invoice.id, invoice.branch_id, { source: 'bulk_retry' })
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
