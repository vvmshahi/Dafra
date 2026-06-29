/**
 * ZATCA Phase 2 — API Client
 *
 * All calls proxy through Supabase Edge Functions so that:
 *  - Production tokens/secrets never touch the browser directly
 *  - ZATCA API credentials are server-side only
 *  - CORS is handled by the Edge Function
 *
 * Edge Function endpoints:
 *   POST /functions/v1/zatca-compliance   — Sandbox Compliance CSID registration
 *   POST /functions/v1/zatca-production   — Sandbox CSID activation
 *   POST /functions/v1/zatca-submit       — Invoice reporting / clearance
 *   POST /functions/v1/zatca-onboard-production — Owner-only production onboarding
 */

import { supabase } from '@/lib/supabase'

const EDGE = (name: string) =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`

// ── Auth helper ───────────────────────────────────────────────────────────────

async function edgePost<T>(fnName: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const jwt = session?.access_token

  const res = await fetch(EDGE(fnName), {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    // Include raw zatcaBody in the message when present so the UI can show it
    const detail = err.zatcaBody ? `\n\nZATCA raw response:\n${JSON.stringify(err.zatcaBody, null, 2)}` : ''
    throw new Error((err.error ?? `Edge Function ${fnName} returned ${res.status}`) + detail)
  }
  return res.json()
}

async function edgePostSafe<T>(fnName: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const jwt = session?.access_token

  const res = await fetch(EDGE(fnName), {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  })

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
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

function safeBrowserMessage(message: unknown, fallback: string): string {
  if (typeof message !== 'string' || message.length > 240) return fallback
  if (/private[_ -]?key|secret|token|csid|certificate|authorization|csr|xml body|raw zatca/i.test(message)) {
    return 'ZATCA production onboarding failed. Sensitive details were redacted.'
  }
  return message
}

function formatProductionDebugDiagnostics(samples: unknown): string {
  if (!Array.isArray(samples) || samples.length === 0) return ''

  // TEMPORARY DEBUG: browser-safe compliance diagnostics for the existing error
  // area. Failed samples may include signed XML as base64 for local SDK checks.
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
      formatHeaders(sample?.zatcaHeaders),
      sample?.responseBodySafeSummary ? `Body: ${safeUiText(sample.responseBodySafeSummary, 900)}` : undefined,
      sample?.debugInvoiceHash ? `Sent invoiceHash: ${safeUiText(sample.debugInvoiceHash, 500)}` : undefined,
      sample?.debugTransformedCanonicalHash ? `Canonical transformed hash: ${safeUiText(sample.debugTransformedCanonicalHash, 500)}` : undefined,
      sample?.debugIssueDate ? `IssueDate: ${safeUiText(sample.debugIssueDate, 40)}` : undefined,
      sample?.debugIssueTime ? `IssueTime: ${safeUiText(sample.debugIssueTime, 40)}` : undefined,
      sample?.debugQrTimestamp ? `QR timestamp: ${safeUiText(sample.debugQrTimestamp, 80)}` : undefined,
      sample?.debugSignedInvoiceXmlBase64 ? `Signed sample XML base64:\n${safeUiDebugBlob(sample.debugSignedInvoiceXmlBase64)}` : undefined,
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

function formatHeaders(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const text = Object.entries(value as Record<string, unknown>)
    .map(([key, val]) => `${key}=${safeUiText(val)}`)
    .join(', ')
  return text ? `Headers: ${text}` : undefined
}

function safeUiText(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).replace(/[\r\t]+/g, ' ').slice(0, maxLength)
  if (/otp|secret|csid|token|certificate|private[_ -]?key|encryption key|authorization|csr|xml/i.test(text)) {
    return 'Sensitive detail redacted.'
  }
  return text
}

function safeUiDebugBlob(value: unknown, maxLength = 100_000): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, '').slice(0, maxLength)
  return text || undefined
}

// ── Production onboarding orchestrator ───────────────────────────────────────

export type ZatcaFunctionalityMap = '0100' | '1000' | '1100'

export type ProductionOnboardingStatus =
  | 'not_started'
  | 'generating_csr'
  | 'compliance_csid_requested'
  | 'compliance_samples_passed'
  | 'production_csid_requested'
  | 'production_connected'
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
  complianceSampleResults?: ProductionComplianceSampleResult[]
  connectedAt?: string | null
  updatedAt?: string | null
  message?: string
  trace?: ProductionOnboardingTraceEntry[]
}

export async function onboardProductionZatca(params: {
  branchId: string
  otp: string
  functionalityMap: ZatcaFunctionalityMap
  dryRun?: boolean
}): Promise<ProductionOnboardingResponse> {
  return edgePostSafe<ProductionOnboardingResponse>('zatca-onboard-production', {
    action: 'onboard',
    branchId: params.branchId,
    otp: params.otp,
    functionalityMap: params.functionalityMap,
    dryRun: params.dryRun ?? true,
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

// ── Compliance CSID ───────────────────────────────────────────────────────────

export interface ComplianceCsidResponse {
  binarySecurityToken: string  // base64 DER certificate
  secret:              string  // compliance secret
  requestID:           string  // used to request production CSID
}

/**
 * Register a new sandbox EGS device with ZATCA.
 * Calls POST /compliance on the ZATCA sandbox API.
 *
 * @param csr - PEM CSR string
 * @param otp - 6-digit OTP from the Fatoorah portal
 * @param branchId - stored with the certificate record
 */
export async function requestComplianceCsid(
  csr:         string,
  otp:         string,
  branchId:    string,
  environment: 'sandbox' = 'sandbox',
): Promise<ComplianceCsidResponse> {
  return edgePost<ComplianceCsidResponse>('zatca-compliance', { csr, otp, branchId, environment })
}

// ── Sandbox CSID activation ───────────────────────────────────────────────────

export interface ProductionCsidResponse {
  binarySecurityToken: string
  secret:              string
}

/**
 * Convert a sandbox compliance CSID into an active sandbox CSID.
 * Requires the compliance_request_id stored after step 2.
 */
export async function requestProductionCsid(
  branchId:    string,
  environment: 'sandbox' = 'sandbox',
): Promise<ProductionCsidResponse> {
  return edgePost<ProductionCsidResponse>('zatca-production', { branchId, environment })
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
