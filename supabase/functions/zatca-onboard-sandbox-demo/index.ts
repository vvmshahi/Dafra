/**
 * Owner-authorized Kubri ZATCA Developer Portal Integration Sandbox onboarding.
 *
 * This function never accepts endpoint/environment input, never reads production
 * credentials, and never returns private keys, CSIDs, secrets, OTPs, or raw
 * authorization material.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { secp256k1 } from 'https://esm.sh/@noble/curves@2.2.0/secp256k1.js'
import {
  isFunctionalityMap,
  isUuid,
  requireEnv,
  validateOtp,
  type FunctionalityMap,
} from '../_shared/zatca/config.ts'
import { generateProductionCsr, validateCsrInputs, type CsrParams } from '../_shared/zatca/csr.ts'
import { encryptText } from '../_shared/zatca/crypto.ts'
import { extractEcPrivateKeyScalar } from '../_shared/zatca/signing_core.mjs'
import {
  assessSandboxComplianceBinding,
  assessSandboxOperationalCertificate,
  certificatePublicKeySpki as productionCertificatePublicKeySpki,
  certificateVatNumber,
} from '../_shared/zatca/sandbox_credential_binding.mjs'
import { classifyStaleSandboxOperation } from '../_shared/zatca/sandbox_stale_operation.mjs'
import {
  inspectZatcaCertificate,
  normalizeZatcaCertificate,
} from '../_shared/zatca/certificate_normalizer.mjs'
import {
  ZatcaHttpError,
  isZatcaHttpError,
} from '../_shared/zatca/client.ts'
import {
  isSandboxComplianceRequestError,
  requestSandboxComplianceCsidWithEvidence,
} from '../_shared/zatca/sandbox_compliance_observability.mjs'
import {
  requiredComplianceSamples,
  stripComplianceSampleDebug,
  submitComplianceSamples,
  type ComplianceSampleResult,
  type SampleSeller,
} from '../_shared/zatca/samples.ts'
import { requireTenantOwner } from '../_shared/zatca/auth.ts'

const SANDBOX_CORE_BASE_URL =
  'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal'
// Retained only as a redacted legacy-status label for previously failed rows.
// It is no longer used as a Sandbox readiness gate.
const SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR =
  'Sandbox Production certificate does not satisfy the CSR/key/VAT binding.'
const SANDBOX_COMPLIANCE_TIMEOUT_MS = 25_000
// Sandbox-only bounded lifecycle. A timeout after dispatch is an unknown
// upstream outcome and must never be retried automatically.
const SANDBOX_PRODUCTION_CSID_TIMEOUT_MS = 25_000
const STALE_ONBOARDING_OPERATION_MS = 90_000
// The authenticated Sandbox 2.1 contract uses the returned Production CSID
// for Sandbox Reporting/Clearance authentication. The known mock certificate
// is not branch-key-bound, so final Sandbox signing remains on the verified
// generated private key plus Compliance certificate.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ACTIONS = [
  'get_status',
  'generate_csr',
  'request_compliance_csid',
  'submit_compliance_documents',
  'request_sandbox_production_csid',
  'activate',
  'retry_failed_step',
  'reconcile_uncertain_operation',
] as const

type Action = typeof ACTIONS[number]
type RetryableAction = Exclude<
  Action,
  'get_status' | 'generate_csr' | 'retry_failed_step' | 'reconcile_uncertain_operation'
>
type ReconciliationDecision =
  | 'mark_verified_success'
  | 'mark_verified_failure'
  | 'revoke_and_restart_device'
  | 'abandoned_by_owner_reset'
type OnboardingStatus =
  | 'not_started'
  | 'csr_ready'
  | 'compliance_csid_ready'
  | 'compliance_checks_pending'
  | 'compliance_passed'
  | 'sandbox_production_csid_ready'
  | 'active'
  | 'failed'
  | 'expired'

interface RequestBody {
  action: Action
  tenantId: string
  branchId: string
  otp?: string
  confirmation?: string
  functionalityMap?: FunctionalityMap
  credentialId?: string
  expectedOperation?: RetryableAction
  reconciliationDecision?: ReconciliationDecision
  reconciledBy?: string
  reconciliationSummary?: string
  verifiedResult?: { resultingStatus: string }
}

interface CredentialRow {
  id: string
  tenant_id: string
  branch_id: string
  environment: 'sandbox'
  device_id: string
  status: 'pending' | 'compliance' | 'active' | 'revoked' | 'expired' | 'failed'
  onboarding_status: OnboardingStatus
  last_successful_onboarding_status: Exclude<OnboardingStatus, 'failed' | 'expired' | 'compliance_checks_pending'>
  failed_step: RetryableAction | null
  onboarding_operation: RetryableAction | null
  operation_started_at: string | null
  reconciliation_status: 'not_required' | 'required' | 'resolved'
  reconciliation_decision: ReconciliationDecision | null
  reconciled_at: string | null
  reconciled_by: string | null
  reconciliation_summary: Record<string, unknown> | null
  functionality_map: FunctionalityMap | null
  egs_serial_number: string | null
  csr_common_name: string | null
  csr_organization_name: string | null
  csr_organizational_unit_name: string | null
  csr_location: string | null
  csr_industry: string | null
  csr_pem: string | null
  public_key_pem: string | null
  encrypted_private_key: string
  compliance_request_id: string | null
  encrypted_compliance_csid: string | null
  encrypted_compliance_secret: string | null
  encrypted_production_csid: string | null
  encrypted_production_secret: string | null
  certificate: string | null
  compliance_sample_results: ComplianceSampleResult[] | null
  last_safe_response: Record<string, unknown>
  last_error: string | null
  certificate_valid_from: string | null
  expires_at: string | null
  csr_generated_at: string | null
  compliance_csid_received_at: string | null
  compliance_checked_at: string | null
  sandbox_production_csid_received_at: string | null
  activated_at: string | null
  created_at: string
  updated_at: string
}

interface Scope {
  tenant: any
  branch: any
}

class RequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'RequestError'
    this.status = status
  }
}

class OperationPersistenceError extends Error {
  constructor() {
    super('Onboarding result could not be persisted; manual reconciliation is required before retrying.')
    this.name = 'OperationPersistenceError'
  }
}

class ExternalReconciliationRequiredError extends Error {
  constructor() {
    super('The Sandbox response was uncertain. Manual reconciliation is required before retrying.')
    this.name = 'ExternalReconciliationRequiredError'
  }
}

class SandboxCompliancePreDispatchError extends Error {
  sandboxComplianceEvidence: Record<string, unknown>

  constructor(message: string, evidence: Record<string, unknown>) {
    super(message)
    this.name = 'SandboxCompliancePreDispatchError'
    this.sandboxComplianceEvidence = evidence
  }
}

class SandboxProductionCsidTimeoutError extends Error {
  constructor() {
    super('The Sandbox Production-CSID request timed out after dispatch. Its outcome is unknown and will not be retried automatically.')
    this.name = 'SandboxProductionCsidTimeoutError'
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const body = await readBody(req)
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const owner = await requireTenantOwner(db, req)
    if (owner.tenantId !== body.tenantId) throw new RequestError('Tenant scope does not match the authenticated owner.', 403)
    const scope = await loadSandboxScope(db, owner.tenantId, body.branchId)

    if (body.action === 'reconcile_uncertain_operation') {
      const reconciliation = await reconcileUncertainOperation(db, body)
      const credential = await loadCredentialById(db, body.credentialId as string, body.tenantId, body.branchId)
      return jsonResponse({
        ok: true,
        ...(await safeStatus(body.branchId, credential)),
        reconciliation,
      })
    }

    if (body.action === 'get_status') {
      const existing = await loadCredential(db, body.tenantId, body.branchId, true)
      const credential = existing ? await reconcileStaleOperation(db, existing) : null
      return jsonResponse({ ok: true, ...(await safeStatus(body.branchId, credential)) })
    }

    let credential = await loadCredential(
      db,
      body.tenantId,
      body.branchId,
      false,
      body.action === 'retry_failed_step',
    )

    if (body.action === 'generate_csr') {
      const idempotent = !!credential
      credential = await generateCsr(db, scope, body, credential)
      return jsonResponse({ ok: true, ...(await safeStatus(body.branchId, credential)), idempotent })
    }

    if (!credential) {
      throw new RequestError('Generate the backend CSR before continuing Sandbox onboarding.', 409)
    }

    const requestedAction = resolveAction(body.action, credential)
    assertOtpForEffectiveAction(body, requestedAction)
    if (credential.onboarding_status === 'failed' && body.action !== 'retry_failed_step') {
      throw new RequestError('This step failed previously. Use retry_failed_step after reviewing the safe error.', 409)
    }

    if (isActionAlreadyComplete(requestedAction, credential)) {
      return jsonResponse({ ok: true, ...(await safeStatus(body.branchId, credential)), idempotent: true })
    }

    assertSellerIdentityUnchanged(scope, credential)

    assertActionState(requestedAction, credential)
    credential = await claimOperation(db, credential, requestedAction)

    try {
      credential = await executeClaimedAction(db, scope, body, credential, requestedAction)
    } catch (error) {
      if (error instanceof OperationPersistenceError) {
        await recordReconciliationRequired(db, credential, requestedAction, error.message)
        throw new RequestError(error.message, 500)
      }
      if (error instanceof ExternalReconciliationRequiredError) {
        throw new RequestError(error.message, 502)
      }
      if (requiresExternalReconciliation(requestedAction, error)) {
        const message = 'The Sandbox response was uncertain. Manual reconciliation is required before retrying.'
        await recordReconciliationRequired(db, credential, requestedAction, message, evidenceFromError(error))
        throw new RequestError(message, 502)
      }
      const safeMessage = safeError(error)
      await markFailed(db, credential, requestedAction, safeMessage, error)
      throw new RequestError(safeMessage, upstreamStatus(error))
    }

    return jsonResponse({ ok: true, ...(await safeStatus(body.branchId, credential)) })
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500
    const message = error instanceof RequestError ? error.message : safeError(error)
    console.error('[zatca-onboard-sandbox-demo] request failed:', {
      status,
      message: safeLogText(message),
    })
    return jsonResponse({ error: message }, status)
  }
})

async function readBody(req: Request): Promise<RequestBody> {
  let value: unknown
  try {
    value = await req.json()
  } catch {
    throw new RequestError('Invalid JSON request body', 400)
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError('Invalid request body', 400)
  }

  const body = value as Record<string, unknown>
  const allowedKeys = new Set([
    'action',
    'tenantId',
    'branchId',
    'otp',
    'confirmation',
    'functionalityMap',
    'credentialId',
    'expectedOperation',
    'reconciliationDecision',
    'reconciledBy',
    'reconciliationSummary',
    'verifiedResult',
  ])
  if (Object.keys(body).some(key => !allowedKeys.has(key))) {
    throw new RequestError('Unsupported request field', 400)
  }
  if (!ACTIONS.includes(body.action as Action)) throw new RequestError('Unsupported onboarding action', 400)
  if (!isUuid(body.tenantId) || !isUuid(body.branchId)) {
    throw new RequestError('Valid tenantId and branchId are required', 400)
  }
  if (body.functionalityMap !== undefined && !isFunctionalityMap(body.functionalityMap)) {
    throw new RequestError('Invalid invoice functionality map', 400)
  }

  const action = body.action as Action
  const reconciliationKeys = [
    'credentialId',
    'expectedOperation',
    'reconciliationDecision',
    'reconciledBy',
    'reconciliationSummary',
    'verifiedResult',
  ]
  if (action === 'reconcile_uncertain_operation') {
    if (body.otp !== undefined || body.functionalityMap !== undefined) {
      throw new RequestError('OTP and functionalityMap are not accepted for reconciliation.', 400)
    }
    validateReconciliationBody(body)
  } else if (reconciliationKeys.some(key => body[key] !== undefined)) {
    throw new RequestError('Reconciliation fields are accepted only for reconciliation.', 400)
  }

  if (body.functionalityMap !== undefined && action !== 'generate_csr') {
    throw new RequestError('functionalityMap is accepted only for CSR generation.', 400)
  }
  if (action === 'generate_csr' && body.functionalityMap !== '1100') {
    throw new RequestError('Canonical Sandbox onboarding supports functionality map 1100 only.', 400)
  }
  if (body.otp !== undefined && action !== 'request_compliance_csid' && action !== 'retry_failed_step') {
    throw new RequestError('OTP is accepted only for the compliance credential step.', 400)
  }
  if (body.otp !== undefined && action === 'request_compliance_csid' && !validateOtp(body.otp)) {
    throw new RequestError('OTP must be exactly 6 digits', 400)
  }

  return body as unknown as RequestBody
}

function validateReconciliationBody(body: Record<string, unknown>): void {
  if (!isUuid(body.credentialId)) throw new RequestError('Valid credentialId is required', 400)
  if (![
    'request_compliance_csid',
    'submit_compliance_documents',
    'request_sandbox_production_csid',
    'activate',
  ].includes(body.expectedOperation as string)) {
    throw new RequestError('Valid expectedOperation is required', 400)
  }
  if (![
    'mark_verified_success',
    'mark_verified_failure',
    'revoke_and_restart_device',
  ].includes(body.reconciliationDecision as string)) {
    throw new RequestError('Valid reconciliationDecision is required', 400)
  }
  if (typeof body.reconciledBy !== 'string' || !/^[A-Za-z0-9@._:-]{3,100}$/.test(body.reconciledBy)) {
    throw new RequestError('A safe internal reconciler identifier is required', 400)
  }
  if (!isSafeReconciliationSummary(body.reconciliationSummary)) {
    throw new RequestError('A safe non-sensitive reconciliation summary is required', 400)
  }

  const verifiedResult = body.verifiedResult ?? {}
  if (typeof verifiedResult !== 'object' || Array.isArray(verifiedResult)) {
    throw new RequestError('verifiedResult must be an object', 400)
  }
  const keys = Object.keys(verifiedResult as Record<string, unknown>)
  if (keys.some(key => key !== 'resultingStatus')) {
    throw new RequestError('verifiedResult contains unsupported fields', 400)
  }
  const decision = body.reconciliationDecision as ReconciliationDecision
  const resultingStatus = (verifiedResult as Record<string, unknown>).resultingStatus
  if (decision === 'mark_verified_success') {
    const expectedStatus: Record<RetryableAction, string> = {
      request_compliance_csid: 'compliance_csid_ready',
      submit_compliance_documents: 'compliance_passed',
      request_sandbox_production_csid: 'sandbox_production_csid_ready',
      activate: 'active',
    }
    if (resultingStatus !== expectedStatus[body.expectedOperation as RetryableAction]) {
      throw new RequestError('verifiedResult does not match the expected operation', 400)
    }
  } else if (keys.length !== 0) {
    throw new RequestError('This reconciliation decision does not accept verified result fields', 400)
  }
}

function isSafeReconciliationSummary(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const summary = value.trim()
  return summary.length >= 10 && summary.length <= 500 &&
    !/(otp|secret|csid|token|certificate|private[ _-]?key|authorization|csr|xml)/i.test(summary)
}

async function loadSandboxScope(db: any, tenantId: string, branchId: string): Promise<Scope> {
  const [tenantResult, branchResult] = await Promise.all([
    db.from('tenants')
      .select('id,name,business_type,is_demo,is_active')
      .eq('id', tenantId)
      .eq('is_demo', true)
      .eq('is_active', true)
      .maybeSingle(),
    db.from('branches')
      .select(`
        id,tenant_id,name,business_name,vat_number,cr_number,building_number,
        street,district,city,postal_code,country,zatca_phase,zatca_environment,is_active
      `)
      .eq('id', branchId)
      .eq('tenant_id', tenantId)
      .eq('zatca_environment', 'sandbox')
      .eq('is_active', true)
      .maybeSingle(),
  ])

  if (tenantResult.error || branchResult.error || !tenantResult.data || !branchResult.data) {
    throw new RequestError('Forbidden: an active demo Sandbox branch is required.', 403)
  }
  return { tenant: tenantResult.data, branch: branchResult.data }
}

async function loadCredential(
  db: any,
  tenantId: string,
  branchId: string,
  includeInactive: boolean,
  includeFailed = false,
): Promise<CredentialRow | null> {
  let query = db.from('zatca_sandbox_credentials')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('environment', 'sandbox')
    .order('created_at', { ascending: false })
    .limit(1)

  if (!includeInactive) {
    query = query.in('status', includeFailed
      ? ['pending', 'compliance', 'active', 'failed']
      : ['pending', 'compliance', 'active'])
  }
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error('Unable to load Sandbox onboarding status')
  return (data as CredentialRow | null) ?? null
}

async function loadCredentialById(
  db: any,
  credentialId: string,
  tenantId: string,
  branchId: string,
): Promise<CredentialRow> {
  const { data, error } = await db.from('zatca_sandbox_credentials')
    .select('*')
    .eq('id', credentialId)
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('environment', 'sandbox')
    .maybeSingle()
  if (error || !data) throw new Error('Unable to load reconciled Sandbox onboarding status')
  return data as CredentialRow
}

async function reconcileUncertainOperation(
  db: any,
  body: RequestBody,
): Promise<Record<string, unknown>> {
  if (body.reconciliationDecision === 'revoke_and_restart_device') {
    const credential = await loadCredentialById(
      db,
      body.credentialId as string,
      body.tenantId,
      body.branchId,
    )
    if (
      credential.status === 'active' &&
      credential.onboarding_status === 'active' &&
      !credential.onboarding_operation
    ) {
      return revokeMismatchedActiveCredential(db, body, credential)
    }
  }

  const verifiedResult = body.verifiedResult ?? { resultingStatus: undefined }
  const sqlVerifiedResult = body.reconciliationDecision === 'mark_verified_success'
    ? { resulting_status: verifiedResult.resultingStatus }
    : {}
  const { data, error } = await db.rpc('reconcile_zatca_sandbox_onboarding', {
    p_credential_id: body.credentialId,
    p_tenant_id: body.tenantId,
    p_branch_id: body.branchId,
    p_expected_operation: body.expectedOperation,
    p_decision: body.reconciliationDecision,
    p_reconciled_by: body.reconciledBy,
    p_summary: body.reconciliationSummary,
    p_verified_result: sqlVerifiedResult,
  })
  if (error || !data) {
    throw new RequestError(safeReconciliationRpcError(error), 409)
  }
  const result = data as Record<string, unknown>
  return {
    operation: result.operation,
    decision: result.decision,
    reconciledAt: result.reconciled_at,
    restartRequired: result.restart_required === true,
  }
}

async function revokeMismatchedActiveCredential(
  db: any,
  body: RequestBody,
  credential: CredentialRow,
): Promise<Record<string, unknown>> {
  // A test Production CSID returned by the Integration Sandbox is not a
  // Production branch certificate. Its public key is therefore not a valid
  // reason to revoke an otherwise active Sandbox credential.
  throw new RequestError('Sandbox test-certificate key differences are not a revocation condition.', 409)
}

function safeReconciliationRpcError(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : ''
  const safeMessages = [
    'Exact reconciliation scope is required',
    'Invalid expected onboarding operation',
    'Invalid reconciliation decision',
    'A safe internal reconciler identifier is required',
    'A safe non-sensitive reconciliation summary is required',
    'Verified result must be an object',
    'Verified result contains unsupported fields',
    'Active demo Sandbox scope required',
    'Exact Sandbox onboarding record not found',
    'Locked onboarding operation does not match the reconciliation request',
    'Onboarding operation was already reconciled',
    'Verified compliance result lacks safely persisted encrypted material',
    'Verified compliance checks lack all deterministic accepted results',
    'Verified Sandbox Production result lacks safely persisted encrypted material',
    'Verified activation lacks valid persisted Sandbox credential material',
    'Verified failure does not accept result material',
    'Device revocation does not accept result material',
  ]
  return safeMessages.includes(message)
    ? message
    : 'Sandbox reconciliation was rejected without changing the operation lock.'
}

async function generateCsr(
  db: any,
  scope: Scope,
  body: RequestBody,
  existing: CredentialRow | null,
): Promise<CredentialRow> {
  if (body.functionalityMap !== '1100') {
    throw new RequestError('Canonical Sandbox onboarding requires functionality map 1100.', 400)
  }
  if (existing) {
    if (existing.functionality_map !== body.functionalityMap) {
      throw new RequestError('The existing device uses a different functionality map.', 409)
    }
    if (existing.onboarding_status === 'failed') {
      throw new RequestError('Review the failed step before continuing this onboarding record.', 409)
    }
    return existing
  }

  const identity = sellerIdentity(scope.branch, scope.tenant, body.functionalityMap)
  const missing = validateSellerIdentity(scope.branch, scope.tenant, identity.csr)
  if (missing.length > 0) {
    throw new RequestError(`Missing required seller fields: ${missing.join(', ')}`, 422)
  }

  const generated = await generateProductionCsr(identity.csr)
  const encryptedPrivateKey = await encryptText(
    generated.privateKeyPem,
    requireEnv('ZATCA_SERVER_ENCRYPTION_KEY'),
  )
  const now = new Date().toISOString()
  const { data, error } = await db.from('zatca_sandbox_credentials').insert({
    tenant_id: scope.tenant.id,
    branch_id: scope.branch.id,
    environment: 'sandbox',
    device_id: crypto.randomUUID(),
    status: 'pending',
    onboarding_status: 'csr_ready',
    last_successful_onboarding_status: 'csr_ready',
    functionality_map: body.functionalityMap,
    egs_serial_number: generated.egsSerialNumber,
    csr_common_name: identity.csr.commonName,
    csr_organization_name: identity.csr.businessName,
    csr_organizational_unit_name: identity.csr.branchName,
    csr_location: identity.csr.location,
    csr_industry: identity.csr.industry,
    csr_pem: generated.csrPem,
    public_key_pem: generated.publicKeyPem,
    encrypted_private_key: encryptedPrivateKey,
    csr_generated_at: now,
    last_safe_response: { action: 'generate_csr', completedAt: now },
  }).select('*').single()

  if (error || !data) throw new Error('Unable to persist backend-generated Sandbox CSR')
  return data as CredentialRow
}

function resolveAction(action: Action, credential: CredentialRow): RetryableAction {
  if (action === 'retry_failed_step') {
    if (credential.onboarding_status !== 'failed' || !credential.failed_step) {
      throw new RequestError('No retryable failed Sandbox onboarding step exists.', 409)
    }
    if (
      credential.last_safe_response?.restartRequired === true &&
      !isLegacySandboxCertificateBindingFailure(credential)
    ) {
      throw new RequestError('This credential cannot be retried and must be revoked before restarting onboarding.', 409)
    }
    return credential.failed_step
  }
  if (action === 'get_status' || action === 'generate_csr' || action === 'reconcile_uncertain_operation') {
    throw new RequestError('Invalid onboarding action transition', 409)
  }
  return action
}

function isLegacySandboxCertificateBindingFailure(credential: CredentialRow): boolean {
  return credential.failed_step === 'request_sandbox_production_csid' &&
    credential.last_error === SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR
}

function assertOtpForEffectiveAction(body: RequestBody, action: RetryableAction): void {
  if (action === 'request_compliance_csid') {
    if (!validateOtp(body.otp)) {
      throw new RequestError('A valid 6-digit Sandbox OTP is required.', 400)
    }
    return
  }
  if (body.otp !== undefined) {
    throw new RequestError('OTP is accepted only when retrying the compliance credential step.', 400)
  }
}

function assertActionState(action: RetryableAction, credential: CredentialRow): void {
  const current = credential.onboarding_status === 'failed'
    ? credential.last_successful_onboarding_status
    : credential.onboarding_status
  const required: Record<RetryableAction, string> = {
    request_compliance_csid: 'csr_ready',
    submit_compliance_documents: 'compliance_csid_ready',
    request_sandbox_production_csid: 'compliance_passed',
    activate: 'sandbox_production_csid_ready',
  }
  if (current !== required[action]) {
    throw new RequestError(`Unsafe state transition: ${action} requires ${required[action]}.`, 409)
  }
  if (credential.onboarding_operation) {
    throw new RequestError('An onboarding operation is already in progress and requires reconciliation.', 409)
  }
}

function isActionAlreadyComplete(action: RetryableAction, credential: CredentialRow): boolean {
  if (credential.onboarding_status === 'failed') return false
  const ranks: Record<string, number> = {
    not_started: 0,
    csr_ready: 1,
    compliance_csid_ready: 2,
    compliance_checks_pending: 2,
    compliance_passed: 3,
    sandbox_production_csid_ready: 4,
    active: 5,
  }
  const targets: Record<RetryableAction, number> = {
    request_compliance_csid: 2,
    submit_compliance_documents: 3,
    request_sandbox_production_csid: 4,
    activate: 5,
  }
  return (ranks[credential.onboarding_status] ?? -1) >= targets[action]
}

async function claimOperation(
  db: any,
  credential: CredentialRow,
  action: RetryableAction,
): Promise<CredentialRow> {
  const { data, error } = await db.from('zatca_sandbox_credentials').update({
    onboarding_operation: action,
    operation_started_at: new Date().toISOString(),
    reconciliation_status: 'not_required',
    reconciliation_decision: null,
    reconciled_at: null,
    reconciled_by: null,
    reconciliation_summary: null,
    ...(action === 'submit_compliance_documents'
      ? { onboarding_status: 'compliance_checks_pending' }
      : {}),
    last_error: null,
  })
    .eq('id', credential.id)
    .is('onboarding_operation', null)
    .select('*')
    .maybeSingle()
  if (error || !data) {
    throw new RequestError('Onboarding operation is already in progress.', 409)
  }
  return data as CredentialRow
}

async function executeClaimedAction(
  db: any,
  scope: Scope,
  body: RequestBody,
  credential: CredentialRow,
  action: RetryableAction,
): Promise<CredentialRow> {
  switch (action) {
    case 'request_compliance_csid':
      return requestComplianceCredential(db, body, credential)
    case 'submit_compliance_documents':
      return submitComplianceDocuments(db, scope, credential)
    case 'request_sandbox_production_csid':
      return requestSandboxProductionCredential(db, scope, credential)
    case 'activate':
      return activateCredential(db, scope, credential)
  }
}

async function requestComplianceCredential(
  db: any,
  body: RequestBody,
  credential: CredentialRow,
): Promise<CredentialRow> {
  const prepared = await prepareComplianceDispatchEvidence(credential)
  try {
    await persistComplianceEvidence(db, credential, prepared)
  } catch (error) {
    throw new SandboxCompliancePreDispatchError(
      'Sandbox Compliance request was not dispatched because pre-dispatch evidence could not be persisted.',
      {
        ...prepared,
        dispatch_state: 'not_dispatched',
        outcome: 'definitive_failure',
        retry_safe: true,
        response_classification: 'database_persistence_before_dispatch',
        safe_error: safeComplianceError(error, 'database_persistence_before_dispatch'),
      },
    )
  }

  if (!validateOtp(body.otp)) {
    return failBeforeComplianceDispatch(
      db,
      credential,
      prepared,
      'A valid 6-digit Sandbox OTP is required.',
      'application_validation_failure',
    )
  }
  if (!credential.csr_pem) {
    return failBeforeComplianceDispatch(
      db,
      credential,
      prepared,
      'Persisted backend CSR is missing.',
      'application_validation_failure',
    )
  }

  let successEvidence: Record<string, unknown> | null = null
  return requestSandboxComplianceCsidWithEvidence({
    endpoint: `${SANDBOX_CORE_BASE_URL}/compliance`,
    csrPem: credential.csr_pem,
    otp: body.otp,
    timeoutMs: SANDBOX_COMPLIANCE_TIMEOUT_MS,
    baseEvidence: prepared,
    onDispatching: async () => {
      await persistComplianceEvidence(db, credential, {
        ...prepared,
        dispatch_state: 'dispatching',
        dispatch_started_at: new Date().toISOString(),
        outcome: 'dispatching',
        retry_safe: false,
      })
    },
    onResponseReceived: async (response: Record<string, unknown>) => {
      await persistComplianceEvidence(db, credential, {
        ...prepared,
        ...toSnakeCaseComplianceResponse(response),
        outcome: 'response_received',
        retry_safe: false,
      })
    },
    onDefinitiveFailure: async (failure: Record<string, unknown>) => {
      await persistComplianceEvidence(db, credential, {
        ...prepared,
        ...toSnakeCaseComplianceResponse(failure),
        outcome: 'definitive_failure',
        retry_safe: true,
      })
    },
    onSuccessEvidence: async ({ body: response, evidence }: any) => {
      const certificate = await safeCertificateDiagnostics(response.binarySecurityToken)
      successEvidence = {
        ...prepared,
        ...toSnakeCaseComplianceResponse(evidence),
        outcome: 'success_response_received',
        retry_safe: false,
        safe_certificate: {
          spki_fingerprint: certificate.spkiFingerprint,
          vat_number: certificate.vatNumber,
          parse_status: certificate.parseStatus,
        },
      }
      // Request ID is not a secret. Persist it with the safe response evidence
      // before encrypting credential material so a later write failure can be
      // reconciled without issuing a duplicate upstream request.
      await persistComplianceEvidence(db, credential, successEvidence, {
        compliance_request_id: response.requestID,
      })
    },
    persistCredential: async (response: any) => {
      if (!successEvidence) throw new OperationPersistenceError()
      const secret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
      const now = new Date().toISOString()
      return updateCredential(db, credential.id, 'request_compliance_csid', {
        status: 'compliance',
        onboarding_status: 'compliance_csid_ready',
        last_successful_onboarding_status: 'compliance_csid_ready',
        compliance_request_id: response.requestID,
        encrypted_compliance_csid: await encryptText(response.binarySecurityToken, secret),
        encrypted_compliance_secret: await encryptText(response.secret, secret),
        compliance_csid_received_at: now,
        last_safe_response: {
          action: 'request_compliance_csid',
          ...successEvidence,
          outcome: 'success',
          completed_at: now,
        },
      })
    },
  })
}

async function prepareComplianceDispatchEvidence(credential: CredentialRow): Promise<Record<string, unknown>> {
  const csrFingerprint = credential.csr_pem ? await fingerprintText(credential.csr_pem) : null
  const requestFingerprint = await fingerprintText([
    'request_compliance_csid',
    credential.id,
    credential.branch_id,
    'sandbox_compliance_csid',
    csrFingerprint ?? 'missing-csr',
  ].join('|'))
  return {
    action: 'request_compliance_csid',
    credential_id: credential.id,
    branch_id: credential.branch_id,
    request_fingerprint: requestFingerprint,
    endpoint_classification: 'sandbox_compliance_csid',
    started_at: new Date().toISOString(),
    dispatch_state: 'prepared',
    outcome: 'prepared',
    retry_safe: false,
  }
}

async function persistComplianceEvidence(
  db: any,
  credential: CredentialRow,
  evidence: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { data, error } = await db.from('zatca_sandbox_credentials').update({
    ...extra,
    last_safe_response: {
      action: 'request_compliance_csid',
      evidence_version: 1,
      ...evidence,
    },
  })
    .eq('id', credential.id)
    .eq('onboarding_operation', 'request_compliance_csid')
    .select('id')
    .maybeSingle()
  if (error || !data) throw new OperationPersistenceError()
}

async function failBeforeComplianceDispatch(
  db: any,
  credential: CredentialRow,
  prepared: Record<string, unknown>,
  message: string,
  classification: string,
): Promise<never> {
  const evidence = {
    ...prepared,
    dispatch_state: 'not_dispatched',
    outcome: 'definitive_failure',
    retry_safe: true,
    response_classification: classification,
    safe_error: { class: classification, name: 'CompliancePreDispatchValidationError', message },
  }
  try {
    await persistComplianceEvidence(db, credential, evidence)
  } catch (error) {
    throw new SandboxCompliancePreDispatchError(
      'Sandbox Compliance request was not dispatched because its pre-dispatch failure could not be persisted.',
      {
        ...evidence,
        response_classification: 'database_persistence_before_dispatch',
        safe_error: safeComplianceError(error, 'database_persistence_before_dispatch'),
      },
    )
  }
  throw new SandboxCompliancePreDispatchError(message, evidence)
}

function toSnakeCaseComplianceResponse(value: Record<string, unknown>): Record<string, unknown> {
  const safeError = value.safeError
  return {
    ...(typeof value.dispatchState === 'string' ? { dispatch_state: value.dispatchState } : {}),
    ...(typeof value.upstreamHttpStatus === 'number' ? { upstream_http_status: value.upstreamHttpStatus } : {}),
    ...(typeof value.upstreamResponseReceivedAt === 'string'
      ? { upstream_response_received_at: value.upstreamResponseReceivedAt }
      : {}),
    ...(typeof value.contentType === 'string' || value.contentType === null ? { content_type: value.contentType } : {}),
    ...(value.correlationHeaders && typeof value.correlationHeaders === 'object'
      ? { correlation_headers: value.correlationHeaders }
      : {}),
    ...(typeof value.responseClassification === 'string' ? { response_classification: value.responseClassification } : {}),
    ...(typeof value.outcome === 'string' ? { outcome: value.outcome } : {}),
    ...(typeof value.retrySafe === 'boolean' ? { retry_safe: value.retrySafe } : {}),
    ...(typeof value.requestIdFingerprint === 'string' ? { request_id_fingerprint: value.requestIdFingerprint } : {}),
    ...(typeof value.dispositionMessage === 'string' || value.dispositionMessage === null
      ? { disposition_message: value.dispositionMessage }
      : {}),
    ...(value.credentialMaterial && typeof value.credentialMaterial === 'object'
      ? { credential_material: value.credentialMaterial }
      : {}),
    ...(value.upstreamError && typeof value.upstreamError === 'object' ? { upstream_error: value.upstreamError } : {}),
    ...(safeError && typeof safeError === 'object' ? { safe_error: safeError } : {}),
  }
}

function safeComplianceError(error: unknown, classification: string): Record<string, unknown> {
  return {
    class: classification,
    name: error instanceof Error ? error.name.slice(0, 120) : 'Error',
    message: safeError(error),
  }
}

async function submitComplianceDocuments(
  db: any,
  scope: Scope,
  credential: CredentialRow,
): Promise<CredentialRow> {
  const map = credential.functionality_map
  if (!map || !credential.encrypted_compliance_csid || !credential.encrypted_compliance_secret) {
    throw new Error('Persisted compliance material is incomplete')
  }
  const secret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  const privateKeyPem = await decryptText(credential.encrypted_private_key, secret)
  const complianceCsid = await decryptText(credential.encrypted_compliance_csid, secret)
  const complianceSecret = await decryptText(credential.encrypted_compliance_secret, secret)
  const identity = sellerIdentity(scope.branch, scope.tenant, map)

  // Kubri safety/completeness policy, not a claim that Version-2 Integration
  // Sandbox requires these six samples before issuing a test Production CSID.
  const results = stripComplianceSampleDebug(await submitComplianceSamples({
    baseUrl: SANDBOX_CORE_BASE_URL,
    functionalityMap: map,
    complianceCsid,
    complianceSecret,
    complianceCertificate: complianceCsid,
    privateKeyPem,
    seller: identity.seller,
  }))
  const now = new Date().toISOString()
  if (results.some(isAmbiguousComplianceResult)) {
    await recordReconciliationRequired(
      db,
      credential,
      'submit_compliance_documents',
      'One or more compliance document responses were uncertain and require manual reconciliation.',
      {
        compliance_sample_results: results,
        compliance_checked_at: now,
        last_safe_response: safeComplianceSummary(results, now),
      },
    )
    throw new ExternalReconciliationRequiredError()
  }
  if (!results.every(result => result.status === 'accepted')) {
    await updateCredential(db, credential.id, 'submit_compliance_documents', {
      onboarding_operation: null,
      operation_started_at: null,
      onboarding_status: 'failed',
      status: 'failed',
      last_successful_onboarding_status: 'compliance_csid_ready',
      failed_step: 'submit_compliance_documents',
      compliance_sample_results: results,
      compliance_checked_at: now,
      last_error: 'One or more required compliance documents were not accepted.',
      last_safe_response: safeComplianceSummary(results, now),
    })
    throw new RequestError('One or more required compliance documents were not accepted.', 422)
  }

  return updateCredential(db, credential.id, 'submit_compliance_documents', {
    status: 'compliance',
    onboarding_status: 'compliance_passed',
    last_successful_onboarding_status: 'compliance_passed',
    compliance_sample_results: results,
    compliance_checked_at: now,
    last_safe_response: safeComplianceSummary(results, now),
  })
}

async function requestSandboxProductionCredential(
  db: any,
  scope: Scope,
  credential: CredentialRow,
): Promise<CredentialRow> {
  if (
    !credential.csr_pem ||
    !credential.encrypted_private_key ||
    !credential.compliance_request_id ||
    !credential.encrypted_compliance_csid ||
    !credential.encrypted_compliance_secret
  ) {
    throw new Error('Persisted compliance credential is incomplete')
  }
  const secret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  const [privateKeyPem, complianceCsid] = await Promise.all([
    decryptText(credential.encrypted_private_key, secret),
    decryptText(credential.encrypted_compliance_csid, secret),
  ])
  const complianceSecret = await decryptText(credential.encrypted_compliance_secret, secret)
  const privateKeyDer = base64Bytes(privateKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  const complianceBinding = assessSandboxComplianceBinding({
    privateKey: extractEcPrivateKeyScalar(privateKeyDer),
    csrPem: credential.csr_pem,
    complianceCertificate: complianceCsid,
  })
  if (
    !complianceBinding.privateKeyEqualsCsr ||
    !complianceBinding.privateKeyEqualsSigningCertificate ||
    !complianceBinding.csrEqualsSigningCertificate
  ) {
    throw new RequestError('Sandbox Compliance certificate binding is invalid.', 409)
  }
  const requestEvidence = await persistSandboxProductionDispatchEvidence(db, credential)
  let responseDiagnostics: Record<string, unknown> = {}
  let response: Awaited<ReturnType<typeof requestSandboxProductionCsid>>
  try {
    response = await requestSandboxProductionCsid({
      baseUrl: SANDBOX_CORE_BASE_URL,
      complianceCsid,
      complianceSecret,
      complianceRequestId: credential.compliance_request_id,
      onResponse: trace => { responseDiagnostics = trace },
    })
  } catch (error) {
    const bindingError = new RequestError(SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR, 409)
    attachSandboxProductionEvidence(bindingError, {
      action: 'request_sandbox_production_csid',
      request: requestEvidence,
      response: {
        ...responseDiagnostics,
        classification: responseDiagnostics.classification ?? 'response_unavailable',
        returnedCredentialPresent: false,
      },
    })
    throw error
  }
  const certificateDiagnostics = await safeCertificateDiagnostics(response.certificate)
  let productionBinding: Awaited<ReturnType<typeof assessSandboxOperationalCertificate>>
  try {
    productionBinding = await assessSandboxOperationalCertificate({
      environment: credential.environment,
      privateKey: extractEcPrivateKeyScalar(privateKeyDer),
      csrPem: credential.csr_pem,
      productionCertificate: response.certificate,
      branchVat: scope.branch.vat_number,
    })
  } catch (error) {
    attachSandboxProductionEvidence(bindingError, {
      action: 'request_sandbox_production_csid',
      request: requestEvidence,
      response: {
        ...responseDiagnostics,
        returnedCredentialPresent: true,
        certificateFingerprint: certificateDiagnostics.spkiFingerprint,
        certificateVat: certificateDiagnostics.vatNumber,
        certificateParseStatus: certificateDiagnostics.parseStatus,
        classification: 'production_certificate_binding_invalid',
      },
    })
    throw bindingError
  }
  responseDiagnostics = {
    ...responseDiagnostics,
    environment: credential.environment,
    returnedCredentialPresent: true,
    certificateFingerprint: productionBinding.productionCertificateFingerprint,
    certificateSpkiFingerprint: productionBinding.productionCertificateSpkiFingerprint,
    certificateVat: certificateDiagnostics.vatNumber,
    certificateIssuer: productionBinding.productionCertificateIssuer,
    certificateValidFrom: productionBinding.productionCertificateValidFrom,
    certificateValidTo: productionBinding.productionCertificateValidTo,
    certificateParseStatus: certificateDiagnostics.parseStatus,
    operationalCredentialClassification: productionBinding.classification,
    knownMockRelease: productionBinding.knownMockRelease,
    privateKeyEqualsCsr: productionBinding.privateKeyEqualsCsr,
    privateKeyEqualsProductionCertificate: productionBinding.privateKeyEqualsProductionCertificate,
    csrEqualsProductionCertificate: productionBinding.csrEqualsProductionCertificate,
    csrVatEqualsBranch: productionBinding.csrVatEqualsBranch,
    productionCertificateVatEqualsCsr: productionBinding.productionCertificateVatEqualsCsr,
    productionCertificateVatEqualsBranch: productionBinding.productionCertificateVatEqualsBranch,
  }
  if (
    !productionBinding.privateKeyEqualsCsr ||
    !productionBinding.csrVatEqualsBranch ||
    !productionBinding.productionCertificateVatEqualsCsr ||
    !productionBinding.productionCertificateVatEqualsBranch ||
    !productionBinding.acceptsSandboxOperationalCredential
  ) {
    const bindingError = new RequestError(SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR, 409)
    attachSandboxProductionEvidence(bindingError, {
      action: 'request_sandbox_production_csid',
      request: requestEvidence,
      response: { ...responseDiagnostics, classification: 'production_certificate_binding_mismatch' },
    })
    throw bindingError
  }
  const validity = certificateValidity(response.certificate)
  const now = new Date().toISOString()
  return updateCredential(db, credential.id, 'request_sandbox_production_csid', {
    status: 'compliance',
    onboarding_status: 'sandbox_production_csid_ready',
    last_successful_onboarding_status: 'sandbox_production_csid_ready',
    encrypted_production_csid: await encryptText(response.binarySecurityToken, secret),
    encrypted_production_secret: await encryptText(response.secret, secret),
    certificate: response.certificate,
    certificate_valid_from: validity.validFrom,
    expires_at: validity.validTo,
    sandbox_production_csid_received_at: now,
    last_safe_response: {
      action: 'request_sandbox_production_csid',
      request: requestEvidence,
      response: responseDiagnostics,
      completedAt: now,
    },
  })
}

async function persistSandboxProductionDispatchEvidence(
  db: any,
  credential: CredentialRow,
): Promise<Record<string, unknown>> {
  // The exact ID remains in the credential's dedicated compliance_request_id
  // column. The event envelope stores only its fingerprint.
  const requestEvidence = {
    branchId: credential.branch_id,
    credentialId: credential.id,
    complianceRequestIdFingerprint: await fingerprintText(credential.compliance_request_id ?? ''),
    dispatchedAt: new Date().toISOString(),
    endpointClassification: 'sandbox_test_production_csid',
    operationState: 'request_sandbox_production_csid',
  }
  const { error } = await db.from('zatca_sandbox_credentials').update({
    last_safe_response: {
      action: 'request_sandbox_production_csid',
      lifecycle: 'dispatch_prepared',
      request: requestEvidence,
    },
  })
    .eq('id', credential.id)
    .eq('onboarding_operation', 'request_sandbox_production_csid')
  if (error) throw new OperationPersistenceError()
  return requestEvidence
}

function attachSandboxProductionEvidence(error: unknown, evidence: Record<string, unknown>): void {
  if (error && typeof error === 'object') Object.assign(error, { sandboxProductionEvidence: evidence })
}

function evidenceFromError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {}
  const complianceEvidence = (error as { sandboxComplianceEvidence?: unknown }).sandboxComplianceEvidence
  if (complianceEvidence && typeof complianceEvidence === 'object' && !Array.isArray(complianceEvidence)) {
    const raw = complianceEvidence as Record<string, unknown>
    return {
      last_safe_response: {
        action: 'request_compliance_csid',
        ...raw,
        ...toSnakeCaseComplianceResponse(raw),
        ...(typeof raw.retrySafe === 'boolean' ? { retry_safe: raw.retrySafe } : {}),
      },
    }
  }
  const evidence = (error as { sandboxProductionEvidence?: unknown }).sandboxProductionEvidence
  return evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    ? { last_safe_response: evidence as Record<string, unknown> }
    : {}
}

async function fingerprintText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function fingerprintSpki(spki: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', spki)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function safeCertificateDiagnostics(certificate: string): Promise<{
  spkiFingerprint: string | null
  vatNumber: string | null
  parseStatus: 'valid' | 'invalid'
}> {
  try {
    const spki = productionCertificatePublicKeySpki(certificate)
    return {
      spkiFingerprint: await fingerprintSpki(spki),
      vatNumber: certificateVatNumber(certificate),
      parseStatus: 'valid',
    }
  } catch {
    return { spkiFingerprint: null, vatNumber: null, parseStatus: 'invalid' }
  }
}

async function requestSandboxProductionCsid(params: {
  baseUrl: string
  complianceCsid: string
  complianceSecret: string
  complianceRequestId: string
  onResponse: (trace: Record<string, unknown>) => void
}): Promise<{
  binarySecurityToken: string
  secret: string
  certificate: string
  certificateShape: Record<string, unknown>
}> {
  const credentials = btoa(`${params.complianceCsid}:${params.complianceSecret}`)
  let res: Response
  try {
    res = await fetch(`${params.baseUrl}/production/csids`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-version': 'V2',
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
        currentCCSID: params.complianceCsid,
      },
      body: JSON.stringify({ compliance_request_id: params.complianceRequestId }),
      signal: AbortSignal.timeout(SANDBOX_PRODUCTION_CSID_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new SandboxProductionCsidTimeoutError()
    throw error
  }
  const receivedAt = new Date().toISOString()
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch {
    params.onResponse({ upstreamHttpStatus: res.status, receivedAt, classification: 'non_json_response' })
    throw new Error(`Sandbox Production response was not JSON (${res.status})`)
  }
  if (!res.ok) {
    params.onResponse({ upstreamHttpStatus: res.status, receivedAt, classification: 'http_rejected' })
    const message = body?.errors?.[0]?.message ?? body?.message ?? body?.error
    throw new ZatcaHttpError(typeof message === 'string' && message.length <= 240 ? message : `Sandbox Production request failed (${res.status})`, res.status)
  }
  if (!body?.binarySecurityToken || !body?.secret) {
    params.onResponse({ upstreamHttpStatus: res.status, receivedAt, classification: 'credential_material_incomplete' })
    throw new Error('Sandbox Production response was missing required fields')
  }
  const responseFields = Object.keys(body).filter(key => !/secret|token|csid|certificate|authorization/i.test(key))
  // Swagger defines binarySecurityToken as the issued Production CSID. It is
  // the exact Sandbox Reporting/Clearance Basic-auth credential; final XML
  // signing remains on the generated private key plus Compliance certificate.
  const certificateField = 'binarySecurityToken'
  const certificate = body.binarySecurityToken
  if (typeof certificate !== 'string' || !certificate.trim()) throw new Error('Sandbox Production response was missing a certificate field')
  params.onResponse({ upstreamHttpStatus: res.status, receivedAt, classification: 'credential_material_returned', responseFields, certificateField })
  return { binarySecurityToken: body.binarySecurityToken, secret: body.secret, certificate, certificateShape: inspectZatcaCertificate(certificate) }
}

async function activateCredential(db: any, scope: Scope, credential: CredentialRow): Promise<CredentialRow> {
  if (
    !credential.csr_pem ||
    !credential.encrypted_private_key ||
    !credential.encrypted_compliance_csid ||
    !credential.encrypted_production_csid ||
    !credential.encrypted_production_secret ||
    !credential.certificate
  ) {
    throw new Error('Sandbox Production credential material is incomplete')
  }
  if (credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now()) {
    throw new RequestError('Sandbox credential has expired and cannot be activated.', 409)
  }
  const encryptionSecret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  const decryptedValues = await Promise.all([
    decryptText(credential.encrypted_private_key, encryptionSecret),
    decryptText(credential.encrypted_compliance_csid, encryptionSecret),
    decryptText(credential.encrypted_production_csid, encryptionSecret),
    decryptText(credential.encrypted_production_secret, encryptionSecret),
  ])
  if (decryptedValues.some(value => !value.trim())) {
    throw new Error('Sandbox credential validation failed')
  }
  const privateKeyDer = base64Bytes(decryptedValues[0].replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  const privateKey = extractEcPrivateKeyScalar(privateKeyDer)
  const complianceBinding = assessSandboxComplianceBinding({
    privateKey,
    csrPem: credential.csr_pem,
    complianceCertificate: decryptedValues[1],
  })
  const productionBinding = await assessSandboxOperationalCertificate({
    environment: credential.environment,
    privateKey,
    csrPem: credential.csr_pem,
    productionCertificate: credential.certificate,
    branchVat: scope.branch.vat_number,
  })
  if (
    !complianceBinding.privateKeyEqualsCsr ||
    !complianceBinding.privateKeyEqualsSigningCertificate ||
    !complianceBinding.csrEqualsSigningCertificate ||
    !productionBinding.privateKeyEqualsCsr ||
    !productionBinding.csrVatEqualsBranch ||
    !productionBinding.productionCertificateVatEqualsCsr ||
    !productionBinding.productionCertificateVatEqualsBranch ||
    !productionBinding.acceptsSandboxOperationalCredential
  ) {
    throw new RequestError('Sandbox Production certificate does not satisfy the CSR/key/VAT binding.', 409)
  }
  const now = new Date().toISOString()
  return updateCredential(db, credential.id, 'activate', {
    status: 'active',
    onboarding_status: 'active',
    last_successful_onboarding_status: 'active',
    activated_at: now,
    last_safe_response: {
      action: 'activate',
      completedAt: now,
      operationalCredential: safeOperationalCredentialEvidence(productionBinding),
    },
  })
}

function safeOperationalCredentialEvidence(binding: Awaited<ReturnType<typeof assessSandboxOperationalCertificate>>): Record<string, unknown> {
  return {
    environment: binding.environment,
    classification: binding.classification,
    knownMockRelease: binding.knownMockRelease,
    certificateFingerprint: binding.productionCertificateFingerprint,
    certificateSpkiFingerprint: binding.productionCertificateSpkiFingerprint,
    certificateVat: binding.productionCertificateVat,
    certificateIssuer: binding.productionCertificateIssuer,
    certificateValidFrom: binding.productionCertificateValidFrom,
    certificateValidTo: binding.productionCertificateValidTo,
    vatParity: binding.vatParity,
    operationalKeyMatchesCsr: binding.operationalKeyMatchesCsr,
  }
}

async function updateCredential(
  db: any,
  id: string,
  claimedAction: RetryableAction,
  update: Record<string, unknown>,
): Promise<CredentialRow> {
  const values = {
    onboarding_operation: null,
    operation_started_at: null,
    failed_step: null,
    last_error: null,
    ...update,
  }
  const { data, error } = await db.from('zatca_sandbox_credentials')
    .update(values)
    .eq('id', id)
    .eq('onboarding_operation', claimedAction)
    .select('*')
    .maybeSingle()
  if (error || !data) throw new OperationPersistenceError()
  return data as CredentialRow
}

async function markFailed(
  db: any,
  credential: CredentialRow,
  action: RetryableAction,
  message: string,
  cause: unknown,
): Promise<void> {
  const prior = credential.onboarding_status === 'failed'
    ? credential.last_successful_onboarding_status
    : successfulStateBefore(action)
  const { error } = await db.from('zatca_sandbox_credentials').update({
    status: 'failed',
    onboarding_status: 'failed',
    last_successful_onboarding_status: prior,
    failed_step: action,
    onboarding_operation: null,
    operation_started_at: null,
    last_error: message,
    last_safe_response: {
      action,
      failedAt: new Date().toISOString(),
      ...(isZatcaHttpError(cause) ? { httpStatus: cause.httpStatus } : {}),
    },
    ...evidenceFromError(cause),
  }).eq('id', credential.id).eq('onboarding_operation', action)
  if (error) console.error('[zatca-onboard-sandbox-demo] safe failure status persistence failed')
}

async function recordReconciliationRequired(
  db: any,
  credential: CredentialRow,
  action: RetryableAction,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const { last_safe_response: suppliedSafeResponse, ...remainingExtra } = extra
  const { error } = await db.from('zatca_sandbox_credentials').update({
    last_error: message,
    last_safe_response: {
      action,
      outcome: 'unknown',
      uncertainAt: new Date().toISOString(),
      ...(suppliedSafeResponse && typeof suppliedSafeResponse === 'object'
        ? suppliedSafeResponse as Record<string, unknown>
        : {}),
    },
    reconciliation_status: 'required',
    reconciliation_decision: null,
    reconciled_at: null,
    reconciled_by: null,
    reconciliation_summary: null,
    ...remainingExtra,
  }).eq('id', credential.id).eq('onboarding_operation', action)
  if (error) console.error('[zatca-onboard-sandbox-demo] reconciliation status persistence failed')
}

function successfulStateBefore(action: RetryableAction): CredentialRow['last_successful_onboarding_status'] {
  return {
    request_compliance_csid: 'csr_ready',
    submit_compliance_documents: 'compliance_csid_ready',
    request_sandbox_production_csid: 'compliance_passed',
    activate: 'sandbox_production_csid_ready',
  }[action] as CredentialRow['last_successful_onboarding_status']
}

function requiresExternalReconciliation(action: RetryableAction, error: unknown): boolean {
  if (action === 'activate') return false
  if (action === 'request_compliance_csid' && isSandboxComplianceRequestError(error)) {
    return (error as { requiresReconciliation?: unknown }).requiresReconciliation === true
  }
  if (error instanceof SandboxCompliancePreDispatchError) return false
  if (action === 'request_sandbox_production_csid' && error instanceof SandboxProductionCsidTimeoutError) return true
  if (isZatcaHttpError(error)) return error.httpStatus >= 500
  return !(error instanceof RequestError)
}

async function reconcileStaleOperation(db: any, credential: CredentialRow): Promise<CredentialRow> {
  const operation = credential.onboarding_operation
  if (!operation) return credential

  const startedAt = credential.operation_started_at ? new Date(credential.operation_started_at).getTime() : 0
  if (startedAt > 0 && Date.now() - startedAt < STALE_ONBOARDING_OPERATION_MS) return credential

  const complianceBindingVerified = operation === 'request_compliance_csid'
    ? await hasValidPersistedComplianceBinding(credential)
    : false
  const disposition = classifyStaleSandboxOperation({
    operation,
    reconciliationStatus: credential.reconciliation_status,
    hasComplianceRequestId: !!credential.compliance_request_id,
    hasComplianceCsid: !!credential.encrypted_compliance_csid,
    hasComplianceSecret: !!credential.encrypted_compliance_secret,
    complianceBindingVerified,
  })

  if (disposition === 'blocked') {
    // Preserve the lock for an upstream result that cannot be proved from the
    // durable record.  The status response surfaces a safe actionable message
    // and deliberately does not offer a duplicate Compliance request.
    return credential
  }

  const decision: ReconciliationDecision = disposition === 'passed'
    ? 'mark_verified_success'
    : 'mark_verified_failure'
  const summary = disposition === 'passed'
    ? 'Persisted result was verified after a stale operation lock.'
    : 'Stale operation had no persisted success result; retry is safe.'
  const verifiedResult = disposition === 'passed'
    ? { resulting_status: 'compliance_csid_ready' }
    : {}
  const { error } = await db.rpc('reconcile_zatca_sandbox_onboarding', {
    p_credential_id: credential.id,
    p_tenant_id: credential.tenant_id,
    p_branch_id: credential.branch_id,
    p_expected_operation: operation,
    p_decision: decision,
    p_reconciled_by: 'sandbox-stale-operation-recovery',
    p_summary: summary,
    p_verified_result: verifiedResult,
  })
  if (error) {
    throw new RequestError(
      'Sandbox stale-operation recovery was not applied; no retry has been issued.',
      409,
    )
  }
  return loadCredentialById(db, credential.id, credential.tenant_id, credential.branch_id)
}

async function hasValidPersistedComplianceBinding(credential: CredentialRow): Promise<boolean> {
  if (
    !credential.csr_pem ||
    !credential.encrypted_private_key ||
    !credential.compliance_request_id ||
    !credential.encrypted_compliance_csid ||
    !credential.encrypted_compliance_secret
  ) return false

  try {
    const encryptionSecret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
    const [privateKeyPem, complianceCertificate] = await Promise.all([
      decryptText(credential.encrypted_private_key, encryptionSecret),
      decryptText(credential.encrypted_compliance_csid, encryptionSecret),
    ])
    const privateKeyDer = base64Bytes(
      privateKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
    )
    const binding = assessSandboxComplianceBinding({
      privateKey: extractEcPrivateKeyScalar(privateKeyDer),
      csrPem: credential.csr_pem,
      complianceCertificate,
    })
    return binding.privateKeyEqualsCsr &&
      binding.privateKeyEqualsSigningCertificate &&
      binding.csrEqualsSigningCertificate
  } catch {
    return false
  }
}

function isAmbiguousComplianceResult(result: ComplianceSampleResult): boolean {
  return result.status === 'ambiguous_failed' ||
    result.statusString === 'NON_JSON_RESPONSE' ||
    result.statusString === 'COMPLIANCE_SAMPLE_SUBMISSION_FAILED'
}

function sellerIdentity(branch: any, tenant: any, map: FunctionalityMap): { csr: CsrParams; seller: SampleSeller } {
  const location = [
    branch.building_number,
    branch.street,
    branch.district,
    branch.city,
    branch.postal_code,
    branch.country,
  ].filter(valuePresent).join(', ')
  const csr: CsrParams = {
    branchId: branch.id,
    commonName: cleanString(branch.business_name),
    branchName: cleanString(branch.name),
    businessName: cleanString(branch.business_name),
    vatNumber: cleanString(branch.vat_number),
    functionalityMap: map,
    location,
    industry: cleanString(tenant.business_type),
  }
  return {
    csr,
    seller: {
      name: csr.businessName,
      vatNumber: csr.vatNumber,
      crNumber: cleanString(branch.cr_number),
      street: cleanString(branch.street),
      buildingNumber: cleanString(branch.building_number),
      district: cleanString(branch.district),
      city: cleanString(branch.city),
      postalCode: cleanString(branch.postal_code),
      countryCode: cleanString(branch.country),
    },
  }
}

function validateSellerIdentity(branch: any, tenant: any, csr: CsrParams): string[] {
  const missing = new Set(validateCsrInputs(csr))
  if (!cleanString(branch.business_name)) missing.add('legal seller name')
  if (!/^3\d{13}3$/.test(cleanString(branch.vat_number))) missing.add('valid VAT number')
  if (!cleanString(branch.cr_number)) missing.add('CR/license identifier')
  if (!/^\d{4}$/.test(cleanString(branch.building_number))) missing.add('4-digit building number')
  if (!cleanString(branch.street)) missing.add('street')
  if (!cleanString(branch.district)) missing.add('district')
  if (!cleanString(branch.city)) missing.add('city')
  if (!/^\d{5}$/.test(cleanString(branch.postal_code))) missing.add('5-digit postal code')
  if (!/^[A-Za-z]{2}$/.test(cleanString(branch.country))) missing.add('2-letter country code')
  if (!cleanString(branch.name)) missing.add('branch name')
  if (!cleanString(tenant.business_type)) missing.add('seller industry/business type')
  if ((branch.zatca_phase ?? 1) < 2) missing.add('ZATCA Phase 2 branch setting')
  return [...missing]
}

function assertSellerIdentityUnchanged(scope: Scope, credential: CredentialRow): void {
  if (!credential.functionality_map) throw new RequestError('Stored functionality map is missing.', 409)
  const identity = sellerIdentity(scope.branch, scope.tenant, credential.functionality_map)
  const missing = validateSellerIdentity(scope.branch, scope.tenant, identity.csr)
  if (missing.length > 0) {
    throw new RequestError(`Missing required seller fields: ${missing.join(', ')}`, 422)
  }
  const expectedEgs = `1-Meem|2-POS|3-${scope.branch.id}`
  if (
    credential.csr_common_name !== identity.csr.commonName ||
    credential.csr_organization_name !== identity.csr.businessName ||
    credential.csr_organizational_unit_name !== identity.csr.branchName ||
    credential.csr_location !== identity.csr.location ||
    credential.csr_industry !== identity.csr.industry ||
    credential.egs_serial_number !== expectedEgs
  ) {
    throw new RequestError(
      'Seller or device identity changed after CSR generation; onboarding cannot continue with mismatched identity.',
      409,
    )
  }
}

function extractCsrPointSpki(csrPem: string): Uint8Array {
  const der = pemOrBase64Der(csrPem, 'CERTIFICATE REQUEST')
  const root = derNode(der, 0)
  const cri = derNode(der, root.contentStart)
  const version = derNode(der, cri.contentStart)
  const subject = derNode(der, version.next)
  const spki = derNode(der, subject.next)
  const algorithm = derNode(der, spki.contentStart)
  const algorithmOid = readOidFromNode(der, derNode(der, algorithm.contentStart))
  const curveOid = readOidFromNode(der, derNode(der, derNode(der, algorithm.contentStart).next))
  const bitString = derNode(der, algorithm.next)
  if (algorithmOid !== '1.2.840.10045.2.1' || curveOid !== '1.3.132.0.10' || bitString.tag !== 0x03 || der[bitString.contentStart] !== 0) {
    throw new Error('CSR SPKI algorithm invalid')
  }
  const point = der.slice(bitString.contentStart + 1, bitString.end)
  return ecPointToSpki(secp256k1.Point.fromBytes(point).toBytes(false))
}

function readOidFromNode(bytes: Uint8Array, node: { tag: number; contentStart: number; end: number }): string | null {
  if (node.tag !== 0x06 || node.contentStart >= node.end) return null
  const first = bytes[node.contentStart]
  const values = [Math.min(2, Math.floor(first / 40)), first - Math.min(2, Math.floor(first / 40)) * 40]
  let value = 0
  for (let index = node.contentStart + 1; index < node.end; index++) {
    value = (value << 7) | (bytes[index] & 0x7f)
    if ((bytes[index] & 0x80) === 0) {
      values.push(value)
      value = 0
    }
  }
  return value === 0 ? values.join('.') : null
}

async function safeStatus(branchId: string, credential: CredentialRow | null): Promise<Record<string, unknown>> {
  if (!credential) {
    return {
      branchId,
      environment: 'sandbox',
      status: 'not_started',
      completedSteps: [],
      certificateExists: false,
      complianceCredentialExists: false,
      sandboxProductionCredentialExists: false,
      credentialDiagnostics: null,
    }
  }
  const expired = !!credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now()
  const status = expired
    ? 'expired'
    : credential.status === 'revoked'
      ? 'revoked'
      : credential.onboarding_status
  return {
    branchId: credential.branch_id,
    deviceId: credential.device_id,
    environment: 'sandbox',
    status,
    functionalityMap: credential.functionality_map,
    completedSteps: completedSteps(credential),
    requiredComplianceDocuments: credential.functionality_map
      ? requiredComplianceSamples(credential.functionality_map)
      : [],
    complianceSamplePolicy: 'kubri_safety_completeness',
    certificateExists: !!credential.certificate,
    publicKeyExists: !!credential.public_key_pem,
    complianceCredentialExists: !!credential.encrypted_compliance_csid && !!credential.encrypted_compliance_secret,
    sandboxProductionCredentialExists: !!credential.encrypted_production_csid && !!credential.encrypted_production_secret,
    complianceSampleResults: Array.isArray(credential.compliance_sample_results)
      ? credential.compliance_sample_results.map((sample: any) => ({
        type: sample?.type,
        status: sample?.status,
        httpStatus: typeof sample?.httpStatus === 'number' ? sample.httpStatus : undefined,
        warningsCount: Number(sample?.warningsCount ?? 0),
        errorsCount: Number(sample?.errorsCount ?? 0),
      }))
      : [],
    expiresAt: credential.expires_at,
    lastError: staleComplianceOutcomeIsUnresolved(credential)
      ? 'Compliance CSID outcome is unresolved. Do not retry until it is verified.'
      : credential.last_error === SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR
      ? SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR
      : credential.last_error ? safeError(credential.last_error) : null,
    failedStep: credential.failed_step,
    operationInProgress: credential.onboarding_operation,
    operationStartedAt: credential.operation_started_at,
    reconciliationStatus: credential.reconciliation_status,
    reconciliationDecision: credential.reconciliation_decision,
    reconciledAt: credential.reconciled_at,
    restartRequired: credential.reconciliation_decision === 'revoke_and_restart_device' ||
      credential.last_safe_response?.restartRequired === true,
    activatedAt: credential.activated_at,
    updatedAt: credential.updated_at,
    complianceOperationDiagnostics: safeComplianceOperationDiagnostics(credential),
    operationalCredentialDiagnostics: safeOperationalCredentialDiagnostics(credential),
    credentialDiagnostics: await sandboxCredentialDiagnostics(credential),
  }
}

function safeOperationalCredentialDiagnostics(credential: CredentialRow): Record<string, unknown> | null {
  const evidence = credential.last_safe_response
  const source = evidence?.action === 'request_sandbox_production_csid'
    ? evidence.response
    : evidence?.action === 'activate'
      ? evidence.operationalCredential
      : null
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  const values = source as Record<string, unknown>
  const knownText = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9 ._:/=+()\-]{1,480}$/.test(value) &&
    !/(otp|secret|token|private[ _-]?key|authorization|csr|xml)/i.test(value)
    ? value
    : null
  return {
    operationalCredential: knownText(values.operationalCredentialClassification ?? values.classification),
    knownMockRelease: knownText(values.knownMockRelease),
    environment: knownText(values.environment),
    signingCredential: 'compliance_certificate',
    submissionVerified: false,
    certificateFingerprint: knownText(values.certificateFingerprint),
    certificateSpkiFingerprint: knownText(values.certificateSpkiFingerprint),
    certificateVat: knownText(values.certificateVat),
    certificateIssuer: knownText(values.certificateIssuer),
    certificateValidFrom: knownText(values.certificateValidFrom),
    certificateValidTo: knownText(values.certificateValidTo),
  }
}

function safeComplianceOperationDiagnostics(credential: CredentialRow): Record<string, unknown> | null {
  const evidence = credential.last_safe_response
  if (evidence?.action !== 'request_compliance_csid') return null
  const integer = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null
  const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : null
  const knownText = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9 ._:/=-]{1,240}$/.test(value) &&
    !/(otp|secret|csid|token|certificate|private[ _-]?key|authorization|csr|xml)/i.test(value)
    ? value
    : null
  const outcome = knownText(evidence.outcome)
  const dispatchState = knownText(evidence.dispatch_state)
  const responseClassification = knownText(evidence.response_classification)
  const correlationHeaders = evidence.correlation_headers && typeof evidence.correlation_headers === 'object' &&
    !Array.isArray(evidence.correlation_headers)
    ? Object.fromEntries(Object.entries(evidence.correlation_headers as Record<string, unknown>)
      .filter(([name, value]) => /^(x-request-id|x-correlation-id|request-id|traceparent)$/.test(name) &&
        typeof value === 'string' && /^[A-Za-z0-9._:/=-]{1,256}$/.test(value)))
    : {}
  const material = evidence.credential_material && typeof evidence.credential_material === 'object' &&
    !Array.isArray(evidence.credential_material)
    ? Object.fromEntries(['binarySecurityToken', 'secret', 'requestID'].map(key => [
      key,
      (evidence.credential_material as Record<string, unknown>)[key] === true,
    ]))
    : null
  const safeError = evidence.safe_error && typeof evidence.safe_error === 'object' && !Array.isArray(evidence.safe_error)
    ? Object.fromEntries(Object.entries(evidence.safe_error as Record<string, unknown>)
      .map(([key, value]) => [key, knownText(value)])
      .filter(([, value]) => value !== null))
    : null
  const upstreamError = evidence.upstream_error && typeof evidence.upstream_error === 'object' && !Array.isArray(evidence.upstream_error)
    ? Object.fromEntries(Object.entries(evidence.upstream_error as Record<string, unknown>)
      .map(([key, value]) => [key, knownText(value)])
      .filter(([, value]) => value !== null))
    : null
  return {
    stage: dispatchState,
    dispatchState,
    outcomeClass: outcome,
    retrySafe: evidence.retry_safe === true,
    endpointClassification: knownText(evidence.endpoint_classification),
    requestFingerprint: knownText(evidence.request_fingerprint),
    startedAt: timestamp(evidence.started_at),
    dispatchStartedAt: timestamp(evidence.dispatch_started_at),
    upstreamHttpStatus: integer(evidence.upstream_http_status),
    upstreamResponseReceivedAt: timestamp(evidence.upstream_response_received_at),
    contentType: knownText(evidence.content_type),
    correlationHeaders,
    responseClassification,
    requestIdFingerprint: knownText(evidence.request_id_fingerprint),
    dispositionMessage: knownText(evidence.disposition_message),
    credentialMaterial: material,
    upstreamError,
    safeError,
    reconciliationStatus: credential.reconciliation_status,
  }
}

async function sandboxCredentialDiagnostics(credential: CredentialRow): Promise<Record<string, unknown>> {
  const diagnostics: Record<string, unknown> = {
    branchId: credential.branch_id,
    environment: credential.environment,
    profile: credential.functionality_map,
    lifecycleStatus: credential.onboarding_status,
    complianceRequestIdFingerprint: credential.compliance_request_id
      ? await fingerprintText(credential.compliance_request_id)
      : null,
    privateKeySpkiFingerprint: null,
    csrSpkiFingerprint: null,
    complianceCertificateSpkiFingerprint: null,
    complianceCertificateVat: null,
    operationalCertificateSpkiFingerprint: null,
    operationalCertificateVat: null,
    diagnosticsStatus: 'unavailable',
  }
  try {
    if (credential.csr_pem) {
      diagnostics.csrSpkiFingerprint = await fingerprintSpki(csrPublicKeySpki(credential.csr_pem))
    }
    if (credential.certificate) {
      const operational = await safeCertificateDiagnostics(credential.certificate)
      diagnostics.operationalCertificateSpkiFingerprint = operational.spkiFingerprint
      diagnostics.operationalCertificateVat = operational.vatNumber
    }
    const encryptionSecret = Deno.env.get('ZATCA_SERVER_ENCRYPTION_KEY')
    if (!encryptionSecret || !credential.encrypted_private_key) return diagnostics
    const privatePem = await decryptText(credential.encrypted_private_key, encryptionSecret)
    const privateDer = base64Bytes(privatePem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
    const privateScalar = extractEcPrivateKeyScalar(privateDer)
    diagnostics.privateKeySpkiFingerprint = await fingerprintSpki(ecPointToSpki(secp256k1.getPublicKey(privateScalar, false)))
    if (credential.encrypted_compliance_csid) {
      const complianceCertificate = await decryptText(credential.encrypted_compliance_csid, encryptionSecret)
      const compliance = await safeCertificateDiagnostics(complianceCertificate)
      diagnostics.complianceCertificateSpkiFingerprint = compliance.spkiFingerprint
      diagnostics.complianceCertificateVat = compliance.vatNumber
    }
    diagnostics.diagnosticsStatus = 'available'
    return diagnostics
  } catch {
    diagnostics.diagnosticsStatus = 'partial'
    return diagnostics
  }
}

function staleComplianceOutcomeIsUnresolved(credential: CredentialRow): boolean {
  if (credential.onboarding_operation !== 'request_compliance_csid') return false
  const startedAt = credential.operation_started_at ? new Date(credential.operation_started_at).getTime() : 0
  return startedAt > 0 &&
    Date.now() - startedAt >= STALE_ONBOARDING_OPERATION_MS &&
    classifyStaleSandboxOperation({
      operation: credential.onboarding_operation,
      reconciliationStatus: credential.reconciliation_status,
      hasComplianceRequestId: !!credential.compliance_request_id,
      hasComplianceCsid: !!credential.encrypted_compliance_csid,
      hasComplianceSecret: !!credential.encrypted_compliance_secret,
    }) === 'blocked'
}

function completedSteps(credential: CredentialRow): string[] {
  const state = credential.onboarding_status === 'failed'
    ? credential.last_successful_onboarding_status
    : credential.onboarding_status
  const rank: Record<string, number> = {
    not_started: 0,
    csr_ready: 1,
    compliance_csid_ready: 2,
    compliance_checks_pending: 2,
    compliance_passed: 3,
    sandbox_production_csid_ready: 4,
    active: 5,
  }
  return [
    'generate_csr',
    'request_compliance_csid',
    'submit_compliance_documents',
    'request_sandbox_production_csid',
    'activate',
  ].slice(0, rank[state] ?? 0)
}

function safeComplianceSummary(results: ComplianceSampleResult[], completedAt: string): Record<string, unknown> {
  return {
    action: 'submit_compliance_documents',
    completedAt,
    samples: results.map(result => ({
      type: result.type,
      status: result.status,
      httpStatus: result.httpStatus,
      statusString: safeLogText(result.statusString),
      warningsCount: result.warningsCount ?? 0,
      errorsCount: result.errorsCount ?? 0,
    })),
  }
}

async function decryptText(stored: string, secret: string): Promise<string> {
  const [version, ivBase64, cipherBase64] = stored.split(':')
  if (version !== 'v1' || !ivBase64 || !cipherBase64) throw new Error('Invalid encrypted credential envelope')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64Bytes(ivBase64) },
    key,
    base64Bytes(cipherBase64),
  )
  return new TextDecoder().decode(plaintext)
}

async function compareSandboxProductionKey(
  privateKeyPem: string,
  csrPem: string | null,
  certificateToken: string,
): Promise<{ matches: boolean; diagnostics: Record<string, unknown> }> {
  try {
    const privateKeyDer = base64Bytes(
      privateKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
    )
    const privateScalar = extractEcPrivateKeyScalar(privateKeyDer)
    const privateSpki = ecPointToSpki(secp256k1.getPublicKey(privateScalar, false))
    let csrSpki: Uint8Array | null = null
    let csrParseFallback = false
    if (csrPem) {
      try {
        csrSpki = csrPublicKeySpki(csrPem)
      } catch {
        csrSpki = extractCsrPointSpki(csrPem)
        csrParseFallback = true
      }
    }
    const certificate = certificatePublicKeySpki(certificateToken)
    const [privateFingerprint, csrFingerprint, certificateFingerprint] = await Promise.all([
      fingerprint(privateSpki),
      csrSpki ? fingerprint(csrSpki) : Promise.resolve(null),
      fingerprint(certificate.spki),
    ])
    return {
      matches: equalByteArrays(privateSpki, certificate.spki),
      diagnostics: {
        privateKeyFingerprintPrefix: privateFingerprint.slice(0, 12),
        csrFingerprintPrefix: csrFingerprint?.slice(0, 12) ?? null,
        complianceCertificateMatch: null,
        certificateFingerprintPrefix: certificateFingerprint.slice(0, 12),
        privateKeyCsrMatch: csrSpki ? equalByteArrays(privateSpki, csrSpki) : null,
        privateKeyProductionMatch: equalByteArrays(privateSpki, certificate.spki),
        csrParseFallback,
        certificateParsed: true,
        certificateAlgorithm: certificate.algorithm,
        certificateCurve: certificate.curve,
        certificateChainPresent: certificate.chainPresent,
      },
    }
  } catch (error) {
    return {
      matches: false,
      diagnostics: {
        certificateParsed: false,
        parseFailure: error instanceof Error ? error.message.slice(0, 120) : 'certificate parse failed',
      },
    }
  }
}

async function fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function certificatePublicKeySpki(token: string): {
  spki: Uint8Array
  algorithm: string
  curve: string
  chainPresent: boolean
} {
  const der = certificateDer(token)
  const certificate = derNode(der, 0)
  if (certificate.tag !== 0x30) throw new Error('Invalid X.509 certificate')
  const tbs = derNode(der, certificate.contentStart)
  if (tbs.tag !== 0x30) throw new Error('Invalid X.509 certificate')

  let offset = tbs.contentStart
  let node = derNode(der, offset)
  if (node.tag === 0xa0) {
    offset = node.next
    node = derNode(der, offset)
  }
  offset = node.next // serial number
  offset = derNode(der, offset).next // signature algorithm
  offset = derNode(der, offset).next // issuer
  offset = derNode(der, offset).next // validity
  offset = derNode(der, offset).next // subject
  const spki = derNode(der, offset)
  if (spki.tag !== 0x30) throw new Error('Invalid X.509 SubjectPublicKeyInfo')

  const algorithm = derNode(der, spki.contentStart)
  const algorithmBytes = der.slice(algorithm.contentStart, algorithm.end)
  const secp256k1Oid = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  if (!containsBytes(algorithmBytes, secp256k1Oid)) throw new Error('Certificate curve is not secp256k1')

  const subjectPublicKey = derNode(der, algorithm.next)
  if (subjectPublicKey.tag !== 0x03 || der[subjectPublicKey.contentStart] !== 0x00) {
    throw new Error('Invalid X.509 public key')
  }
  const encodedPoint = der.slice(subjectPublicKey.contentStart + 1, subjectPublicKey.end)
  return {
    spki: ecPointToSpki(secp256k1.Point.fromBytes(encodedPoint).toBytes(false)),
    algorithm: 'EC',
    curve: 'secp256k1',
    chainPresent: certificate.next < der.length,
  }
}

function csrPublicKeySpki(csrPem: string): Uint8Array {
  const der = pemOrBase64Der(csrPem, 'CERTIFICATE REQUEST')
  const csr = derNode(der, 0)
  if (csr.tag !== 0x30) throw new Error('Invalid CSR')
  const version = derNode(der, csr.contentStart)
  const subject = derNode(der, version.next)
  const spki = derNode(der, subject.next)
  return canonicalSpki(spkiDer(der, spki))
}

function canonicalSpki(spki: Uint8Array): Uint8Array {
  const node = derNode(spki, 0)
  const algorithm = derNode(spki, node.contentStart)
  const subjectPublicKey = derNode(spki, algorithm.next)
  if (algorithm.tag !== 0x30 || subjectPublicKey.tag !== 0x03 || spki[subjectPublicKey.contentStart] !== 0) {
    throw new Error('Invalid EC SPKI')
  }
  const point = secp256k1.Point.fromBytes(spki.slice(subjectPublicKey.contentStart + 1, subjectPublicKey.end)).toBytes(false)
  return ecPointToSpki(point)
}

function spkiDer(bytes: Uint8Array, node: { start: number; tag: number; contentStart: number; end: number }): Uint8Array {
  return bytes.slice(node.start, node.end)
}

function ecPointToSpki(point: Uint8Array): Uint8Array {
  const oidEc = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidCurve = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algContent = new Uint8Array([...oidEc, ...oidCurve])
  const alg = new Uint8Array([0x30, algContent.length, ...algContent])
  const bitContent = new Uint8Array([0, ...point])
  const bit = new Uint8Array([0x03, bitContent.length, ...bitContent])
  const content = new Uint8Array([...alg, ...bit])
  return new Uint8Array([0x30, content.length, ...content])
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== 65 || right.length !== 65) return false
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i]
  return difference === 0
}

function equalByteArrays(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i]
  return difference === 0
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

function certificateValidity(token: string): { validFrom: string | null; validTo: string | null } {
  try {
    const der = certificateDer(token)
    const certificate = derNode(der, 0)
    const tbs = derNode(der, certificate.contentStart)
    let offset = tbs.contentStart
    let node = derNode(der, offset)
    if (node.tag === 0xa0) {
      offset = node.next
      node = derNode(der, offset)
    }
    offset = node.next // serial number
    offset = derNode(der, offset).next // signature algorithm
    offset = derNode(der, offset).next // issuer
    const validity = derNode(der, offset)
    const notBefore = derNode(der, validity.contentStart)
    const notAfter = derNode(der, notBefore.next)
    return {
      validFrom: parseAsn1Time(new TextDecoder().decode(der.slice(notBefore.contentStart, notBefore.end))),
      validTo: parseAsn1Time(new TextDecoder().decode(der.slice(notAfter.contentStart, notAfter.end))),
    }
  } catch {
    return { validFrom: null, validTo: null }
  }
}

function certificateDer(token: string): Uint8Array {
  return normalizeZatcaCertificate(token).der
}

function pemOrBase64Der(value: string, label: string): Uint8Array {
  const compact = value.trim()
  const marker = `BEGIN ${label}`
  if (compact.includes(marker)) {
    return base64Bytes(compact.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  }
  const decoded = base64Bytes(compact.replace(/\s+/g, ''))
  if (decoded[0] === 0x30) return decoded
  const text = new TextDecoder().decode(decoded).trim()
  if (text.includes(marker)) {
    return base64Bytes(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  }
  return base64Bytes(text.replace(/\s+/g, ''))
}

function derNode(bytes: Uint8Array, offset: number): { start: number; tag: number; contentStart: number; end: number; next: number } {
  const start = offset
  const tag = bytes[offset++]
  let length = bytes[offset++]
  if (length & 0x80) {
    const count = length & 0x7f
    length = 0
    for (let i = 0; i < count; i++) length = (length << 8) | bytes[offset++]
  }
  const end = offset + length
  if (!Number.isFinite(end) || end > bytes.length) throw new Error('Invalid certificate DER')
  return { start, tag, contentStart: offset, end, next: end }
}

function parseAsn1Time(value: string): string | null {
  const utc = value.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)
  const generalized = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)
  const parts = generalized ?? utc
  if (!parts) return null
  const year = generalized ? Number(parts[1]) : (Number(parts[1]) >= 50 ? 1900 : 2000) + Number(parts[1])
  return new Date(Date.UTC(
    year,
    Number(parts[2]) - 1,
    Number(parts[3]),
    Number(parts[4]),
    Number(parts[5]),
    Number(parts[6]),
  )).toISOString()
}

function base64Bytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!normalized || /[^A-Za-z0-9+/=]/.test(normalized)) throw new Error('Invalid base64')
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), character => character.charCodeAt(0))
}

function upstreamStatus(error: unknown): number {
  if (error instanceof RequestError) return error.status
  if (isSandboxComplianceRequestError(error)) {
    const status = (error as { httpStatus?: unknown }).httpStatus
    return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500
  }
  if (isZatcaHttpError(error)) return error.httpStatus >= 400 && error.httpStatus <= 599 ? error.httpStatus : 502
  return 500
}

function safeError(error: unknown): string {
  const fallback = 'Sandbox onboarding failed. Sensitive details were redacted.'
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
  if (!cleaned) return fallback
  if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|encryption|<\?xml|<Invoice/i.test(cleaned)) {
    return fallback
  }
  return cleaned
}

function safeLogText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!cleaned) return undefined
  if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|xml/i.test(cleaned)) {
    return 'Sensitive detail redacted.'
  }
  return cleaned
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function valuePresent(value: unknown): boolean {
  return cleanString(value).length > 0
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
