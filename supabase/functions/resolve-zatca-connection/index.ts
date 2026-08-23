import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, isUuid } from '../_shared/zatca/config.ts'
import { requireTenantUser } from '../_shared/zatca/auth.ts'
import { extractEcPrivateKeyScalar } from '../_shared/zatca/signing_core.mjs'
import {
  assessSandboxComplianceBinding,
  assessSandboxOperationalCertificate,
} from '../_shared/zatca/sandbox_credential_binding.mjs'

type ConnectionState = 'not_started' | 'onboarding' | 'connected' | 'blocked' | 'failed'
type SandboxSubmissionVerification = 'not_verified' | 'submission_verified'

const REQUIRED_1100_SAMPLES = [
  'simplified_invoice',
  'simplified_credit_note',
  'simplified_debit_note',
  'standard_invoice',
  'standard_credit_note',
  'standard_debit_note',
] as const

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

async function decryptServerEnvelope(stored: string, secret: string): Promise<string> {
  const [version, ivB64, encB64] = stored.split(':')
  if (version !== 'v1' || !ivB64 || !encB64) throw new Error('Invalid encrypted Sandbox credential format')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  const iv = Uint8Array.from(atob(ivB64), char => char.charCodeAt(0))
  const encrypted = Uint8Array.from(atob(encB64), char => char.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
  return new TextDecoder().decode(plaintext)
}

async function decryptServerPrivateKey(stored: string, secret: string): Promise<Uint8Array> {
  const pem = await decryptServerEnvelope(stored, secret)
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return extractEcPrivateKeyScalar(Uint8Array.from(atob(b64), char => char.charCodeAt(0)))
}

function sampleResultsComplete(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  const accepted = new Set(
    value.filter((sample: any) => sample?.status === 'accepted').map((sample: any) => sample?.type),
  )
  return REQUIRED_1100_SAMPLES.every(type => accepted.has(type)) && accepted.size === REQUIRED_1100_SAMPLES.length
}

async function sandboxResolution(
  credential: any | null,
  branchVat: string | null,
  submissionVerification: SandboxSubmissionVerification,
): Promise<Record<string, unknown>> {
  if (!credential) {
    return {
      connection_state: 'not_started' satisfies ConnectionState,
      onboarding_stage: 'not_started',
      credential_status: 'missing',
      readiness_reason: 'sandbox_credential_missing',
      submission_verification: 'not_verified',
    }
  }

  const expired = !!credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now()
  const failed = credential.status === 'failed'
    || credential.status === 'revoked'
    || credential.onboarding_status === 'failed'
    || credential.onboarding_status === 'revoked'
    || expired

  if (failed) {
    return {
      connection_state: 'failed' satisfies ConnectionState,
      onboarding_stage: expired ? 'expired' : (credential.failed_step ?? credential.onboarding_status ?? 'failed'),
      credential_status: expired ? 'expired' : (credential.status ?? 'failed'),
      readiness_reason: expired ? 'sandbox_credential_expired' : 'sandbox_onboarding_failed',
      submission_verification: 'not_verified',
    }
  }

  const csrReady = nonEmpty(credential.csr_pem)
    && nonEmpty(credential.public_key_pem)
    && nonEmpty(credential.encrypted_private_key)
  const complianceReady = nonEmpty(credential.encrypted_compliance_csid)
    && nonEmpty(credential.encrypted_compliance_secret)
    && nonEmpty(credential.compliance_request_id)
  const samplesReady = credential.functionality_map === '1100'
    && sampleResultsComplete(credential.compliance_sample_results)
  const operationalReady = nonEmpty(credential.encrypted_production_csid)
    && nonEmpty(credential.encrypted_production_secret)
    && nonEmpty(credential.certificate)
  const active = credential.environment === 'sandbox'
    && credential.status === 'active'
    && credential.onboarding_status === 'active'
    && csrReady
    && complianceReady
    && samplesReady
    && operationalReady
    && credential.reconciliation_status !== 'required'
    && !credential.onboarding_operation
    && !expired

  if (active) {
    const encryptionSecret = Deno.env.get('ZATCA_SERVER_ENCRYPTION_KEY')
    if (!encryptionSecret) {
      return {
        connection_state: 'blocked' satisfies ConnectionState,
        onboarding_stage: 'active',
        credential_status: 'active',
        readiness_reason: 'sandbox_signing_binding_unavailable',
        submission_verification: 'not_verified',
      }
    }
    let productionBinding: Awaited<ReturnType<typeof assessSandboxOperationalCertificate>>
    try {
      const [privateKey, complianceCertificate] = await Promise.all([
        decryptServerPrivateKey(credential.encrypted_private_key, encryptionSecret),
        decryptServerEnvelope(credential.encrypted_compliance_csid, encryptionSecret),
      ])
      const complianceBinding = assessSandboxComplianceBinding({
        privateKey,
        csrPem: credential.csr_pem,
        complianceCertificate,
      })
      productionBinding = await assessSandboxOperationalCertificate({
        environment: credential.environment,
        privateKey,
        csrPem: credential.csr_pem,
        productionCertificate: credential.certificate,
        branchVat,
      })
      if (
        !complianceBinding.privateKeyEqualsCsr ||
        !complianceBinding.privateKeyEqualsSigningCertificate ||
        !complianceBinding.csrEqualsSigningCertificate ||
        !productionBinding.acceptsSandboxOperationalCredential
      ) {
        return {
          connection_state: 'blocked' satisfies ConnectionState,
          onboarding_stage: 'active',
          credential_status: 'active',
          readiness_reason: 'sandbox_credential_binding_failed',
          submission_verification: 'not_verified',
        }
      }
    } catch {
      return {
        connection_state: 'blocked' satisfies ConnectionState,
        onboarding_stage: 'active',
        credential_status: 'active',
        readiness_reason: 'sandbox_signing_binding_unverifiable',
        submission_verification: 'not_verified',
      }
    }
    return {
      connection_state: 'connected' satisfies ConnectionState,
      onboarding_stage: 'active',
      credential_status: 'active',
      readiness_reason: 'sandbox_requirements_satisfied',
      operational_credential: productionBinding.classification,
      signing_credential: 'compliance_certificate',
      // Connected means cryptographic onboarding is complete. It deliberately
      // does not claim Reporting/Clearance acceptance without an accepted
      // Sandbox submission reservation.
      submission_verification: submissionVerification,
    }
  }

  let readiness_reason = 'sandbox_onboarding_incomplete'
  if (credential.environment !== 'sandbox') readiness_reason = 'sandbox_environment_mismatch'
  else if (!csrReady) readiness_reason = 'sandbox_csr_or_keypair_incomplete'
  else if (!complianceReady) readiness_reason = 'sandbox_compliance_csid_missing'
  else if (!samplesReady) readiness_reason = 'sandbox_compliance_samples_incomplete'
  else if (!operationalReady) readiness_reason = 'sandbox_operational_csid_missing'
  else if (credential.reconciliation_status === 'required' || credential.onboarding_operation) readiness_reason = 'sandbox_onboarding_outcome_unresolved'
  else if (credential.status === 'active' || credential.onboarding_status === 'active') readiness_reason = 'sandbox_credential_readiness_incomplete'

  return {
    connection_state: 'onboarding' satisfies ConnectionState,
    onboarding_stage: credential.onboarding_status ?? credential.status ?? 'onboarding',
    credential_status: credential.status ?? 'unknown',
    readiness_reason,
    submission_verification: 'not_verified',
  }
}

async function resolve(req: Request): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Server configuration error')

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const caller = await requireTenantUser(db, req)
  const body = await req.json().catch(() => ({}))
  const branchId = typeof body?.branchId === 'string' ? body.branchId : ''
  if (!isUuid(branchId)) throw new Error('Valid branchId is required')
  if (caller.role === 'branch' && caller.branchId !== branchId) throw new Error('Branch access denied')
  if (!['owner', 'admin', 'branch'].includes(caller.role)) throw new Error('Tenant user access required')

  const [{ data: tenant, error: tenantError }, { data: branch, error: branchError }] = await Promise.all([
    db.from('tenants').select('id,is_demo,is_active,suspended_at').eq('id', caller.tenantId).maybeSingle(),
    db.from('branches').select('id,tenant_id,vat_number,zatca_environment,is_active').eq('id', branchId).eq('tenant_id', caller.tenantId).maybeSingle(),
  ])
  if (tenantError || branchError || !tenant || !branch || branch.is_active !== true || tenant.is_active !== true || tenant.suspended_at) {
    return {
      branch_id: branchId,
      environment: branch?.zatca_environment ?? (tenant?.is_demo ? 'sandbox' : 'production'),
      connection_state: 'blocked' satisfies ConnectionState,
      onboarding_stage: 'blocked',
      credential_status: 'unavailable',
      readiness_reason: 'inactive_or_unavailable_scope',
    }
  }

  const expectedEnvironment = tenant.is_demo === true ? 'sandbox' : 'production'
  if (branch.zatca_environment !== expectedEnvironment) {
    return {
      branch_id: branchId,
      environment: branch.zatca_environment,
      connection_state: 'blocked' satisfies ConnectionState,
      onboarding_stage: 'blocked',
      credential_status: 'unavailable',
      readiness_reason: 'tenant_branch_environment_mismatch',
    }
  }

  if (expectedEnvironment === 'sandbox') {
    const [credentialResult, acceptedSubmissionResult] = await Promise.all([
      db.from('zatca_sandbox_credentials')
        .select('environment,status,onboarding_status,failed_step,expires_at,functionality_map,csr_pem,public_key_pem,encrypted_private_key,compliance_request_id,encrypted_compliance_csid,encrypted_compliance_secret,encrypted_production_csid,encrypted_production_secret,certificate,compliance_sample_results,reconciliation_status,onboarding_operation')
        .eq('tenant_id', caller.tenantId)
        .eq('branch_id', branchId)
        .eq('environment', 'sandbox')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from('zatca_sandbox_submission_reservations')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', caller.tenantId)
        .eq('branch_id', branchId)
        .eq('environment', 'sandbox')
        .eq('state', 'accepted'),
    ])
    if (credentialResult.error || acceptedSubmissionResult.error) throw new Error('Unable to load Sandbox connection state')
    return {
      branch_id: branchId,
      environment: 'sandbox',
      ...(await sandboxResolution(
        credentialResult.data,
        branch.vat_number,
        (acceptedSubmissionResult.count ?? 0) > 0 ? 'submission_verified' : 'not_verified',
      )),
    }
  }

  const { data: productionCredential } = await db.from('zatca_production_credentials')
    .select('status,onboarding_status,requested_functionality_map,updated_at')
    .eq('tenant_id', caller.tenantId)
    .eq('branch_id', branchId)
    .eq('environment', 'production')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: readiness, error: readinessError } = await db.rpc('get_zatca_branch_readiness_v2', {
    p_branch_id: branchId,
    p_user_id: caller.userId,
  })
  if (readinessError) throw new Error('Unable to load Production connection state')

  const productionConnected = readiness?.productionConnected === true
  const productionReady = readiness?.structurallyReady === true
  const credentialStatus = productionCredential?.onboarding_status ?? productionCredential?.status ?? 'missing'
  const state: ConnectionState = productionReady
    ? 'connected'
    : credentialStatus === 'failed' || credentialStatus === 'compliance_failed'
      ? 'failed'
      : !productionCredential
        ? 'not_started'
        : readiness?.branchBlocked === true || readiness?.readinessStatus === 'blocked'
          ? 'blocked'
          : 'onboarding'

  return {
    branch_id: branchId,
    environment: 'production',
    connection_state: state,
    onboarding_stage: credentialStatus,
    credential_status: credentialStatus,
    readiness_reason: productionReady
      ? 'production_requirements_satisfied'
      : readiness?.readinessStatus === 'blocked'
        ? 'production_branch_blocked'
        : productionConnected
          ? 'production_readiness_incomplete'
          : 'production_credentials_not_connected',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    return jsonResponse(await resolve(req))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve ZATCA connection state'
    const status = /Unauthorized/i.test(message) ? 401 : /access denied|Forbidden|required/i.test(message) ? 403 : 500
    return jsonResponse({ error: message.slice(0, 180) }, status)
  }
})
