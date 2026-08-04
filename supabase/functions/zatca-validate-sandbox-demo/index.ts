/**
 * Authenticated compliance validation for the permanent Kubri demo.
 *
 * This function calls only the ZATCA developer-portal compliance/invoices
 * endpoint. It never loads Production CSIDs, never reports or clears an
 * invoice, and never updates invoice or reporting-chain state.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  prepareSandboxComplianceValidation,
  submitSandboxComplianceValidation,
  type ComplianceSampleResult,
  type SampleSeller,
  type SandboxComplianceValidationInvoice,
} from '../_shared/zatca/samples.ts'
import { extractSignedQrCode } from '../_shared/zatca/signed_qr.mjs'

const DEMO_TENANT_ID = 'ebf1144b-55ed-472a-99c9-23b5ee915351'
const TRADING_BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'
const SERVICE_BRANCH_ID = 'c30094d7-40ca-4d2e-833a-07aa18c4fa46'
const DEMO_BRANCH_IDS = [TRADING_BRANCH_ID, SERVICE_BRANCH_ID] as const
const SANDBOX_BASE_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ValidationStatus =
  | 'sandbox_validation_pending'
  | 'sandbox_validated'
  | 'sandbox_validated_with_warnings'
  | 'sandbox_validation_rejected'
  | 'sandbox_validation_failed'

interface ValidationAttempt {
  id: string
  credential_id: string
  device_id: string
  invoice_id: string
  invoice_snapshot_hash: string
  invoice_uuid: string
  invoice_hash: string | null
  signed_xml: string | null
  submission_payload: { invoiceHash: string; uuid: string; invoice: string; documentKind?: 'invoice' | 'credit_note' } | null
  status: ValidationStatus
  response_status: number | null
  safe_response: Record<string, unknown>
  validation_warnings: Array<Record<string, unknown>>
  validation_errors: Array<Record<string, unknown>>
  dispatched_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface CallerProfile {
  id: string
  role: string
  tenant_id: string | null
  branch_id: string | null
  is_active: boolean
}

class RequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'RequestError'
    this.status = status
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i)
  if (!match) throw new RequestError('Unauthorized', 401)
  if (match[1].split('.').length !== 3) throw new RequestError('Unauthorized', 401)
  return match[1]
}

function jwtRole(jwt: string): string | null {
  try {
    const encoded = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))
    return typeof claims?.role === 'string' ? claims.role : null
  } catch {
    return null
  }
}

interface CallerScope {
  serviceRole: boolean
  assignedBranchId: string | null
  role: string | null
}

function isDemoBranchId(value: unknown): value is typeof DEMO_BRANCH_IDS[number] {
  return typeof value === 'string' && DEMO_BRANCH_IDS.includes(value as typeof DEMO_BRANCH_IDS[number])
}

function requireAuthorizedBranch(branchId: unknown, caller: CallerScope): typeof DEMO_BRANCH_IDS[number] {
  if (!isDemoBranchId(branchId) || (caller.assignedBranchId && caller.assignedBranchId !== branchId)) {
    throw new RequestError('Invoice not found or access denied', 404)
  }
  return branchId
}

async function authorizeCaller(db: any, req: Request): Promise<CallerScope> {
  const jwt = bearerToken(req)
  if (jwtRole(jwt) === 'service_role') return { serviceRole: true, assignedBranchId: null, role: 'service_role' }

  const { data: { user }, error: authError } = await db.auth.getUser(jwt)
  if (authError || !user) throw new RequestError('Unauthorized', 401)
  const { data, error } = await db.from('user_profiles')
    .select('id,role,tenant_id,branch_id,is_active').eq('id', user.id).maybeSingle()
  if (error || !data?.id || data.is_active !== true) throw new RequestError('Forbidden', 403)
  const profile = data as CallerProfile
  const tenantRole = (profile.role === 'owner' || profile.role === 'admin') && profile.tenant_id === DEMO_TENANT_ID
  const superAdmin = profile.role === 'super_admin' && (!profile.tenant_id || profile.tenant_id === DEMO_TENANT_ID)
  const assignedBranchUser = profile.role === 'branch' && isDemoBranchId(profile.branch_id)
  if ((!superAdmin && profile.tenant_id !== DEMO_TENANT_ID) || (!tenantRole && !superAdmin && !assignedBranchUser)) {
    throw new RequestError('Invoice not found or access denied', 404)
  }
  return { serviceRole: false, assignedBranchId: assignedBranchUser ? profile.branch_id : null, role: profile.role }
}

async function decryptServerEnvelope(stored: string, secret: string): Promise<string> {
  const [version, ivBase64, cipherBase64] = stored.split(':')
  if (version !== 'v1' || !ivBase64 || !cipherBase64) {
    throw new Error('Invalid encrypted Sandbox credential envelope')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64Bytes(ivBase64) },
    key,
    base64Bytes(cipherBase64),
  )
  return new TextDecoder().decode(plaintext)
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

function saudiInvoiceTime(createdAt: string): { issueDate: string; issueTime: string } {
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime())) throw new RequestError('Invoice timestamp is invalid.', 422)
  const saudi = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const [issueDate, rawTime] = saudi.toISOString().split('T')
  return { issueDate, issueTime: rawTime.split('.')[0] }
}

function sellerFromBranch(branch: any): SampleSeller {
  const seller = {
    name: clean(branch.business_name || branch.name),
    vatNumber: clean(branch.vat_number),
    crNumber: clean(branch.cr_number),
    street: clean(branch.street),
    buildingNumber: clean(branch.building_number),
    district: clean(branch.district),
    city: clean(branch.city),
    postalCode: clean(branch.postal_code),
    countryCode: clean(branch.country || 'SA').toUpperCase(),
  }
  if (
    !seller.name || !/^3\d{13}3$/.test(seller.vatNumber) || !seller.crNumber ||
    !/^\d{4}$/.test(seller.buildingNumber) || !seller.street || !seller.district ||
    !seller.city || !/^\d{5}$/.test(seller.postalCode) || !/^[A-Z]{2}$/.test(seller.countryCode)
  ) {
    throw new RequestError('Demo seller identity is incomplete for Sandbox validation.', 422)
  }
  return seller
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, field: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw new RequestError(`Invoice ${field} is invalid.`, 422)
  }
  return number
}

function operationalInvoice(inv: any, branch: any): SandboxComplianceValidationInvoice {
  const documentKind = inv.zatca_invoice_type === 'credit_note' ? 'credit_note' : 'invoice'
  const validDocument = documentKind === 'invoice'
    ? inv.zatca_invoice_type === 'simplified' && inv.zatca_type_code === '388'
    : inv.zatca_type_code === '381' && clean(inv.invoice_reference) && clean(inv.credit_reason)
  if (inv.status !== 'posted' || !validDocument) {
    throw new RequestError('Only posted simplified invoices and credit notes can use demo ZATCA submission.', 409)
  }
  if (['reported', 'cleared'].includes(inv.zatca_status)) {
    throw new RequestError('A reported or cleared invoice cannot be reclassified as compliance validation.', 409)
  }
  if (!Array.isArray(inv.invoice_items) || inv.invoice_items.length === 0) {
    throw new RequestError('Invoice lines are required for Sandbox compliance validation.', 422)
  }
  if (
    !clean(inv.invoice_number) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      clean(inv.zatca_uuid),
    )
  ) {
    throw new RequestError('Invoice identity is incomplete for Sandbox compliance validation.', 422)
  }
  const lines = inv.invoice_items.map((item: any, index: number) => {
    const taxRate = numberValue(item.tax_rate, 'line tax rate')
    const storedUnitCode = clean(item.selling_unit_code).toUpperCase()
    const unitCode = /^[A-Z0-9]{2,8}$/.test(storedUnitCode)
      ? storedUnitCode
      : null
    if (Math.abs(taxRate - 0.15) > 0.000001) {
      throw new RequestError('The isolated demo validator currently supports 15% standard-rated lines only.', 422)
    }
    return {
      id: index + 1,
      name: clean(item.name),
      quantity: numberValue(item.quantity, 'line quantity'),
      ...(unitCode ? { unitCode } : {}),
      discountAmount: numberValue(item.discount_amount, 'line discount'),
      lineNetAmount: numberValue(item.subtotal, 'line subtotal'),
      taxRate,
      taxAmount: numberValue(item.tax_amount, 'line tax'),
      lineTotal: numberValue(item.total, 'line total'),
    }
  })
  if (lines.some(line => !line.name || line.quantity <= 0)) {
    throw new RequestError('Invoice line name and positive quantity are required.', 422)
  }
  const timestamp = saudiInvoiceTime(inv.created_at)
  return {
    documentKind,
    invoiceNumber: clean(inv.invoice_number),
    uuid: clean(inv.zatca_uuid),
    ...timestamp,
    seller: sellerFromBranch(branch),
    subtotal: numberValue(inv.subtotal, 'subtotal'),
    discountTotal: numberValue(inv.discount_amount, 'discount'),
    taxableAmount: numberValue(inv.taxable_amount, 'taxable amount'),
    taxAmount: numberValue(inv.tax_amount, 'tax amount'),
    totalAmount: numberValue(inv.total_amount, 'total amount'),
    billingReferenceId: documentKind === 'credit_note' ? clean(inv.invoice_reference) : undefined,
    noteReason: documentKind === 'credit_note' ? clean(inv.credit_reason) : undefined,
    lines,
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

function snapshotValue(invoice: SandboxComplianceValidationInvoice): string {
  return JSON.stringify(invoice)
}

async function loadScope(db: any, invoiceId: string, branchId: typeof DEMO_BRANCH_IDS[number]): Promise<{
  invoice: any
  branch: any
  credential: any
}> {
  const [tenantResult, branchResult, invoiceResult, credentialResult] = await Promise.all([
    db.from('tenants').select('id').eq('id', DEMO_TENANT_ID).eq('is_demo', true).eq('is_active', true).maybeSingle(),
    db.from('branches').select(`
      id,tenant_id,name,business_name,vat_number,cr_number,building_number,
      street,district,city,postal_code,country,zatca_environment,is_active
    `).eq('id', branchId).eq('tenant_id', DEMO_TENANT_ID)
      .eq('zatca_environment', 'sandbox').eq('is_active', true).maybeSingle(),
    db.from('invoices').select(`
      id,tenant_id,branch_id,invoice_number,invoice_reference,original_invoice_id,credit_reason,
      zatca_uuid,zatca_invoice_type,zatca_type_code,
      zatca_status,status,created_at,subtotal,discount_amount,taxable_amount,tax_amount,total_amount,
      invoice_items(id,name,quantity,selling_unit_code,unit_price,discount_amount,subtotal,tax_rate,tax_amount,total)
    `).eq('id', invoiceId).eq('tenant_id', DEMO_TENANT_ID).eq('branch_id', branchId).maybeSingle(),
    db.from('zatca_sandbox_credentials').select(`
      id,tenant_id,branch_id,device_id,environment,compliance_demo_status,
      last_successful_onboarding_status,encrypted_private_key,
      encrypted_compliance_csid,encrypted_compliance_secret
    `).eq('tenant_id', DEMO_TENANT_ID).eq('branch_id', branchId)
      .eq('environment', 'sandbox').eq('status', 'compliance')
      .eq('compliance_demo_status', 'active').maybeSingle(),
  ])
  if (
    tenantResult.error || !tenantResult.data || branchResult.error || !branchResult.data ||
    invoiceResult.error || !invoiceResult.data
  ) {
    throw new RequestError('Invoice is outside the permanent Sandbox demo scope.', 403)
  }
  const credential = credentialResult.data
  if (
    credentialResult.error || !credential ||
    !['compliance_passed', 'sandbox_production_csid_ready', 'active'].includes(
      credential.last_successful_onboarding_status,
    ) ||
    !credential.encrypted_private_key || !credential.encrypted_compliance_csid ||
    !credential.encrypted_compliance_secret
  ) {
    throw new RequestError('An active compliance-demo credential is not available.', 409)
  }
  if (invoiceResult.data.zatca_invoice_type === 'credit_note') {
    const originalInvoiceId = invoiceResult.data.original_invoice_id
    const { data: originalAttempt, error: originalAttemptError } = await db
      .from('zatca_sandbox_validation_attempts').select('id,status')
      .eq('invoice_id', originalInvoiceId)
      .eq('tenant_id', DEMO_TENANT_ID).eq('branch_id', branchId)
      .in('status', ['sandbox_validated', 'sandbox_validated_with_warnings']).maybeSingle()
    if (originalAttemptError || !originalAttempt?.id) {
      throw new RequestError('The original invoice must be successfully submitted before its credit note.', 409)
    }
  }
  return { invoice: invoiceResult.data, branch: branchResult.data, credential }
}

async function loadAttempt(db: any, invoiceId: string): Promise<ValidationAttempt | null> {
  const { data, error } = await db.from('zatca_sandbox_validation_attempts')
    .select('*').eq('invoice_id', invoiceId).maybeSingle()
  if (error) throw new Error('Unable to load Sandbox validation state')
  return (data as ValidationAttempt | null) ?? null
}

function completedResult(attempt: ValidationAttempt, idempotent: boolean): Record<string, unknown> {
  const success = attempt.status === 'sandbox_validated' ||
    attempt.status === 'sandbox_validated_with_warnings'
  return {
    ok: success,
    validationId: attempt.id,
    invoiceId: attempt.invoice_id,
    deviceId: attempt.device_id,
    status: attempt.status,
    idempotent,
    message: success ? 'ZATCA submission successful' : 'Sandbox compliance validation did not succeed.',
    explanation: 'Sandbox compliance validation — not submitted to production.',
    httpStatus: attempt.response_status,
    warnings: attempt.validation_warnings,
    errors: attempt.validation_errors,
    updatedAt: attempt.updated_at,
  }
}

function browserResult(attempt: ValidationAttempt | null, invoiceId: string, eligible: boolean): Record<string, unknown> {
  const success = attempt?.status === 'sandbox_validated' ||
    attempt?.status === 'sandbox_validated_with_warnings'
  return {
    ok: success,
    eligible,
    validationId: attempt?.id ?? null,
    invoiceId,
    status: attempt?.status ?? null,
    idempotent: !!attempt,
    message: success ? 'ZATCA submission successful' : undefined,
    explanation: 'Sandbox compliance validation — not submitted to production.',
    httpStatus: attempt?.response_status ?? null,
    warnings: attempt?.validation_warnings ?? [],
    errors: attempt?.validation_errors ?? [],
    updatedAt: attempt?.completed_at ?? attempt?.updated_at ?? null,
    qrCode: attempt ? extractSignedQrCode(attempt.signed_xml) : null,
    retryAllowed: !!attempt && ['sandbox_validation_rejected', 'sandbox_validation_failed'].includes(attempt.status) && !attempt.dispatched_at,
    stages: safeStages(attempt, eligible),
  }
}

function safeStages(attempt: ValidationAttempt | null, eligible: boolean): Array<Record<string, unknown>> {
  return [
    { key: 'invoice_posted', label: 'Invoice posted', complete: eligible || !!attempt },
    { key: 'request_created', label: 'Validation request created', complete: !!attempt, at: attempt?.created_at ?? null },
    { key: 'payload_prepared', label: 'Signed payload prepared', complete: !!attempt?.invoice_hash },
    { key: 'sandbox_dispatched', label: 'Dispatched to Sandbox', complete: !!attempt?.dispatched_at, at: attempt?.dispatched_at ?? null },
    { key: 'http_received', label: 'HTTP response received', complete: attempt?.response_status != null },
    { key: 'validation_finalized', label: 'Final validation status', complete: !!attempt?.completed_at, at: attempt?.completed_at ?? null },
  ]
}

async function listBrowserResults(db: any, invoiceIds: string[], caller: CallerScope): Promise<Record<string, unknown>> {
  if (invoiceIds.length === 0) return { ok: true, attempts: {} }
  let invoiceQuery = db.from('invoices').select('id,branch_id')
    .eq('tenant_id', DEMO_TENANT_ID).in('branch_id', [...DEMO_BRANCH_IDS]).in('id', invoiceIds)
  if (caller.assignedBranchId) invoiceQuery = invoiceQuery.eq('branch_id', caller.assignedBranchId)
  const { data: invoices, error: invoiceError } = await invoiceQuery
  if (invoiceError || (invoices?.length ?? 0) !== invoiceIds.length) {
    throw new RequestError('Invoice not found or access denied', 404)
  }
  const { data, error } = await db.from('zatca_sandbox_validation_attempts').select(`
    id,credential_id,device_id,invoice_id,invoice_snapshot_hash,invoice_uuid,invoice_hash,
    signed_xml,submission_payload,status,response_status,safe_response,validation_warnings,
    validation_errors,dispatched_at,completed_at,created_at,updated_at
  `).in('invoice_id', invoiceIds)
  if (error) throw new Error('Unable to load Sandbox validation states')
  const attempts: Record<string, unknown> = {}
  for (const row of data ?? []) {
    const attempt = row as ValidationAttempt
    attempts[attempt.invoice_id] = browserResult(attempt, attempt.invoice_id, true)
  }
  return { ok: true, attempts }
}

async function authorizeInvoiceScope(db: any, invoiceId: string, caller: CallerScope): Promise<{ eligible: boolean; branchId: typeof DEMO_BRANCH_IDS[number] }> {
  const { data, error } = await db.from('invoices')
    .select('id,branch_id,status,zatca_invoice_type,zatca_type_code,zatca_status,original_invoice_id')
    .eq('id', invoiceId).eq('tenant_id', DEMO_TENANT_ID).in('branch_id', [...DEMO_BRANCH_IDS]).maybeSingle()
  if (error || !data?.id) throw new RequestError('Invoice not found or access denied', 404)
  const branchId = requireAuthorizedBranch(data.branch_id, caller)
  const baseEligible = data.status === 'posted' && !['reported', 'cleared'].includes(data.zatca_status)
  if (data.zatca_invoice_type === 'simplified') {
    return { eligible: baseEligible && data.zatca_type_code === '388', branchId }
  }
  if (data.zatca_invoice_type !== 'credit_note' || data.zatca_type_code !== '381' || !data.original_invoice_id) {
    return { eligible: false, branchId }
  }
  const { data: originalAttempt, error: attemptError } = await db.from('zatca_sandbox_validation_attempts')
    .select('id,status').eq('invoice_id', data.original_invoice_id)
    .eq('tenant_id', DEMO_TENANT_ID).eq('branch_id', branchId)
    .in('status', ['sandbox_validated', 'sandbox_validated_with_warnings']).maybeSingle()
  return { eligible: baseEligible && !attemptError && !!originalAttempt?.id, branchId }
}

async function connectionStatus(db: any, branchId: typeof DEMO_BRANCH_IDS[number]): Promise<Record<string, unknown>> {
  const { data, error } = await db.from('zatca_sandbox_credentials')
    .select('id,compliance_demo_status,last_successful_onboarding_status,compliance_sample_results')
    .eq('tenant_id', DEMO_TENANT_ID).eq('branch_id', branchId)
    .eq('environment', 'sandbox').eq('status', 'compliance')
    .eq('compliance_demo_status', 'active').maybeSingle()
  if (error) throw new Error('Unable to load Sandbox compliance-validation status')
  const passed = Array.isArray(data?.compliance_sample_results)
    ? data.compliance_sample_results.filter((sample: any) => sample?.status === 'accepted').length
    : 0
  const active = !!data?.id && data.compliance_demo_status === 'active' && passed === 6 &&
    ['compliance_passed', 'sandbox_production_csid_ready', 'active'].includes(data.last_successful_onboarding_status)
  return {
    ok: true,
    branchId,
    environment: 'ZATCA Sandbox',
    connection: active ? 'Active' : 'Not active',
    complianceChecks: `${passed}/6 passed`,
    productionSubmission: 'Not enabled',
    active,
  }
}

async function activateComplianceDemo(db: any, branchId: typeof DEMO_BRANCH_IDS[number]): Promise<Record<string, unknown>> {
  const { data: credential, error } = await db.from('zatca_sandbox_credentials')
    .select('id,last_successful_onboarding_status,compliance_sample_results,encrypted_private_key,encrypted_compliance_csid,encrypted_compliance_secret')
    .eq('tenant_id', DEMO_TENANT_ID).eq('branch_id', branchId).eq('environment', 'sandbox')
    .in('status', ['compliance', 'failed']).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const acceptedSamples = Array.isArray(credential?.compliance_sample_results)
    ? credential.compliance_sample_results.filter((sample: any) => sample?.status === 'accepted')
    : []
  const acceptedTypes = new Set(acceptedSamples.map((sample: any) => sample?.type))
  if (
    error || !credential?.id || credential.last_successful_onboarding_status !== 'compliance_passed' ||
    acceptedSamples.length !== 6 || acceptedTypes.size !== 6 || !credential.encrypted_private_key ||
    !credential.encrypted_compliance_csid || !credential.encrypted_compliance_secret
  ) {
    throw new RequestError('Six accepted compliance checks are required before activation.', 409)
  }
  const { data: activated, error: updateError } = await db.from('zatca_sandbox_credentials')
    .update({ compliance_demo_status: 'active' })
    .eq('id', credential.id).eq('tenant_id', DEMO_TENANT_ID).eq('branch_id', branchId)
    .eq('environment', 'sandbox').eq('last_successful_onboarding_status', 'compliance_passed')
    .select('id').maybeSingle()
  if (updateError || !activated?.id) throw new Error('Unable to activate Sandbox compliance validation')
  return connectionStatus(db, branchId)
}

function finalStatus(result: ComplianceSampleResult): ValidationStatus {
  if (result.status === 'accepted') {
    return (result.warningsCount ?? 0) > 0
      ? 'sandbox_validated_with_warnings'
      : 'sandbox_validated'
  }
  return result.status === 'ambiguous_failed'
    ? 'sandbox_validation_failed'
    : 'sandbox_validation_rejected'
}

function safeResult(result: ComplianceSampleResult): Record<string, unknown> {
  return {
    httpStatus: result.httpStatus,
    statusString: safeText(result.statusString),
    validationStatus: safeText(result.validationStatus),
    reportingStatus: safeText(result.reportingStatus),
    clearanceStatus: safeText(result.clearanceStatus),
    warningsCount: result.warningsCount ?? 0,
    errorsCount: result.errorsCount ?? 0,
  }
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
  if (!text || /otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|xml|invoice/i.test(text)) {
    return undefined
  }
  return text
}

async function validateInvoice(db: any, invoiceId: string, branchId: typeof DEMO_BRANCH_IDS[number]): Promise<Record<string, unknown>> {
  const { invoice: invoiceRow, branch, credential } = await loadScope(db, invoiceId, branchId)
  const invoice = operationalInvoice(invoiceRow, branch)
  const snapshotHash = await sha256Hex(snapshotValue(invoice))
  let attempt = await loadAttempt(db, invoiceId)

  if (attempt) {
    if (
      attempt.credential_id !== credential.id || attempt.device_id !== credential.device_id ||
      attempt.invoice_snapshot_hash !== snapshotHash
    ) {
      throw new RequestError('Existing Sandbox validation is bound to different immutable input.', 409)
    }
    if (attempt.status !== 'sandbox_validation_pending') return completedResult(attempt, true)
    if (attempt.dispatched_at) {
      throw new RequestError('Sandbox validation was already dispatched and cannot be retried automatically.', 409)
    }
  } else {
    const { data, error } = await db.from('zatca_sandbox_validation_attempts').insert({
      tenant_id: DEMO_TENANT_ID,
      branch_id: branchId,
      credential_id: credential.id,
      device_id: credential.device_id,
      invoice_id: invoiceId,
      invoice_snapshot_hash: snapshotHash,
      invoice_uuid: invoice.uuid,
      status: 'sandbox_validation_pending',
      safe_response: { endpointKind: 'compliance_validation' },
    }).select('*').single()
    if (error || !data) {
      attempt = await loadAttempt(db, invoiceId)
      if (!attempt) throw new Error('Unable to reserve Sandbox compliance validation')
    } else {
      attempt = data as ValidationAttempt
    }
  }

  const encryptionSecret = Deno.env.get('ZATCA_SERVER_ENCRYPTION_KEY')
  if (!encryptionSecret) throw new Error('Sandbox credential encryption is unavailable')
  const [privateKeyPem, complianceCsid, complianceSecret] = await Promise.all([
    decryptServerEnvelope(credential.encrypted_private_key, encryptionSecret),
    decryptServerEnvelope(credential.encrypted_compliance_csid, encryptionSecret),
    decryptServerEnvelope(credential.encrypted_compliance_secret, encryptionSecret),
  ])

  let prepared = attempt.submission_payload && attempt.signed_xml && attempt.invoice_hash
    ? {
        invoiceHash: attempt.invoice_hash,
        uuid: attempt.submission_payload.uuid,
        invoice: attempt.submission_payload.invoice,
        documentKind: attempt.submission_payload.documentKind ?? invoice.documentKind,
        signedXml: attempt.signed_xml,
      }
    : null
  if (!prepared) {
    prepared = await prepareSandboxComplianceValidation({
      invoice,
      complianceCertificate: complianceCsid,
      privateKeyPem,
    })
    const submissionPayload = {
      invoiceHash: prepared.invoiceHash,
      uuid: prepared.uuid,
      invoice: prepared.invoice,
      documentKind: prepared.documentKind,
    }
    const { data, error } = await db.from('zatca_sandbox_validation_attempts').update({
      invoice_hash: prepared.invoiceHash,
      signed_xml: prepared.signedXml,
      submission_payload: submissionPayload,
    }).eq('id', attempt.id).eq('status', 'sandbox_validation_pending')
      .is('invoice_hash', null).select('*').maybeSingle()
    if (error || !data) throw new Error('Unable to freeze Sandbox validation payload')
    attempt = data as ValidationAttempt
  }

  const dispatchedAt = new Date().toISOString()
  const { data: dispatched, error: dispatchError } = await db.from('zatca_sandbox_validation_attempts')
    .update({ dispatched_at: dispatchedAt })
    .eq('id', attempt.id).eq('status', 'sandbox_validation_pending')
    .is('dispatched_at', null).select('id').maybeSingle()
  if (dispatchError || !dispatched) {
    throw new RequestError('Sandbox validation was already dispatched and cannot be retried automatically.', 409)
  }

  const result = await submitSandboxComplianceValidation({
    baseUrl: SANDBOX_BASE_URL,
    complianceCsid,
    complianceSecret,
    prepared,
  })
  const status = finalStatus(result)
  const completedAt = new Date().toISOString()
  const { data: finalized, error: finalizeError } = await db.from('zatca_sandbox_validation_attempts')
    .update({
      status,
      response_status: result.httpStatus ?? null,
      safe_response: safeResult(result),
      validation_warnings: result.redactedWarnings ?? [],
      validation_errors: result.redactedErrors ?? [],
      completed_at: completedAt,
    }).eq('id', attempt.id).eq('status', 'sandbox_validation_pending')
      .select('*').maybeSingle()
  if (finalizeError || !finalized) throw new Error('Unable to persist Sandbox validation result')
  return completedResult(finalized as ValidationAttempt, false)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Backend service configuration is unavailable')
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const caller = await authorizeCaller(db, req)
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['action', 'invoiceId', 'invoiceIds', 'branchId'].includes(key))) {
      throw new RequestError('Invalid request body', 400)
    }
    const action = typeof body.action === 'string' ? body.action : 'validate'
    if (!['validate', 'status', 'list_status', 'connection_status', 'activate_compliance_demo'].includes(action)) {
      throw new RequestError('Invalid action', 400)
    }
    if (action === 'connection_status' || action === 'activate_compliance_demo') {
      const branchId = requireAuthorizedBranch(body.branchId, caller)
      if (action === 'activate_compliance_demo') {
        if (!caller.serviceRole && (branchId !== TRADING_BRANCH_ID || !['owner', 'super_admin'].includes(caller.role ?? ''))) {
          throw new RequestError('Forbidden', 403)
        }
        return jsonResponse(await activateComplianceDemo(db, branchId))
      }
      return jsonResponse(await connectionStatus(db, branchId))
    }
    if (action === 'list_status') {
      if (!Array.isArray(body.invoiceIds) || body.invoiceIds.length > 500 || body.invoiceIds.some(id => (
        typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      ))) throw new RequestError('Valid invoiceIds are required', 400)
      const invoiceIds = [...new Set(body.invoiceIds as string[])]
      return jsonResponse(await listBrowserResults(db, invoiceIds, caller))
    }
    const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
      throw new RequestError('Valid invoiceId is required', 400)
    }
    const { eligible, branchId } = await authorizeInvoiceScope(db, invoiceId, caller)
    if (action === 'status') return jsonResponse(browserResult(await loadAttempt(db, invoiceId), invoiceId, eligible))
    if (!eligible) throw new RequestError('Only eligible posted simplified invoices can use Sandbox compliance validation.', 409)
    const result = await validateInvoice(db, invoiceId, branchId)
    if (caller.serviceRole) return jsonResponse(result)
    return jsonResponse(browserResult(await loadAttempt(db, invoiceId), invoiceId, true))
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500
    const message = error instanceof RequestError
      ? error.message
      : 'Sandbox compliance validation failed. Sensitive details were redacted.'
    console.error('[zatca-validate-sandbox-demo] request failed:', { status, message: safeText(message) })
    return jsonResponse({
      error: message,
      explanation: 'Sandbox compliance validation — not submitted to production.',
    }, status)
  }
})
