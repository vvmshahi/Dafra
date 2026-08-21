/**
 * ZATCA Phase 2 — API Client
 *
 * All calls proxy through Supabase Edge Functions so that:
 *  - Production tokens/secrets never touch the browser directly
 *  - ZATCA API credentials are server-side only
 *  - CORS is handled by the Edge Function
 *
 * Edge Function endpoints:
 *   POST /functions/v1/zatca-submit       — Invoice reporting / clearance
 *   POST /functions/v1/zatca-validate-sandbox-demo — Permanent-demo compliance validation
 *   POST /functions/v1/zatca-onboard-production — Owner-only production onboarding
 *   POST /functions/v1/zatca-disconnect-production — Owner-only local production disconnect
 */

import { supabase } from '@/lib/supabase'
import type { CertificateStatus } from '@/types'
import {
  clearStaleAuthSessionData,
  isInvalidRefreshTokenError,
} from '@/lib/authSessionRecovery'
import type { ZatcaFunctionalityMap } from '../../../shared/zatcaCapability'

const EDGE = (name: string) =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`
const EDGE_API_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const REFRESH_WINDOW_SECONDS = 60

export type ZatcaAuthDiagnostic =
  | 'AUTH_HEADER_MISSING'
  | 'SESSION_MISSING'
  | 'TOKEN_REFRESH_FAILED'
  | 'EDGE_JWT_REJECTED'

export class ZatcaAuthError extends Error {
  constructor(public readonly code: ZatcaAuthDiagnostic) {
    super(code)
    this.name = 'ZatcaAuthError'
  }
}

// ── Auth helper ───────────────────────────────────────────────────────────────

function expireKubriSession(code: ZatcaAuthDiagnostic): never {
  clearStaleAuthSessionData()
  if (typeof window !== 'undefined') {
    window.location.assign('/login?reason=session_expired')
  }
  throw new ZatcaAuthError(code)
}

async function currentAccessToken(): Promise<string> {
  const initial = await supabase.auth.getSession()
  if (initial.error) {
    if (isInvalidRefreshTokenError(initial.error)) {
      return expireKubriSession('TOKEN_REFRESH_FAILED')
    }
    return expireKubriSession('SESSION_MISSING')
  }

  let session = initial.data.session
  if (!session?.access_token) return expireKubriSession('SESSION_MISSING')

  const expiresSoon = typeof session.expires_at === 'number'
    && session.expires_at - Math.floor(Date.now() / 1000) <= REFRESH_WINDOW_SECONDS
  if (expiresSoon) {
    const refreshed = await supabase.auth.refreshSession()
    if (refreshed.error || !refreshed.data.session?.access_token) {
      return expireKubriSession('TOKEN_REFRESH_FAILED')
    }
    session = refreshed.data.session
  }
  return session.access_token
}

async function edgePost<T>(fnName: string, body: Record<string, unknown>): Promise<T> {
  return edgePostSafe<T>(fnName, body)
}

async function edgePostSafe<T>(fnName: string, body: Record<string, unknown>): Promise<T> {
  const jwt = await currentAccessToken()

  const res = await fetch(EDGE(fnName), {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${jwt}`,
      'apikey': EDGE_API_KEY,
    },
    body: JSON.stringify(body),
  })

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) {
      clearStaleAuthSessionData()
      if (typeof window !== 'undefined') {
        window.location.assign('/login?reason=session_expired')
      }
      const error = new ZatcaAuthError(
        payload?.code === 'AUTH_HEADER_MISSING' ? 'AUTH_HEADER_MISSING' : 'EDGE_JWT_REJECTED',
      )
      ;(error as any).payload = payload
      throw error
    }
    const message = safeBrowserMessage(payload?.error, `Edge Function ${fnName} returned ${res.status}`)
    const diagnostics = fnName === 'zatca-onboard-production'
      ? formatProductionDebugDiagnostics(payload?.complianceSampleResults)
      : ''
    const error = new Error(diagnostics ? `${message}\n\n${diagnostics}` : message)
    ;(error as any).payload = payload
    ;(error as any).trace = payload?.trace
    throw error
  }
  return payload as T
}

