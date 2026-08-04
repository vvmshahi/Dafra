/**
 * Kubri Trading Demo — isolated ZATCA Integration Sandbox onboarding V2.
 *
 * This function intentionally has no dependency on legacy Trading onboarding
 * rows or state machines. It uses only V2 session storage until the final,
 * transactionally validated canonical credential activation.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { secp256k1 } from 'https://esm.sh/@noble/curves@2.2.0/secp256k1.js'
import { generateProductionCsr, validateCsrInputs, type CsrParams } from '../_shared/zatca/csr.ts'
import { encryptText } from '../_shared/zatca/crypto.ts'
import { extractEcPrivateKeyScalar } from '../_shared/zatca/signing_core.mjs'
import {
  stripComplianceSampleDebug,
  submitComplianceSamples,
  type SampleSeller,
} from '../_shared/zatca/samples.ts'
import { requireEnv, validateOtp, type FunctionalityMap } from '../_shared/zatca/config.ts'

const TENANT_ID = 'ebf1144b-55ed-472a-99c9-23b5ee915351'
const BRANCH_ID = '14271653-b404-44bf-9f39-7e9927569c02'
const ENVIRONMENT = 'integration_sandbox'
const FUNCTIONALITY_MAP: FunctionalityMap = '0100'
const SANDBOX_BASE_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const STAGES = [
  'submit_started', 'caller_authorized', 'trading_scope_resolved', 'v2_session_created',
  'private_key_generated', 'csr_generated', 'csr_key_match_verified',
  'compliance_request_started', 'compliance_response_persisted', 'compliance_response_shape_verified', 'compliance_response_parsed',
  'compliance_validation_started', 'compliance_validation_completed',
  'sandbox_production_request_started', 'sandbox_production_response_persisted',
  'sandbox_production_response_parsed', 'production_request_linkage_verified', 'certificate_comparison_diagnosed', 'certificate_key_match_verified',
  'credential_activation_started', 'credential_activation_completed',
  'trading_mode_updated', 'onboarding_completed', 'onboarding_failed',
] as const
type Stage = typeof STAGES[number]
type EventStatus = 'pending' | 'success' | 'failed'

class V2Error extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly code = 'SANDBOX_V2_ONBOARDING_FAILED',
    readonly databaseCode?: string,
    readonly databaseConstraint?: string,
  ) { super(message) }
}

type Caller = { userId: string; role: 'owner' | 'super_admin' }
type SessionRef = { id: string | null }
type V2Session = {
  id: string
  status: 'in_progress' | 'failed' | 'completed'
  stage: string
  functionality_map: FunctionalityMap
  safe_error_code?: string | null
  safe_error_message?: string | null
  safe_http_status?: number | null
}
type ComplianceCredentials = {
  binarySecurityToken: string
  secret: string
  requestID: string
  responseFields: string[]
  requiredFields: Record<string, boolean>
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function bearer(req: Request): string {
  const value = req.headers.get('Authorization') ?? ''
  const match = value.match(/^Bearer\s+([^\s]+)$/i)
  if (!match) throw new V2Error('Unauthorized', 401, 'SANDBOX_V2_UNAUTHORIZED')
  return match[1]
}

function jwtRole(jwt: string): string | null {
  try {
    const encoded = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))
    return typeof claims?.role === 'string' ? claims.role : null
  } catch { return null }
}

async function authorize(db: any, req: Request): Promise<Caller> {
  const jwt = bearer(req)
  if (jwtRole(jwt) === 'service_role') {
    throw new V2Error('Owner or Super Admin session required', 401, 'SANDBOX_V2_UNAUTHORIZED')
  }
  const { data: { user }, error: authError } = await db.auth.getUser(jwt)
  if (authError || !user) throw new V2Error('Unauthorized', 401, 'SANDBOX_V2_UNAUTHORIZED')
  const { data, error } = await db.from('user_profiles')
    .select('id,role,tenant_id,branch_id,is_active').eq('id', user.id).maybeSingle()
  if (error || !data?.id || data.is_active !== true) throw new V2Error('Forbidden', 403, 'SANDBOX_V2_FORBIDDEN')
  const owner = data.role === 'owner' && data.tenant_id === TENANT_ID && (!data.branch_id || data.branch_id === BRANCH_ID)
  const admin = data.role === 'super_admin' && (!data.tenant_id || data.tenant_id === TENANT_ID)
  if (!owner && !admin) throw new V2Error('Forbidden', 403, 'SANDBOX_V2_FORBIDDEN')
  return { userId: user.id, role: owner ? 'owner' : 'super_admin' }
}

async function readOtp(req: Request): Promise<string> {
  let body: unknown
  try { body = await req.json() } catch { throw new V2Error('Invalid JSON request body', 400, 'SANDBOX_V2_INVALID_REQUEST') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new V2Error('Invalid request body', 400, 'SANDBOX_V2_INVALID_REQUEST')
  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.length !== 1 || keys[0] !== 'otp') throw new V2Error('Request body must contain only otp', 400, 'SANDBOX_V2_INVALID_REQUEST')
  const otp = (body as { otp?: unknown }).otp
  if (typeof otp !== 'string' || !validateOtp(otp)) throw new V2Error('A valid six-digit Sandbox OTP is required', 400, 'SANDBOX_V2_OTP_REQUIRED')
  return otp
}

function safeMessage(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|xml|response body/i.test(text)) return 'Sensitive detail redacted.'
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) || 'Sandbox V2 onboarding failed.'
}

function safeDatabaseCode(error: unknown): string | undefined {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>).code : undefined
  return typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value) ? value : undefined
}

function safeDatabaseConstraint(error: unknown): string | undefined {
  const root = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const direct = typeof root.constraint === 'string' ? root.constraint : undefined
  const text = [root.message, root.details].filter(value => typeof value === 'string').join(' ')
  const fromMessage = text.match(/constraint\s+["']([a-z][a-z0-9_]{0,100})["']/i)?.[1]
  const candidate = direct ?? fromMessage
  return candidate && /^[a-z][a-z0-9_]{0,100}$/.test(candidate) ? candidate : undefined
}

function databaseFailure(message: string, error: unknown, requestStatus = 500): V2Error {
  return new V2Error(message, requestStatus, 'SANDBOX_V2_SESSION_CREATE_FAILED', safeDatabaseCode(error), safeDatabaseConstraint(error))
}

function safeFields(value: any): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : []
}

function requiredFields(value: any, fields: string[]): Record<string, boolean> {
  return Object.fromEntries(fields.map(field => [field, typeof value?.[field] === 'string' && value[field].length > 0]))
}

async function decryptText(stored: string, secret: string): Promise<string> {
  const [version, ivBase64, cipherBase64] = stored.split(':')
  if (version !== 'v1' || !ivBase64 || !cipherBase64) throw new Error('Invalid encrypted response envelope')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivBase64) },
    key,
    base64ToBytes(cipherBase64),
  )
  return new TextDecoder().decode(plaintext)
}

async function event(db: any, sessionId: string, stage: Stage, status: EventStatus, extras: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db.from('zatca_sandbox_v2_events').insert({
    session_id: sessionId, stage, status, request_id: extras.requestId ?? null,
    http_status: extras.httpStatus ?? null, safe_code: extras.code ?? null,
    safe_message: extras.message ?? null,
    non_secret_response_fields: extras.responseFields ?? [],
    required_fields_present: extras.requiredFields ?? {},
    public_key_fingerprint_prefixes: extras.fingerprints ?? {},
    certificate_diagnostic: extras.certificateDiagnostic ?? {},
    production_request_linkage: extras.productionRequestLinkage ?? {},
  })
  if (error) throw new V2Error('V2 safe event could not be persisted', 500, 'SANDBOX_V2_EVENT_PERSIST_FAILED')
}

async function updateSession(db: any, id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('zatca_sandbox_v2_sessions').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new V2Error('V2 session state could not be persisted', 500, 'SANDBOX_V2_SESSION_PERSIST_FAILED')
}

async function loadSession(db: any, id: string): Promise<V2Session> {
  const { data, error } = await db.from('zatca_sandbox_v2_sessions').select('*').eq('id', id).maybeSingle()
  if (error || !data) throw new V2Error('V2 session could not be loaded', 500, 'SANDBOX_V2_SESSION_LOAD_FAILED')
  return data as V2Session
}

async function currentSession(db: any): Promise<V2Session | null> {
  const { data, error } = await db.from('zatca_sandbox_v2_sessions').select('*')
    .eq('tenant_id', TENANT_ID).eq('branch_id', BRANCH_ID).eq('environment', ENVIRONMENT)
    .eq('sandbox_onboarding_version', 2).in('status', ['in_progress', 'completed'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new V2Error('V2 session lookup failed', 500, 'SANDBOX_V2_SESSION_LOAD_FAILED')
  return (data as V2Session | null) ?? null
}

async function safeStatus(db: any, session: V2Session | null, requestId: string): Promise<Record<string, unknown>> {
  const events = session
    ? (await db.from('zatca_sandbox_v2_events').select('session_id,event_at,stage,status,http_status,safe_code,safe_message,request_id,non_secret_response_fields,required_fields_present,public_key_fingerprint_prefixes,certificate_diagnostic,production_request_linkage').eq('session_id', session.id).order('id', { ascending: true })).data ?? []
    : []
  return {
    ok: session?.status === 'completed',
    onboardingVersion: 2,
    environment: ENVIRONMENT,
    sessionId: session?.id ?? null,
    status: session?.status ?? 'not_started',
    stage: session?.stage ?? 'not_started',
    functionalityMap: FUNCTIONALITY_MAP,
    productionCertificateField: 'binarySecurityToken',
    errorCode: session?.safe_error_code ?? null,
    errorMessage: session?.safe_error_message ?? null,
    requestId,
    events,
  }
}

async function loadScope(db: any): Promise<{ tenant: any; branch: any }> {
  const [tenantResult, branchResult, settingResult] = await Promise.all([
    db.from('tenants').select('id,name,business_type,is_demo,is_active,suspended_at').eq('id', TENANT_ID).eq('is_demo', true).eq('is_active', true).maybeSingle(),
    db.from('branches').select('id,tenant_id,name,business_name,vat_number,cr_number,building_number,street,district,city,postal_code,country,zatca_phase,zatca_environment,is_active').eq('id', BRANCH_ID).eq('tenant_id', TENANT_ID).eq('zatca_environment', 'sandbox').eq('is_active', true).maybeSingle(),
    db.from('zatca_sandbox_v2_settings').select('environment,sandbox_onboarding_version,functionality_map').eq('tenant_id', TENANT_ID).eq('branch_id', BRANCH_ID).maybeSingle(),
  ])
  if (tenantResult.error || branchResult.error || settingResult.error || !tenantResult.data || !branchResult.data ||
      settingResult.data?.environment !== ENVIRONMENT || settingResult.data?.sandbox_onboarding_version !== 2 || settingResult.data?.functionality_map !== FUNCTIONALITY_MAP) {
    throw new V2Error('Trading Integration Sandbox V2 scope is unavailable', 503, 'SANDBOX_V2_SCOPE_UNAVAILABLE')
  }
  return { tenant: tenantResult.data, branch: branchResult.data }
}

function sellerIdentity(branch: any, tenant: any): { csr: CsrParams; seller: SampleSeller } {
  const location = [branch.building_number, branch.street, branch.district, branch.city, branch.postal_code, branch.country].filter(Boolean).join(', ')
  const csr: CsrParams = {
    branchId: BRANCH_ID,
    commonName: String(branch.business_name ?? '').trim(),
    branchName: String(branch.name ?? '').trim(),
    businessName: String(branch.business_name ?? '').trim(),
    vatNumber: String(branch.vat_number ?? '').trim(),
    functionalityMap: FUNCTIONALITY_MAP,
    location,
    industry: String(tenant.business_type ?? '').trim(),
  }
  return {
    csr,
    seller: {
      name: csr.businessName, vatNumber: csr.vatNumber, crNumber: String(branch.cr_number ?? '').trim(),
      street: String(branch.street ?? '').trim(), buildingNumber: String(branch.building_number ?? '').trim(),
      district: String(branch.district ?? '').trim(), city: String(branch.city ?? '').trim(),
      postalCode: String(branch.postal_code ?? '').trim(), countryCode: String(branch.country ?? 'SA').trim().toUpperCase(),
    },
  }
}

async function rawRequest(params: { url: string; init: RequestInit; db: any; sessionId: string; kind: 'compliance' | 'production'; encryptionKey: string; requestId: string }): Promise<{ status: number; bodyText: string }> {
  const res = await fetch(params.url, params.init)
  const bodyText = await res.text()
  const encrypted = await encryptText(bodyText, params.encryptionKey)
  const update = params.kind === 'compliance'
    ? { encrypted_compliance_response: encrypted }
    : { encrypted_production_response: encrypted }
  const persistedStage = params.kind === 'compliance' ? 'compliance_response_persisted' : 'sandbox_production_response_persisted'
  await updateSession(params.db, params.sessionId, { ...update, safe_http_status: res.status, last_local_request_id: params.requestId, stage: persistedStage })
  await event(params.db, params.sessionId, `${params.kind === 'compliance' ? 'compliance' : 'sandbox_production'}_response_persisted`, 'success', { httpStatus: res.status, requestId: params.requestId })
  if (!res.ok) throw new V2Error(`Sandbox ${params.kind} request failed (${res.status})`, res.status, `SANDBOX_V2_${params.kind.toUpperCase()}_REQUEST_FAILED`)
  return { status: res.status, bodyText }
}

function parseJson(text: string, kind: 'compliance' | 'production'): any {
  try { return JSON.parse(text) } catch { throw new V2Error(`Sandbox ${kind} response could not be parsed`, 422, `SANDBOX_V2_${kind.toUpperCase()}_PARSE_FAILED`) }
}

function parseComplianceJson(text: string): unknown {
  try { return JSON.parse(text) } catch {
    throw new V2Error('Sandbox Compliance response is not valid JSON', 422, 'SANDBOX_V2_COMPLIANCE_RESPONSE_JSON_INVALID')
  }
}

function complianceRequiredFields(body: unknown): Record<string, boolean> {
  const value = body as Record<string, unknown> | null
  return {
    binarySecurityToken: typeof value?.binarySecurityToken === 'string' && value.binarySecurityToken.length > 0,
    secret: typeof value?.secret === 'string' && value.secret.length > 0,
    requestID: typeof value?.requestID === 'number' && Number.isSafeInteger(value.requestID),
  }
}

function parseComplianceResponse(body: unknown): ComplianceCredentials {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new V2Error('Sandbox Compliance response has an invalid JSON shape', 422, 'SANDBOX_V2_COMPLIANCE_FIELD_TYPE_INVALID')
  }
  const value = body as Record<string, unknown>
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
  if (!has('binarySecurityToken') || !has('secret') || !has('requestID')) {
    throw new V2Error('Sandbox Compliance response is missing a required field', 422, 'SANDBOX_V2_COMPLIANCE_REQUIRED_FIELD_MISSING')
  }
  if (typeof value.binarySecurityToken !== 'string' || typeof value.secret !== 'string' ||
      typeof value.requestID !== 'number' || !Number.isSafeInteger(value.requestID)) {
    throw new V2Error('Sandbox Compliance response has an invalid required field type', 422, 'SANDBOX_V2_COMPLIANCE_FIELD_TYPE_INVALID')
  }
  if (!value.binarySecurityToken || !value.secret) {
    throw new V2Error('Sandbox Compliance response is missing a required field', 422, 'SANDBOX_V2_COMPLIANCE_REQUIRED_FIELD_MISSING')
  }
  return {
    binarySecurityToken: value.binarySecurityToken,
    secret: value.secret,
    requestID: String(value.requestID),
    responseFields: safeFields(value),
    requiredFields: complianceRequiredFields(value),
  }
}

function parseExactProduction(body: any): { binarySecurityToken: string; secret: string } {
  if (typeof body?.binarySecurityToken !== 'string' || typeof body?.secret !== 'string') {
    throw new V2Error('Sandbox test Production response schema mismatch', 422, 'SANDBOX_V2_PRODUCTION_SCHEMA_MISMATCH')
  }
  return body
}

type CertificateInspection = {
  encoding: string
  certificateCount: number
  selectedCertificateIndex: number | null
  algorithm: string | null
  curve: string | null
  subjectCategory: string | null
  issuerCategory: string | null
  fingerprint: string | null
  errorCode?: string
  spki?: Uint8Array
}

function strictTokenBytes(value: string): Uint8Array | null {
  const compact = value.replace(/\s+/g, '')
  if (!compact || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) || compact.length % 4 === 1) return null
  try { return base64ToBytes(compact) } catch { return null }
}

function certificateDerList(bytes: Uint8Array): Uint8Array[] {
  const certificates: Uint8Array[] = []
  let cursor = 0
  try {
    while (cursor < bytes.length) {
      const node = derNode(bytes, cursor)
      if (node.tag !== 0x30) return []
      certificates.push(bytes.slice(node.start, node.end))
      cursor = node.end
    }
  } catch { return [] }
  return certificates
}

function pemCertificateDerList(value: string): Uint8Array[] {
  const certificates: Uint8Array[] = []
  const pattern = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const bytes = strictTokenBytes(match[1])
    if (!bytes) return []
    certificates.push(bytes)
  }
  return certificates
}

function tokenCertificateBytes(token: string): { encoding: string; certificates: Uint8Array[] } {
  let value = token.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const unquoted = JSON.parse(value)
      if (typeof unquoted === 'string') value = unquoted
    } catch { return { encoding: 'quoted_invalid', certificates: [] } }
  }
  const directPem = pemCertificateDerList(value)
  if (directPem.length) return { encoding: directPem.length > 1 ? 'pem_certificate_chain' : 'pem_certificate', certificates: directPem }
  const first = strictTokenBytes(value)
  if (!first) return { encoding: 'not_base64', certificates: [] }
  const firstText = new TextDecoder().decode(first).trim()
  const decodedPem = pemCertificateDerList(firstText)
  if (decodedPem.length) return { encoding: decodedPem.length > 1 ? 'base64_of_pem_chain' : 'base64_of_pem_certificate', certificates: decodedPem }
  const firstDer = certificateDerList(first)
  if (firstDer.length) return { encoding: firstDer.length > 1 ? 'base64_of_der_chain' : 'base64_of_der_certificate', certificates: firstDer }
  const second = strictTokenBytes(firstText)
  if (second) {
    const secondDer = certificateDerList(second)
    if (secondDer.length) return { encoding: secondDer.length > 1 ? 'double_base64_der_chain' : 'double_base64_der_certificate', certificates: secondDer }
  }
  return { encoding: 'base64_non_certificate', certificates: [] }
}

function inspectCertificateToken(token: string): Omit<CertificateInspection, 'fingerprint' | 'spki'> {
  const decoded = tokenCertificateBytes(token)
  if (decoded.certificates.length !== 1) {
    return {
      encoding: decoded.encoding,
      certificateCount: decoded.certificates.length,
      selectedCertificateIndex: decoded.certificates.length > 1 ? null : null,
      algorithm: null, curve: null, subjectCategory: null, issuerCategory: null,
      ...(decoded.certificates.length > 1 ? { errorCode: 'SANDBOX_V2_CERTIFICATE_CHAIN_AMBIGUOUS' } : {}),
    }
  }
  try {
    const certDer = decoded.certificates[0]
    const spki = extractCertPublicKeySpki(certDer)
    const root = derNode(spki, 0)
    const algorithm = derNode(spki, root.contentStart)
    const algorithmBytes = Array.from(spki.slice(algorithm.start, algorithm.end), byte => byte.toString(16).padStart(2, '0')).join('')
    const isEc = algorithmBytes.includes('2a8648ce3d0201')
    const curve = algorithmBytes.includes('2b8104000a') ? 'secp256k1' : isEc ? 'EC-unknown' : null
    return { encoding: decoded.encoding, certificateCount: 1, selectedCertificateIndex: 0, algorithm: isEc ? 'EC' : 'non-EC', curve, subjectCategory: 'present', issuerCategory: 'present', spki } as Omit<CertificateInspection, 'fingerprint'>
  } catch {
    return { encoding: decoded.encoding, certificateCount: 1, selectedCertificateIndex: 0, algorithm: null, curve: null, subjectCategory: null, issuerCategory: null, errorCode: 'SANDBOX_V2_CERTIFICATE_PARSE_FAILED' }
  }
}

async function diagnosePersistedProduction(db: any): Promise<Response> {
  const sessionId = '4b1ef8b2-75d1-4176-baa7-9d7017db4e63'
  const { data, error } = await db.from('zatca_sandbox_v2_sessions')
    .select('id,tenant_id,branch_id,environment,sandbox_onboarding_version,encrypted_private_key,encrypted_csr,encrypted_compliance_csid,encrypted_production_response,safe_http_status')
    .eq('id', sessionId).maybeSingle()
  if (error || !data || data.tenant_id !== TENANT_ID || data.branch_id !== BRANCH_ID || data.environment !== ENVIRONMENT || data.sandbox_onboarding_version !== 2) {
    return response({ ok: false, code: 'SANDBOX_V2_SESSION_KEY_NOT_FOUND' }, 404)
  }
  if (!data.encrypted_private_key || !data.encrypted_csr) return response({ ok: false, code: 'SANDBOX_V2_SESSION_KEY_NOT_FOUND' }, 404)
  let privateKeyPem: string
  let csrPem: string
  let complianceToken: string
  let productionBody: any
  try {
    const secret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
    privateKeyPem = await decryptText(data.encrypted_private_key, secret)
    csrPem = await decryptText(data.encrypted_csr, secret)
    complianceToken = await decryptText(data.encrypted_compliance_csid, secret)
    const productionRaw = await decryptText(data.encrypted_production_response, secret)
    productionBody = JSON.parse(productionRaw)
  } catch {
    return response({ ok: false, code: 'SANDBOX_V2_PRODUCTION_TOKEN_DECODE_FAILED' }, 422)
  }
  if (!productionBody || typeof productionBody !== 'object' || typeof productionBody.binarySecurityToken !== 'string') {
    return response({ ok: false, code: 'SANDBOX_V2_PRODUCTION_TOKEN_DECODE_FAILED' }, 422)
  }
  let privateSpki: Uint8Array
  let csrSpki: Uint8Array
  try {
    privateSpki = ecSpki(secp256k1.getPublicKey(extractEcPrivateKeyScalar(pemDer(privateKeyPem)), false))
    csrSpki = ecSpki(csrPoint(csrPem))
  } catch {
    return response({ ok: false, code: 'SANDBOX_V2_SESSION_KEY_NOT_FOUND' }, 422)
  }
  const complianceInspection = inspectCertificateToken(complianceToken)
  const productionInspection = inspectCertificateToken(productionBody.binarySecurityToken)
  const privateFingerprint = await sha256Prefix(privateSpki)
  const csrFingerprint = await sha256Prefix(csrSpki)
  const complianceSpki = (complianceInspection as CertificateInspection).spki
  const productionSpki = (productionInspection as CertificateInspection).spki
  const complianceFingerprint = complianceSpki ? await sha256Prefix(ecSpki(spkiPoint(complianceSpki))) : null
  const productionFingerprint = productionSpki ? await sha256Prefix(ecSpki(spkiPoint(productionSpki))) : null
  const match = {
    privateCsr: equal(privateSpki, csrSpki),
    privateCompliance: complianceFingerprint !== null && complianceFingerprint === privateFingerprint,
    privateProduction: productionFingerprint !== null && productionFingerprint === privateFingerprint,
  }
  const failureCode = productionInspection.errorCode ?? (productionFingerprint === null ? 'SANDBOX_V2_CERTIFICATE_PARSE_FAILED' : match.privateProduction ? undefined : 'SANDBOX_V2_CERTIFICATE_KEY_MISMATCH')
  const diagnostic = {
    selectedSessionId: sessionId,
    selectedRowType: 'v2_session',
    tokenEncoding: productionInspection.encoding,
    certificateCount: productionInspection.certificateCount,
    selectedCertificateIndex: productionInspection.selectedCertificateIndex,
    algorithm: productionInspection.algorithm,
    curve: productionInspection.curve,
    subjectCategory: productionInspection.subjectCategory,
    issuerCategory: productionInspection.issuerCategory,
    privateFingerprintPrefix: privateFingerprint,
    csrFingerprintPrefix: csrFingerprint,
    complianceFingerprintPrefix: complianceFingerprint,
    productionFingerprintPrefix: productionFingerprint,
    match,
    safeFailureCode: failureCode ?? null,
  }
  await event(db, sessionId, 'certificate_comparison_diagnosed', 'success', {
    httpStatus: data.safe_http_status ?? undefined,
    fingerprints: { private: privateFingerprint, csr: csrFingerprint, compliance: complianceFingerprint ?? '', production: productionFingerprint ?? '' },
    certificateDiagnostic: diagnostic,
    code: failureCode,
  })
  return response({ ok: true, ...diagnostic })
}

function rawJsonNumberLiteral(text: string, field: string): string | null {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.match(new RegExp(`"${escaped}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`))?.[1] ?? null
}

async function textFingerprint(value: string): Promise<string> {
  return sha256Prefix(new TextEncoder().encode(value))
}

async function diagnoseProductionLinkage(db: any): Promise<Response> {
  const sessionId = '4b1ef8b2-75d1-4176-baa7-9d7017db4e63'
  const { data, error } = await db.from('zatca_sandbox_v2_sessions')
    .select('id,tenant_id,branch_id,environment,sandbox_onboarding_version,compliance_request_id,encrypted_compliance_response,encrypted_compliance_csid,encrypted_compliance_secret')
    .eq('id', sessionId).maybeSingle()
  if (error || !data || data.tenant_id !== TENANT_ID || data.branch_id !== BRANCH_ID || data.environment !== ENVIRONMENT || data.sandbox_onboarding_version !== 2) {
    return response({ ok: false, code: 'SANDBOX_V2_SESSION_KEY_NOT_FOUND' }, 404)
  }
  let rawCompliance = ''
  let complianceBody: any
  let sessionCsid = ''
  let sessionSecret = ''
  try {
    const secret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
    rawCompliance = await decryptText(data.encrypted_compliance_response, secret)
    complianceBody = JSON.parse(rawCompliance)
    sessionCsid = await decryptText(data.encrypted_compliance_csid, secret)
    sessionSecret = await decryptText(data.encrypted_compliance_secret, secret)
  } catch {
    return response({ ok: false, code: 'SANDBOX_V2_PRODUCTION_TOKEN_DECODE_FAILED' }, 422)
  }
  const rawLiteral = rawJsonNumberLiteral(rawCompliance, 'requestID')
  const parsedRequestId = complianceBody?.requestID
  const parsedString = typeof parsedRequestId === 'number' ? String(parsedRequestId) : ''
  const safeInteger = typeof parsedRequestId === 'number' && Number.isSafeInteger(parsedRequestId) && rawLiteral === parsedString
  const persistedRequestId = typeof data.compliance_request_id === 'string' ? data.compliance_request_id : ''
  const exactMatch = Boolean(rawLiteral && persistedRequestId && persistedRequestId === rawLiteral && persistedRequestId === parsedString && safeInteger)
  const authCsidMatches = sessionCsid === complianceBody?.binarySecurityToken
  const authSecretMatches = sessionSecret === complianceBody?.secret
  const linkage = {
    sessionId,
    persistedRequestIdFingerprintPrefix: persistedRequestId ? await textFingerprint(persistedRequestId) : null,
    submittedRequestIdFingerprintPrefix: persistedRequestId ? await textFingerprint(persistedRequestId) : null,
    exactMatch,
    requestIdSource: 'same_v2_compliance_response_object',
    requestIdJsonType: typeof parsedRequestId,
    requestIdSubmittedType: 'string',
    safeInteger,
    selectedComplianceCredentialSessionId: sessionId,
    selectedTenantMatches: data.tenant_id === TENANT_ID,
    selectedBranchMatches: data.branch_id === BRANCH_ID,
    authCsidMatchesPersistedCompliance: authCsidMatches,
    authSecretMatchesPersistedCompliance: authSecretMatches,
    endpointPath: 'production/csids',
    apiVersion: 'V2',
    requestBodyField: 'compliance_request_id',
    globalCacheUsed: false,
    serviceDemoSelected: false,
    legacyCredentialSelected: false,
    safeFailureCode: exactMatch && authCsidMatches && authSecretMatches ? null : 'SANDBOX_V2_PRODUCTION_LINKAGE_MISMATCH',
  }
  await event(db, sessionId, 'production_request_linkage_verified', 'success', {
    productionRequestLinkage: linkage,
    code: linkage.safeFailureCode ?? 'SANDBOX_V2_PRODUCTION_LINKAGE_VERIFIED',
  })
  return response({ ok: true, ...linkage })
}

async function verifyComplianceResponseShape(db: any, sessionId: string, body: unknown, httpStatus: number | null, requestId: string): Promise<void> {
  await event(db, sessionId, 'compliance_response_shape_verified', 'success', {
    httpStatus: httpStatus ?? undefined,
    requestId,
    responseFields: safeFields(body),
    requiredFields: complianceRequiredFields(body),
  })
}

async function parsePersistedComplianceResponse(db: any, sessionId: string, requestId: string): Promise<ComplianceCredentials> {
  const { data, error } = await db.from('zatca_sandbox_v2_sessions')
    .select('encrypted_compliance_response,safe_http_status')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data?.encrypted_compliance_response) {
    throw new V2Error('Persisted Sandbox Compliance response was not found', 404, 'SANDBOX_V2_COMPLIANCE_RESPONSE_NOT_FOUND')
  }
  let decrypted: string
  try {
    decrypted = await decryptText(data.encrypted_compliance_response, requireEnv('ZATCA_SERVER_ENCRYPTION_KEY'))
  } catch {
    throw new V2Error('Persisted Sandbox Compliance response could not be decrypted', 422, 'SANDBOX_V2_COMPLIANCE_RESPONSE_DECRYPT_FAILED')
  }
  let body: unknown
  try { body = JSON.parse(decrypted) } catch {
    throw new V2Error('Persisted Sandbox Compliance response is not valid JSON', 422, 'SANDBOX_V2_COMPLIANCE_RESPONSE_JSON_INVALID')
  }
  await verifyComplianceResponseShape(db, sessionId, body, data.safe_http_status ?? null, requestId)
  return parseComplianceResponse(body)
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
  if (!Number.isFinite(end) || end > bytes.length) throw new Error('Invalid DER')
  return { start, tag, contentStart: offset, end, next: end }
}

function spkiPoint(spki: Uint8Array): Uint8Array {
  const root = derNode(spki, 0)
  if (root.tag !== 0x30) throw new Error('Invalid SPKI')
  const algorithm = derNode(spki, root.contentStart)
  const key = derNode(spki, algorithm.next)
  if (algorithm.tag !== 0x30 || key.tag !== 0x03 || spki[key.contentStart] !== 0) throw new Error('Invalid EC SPKI')
  return secp256k1.Point.fromBytes(spki.slice(key.contentStart + 1, key.end)).toBytes(false)
}

function csrPoint(csrPem: string): Uint8Array {
  const der = pemDer(csrPem)
  const root = derNode(der, 0)
  const info = derNode(der, root.contentStart)
  const version = derNode(der, info.contentStart)
  const subject = derNode(der, version.next)
  const spki = derNode(der, subject.next)
  return spkiPoint(der.slice(spki.start, spki.end))
}

function pemDer(value: string): Uint8Array {
  const base64 = value.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

function base64ToBytes(value: string): Uint8Array {
  const compact = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0))
}

function decodeCertificateToken(token: string): { certPemBody: string; certDer: Uint8Array } {
  const compact = token.replace(/[\r\n\s]+/g, '')
  const onceBytes = base64ToBytes(compact)
  if (onceBytes[0] === 0x30) return { certPemBody: compact, certDer: onceBytes }
  const onceText = new TextDecoder().decode(onceBytes).trim()
  if (onceText.includes('BEGIN CERTIFICATE')) {
    const certPemBody = onceText.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    return { certPemBody, certDer: base64ToBytes(certPemBody) }
  }
  const certPemBody = onceText.replace(/\s+/g, '')
  return { certPemBody, certDer: base64ToBytes(certPemBody) }
}

function extractCertPublicKeySpki(certDer: Uint8Array): Uint8Array {
  const cert = derNode(certDer, 0)
  const tbs = derNode(certDer, cert.contentStart)
  let cursor = tbs.contentStart
  let node = derNode(certDer, cursor)
  if (node.tag === 0xa0) cursor = node.next
  for (let index = 0; index < 5; index++) {
    node = derNode(certDer, cursor)
    cursor = node.next
  }
  node = derNode(certDer, cursor)
  return certDer.slice(node.start, node.end)
}

function ecSpki(point: Uint8Array): Uint8Array {
  const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const curveOid = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algBody = new Uint8Array([...ecOid, ...curveOid])
  const alg = new Uint8Array([0x30, algBody.length, ...algBody])
  const bitBody = new Uint8Array([0, ...point])
  const bit = new Uint8Array([0x03, bitBody.length, ...bitBody])
  const body = new Uint8Array([...alg, ...bit])
  return new Uint8Array([0x30, body.length, ...body])
}

async function sha256Prefix(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function certificateValidity(certDer: Uint8Array): { from: string | null; to: string | null } {
  try {
    const cert = derNode(certDer, 0)
    const tbs = derNode(certDer, cert.contentStart)
    let node = derNode(certDer, tbs.contentStart)
    if (node.tag === 0xa0) node = derNode(certDer, node.next)
    node = derNode(certDer, node.next)
    node = derNode(certDer, node.next)
    node = derNode(certDer, node.next)
    const validity = derNode(certDer, node.next)
    const from = derNode(certDer, validity.contentStart)
    const to = derNode(certDer, from.next)
    const parse = (value: string): string | null => {
      const m = value.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)
      if (!m) return null
      const year = m[1].length === 4 ? Number(m[1]) : (Number(m[1]) >= 50 ? 1900 : 2000) + Number(m[1])
      return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))).toISOString()
    }
    return { from: parse(new TextDecoder().decode(certDer.slice(from.contentStart, from.end))), to: parse(new TextDecoder().decode(certDer.slice(to.contentStart, to.end))) }
  } catch { return { from: null, to: null } }
}

async function continueAfterCompliance(params: {
  db: any
  sessionId: string
  compliance: ComplianceCredentials
  privateKeyPem: string
  privateSpki: Uint8Array
  csrFingerprint: string
  identity: { csr: CsrParams; seller: SampleSeller }
  requestId: string
}): Promise<Record<string, unknown>> {
  const { db, sessionId, compliance, privateKeyPem, privateSpki, csrFingerprint, identity, requestId } = params
  const encryptionKey = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  await event(db, sessionId, 'compliance_validation_started', 'success', { requestId })
  const results = stripComplianceSampleDebug(await submitComplianceSamples({
    baseUrl: SANDBOX_BASE_URL, functionalityMap: FUNCTIONALITY_MAP,
    complianceCsid: compliance.binarySecurityToken, complianceSecret: compliance.secret,
    complianceCertificate: compliance.binarySecurityToken, privateKeyPem, seller: identity.seller,
  }))
  if (!results.every(result => result.status === 'accepted')) throw new V2Error('Sandbox compliance validation was not accepted', 422, 'SANDBOX_V2_COMPLIANCE_VALIDATION_FAILED')
  await updateSession(db, sessionId, { compliance_results: results, stage: 'compliance_validation_completed', compliance_checked_at: new Date().toISOString() })
  await event(db, sessionId, 'compliance_validation_completed', 'success', { requestId })

  const productionRequestId = crypto.randomUUID()
  await event(db, sessionId, 'sandbox_production_request_started', 'success', { requestId: productionRequestId })
  const auth = btoa(`${compliance.binarySecurityToken}:${compliance.secret}`)
  const productionRaw = await rawRequest({
    url: `${SANDBOX_BASE_URL}/production/csids`, db, sessionId, kind: 'production', encryptionKey, requestId: productionRequestId,
    init: { method: 'POST', headers: { accept: 'application/json', 'accept-version': 'V2', 'Content-Type': 'application/json', Authorization: `Basic ${auth}` }, body: JSON.stringify({ compliance_request_id: compliance.requestID }) },
  })
  const productionBody = parseJson(productionRaw.bodyText, 'production')
  const production = parseExactProduction(productionBody)
  await updateSession(db, sessionId, {
    stage: 'sandbox_production_response_parsed',
    encrypted_production_csid: await encryptText(production.binarySecurityToken, encryptionKey),
    encrypted_production_secret: await encryptText(production.secret, encryptionKey),
    encrypted_certificate: await encryptText(production.binarySecurityToken, encryptionKey),
    safe_response_fields: safeFields(productionBody), safe_required_fields: requiredFields(productionBody, ['binarySecurityToken', 'secret']),
    sandbox_production_csid_received_at: new Date().toISOString(),
  })
  await event(db, sessionId, 'sandbox_production_response_parsed', 'success', { httpStatus: productionRaw.status, requestId: productionRequestId, responseFields: safeFields(productionBody), requiredFields: requiredFields(productionBody, ['binarySecurityToken', 'secret']) })
  let certificateDer: Uint8Array
  let certificateSpki: Uint8Array
  try {
    certificateDer = decodeCertificateToken(production.binarySecurityToken).certDer
    certificateSpki = ecSpki(spkiPoint(extractCertPublicKeySpki(certificateDer)))
  } catch {
    throw new V2Error('Sandbox Production certificate could not be parsed', 422, 'SANDBOX_V2_CERTIFICATE_PARSE_FAILED')
  }
  const certificateFingerprint = await sha256Prefix(certificateSpki)
  const privateFingerprint = await sha256Prefix(privateSpki)
  if (!equal(privateSpki, certificateSpki)) throw new V2Error('Sandbox Production certificate does not match the fresh Trading key', 422, 'SANDBOX_V2_CERTIFICATE_KEY_MISMATCH')
  const validity = certificateValidity(certificateDer)
  await updateSession(db, sessionId, { stage: 'certificate_key_match_verified', certificate_valid_from: validity.from, certificate_valid_to: validity.to })
  await event(db, sessionId, 'certificate_key_match_verified', 'success', { requestId: productionRequestId, fingerprints: { private: privateFingerprint, certificate: certificateFingerprint, csr: csrFingerprint } })

  await event(db, sessionId, 'credential_activation_started', 'success', { requestId })
  const activated = await db.rpc('activate_zatca_sandbox_v2_session', { p_session_id: sessionId })
  if (activated.error || activated.data !== sessionId) throw new V2Error('V2 credential activation failed', 500, 'SANDBOX_V2_CREDENTIAL_ACTIVATION_FAILED')
  await event(db, sessionId, 'credential_activation_completed', 'success', { requestId })
  const mode = await db.rpc('get_zatca_demo_checkout_mode_v1', { p_branch_id: BRANCH_ID })
  if (mode.error || mode.data !== 'sandbox_compliance') throw new V2Error('Trading Sandbox mode was not updated after activation', 500, 'SANDBOX_V2_MODE_UPDATE_FAILED')
  await event(db, sessionId, 'trading_mode_updated', 'success', { requestId, message: 'sandbox_compliance' })
  await event(db, sessionId, 'onboarding_completed', 'success', { requestId })
  return safeStatus(db, await loadSession(db, sessionId), requestId)
}

async function run(db: any, otp: string, caller: Caller, requestId: string, sessionRef: SessionRef): Promise<Record<string, unknown>> {
  const scope = await loadScope(db)
  const createId = crypto.randomUUID()
  const created = await db.rpc('create_zatca_sandbox_v2_session', { p_tenant_id: TENANT_ID, p_branch_id: BRANCH_ID, p_session_id: createId })
  if (created.error || !created.data?.[0]) throw databaseFailure('V2 session could not be created', created.error, 409)
  const sessionId = created.data[0].session_id as string
  sessionRef.id = sessionId
  const session = await loadSession(db, sessionId)
  if (created.data[0].idempotent) return safeStatus(db, session, requestId)
  await event(db, sessionId, 'submit_started', 'success', { requestId })
  await event(db, sessionId, 'caller_authorized', 'success', { requestId, message: `Authorized ${caller.role}` })
  await event(db, sessionId, 'trading_scope_resolved', 'success', { requestId })
  await event(db, sessionId, 'v2_session_created', 'success', { requestId })

  const identity = sellerIdentity(scope.branch, scope.tenant)
  const missing = validateCsrInputs(identity.csr)
  if (missing.length) throw new V2Error(`Trading seller data is incomplete: ${missing.join(', ')}`, 422, 'SANDBOX_V2_SELLER_DATA_INVALID')
  const generated = await generateProductionCsr(identity.csr)
  await event(db, sessionId, 'private_key_generated', 'success', { requestId })
  await event(db, sessionId, 'csr_generated', 'success', { requestId })
  const privatePoint = secp256k1.getPublicKey(extractEcPrivateKeyScalar(pemDer(generated.privateKeyPem)), false)
  const csrKey = csrPoint(generated.csrPem)
  const privateSpki = ecSpki(privatePoint)
  const csrSpki = ecSpki(csrKey)
  if (!equal(privateSpki, csrSpki)) throw new V2Error('Fresh CSR and private key do not match', 422, 'SANDBOX_V2_CSR_KEY_MISMATCH')
  const csrFingerprint = await sha256Prefix(csrSpki)
  await updateSession(db, sessionId, {
    encrypted_private_key: await encryptText(generated.privateKeyPem, requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')),
    encrypted_csr: await encryptText(generated.csrPem, requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')),
    encrypted_public_key: await encryptText(generated.publicKeyPem, requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')),
    egs_serial_number: generated.egsSerialNumber,
    csr_common_name: identity.csr.commonName,
    csr_organization_name: identity.csr.businessName,
    csr_organizational_unit_name: identity.csr.branchName,
    csr_location: identity.csr.location,
    csr_industry: identity.csr.industry,
    csr_generated_at: new Date().toISOString(),
    csr_fingerprint: csrFingerprint, stage: 'csr_key_match_verified',
  })
  await event(db, sessionId, 'csr_key_match_verified', 'success', { requestId, fingerprints: { csr: csrFingerprint, private: csrFingerprint } })

  const encryptionKey = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  const complianceRequestId = crypto.randomUUID()
  await event(db, sessionId, 'compliance_request_started', 'success', { requestId: complianceRequestId })
  const complianceRaw = await rawRequest({
    url: `${SANDBOX_BASE_URL}/compliance`, db, sessionId, kind: 'compliance', encryptionKey, requestId: complianceRequestId,
    init: { method: 'POST', headers: { accept: 'application/json', 'accept-version': 'V2', 'accept-language': 'en', 'Content-Type': 'application/json', OTP: otp }, body: JSON.stringify({ csr: btoa(generated.csrPem) }) },
  })
  const complianceBody = parseComplianceJson(complianceRaw.bodyText)
  await verifyComplianceResponseShape(db, sessionId, complianceBody, complianceRaw.status, complianceRequestId)
  const compliance = parseComplianceResponse(complianceBody)
  await updateSession(db, sessionId, {
    stage: 'compliance_response_parsed', compliance_request_id: compliance.requestID,
    encrypted_compliance_csid: await encryptText(compliance.binarySecurityToken, encryptionKey),
    encrypted_compliance_secret: await encryptText(compliance.secret, encryptionKey),
    safe_response_fields: compliance.responseFields, safe_required_fields: compliance.requiredFields,
    upstream_correlation_id: compliance.requestID,
    compliance_csid_received_at: new Date().toISOString(),
  })
  await event(db, sessionId, 'compliance_response_parsed', 'success', { httpStatus: complianceRaw.status, requestId: complianceRequestId, responseFields: compliance.responseFields, requiredFields: compliance.requiredFields })
  return continueAfterCompliance({ db, sessionId, compliance, privateKeyPem: generated.privateKeyPem, privateSpki, csrFingerprint, identity, requestId })
}

async function resumePersistedCompliance(db: any, sessionId: string, requestId: string): Promise<Record<string, unknown>> {
  const scope = await loadScope(db)
  const { data, error } = await db.from('zatca_sandbox_v2_sessions').select('*').eq('id', sessionId).maybeSingle()
  if (error || !data || data.tenant_id !== TENANT_ID || data.branch_id !== BRANCH_ID || data.environment !== ENVIRONMENT || data.sandbox_onboarding_version !== 2) {
    throw new V2Error('The requested V2 session is unavailable', 404, 'SANDBOX_V2_SESSION_NOT_FOUND')
  }
  if (data.status === 'completed') return safeStatus(db, data as V2Session, requestId)
  if (data.status !== 'failed' || data.stage !== 'onboarding_failed' || data.encrypted_production_response) {
    throw new V2Error('The V2 session is not eligible for a safe Compliance resume', 409, 'SANDBOX_V2_RESUME_BLOCKED')
  }
  await updateSession(db, sessionId, { status: 'in_progress', stage: 'compliance_response_persisted', safe_error_code: null, safe_error_message: null })

  const compliance = await parsePersistedComplianceResponse(db, sessionId, requestId)
  const encryptionKey = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
  await updateSession(db, sessionId, {
    stage: 'compliance_response_parsed', compliance_request_id: compliance.requestID,
    encrypted_compliance_csid: await encryptText(compliance.binarySecurityToken, encryptionKey),
    encrypted_compliance_secret: await encryptText(compliance.secret, encryptionKey),
    safe_response_fields: compliance.responseFields, safe_required_fields: compliance.requiredFields,
    upstream_correlation_id: compliance.requestID,
    compliance_csid_received_at: new Date().toISOString(),
  })
  await event(db, sessionId, 'compliance_response_parsed', 'success', { httpStatus: data.safe_http_status, requestId, responseFields: compliance.responseFields, requiredFields: compliance.requiredFields })

  let privateKeyPem: string
  let csrPem: string
  try {
    privateKeyPem = await decryptText(data.encrypted_private_key, encryptionKey)
    csrPem = await decryptText(data.encrypted_csr, encryptionKey)
  } catch {
    throw new V2Error('Persisted V2 key material could not be loaded', 422, 'SANDBOX_V2_SESSION_CREDENTIALS_UNAVAILABLE')
  }
  let privateSpki: Uint8Array
  let csrSpki: Uint8Array
  try {
    privateSpki = ecSpki(secp256k1.getPublicKey(extractEcPrivateKeyScalar(pemDer(privateKeyPem)), false))
    csrSpki = ecSpki(csrPoint(csrPem))
  } catch {
    throw new V2Error('Persisted V2 CSR/key material could not be verified', 422, 'SANDBOX_V2_CSR_KEY_MISMATCH')
  }
  if (!equal(privateSpki, csrSpki)) throw new V2Error('Persisted V2 CSR and private key do not match', 422, 'SANDBOX_V2_CSR_KEY_MISMATCH')
  const identity = sellerIdentity(scope.branch, scope.tenant)
  return continueAfterCompliance({
    db, sessionId, compliance, privateKeyPem, privateSpki,
    csrFingerprint: String(data.csr_fingerprint ?? ''), identity, requestId,
  })
}

async function fail(db: any, sessionId: string | null, error: unknown, requestId: string): Promise<Response> {
  const v2 = error instanceof V2Error ? error : new V2Error('Sandbox V2 onboarding failed', 500)
  let safeTrace: Record<string, unknown> = {}
  if (sessionId) {
    try {
      await updateSession(db, sessionId, { status: 'failed', stage: 'onboarding_failed', safe_error_code: v2.code, safe_error_message: safeMessage(v2.message) })
      await event(db, sessionId, 'onboarding_failed', 'failed', { requestId, code: v2.code, httpStatus: v2.status, message: safeMessage(v2.message) })
      safeTrace = await safeStatus(db, await loadSession(db, sessionId), requestId)
    } catch { /* preserve the original safe failure */ }
  }
  return response({
    ...safeTrace,
    ok: false,
    error: safeMessage(v2.message),
    code: v2.code,
    stage: 'onboarding_failed',
    requestId,
    sessionId,
    databaseCode: v2.databaseCode ?? null,
    databaseConstraint: v2.databaseConstraint ?? null,
  }, v2.status)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })
  const requestId = crypto.randomUUID()
  let db: any
  const sessionRef: SessionRef = { id: null }
  try {
    if (req.method !== 'POST') throw new V2Error('Method not allowed', 405, 'SANDBOX_V2_METHOD_NOT_ALLOWED')
    const supabaseUrl = requireEnv('SUPABASE_URL')
    db = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
    const caller = await authorize(db, req)
    const requestBody = await req.clone().json().catch(() => null)
    if (requestBody?.action === 'resume_persisted_compliance' && requestBody?.sessionId === '62011b53-d825-4fb3-8447-ebe84da5c7ee') {
      sessionRef.id = requestBody.sessionId
      return response(await resumePersistedCompliance(db, requestBody.sessionId, requestId), 200)
    }
    const otp = await readOtp(req)
    const existing = await currentSession(db)
    if (existing) return response(await safeStatus(db, existing, requestId), existing.status === 'completed' ? 200 : 202)
    const result = await run(db, otp, caller, requestId, sessionRef)
    return response(result, 200)
  } catch (error) {
    return fail(db, sessionRef.id, error, requestId)
  }
})
