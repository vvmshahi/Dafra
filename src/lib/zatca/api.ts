/**
 * ZATCA Phase 2 — API Client
 *
 * All calls proxy through Supabase Edge Functions so that:
 *  - Production tokens/secrets never touch the browser directly
 *  - ZATCA API credentials are server-side only
 *  - CORS is handled by the Edge Function
 *
 * Edge Function endpoints:
 *   POST /functions/v1/zatca-compliance   — Compliance CSID registration
 *   POST /functions/v1/zatca-production   — Production CSID activation
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
    throw new Error(safeBrowserMessage(payload?.error, `Edge Function ${fnName} returned ${res.status}`))
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
  status: 'accepted' | 'pending' | 'blocked'
  dryRun?: boolean
  httpStatus?: number
  validationStatus?: string
  reportingStatus?: string
  clearanceStatus?: string
  warningsCount?: number
  errorsCount?: number
  message?: string
}

export interface ProductionOnboardingResponse {
  ok: boolean
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
 * Register a new EGS device with ZATCA.
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
  environment: 'sandbox' | 'production' = 'sandbox',
): Promise<ComplianceCsidResponse> {
  return edgePost<ComplianceCsidResponse>('zatca-compliance', { csr, otp, branchId, environment })
}

// ── Production CSID ───────────────────────────────────────────────────────────

export interface ProductionCsidResponse {
  binarySecurityToken: string
  secret:              string
}

/**
 * Convert a compliance CSID into a production CSID.
 * Requires the compliance_request_id stored after step 2.
 */
export async function requestProductionCsid(
  branchId:    string,
  environment: 'sandbox' | 'production' = 'sandbox',
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
