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
    throw new Error(err.error ?? `Edge Function ${fnName} returned ${res.status}`)
  }
  return res.json()
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
  csr:      string,
  otp:      string,
  branchId: string,
): Promise<ComplianceCsidResponse> {
  return edgePost<ComplianceCsidResponse>('zatca-compliance', { csr, otp, branchId })
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
  branchId:  string,
): Promise<ProductionCsidResponse> {
  return edgePost<ProductionCsidResponse>('zatca-production', { branchId })
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