async function sandboxEdgePost<T>(body: Record<string, unknown>): Promise<T> {
  const jwt = await currentAccessToken()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 35_000)
  try {
    const res = await fetch(EDGE('zatca-onboard-sandbox-demo'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
        'apikey': EDGE_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(safeBrowserMessage(payload?.error, `Sandbox onboarding returned ${res.status}`))
    return payload as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Sandbox onboarding timed out. Refresh status before retrying.')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export function isZatcaOtpRejection(error: unknown): boolean {
  const payload = (error as { payload?: any } | null)?.payload
  if (/otp/i.test(String(payload?.error ?? ''))) return true
  return Array.isArray(payload?.trace) && payload.trace.some((entry: any) => (
    entry?.stage === 'compliance_csid_request_completed'
    && entry?.status === 'failed'
    && (entry?.httpStatus === 400 || entry?.httpStatus === 401)
  ))
}

function safeBrowserMessage(message: unknown, fallback: string): string {
  if (typeof message !== 'string' || message.length > 240) return fallback
  if (/private[_ -]?key|secret|token|csid|certificate|authorization|csr|xml body|raw zatca/i.test(message)) {
    return 'ZATCA production onboarding failed. Sensitive details were redacted.'
  }
  return message
}

function formatProductionDebugDiagnostics(samples: unknown): string {
  if (!Array.isArray(samples) || samples.length === 0) return ''

  return samples.map((sample: any) => {
    const lines = [
      `Sample: ${safeUiText(sample?.type) ?? 'unknown'}`,
      sample?.httpStatus ? `HTTP: ${sample.httpStatus}` : undefined,
      sample?.validationStatus ? `Validation: ${safeUiText(sample.validationStatus)}` : undefined,
      sample?.reportingStatus ? `Reporting: ${safeUiText(sample.reportingStatus)}` : undefined,
      sample?.clearanceStatus ? `Clearance: ${safeUiText(sample.clearanceStatus)}` : undefined,
      sample?.statusString ? `Status: ${safeUiText(sample.statusString)}` : undefined,
      sample?.message ? `Message: ${safeUiText(sample.message)}` : undefined,
      formatMessages('Warnings', sample?.redactedWarnings),
      formatMessages('Errors', sample?.redactedErrors),
      sample?.responseBodySafeSummary ? `Body: ${safeUiText(sample.responseBodySafeSummary, 900)}` : undefined,
    ].filter(Boolean)
    return lines.join('\n')
  }).join('\n\n')
}

function formatMessages(label: string, value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const text = value.map((item: any) => {
    const code = safeUiText(item?.code)
    const message = safeUiText(item?.message)
    return [code, message].filter(Boolean).join(': ')
  }).filter(Boolean).join('; ')
  return text ? `${label}: ${text}` : undefined
}

function safeUiText(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).replace(/[\r\t]+/g, ' ').slice(0, maxLength)
  if (/otp|secret|csid|token|certificate|private[_ -]?key|encryption key|authorization|csr|xml/i.test(text)) {
    return 'Sensitive detail redacted.'
  }
  return text
}

// ── Production onboarding orchestrator ───────────────────────────────────────

export type { ZatcaFunctionalityMap } from '../../../shared/zatcaCapability'

export type ProductionOnboardingStatus =
  | 'not_started'
  | 'generating_csr'
  | 'compliance_csid_requested'
  | 'compliance_samples_passed'
  | 'production_csid_requested'
  | 'production_connected'
  | 'disconnected'
  | 'compliance_failed'
  | 'failed'

export interface ProductionComplianceSampleResult {
  type: string
  invoiceKind?: 'simplified' | 'standard'
  documentKind?: 'invoice' | 'credit_note' | 'debit_note'
  accepted?: boolean
  status: 'accepted' | 'blocked' | 'ambiguous_failed'
  dryRun?: boolean
  httpStatus?: number
  statusString?: string
  validationStatus?: string
  reportingStatus?: string
  clearanceStatus?: string
  warningsCount?: number
  errorsCount?: number
  redactedWarnings?: Array<{ code?: string; message?: string }>
  redactedErrors?: Array<{ code?: string; message?: string }>
  responseBodySafeSummary?: string
  zatcaHeaders?: Record<string, string>
  debugInvoiceHash?: string
  debugSignedInvoiceXmlBase64?: string
  debugIssueDate?: string
  debugIssueTime?: string
  debugQrTimestamp?: string
  debugTransformedCanonicalHash?: string
  message?: string
}

export interface ProductionOnboardingTraceEntry {
  stage: string
  status: 'pending' | 'success' | 'failed' | 'skipped'
  timestamp?: string
  message?: string
  httpStatus?: number
  warnings?: Array<{ code?: string; message?: string }>
  errors?: Array<{ code?: string; message?: string }>
}

export interface ProductionOnboardingResponse {
  ok: boolean
  preflight?: boolean
  dryRun?: boolean
  branchId: string
  environment: 'production'
  onboardingStatus: ProductionOnboardingStatus
  steps?: ProductionOnboardingStatus[]
  functionalityMap?: ZatcaFunctionalityMap
  requestedFunctionalityMap?: ZatcaFunctionalityMap | null
  issuedFunctionalityMap?: ZatcaFunctionalityMap | null
  complianceSampleResults?: ProductionComplianceSampleResult[]
  connectedAt?: string | null
  disconnectedAt?: string | null
  updatedAt?: string | null
  productionCsidExists?: boolean
  productionSecretExists?: boolean
  branchReady?: boolean
  branchBlocked?: boolean
  chainHeadExists?: boolean
  branchV2Ready?: boolean
  chainInitialized?: boolean
  v2Ready?: boolean
  checkoutMode?: 'legacy' | 'v2'
  branchName?: string | null
  vatNumber?: string | null
  crNumber?: string | null
  message?: string
  trace?: ProductionOnboardingTraceEntry[]
}

export async function onboardProductionZatca(params: {
  branchId: string
  otp: string
  functionalityMap: ZatcaFunctionalityMap
  dryRun?: boolean
  forceReconnect?: boolean
}): Promise<ProductionOnboardingResponse> {
  return edgePostSafe<ProductionOnboardingResponse>('zatca-onboard-production', {
    action: 'onboard',
    branchId: params.branchId,
    otp: params.otp,
    functionalityMap: params.functionalityMap,
    dryRun: params.dryRun ?? true,
    forceReconnect: params.forceReconnect ?? false,
  })
}

export async function preflightProductionZatca(params: {
  branchId: string
  functionalityMap: ZatcaFunctionalityMap
}): Promise<ProductionOnboardingResponse> {
  return edgePostSafe<ProductionOnboardingResponse>('zatca-onboard-production', {
    action: 'preflight',
    branchId: params.branchId,
    functionalityMap: params.functionalityMap,
  })
}

export async function getProductionOnboardingStatus(branchId: string): Promise<ProductionOnboardingResponse> {
  return edgePostSafe<ProductionOnboardingResponse>('zatca-onboard-production', {
    action: 'status',
    branchId,
  })
}

export async function resetFailedProductionOnboarding(branchId: string): Promise<ProductionOnboardingResponse> {
  return edgePostSafe<ProductionOnboardingResponse>('zatca-reset-failed-onboarding', {
    branchId,
  })
}

export async function disconnectProductionZatca(params: {
  branchId: string
  confirmation: string
}): Promise<ProductionOnboardingResponse> {
  return edgePostSafe<ProductionOnboardingResponse>('zatca-disconnect-production', {
    branchId: params.branchId,
    confirmation: params.confirmation,
  })
}

export type SandboxValidationStatus =
  | 'sandbox_validation_pending'
  | 'sandbox_validated'
  | 'sandbox_validated_with_warnings'
  | 'sandbox_validation_rejected'
  | 'sandbox_validation_failed'

export interface SandboxValidationMessage {
  code?: string
  message?: string
}

export interface SandboxValidationStage {
  key: string
  label: string
  complete: boolean
  at?: string | null
}

export interface SandboxValidationResponse {
  ok: boolean
  eligible: boolean
  validationId: string | null
  invoiceId: string
  status: SandboxValidationStatus | null
  idempotent?: boolean
  message?: string
  explanation: string
  httpStatus: number | null
  warnings: SandboxValidationMessage[]
  errors: SandboxValidationMessage[]
  updatedAt: string | null
  qrCode?: string | null
  retryAllowed?: boolean
  stages?: SandboxValidationStage[]
}

export interface SandboxDemoConnectionStatus {
  ok: boolean
  branchId: string
  environment: 'ZATCA Sandbox'
  connection: 'Active' | 'Not active'
  complianceChecks: string
  productionSubmission: 'Not enabled'
  active: boolean
}

/** Authoritative server-side routing state. Never infer this from tenant or
 * historical branch UUIDs in the browser. */
export type ZatcaConnectionState = 'not_started' | 'onboarding' | 'connected' | 'blocked' | 'failed'

export interface ZatcaConnectionResolution {
  branch_id: string
  environment: 'sandbox' | 'production'
  connection_state: ZatcaConnectionState
  onboarding_stage: string
  credential_status: string
  readiness_reason: string
}

export async function getZatcaConnectionState(branchId: string): Promise<ZatcaConnectionResolution> {
  return edgePostSafe<ZatcaConnectionResolution>('resolve-zatca-connection', { branchId })
}

export interface SandboxOnboardingStatus {
  ok: boolean
  branchId: string
  environment: 'sandbox'
  status: string
  operationId?: string | null
  onboardingUid?: string | null
  functionalityMap?: ZatcaFunctionalityMap | null
  completedSteps: string[]
  requiredComplianceDocuments: string[]
  certificateExists: boolean
  publicKeyExists: boolean
  complianceCredentialExists: boolean
  sandboxProductionCredentialExists: boolean
  expiresAt?: string | null
  lastError?: string | null
  failedStep?: string | null
  operationInProgress?: string | null
  reconciliationStatus?: string | null
  restartRequired?: boolean
  activatedAt?: string | null
  updatedAt?: string | null
  lastSafeResponse?: Record<string, unknown> | null
}

export type SandboxBranchOnboardingAction =
  | 'get_status'
  | 'generate_csr'
  | 'request_compliance_csid'
  | 'submit_compliance_documents'
  | 'request_sandbox_production_csid'
  | 'activate'
  | 'retry_failed_step'

export interface SandboxBranchOnboardingResponse {
  ok: boolean
  branchId: string
  environment: 'sandbox'
  status: 'not_started' | 'csr_ready' | 'compliance_csid_ready' | 'compliance_checks_pending' | 'compliance_passed' | 'sandbox_production_csid_ready' | 'active' | 'failed' | 'expired' | 'revoked'
  functionalityMap?: ZatcaFunctionalityMap | null
  completedSteps?: string[]
  complianceCredentialExists?: boolean
  sandboxProductionCredentialExists?: boolean
  complianceSampleResults?: Array<{ type: string; status: 'accepted' | 'blocked' | 'ambiguous_failed'; httpStatus?: number }>
  failedStep?: string | null
  lastError?: string | null
  operationInProgress?: string | null
  operationStartedAt?: string | null
  reconciliationStatus?: string | null
}

export async function getSandboxBranchOnboardingStatus(branchId: string, tenantId: string): Promise<SandboxBranchOnboardingResponse> {
  return sandboxEdgePost<SandboxBranchOnboardingResponse>({ action: 'get_status', tenantId, branchId })
}

export async function runSandboxBranchOnboarding(params: {
  branchId: string
  tenantId: string
  action: Exclude<SandboxBranchOnboardingAction, 'get_status'>
  otp?: string
  functionalityMap?: ZatcaFunctionalityMap
}): Promise<SandboxBranchOnboardingResponse> {
  return sandboxEdgePost<SandboxBranchOnboardingResponse>({
    action: params.action,
    tenantId: params.tenantId,
    branchId: params.branchId,
    ...(params.otp ? { otp: params.otp } : {}),
    ...(params.functionalityMap ? { functionalityMap: params.functionalityMap } : {}),
  })
}

export async function getSandboxDemoOnboardingStatus(): Promise<SandboxOnboardingStatus> {
  return edgePostSafe<SandboxOnboardingStatus>('zatca-onboard-sandbox-demo', {
    action: 'get_status',
  })
}

export type SandboxReconnectRequest = {
  otp: string
}

export interface SandboxResetResult {
  ok: boolean
  reset: boolean
  already_reset: boolean
  credential_id?: string
  onboarding_uid?: string
  previous_stage?: string
  previous_operation?: string | null
  status: string
  reason: string
  reset_at?: string
}

const PERMANENT_DEMO_TRADING_BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'

export async function runSandboxDemoOnboarding(params: {
  action: 'generate_csr' | 'request_compliance_csid' | 'submit_compliance_documents' | 'request_sandbox_production_csid' | 'activate'
  functionalityMap?: ZatcaFunctionalityMap
  reconnect?: SandboxReconnectRequest
}): Promise<SandboxOnboardingStatus> {
  return edgePostSafe<SandboxOnboardingStatus>('zatca-onboard-sandbox-demo', {
    action: params.action,
    ...(params.functionalityMap ? { functionalityMap: params.functionalityMap } : {}),
    ...(params.reconnect ?? {}),
  })
}

export interface TradingSandboxV2Event {
  session_id?: string
  event_at: string
  stage: string
  status: 'pending' | 'success' | 'failed'
  http_status?: number | null
  safe_code?: string | null
  safe_message?: string | null
  request_id?: string | null
  non_secret_response_fields?: string[]
  required_fields_present?: Record<string, boolean>
  public_key_fingerprint_prefixes?: Record<string, string>
}

export interface TradingSandboxV2Status {
  ok: boolean
  onboardingVersion: 2
  environment: 'integration_sandbox'
  sessionId: string | null
  status: 'not_started' | 'in_progress' | 'failed' | 'completed'
  stage: string
  functionalityMap: '0100'
  productionCertificateField: 'binarySecurityToken'
  errorCode?: string | null
  errorMessage?: string | null
  requestId?: string
  events: TradingSandboxV2Event[]
}

/** Owner-only, isolated Trading Demo Integration Sandbox V2 onboarding. */
export async function runTradingSandboxV2Onboarding(otp: string): Promise<TradingSandboxV2Status> {
  return edgePostSafe<TradingSandboxV2Status>('zatca-onboard-trading-sandbox-v2', { otp })
}

export async function resetSandboxDemoOnboarding(): Promise<SandboxResetResult & SandboxOnboardingStatus> {
  return edgePostSafe<SandboxResetResult & SandboxOnboardingStatus>('zatca-onboard-sandbox-demo', {
    action: 'reset_sandbox_onboarding',
    confirmation: 'RESET SANDBOX',
  })
}

export async function activateSandboxDemoConnection(): Promise<SandboxDemoConnectionStatus> {
  return edgePostSafe<SandboxDemoConnectionStatus>('zatca-validate-sandbox-demo', {
    action: 'activate_compliance_demo',
    branchId: PERMANENT_DEMO_TRADING_BRANCH_ID,
  })
}

export async function getSandboxValidationStatus(invoiceId: string): Promise<SandboxValidationResponse> {
  return edgePostSafe<SandboxValidationResponse>('zatca-validate-sandbox-demo', {
    action: 'status',
    invoiceId,
  })
}

export async function getSandboxValidationStatuses(invoiceIds: string[]): Promise<Record<string, SandboxValidationResponse>> {
  const response = await edgePostSafe<{ ok: boolean; attempts: Record<string, SandboxValidationResponse> }>(
    'zatca-validate-sandbox-demo',
    { action: 'list_status', invoiceIds },
  )
  return response.attempts
}

export async function validateInvoiceInSandbox(invoiceId: string): Promise<SandboxValidationResponse> {
  return edgePostSafe<SandboxValidationResponse>('zatca-validate-sandbox-demo', {
    action: 'validate',
    invoiceId,
  })
}

export async function getSandboxDemoConnectionStatus(branchId: string): Promise<SandboxDemoConnectionStatus> {
  return edgePostSafe<SandboxDemoConnectionStatus>('zatca-validate-sandbox-demo', {
    action: 'connection_status',
    branchId,
  })
}

// ── Safe legacy certificate metadata ─────────────────────────────────────────

export interface SafeZatcaCertificateStatus {
  id: string
  tenant_id: string
  branch_id: string
  status: CertificateStatus
  environment: string
  serial_number: string | null
  valid_from: string | null
  valid_to: string | null
  activated_at: string | null
  invoice_counter: number | null
  certificate_exists: boolean
  created_at: string | null
  updated_at: string | null
}

const SAFE_CERTIFICATE_STATUS_COLUMNS = `
  id,
  tenant_id,
  branch_id,
  status,
  environment,
  serial_number,
  valid_from,
  valid_to,
  activated_at,
  invoice_counter,
  created_at,
  updated_at
`

function normalizeCertificateStatus(row: any): SafeZatcaCertificateStatus {
  const status = (row?.status ?? 'pending') as CertificateStatus
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    branch_id: String(row.branch_id),
    status,
    environment: String(row.environment ?? 'sandbox'),
    serial_number: row.serial_number ?? null,
    valid_from: row.valid_from ?? null,
    valid_to: row.valid_to ?? null,
    activated_at: row.activated_at ?? null,
    invoice_counter: row.invoice_counter ?? null,
    certificate_exists: Boolean(row.certificate_exists ?? (status === 'active' || status === 'compliance')),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  }
}

