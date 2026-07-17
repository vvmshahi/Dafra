/**
 * Internal-only onboarding for the single permanent Kubri ZATCA Sandbox demo.
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
  isZatcaHttpError,
  requestComplianceCsid,
  requestProductionCsid,
} from '../_shared/zatca/client.ts'
import {
  requiredComplianceSamples,
  stripComplianceSampleDebug,
  submitComplianceSamples,
  type ComplianceSampleResult,
  type SampleSeller,
} from '../_shared/zatca/samples.ts'

const SANDBOX_CORE_BASE_URL =
  'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal'
const SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR =
  'Sandbox Production certificate does not match the CSR signing key.'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PERMANENT_DEMO_TENANT_ID = 'ebf1144b-55ed-472a-99c9-23b5ee915351'
const PERMANENT_DEMO_BRANCH_IDS = new Set([
  '14271653-b404-44bf-9f39-7e9927569c02',
  'c30094d7-40ca-4d2e-833a-07aa18c4fa46',
])

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

class SandboxProductionKeyMismatchError extends Error {
  constructor() {
    super(SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR)
    this.name = 'SandboxProductionKeyMismatchError'
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL')
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    requireServiceRole(req)

    const body = await readBody(req)
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    const scope = await loadDemoScope(db, body.tenantId, body.branchId)

    if (body.action === 'reconcile_uncertain_operation') {
      const reconciliation = await reconcileUncertainOperation(db, body)
      const credential = await loadCredentialById(db, body.credentialId as string, body.tenantId, body.branchId)
      return jsonResponse({
        ok: true,
        ...safeStatus(body.branchId, credential),
        reconciliation,
      })
    }

    if (body.action === 'get_status') {
      const credential = await loadCredential(db, body.tenantId, body.branchId, true)
      return jsonResponse({ ok: true, ...safeStatus(body.branchId, credential) })
    }

    let credential = await loadCredential(db, body.tenantId, body.branchId, false)

    if (body.action === 'generate_csr') {
      const idempotent = !!credential
      credential = await generateCsr(db, scope, body, credential)
      return jsonResponse({ ok: true, ...safeStatus(body.branchId, credential), idempotent })
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
      return jsonResponse({ ok: true, ...safeStatus(body.branchId, credential), idempotent: true })
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
      if (error instanceof SandboxProductionKeyMismatchError) {
        await markFailed(db, credential, requestedAction, error.message, error)
        throw new RequestError(error.message, 422)
      }
      if (requiresExternalReconciliation(requestedAction, error)) {
        const message = 'The Sandbox response was uncertain. Manual reconciliation is required before retrying.'
        await recordReconciliationRequired(db, credential, requestedAction, message)
        throw new RequestError(message, 502)
      }
      const safeMessage = safeError(error)
      await markFailed(db, credential, requestedAction, safeMessage, error)
      throw new RequestError(safeMessage, upstreamStatus(error))
    }

    return jsonResponse({ ok: true, ...safeStatus(body.branchId, credential) })
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

function requireServiceRole(req: Request): void {
  const authorization = req.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i)
  if (!match) throw new RequestError('Unauthorized', 401)

  try {
    const segments = match[1].split('.')
    if (segments.length !== 3) throw new Error('Malformed JWT')

    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { role?: unknown }
    if (claims.role !== 'service_role') throw new Error('Invalid role')
  } catch {
    throw new RequestError('Unauthorized', 401)
  }
}

async function loadDemoScope(db: any, tenantId: string, branchId: string): Promise<Scope> {
  if (tenantId !== PERMANENT_DEMO_TENANT_ID || !PERMANENT_DEMO_BRANCH_IDS.has(branchId)) {
    throw new RequestError('Forbidden: authorized permanent-demo Sandbox branch required', 403)
  }
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
    throw new RequestError('Forbidden: authorized demo Sandbox branch required', 403)
  }
  return { tenant: tenantResult.data, branch: branchResult.data }
}

async function loadCredential(
  db: any,
  tenantId: string,
  branchId: string,
  includeInactive: boolean,
): Promise<CredentialRow | null> {
  let query = db.from('zatca_sandbox_credentials')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('environment', 'sandbox')
    .order('created_at', { ascending: false })
    .limit(1)

  if (!includeInactive) query = query.in('status', ['pending', 'compliance', 'active', 'failed'])
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
  if (!credential.encrypted_private_key || !credential.encrypted_production_csid || !credential.certificate) {
    throw new RequestError('Active Sandbox credential validation material is incomplete.', 409)
  }
  const secret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  const [privateKeyPem, productionCertificate] = await Promise.all([
    decryptText(credential.encrypted_private_key, secret),
    decryptText(credential.encrypted_production_csid, secret),
  ])
  try {
    assertSandboxProductionKeyMatch(privateKeyPem, productionCertificate)
    assertSandboxProductionKeyMatch(privateKeyPem, credential.certificate)
  } catch (error) {
    if (!(error instanceof SandboxProductionKeyMismatchError)) throw error
    const now = new Date().toISOString()
    const { data, error: updateError } = await db.from('zatca_sandbox_credentials').update({
      status: 'revoked',
      onboarding_status: 'sandbox_production_csid_ready',
      failed_step: null,
      last_error: SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR,
      onboarding_operation: null,
      operation_started_at: null,
      reconciliation_status: 'resolved',
      reconciliation_decision: 'revoke_and_restart_device',
      reconciled_at: now,
      reconciled_by: body.reconciledBy,
      reconciliation_summary: {
        operation: body.expectedOperation,
        decision: body.reconciliationDecision,
        summary: body.reconciliationSummary,
        restartRequired: true,
        reconciledAt: now,
      },
      last_safe_response: {
        action: 'reconcile_uncertain_operation',
        operation: body.expectedOperation,
        decision: body.reconciliationDecision,
        resultingStatus: 'revoked',
        restartRequired: true,
        completedAt: now,
      },
    })
      .eq('id', credential.id)
      .eq('status', 'active')
      .eq('onboarding_status', 'active')
      .is('onboarding_operation', null)
      .select('id')
      .maybeSingle()
    if (updateError || !data) {
      throw new RequestError('Sandbox reconciliation was rejected without changing the credential.', 409)
    }
    return {
      operation: body.expectedOperation,
      decision: body.reconciliationDecision,
      reconciledAt: now,
      restartRequired: true,
    }
  }
  throw new RequestError('The active Sandbox credential key matches its certificate and was not revoked.', 409)
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
  if (!body.functionalityMap) {
    throw new RequestError('functionalityMap is required for CSR generation', 400)
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
    if (credential.last_safe_response?.restartRequired === true) {
      throw new RequestError('This credential cannot be retried and must be revoked before restarting onboarding.', 409)
    }
    return credential.failed_step
  }
  if (action === 'get_status' || action === 'generate_csr' || action === 'reconcile_uncertain_operation') {
    throw new RequestError('Invalid onboarding action transition', 409)
  }
  return action
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
      return requestSandboxProductionCredential(db, credential)
    case 'activate':
      return activateCredential(db, credential)
  }
}

async function requestComplianceCredential(
  db: any,
  body: RequestBody,
  credential: CredentialRow,
): Promise<CredentialRow> {
  if (!validateOtp(body.otp)) throw new RequestError('A valid 6-digit Sandbox OTP is required.', 400)
  if (!credential.csr_pem) throw new Error('Persisted backend CSR is missing')

  let httpStatus: number | undefined
  const response = await requestComplianceCsid({
    baseUrl: SANDBOX_CORE_BASE_URL,
    csrPem: credential.csr_pem,
    otp: body.otp,
    onResponse: trace => { httpStatus = trace.httpStatus },
  })
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
    last_safe_response: { action: 'request_compliance_csid', httpStatus, completedAt: now },
  })
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

async function requestSandboxProductionCredential(db: any, credential: CredentialRow): Promise<CredentialRow> {
  if (!credential.compliance_request_id || !credential.encrypted_compliance_csid || !credential.encrypted_compliance_secret) {
    throw new Error('Persisted compliance credential is incomplete')
  }
  const secret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  const complianceCsid = await decryptText(credential.encrypted_compliance_csid, secret)
  const complianceSecret = await decryptText(credential.encrypted_compliance_secret, secret)
  let httpStatus: number | undefined
  const response = await requestProductionCsid({
    baseUrl: SANDBOX_CORE_BASE_URL,
    complianceCsid,
    complianceSecret,
    complianceRequestId: credential.compliance_request_id,
    onResponse: trace => { httpStatus = trace.httpStatus },
  })
  const privateKeyPem = await decryptText(credential.encrypted_private_key, secret)
  assertSandboxProductionKeyMatch(privateKeyPem, response.binarySecurityToken)
  const validity = certificateValidity(response.binarySecurityToken)
  const now = new Date().toISOString()
  return updateCredential(db, credential.id, 'request_sandbox_production_csid', {
    status: 'compliance',
    onboarding_status: 'sandbox_production_csid_ready',
    last_successful_onboarding_status: 'sandbox_production_csid_ready',
    encrypted_production_csid: await encryptText(response.binarySecurityToken, secret),
    encrypted_production_secret: await encryptText(response.secret, secret),
    certificate: response.binarySecurityToken,
    certificate_valid_from: validity.validFrom,
    expires_at: validity.validTo,
    sandbox_production_csid_received_at: now,
    last_safe_response: { action: 'request_sandbox_production_csid', httpStatus, completedAt: now },
  })
}

async function activateCredential(db: any, credential: CredentialRow): Promise<CredentialRow> {
  if (
    !credential.encrypted_private_key ||
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
    decryptText(credential.encrypted_production_csid, encryptionSecret),
    decryptText(credential.encrypted_production_secret, encryptionSecret),
  ])
  if (decryptedValues.some(value => !value.trim())) {
    throw new Error('Sandbox credential validation failed')
  }
  assertSandboxProductionKeyMatch(decryptedValues[0], decryptedValues[1])
  assertSandboxProductionKeyMatch(decryptedValues[0], credential.certificate)
  const now = new Date().toISOString()
  return updateCredential(db, credential.id, 'activate', {
    status: 'active',
    onboarding_status: 'active',
    last_successful_onboarding_status: 'active',
    activated_at: now,
    last_safe_response: { action: 'activate', completedAt: now },
  })
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
      ...(cause instanceof SandboxProductionKeyMismatchError ? { restartRequired: true } : {}),
      ...(isZatcaHttpError(cause) ? { httpStatus: cause.httpStatus } : {}),
    },
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
  const { error } = await db.from('zatca_sandbox_credentials').update({
    last_error: message,
    last_safe_response: { action, uncertainAt: new Date().toISOString() },
    reconciliation_status: 'required',
    reconciliation_decision: null,
    reconciled_at: null,
    reconciled_by: null,
    reconciliation_summary: null,
    ...extra,
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
  if (isZatcaHttpError(error)) return error.httpStatus >= 500
  return !(error instanceof RequestError)
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

function safeStatus(branchId: string, credential: CredentialRow | null): Record<string, unknown> {
  if (!credential) {
    return {
      branchId,
      environment: 'sandbox',
      status: 'not_started',
      completedSteps: [],
      certificateExists: false,
      complianceCredentialExists: false,
      sandboxProductionCredentialExists: false,
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
    certificateExists: !!credential.certificate,
    publicKeyExists: !!credential.public_key_pem,
    complianceCredentialExists: !!credential.encrypted_compliance_csid && !!credential.encrypted_compliance_secret,
    sandboxProductionCredentialExists: !!credential.encrypted_production_csid && !!credential.encrypted_production_secret,
    expiresAt: credential.expires_at,
    lastError: credential.last_error === SANDBOX_PRODUCTION_KEY_MISMATCH_ERROR
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
  }
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

function assertSandboxProductionKeyMatch(privateKeyPem: string, certificateToken: string): void {
  try {
    const privateKeyDer = base64Bytes(
      privateKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
    )
    const privateScalar = extractEcPrivateKeyScalar(privateKeyDer)
    const derivedPoint = secp256k1.getPublicKey(privateScalar, false)
    const certificatePoint = certificatePublicKeyPoint(certificateToken)
    if (!equalBytes(derivedPoint, certificatePoint)) {
      throw new SandboxProductionKeyMismatchError()
    }
  } catch (error) {
    if (error instanceof SandboxProductionKeyMismatchError) throw error
    throw new SandboxProductionKeyMismatchError()
  }
}

function certificatePublicKeyPoint(token: string): Uint8Array {
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
  return secp256k1.Point.fromBytes(encodedPoint).toBytes(false)
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== 65 || right.length !== 65) return false
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
  const compact = token.trim()
  if (compact.includes('BEGIN CERTIFICATE')) {
    return base64Bytes(compact.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  }
  const once = base64Bytes(compact.replace(/\s+/g, ''))
  if (once[0] === 0x30) return once
  const text = new TextDecoder().decode(once).trim()
  if (text.includes('BEGIN CERTIFICATE')) {
    return base64Bytes(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  }
  return base64Bytes(text.replace(/\s+/g, ''))
}

function derNode(bytes: Uint8Array, offset: number): { tag: number; contentStart: number; end: number; next: number } {
  const tag = bytes[offset++]
  let length = bytes[offset++]
  if (length & 0x80) {
    const count = length & 0x7f
    length = 0
    for (let i = 0; i < count; i++) length = (length << 8) | bytes[offset++]
  }
  const end = offset + length
  if (!Number.isFinite(end) || end > bytes.length) throw new Error('Invalid certificate DER')
  return { tag, contentStart: offset, end, next: end }
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
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

function upstreamStatus(error: unknown): number {
  if (error instanceof RequestError) return error.status
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
