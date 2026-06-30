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
 *   POST /functions/v1/zatca-onboard-production — Owner-only production onboarding
 *   POST /functions/v1/zatca-disconnect-production — Owner-only local production disconnect
 */

import { supabase } from '@/lib/supabase'
import type { CertificateStatus } from '@/types'

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
    throw new Error(safeBrowserMessage(err.error, `Edge Function ${fnName} returned ${res.status}`))
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

export type ZatcaFunctionalityMap = '0100' | '1000' | '1100'

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
  complianceSampleResults?: ProductionComplianceSampleResult[]
  connectedAt?: string | null
  disconnectedAt?: string | null
  updatedAt?: string | null
  productionCsidExists?: boolean
  productionSecretExists?: boolean
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

export async function disconnectProductionZatca(params: {
  branchId: string
  confirmation: string
}): Promise<ProductionOnboardingResponse> {
  return edgePostSafe<ProductionOnboardingResponse>('zatca-disconnect-production', {
    branchId: params.branchId,
    confirmation: params.confirmation,
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