export async function listZatcaCertificateStatus(): Promise<SafeZatcaCertificateStatus[]> {
  const rpc = await (supabase as any)
    .rpc('list_zatca_certificate_status')

  if (!rpc.error) {
    return ((rpc.data ?? []) as any[]).map(normalizeCertificateStatus)
  }

  const message = String(rpc.error?.message ?? '')
  const missingRpc = /list_zatca_certificate_status|function .* does not exist|schema cache/i.test(message)
  if (!missingRpc) {
    throw new Error('Unable to load ZATCA certificate status')
  }

  // Allows deploying this frontend before the Phase 3A SQL is manually applied.
  // This fallback intentionally reads only safe display metadata.
  const fallback = await (supabase as any)
    .from('zatca_certificates')
    .select(SAFE_CERTIFICATE_STATUS_COLUMNS)

  if (fallback.error) {
    throw new Error('Unable to load ZATCA certificate status')
  }

  return ((fallback.data ?? []) as any[]).map(normalizeCertificateStatus)
}

// ── Invoice submission ────────────────────────────────────────────────────────

export interface ZatcaSubmitResponse {
  status:             'REPORTED' | 'CLEARED' | 'NOT_REPORTED' | 'ERROR'
  submissionId?:      string
  warnings?:          string[]
  errors?:            string[]
  clearanceStatus?:   string
  reportingStatus?:   string
  zatcaResponse?:     Record<string, unknown>
}

/**
 * Submit a signed invoice to ZATCA (reporting for simplified, clearance for standard).
 * The Edge Function picks the correct endpoint based on invoice type.
 */
export async function submitInvoice(params: {
  invoiceId:    string
  signedXml:    string
  invoiceHash:  string
  uuid:         string
  invoiceType:  'simplified' | 'standard'
  branchId:     string
}): Promise<ZatcaSubmitResponse> {
  return edgePost<ZatcaSubmitResponse>('zatca-submit', params)
}
