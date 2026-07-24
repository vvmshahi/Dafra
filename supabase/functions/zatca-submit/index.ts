/**
 * zatca-submit Edge Function — Full ZATCA Phase 2 pipeline (server-side Deno)
 *
 * Receives { invoiceId } from browser, then does everything:
 *   1. Fetch invoice + branch + active cert from DB
 *   2. Decrypt private key (AES-256-GCM / PBKDF2)
 *   3. Build UBL XML
 *   4. Sign (XAdES, secp256k1)
 *   5. Submit to ZATCA reporting/clearance API
 *   6. Update invoice status in DB
 *   7. Queue for retry on failure
 *
 * Replaces browser-side node-forge / xmlbuilder2 usage (polyfill conflicts).
 * All npm deps (node-forge, xmlbuilder2, @noble/curves) work natively in Deno.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create as xmlCreate } from 'https://esm.sh/xmlbuilder2@4.0.3'
import { secp256k1 } from 'https://esm.sh/@noble/curves@2.2.0/secp256k1.js'
import { extractEcPrivateKeyScalar, signZatcaInvoiceHash } from '../_shared/zatca/signing_core.mjs'
import { buildZatcaPhase2Qr } from '../_shared/zatca/phase2_qr.mjs'
import { parseZatcaClearedInvoice } from '../_shared/zatca/cleared_artifact.mjs'
import { selectZatcaBranchCheckoutMode } from '../_shared/zatca/branch_readiness.mjs'
import {
  parseImmutableFinalizationEdgeSwitch,
  resolveAtomicSimplifiedCheckoutCapability,
} from '../_shared/zatca/finalization_capabilities.mjs'
import {
  REPORTING_OUTCOMES,
  clampReportingBatchSize,
  classifyReportingHttpOutcome,
} from '../_shared/zatca/reporting_outcome.mjs'
import {
  authorizeDrainRequest,
} from '../_shared/zatca/internal_drain_auth.mjs'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'

// ── Constants ────────────────────────────────────────────────────────────────

const ZATCA_URLS: Record<string, string> = {
  sandbox:    'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
}

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const FIRST_INVOICE_HASH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

const FINALIZATION_SCHEMA_VERSION = 2
const FINALIZATION_EDGE_VERSION = '2.1.0'
const FINALIZATION_CLIENT_VERSION = '2.1.0'
const OUTPUT_STATE_READ_CLIENT_VERSIONS = new Set(['2.0.0', FINALIZATION_CLIENT_VERSION])
const ZATCA_OUTBOX_PROJECT_REF = 'bkbphkpqcxuejozayrsy'
const RECOVERY_BRANCH_ID = '371dee75-6e46-496e-89e7-1a7492b51a3c'
const IMMUTABLE_RECOVERY_TARGETS = Object.freeze([
  {
    invoiceId: '0121e5c8-14bf-45ec-bf29-3b0466a18bab',
    invoiceNumber: 'INV-0826',
    counterNumber: 865,
    previousHash: 't3CZaYvRmwniI6rCyL+OfITTxHJQ5BdA1CjvdgVN1cY=',
    artifactHash: 'Fcs7MaZh3flIRjoAtZUW3nd3mS1PqqOxsIlJMkhAu48=',
  },
  {
    invoiceId: '3ae21515-0807-463e-919d-19f40eb5b406',
    invoiceNumber: 'INV-0827',
    counterNumber: 866,
    previousHash: 'Fcs7MaZh3flIRjoAtZUW3nd3mS1PqqOxsIlJMkhAu48=',
    artifactHash: '1sjvDue9saSjyaN4Dh0RfVwgYt3J75zSHOxdd3wmjvY=',
  },
])

interface SubmissionCredentials {
  environment: 'sandbox' | 'production'
  privateKey: Uint8Array
  productionCsid: string
  productionSecret: string
  legacyCertId?: string
  legacyInvoiceCounter?: number
}

interface SubmitDiagnostics {
  source?: string
  environment?: 'sandbox' | 'production'
  invoiceId?: string
  branchId?: string
  invoiceType?: string
  endpointKind?: 'reporting' | 'clearance'
  httpStatus?: number
  validationStatus?: string
  reportingStatus?: string
  clearanceStatus?: string
  errorCodes?: string[]
  warningCodes?: string[]
  invoiceHash?: string
  finalXmlHash?: string
  qrHash?: string
  dsDigestValue?: string
  storedPreviousHash?: string | null
  resolvedPreviousHash?: string
  previousHashSource?: string
  zatcaCounterNumber?: number
  issueDate?: string
  issueTime?: string
  qrTimestamp?: string
  signingTime?: string
  hashMatches?: boolean
  qrHashMatches?: boolean
  digestMatches?: boolean
  storedHashMatches?: boolean
  timestampMatches?: boolean
  certificateIssuerMatches?: boolean
  certificateSerialMatches?: boolean
  privateKeyMatchesCertificate?: boolean
}

class ZatcaSubmitAssertionError extends Error {
  statusString: string
  diagnostics: SubmitDiagnostics

  constructor(statusString: string, message: string, diagnostics: SubmitDiagnostics) {
    super(message)
    this.name = 'ZatcaSubmitAssertionError'
    this.statusString = statusString
    this.diagnostics = diagnostics
  }
}

interface CallerProfile {
  id: string
  role: string
  tenant_id: string | null
  branch_id: string | null
  is_active: boolean
}

interface AuthorizedTarget {
  tenantId: string
  branchId: string
  v2Invoice?: boolean
}

const TENANT_SUBMIT_ROLES = new Set(['owner', 'admin'])
const AUTO_SUBMIT_SOURCES = new Set(['auto_checkout', 'auto_credit_note'])
const SUBMIT_SOURCES = new Set(['auto_checkout', 'auto_credit_note', 'manual_retry', 'bulk_retry'])
type SubmitAction =
  | 'submit'
  | 'finalize'
  | 'status'
  | 'capabilities'
  | 'retry'
  | 'recover_immutable_pair'
  | 'checkout_simplified'
  | 'checkout_simplified_credit_note'

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function bearerToken(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
}

function canSubmitForTarget(caller: CallerProfile, target: AuthorizedTarget): boolean {
  const role = caller.role
  if (!caller.tenant_id) return false

  if (TENANT_SUBMIT_ROLES.has(role)) {
    return target.tenantId === caller.tenant_id
  }

  if (role === 'branch') {
    return (
      target.tenantId === caller.tenant_id &&
      !!caller.branch_id &&
      target.branchId === caller.branch_id
    )
  }

  return false
}

function logSubmitAuthorization(params: {
  invoiceId?: string | null
  tenantId?: string | null
  branchId?: string | null
  callerRole?: string | null
  allowed: boolean
}) {
  console.info('[zatca-submit] authorization decision:', {
    invoiceId: params.invoiceId ?? null,
    tenantId: params.tenantId ?? null,
    branchId: params.branchId ?? null,
    callerRole: params.callerRole ?? null,
    allowed: params.allowed,
  })
}

function normalizeSubmitSource(value: unknown): string {
  return typeof value === 'string' && SUBMIT_SOURCES.has(value) ? value : 'manual_retry'
}

function normalizeSubmitAction(value: unknown): SubmitAction {
  if (value === 'capability') return 'capabilities'
  return value === 'finalize'
    || value === 'status'
    || value === 'capabilities'
    || value === 'retry'
    || value === 'recover_immutable_pair'
    || value === 'checkout_simplified'
    || value === 'checkout_simplified_credit_note'
    ? value
    : 'submit'
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    )
  }
  return value
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value))
}

async function sha256HexText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function logPipelineTiming(
  event: string,
  startedAt: number,
  fields: Record<string, unknown> = {},
): void {
  console.info('[zatca-timing]', {
    event,
    elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    ...fields,
  })
}

async function loadCallerProfile(db: any, userId: string): Promise<CallerProfile | null> {
  const { data, error } = await db
    .from('user_profiles')
    .select('id, role, tenant_id, branch_id, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[zatca-submit] caller profile lookup failed:', safeZatcaText(error.message, 160))
    return null
  }

  if (!data?.id || !data?.role || data.is_active !== true) return null

  return {
    id: data.id,
    role: String(data.role),
    tenant_id: data.tenant_id ?? null,
    branch_id: data.branch_id ?? null,
    is_active: true,
  }
}

async function authorizeInvoiceSubmission(
  db: any,
  invoiceId: string,
  caller: CallerProfile,
): Promise<{ ok: true; target: AuthorizedTarget } | { ok: false; response: Response }> {
  const { data: invoice, error } = await db
    .from('invoices')
    .select('id, tenant_id, branch_id, zatca_finalization_version, zatca_artifact_provenance')
    .eq('id', invoiceId)
    .maybeSingle()

  if (error) {
    console.warn('[zatca-submit] invoice authorization lookup failed:', safeZatcaText(error.message, 160))
    return { ok: false, response: jsonResponse({ error: 'Unable to verify invoice access' }, 500) }
  }

  if (!invoice?.id || !invoice?.tenant_id || !invoice?.branch_id) {
    logSubmitAuthorization({
      invoiceId,
      callerRole: caller.role,
      allowed: false,
    })
    return { ok: false, response: jsonResponse({ error: 'Invoice not found or access denied' }, 404) }
  }

  const target = {
    tenantId: invoice.tenant_id as string,
    branchId: invoice.branch_id as string,
    v2Invoice: invoice.zatca_finalization_version === 2
      && invoice.zatca_artifact_provenance === 'server_v2',
  }
  const allowed = canSubmitForTarget(caller, target)

  logSubmitAuthorization({
    invoiceId,
    tenantId: target.tenantId,
    branchId: target.branchId,
    callerRole: caller.role,
    allowed,
  })

  if (!allowed) {
    return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) }
  }

  return { ok: true, target }
}

async function authorizeBranchAccess(
  db: any,
  branchId: string,
  caller: CallerProfile,
): Promise<{ ok: true; target: AuthorizedTarget } | { ok: false; response: Response }> {
  const { data: branch, error } = await db
    .from('branches')
    .select('id, tenant_id')
    .eq('id', branchId)
    .maybeSingle()

  if (error) {
    console.warn('[zatca-submit] branch authorization lookup failed:', safeZatcaText(error.message, 160))
    return { ok: false, response: jsonResponse({ error: 'Unable to verify branch access' }, 500) }
  }

  if (!branch?.id || !branch?.tenant_id) {
    logSubmitAuthorization({
      branchId,
      callerRole: caller.role,
      allowed: false,
    })
    return { ok: false, response: jsonResponse({ error: 'Branch not found or access denied' }, 404) }
  }

  const target = {
    tenantId: branch.tenant_id as string,
    branchId: branch.id as string,
  }
  const allowed = canSubmitForTarget(caller, target)

  logSubmitAuthorization({
    tenantId: target.tenantId,
    branchId: target.branchId,
    callerRole: caller.role,
    allowed,
  })

  if (!allowed) {
    return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) }
  }

  return { ok: true, target }
}


// ── Crypto utilities ─────────────────────────────────────────────────────────

async function deriveAesKey(): Promise<CryptoKey> {
  const appSecret = Deno.env.get('ZATCA_KEY_SECRET')
  if (!appSecret) {
    throw new Error('ZATCA_KEY_SECRET is not configured for sandbox ZATCA credentials')
  }

  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('dafra-zatca-v1'), iterations: 100_000, hash: 'SHA-256' },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

async function decryptPrivateKey(stored: string): Promise<Uint8Array> {
  const [ivB64, encB64] = stored.split(':')
  const iv  = Uint8Array.from(atob(ivB64),  c => c.charCodeAt(0))
  const enc = Uint8Array.from(atob(encB64), c => c.charCodeAt(0))
  const key = await deriveAesKey()
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc)
  const pem = new TextDecoder().decode(dec)
  // PEM label "EC PRIVATE KEY" wraps raw 32-byte secp256k1 secret key
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return extractEcPrivateKeyScalar(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))
}

async function decryptProductionText(stored: string, secret: string): Promise<string> {
  const [version, ivB64, encB64] = stored.split(':')
  if (version !== 'v1' || !ivB64 || !encB64) {
    throw new Error('Invalid encrypted production credential format')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const enc = Uint8Array.from(atob(encB64), c => c.charCodeAt(0))
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc)
  return new TextDecoder().decode(dec)
}

async function decryptProductionPrivateKey(stored: string, secret: string): Promise<Uint8Array> {
  const pem = await decryptProductionText(stored, secret)
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return extractEcPrivateKeyScalar(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
}
async function sha256Bytes(input: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', input)
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function decodeCertificateToken(token: string): { certPemBody: string; certDer: Uint8Array } {
  const trimmed = token.trim()
  if (trimmed.includes('BEGIN CERTIFICATE')) {
    const certPemBody = trimmed.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    return { certPemBody, certDer: base64ToBytes(certPemBody) }
  }

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

// ── Pure TypeScript DER parser (no node-forge) ───────────────────────────────

function derLen(buf: Uint8Array, off: number): [number, number] {
  const b = buf[off++]
  if (b < 0x80) return [b, off]
  const n = b & 0x7f; let len = 0
  for (let i = 0; i < n; i++) len = (len << 8) | buf[off++]
  return [len, off]
}


// ── Certificate serial number extraction (minimal 3-level DER walk) ──────────
// Avoids full TBSCertificate traversal that can fail on cert chains or unusual
// length encodings. Walks only: Certificate SEQUENCE → TBSCertificate SEQUENCE
// → optional [0] version → serialNumber INTEGER.

function extractCertSerial(certDer: Uint8Array): string {
  try {
    let off = 0
    off++; const [, o1] = derLen(certDer, off); off = o1  // past Certificate SEQUENCE
    off++; const [, o2] = derLen(certDer, off); off = o2  // past TBSCertificate SEQUENCE
    if (certDer[off] === 0xA0) {                          // skip optional [0] version
      off++; const [vl, o3] = derLen(certDer, off); off = o3 + vl
    }
    if (certDer[off] !== 0x02) return '0'                 // must be INTEGER tag
    off++; const [sl, o4] = derLen(certDer, off)
    const sn = certDer.slice(o4, o4 + sl)
    const hex = Array.from(sn, b => b.toString(16).padStart(2, '0')).join('').replace(/^0+/, '') || '0'
    return BigInt('0x' + hex).toString()                  // decimal string for X509SerialNumber
  } catch { return '0' }
}

// ── Certificate CA-signature extraction (outer BIT STRING of X.509 DER) ────────
// Tag 9 of Phase 2 QR = "ECDSA signature of the cryptographic stamp by ZATCA's CA"
// = the signatureValue BIT STRING at the end of the Certificate SEQUENCE (not the full cert).

function extractCertSignatureValue(certDer: Uint8Array): Uint8Array {
  try {
    let off = 0
    off++; const [, o1]       = derLen(certDer, off); off = o1           // skip Certificate SEQUENCE
    off++; const [tbsLen, o2] = derLen(certDer, off); off = o2 + tbsLen // skip TBSCertificate
    off++; const [algLen, o3] = derLen(certDer, off); off = o3 + algLen // skip AlgorithmIdentifier
    if (certDer[off] !== 0x03) return new Uint8Array(0)                  // must be BIT STRING
    off++; const [sigLen, o4] = derLen(certDer, off)
    return certDer.slice(o4 + 1, o4 + sigLen)                            // skip 0x00 padding byte
  } catch { return new Uint8Array(0) }
}

// ── Cert IssuerName extraction (for xades:IssuerSerial) ──────────────────────
function parseDerOid(bytes: Uint8Array): string {
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const known: Record<string, string> = {
    '550403': 'CN', '550406': 'C', '550407': 'L', '550408': 'ST',
    '55040a': 'O',  '55040b': 'OU',
    '0992268993f22c640119': 'DC',
  }
  return known[hex] ?? `OID:${hex}`
}

function extractCertIssuerName(certDer: Uint8Array): string {
  try {
    let off = 0
    off++; const [, o1] = derLen(certDer, off); off = o1            // enter Certificate
    off++; const [, o2] = derLen(certDer, off); off = o2            // enter TBSCertificate
    if (certDer[off] === 0xA0) { off++; const [vl, o3] = derLen(certDer, off); off = o3 + vl }
    off++; const [sl, o4] = derLen(certDer, off); off = o4 + sl     // skip serialNumber
    off++; const [al, o5] = derLen(certDer, off); off = o5 + al     // skip signatureAlgorithm
    if (certDer[off] !== 0x30) return ''
    off++; const [issLen, issOff] = derLen(certDer, off)
    const issEnd = issOff + issLen
    const rdns: string[] = []
    let pos = issOff
    while (pos < issEnd) {
      if (certDer[pos] !== 0x31) break
      pos++; const [setLen, setOff] = derLen(certDer, pos); pos = setOff + setLen
      let p = setOff
      if (certDer[p] !== 0x30) continue
      p++; const [, seqOff] = derLen(certDer, p); p = seqOff
      if (certDer[p] !== 0x06) continue
      p++; const [oidLen, oidOff] = derLen(certDer, p)
      const oid = parseDerOid(certDer.slice(oidOff, oidOff + oidLen)); p = oidOff + oidLen
      p++; const [valLen, valOff] = derLen(certDer, p)
      rdns.push(`${oid}=${new TextDecoder().decode(certDer.slice(valOff, valOff + valLen))}`)
    }
    return rdns.reverse().join(', ')  // RFC 2253: most-specific first (reverse of DER order)
  } catch { return '' }
}

// ── SubjectPublicKeyInfo extraction from cert DER (for QR tag 8) ─────────────
// Extracts the full SPKI SEQUENCE (88 bytes for secp256k1 uncompressed) from TBSCertificate.
// Using the cert's own public key guarantees consistency with ds:X509Certificate.
function extractCertPublicKeySpki(certDer: Uint8Array): Uint8Array {
  try {
    let off = 0
    off++; const [, o1] = derLen(certDer, off); off = o1             // enter Certificate
    off++; const [, o2] = derLen(certDer, off); off = o2             // enter TBSCertificate
    if (certDer[off] === 0xA0) { off++; const [vl, o3] = derLen(certDer, off); off = o3 + vl }
    off++; const [sl, o4] = derLen(certDer, off); off = o4 + sl      // skip serialNumber
    off++; const [al, o5] = derLen(certDer, off); off = o5 + al      // skip signatureAlgorithm
    off++; const [il, o6] = derLen(certDer, off); off = o6 + il      // skip issuer
    off++; const [vld, o7] = derLen(certDer, off); off = o7 + vld    // skip validity
    off++; const [subl, o8] = derLen(certDer, off); off = o8 + subl  // skip subject
    // now at subjectPublicKeyInfo SEQUENCE
    const spkiStart = off
    off++; const [spkiLen, spkiOff] = derLen(certDer, off)
    return certDer.slice(spkiStart, spkiOff + spkiLen)
  } catch { return new Uint8Array(0) }
}

// ── XML builder (ported from xml.ts) ─────────────────────────────────────────

const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac:     'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc:     'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext:     'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig:     'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac:     'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  sbc:     'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
  ds:      'http://www.w3.org/2000/09/xmldsig#',
  xades:   'http://uri.etsi.org/01903/v1.3.2#',
}

function fmt(n: number): string { return n.toFixed(2) }

function buildInvoice(data: any, opts: any): string {
  const root = (xmlCreate({ version: '1.0', encoding: 'UTF-8' }) as any)
    .ele(NS.invoice, 'Invoice')
    .att('xmlns:cac', NS.cac).att('xmlns:cbc', NS.cbc).att('xmlns:ext', NS.ext)
    .att('xmlns:sig', NS.sig).att('xmlns:sac', NS.sac).att('xmlns:sbc', NS.sbc)
    .att('xmlns:ds', NS.ds).att('xmlns:xades', NS.xades)

  const ublExt = root.ele(NS.ext, 'UBLExtensions').ele(NS.ext, 'UBLExtension')
  ublExt.ele(NS.ext, 'ExtensionURI').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
  const extContent = ublExt.ele(NS.ext, 'ExtensionContent')
  const ublDocSig  = extContent.ele(NS.sig, 'UBLDocumentSignatures')
  const sigInfo    = ublDocSig.ele(NS.sac, 'SignatureInformation')
  sigInfo.ele(NS.cbc, 'ID').txt('urn:oasis:names:specification:ubl:signature:1')
  sigInfo.ele(NS.sbc, 'ReferencedSignatureID').txt('urn:oasis:names:specification:ubl:signature:Invoice')
  const dsSig     = sigInfo.ele(NS.ds, 'Signature').att('Id', 'signature')
  const dsSigInfo = dsSig.ele(NS.ds, 'SignedInfo')
  dsSigInfo.ele(NS.ds, 'CanonicalizationMethod').att('Algorithm', 'http://www.w3.org/2006/12/xml-c14n11')
  dsSigInfo.ele(NS.ds, 'SignatureMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256')
  const dsRef1   = dsSigInfo.ele(NS.ds, 'Reference').att('Id', 'invoiceSignedData').att('URI', '')
  const dsXforms = dsRef1.ele(NS.ds, 'Transforms')
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/TR/1999/REC-xpath-19991116')
    .ele(NS.ds, 'XPath').txt('not(//ancestor-or-self::ext:UBLExtensions)')
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/TR/1999/REC-xpath-19991116')
    .ele(NS.ds, 'XPath').txt('not(//ancestor-or-self::cac:Signature)')
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/TR/1999/REC-xpath-19991116')
    .ele(NS.ds, 'XPath').txt("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])")
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/2006/12/xml-c14n11')
  dsRef1.ele(NS.ds, 'DigestMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmlenc#sha256')
  dsRef1.ele(NS.ds, 'DigestValue').txt('')
  const dsRef2 = dsSigInfo.ele(NS.ds, 'Reference')
    .att('Type', 'http://www.w3.org/2000/09/xmldsig#SignatureProperties')
    .att('URI', '#xadesSignedProperties')
  dsRef2.ele(NS.ds, 'DigestMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmlenc#sha256')
  dsRef2.ele(NS.ds, 'DigestValue').txt('')
  dsSig.ele(NS.ds, 'SignatureValue').txt('')
  dsSig.ele(NS.ds, 'KeyInfo').ele(NS.ds, 'X509Data').ele(NS.ds, 'X509Certificate').txt('')
  const qp          = dsSig.ele(NS.ds, 'Object').ele(NS.xades, 'QualifyingProperties').att('Target', 'signature')
  const signedProps = qp.ele(NS.xades, 'SignedProperties').att('Id', 'xadesSignedProperties')
  const ssp         = signedProps.ele(NS.xades, 'SignedSignatureProperties')
  ssp.ele(NS.xades, 'SigningTime').txt(`${data.issueDate}T${data.issueTime}Z`)
  const certNode = ssp.ele(NS.xades, 'SigningCertificate').ele(NS.xades, 'Cert')
  const certDig  = certNode.ele(NS.xades, 'CertDigest')
  certDig.ele(NS.ds, 'DigestMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmlenc#sha256')
  certDig.ele(NS.ds, 'DigestValue').txt('')
  const issuer = certNode.ele(NS.xades, 'IssuerSerial')
  issuer.ele(NS.ds, 'X509IssuerName').txt('')
  issuer.ele(NS.ds, 'X509SerialNumber').txt('0')

  root.ele(NS.cbc, 'ProfileID').txt(opts.profileId)
  root.ele(NS.cbc, 'ID').txt(data.invoiceNumber)
  root.ele(NS.cbc, 'UUID').txt(data.uuid)
  root.ele(NS.cbc, 'IssueDate').txt(data.issueDate)
  root.ele(NS.cbc, 'IssueTime').txt(data.issueTime)
  root.ele(NS.cbc, 'InvoiceTypeCode').att('name', opts.typeCodeName).txt(opts.invoiceTypeCode ?? data.invoiceTypeCode ?? '388')
  root.ele(NS.cbc, 'DocumentCurrencyCode').txt('SAR')
  root.ele(NS.cbc, 'TaxCurrencyCode').txt('SAR')

  if (data.billingReferenceId) {
    const billingReference = root.ele(NS.cac, 'BillingReference')
    billingReference.ele(NS.cac, 'InvoiceDocumentReference')
      .ele(NS.cbc, 'ID').txt(data.billingReferenceId)
  }

  const icv = root.ele(NS.cac, 'AdditionalDocumentReference')
  icv.ele(NS.cbc, 'ID').txt('ICV')
  icv.ele(NS.cbc, 'UUID').txt(String(data.counterValue))

  const pih = root.ele(NS.cac, 'AdditionalDocumentReference')
  pih.ele(NS.cbc, 'ID').txt('PIH')
  pih.ele(NS.cac, 'Attachment').ele(NS.cbc, 'EmbeddedDocumentBinaryObject')
    .att('mimeCode', 'text/plain').txt(data.prevInvoiceHash)

  const qr = root.ele(NS.cac, 'AdditionalDocumentReference')
  qr.ele(NS.cbc, 'ID').txt('QR')
  qr.ele(NS.cac, 'Attachment').ele(NS.cbc, 'EmbeddedDocumentBinaryObject')
    .att('mimeCode', 'text/plain').txt(data.qrCode ?? '')

  if (opts.includeSignature) {
    const sig = root.ele(NS.cac, 'Signature')
    sig.ele(NS.cbc, 'ID').txt('urn:oasis:names:specification:ubl:signature:Invoice')
    sig.ele(NS.cbc, 'SignatureMethod').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
  }

  const supplier = root.ele(NS.cac, 'AccountingSupplierParty').ele(NS.cac, 'Party')
  supplier.ele(NS.cac, 'PartyIdentification').ele(NS.cbc, 'ID')
    .att('schemeID', data.sellerRegistrationScheme).txt(data.sellerCrn)
  const sellerAddr = supplier.ele(NS.cac, 'PostalAddress')
  sellerAddr.ele(NS.cbc, 'StreetName').txt(data.sellerAddress.street)
  sellerAddr.ele(NS.cbc, 'BuildingNumber').txt(data.sellerAddress.buildingNo)
  sellerAddr.ele(NS.cbc, 'CitySubdivisionName').txt(data.sellerAddress.district)
  sellerAddr.ele(NS.cbc, 'CityName').txt(data.sellerAddress.city)
  sellerAddr.ele(NS.cbc, 'PostalZone').txt(data.sellerAddress.postalCode)
  sellerAddr.ele(NS.cac, 'Country').ele(NS.cbc, 'IdentificationCode').txt(data.sellerAddress.countryCode)
  const sellerTax = supplier.ele(NS.cac, 'PartyTaxScheme')
  sellerTax.ele(NS.cbc, 'CompanyID').txt(data.sellerVat)
  sellerTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
  supplier.ele(NS.cac, 'PartyLegalEntity').ele(NS.cbc, 'RegistrationName').txt(data.sellerName)

  const customerParty = root.ele(NS.cac, 'AccountingCustomerParty')
  if (opts.requireBuyer && data.buyer) {
    const customer = customerParty.ele(NS.cac, 'Party')
    if (data.buyer.vatNumber) {
      const buyerTax = customer.ele(NS.cac, 'PartyTaxScheme')
      buyerTax.ele(NS.cbc, 'CompanyID').txt(data.buyer.vatNumber)
      buyerTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
    }
    customer.ele(NS.cac, 'PartyLegalEntity').ele(NS.cbc, 'RegistrationName').txt(data.buyer.name)
  }

  const paymentMeans = root.ele(NS.cac, 'PaymentMeans')
  paymentMeans.ele(NS.cbc, 'PaymentMeansCode').txt(data.paymentMeansCode ?? '10')
  if (data.creditReason) {
    paymentMeans.ele(NS.cbc, 'InstructionNote').txt(data.creditReason)
  }

  const headerAllowance = root.ele(NS.cac, 'AllowanceCharge')
  headerAllowance.ele(NS.cbc, 'ChargeIndicator').txt('false')
  headerAllowance.ele(NS.cbc, 'AllowanceChargeReason').txt('discount')
  headerAllowance.ele(NS.cbc, 'Amount').att('currencyID', 'SAR').txt(fmt(data.discountTotal))
  const headerTaxCat = headerAllowance.ele(NS.cac, 'TaxCategory')
  headerTaxCat.ele(NS.cbc, 'ID').txt('S')
  headerTaxCat.ele(NS.cbc, 'Percent').txt('15')
  headerTaxCat.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')

  root.ele(NS.cac, 'TaxTotal').ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(data.taxAmount))
  const taxTotal = root.ele(NS.cac, 'TaxTotal')
  taxTotal.ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(data.taxAmount))
  for (const bd of data.taxBreakdowns) {
    const sub = taxTotal.ele(NS.cac, 'TaxSubtotal')
    sub.ele(NS.cbc, 'TaxableAmount').att('currencyID', 'SAR').txt(fmt(bd.taxableAmount))
    sub.ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(bd.taxAmount))
    const cat = sub.ele(NS.cac, 'TaxCategory')
    cat.ele(NS.cbc, 'ID').txt(bd.vatCategoryCode)
    cat.ele(NS.cbc, 'Percent').txt((bd.taxRate * 100).toFixed(2))
    if (bd.exemptionCode) cat.ele(NS.cbc, 'TaxExemptionReasonCode').txt(bd.exemptionCode)
    cat.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
  }

  const lmt = root.ele(NS.cac, 'LegalMonetaryTotal')
  lmt.ele(NS.cbc, 'LineExtensionAmount').att('currencyID', 'SAR').txt(fmt(data.subtotal))
  lmt.ele(NS.cbc, 'TaxExclusiveAmount').att('currencyID', 'SAR').txt(fmt(data.taxableAmount))
  lmt.ele(NS.cbc, 'TaxInclusiveAmount').att('currencyID', 'SAR').txt(fmt(data.totalAmount))
  lmt.ele(NS.cbc, 'AllowanceTotalAmount').att('currencyID', 'SAR').txt(fmt(data.discountTotal))
  lmt.ele(NS.cbc, 'PayableAmount').att('currencyID', 'SAR').txt(fmt(data.totalAmount))

  for (const line of data.lines) {
    const il = root.ele(NS.cac, 'InvoiceLine')
    il.ele(NS.cbc, 'ID').txt(String(line.id))
    il.ele(NS.cbc, 'InvoicedQuantity').att('unitCode', 'PCE').txt(String(line.qty))
    il.ele(NS.cbc, 'LineExtensionAmount').att('currencyID', 'SAR').txt(fmt(line.lineNetAmt))
    if (line.discountAmt > 0) {
      const allow = il.ele(NS.cac, 'AllowanceCharge')
      allow.ele(NS.cbc, 'ChargeIndicator').txt('false')
      allow.ele(NS.cbc, 'AllowanceChargeReason').txt('discount')
      allow.ele(NS.cbc, 'Amount').att('currencyID', 'SAR').txt(fmt(line.discountAmt))
    }
    const lineTax = il.ele(NS.cac, 'TaxTotal')
    lineTax.ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(line.taxAmount))
    lineTax.ele(NS.cbc, 'RoundingAmount').att('currencyID', 'SAR').txt(fmt(line.lineTotal))
    const item = il.ele(NS.cac, 'Item')
    item.ele(NS.cbc, 'Name').txt(line.name)
    const itemTax = item.ele(NS.cac, 'ClassifiedTaxCategory')
    itemTax.ele(NS.cbc, 'ID').txt('S')
    itemTax.ele(NS.cbc, 'Percent').txt((line.taxRate * 100).toFixed(2))
    itemTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
    const price = il.ele(NS.cac, 'Price')
    price.ele(NS.cbc, 'PriceAmount').att('currencyID', 'SAR').txt(fmt(line.qty > 0 ? line.lineNetAmt / line.qty : 0))
    price.ele(NS.cbc, 'BaseQuantity').att('unitCode', 'PCE').txt('1')
  }

  return root.end({ prettyPrint: false }) as string
}

function toSaudiDate(utcDate: Date): Date {
  return new Date(utcDate.getTime() + 3 * 60 * 60 * 1000)  // UTC+3, no DST
}

function buildInvoiceXMLData(
  inv: any,
  branch: any,
  items: any[],
  customer: any,
  isSimplified: boolean,
  creditNote?: { billingReferenceId?: string; reason?: string },
): any {
  const saudiCreatedAt = toSaudiDate(new Date(inv.created_at))
  const issueDate = saudiCreatedAt.toISOString().split('T')[0]        // YYYY-MM-DD Saudi
  const issueTime = saudiCreatedAt.toISOString().split('T')[1].split('.')[0]  // HH:MM:SS Saudi
  return {
    invoiceNumber:   inv.invoice_number,
    uuid:            inv.zatca_uuid,
    invoiceTypeCode: inv.zatca_type_code ?? '388',
    billingReferenceId: creditNote?.billingReferenceId,
    creditReason: creditNote?.reason,
    issueDate,
    issueTime,
    counterValue:    inv.zatca_counter_number ?? 1,
    prevInvoiceHash: inv.zatca_prev_invoice_hash ?? FIRST_INVOICE_HASH,
    sellerName:      branch.registered_seller_name,
    sellerNameAr:    branch.registered_seller_name_ar ?? branch.registered_seller_name,
    sellerVat:       branch.vat_number ?? '',
    sellerRegistrationScheme: branch.registration_scheme,
    sellerCrn:       branch.registration_identifier,
    sellerAddress: {
      street:      branch.street ?? '',
      buildingNo:  branch.building_number,
      city:        branch.city ?? '',
      postalCode:  branch.postal_code,
      district:    branch.district ?? '',
      countryCode: branch.country || 'SA',
    },
    buyer: !isSimplified && customer
      ? { name: customer.name, vatNumber: customer.vat_number ?? undefined }
      : undefined,
    subtotal:      inv.subtotal,
    discountTotal: inv.discount_amount,
    taxableAmount: inv.taxable_amount,
    taxAmount:     inv.tax_amount,
    totalAmount:   inv.total_amount,
    lines: items.map((it: any, i: number) => ({
      id: i + 1, name: it.name, qty: it.quantity, unitPrice: it.unit_price,
      discountAmt: it.discount_amount, lineNetAmt: it.subtotal,
      taxRate: it.tax_rate, taxAmount: it.tax_amount, lineTotal: it.total,
    })),
    taxBreakdowns: [{
      taxableAmount: inv.taxable_amount, taxAmount: inv.tax_amount,
      vatCategoryCode: 'S', taxRate: 0.15,
    }],
    paymentMeansCode: undefined,
    qrCode: '',
  }
}

// ── C14N11 + XAdES signing ────────────────────────────────────────────────────

function escText(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r/g,'&#xD;')
}

function canonicalizeInvoiceContent(xmlString: string): string {
  return expandSelfClosingElements(rootWithC14nNamespaces(xmlString)
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, ''))
}

async function computeInvoiceHash(xmlString: string): Promise<string> {
  const invoiceCanonical = canonicalizeInvoiceContent(xmlString)
  const invoiceDigestBuf = await sha256(invoiceCanonical)
  return btoa(String.fromCharCode(...new Uint8Array(invoiceDigestBuf)))
}

function rootWithC14nNamespaces(xmlString: string): string {
  return xmlString.replace(
    /<Invoice xmlns="[^"]+" xmlns:cac="[^"]+" xmlns:cbc="[^"]+" xmlns:ext="[^"]+" xmlns:sig="[^"]+" xmlns:sac="[^"]+" xmlns:sbc="[^"]+" xmlns:ds="[^"]+" xmlns:xades="[^"]+">/,
    `<Invoice xmlns="${NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}" xmlns:sig="${NS.sig}" xmlns:xades="${NS.xades}">`,
  )
}

function expandSelfClosingElements(xmlString: string): string {
  return xmlString.replace(/<([A-Za-z_][\w:.-]*)([^<>]*)\/>/g, '<$1$2></$1>')
}

// Produces the exact SDK document format (no xmlns, whitespace-indented, self-closing DigestMethod).
// This string is embedded in the signed XML as-is.
// For hashing, toSignedPropsHashInput() adds the xmlns declarations that dom4j asXML() would add.
function buildSignedProperties(signingTime: string, certDigest: string, issuerDn: string, serialNumber: string): string {
  const I = (n: number) => '\n' + ' '.repeat(n)
  return `<xades:SignedProperties Id="xadesSignedProperties">`
    + I(36) + `<xades:SignedSignatureProperties>`
    + I(40) + `<xades:SigningTime>${escText(signingTime)}</xades:SigningTime>`
    + I(40) + `<xades:SigningCertificate>`
    + I(44) + `<xades:Cert>`
    + I(48) + `<xades:CertDigest>`
    + I(52) + `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`
    + I(52) + `<ds:DigestValue>${escText(certDigest)}</ds:DigestValue>`
    + I(48) + `</xades:CertDigest>`
    + I(48) + `<xades:IssuerSerial>`
    + I(52) + `<ds:X509IssuerName>${escText(issuerDn)}</ds:X509IssuerName>`
    + I(52) + `<ds:X509SerialNumber>${escText(serialNumber)}</ds:X509SerialNumber>`
    + I(48) + `</xades:IssuerSerial>`
    + I(44) + `</xades:Cert>`
    + I(40) + `</xades:SigningCertificate>`
    + I(36) + `</xades:SignedSignatureProperties>`
    + I(32) + `</xades:SignedProperties>`
}

// Adds xmlns declarations that dom4j asXML() emits when serializing the xades:SignedProperties
// subtree — xmlns:xades on root, xmlns:ds on each individual ds: child element.
// The ZATCA validator hashes this form, not the raw embedded form.
function toSignedPropsHashInput(sp: string): string {
  return sp
    .replace('<xades:SignedProperties Id="xadesSignedProperties">',
             '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">')
    .replace('<ds:DigestMethod Algorithm=',
             '<ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm=')
    .replace('<ds:DigestValue>',
             '<ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">')
    .replace('<ds:X509IssuerName>',
             '<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">')
    .replace('<ds:X509SerialNumber>',
             '<ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">')
}


function buildSignedInfo(invoiceDigest: string, signedPropsDigest: string): string {
  return `<ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`
}

function buildXadesBlock(
  invoiceDigest: string, signedPropsDigest: string, sigValue: string,
  certPemBody: string, _sp: string, _issuerDn: string, serialNumber: string,
  signingTime: string, certDigest: string,
): string {
  const signedInfo  = buildSignedInfo(invoiceDigest, signedPropsDigest)
  const signedProps = buildSignedProperties(signingTime, certDigest, _issuerDn, serialNumber)
  return `<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">${signedInfo}<ds:SignatureValue>${sigValue}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certPemBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">${signedProps}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures>`
}

async function signInvoice(xmlString: string, secretKey: Uint8Array, certificate: string): Promise<{
  signedXml: string
  invoiceHash: string
  qrCode: string
  signatureValue: string
  diagnostics: SubmitDiagnostics
}> {
  const { certPemBody, certDer } = decodeCertificateToken(certificate)

  const serialNumber  = extractCertSerial(certDer)
  const issuerName    = extractCertIssuerName(certDer)              // DN string for xades:IssuerSerial
  const certSigValue  = extractCertSignatureValue(certDer)          // CA signature — QR tag 9
  const pubKeySpki    = extractCertPublicKeySpki(certDer)
  assertPrivateKeyMatchesCertificatePublicKey(secretKey, pubKeySpki)

  // Cert digest: base64(hex(SHA256(UTF8(certPemBody)))) — 88-char, matches ZATCA SDK format
  const certDigestBytes = new Uint8Array(await sha256Bytes(new TextEncoder().encode(certPemBody)))
  const certDigestHex   = bytesToHex(certDigestBytes)
  const certDigestB64   = btoa(certDigestHex)

  const invoiceHashB64 = await computeInvoiceHash(xmlString)

  const { issueDate, issueTime } = extractInvoiceTimestamp(xmlString)
  const signingTime = safeZatcaTimestamp(issueDate, issueTime)

  // Build the embedded form (no xmlns, whitespace-indented — exact SDK document format)
  // Hash the dom4j asXML form (xmlns added) — base64(hex(SHA256)) = 88-char
  const signedPropsXml       = buildSignedProperties(signingTime, certDigestB64, issuerName, serialNumber)
  const signedPropsHashInput = toSignedPropsHashInput(signedPropsXml)
  const signedPropsBytes     = new Uint8Array(await sha256Bytes(new TextEncoder().encode(signedPropsHashInput)))
  const signedPropsHex       = bytesToHex(signedPropsBytes)
  const signedPropsB64       = btoa(signedPropsHex)

  // ZATCA SDK signs/verifies SHA256withECDSA over the decoded invoice hash
  // bytes, while ds:SignedInfo carries that same hash as DigestValue.
  const {
    signatureValueBase64: sigValueB64,
  } = signZatcaInvoiceHash(invoiceHashB64, secretKey, secp256k1)

  const xadesBlock = buildXadesBlock(
    invoiceHashB64, signedPropsB64, sigValueB64,
    certPemBody, signedPropsXml, issuerName, serialNumber, signingTime, certDigestB64,
  )

  let signedXml = xmlString.replace(
    /<ext:ExtensionContent>[\s\S]*?<\/ext:ExtensionContent>/,
    `<ext:ExtensionContent>${xadesBlock}</ext:ExtensionContent>`,
  )

  // Extract invoice metadata for QR
  const sellerName  = (signedXml.match(/<cbc:RegistrationName[^>]*>([^<]+)<\/cbc:RegistrationName>/) ?? [])[1] ?? ''
  const vatNumber   = (signedXml.match(/<cac:PartyTaxScheme>[\s\S]*?<cbc:CompanyID>([^<]+)<\/cbc:CompanyID>/) ?? [])[1] ?? ''
  const timestamp   = signingTime
  const totalAmount = parseFloat((signedXml.match(/<cbc:TaxInclusiveAmount[^>]*>([\d.]+)<\/cbc:TaxInclusiveAmount>/) ?? [])[1] ?? '0')
  const vatAmount   = parseFloat((signedXml.match(/<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/) ?? [])[1] ?? '0')

  // Phase 2 QR (tags 1-9) — used in XML and stored in DB for receipts
  const qrCode = buildZatcaPhase2Qr({
    sellerName,
    vatNumber,
    timestamp,
    totalAmount,
    vatAmount,
    invoiceHashBase64: invoiceHashB64,
    signatureValueBase64: sigValueB64,
    publicKeySpki: pubKeySpki,
    certificateSignatureDer: certSigValue,
  })
  signedXml = signedXml.replace(
    /(<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)([^<]*)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
    `$1${qrCode}$3`,
  )

  const finalXmlHash = await computeInvoiceHash(signedXml)
  const diagnostics = buildSigningDiagnostics(signedXml, {
    invoiceHash: invoiceHashB64,
    finalXmlHash,
    issueDate,
    issueTime,
    qrTimestamp: timestamp,
    signingTime,
    issuerName,
    serialNumber,
    privateKeyMatchesCertificate: true,
  })
  assertSigningDiagnostics(diagnostics)

  return {
    signedXml,
    invoiceHash: invoiceHashB64,
    qrCode,
    signatureValue: sigValueB64,
    diagnostics,
  }
}

function assertPrivateKeyMatchesCertificatePublicKey(secretKey: Uint8Array, pubKeySpki: Uint8Array): void {
  const certPublicKey = extractEcPointFromSpki(pubKeySpki)
  if (certPublicKey.length !== 65) {
    throw new ZatcaSubmitAssertionError(
      'CERT_PUBLIC_KEY_EXTRACTION_FAILED',
      'Unable to extract ZATCA public key for local signing assertion.',
      { privateKeyMatchesCertificate: false },
    )
  }

  const derivedPublicKey = secp256k1.getPublicKey(secretKey, false)
  if (!bytesEqual(derivedPublicKey, certPublicKey)) {
    throw new ZatcaSubmitAssertionError(
      'SIGNING_KEY_PUBLIC_KEY_MISMATCH',
      'Signing key does not match ZATCA public key.',
      { privateKeyMatchesCertificate: false },
    )
  }
}

function buildSigningDiagnostics(
  signedXml: string,
  expected: {
    invoiceHash: string
    finalXmlHash: string
    issueDate?: string
    issueTime?: string
    qrTimestamp: string
    signingTime: string
    issuerName: string
    serialNumber: string
    privateKeyMatchesCertificate: boolean
  },
): SubmitDiagnostics {
  const qrHash = extractQrHashFromXml(signedXml)
  const dsDigestValue = extractFirstDigestValue(signedXml)
  const xmlIssuerName = extractXmlText(signedXml, /<ds:X509IssuerName\b[^>]*>([^<]*)<\/ds:X509IssuerName>/)
  const xmlSerialNumber = extractXmlText(signedXml, /<ds:X509SerialNumber\b[^>]*>([^<]*)<\/ds:X509SerialNumber>/)

  return {
    invoiceHash: expected.invoiceHash,
    finalXmlHash: expected.finalXmlHash,
    qrHash,
    dsDigestValue,
    issueDate: expected.issueDate,
    issueTime: expected.issueTime,
    qrTimestamp: expected.qrTimestamp,
    signingTime: expected.signingTime,
    hashMatches: expected.finalXmlHash === expected.invoiceHash,
    qrHashMatches: qrHash === expected.invoiceHash,
    digestMatches: dsDigestValue === expected.invoiceHash,
    timestampMatches: expected.qrTimestamp === expected.signingTime &&
      `${expected.issueDate ?? ''}T${expected.issueTime ?? ''}` === expected.signingTime,
    certificateIssuerMatches: xmlIssuerName === expected.issuerName,
    certificateSerialMatches: xmlSerialNumber === expected.serialNumber,
    privateKeyMatchesCertificate: expected.privateKeyMatchesCertificate,
  }
}

function assertSigningDiagnostics(diagnostics: SubmitDiagnostics): void {
  if (!diagnostics.hashMatches) {
    throw new ZatcaSubmitAssertionError(
      'FINAL_TRANSFORMED_HASH_MISMATCH',
      'Final transformed hash did not match the invoice hash.',
      diagnostics,
    )
  }
  if (!diagnostics.qrHashMatches) {
    throw new ZatcaSubmitAssertionError(
      'QR_HASH_MISMATCH',
      'QR tag 6 hash did not match the invoice hash.',
      diagnostics,
    )
  }
  if (!diagnostics.digestMatches) {
    throw new ZatcaSubmitAssertionError(
      'SIGNED_INFO_DIGEST_MISMATCH',
      'XML invoice digest did not match the invoice hash.',
      diagnostics,
    )
  }
  if (!diagnostics.timestampMatches) {
    throw new ZatcaSubmitAssertionError(
      'TIMESTAMP_MISMATCH',
      'IssueDate, IssueTime, QR timestamp, and XAdES SigningTime were not aligned.',
      diagnostics,
    )
  }
  if (!diagnostics.certificateIssuerMatches) {
    throw new ZatcaSubmitAssertionError(
      'ISSUER_METADATA_MISMATCH',
      'XML issuer metadata did not match decoded credential issuer.',
      diagnostics,
    )
  }
  if (!diagnostics.certificateSerialMatches) {
    throw new ZatcaSubmitAssertionError(
      'SERIAL_METADATA_MISMATCH',
      'XML serial metadata did not match decoded credential serial.',
      diagnostics,
    )
  }
  if (!diagnostics.privateKeyMatchesCertificate) {
    throw new ZatcaSubmitAssertionError(
      'SIGNING_KEY_PUBLIC_KEY_MISMATCH',
      'Signing key does not match ZATCA public key.',
      diagnostics,
    )
  }
}

function extractEcPointFromSpki(spki: Uint8Array): Uint8Array {
  return spki[spki.length - 65] === 0x04 ? spki.slice(-65) : new Uint8Array(0)
}

function extractFirstDigestValue(xmlString: string): string | undefined {
  return extractXmlText(xmlString, /<ds:DigestValue\b[^>]*>([^<]*)<\/ds:DigestValue>/)
}

function extractQrHashFromXml(xmlString: string): string | undefined {
  try {
    const qrCode = extractXmlText(
      xmlString,
      /<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject\b[^>]*>([^<]*)<\/cbc:EmbeddedDocumentBinaryObject>/,
    )
    if (!qrCode) return undefined
    const bytes = base64ToBytes(qrCode)
    let offset = 0
    while (offset + 2 <= bytes.length) {
      const tag = bytes[offset++]
      const length = bytes[offset++]
      const value = bytes.slice(offset, offset + length)
      if (tag === 0x06) return new TextDecoder().decode(value)
      offset += length
    }
  } catch {
    return undefined
  }
  return undefined
}

function extractXmlText(xmlString: string, pattern: RegExp): string | undefined {
  return (xmlString.match(pattern) ?? [])[1]
}

function extractInvoiceTimestamp(xmlString: string): { issueDate?: string; issueTime?: string } {
  return {
    issueDate: extractXmlText(xmlString, /<cbc:IssueDate\b[^>]*>([^<]+)<\/cbc:IssueDate>/),
    issueTime: extractXmlText(xmlString, /<cbc:IssueTime\b[^>]*>([^<]+)<\/cbc:IssueTime>/),
  }
}

function safeZatcaTimestamp(issueDate?: string, issueTime?: string): string {
  const date = typeof issueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(issueDate)
    ? issueDate
    : undefined
  const time = typeof issueTime === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(issueTime)
    ? issueTime
    : undefined
  if (date && time) return `${date}T${time}`

  const saudi = toSaudiDate(new Date())
  const [fallbackDate, rawTime] = saudi.toISOString().split('T')
  return `${fallbackDate}T${rawTime.split('.')[0]}`
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function isZatcaSubmitAssertionError(err: unknown): err is ZatcaSubmitAssertionError {
  return err instanceof ZatcaSubmitAssertionError ||
    (err instanceof Error &&
      err.name === 'ZatcaSubmitAssertionError' &&
      typeof (err as any).statusString === 'string' &&
      typeof (err as any).diagnostics === 'object')
}

// ── Retry queue ───────────────────────────────────────────────────────────────

async function queueForRetry(db: any, invoiceId: string, branchId: string, tenantId: string, reason: string): Promise<void> {
  await db.from('sync_queue').insert([{
    tenant_id: tenantId, branch_id: branchId, invoice_id: invoiceId,
    action: 'zatca_submit', payload: { reason }, status: 'pending', max_attempts: 5,
  }])
}

async function loadSubmissionCredentials(db: any, branchId: string, tenantId: string): Promise<SubmissionCredentials | null> {
  const { data: productionCredentials, error: productionErr } = await db
    .from('zatca_production_credentials')
    .select('encrypted_private_key, encrypted_production_csid, encrypted_production_secret, onboarding_status')
    .eq('branch_id', branchId)
    .eq('tenant_id', tenantId)
    .eq('environment', 'production')
    .maybeSingle()

  if (productionErr) {
    console.error('[zatca-submit] production credentials lookup failed:', productionErr.message)
    throw new Error('Unable to load production ZATCA credentials')
  }

  if (productionCredentials) {
    const {
      encrypted_private_key,
      encrypted_production_csid,
      encrypted_production_secret,
      onboarding_status,
    } = productionCredentials

    if (onboarding_status === 'disconnected') {
      return null
    }

    if (onboarding_status !== 'production_connected') {
      throw new Error('Production ZATCA credentials are not connected')
    }

    if (!encrypted_private_key || !encrypted_production_csid || !encrypted_production_secret) {
      throw new Error('Production ZATCA credentials are incomplete')
    }

    const encryptionSecret = Deno.env.get('ZATCA_SERVER_ENCRYPTION_KEY')
    if (!encryptionSecret) throw new Error('ZATCA_SERVER_ENCRYPTION_KEY is not configured')

    return {
      environment: 'production',
      privateKey: await decryptProductionPrivateKey(encrypted_private_key, encryptionSecret),
      productionCsid: await decryptProductionText(encrypted_production_csid, encryptionSecret),
      productionSecret: await decryptProductionText(encrypted_production_secret, encryptionSecret),
    }
  }

  const { data: cert, error: certErr } = await db
    .from('zatca_certificates')
    .select('id, private_key_encrypted, production_csid, production_secret, invoice_counter')
    .eq('branch_id', branchId)
    .eq('tenant_id', tenantId)
    .eq('environment', 'sandbox')
    .eq('status', 'active')
    .maybeSingle()

  if (certErr) throw new Error('Unable to load sandbox ZATCA certificate')
  if (!cert?.production_csid) return null
  if (!cert.private_key_encrypted) throw new Error('Sandbox private key is missing')

  return {
    environment: 'sandbox',
    privateKey: await decryptPrivateKey(cert.private_key_encrypted),
    productionCsid: cert.production_csid,
    productionSecret: cert.production_secret,
    legacyCertId: cert.id,
    legacyInvoiceCounter: cert.invoice_counter ?? 0,
  }
}

async function loadAtomicCheckoutSigningCredentials(
  db: any,
  branchId: string,
  tenantId: string,
): Promise<Pick<SubmissionCredentials, 'environment' | 'privateKey' | 'productionCsid'> | null> {
  const { data, error } = await db
    .from('zatca_production_credentials')
    .select('encrypted_private_key, encrypted_production_csid, onboarding_status')
    .eq('branch_id', branchId)
    .eq('tenant_id', tenantId)
    .eq('environment', 'production')
    .maybeSingle()
  if (error) throw new Error('Unable to load production ZATCA signing credentials')
  if (!data || data.onboarding_status !== 'production_connected') return null
  if (!data.encrypted_private_key || !data.encrypted_production_csid) {
    throw new Error('Production ZATCA signing credentials are incomplete')
  }
  const encryptionSecret = Deno.env.get('ZATCA_SERVER_ENCRYPTION_KEY')
  if (!encryptionSecret) throw new Error('ZATCA_SERVER_ENCRYPTION_KEY is not configured')
  const [privateKey, productionCsid] = await Promise.all([
    decryptProductionPrivateKey(data.encrypted_private_key, encryptionSecret),
    decryptProductionText(data.encrypted_production_csid, encryptionSecret),
  ])
  return { environment: 'production', privateKey, productionCsid }
}

function summarizeZatcaMessages(messages: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) return []
  return messages.slice(0, 5).map((message: any) => ({
    code: typeof message?.code === 'string' ? message.code : undefined,
    category: typeof message?.category === 'string' ? message.category : undefined,
    status: typeof message?.status === 'string' ? message.status : undefined,
    type: typeof message?.type === 'string' ? message.type : undefined,
  })).filter(message => Object.values(message).some(Boolean))
}

function summarizeZatcaResponse(body: any): Record<string, unknown> {
  const validationResults = body?.validationResults ?? {}
  const errors = Array.isArray(body?.errors) ? body.errors : []
  const warnings = Array.isArray(body?.warnings) ? body.warnings : []
  const validationErrors = Array.isArray(validationResults?.errorMessages)
    ? validationResults.errorMessages
    : []
  const validationWarnings = Array.isArray(validationResults?.warningMessages)
    ? validationResults.warningMessages
    : []

  return {
    reportingStatus: typeof body?.reportingStatus === 'string' ? body.reportingStatus : undefined,
    clearanceStatus: typeof body?.clearanceStatus === 'string' ? body.clearanceStatus : undefined,
    validationStatus: typeof validationResults?.status === 'string' ? validationResults.status : undefined,
    errorCount: errors.length + validationErrors.length,
    warningCount: warnings.length + validationWarnings.length,
    errors: summarizeZatcaMessages([...errors, ...validationErrors]),
    warnings: summarizeZatcaMessages([...warnings, ...validationWarnings]),
  }
}

function safeSubmitDiagnosticSummary(diagnostics: SubmitDiagnostics): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    source: diagnostics.source,
    invoiceId: diagnostics.invoiceId,
    branchId: diagnostics.branchId,
    environment: diagnostics.environment,
    invoiceType: diagnostics.invoiceType,
    endpointKind: diagnostics.endpointKind,
    httpStatus: diagnostics.httpStatus,
    validationStatus: diagnostics.validationStatus,
    reportingStatus: diagnostics.reportingStatus,
    clearanceStatus: diagnostics.clearanceStatus,
    errorCodes: diagnostics.errorCodes,
    warningCodes: diagnostics.warningCodes,
    zatcaCounterNumber: diagnostics.zatcaCounterNumber,
  }

  const assertions: Record<string, boolean | undefined> = {
    hashMatches: diagnostics.hashMatches,
    qrHashMatches: diagnostics.qrHashMatches,
    digestMatches: diagnostics.digestMatches,
    storedHashMatches: diagnostics.storedHashMatches,
    timestampMatches: diagnostics.timestampMatches,
    certificateIssuerMatches: diagnostics.certificateIssuerMatches,
    certificateSerialMatches: diagnostics.certificateSerialMatches,
    privateKeyMatchesCertificate: diagnostics.privateKeyMatchesCertificate,
  }
  const safeAssertions = Object.fromEntries(
    Object.entries(assertions).filter(([, value]) => typeof value === 'boolean'),
  )
  if (Object.keys(safeAssertions).length > 0) summary.assertions = safeAssertions
  return summary
}

function safeZatcaText(value: unknown, maxLength = 220): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  if (!cleaned) return undefined
  if (/otp|secret|token|certificate|private[_ -]?key|authorization|csr|<\?xml|<Invoice|signedInvoiceXmlBase64|signed_invoice_xml_base64|encryption key/i.test(cleaned)) {
    return 'Sensitive detail redacted.'
  }
  return cleaned
}

function safeZatcaMessages(body: any, kind: 'error' | 'warning'): Array<{ code?: string; message?: string }> {
  const validationResults = body?.validationResults ?? {}
  const direct = kind === 'error' ? body?.errors : body?.warnings
  const validation = kind === 'error'
    ? validationResults?.errorMessages
    : validationResults?.warningMessages
  return [...arrayValue(direct), ...arrayValue(validation)]
    .slice(0, 5)
    .map((message: any) => ({
      code: safeZatcaText(message?.code, 80),
      message: safeZatcaText(message?.message, 240),
    }))
    .filter(message => message.code || message.message)
}

function buildSafeZatcaRecord(body: any, diagnostics: SubmitDiagnostics, invoiceStatus: string): Record<string, unknown> | null {
  const warnings = safeZatcaMessages(body, 'warning')
  const errors = safeZatcaMessages(body, 'error')
  const record: Record<string, unknown> = {}

  if (warnings.length > 0) record.warnings = warnings
  if (invoiceStatus === 'failed') {
    record.failureSummary = {
      source: diagnostics.source,
      httpStatus: diagnostics.httpStatus,
      validationStatus: diagnostics.validationStatus,
      reportingStatus: diagnostics.reportingStatus,
      clearanceStatus: diagnostics.clearanceStatus,
      errorCodes: diagnostics.errorCodes ?? errors.map(error => error.code).filter(Boolean),
      errors,
    }
  }

  return Object.keys(record).length > 0 ? record : null
}

function zatcaMessageCodes(body: any, kind: 'error' | 'warning'): string[] {
  const validationResults = body?.validationResults ?? {}
  const direct = kind === 'error' ? body?.errors : body?.warnings
  const validation = kind === 'error'
    ? validationResults?.errorMessages
    : validationResults?.warningMessages
  return [...arrayValue(direct), ...arrayValue(validation)]
    .map((message: any) => typeof message?.code === 'string' ? message.code : undefined)
    .filter((code: string | undefined): code is string => !!code)
    .slice(0, 10)
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

async function resolvePreviousInvoiceHash(db: any, inv: any): Promise<{
  previousHash: string
  source: string
}> {
  const { data, error } = await db
    .from('invoices')
    .select('id, zatca_xml_hash, zatca_status, created_at, invoice_number')
    .eq('tenant_id', inv.tenant_id)
    .eq('branch_id', inv.branch_id)
    .in('zatca_status', ['reported', 'cleared'])
    .not('zatca_xml_hash', 'is', null)
    .lt('created_at', inv.created_at)
    .neq('id', inv.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[zatca-submit] previous invoice hash lookup failed:', error.message)
    throw new Error('Unable to resolve previous ZATCA invoice hash')
  }

  if (typeof data?.zatca_xml_hash === 'string' && data.zatca_xml_hash.length > 0) {
    return {
      previousHash: data.zatca_xml_hash,
      source: `previous_${data.zatca_status}_invoice:${data.id}`,
    }
  }

  return {
    previousHash: FIRST_INVOICE_HASH,
    source: 'initial_pih',
  }
}

async function resolveZatcaCounterNumber(db: any, inv: any): Promise<number> {
  const existing = Number(inv.zatca_counter_number ?? 0)
  if (Number.isInteger(existing) && existing > 0) return existing

  const { data, error } = await db
    .from('invoices')
    .select('zatca_counter_number')
    .eq('tenant_id', inv.tenant_id)
    .eq('branch_id', inv.branch_id)
    .neq('id', inv.id)
    .not('zatca_counter_number', 'is', null)
    .order('zatca_counter_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[zatca-submit] ZATCA counter lookup failed:', error.message)
    throw new Error('Unable to resolve ZATCA invoice counter')
  }

  const previous = Number(data?.zatca_counter_number ?? 0)
  return Number.isInteger(previous) && previous > 0 ? previous + 1 : 1
}

function buildSafeFailureResponse(
  statusString: string,
  message: string,
  diagnostics: SubmitDiagnostics,
): Record<string, unknown> {
  return {
    localValidation: {
      statusString,
      message: safeZatcaText(message, 240),
      diagnostics: safeSubmitDiagnosticSummary(diagnostics),
    },
  }
}

type FinalizedDocument = {
  signedXml: string
  invoiceHash: string
  signatureValue: string
  qrCode: string
}

function hasCompleteFinalizedDocument(invoice: any): invoice is any & FinalizedDocument {
  return invoice?.zatca_finalization_status === 'finalized'
    && typeof invoice?.zatca_xml === 'string' && invoice.zatca_xml.trim().length > 0
    && typeof invoice?.zatca_xml_hash === 'string' && invoice.zatca_xml_hash.trim().length > 0
    && typeof invoice?.zatca_signature === 'string' && invoice.zatca_signature.trim().length > 0
    && typeof invoice?.zatca_qr_code === 'string' && invoice.zatca_qr_code.trim().length > 0
}

function finalizationResponse(invoice: any, qrCode?: string | null, error?: string | null): Record<string, unknown> {
  const finalized = hasCompleteFinalizedDocument(invoice) || typeof qrCode === 'string' && qrCode.trim().length > 0
  const isStandard = invoice?.zatca_invoice_type === 'standard' || invoice?.resolved_standard === true
  const cleared = invoice?.zatca_status === 'cleared'
  return {
    invoiceStatus: String(invoice?.zatca_status ?? 'pending'),
    finalizationStatus: finalized ? 'finalized' : String(invoice?.zatca_finalization_status ?? 'not_started'),
    canPrint: finalized && (!isStandard || cleared),
    canShare: finalized && (!isStandard || cleared),
    retryAvailable: finalized || invoice?.zatca_finalization_status === 'failed',
    qrCode: qrCode ?? (hasCompleteFinalizedDocument(invoice) ? invoice.zatca_qr_code : null),
    error: error ?? null,
  }
}

async function loadOutputState(db: any, invoiceId: string, tenantId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.from('invoices')
    .select('id, zatca_invoice_type, original_invoice_id, zatca_status, zatca_finalization_status, zatca_qr_code, zatca_xml, zatca_xml_hash, zatca_signature, zatca_finalization_error')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()
  if (error || !data) throw new Error('Invoice not found')
  if (data.original_invoice_id && (data.zatca_invoice_type === 'credit_note' || data.zatca_invoice_type === 'debit_note')) {
    const { data: original } = await db.from('invoices')
      .select('zatca_invoice_type')
      .eq('id', data.original_invoice_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    data.resolved_standard = original?.zatca_invoice_type === 'standard'
  }
  const safeError = data.zatca_finalization_error && typeof data.zatca_finalization_error === 'object'
    ? (data.zatca_finalization_error as any)?.failureSummary?.message ?? null
    : null
  return finalizationResponse(data, null, typeof safeError === 'string' ? safeError : null)
}

async function claimFinalization(db: any, invoiceId: string): Promise<'claimed' | 'already_finalized' | 'in_progress' | 'unavailable'> {
  const { data, error } = await db
    .from('invoices')
    .update({ zatca_finalization_status: 'finalizing', zatca_finalization_error: null })
    .eq('id', invoiceId)
    .in('zatca_finalization_status', ['not_started', 'failed'])
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[zatca-submit] finalization claim failed:', error.message)
    return 'unavailable'
  }
  if (data?.id) return 'claimed'

  const { data: current } = await db
    .from('invoices')
    .select('zatca_finalization_status, zatca_xml, zatca_xml_hash, zatca_signature, zatca_qr_code')
    .eq('id', invoiceId)
    .maybeSingle()
  if (current?.zatca_finalization_status === 'finalized'
      && typeof current.zatca_xml === 'string'
      && typeof current.zatca_xml_hash === 'string'
      && typeof current.zatca_signature === 'string'
      && typeof current.zatca_qr_code === 'string') return 'already_finalized'
  if (current?.zatca_finalization_status === 'finalizing') return 'in_progress'
  return 'unavailable'
}

// ── Main invoice processor ────────────────────────────────────────────────────

function legacyOutputFields(
  invoiceStatus: string,
  invoiceType: string | null | undefined,
  qrCode: string | null | undefined,
): Record<string, unknown> {
  const printable = ['reported', 'cleared'].includes(invoiceStatus)
    && typeof qrCode === 'string'
    && qrCode.trim().length > 0
  return {
    contractMode: 'legacy',
    legacyCompatible: true,
    finalizationStatus: `legacy_${invoiceStatus}`,
    artifactStage: printable ? 'legacy_final' : 'legacy_pending',
    documentKind: invoiceType === 'simplified' || invoiceType === 'standard' ? invoiceType : null,
    canPrint: printable,
    canShare: printable,
    retryAvailable: ['pending', 'failed', 'error'].includes(invoiceStatus),
    reconciliationRequired: false,
    qrCode: printable ? qrCode : null,
    error: null,
  }
}

/**
 * Exact disabled-mode compatibility contract for actionless production
 * requests deployed before immutable finalization v2. This intentionally uses
 * only columns present in the reviewed hosted schema and preserves the legacy
 * build/sign/report-or-clear behavior. The HTTP router makes this unreachable
 * as soon as the database master flag is enabled.
 */
async function processLegacyInvoiceDisabledMode(db: any, invoiceId: string, callerTenantId: string, source: string): Promise<{
  invoiceStatus: string
  diagnostics?: SubmitDiagnostics
  [key: string]: unknown
}> {
  console.info('[zatca-submit] legacy disabled-mode processInvoice:', { invoiceId, source })

  const { data: inv, error: invErr } = await db
    .from('invoices')
    .select(`id, invoice_number, invoice_reference, original_invoice_id, credit_reason,
      zatca_uuid, zatca_invoice_type, zatca_type_code, invoice_date, created_at,
      zatca_counter_number, zatca_prev_invoice_hash, zatca_xml_hash, zatca_qr_code, zatca_status,
      subtotal, discount_amount, taxable_amount, tax_amount, total_amount,
      branch_id, tenant_id, customer_id,
      invoice_items(id, name, quantity, unit_price, discount_amount, subtotal, tax_rate, tax_amount, total),
      customers(name, vat_number)`)
    .eq('id', invoiceId).eq('tenant_id', callerTenantId).single()

  if (invErr || !inv) {
    console.error('[zatca-submit] legacy invoice fetch failed:', invErr?.message)
    return { invoiceStatus: 'error', ...legacyOutputFields('error', null, null) }
  }

  if (['reported', 'cleared'].includes(inv.zatca_status)) {
    console.info('[zatca-submit] legacy invoice already submitted:', {
      invoiceId,
      invoiceStatus: inv.zatca_status,
    })
    return {
      invoiceStatus: inv.zatca_status,
      ...legacyOutputFields(inv.zatca_status, inv.zatca_invoice_type, inv.zatca_qr_code),
    }
  }

  const isCreditNote = inv.zatca_invoice_type === 'credit_note'
  let originalInvoice: any = null

  if (isCreditNote) {
    if (!inv.original_invoice_id) {
      console.error('[zatca-submit] credit note missing original invoice:', { invoiceId })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
    }

    const { data: original, error: originalErr } = await db
      .from('invoices')
      .select('id, invoice_number, zatca_invoice_type, zatca_status')
      .eq('id', inv.original_invoice_id)
      .eq('tenant_id', callerTenantId)
      .maybeSingle()

    if (originalErr || !original?.id) {
      console.error('[zatca-submit] credit note original invoice lookup failed:', safeZatcaText(originalErr?.message ?? 'missing original', 180))
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
    }

    if (!['simplified', 'standard'].includes(original.zatca_invoice_type)) {
      console.error('[zatca-submit] unsupported credit note original type:', {
        invoiceId,
        originalInvoiceId: original.id,
        originalType: original.zatca_invoice_type,
      })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
    }

    if (!['reported', 'cleared'].includes(original.zatca_status)) {
      console.error('[zatca-submit] credit note original invoice is not reported or cleared:', {
        invoiceId,
        originalInvoiceId: original.id,
        originalStatus: original.zatca_status,
      })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
    }

    if ((inv.zatca_type_code ?? '') !== '381') {
      console.error('[zatca-submit] credit note has invalid ZATCA type code:', { invoiceId })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
    }

    if (!String(inv.credit_reason ?? '').trim()) {
      console.error('[zatca-submit] credit note missing reason:', { invoiceId })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
    }

    originalInvoice = original
  }

  const { data: branchScope, error: branchError } = await db.from('branches')
    .select('id,tenant_id,name,business_name,business_name_ar,vat_number,cr_number,building_number,street,district,city,postal_code,country')
    .eq('id',inv.branch_id).eq('tenant_id',callerTenantId).single()
  if (branchError) {
    console.error('[zatca-submit] branch lookup failed:', safeZatcaText(branchError.message, 180))
    return { invoiceStatus: 'error', ...legacyOutputFields('error', null, null) }
  }
  const branch = branchScope ? {
    ...branchScope,
    registered_seller_name: branchScope.business_name || branchScope.name,
    registered_seller_name_ar: branchScope.business_name_ar,
    registration_scheme: 'CRN',
    registration_identifier: branchScope.cr_number,
  } : null

  if (!branch) {
    console.error('[zatca-submit] branch not found:', inv.branch_id)
    return { invoiceStatus: 'error', ...legacyOutputFields('error', null, null) }
  }

  const sellerName = branch.registered_seller_name || ''
  if (!sellerName) {
    console.error('[zatca-submit] no seller name for branch:', inv.branch_id)
    await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, 'missing seller name')
    return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
  }

  let credentials: SubmissionCredentials | null
  try {
    credentials = await loadSubmissionCredentials(db, inv.branch_id, inv.tenant_id)
  } catch (err: any) {
    console.warn('[zatca-submit] credentials unavailable:', safeZatcaText(err.message, 180))
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, safeZatcaText(err.message, 180) ?? 'credentials unavailable')
    return { invoiceStatus: 'pending', ...legacyOutputFields('pending', null, null) }
  }

  if (!credentials) {
    console.info('[zatca-submit] no active Phase 2 credentials:', { invoiceId, branchId: inv.branch_id })
    await db.from('invoices').update({ zatca_status: 'not_submitted' }).eq('id', invoiceId)
    return { invoiceStatus: 'not_submitted', ...legacyOutputFields('not_submitted', null, null) }
  }

  let diagnostics: SubmitDiagnostics = {
    source,
    invoiceId,
    branchId: inv.branch_id,
    environment: credentials.environment,
    invoiceType: inv.zatca_invoice_type,
  }

  try {
    await db.from('invoices').update({ zatca_status: 'pending' }).eq('id', invoiceId)

    const secretKey = credentials.privateKey
    const isSimplified = inv.zatca_invoice_type === 'simplified'
      || (isCreditNote && originalInvoice?.zatca_invoice_type === 'simplified')
    console.info('[zatca-submit] building legacy XML:', {
      invoiceId,
      branchId: inv.branch_id,
      isSimplified,
      isCreditNote,
    })
    const previous = await resolvePreviousInvoiceHash(db, inv)
    const zatcaCounterNumber = await resolveZatcaCounterNumber(db, inv)
    diagnostics = {
      ...diagnostics,
      resolvedPreviousHash: previous.previousHash,
      previousHashSource: previous.source,
      storedPreviousHash: inv.zatca_prev_invoice_hash ?? null,
      zatcaCounterNumber,
    }
    const invoiceForXml = {
      ...inv,
      zatca_prev_invoice_hash: previous.previousHash,
      zatca_counter_number: zatcaCounterNumber,
    }
    const xmlData = buildInvoiceXMLData(
      invoiceForXml,
      branch,
      inv.invoice_items ?? [],
      inv.customers ?? null,
      isSimplified,
      isCreditNote
        ? {
          billingReferenceId: inv.invoice_reference || originalInvoice?.invoice_number,
          reason: String(inv.credit_reason ?? '').trim(),
        }
        : undefined,
    )
    const unsignedXml = buildInvoice(xmlData, {
      profileId:        isSimplified ? 'reporting:1.0' : 'clearance:1.0',
      typeCodeName:     isSimplified ? '0200000' : '0100000',
      invoiceTypeCode:   inv.zatca_type_code ?? '388',
      includeSignature: true,
      requireBuyer:     !isSimplified,
    })

    console.info('[zatca-submit] signing legacy XML:', { invoiceId, environment: credentials.environment })
    const {
      signedXml,
      invoiceHash,
      qrCode,
      signatureValue,
      diagnostics: signingDiagnostics,
    } = await signInvoice(unsignedXml, secretKey, credentials.productionCsid)
    diagnostics = {
      ...diagnostics,
      ...signingDiagnostics,
      storedHashMatches: !inv.zatca_xml_hash || inv.zatca_xml_hash === invoiceHash,
    }
    console.info('[zatca-submit] signed legacy invoice:', { invoiceId, environment: credentials.environment })

    const env       = credentials.environment
    const baseUrl   = ZATCA_URLS[env]
    const endpoint  = isSimplified ? `${baseUrl}/invoices/reporting/single` : `${baseUrl}/invoices/clearance/single`
    diagnostics.endpointKind = isSimplified ? 'reporting' : 'clearance'
    const creds     = btoa(`${credentials.productionCsid}:${credentials.productionSecret}`)
    const xmlB64    = btoa(unescape(encodeURIComponent(signedXml)))

    console.info('[zatca-submit] submitting legacy invoice to ZATCA:', {
      invoiceId,
      branchId: inv.branch_id,
      environment: env,
      endpointKind: diagnostics.endpointKind,
    })
    const zatcaRes  = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'accept': 'application/json', 'accept-version': 'V2', 'Content-Type': 'application/json',
        'Authorization': `Basic ${creds}`,
        ...(isSimplified ? {} : { 'Clearance-Status': '1' }),
      },
      body: JSON.stringify({ invoiceHash, uuid: inv.zatca_uuid, invoice: xmlB64 }),
    })

    const responseText = await zatcaRes.text()
    console.info('[zatca-submit] legacy ZATCA status:', { invoiceId, httpStatus: zatcaRes.status })
    const zatcaBody = (() => { try { return JSON.parse(responseText) } catch { return {} } })()
    console.info('[zatca-submit] legacy ZATCA response summary:', JSON.stringify({
      invoiceId,
      ...summarizeZatcaResponse(zatcaBody),
    }))

    const reportingStatus = zatcaBody?.reportingStatus as string | undefined
    const clearanceStatus = zatcaBody?.clearanceStatus as string | undefined
    diagnostics = {
      ...diagnostics,
      httpStatus: zatcaRes.status,
      validationStatus: typeof zatcaBody?.validationResults?.status === 'string'
        ? zatcaBody.validationResults.status
        : undefined,
      reportingStatus,
      clearanceStatus,
      errorCodes: zatcaMessageCodes(zatcaBody, 'error'),
      warningCodes: zatcaMessageCodes(zatcaBody, 'warning'),
    }
    let newStatus: string
    if (isSimplified) {
      newStatus = reportingStatus === 'REPORTED' ? 'reported' : 'failed'
    } else {
      newStatus = clearanceStatus === 'CLEARED' ? 'cleared' : 'failed'
    }
    if ((diagnostics.errorCodes ?? []).length > 0) newStatus = 'failed'
    console.info('[zatca-submit] legacy final status:', { invoiceId, invoiceStatus: newStatus })

    await db.from('invoices').update({
      zatca_status:             newStatus,
      zatca_xml:                signedXml,
      zatca_xml_hash:           invoiceHash,
      zatca_signature:          signatureValue,
      ...(newStatus === 'reported' || newStatus === 'cleared' ? { zatca_qr_code: qrCode } : {}),
      zatca_submitted_at:       new Date().toISOString(),
      zatca_clearance_status:   clearanceStatus ?? null,
      zatca_clearance_response: isSimplified ? null : (zatcaBody ?? null),
      zatca_reporting_response: isSimplified ? (zatcaBody ?? null) : null,
      zatca_warnings:           buildSafeZatcaRecord(zatcaBody, diagnostics, newStatus),
      zatca_prev_invoice_hash:  previous.previousHash,
      zatca_counter_number:     zatcaCounterNumber,
    }).eq('id', invoiceId)

    if (credentials.environment === 'sandbox' && credentials.legacyCertId) {
      await db.from('zatca_certificates')
        .update({ last_invoice_hash: invoiceHash, invoice_counter: (credentials.legacyInvoiceCounter ?? 0) + 1 })
        .eq('id', credentials.legacyCertId)
    }

    if (newStatus === 'failed') {
      await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, (diagnostics.errorCodes ?? []).join(',') || 'zatca rejected invoice')
    }

    return {
      invoiceStatus: newStatus,
      ...legacyOutputFields(newStatus, isSimplified ? 'simplified' : 'standard', qrCode),
    }
  } catch (err: any) {
    if (isZatcaSubmitAssertionError(err)) {
      diagnostics = { ...diagnostics, ...err.diagnostics }
      console.error('[zatca-submit] legacy local validation failed:', JSON.stringify({
        statusString: err.statusString,
        ...safeSubmitDiagnosticSummary(diagnostics),
      }))
      await db.from('invoices').update({
        zatca_status: 'failed',
        zatca_reporting_response: buildSafeFailureResponse(err.statusString, err.message, diagnostics),
        zatca_warnings: {
          failureSummary: {
            statusString: err.statusString,
            message: safeZatcaText(err.message, 240),
            diagnostics: safeSubmitDiagnosticSummary(diagnostics),
          },
        },
      }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', ...legacyOutputFields('failed', null, null) }
    }

    console.error('[zatca-submit] legacy error:', safeZatcaText(err.message ?? 'unknown', 240))
    const isRetryableAutoSubmit = AUTO_SUBMIT_SOURCES.has(source)
    const retryStatus = isRetryableAutoSubmit ? 'pending' : 'failed'
    await db.from('invoices').update({
      zatca_status: retryStatus,
      zatca_reporting_response: buildSafeFailureResponse('SUBMISSION_EXCEPTION', err.message ?? 'unknown', diagnostics),
      zatca_warnings: {
        failureSummary: {
          statusString: 'SUBMISSION_EXCEPTION',
          message: safeZatcaText(err.message ?? 'unknown', 240),
          retryable: isRetryableAutoSubmit,
          diagnostics: safeSubmitDiagnosticSummary(diagnostics),
        },
      },
    }).eq('id', invoiceId)
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, safeZatcaText(err.message, 180) ?? 'submission exception')
    return {
      invoiceStatus: retryStatus,
      diagnostics,
      ...legacyOutputFields(retryStatus, null, null),
    }
  }
}

async function processInvoiceV1SupersededDoNotCall(db: any, invoiceId: string, callerTenantId: string, source: string, action: SubmitAction): Promise<{
  invoiceStatus: string
  diagnostics?: SubmitDiagnostics
  finalizationStatus?: string
  canPrint?: boolean
  canShare?: boolean
  retryAvailable?: boolean
  qrCode?: string | null
  error?: string | null
}> {
  // Retained temporarily only to keep the pre-existing diff reviewable. The
  // HTTP handler has no call path to this function, and this unconditional
  // guard prevents accidental reuse of the unsafe generic-artifact contract.
  throw new Error('SUPERSEDED_V1_FINALIZATION_PATH_DISABLED')
  /* c8 ignore start */
  console.info('[zatca-submit] processInvoice:', { invoiceId, source })

  const { data: inv, error: invErr } = await db
    .from('invoices')
    .select(`id, invoice_number, invoice_reference, original_invoice_id, credit_reason,
      zatca_uuid, zatca_invoice_type, zatca_type_code, invoice_date, created_at,
      zatca_counter_number, zatca_prev_invoice_hash, zatca_xml, zatca_xml_hash,
      zatca_signature, zatca_qr_code, zatca_status,
      zatca_finalization_status, zatca_finalized_at, zatca_finalization_error,
      subtotal, discount_amount, taxable_amount, tax_amount, total_amount,
      branch_id, tenant_id, customer_id,
      invoice_items(id, name, quantity, unit_price, discount_amount, subtotal, tax_rate, tax_amount, total),
      customers(name, vat_number)`)
    .eq('id', invoiceId).eq('tenant_id', callerTenantId).single()

  if (invErr || !inv) {
    console.error('[zatca-submit] invoice fetch failed:', invErr?.message)
    return { invoiceStatus: 'error' }
  }

  if (['reported', 'cleared'].includes(inv.zatca_status)) {
    console.info('[zatca-submit] already submitted:', { invoiceId, invoiceStatus: inv.zatca_status })
    return {
      invoiceStatus: inv.zatca_status,
      ...finalizationResponse(inv),
    } as any
  }

  if (action === 'finalize' && inv.zatca_finalization_status === 'finalizing') {
    return {
      invoiceStatus: inv.zatca_status ?? 'pending',
      finalizationStatus: 'finalizing',
      canPrint: false,
      canShare: false,
      retryAvailable: false,
      qrCode: null,
      error: null,
    }
  }

  const isCreditNote = inv.zatca_invoice_type === 'credit_note'
  let originalInvoice: any = null

  if (isCreditNote) {
    if (!inv.original_invoice_id) {
      console.error('[zatca-submit] credit note missing original invoice:', { invoiceId })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed' }
    }

    const { data: original, error: originalErr } = await db
      .from('invoices')
      .select('id, invoice_number, zatca_invoice_type, zatca_status')
      .eq('id', inv.original_invoice_id)
      .eq('tenant_id', callerTenantId)
      .maybeSingle()

    if (originalErr || !original?.id) {
      console.error('[zatca-submit] credit note original invoice lookup failed:', safeZatcaText(originalErr?.message ?? 'missing original', 180))
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed' }
    }

    if (!['simplified', 'standard'].includes(original.zatca_invoice_type)) {
      console.error('[zatca-submit] unsupported credit note original type:', {
        invoiceId,
        originalInvoiceId: original.id,
        originalType: original.zatca_invoice_type,
      })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed' }
    }

    if (!['reported', 'cleared'].includes(original.zatca_status)) {
      console.error('[zatca-submit] credit note original invoice is not reported or cleared:', {
        invoiceId,
        originalInvoiceId: original.id,
        originalStatus: original.zatca_status,
      })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed' }
    }

    if ((inv.zatca_type_code ?? '') !== '381') {
      console.error('[zatca-submit] credit note has invalid ZATCA type code:', { invoiceId })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed' }
    }

    if (!String(inv.credit_reason ?? '').trim()) {
      console.error('[zatca-submit] credit note missing reason:', { invoiceId })
      await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
      return { invoiceStatus: 'failed' }
    }

    originalInvoice = original
  }

  const { data: branchScope, error: branchError } = await db.from('branches')
    .select('id,tenant_id,name,business_name,business_name_ar,vat_number,cr_number,building_number,street,district,city,postal_code,country')
    .eq('id',inv.branch_id).eq('tenant_id',callerTenantId).single()
  if (branchError) {
    console.error('[zatca-submit] branch lookup failed:', safeZatcaText(branchError.message, 180))
    return { invoiceStatus: 'error' }
  }
  const branch = branchScope ? {
    ...branchScope,
    registered_seller_name: branchScope.business_name || branchScope.name,
    registered_seller_name_ar: branchScope.business_name_ar,
    registration_scheme: 'CRN',
    registration_identifier: branchScope.cr_number,
  } : null

  if (!branch) {
    console.error('[zatca-submit] branch not found:', inv.branch_id)
    return { invoiceStatus: 'error' }
  }

  const sellerName = branch.registered_seller_name || ''
  if (!sellerName) {
    console.error('[zatca-submit] no seller name for branch:', inv.branch_id)
    await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, 'missing seller name')
    return { invoiceStatus: 'failed' }
  }

  let credentials: SubmissionCredentials | null
  try {
    credentials = await loadSubmissionCredentials(db, inv.branch_id, inv.tenant_id)
  } catch (err: any) {
    console.warn('[zatca-submit] credentials unavailable:', safeZatcaText(err.message, 180))
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, safeZatcaText(err.message, 180) ?? 'credentials unavailable')
    return { invoiceStatus: 'pending' }
  }

  if (!credentials) {
    console.info('[zatca-submit] no active Phase 2 credentials:', { invoiceId, branchId: inv.branch_id })
    await db.from('invoices').update({ zatca_status: 'not_submitted' }).eq('id', invoiceId)
    return { invoiceStatus: 'not_submitted' }
  }

  let diagnostics: SubmitDiagnostics = {
    source,
    invoiceId,
    branchId: inv.branch_id,
    environment: credentials.environment,
    invoiceType: inv.zatca_invoice_type,
  }

  const isSimplifiedDocument = inv.zatca_invoice_type === 'simplified'
    || (isCreditNote && originalInvoice?.zatca_invoice_type === 'simplified')
  let finalizationCompleted = hasCompleteFinalizedDocument(inv)

  try {
    const isSimplified = isSimplifiedDocument
    await db.from('invoices').update({ zatca_status: 'pending' }).eq('id', invoiceId)

    let signedXml: string
    let invoiceHash: string
    let qrCode: string
    let signatureValue: string
    let previousHash = inv.zatca_prev_invoice_hash ?? ''
    let zatcaCounterNumber = Number(inv.zatca_counter_number ?? 0)

    if (finalizationCompleted) {
      // Retries and re-submissions use the immutable stored document. They do
      // not rebuild XML, recalculate the hash-chain input, or resign.
      signedXml = inv.zatca_xml
      invoiceHash = inv.zatca_xml_hash
      signatureValue = inv.zatca_signature
      qrCode = inv.zatca_qr_code
      diagnostics = {
        ...diagnostics,
        invoiceHash,
        storedHashMatches: true,
        storedPreviousHash: previousHash || null,
        zatcaCounterNumber: zatcaCounterNumber || undefined,
      }
      console.info('[zatca-submit] reusing finalized invoice:', { invoiceId })
    } else {
      const claim = await claimFinalization(db, invoiceId)
      if (claim === 'already_finalized') {
        const { data: refreshed } = await db.from('invoices')
          .select('zatca_xml, zatca_xml_hash, zatca_signature, zatca_qr_code, zatca_finalization_status, zatca_status')
          .eq('id', invoiceId).single()
        if (refreshed && hasCompleteFinalizedDocument(refreshed)) {
          signedXml = refreshed.zatca_xml
          invoiceHash = refreshed.zatca_xml_hash
          signatureValue = refreshed.zatca_signature
          qrCode = refreshed.zatca_qr_code
          finalizationCompleted = true
        } else {
          return { invoiceStatus: 'pending', finalizationStatus: 'finalizing', canPrint: false, canShare: false, retryAvailable: false, qrCode: null }
        }
      } else if (claim !== 'claimed') {
        return { invoiceStatus: 'pending', finalizationStatus: 'finalizing', canPrint: false, canShare: false, retryAvailable: false, qrCode: null }
      } else {
        const secretKey = credentials.privateKey
        console.info('[zatca-submit] building XML:', {
          invoiceId,
          branchId: inv.branch_id,
          isSimplified,
          isCreditNote,
        })
        const previous = await resolvePreviousInvoiceHash(db, inv)
        zatcaCounterNumber = await resolveZatcaCounterNumber(db, inv)
        previousHash = previous.previousHash
        diagnostics = {
          ...diagnostics,
          resolvedPreviousHash: previous.previousHash,
          previousHashSource: previous.source,
          storedPreviousHash: inv.zatca_prev_invoice_hash ?? null,
          zatcaCounterNumber,
        }
        const invoiceForXml = {
          ...inv,
          zatca_prev_invoice_hash: previous.previousHash,
          zatca_counter_number: zatcaCounterNumber,
        }
        const xmlData = buildInvoiceXMLData(
          invoiceForXml,
          branch,
          inv.invoice_items ?? [],
          inv.customers ?? null,
          isSimplified,
          isCreditNote
            ? {
              billingReferenceId: inv.invoice_reference || originalInvoice?.invoice_number,
              reason: String(inv.credit_reason ?? '').trim(),
            }
            : undefined,
        )
        const unsignedXml = buildInvoice(xmlData, {
          profileId:        isSimplified ? 'reporting:1.0' : 'clearance:1.0',
          typeCodeName:     isSimplified ? '0200000' : '0100000',
          invoiceTypeCode:   inv.zatca_type_code ?? '388',
          includeSignature: true,
          requireBuyer:     !isSimplified,
        })

        console.info('[zatca-submit] signing invoice:', { invoiceId, environment: credentials.environment })
        const signed = await signInvoice(unsignedXml, secretKey, credentials.productionCsid)
        signedXml = signed.signedXml
        invoiceHash = signed.invoiceHash
        qrCode = signed.qrCode
        signatureValue = signed.signatureValue
        diagnostics = {
          ...diagnostics,
          ...signed.diagnostics,
          storedHashMatches: !inv.zatca_xml_hash || inv.zatca_xml_hash === invoiceHash,
        }

        const { data: persisted, error: persistError } = await db.from('invoices').update({
          zatca_xml: signedXml,
          zatca_xml_hash: invoiceHash,
          zatca_signature: signatureValue,
          zatca_qr_code: qrCode,
          zatca_prev_invoice_hash: previousHash,
          zatca_counter_number: zatcaCounterNumber,
          zatca_finalization_status: 'finalized',
          zatca_finalized_at: new Date().toISOString(),
          zatca_finalization_error: null,
        }).eq('id', invoiceId).eq('zatca_finalization_status', 'finalizing').select('id').maybeSingle()
        if (persistError || !persisted?.id) {
          const { data: committed } = await db.from('invoices')
            .select('zatca_finalization_status, zatca_xml, zatca_xml_hash, zatca_signature, zatca_qr_code')
            .eq('id', invoiceId).maybeSingle()
          if (!committed || !hasCompleteFinalizedDocument(committed)) {
            throw new Error('Unable to persist immutable ZATCA finalization')
          }
        }
        finalizationCompleted = true
        console.info('[zatca-submit] finalized invoice locally:', { invoiceId })
      }
    }

    if (action === 'finalize') {
      return {
        invoiceStatus: inv.zatca_status ?? 'pending',
        finalizationStatus: 'finalized',
        canPrint: isSimplified,
        canShare: isSimplified,
        retryAvailable: true,
        qrCode,
        error: null,
        diagnostics,
      }
    }

    const env       = credentials.environment
    const baseUrl   = ZATCA_URLS[env]
    const endpoint  = isSimplified ? `${baseUrl}/invoices/reporting/single` : `${baseUrl}/invoices/clearance/single`
    diagnostics.endpointKind = isSimplified ? 'reporting' : 'clearance'
    const creds     = btoa(`${credentials.productionCsid}:${credentials.productionSecret}`)
    const xmlB64    = btoa(unescape(encodeURIComponent(signedXml)))

    console.info('[zatca-submit] submitting to ZATCA:', {
      invoiceId,
      branchId: inv.branch_id,
      environment: env,
      endpointKind: diagnostics.endpointKind,
    })
    const zatcaRes  = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'accept': 'application/json', 'accept-version': 'V2', 'Content-Type': 'application/json',
        'Authorization': `Basic ${creds}`,
        ...(isSimplified ? {} : { 'Clearance-Status': '1' }),
      },
      body: JSON.stringify({ invoiceHash, uuid: inv.zatca_uuid, invoice: xmlB64 }),
    })

    const responseText = await zatcaRes.text()
    console.info('[zatca-submit] ZATCA status:', { invoiceId, httpStatus: zatcaRes.status })
    const zatcaBody = (() => { try { return JSON.parse(responseText) } catch { return {} } })()
    console.info('[zatca-submit] ZATCA response summary:', JSON.stringify({
      invoiceId,
      ...summarizeZatcaResponse(zatcaBody),
    }))

    const reportingStatus = zatcaBody?.reportingStatus as string | undefined
    const clearanceStatus = zatcaBody?.clearanceStatus as string | undefined
    diagnostics = {
      ...diagnostics,
      httpStatus: zatcaRes.status,
      validationStatus: typeof zatcaBody?.validationResults?.status === 'string'
        ? zatcaBody.validationResults.status
        : undefined,
      reportingStatus,
      clearanceStatus,
      errorCodes: zatcaMessageCodes(zatcaBody, 'error'),
      warningCodes: zatcaMessageCodes(zatcaBody, 'warning'),
    }
    let newStatus: string
    if (isSimplified) {
      newStatus = reportingStatus === 'REPORTED' ? 'reported' : 'failed'
    } else {
      newStatus = clearanceStatus === 'CLEARED' ? 'cleared' : 'failed'
    }
    if ((diagnostics.errorCodes ?? []).length > 0) newStatus = 'failed'
    console.info('[zatca-submit] final status:', { invoiceId, invoiceStatus: newStatus })

    await db.from('invoices').update({
      zatca_status:             newStatus,
      zatca_submitted_at:       new Date().toISOString(),
      zatca_clearance_status:   clearanceStatus ?? null,
      zatca_clearance_response: isSimplified ? null : (zatcaBody ?? null),
      zatca_reporting_response: isSimplified ? (zatcaBody ?? null) : null,
      zatca_warnings:           buildSafeZatcaRecord(zatcaBody, diagnostics, newStatus),
    }).eq('id', invoiceId)

    if (credentials.environment === 'sandbox' && credentials.legacyCertId) {
      await db.from('zatca_certificates')
        .update({ last_invoice_hash: invoiceHash, invoice_counter: (credentials.legacyInvoiceCounter ?? 0) + 1 })
        .eq('id', credentials.legacyCertId)
    }

    if (newStatus === 'failed') {
      await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, (diagnostics.errorCodes ?? []).join(',') || 'zatca rejected invoice')
    }

    return {
      invoiceStatus: newStatus,
      finalizationStatus: 'finalized',
      canPrint: isSimplified || newStatus === 'cleared',
      canShare: isSimplified || newStatus === 'cleared',
      retryAvailable: true,
      qrCode,
      diagnostics,
    }

  } catch (err: any) {
    if (isZatcaSubmitAssertionError(err)) {
      diagnostics = { ...diagnostics, ...err.diagnostics }
      console.error('[zatca-submit] local validation failed:', JSON.stringify({
        statusString: err.statusString,
        ...safeSubmitDiagnosticSummary(diagnostics),
      }))
      await db.from('invoices').update({
        zatca_status: 'failed',
        ...(finalizationCompleted ? {} : {
          zatca_finalization_status: 'failed',
          zatca_finalization_error: buildSafeFailureResponse(err.statusString, err.message, diagnostics),
        }),
        zatca_reporting_response: buildSafeFailureResponse(err.statusString, err.message, diagnostics),
        zatca_warnings: {
          failureSummary: {
            statusString: err.statusString,
            message: safeZatcaText(err.message, 240),
            diagnostics: safeSubmitDiagnosticSummary(diagnostics),
          },
        },
      }).eq('id', invoiceId)
      return { invoiceStatus: 'failed', finalizationStatus: finalizationCompleted ? 'finalized' : 'failed', canPrint: false, canShare: false, retryAvailable: !finalizationCompleted, qrCode: null }
    }

    console.error('[zatca-submit] error:', safeZatcaText(err.message ?? 'unknown', 240))
    const isRetryableAutoSubmit = AUTO_SUBMIT_SOURCES.has(source)
    const retryStatus = isRetryableAutoSubmit ? 'pending' : 'failed'
    await db.from('invoices').update({
      zatca_status: retryStatus,
      ...(finalizationCompleted ? {} : {
        zatca_finalization_status: 'failed',
        zatca_finalization_error: {
          failureSummary: {
            statusString: 'FINALIZATION_EXCEPTION',
            message: safeZatcaText(err.message ?? 'unknown', 240),
          },
        },
      }),
      zatca_reporting_response: buildSafeFailureResponse('SUBMISSION_EXCEPTION', err.message ?? 'unknown', diagnostics),
      zatca_warnings: {
        failureSummary: {
          statusString: 'SUBMISSION_EXCEPTION',
          message: safeZatcaText(err.message ?? 'unknown', 240),
          retryable: isRetryableAutoSubmit,
          diagnostics: safeSubmitDiagnosticSummary(diagnostics),
        },
      },
    }).eq('id', invoiceId)
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, safeZatcaText(err.message, 180) ?? 'submission exception')
    return {
      invoiceStatus: retryStatus,
      finalizationStatus: finalizationCompleted ? 'finalized' : 'failed',
      canPrint: finalizationCompleted && isSimplifiedDocument,
      canShare: finalizationCompleted && isSimplifiedDocument,
      retryAvailable: true,
      qrCode: finalizationCompleted ? (inv.zatca_qr_code ?? null) : null,
      diagnostics,
    }
  }
}

// ── Immutable finalization v2 ────────────────────────────────────────────────

interface FinalizationCapabilitiesV2 {
  schemaVersion: number | null
  edgeFunctionVersion: string
  minimumClientVersion: string
  immutableFinalizationEnabled: boolean
  databaseFeatureEnabled: boolean
  legacySubmitAvailable: boolean
  edgeKillSwitchEnabled: boolean
  simplifiedEnabled: boolean
  standardEnabled: boolean
  supportsLocalSimplifiedFinalization: boolean
  supportsStandardClearanceGating: boolean
  supportsLeasedClaims: boolean
  supportsSerializedChainAllocator: boolean
  compatible: boolean
}

interface BranchReadinessV2 {
  branchId: string
  branchReady: boolean
  branchBlocked: boolean
  readinessStatus: 'ready' | 'blocked' | 'missing'
  chainHeadExists: boolean
  productionConnected: boolean
  clientAcknowledged: boolean
  structurallyReady: boolean
}

interface AtomicSimplifiedRolloutV2 {
  atomicSimplifiedCheckoutEnabled: boolean
  branchGateEnabled: boolean
}

function rpcObject(value: any): Record<string, any> {
  if (Array.isArray(value)) return value[0] ?? {}
  return value && typeof value === 'object' ? value : {}
}

async function loadFinalizationCapabilitiesV2(db: any): Promise<FinalizationCapabilitiesV2> {
  const {
    edgeExecutionEnabled,
    edgeKillSwitchEnabled,
  } = parseImmutableFinalizationEdgeSwitch(
    Deno.env.get('ZATCA_IMMUTABLE_FINALIZATION_ENABLED'),
  )
  const { data, error } = await db.rpc('get_zatca_finalization_capabilities_v2')
  if (error) {
    console.warn('[zatca-submit] finalization v2 schema unavailable:', safeZatcaText(error.message, 160))
    const runtime = await db.from('zatca_finalization_runtime')
      .select('immutable_finalization_enabled')
      .eq('singleton', true)
      .maybeSingle()
    const runtimeSchemaMissing = runtime.error != null && (
      runtime.error.code === '42P01'
      || runtime.error.code === 'PGRST205'
      || /does not exist|could not find the table/i.test(String(runtime.error.message ?? ''))
    )
    const databaseFeatureEnabled = runtime.data?.immutable_finalization_enabled === true
    const legacySubmitAvailable = runtime.error == null || runtimeSchemaMissing
    return {
      schemaVersion: null, edgeFunctionVersion: FINALIZATION_EDGE_VERSION,
      minimumClientVersion: FINALIZATION_CLIENT_VERSION,
      immutableFinalizationEnabled: false, databaseFeatureEnabled,
      legacySubmitAvailable,
      edgeKillSwitchEnabled, simplifiedEnabled: false, standardEnabled: false,
      supportsLocalSimplifiedFinalization: false,
      supportsStandardClearanceGating: false, supportsLeasedClaims: false,
      supportsSerializedChainAllocator: false, compatible: false,
    }
  }
  const capability = rpcObject(data)
  const schemaVersion = Number(capability.schemaVersion ?? 0)
  const databaseFeatureEnabled = capability.immutableFinalizationEnabled === true
  const compatible = schemaVersion === FINALIZATION_SCHEMA_VERSION
    && String(capability.minimumEdgeVersion ?? '') === FINALIZATION_EDGE_VERSION
    && String(capability.minimumClientVersion ?? '') === FINALIZATION_CLIENT_VERSION
  return {
    schemaVersion, edgeFunctionVersion: FINALIZATION_EDGE_VERSION,
    minimumClientVersion: String(capability.minimumClientVersion ?? FINALIZATION_CLIENT_VERSION),
    immutableFinalizationEnabled: compatible && databaseFeatureEnabled && edgeExecutionEnabled,
    databaseFeatureEnabled, legacySubmitAvailable: true, edgeKillSwitchEnabled,
    simplifiedEnabled: compatible && capability.simplifiedEnabled === true,
    standardEnabled: compatible && capability.standardEnabled === true,
    supportsLocalSimplifiedFinalization: compatible && capability.supportsLocalSimplifiedFinalization === true,
    supportsStandardClearanceGating: compatible && capability.supportsStandardClearanceGating === true,
    supportsLeasedClaims: compatible && capability.supportsLeasedClaims === true,
    supportsSerializedChainAllocator: compatible && capability.supportsSerializedChainAllocator === true,
    compatible,
  }
}

async function loadAtomicSimplifiedRolloutV2(
  db: any,
  tenantId: string,
  branchId: string,
): Promise<AtomicSimplifiedRolloutV2> {
  const [runtime, branchGate] = await Promise.all([
    db.from('zatca_finalization_runtime')
      .select('atomic_simplified_checkout_enabled')
      .eq('singleton', true)
      .maybeSingle(),
    db.from('zatca_atomic_checkout_branch_gates_v2')
      .select('enabled')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .maybeSingle(),
  ])
  return {
    atomicSimplifiedCheckoutEnabled: runtime.error == null
      && runtime.data?.atomic_simplified_checkout_enabled === true,
    branchGateEnabled: branchGate.error == null
      && branchGate.data?.enabled === true,
  }
}

async function loadBranchReadinessV2(
  db: any,
  branchId: string,
  userId: string,
): Promise<BranchReadinessV2> {
  const { data, error } = await db.rpc('get_zatca_branch_readiness_v2', {
    p_branch_id: branchId,
    p_user_id: userId,
  })
  if (error) {
    console.warn('[zatca-submit] branch readiness unavailable:', safeZatcaText(error.message, 160))
    return {
      branchId,
      branchReady: false,
      branchBlocked: false,
      readinessStatus: 'missing',
      chainHeadExists: false,
      productionConnected: false,
      clientAcknowledged: false,
      structurallyReady: false,
    }
  }
  const state = rpcObject(data)
  const readinessStatus = state.readinessStatus === 'ready' || state.readinessStatus === 'blocked'
    ? state.readinessStatus
    : 'missing'
  return {
    branchId: String(state.branchId ?? branchId),
    branchReady: state.branchReady === true,
    branchBlocked: state.branchBlocked === true,
    readinessStatus,
    chainHeadExists: state.chainHeadExists === true,
    productionConnected: state.productionConnected === true,
    clientAcknowledged: state.clientAcknowledged === true,
    structurallyReady: state.structurallyReady === true,
  }
}

function branchCheckoutMode(
  capabilities: FinalizationCapabilitiesV2,
  readiness: BranchReadinessV2,
): 'legacy' | 'v2' {
  return selectZatcaBranchCheckoutMode({
    compatible: capabilities.compatible,
    globalMasterEnabled: capabilities.databaseFeatureEnabled,
    simplifiedEnabled: capabilities.simplifiedEnabled,
    edgeExecutionEnabled: capabilities.edgeKillSwitchEnabled === false,
    clientAcknowledged: readiness.clientAcknowledged,
    chainHeadExists: readiness.chainHeadExists,
    branchReady: readiness.branchReady,
    branchBlocked: readiness.branchBlocked,
    productionConnected: readiness.productionConnected,
  })
}

async function loadLegacyOutputState(
  db: any,
  invoiceId: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db.from('invoices')
    .select('id, zatca_invoice_type, zatca_status, zatca_qr_code')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error || !data?.id) throw new Error('Unable to load legacy invoice output state')
  return {
    invoiceId: data.id,
    invoiceStatus: String(data.zatca_status ?? 'not_submitted'),
    ...legacyOutputFields(
      String(data.zatca_status ?? 'not_submitted'),
      data.zatca_invoice_type,
      data.zatca_qr_code,
    ),
  }
}

async function loadOutputStateV2(db: any, invoiceId: string, tenantId: string): Promise<Record<string, any>> {
  const { data, error } = await db.rpc('get_zatca_output_state_v2', {
    p_invoice_id: invoiceId, p_tenant_id: tenantId,
  })
  if (error) throw new Error('Unable to load authoritative invoice output state')
  return rpcObject(data)
}

async function parseClearedArtifactV2(params: {
  body: any
  expectedUuid: string
  expectedInvoiceNumber: string
  provisionalHash: string
}): Promise<{ xml: string; hash: string; signature: string; qr: string; metadata: Record<string, unknown> }> {
  const parsed = await parseZatcaClearedInvoice({
    clearedInvoice: params.body?.clearedInvoice,
    expectedUuid: params.expectedUuid,
    expectedInvoiceNumber: params.expectedInvoiceNumber,
    provisionalHash: params.provisionalHash,
    computeHash: computeInvoiceHash,
  })
  return {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      clearanceStatus: safeZatcaText(params.body?.clearanceStatus, 40),
      validationStatus: safeZatcaText(params.body?.validationResults?.status, 40),
    },
  }
}

async function allocateChainV2WithWait(db: any, invoiceId: string, claimToken: string): Promise<Record<string, any>> {
  // A predecessor hash cannot be invented before the predecessor is signed.
  // Concurrent Edge requests therefore wait on the serialized branch head and
  // retry the same token/reservation request; they never use MAX()+1.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await db.rpc('allocate_zatca_chain_v2', {
      p_invoice_id: invoiceId, p_claim_token: claimToken,
    })
    if (!result.error) return rpcObject(result.data)
    if (!String(result.error.message ?? '').includes('CHAIN_PREDECESSOR_PENDING')) {
      throw new Error(safeZatcaText(result.error.message, 160) ?? 'Unable to allocate invoice chain')
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('CHAIN_PREDECESSOR_PENDING')
}

function assertAtomicPreparedArtifactIdentity(
  snapshot: Record<string, any>,
  signed: { signedXml: string; invoiceHash: string; qrCode: string; signatureValue: string },
): void {
  const invoiceNumber = String(snapshot.invoice_number ?? '')
  const invoiceUuid = String(snapshot.invoice_uuid ?? '')
  const counter = Number(snapshot.zatca_counter_number)
  const previousHash = String(snapshot.previous_hash ?? '')
  if (!invoiceNumber || !invoiceUuid || !Number.isInteger(counter) || counter < 1 || !previousHash) {
    throw new Error('Prepared atomic checkout identity is incomplete')
  }
  const hasCounter = new RegExp(
    `<cbc:ID>ICV<\\/cbc:ID>[\\s\\S]*?<cbc:UUID>${counter}<\\/cbc:UUID>`,
  ).test(signed.signedXml)
  const hasPreviousHash = new RegExp(
    `<cbc:ID>PIH<\\/cbc:ID>[\\s\\S]*?<cbc:EmbeddedDocumentBinaryObject\\b[^>]*>${previousHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/cbc:EmbeddedDocumentBinaryObject>`,
  ).test(signed.signedXml)
  if (!signed.signedXml.includes(`<cbc:ID>${escText(invoiceNumber)}</cbc:ID>`)
      || !signed.signedXml.includes(`<cbc:UUID>${escText(invoiceUuid)}</cbc:UUID>`)
      || !hasCounter
      || !hasPreviousHash
      || !signed.invoiceHash
      || !signed.signatureValue
      || !signed.qrCode) {
    throw new Error('Signed artifact does not match the prepared checkout identity')
  }
}

async function processAtomicSimplifiedCheckoutV2(params: {
  serviceDb: any
  callerDb: any
  caller: CallerProfile
  branchId: string
  checkoutPayload: Record<string, unknown>
  cartFingerprint: string
  documentType: 'invoice' | 'credit_note'
  requestStartedAt: number
}): Promise<Record<string, any>> {
  const {
    serviceDb,
    callerDb,
    caller,
    branchId,
    checkoutPayload,
    cartFingerprint,
    documentType,
    requestStartedAt,
  } = params
  const expectedFingerprint = await sha256HexText(stableJson(checkoutPayload))
  if (cartFingerprint !== expectedFingerprint) {
    throw new ZatcaSubmitAssertionError(
      'CHECKOUT_FINGERPRINT_MISMATCH',
      'Checkout payload does not match its cart fingerprint.',
      {},
    )
  }

  const preparedResult = await serviceDb.rpc('prepare_zatca_atomic_checkout_v2', {
    p_actor_user_id: caller.id,
    p_document_type: documentType,
    p_payload: checkoutPayload,
    p_cart_fingerprint: cartFingerprint,
    p_ttl_seconds: 120,
  })
  if (preparedResult.error) {
    throw new Error(
      safeZatcaText(preparedResult.error.message, 220)
        ?? 'Unable to prepare atomic simplified checkout',
    )
  }
  const prepared = rpcObject(preparedResult.data)
  if (prepared.status === 'committed') {
    logPipelineTiming('receipt_payload_returned', requestStartedAt, {
      invoiceId: prepared.invoiceId,
      idempotentReplay: true,
    })
    return {
      status: 'committed',
      invoiceStatus: 'pending',
      finalizationStatus: 'locally_finalized',
      artifactStage: 'simplified_final',
      documentKind: 'simplified',
      reportingDisplayState: prepared.receipt?.reporting_display_state ?? 'reporting_pending',
      canPrint: true,
      receipt: prepared.receipt,
      idempotentReplay: true,
    }
  }
  if (prepared.status !== 'prepared') throw new Error('Atomic simplified checkout was not prepared')

  const intentId = String(prepared.intentId ?? '')
  const claimToken = String(prepared.claimToken ?? '')
  const snapshotHash = String(prepared.snapshotHash ?? '')
  const snapshot = rpcObject(prepared.snapshot)
  if (!intentId || !claimToken || !snapshotHash || !snapshot.invoice_id) {
    throw new Error('Atomic simplified checkout preparation is incomplete')
  }
  const preparedSeller = rpcObject(snapshot.seller)
  if (String(preparedSeller.branch_id ?? '') !== branchId) {
    throw new ZatcaSubmitAssertionError(
      'ATOMIC_CHECKOUT_BRANCH_MISMATCH',
      'Prepared checkout branch does not match the authorized checkout branch.',
      {},
    )
  }
  logPipelineTiming('intent_prepared', requestStartedAt, {
    intentId,
    invoiceId: snapshot.invoice_id,
    idempotentReplay: prepared.idempotentReplay === true,
  })

  if (prepared.artifactReady !== true) {
    let signingToken = ''
    let artifactReady = false
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const signingClaimResult = await serviceDb.rpc('claim_zatca_atomic_checkout_signing_v2', {
        p_intent_id: intentId,
        p_claim_token: claimToken,
        p_lease_seconds: 45,
      })
      if (signingClaimResult.error) {
        throw new Error(
          safeZatcaText(signingClaimResult.error.message, 180)
            ?? 'Unable to claim atomic checkout signing',
        )
      }
      const signingClaim = rpcObject(signingClaimResult.data)
      if (signingClaim.status === 'artifact_ready') {
        artifactReady = true
        break
      }
      if (signingClaim.status === 'claimed') {
        signingToken = String(signingClaim.signingToken ?? '')
        break
      }
      if (signingClaim.status !== 'in_progress') {
        throw new Error('Atomic checkout signing claim was not granted')
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!artifactReady) {
      if (!signingToken) throw new Error('Atomic checkout signing is still in progress')
      const credentials = await loadAtomicCheckoutSigningCredentials(
        serviceDb,
        branchId,
        String(caller.tenant_id ?? ''),
      )
      if (!credentials) throw new Error('Active production ZATCA signing credentials are unavailable')
      const seller = preparedSeller
      const inv = {
        invoice_number: snapshot.invoice_number,
        zatca_uuid: snapshot.invoice_uuid,
        zatca_type_code: snapshot.zatca_type_code,
        created_at: snapshot.created_at,
        zatca_counter_number: snapshot.zatca_counter_number,
        zatca_prev_invoice_hash: snapshot.previous_hash,
        subtotal: snapshot.subtotal,
        discount_amount: snapshot.discount_amount,
        taxable_amount: snapshot.taxable_amount,
        tax_amount: snapshot.tax_amount,
        total_amount: snapshot.total,
      }
      const branch = {
        ...seller,
        registered_seller_name: seller.business_name || seller.display_name || seller.branch_name,
        registered_seller_name_ar: seller.business_name_ar || seller.branch_name_ar,
        registration_scheme: 'CRN',
        registration_identifier: seller.cr_number,
      }
      const creditNote = documentType === 'credit_note'
        ? {
            billingReferenceId: String(snapshot.invoice_reference ?? ''),
            reason: String(snapshot.credit_reason ?? ''),
          }
        : undefined
      const xmlData = buildInvoiceXMLData(
        inv,
        branch,
        Array.isArray(snapshot.items) ? snapshot.items : [],
        null,
        true,
        creditNote,
      )
      const unsignedXml = buildInvoice(xmlData, {
        profileId: 'reporting:1.0',
        typeCodeName: '0200000',
        invoiceTypeCode: documentType === 'credit_note' ? '381' : '388',
        includeSignature: true,
        requireBuyer: false,
      })
      const signed = await signInvoice(unsignedXml, credentials.privateKey, credentials.productionCsid)
      assertAtomicPreparedArtifactIdentity(snapshot, signed)
      const verifiedHash = await computeInvoiceHash(signed.signedXml)
      if (verifiedHash !== signed.invoiceHash) {
        throw new Error('Atomic checkout signed XML hash verification failed')
      }
      logPipelineTiming('artifact_signed', requestStartedAt, {
        intentId,
        invoiceId: snapshot.invoice_id,
      })

      const stored = await serviceDb.rpc('store_zatca_atomic_checkout_artifact_v2', {
        p_intent_id: intentId,
        p_claim_token: claimToken,
        p_signing_token: signingToken,
        p_snapshot_hash: snapshotHash,
        p_signed_xml: signed.signedXml,
        p_xml_hash: signed.invoiceHash,
        p_signature: signed.signatureValue,
        p_qr: signed.qrCode,
      })
      if (stored.error) {
        throw new Error(
          safeZatcaText(stored.error.message, 220)
            ?? 'Unable to store the prepared atomic checkout artifact',
        )
      }
    }
  }

  const committedResult = await callerDb.rpc('commit_zatca_atomic_checkout_v2', {
    p_intent_id: intentId,
    p_claim_token: claimToken,
  })
  if (committedResult.error) {
    throw new Error(
      safeZatcaText(committedResult.error.message, 220)
        ?? 'Unable to commit atomic simplified checkout',
    )
  }
  const committed = rpcObject(committedResult.data)
  const receipt = rpcObject(committed.receipt)
  if (committed.status !== 'committed'
      || !receipt.invoice_id
      || !receipt.qr_code
      || receipt.can_print !== true) {
    throw new Error('Atomic simplified checkout did not return a printable receipt')
  }
  logPipelineTiming('final_transaction_committed', requestStartedAt, {
    intentId,
    invoiceId: receipt.invoice_id,
    idempotentReplay: committed.idempotentReplay === true,
  })
  scheduleReportingOutboxDrain(serviceDb, String(receipt.invoice_id))
  logPipelineTiming('receipt_payload_returned', requestStartedAt, {
    invoiceId: receipt.invoice_id,
    idempotentReplay: committed.idempotentReplay === true,
  })
  return {
    status: 'committed',
    invoiceStatus: 'pending',
    finalizationStatus: 'locally_finalized',
    artifactStage: 'simplified_final',
    documentKind: 'simplified',
    reportingDisplayState: receipt.reporting_display_state ?? 'reporting_pending',
    canPrint: true,
    receipt,
    idempotentReplay: committed.idempotentReplay === true,
  }
}

async function processInvoiceV2(
  db: any,
  invoiceId: string,
  callerTenantId: string,
  source: string,
  action: 'submit' | 'finalize',
): Promise<Record<string, any>> {
  let finalizationToken: string | null = null
  let networkToken: string | null = null
  let requestStarted = false

  const selectInvoice = async () => {
    const { data, error } = await db.from('invoices').select(`id, invoice_number, invoice_reference,
      original_invoice_id, credit_reason, zatca_uuid, zatca_invoice_type, zatca_type_code,
      invoice_date, created_at, zatca_counter_number, zatca_prev_invoice_hash, zatca_status,
      zatca_finalization_version, zatca_artifact_provenance, zatca_document_kind,
      zatca_lifecycle_state, zatca_artifact_stage, zatca_finalization_error_v2,
      zatca_simplified_xml, zatca_simplified_xml_hash, zatca_simplified_signature, zatca_simplified_qr,
      zatca_provisional_xml, zatca_provisional_xml_hash, zatca_provisional_signature, zatca_provisional_qr,
      zatca_cleared_xml, zatca_cleared_xml_hash, zatca_cleared_signature, zatca_cleared_qr,
      subtotal, discount_amount, taxable_amount, tax_amount, total_amount,
      branch_id, tenant_id, customer_id,
      invoice_items(id, name, quantity, unit_price, discount_amount, subtotal, tax_rate, tax_amount, total),
      customers(name, vat_number)`)
      .eq('id', invoiceId).eq('tenant_id', callerTenantId).single()
    if (error || !data) throw new Error('Invoice not found')
    return data
  }

  let inv = await selectInvoice()
  if (inv.zatca_finalization_version !== 2 || inv.zatca_artifact_provenance !== 'server_v2') {
    throw new Error('Legacy invoice is not eligible for v2 finalization')
  }

  const isCreditNote = inv.zatca_invoice_type === 'credit_note'
  let originalInvoice: any = null
  if (isCreditNote) {
    if (!inv.original_invoice_id || !String(inv.credit_reason ?? '').trim() || inv.zatca_type_code !== '381') {
      throw new Error('Credit note is missing its required original invoice, type, or reason')
    }
    const originalResult = await db.from('invoices')
      .select('id, invoice_number, zatca_invoice_type, zatca_status')
      .eq('id', inv.original_invoice_id).eq('tenant_id', callerTenantId).single()
    if (originalResult.error || !originalResult.data
        || !['simplified', 'standard'].includes(originalResult.data.zatca_invoice_type)
        || !['reported', 'cleared'].includes(originalResult.data.zatca_status)) {
      throw new Error('Credit note original invoice is not eligible')
    }
    originalInvoice = originalResult.data
  }
  const isSimplified = inv.zatca_invoice_type === 'simplified'
    || (isCreditNote && originalInvoice?.zatca_invoice_type === 'simplified')
  const expectedKind = isSimplified ? 'simplified' : 'standard'
  if (inv.zatca_document_kind !== expectedKind) throw new Error('Invoice document-kind contract mismatch')

  const { data: branchScope, error: branchError } = await db.from('branches')
    .select('id,tenant_id,name,business_name,business_name_ar,vat_number,cr_number,building_number,street,district,city,postal_code,country')
    .eq('id', inv.branch_id).eq('tenant_id', callerTenantId).single()
  if (branchError) {
    const message = safeZatcaText(branchError.message, 180) ?? 'branch query failed'
    console.error('[zatca-submit] branch lookup failed:', message)
    throw new Error(`Branch lookup failed: ${message}`)
  }
  const branch = branchScope ? {
    ...branchScope,
    registered_seller_name: branchScope.business_name || branchScope.name,
    registered_seller_name_ar: branchScope.business_name_ar,
    registration_scheme: 'CRN',
    registration_identifier: branchScope.cr_number,
  } : null
  if (!branch?.registered_seller_name) throw new Error('Verified seller identity is unavailable')

  const credentials = await loadSubmissionCredentials(db, inv.branch_id, inv.tenant_id)
  if (!credentials) throw new Error('Active Phase 2 credentials are unavailable')
  let diagnostics: SubmitDiagnostics = {
    source, invoiceId, branchId: inv.branch_id,
    environment: credentials.environment, invoiceType: inv.zatca_invoice_type,
  }

  try {
    if (inv.zatca_artifact_stage === 'none') {
      const claimResult = await db.rpc('claim_zatca_finalization_v2', {
        p_invoice_id: invoiceId,
        p_claimed_by: `${FINALIZATION_EDGE_VERSION}:${source}`,
        p_lease_seconds: 90,
      })
      if (claimResult.error) throw new Error('Unable to acquire finalization lease')
      const claim = rpcObject(claimResult.data)
      if (claim.status === 'in_progress') return await loadOutputStateV2(db, invoiceId, callerTenantId)
      if (claim.status !== 'claimed') {
        inv = await selectInvoice()
      } else {
        finalizationToken = String(claim.claimToken)
        const allocation = await allocateChainV2WithWait(db, invoiceId, finalizationToken)
        const counter = Number(allocation.counter_number)
        const previousHash = String(allocation.previous_hash ?? '')
        if (!Number.isInteger(counter) || counter < 1 || !previousHash) {
          throw new Error('Invalid chain allocation response')
        }

        const xmlData = buildInvoiceXMLData(
          { ...inv, zatca_prev_invoice_hash: previousHash, zatca_counter_number: counter },
          branch, inv.invoice_items ?? [], inv.customers ?? null, isSimplified,
          isCreditNote ? {
            billingReferenceId: inv.invoice_reference || originalInvoice?.invoice_number,
            reason: String(inv.credit_reason ?? '').trim(),
          } : undefined,
        )
        const unsignedXml = buildInvoice(xmlData, {
          profileId: isSimplified ? 'reporting:1.0' : 'clearance:1.0',
          typeCodeName: isSimplified ? '0200000' : '0100000',
          invoiceTypeCode: inv.zatca_type_code ?? '388',
          includeSignature: true,
          requireBuyer: !isSimplified,
        })
        const signed = await signInvoice(unsignedXml, credentials.privateKey, credentials.productionCsid)
        diagnostics = { ...diagnostics, ...signed.diagnostics, invoiceHash: signed.invoiceHash, zatcaCounterNumber: counter }
        const persisted = isSimplified
          ? await db.rpc('persist_zatca_simplified_final_v2', {
              p_invoice_id: invoiceId, p_claim_token: finalizationToken,
              p_signed_xml: signed.signedXml, p_xml_hash: signed.invoiceHash,
              p_signature: signed.signatureValue, p_qr: signed.qrCode,
            })
          : await db.rpc('persist_zatca_standard_provisional_v2', {
              p_invoice_id: invoiceId, p_claim_token: finalizationToken,
              p_signed_xml: signed.signedXml, p_xml_hash: signed.invoiceHash,
              p_signature: signed.signatureValue, p_qr: signed.qrCode,
            })
        if (persisted.error) throw new Error('Unable to atomically persist the finalized artifact')
        finalizationToken = null
        inv = await selectInvoice()
      }
    }

    if (action === 'finalize') {
      return { ...(await loadOutputStateV2(db, invoiceId, callerTenantId)), diagnostics }
    }
    if (isSimplified) {
      // Simplified reporting is owned exclusively by the durable server
      // outbox. A browser-requested submit may observe/trigger the server
      // drain, but it never performs the ZATCA network request itself.
      return {
        ...(await loadOutputStateV2(db, invoiceId, callerTenantId)),
        reportingDispatch: 'durably_queued',
        diagnostics,
      }
    }

    const networkClaimResult = await db.rpc('claim_zatca_network_v2', {
      p_invoice_id: invoiceId,
      p_claimed_by: `${FINALIZATION_EDGE_VERSION}:${source}`,
      p_lease_seconds: 120,
    })
    if (networkClaimResult.error) throw new Error('Unable to acquire network submission lease')
    const networkClaim = rpcObject(networkClaimResult.data)
    if (['in_progress', 'already_complete', 'reconciliation_required'].includes(String(networkClaim.status))) {
      return await loadOutputStateV2(db, invoiceId, callerTenantId)
    }
    if (networkClaim.status !== 'claimed') throw new Error('Network submission lease was not granted')
    networkToken = String(networkClaim.networkToken)
    const operation = String(networkClaim.operation)
    const signedXml = operation === 'report' ? inv.zatca_simplified_xml : inv.zatca_provisional_xml
    const invoiceHash = operation === 'report' ? inv.zatca_simplified_xml_hash : inv.zatca_provisional_xml_hash
    if (!signedXml || !invoiceHash || invoiceHash !== networkClaim.artifactHash) {
      throw new Error('Stored submission artifact does not match its durable request identity')
    }

    const started = await db.rpc('mark_zatca_network_request_started_v2', {
      p_invoice_id: invoiceId, p_network_token: networkToken,
    })
    if (started.error) throw new Error('Unable to durably mark network request start')
    requestStarted = true

    const baseUrl = ZATCA_URLS[credentials.environment]
    const endpoint = operation === 'report'
      ? `${baseUrl}/invoices/reporting/single`
      : `${baseUrl}/invoices/clearance/single`
    diagnostics.endpointKind = operation === 'report' ? 'reporting' : 'clearance'
    const authorization = btoa(`${credentials.productionCsid}:${credentials.productionSecret}`)
    const xmlB64 = btoa(unescape(encodeURIComponent(signedXml)))
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json', 'accept-version': 'V2', 'Content-Type': 'application/json',
        Authorization: `Basic ${authorization}`,
        ...(operation === 'clear' ? { 'Clearance-Status': '1' } : {}),
      },
      body: JSON.stringify({ invoiceHash, uuid: inv.zatca_uuid, invoice: xmlB64 }),
    })
    const responseText = await response.text()
    const body = (() => { try { return JSON.parse(responseText) } catch { return {} } })()
    diagnostics = {
      ...diagnostics, httpStatus: response.status,
      reportingStatus: typeof body?.reportingStatus === 'string' ? body.reportingStatus : undefined,
      clearanceStatus: typeof body?.clearanceStatus === 'string' ? body.clearanceStatus : undefined,
      validationStatus: typeof body?.validationResults?.status === 'string' ? body.validationResults.status : undefined,
      errorCodes: zatcaMessageCodes(body, 'error'), warningCodes: zatcaMessageCodes(body, 'warning'),
    }
    const safeResponse = summarizeZatcaResponse(body)
    const safeWarnings = buildSafeZatcaRecord(body, diagnostics, response.ok ? 'accepted' : 'failed')
    const accepted = response.ok && (diagnostics.errorCodes ?? []).length === 0

    if (operation === 'report') {
      const reported = accepted && body?.reportingStatus === 'REPORTED'
      const persisted = await db.rpc('persist_zatca_reporting_result_v2', {
        p_invoice_id: invoiceId, p_network_token: networkToken, p_reported: reported,
        p_safe_response: safeResponse, p_safe_warnings: safeWarnings,
      })
      if (persisted.error) throw new Error('ZATCA response received but database persistence failed')
      networkToken = null
    } else if (accepted && body?.clearanceStatus === 'CLEARED') {
      const cleared = await parseClearedArtifactV2({
        body, expectedUuid: String(inv.zatca_uuid), expectedInvoiceNumber: String(inv.invoice_number),
        provisionalHash: String(inv.zatca_provisional_xml_hash),
      })
      const persisted = await db.rpc('adopt_zatca_cleared_artifact_v2', {
        p_invoice_id: invoiceId, p_network_token: networkToken,
        p_cleared_xml: cleared.xml, p_cleared_xml_hash: cleared.hash,
        p_cleared_signature: cleared.signature, p_cleared_qr: cleared.qr,
        p_clearance_metadata: cleared.metadata, p_safe_response: safeResponse,
        p_safe_warnings: safeWarnings,
      })
      if (persisted.error) throw new Error('Cleared artifact received but atomic persistence failed')
      networkToken = null
    } else {
      const failed = await db.rpc('fail_zatca_network_v2', {
        p_invoice_id: invoiceId, p_network_token: networkToken, p_ambiguous: false,
        p_safe_reason: 'ZATCA rejected the stored artifact', p_safe_response: safeResponse,
      })
      if (failed.error) throw new Error('ZATCA rejection received but database persistence failed')
      networkToken = null
    }
    return { ...(await loadOutputStateV2(db, invoiceId, callerTenantId)), diagnostics }
  } catch (error) {
    const message = safeZatcaText(error instanceof Error ? error.message : error, 220) ?? 'Finalization failed'
    if (networkToken) {
      const marked = await db.rpc('fail_zatca_network_v2', {
        p_invoice_id: invoiceId, p_network_token: networkToken,
        p_ambiguous: requestStarted, p_safe_reason: message, p_safe_response: null,
      })
      if (marked.error) console.error('[zatca-submit] unable to persist reconciliation state:', safeZatcaText(marked.error.message, 160))
    } else if (finalizationToken) {
      const failed = await db.rpc('fail_zatca_finalization_v2', {
        p_invoice_id: invoiceId, p_claim_token: finalizationToken,
        p_safe_error: { code: 'FINALIZATION_FAILED', message },
      })
      if (failed.error) console.error('[zatca-submit] unable to persist finalization failure:', safeZatcaText(failed.error.message, 160))
    }
    const state = await loadOutputStateV2(db, invoiceId, callerTenantId).catch(() => null)
    if (state) return { ...state, error: message, diagnostics }
    throw new Error(message)
  }
}

interface ReportingOutboxDispatchResult {
  status: 'no_work' | 'accepted' | 'retryable' | 'blocked' | 'in_progress'
  invoiceId?: string
  outboxId?: string
  error?: string
}

async function processReportingOutboxV2(
  db: any,
  claimedBy: string,
  invoiceId: string | null = null,
): Promise<ReportingOutboxDispatchResult> {
  const claimResult = await db.rpc('claim_zatca_reporting_outbox_v2', {
    p_claimed_by: claimedBy,
    p_lease_seconds: 120,
    p_invoice_id: invoiceId,
  })
  if (claimResult.error) {
    throw new Error(safeZatcaText(claimResult.error.message, 180) ?? 'Unable to claim reporting outbox')
  }
  const claim = rpcObject(claimResult.data)
  if (claim.status === 'no_work' || claim.status === 'already_accepted') {
    return {
      status: claim.status === 'already_accepted' ? 'accepted' : 'no_work',
      invoiceId: typeof claim.invoiceId === 'string' ? claim.invoiceId : undefined,
      outboxId: typeof claim.outboxId === 'string' ? claim.outboxId : undefined,
    }
  }
  if (claim.status === 'blocked') {
    return {
      status: 'blocked',
      invoiceId: String(claim.invoiceId ?? ''),
      outboxId: String(claim.outboxId ?? ''),
      error: safeZatcaText(claim.error, 180) ?? 'Reporting outbox is blocked',
    }
  }
  if (claim.status !== 'claimed') throw new Error('Reporting outbox claim was not granted')

  const outboxId = String(claim.outboxId)
  const outboxToken = String(claim.outboxToken)
  const claimedInvoiceId = String(claim.invoiceId)
  let networkToken: string | null = null
  let requestStarted = false
  let responseReceived = false
  let responseEvidenceId: string | null = null
  const dispatchStartedAt = performance.now()
  logPipelineTiming('outbox_claimed', dispatchStartedAt, {
    invoiceId: claimedInvoiceId,
    outboxId,
  })

  try {
    const { data: invoice, error: invoiceError } = await db.from('invoices')
      .select(`id, tenant_id, branch_id, invoice_number, zatca_uuid, zatca_status,
        zatca_finalization_version, zatca_artifact_provenance, zatca_document_kind,
        zatca_lifecycle_state, zatca_artifact_stage, zatca_counter_number,
        zatca_prev_invoice_hash, zatca_simplified_xml, zatca_simplified_xml_hash`)
      .eq('id', claimedInvoiceId)
      .single()
    if (invoiceError || !invoice) throw new Error('Claimed outbox invoice is unavailable')
    if (invoice.zatca_finalization_version !== 2
        || invoice.zatca_artifact_provenance !== 'server_v2'
        || invoice.zatca_document_kind !== 'simplified'
        || invoice.zatca_artifact_stage !== 'simplified_final'
        || typeof invoice.zatca_simplified_xml !== 'string'
        || typeof invoice.zatca_simplified_xml_hash !== 'string'
        || invoice.zatca_simplified_xml_hash !== claim.artifactHash) {
      throw new ZatcaSubmitAssertionError(
        'COMMITTED_ARTIFACT_IDENTITY_MISMATCH',
        'Stored simplified artifact does not match its durable outbox identity.',
        { invoiceId: claimedInvoiceId },
      )
    }

    // This is a verification of the immutable stored request, not a rebuild.
    // No XML builder, counter allocator, QR generator, or signing function is
    // reachable from this worker path.
    const recomputedHash = await computeInvoiceHash(invoice.zatca_simplified_xml)
    if (recomputedHash !== invoice.zatca_simplified_xml_hash) {
      throw new ZatcaSubmitAssertionError(
        'STORED_SIMPLIFIED_XML_HASH_MISMATCH',
        'Stored simplified XML no longer matches its immutable hash.',
        { invoiceId: claimedInvoiceId, storedHashMatches: false },
      )
    }

    const credentials = await loadSubmissionCredentials(db, invoice.branch_id, invoice.tenant_id)
    if (!credentials) throw new Error('Active Phase 2 credentials are unavailable')

    const networkClaimResult = await db.rpc('claim_zatca_network_v2', {
      p_invoice_id: claimedInvoiceId,
      p_claimed_by: claimedBy,
      p_lease_seconds: 120,
    })
    if (networkClaimResult.error) throw new Error('Unable to acquire reporting network lease')
    const networkClaim = rpcObject(networkClaimResult.data)
    if (networkClaim.status === 'already_complete') {
      const reconciled = await db.rpc('enqueue_zatca_reporting_outbox_v2', {
        p_invoice_id: claimedInvoiceId,
        p_source: 'already_reported_reconciliation',
      })
      if (reconciled.error || rpcObject(reconciled.data).status !== 'accepted') {
        throw new Error('Unable to reconcile already-reported outbox state')
      }
      return { status: 'accepted', invoiceId: claimedInvoiceId, outboxId }
    }
    if (networkClaim.status === 'in_progress') {
      await db.rpc('fail_zatca_reporting_outbox_attempt_v2', {
        p_outbox_id: outboxId,
        p_outbox_token: outboxToken,
        p_outcome: REPORTING_OUTCOMES.transientFailure,
        p_safe_reason: 'Reporting request already in progress',
      })
      return { status: 'in_progress', invoiceId: claimedInvoiceId, outboxId }
    }
    if (networkClaim.status === 'reconciliation_required') {
      await db.rpc('fail_zatca_reporting_outbox_attempt_v2', {
        p_outbox_id: outboxId,
        p_outbox_token: outboxToken,
        p_outcome: REPORTING_OUTCOMES.ambiguousOutcome,
        p_safe_reason: 'Remote reporting outcome requires reconciliation',
      })
      return {
        status: 'blocked',
        invoiceId: claimedInvoiceId,
        outboxId,
        error: 'Remote reporting outcome requires reconciliation',
      }
    }
    if (networkClaim.status !== 'claimed' || networkClaim.operation !== 'report') {
      throw new Error('Reporting network lease was not granted')
    }
    networkToken = String(networkClaim.networkToken)
    if (networkClaim.artifactHash !== invoice.zatca_simplified_xml_hash) {
      throw new ZatcaSubmitAssertionError(
        'NETWORK_ARTIFACT_IDENTITY_MISMATCH',
        'Network lease does not identify the stored simplified artifact.',
        { invoiceId: claimedInvoiceId, storedHashMatches: false },
      )
    }

    const started = await db.rpc('mark_zatca_network_request_started_v2', {
      p_invoice_id: claimedInvoiceId,
      p_network_token: networkToken,
    })
    if (started.error) throw new Error('Unable to durably mark reporting request start')
    requestStarted = true

    const endpoint = `${ZATCA_URLS[credentials.environment]}/invoices/reporting/single`
    const authorization = btoa(`${credentials.productionCsid}:${credentials.productionSecret}`)
    const xmlB64 = btoa(unescape(encodeURIComponent(invoice.zatca_simplified_xml)))
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-version': 'V2',
        'Content-Type': 'application/json',
        Authorization: `Basic ${authorization}`,
      },
      body: JSON.stringify({
        invoiceHash: invoice.zatca_simplified_xml_hash,
        uuid: invoice.zatca_uuid,
        invoice: xmlB64,
      }),
    })
    const responseText = await response.text()
    responseReceived = true
    const body = (() => { try { return JSON.parse(responseText) } catch { return {} } })()
    const diagnostics: SubmitDiagnostics = {
      source: claimedBy,
      environment: credentials.environment,
      invoiceId: claimedInvoiceId,
      branchId: invoice.branch_id,
      invoiceType: 'simplified',
      endpointKind: 'reporting',
      httpStatus: response.status,
      reportingStatus: typeof body?.reportingStatus === 'string' ? body.reportingStatus : undefined,
      validationStatus: typeof body?.validationResults?.status === 'string'
        ? body.validationResults.status
        : undefined,
      errorCodes: zatcaMessageCodes(body, 'error'),
      warningCodes: zatcaMessageCodes(body, 'warning'),
      invoiceHash: invoice.zatca_simplified_xml_hash,
      finalXmlHash: recomputedHash,
      storedHashMatches: recomputedHash === invoice.zatca_simplified_xml_hash,
      zatcaCounterNumber: Number(invoice.zatca_counter_number),
      storedPreviousHash: invoice.zatca_prev_invoice_hash,
    }
    const validationErrorCodes = arrayValue(body?.validationResults?.errorMessages)
      .map((message: any) => typeof message?.code === 'string' ? message.code : undefined)
      .filter((code: string | undefined): code is string => !!code)
      .slice(0, 10)
    const outcome = classifyReportingHttpOutcome({
      httpStatus: response.status,
      reportingStatus: diagnostics.reportingStatus,
      validationStatus: diagnostics.validationStatus,
      errorCodes: validationErrorCodes,
    }) as 'accepted' | 'transient_failure' | 'definite_rejection' | 'ambiguous_outcome'
    const safeResponse = summarizeZatcaResponse(body)
    const safeReason = outcome === REPORTING_OUTCOMES.accepted
      ? null
      : outcome === REPORTING_OUTCOMES.transientFailure
      ? `TRANSIENT_HTTP_${response.status}`
      : outcome === REPORTING_OUTCOMES.ambiguousOutcome
      ? `AMBIGUOUS_HTTP_${response.status}`
      : (diagnostics.errorCodes ?? []).length > 0
      ? `ZATCA_VALIDATION_REJECTED:${(diagnostics.errorCodes ?? []).slice(0, 8).join(',')}`
      : diagnostics.validationStatus
        && ['ERROR', 'FAILED', 'INVALID', 'NOT_VALID'].includes(diagnostics.validationStatus.toUpperCase())
      ? `ZATCA_VALIDATION_REJECTED:${diagnostics.validationStatus.toUpperCase()}`
      : `DEFINITE_HTTP_${response.status}_NOT_REPORTED`
    const safeWarnings = buildSafeZatcaRecord(
      body,
      diagnostics,
      outcome === REPORTING_OUTCOMES.accepted ? 'reported' : 'failed',
    )
    logPipelineTiming('zatca_response_received', dispatchStartedAt, {
      invoiceId: claimedInvoiceId,
      outboxId,
      httpStatus: response.status,
      outcome,
      warningCount: diagnostics.warningCodes?.length ?? 0,
      errorCount: diagnostics.errorCodes?.length ?? 0,
    })
    const evidence = await db.rpc('append_zatca_reporting_response_evidence_v2', {
      p_outbox_id: outboxId,
      p_outbox_token: outboxToken,
      p_network_token: networkToken,
      p_http_status: response.status,
      p_reporting_status: diagnostics.reportingStatus ?? null,
      p_validation_status: diagnostics.validationStatus ?? null,
      p_warning_codes: diagnostics.warningCodes ?? [],
      p_error_codes: diagnostics.errorCodes ?? [],
      p_outcome: outcome,
      p_safe_response: safeResponse,
      p_safe_warnings: safeWarnings,
      p_safe_reason: safeReason,
    })
    if (evidence.error) {
      throw new Error('ZATCA response received but durable response evidence persistence failed')
    }
    responseEvidenceId = String(rpcObject(evidence.data).evidenceId ?? '')
    if (!responseEvidenceId) throw new Error('ZATCA response evidence identity is missing')

    const persisted = await db.rpc('apply_zatca_reporting_response_evidence_v2', {
      p_outbox_id: outboxId,
      p_outbox_token: outboxToken,
      p_network_token: networkToken,
      p_evidence_id: responseEvidenceId,
    })
    if (persisted.error) {
      throw new Error('ZATCA response evidence recorded but outbox result persistence failed')
    }
    const persistedOutcome = rpcObject(persisted.data)
    logPipelineTiming('result_persisted', dispatchStartedAt, {
      invoiceId: claimedInvoiceId,
      outboxId,
      evidenceId: responseEvidenceId,
      status: persistedOutcome.status,
    })
    networkToken = null
    requestStarted = false
    return {
      status: persistedOutcome.status === 'accepted'
        ? 'accepted'
        : persistedOutcome.status === 'retryable'
        ? 'retryable'
        : 'blocked',
      invoiceId: claimedInvoiceId,
      outboxId,
      error: outcome === REPORTING_OUTCOMES.accepted
        ? undefined
        : safeReason ?? 'Stored simplified artifact was not reported',
    }
  } catch (error) {
    const assertion = isZatcaSubmitAssertionError(error)
    const reason = assertion
      ? error.statusString
      : safeZatcaText(error instanceof Error ? error.message : error, 220) ?? 'Reporting attempt failed'
    if (responseReceived) {
      // Once a response exists, never overwrite its evidence with a fabricated
      // null response or automatically retry an outcome that may be accepted.
      // A recorded evidence row remains available even when state application
      // failed; a request-start marker without evidence remains safely
      // reconciliation-required after lease expiry.
      console.error('[zatca-outbox] response result requires reconciliation:', {
        invoiceId: claimedInvoiceId,
        outboxId,
        evidenceRecorded: Boolean(responseEvidenceId),
        reason,
      })
      return {
        status: 'blocked',
        invoiceId: claimedInvoiceId,
        outboxId,
        error: responseEvidenceId
          ? 'ZATCA response evidence recorded; result persistence requires reconciliation'
          : 'ZATCA response received; durable evidence persistence requires reconciliation',
      }
    }
    if (networkToken) {
      const outcome = requestStarted
        ? REPORTING_OUTCOMES.ambiguousOutcome
        : assertion
        ? REPORTING_OUTCOMES.definiteRejection
        : REPORTING_OUTCOMES.transientFailure
      const persisted = await db.rpc('persist_zatca_reporting_outbox_result_v2', {
        p_outbox_id: outboxId,
        p_outbox_token: outboxToken,
        p_network_token: networkToken,
        p_outcome: outcome,
        p_safe_response: null,
        p_safe_warnings: null,
        p_safe_reason: reason,
      })
      if (persisted.error) {
        console.error(
          '[zatca-outbox] unable to persist classified network outcome:',
          safeZatcaText(persisted.error.message, 160),
        )
      }
      const result = rpcObject(persisted.data)
      return {
        status: result.status === 'retryable' ? 'retryable' : 'blocked',
        invoiceId: claimedInvoiceId,
        outboxId,
        error: reason,
      }
    }
    const outcome = assertion
      ? REPORTING_OUTCOMES.definiteRejection
      : REPORTING_OUTCOMES.transientFailure
    const outboxFailure = await db.rpc('fail_zatca_reporting_outbox_attempt_v2', {
      p_outbox_id: outboxId,
      p_outbox_token: outboxToken,
      p_outcome: outcome,
      p_safe_reason: reason,
    })
    if (outboxFailure.error) {
      console.error(
        '[zatca-outbox] unable to persist classified preflight outcome:',
        safeZatcaText(outboxFailure.error.message, 160),
      )
    }
    const result = rpcObject(outboxFailure.data)
    return {
      status: result.status === 'retryable' ? 'retryable' : 'blocked',
      invoiceId: claimedInvoiceId,
      outboxId,
      error: reason,
    }
  }
}

async function drainReportingOutboxV2(
  db: any,
  batchSize: number,
): Promise<ReportingOutboxDispatchResult[]> {
  const results: ReportingOutboxDispatchResult[] = []
  for (let index = 0; index < batchSize; index += 1) {
    const result = await processReportingOutboxV2(db, `edge-worker:${FINALIZATION_EDGE_VERSION}`)
    if (result.status === 'no_work') break
    results.push(result)
  }
  return results
}

function scheduleReportingOutboxDrain(db: any, invoiceId: string): void {
  const dispatch = processReportingOutboxV2(
    db,
    `edge-background:${FINALIZATION_EDGE_VERSION}`,
    invoiceId,
  ).catch(error => {
    console.error(
      '[zatca-outbox] background dispatch failed:',
      safeZatcaText(error instanceof Error ? error.message : error, 180),
    )
  })
  const edgeRuntime = (globalThis as any).EdgeRuntime
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(dispatch)
  }
  // Without EdgeRuntime (for example local unit execution), the durable cron
  // consumer remains authoritative. The promise above is never a browser task.
}

function scheduleEdgeBackgroundTask(task: Promise<unknown>, label: string): void {
  const guarded = task.catch(error => {
    console.error(label, safeZatcaText(error instanceof Error ? error.message : error, 160))
  })
  const edgeRuntime = (globalThis as any).EdgeRuntime
  if (edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(guarded)
  }
}

async function validateImmutableRecoveryTarget(
  db: any,
  invoiceId: string,
): Promise<{ alreadyReported: boolean; target: typeof IMMUTABLE_RECOVERY_TARGETS[number] }> {
  const targetIndex = IMMUTABLE_RECOVERY_TARGETS.findIndex(item => item.invoiceId === invoiceId)
  if (targetIndex < 0) throw new Error('RECOVERY_TARGET_NOT_ALLOWED')
  const target = IMMUTABLE_RECOVERY_TARGETS[targetIndex]
  const { data: invoice, error: invoiceError } = await db.from('invoices')
    .select(`id, invoice_number, branch_id, zatca_status, zatca_finalization_version,
      zatca_artifact_provenance, zatca_document_kind, zatca_lifecycle_state,
      zatca_artifact_stage, zatca_counter_number, zatca_prev_invoice_hash,
      zatca_simplified_xml, zatca_simplified_xml_hash`)
    .eq('id', invoiceId)
    .single()
  if (invoiceError || !invoice) throw new Error('RECOVERY_INVOICE_NOT_FOUND')
  const { data: reservation, error: reservationError } = await db
    .from('zatca_chain_reservations_v2')
    .select('invoice_id, counter_number, previous_hash, committed_artifact_hash, state')
    .eq('invoice_id', invoiceId)
    .single()
  if (reservationError || !reservation) throw new Error('RECOVERY_RESERVATION_NOT_FOUND')

  if (invoice.id !== target.invoiceId
      || invoice.invoice_number !== target.invoiceNumber
      || invoice.branch_id !== RECOVERY_BRANCH_ID
      || invoice.zatca_finalization_version !== 2
      || invoice.zatca_artifact_provenance !== 'server_v2'
      || invoice.zatca_document_kind !== 'simplified'
      || invoice.zatca_artifact_stage !== 'simplified_final'
      || Number(invoice.zatca_counter_number) !== target.counterNumber
      || invoice.zatca_prev_invoice_hash !== target.previousHash
      || invoice.zatca_simplified_xml_hash !== target.artifactHash
      || typeof invoice.zatca_simplified_xml !== 'string'
      || reservation.state !== 'committed'
      || Number(reservation.counter_number) !== target.counterNumber
      || reservation.previous_hash !== target.previousHash
      || reservation.committed_artifact_hash !== target.artifactHash) {
    throw new Error('RECOVERY_IMMUTABLE_IDENTITY_MISMATCH')
  }
  const recomputedHash = await computeInvoiceHash(invoice.zatca_simplified_xml)
  if (recomputedHash !== target.artifactHash) {
    throw new Error('RECOVERY_STORED_XML_HASH_MISMATCH')
  }

  if (targetIndex > 0) {
    const predecessor = IMMUTABLE_RECOVERY_TARGETS[targetIndex - 1]
    const { data: previous } = await db.from('invoices')
      .select('id, zatca_status, zatca_lifecycle_state, zatca_network_response_v2')
      .eq('id', predecessor.invoiceId)
      .single()
    if (!previous
        || previous.zatca_status !== 'reported'
        || previous.zatca_lifecycle_state !== 'reported'
        || previous.zatca_network_response_v2 == null) {
      throw new Error('RECOVERY_PREDECESSOR_NOT_REPORTED')
    }
  }
  return {
    alreadyReported: invoice.zatca_status === 'reported'
      && invoice.zatca_lifecycle_state === 'reported',
    target,
  }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })

  const url = new URL(req.url)
  const requestStartedAt = performance.now()

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const outboxDispatchToken = Deno.env.get('ZATCA_OUTBOX_DISPATCH_TOKEN')

    if (!anonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const callerJWT = bearerToken(req)
    const earlyPostBody = req.method === 'POST'
      ? rpcObject(await req.clone().json().catch(() => ({})))
      : {}
    const drainAuthorization = await authorizeDrainRequest({
      body: earlyPostBody,
      callerJWT,
      apiKey: req.headers.get('apikey'),
      dispatchToken: req.headers.get('x-zatca-dispatch-token'),
      expectedDispatchToken: outboxDispatchToken,
      expectedProjectRef: ZATCA_OUTBOX_PROJECT_REF,
    })
    const requestsGlobalDrain = drainAuthorization.isDrain

    // This is the only route handled before normal user/invoice authorization.
    // Supabase's gateway validates the legacy JWT signature. This route then
    // requires matching Authorization/apikey JWTs scoped to this project plus
    // a timing-safe match on the dedicated dispatcher capability token. It
    // deliberately does not compare that JWT with SUPABASE_SERVICE_ROLE_KEY,
    // which may be an unrelated sb_secret runtime credential.
    if (requestsGlobalDrain) {
      if (!drainAuthorization.allowed) {
        return jsonResponse({
          error: drainAuthorization.code === 'DRAIN_SCOPE_NOT_ALLOWED'
            ? 'Global drain does not accept caller scope'
            : 'Service-role authorization required',
          code: drainAuthorization.code ?? 'SERVICE_ROLE_REQUIRED',
        }, drainAuthorization.status ?? 403)
      }
      const batchSize = clampReportingBatchSize(earlyPostBody.batchSize)
      const results = await drainReportingOutboxV2(supabase as any, batchSize)
      const summary = {
        accepted: 0,
        retryable: 0,
        blocked: 0,
        inProgress: 0,
      }
      for (const result of results) {
        if (result.status === 'accepted') summary.accepted += 1
        else if (result.status === 'retryable') summary.retryable += 1
        else if (result.status === 'blocked') summary.blocked += 1
        else if (result.status === 'in_progress') summary.inProgress += 1
      }
      return jsonResponse({
        ok: true,
        action: 'drain_outbox',
        processed: results.length,
        batchSize,
        summary,
      })
    }
    if (!callerJWT) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerJWT}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error: authErr } = await authClient.auth.getUser(callerJWT)
    if (authErr || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const callerProfile = await loadCallerProfile(authClient as any, user.id)
    if (!callerProfile) {
      return jsonResponse({ error: 'Caller profile not found' }, 403)
    }

    // ── GET /debug?branchId=... — sandbox-only cert digest diagnostics ──
    if (req.method === 'GET' && url.searchParams.has('branchId')) {
      if (Deno.env.get('ZATCA_ENABLE_SUBMIT_DEBUG') !== 'true') {
        return jsonResponse({ error: 'Debug diagnostics are disabled' }, 404)
      }

      const branchId = url.searchParams.get('branchId')!
      const branchAuth = await authorizeBranchAccess(supabase as any, branchId, callerProfile)
      if (!branchAuth.ok) return branchAuth.response

      const { data: cert } = await supabase
        .from('zatca_certificates').select('production_csid, environment')
        .eq('branch_id', branchId)
        .eq('tenant_id', branchAuth.target.tenantId)
        .eq('environment', 'sandbox')
        .eq('status', 'active')
        .maybeSingle()

      if (!cert?.production_csid || cert.environment !== 'sandbox') {
        return jsonResponse({ error: 'No active sandbox cert for branch' }, 404)
      }

      const { certPemBody, certDer } = decodeCertificateToken(cert.production_csid)

      const certDigestBytes = new Uint8Array(await sha256Bytes(new TextEncoder().encode(certPemBody)))
      const certDigestHex   = bytesToHex(certDigestBytes)
      const certDigestB64   = btoa(certDigestHex)

      const serialNumber = extractCertSerial(certDer)
      const issuerName   = extractCertIssuerName(certDer)
      const signingTime  = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

      const signedPropsXml = buildSignedProperties(signingTime, certDigestB64, issuerName, serialNumber)
      const spHashBytes    = new Uint8Array(await sha256Bytes(new TextEncoder().encode(signedPropsXml)))
      const spHex          = bytesToHex(spHashBytes)
      const spDigestB64    = btoa(spHex)

      return jsonResponse({
        certDerLength:     certDer.length,
        certDerFirst10Hex: Array.from(certDer.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '),
        certDigestLength:  certDigestB64.length,
        certDigestB64,
        signedPropsXml,
        spDigestLength:    spDigestB64.length,
        spDigestB64,
        environment: 'sandbox',
      })
    }

    const body = earlyPostBody
    const invoiceId = body?.invoiceId as string | undefined
    const source = normalizeSubmitSource(body?.source)
    const rawAction = typeof body?.action === 'string' ? body.action : null
    if (rawAction !== null && ![
      'submit',
      'finalize',
      'status',
      'capability',
      'capabilities',
      'retry',
      'recover_immutable_pair',
      'checkout_simplified',
      'checkout_simplified_credit_note',
    ].includes(rawAction)) {
      return jsonResponse({
        error: 'Unsupported ZATCA submit action',
        code: 'UNSUPPORTED_SUBMIT_ACTION',
      }, 400)
    }
    const action = normalizeSubmitAction(body?.action)

    const capabilities = await loadFinalizationCapabilitiesV2(supabase as any)
    const clientVersion = typeof body?.clientVersion === 'string' ? body.clientVersion : null

    if (action === 'capabilities') {
      const branchId = typeof body?.branchId === 'string' ? body.branchId : null
      if (!branchId) return jsonResponse({ error: 'Missing required field: branchId' }, 400)
      const branchAuth = await authorizeBranchAccess(supabase as any, branchId, callerProfile)
      if (!branchAuth.ok) return branchAuth.response

      const atomicRollout = await loadAtomicSimplifiedRolloutV2(
        supabase as any,
        branchAuth.target.tenantId,
        branchId,
      )
      const branchCapabilities = resolveAtomicSimplifiedCheckoutCapability(
        capabilities,
        atomicRollout,
      ) as FinalizationCapabilitiesV2
      let readiness = await loadBranchReadinessV2(supabase as any, branchId, user.id)
      if (
        branchCapabilities.compatible
        && branchCapabilities.databaseFeatureEnabled
        && branchCapabilities.simplifiedEnabled
        && !branchCapabilities.edgeKillSwitchEnabled
        && readiness.structurallyReady
        && clientVersion === FINALIZATION_CLIENT_VERSION
      ) {
        const acknowledgement = await supabase.rpc('acknowledge_zatca_client_capability_v2', {
          p_user_id: user.id,
          p_branch_id: branchId,
          p_client_version: clientVersion,
          p_edge_version: FINALIZATION_EDGE_VERSION,
          p_ttl_seconds: 300,
        })
        if (!acknowledgement.error && rpcObject(acknowledgement.data).acknowledged === true) {
          readiness = await loadBranchReadinessV2(supabase as any, branchId, user.id)
        }
      }
      const simplifiedCheckoutMode = branchCheckoutMode(branchCapabilities, readiness)
      const standardCheckoutMode = simplifiedCheckoutMode === 'v2' && branchCapabilities.standardEnabled
        ? 'v2'
        : 'legacy'
      return jsonResponse({
        ...branchCapabilities,
        ...readiness,
        acknowledged: readiness.clientAcknowledged,
        branchV2Ready: simplifiedCheckoutMode === 'v2',
        checkoutMode: simplifiedCheckoutMode,
        simplifiedCheckoutMode,
        standardCheckoutMode,
      })
    }

    if (action === 'checkout_simplified' || action === 'checkout_simplified_credit_note') {
      logPipelineTiming('checkout_request_started', requestStartedAt, {
        action,
        actorUserId: user.id,
      })
      if (!capabilities.compatible
          || clientVersion !== FINALIZATION_CLIENT_VERSION) {
        return jsonResponse({
          error: 'Atomic simplified checkout is unavailable or version-incompatible',
          code: 'ATOMIC_SIMPLIFIED_CHECKOUT_UNAVAILABLE',
        }, 409)
      }
      const branchId = typeof body?.branchId === 'string' ? body.branchId : null
      const checkoutPayload = rpcObject(body?.checkout)
      const cartFingerprint = typeof body?.cartFingerprint === 'string'
        ? body.cartFingerprint.trim().toLowerCase()
        : ''
      if (!branchId || Object.keys(checkoutPayload).length === 0
          || !/^[a-f0-9]{64}$/.test(cartFingerprint)) {
        return jsonResponse({
          error: 'Atomic simplified checkout request is incomplete',
          code: 'INVALID_ATOMIC_CHECKOUT_REQUEST',
        }, 400)
      }
      const branchAuth = await authorizeBranchAccess(supabase as any, branchId, callerProfile)
      if (!branchAuth.ok) return branchAuth.response

      const checkoutIdempotencyKey = typeof checkoutPayload.idempotency_key === 'string'
        ? checkoutPayload.idempotency_key.trim()
        : ''
      if (checkoutIdempotencyKey) {
        const existingResult = await supabase.rpc('get_zatca_atomic_checkout_result_v2', {
          p_actor_user_id: user.id,
          p_branch_id: branchId,
          p_idempotency_key: checkoutIdempotencyKey,
          p_cart_fingerprint: cartFingerprint,
        })
        const resultSchemaMissing = existingResult.error != null && (
          existingResult.error.code === '42883'
          || existingResult.error.code === 'PGRST202'
          || /does not exist|could not find the function/i.test(String(existingResult.error.message ?? ''))
        )
        if (existingResult.error && !resultSchemaMissing) {
          return jsonResponse({
            error: safeZatcaText(existingResult.error.message, 180)
              ?? 'Atomic checkout idempotency lookup failed',
            code: 'ATOMIC_CHECKOUT_IDEMPOTENCY_CONFLICT',
          }, 409)
        }
        const existing = rpcObject(existingResult.data)
        if (!existingResult.error && existing.status === 'committed' && existing.receipt) {
          logPipelineTiming('receipt_payload_returned', requestStartedAt, {
            invoiceId: existing.invoiceId,
            idempotentReplay: true,
          })
          return jsonResponse({
            status: 'committed',
            invoiceStatus: 'pending',
            finalizationStatus: 'locally_finalized',
            artifactStage: 'simplified_final',
            documentKind: 'simplified',
            reportingDisplayState: existing.receipt.reporting_display_state ?? 'reporting_pending',
            canPrint: true,
            receipt: existing.receipt,
            idempotentReplay: true,
          })
        }
        if (!existingResult.error && existing.status !== 'not_found') {
          return jsonResponse({
            error: 'An atomic checkout with this idempotency key is not committed yet',
            code: 'ATOMIC_CHECKOUT_IDEMPOTENCY_IN_PROGRESS',
          }, 409)
        }

        const legacyIdempotencyColumn = action === 'checkout_simplified_credit_note'
          ? 'credit_note_idempotency_key'
          : 'checkout_idempotency_key'
        const existingLegacyInvoice = await supabase.from('invoices')
          .select('id')
          .eq('tenant_id', branchAuth.target.tenantId)
          .eq('branch_id', branchId)
          .eq(legacyIdempotencyColumn, checkoutIdempotencyKey)
          .maybeSingle()
        if (existingLegacyInvoice.error) {
          return jsonResponse({
            error: 'Unable to verify checkout idempotency compatibility',
            code: 'ATOMIC_CHECKOUT_IDEMPOTENCY_LOOKUP_FAILED',
          }, 409)
        }
        if (existingLegacyInvoice.data?.id) {
          return jsonResponse({
            status: 'legacy_required',
            reason: 'existing_legacy_idempotency',
          })
        }
      }

      const [atomicRuntimeResult, atomicBranchGateResult] = await Promise.all([
        supabase.from('zatca_finalization_runtime')
          .select('atomic_simplified_checkout_enabled')
          .eq('singleton', true)
          .maybeSingle(),
        supabase.from('zatca_atomic_checkout_branch_gates_v2')
          .select('enabled')
          .eq('tenant_id', branchAuth.target.tenantId)
          .eq('branch_id', branchId)
          .maybeSingle(),
      ])
      const atomicRolloutEnabled = atomicRuntimeResult.error == null
        && atomicBranchGateResult.error == null
        && atomicRuntimeResult.data?.atomic_simplified_checkout_enabled === true
        && atomicBranchGateResult.data?.enabled === true
      if (!capabilities.databaseFeatureEnabled
          || !capabilities.immutableFinalizationEnabled
          || !capabilities.simplifiedEnabled
          || !atomicRolloutEnabled) {
        return jsonResponse({
          status: 'legacy_required',
          reason: 'atomic_rollout_disabled',
        })
      }

      let readiness = await loadBranchReadinessV2(supabase as any, branchId, user.id)
      if (readiness.structurallyReady && !readiness.clientAcknowledged) {
        const acknowledgement = await supabase.rpc('acknowledge_zatca_client_capability_v2', {
          p_user_id: user.id,
          p_branch_id: branchId,
          p_client_version: clientVersion,
          p_edge_version: FINALIZATION_EDGE_VERSION,
          p_ttl_seconds: 300,
        })
        if (!acknowledgement.error && rpcObject(acknowledgement.data).acknowledged === true) {
          readiness = await loadBranchReadinessV2(supabase as any, branchId, user.id)
        }
      }
      if (!readiness.structurallyReady || !readiness.clientAcknowledged
          || readiness.branchBlocked || !readiness.productionConnected) {
        return jsonResponse({
          status: 'legacy_required',
          reason: 'atomic_branch_not_ready',
        })
      }

      const reqId = requestId(req)
      const ipHash = await hashRequestIp(req)
      const auditBase = {
        tenantId: branchAuth.target.tenantId,
        branchId,
        actorUserId: user.id,
        actorRole: callerProfile.role,
        targetType: 'branch',
        targetId: branchId,
        ipHash,
        requestId: reqId,
      }
      const rate = await enforceRateLimit(supabase as any, {
        ...auditBase,
        action: 'zatca_atomic_simplified_checkout',
        scope: 'branch',
        scopeId: branchId,
        maxAttempts: 20,
        windowSeconds: 60,
        metadata: { operation: action },
      })
      if (!rate.allowed) return jsonResponse(rateLimitBody(rate), 429)

      await auditEvent(supabase as any, {
        ...auditBase,
        action: 'zatca_atomic_checkout_attempted',
        status: 'attempted',
        metadata: {
          operation: action,
          idempotencyKeyPresent: typeof checkoutPayload.idempotency_key === 'string',
        },
      })
      try {
        const result = await processAtomicSimplifiedCheckoutV2({
          serviceDb: supabase as any,
          callerDb: authClient as any,
          caller: callerProfile,
          branchId,
          checkoutPayload,
          cartFingerprint,
          documentType: action === 'checkout_simplified_credit_note' ? 'credit_note' : 'invoice',
          requestStartedAt,
        })
        scheduleEdgeBackgroundTask(auditEvent(supabase as any, {
          ...auditBase,
          action: 'zatca_atomic_checkout_committed',
          status: 'succeeded',
          targetType: 'invoice',
          targetId: String(result.receipt?.invoice_id ?? ''),
          metadata: {
            operation: action,
            idempotentReplay: result.idempotentReplay === true,
          },
        }), '[zatca-audit] unable to persist atomic checkout success audit:')
        return jsonResponse(result)
      } catch (error) {
        const message = safeZatcaText(error instanceof Error ? error.message : error, 220)
          ?? 'Atomic simplified checkout failed'
        await auditEvent(supabase as any, {
          ...auditBase,
          action: 'zatca_atomic_checkout_failed',
          severity: 'warning',
          status: 'failed',
          metadata: { operation: action, reason: message },
        })
        return jsonResponse({
          error: message,
          code: error instanceof ZatcaSubmitAssertionError
            ? error.statusString
            : 'ATOMIC_SIMPLIFIED_CHECKOUT_FAILED',
        }, 409)
      }
    }

    if (!invoiceId) {
      return jsonResponse({ error: 'Missing required field: invoiceId' }, 400)
    }

    const actionlessLegacyRequest = rawAction === null && clientVersion === null
    const compatibleStatusRequest = action === 'status'
      && clientVersion !== null
      && OUTPUT_STATE_READ_CLIENT_VERSIONS.has(clientVersion)
    const compatibleStoredArtifactRequest = (
      action === 'retry' || action === 'recover_immutable_pair'
    ) && clientVersion === FINALIZATION_CLIENT_VERSION
    if (!actionlessLegacyRequest
        && !compatibleStatusRequest
        && !compatibleStoredArtifactRequest
        && (!capabilities.compatible || clientVersion !== FINALIZATION_CLIENT_VERSION)) {
      return jsonResponse({
        error: 'ZATCA finalization client/schema/Edge version mismatch',
        code: 'FINALIZATION_VERSION_MISMATCH',
        ...capabilities,
      }, 426)
    }

    const invoiceAuth = await authorizeInvoiceSubmission(supabase as any, invoiceId, callerProfile)
    if (!invoiceAuth.ok) return invoiceAuth.response
    const readiness = await loadBranchReadinessV2(
      supabase as any,
      invoiceAuth.target.branchId,
      user.id,
    )
    const checkoutMode = branchCheckoutMode(capabilities, readiness)
    const useLegacyProcessor = invoiceAuth.target.v2Invoice !== true
      || checkoutMode === 'legacy'

    // A row already stamped server_v2 must never be downgraded into the legacy
    // writer. New rows cannot receive that stamp unless this same branch gate
    // and acknowledgement passed in the database insert trigger.
    if (
      !['status', 'retry', 'recover_immutable_pair'].includes(action)
      && invoiceAuth.target.v2Invoice === true
      && checkoutMode !== 'v2'
    ) {
      return jsonResponse({
        error: 'Branch v2 readiness is no longer valid',
        code: 'BRANCH_V2_NOT_READY',
        checkoutMode: 'legacy',
      }, 409)
    }

    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId: invoiceAuth.target.tenantId,
      branchId: invoiceAuth.target.branchId,
      actorUserId: user.id,
      actorRole: callerProfile.role,
      targetType: 'invoice',
      targetId: invoiceId,
      ipHash,
      requestId: reqId,
    }

    await auditEvent(supabase as any, {
      ...auditBase,
      action: 'zatca_submit_attempted',
      status: 'attempted',
      metadata: { source, operation: action },
    })

    const rate = await enforceRateLimit(supabase as any, {
      ...auditBase,
      action: 'zatca_submit_invoice',
      scope: 'invoice',
      scopeId: invoiceId,
      maxAttempts: 8,
      windowSeconds: 600,
      metadata: { source, operation: action },
    })

    if (!rate.allowed) {
      await auditEvent(supabase as any, {
        ...auditBase,
        action: 'zatca_submit_rate_limited',
        severity: 'warning',
        status: 'blocked',
        metadata: { retryAfterSeconds: rate.retryAfterSeconds },
      })
      return jsonResponse(rateLimitBody(rate), 429)
    }

    if (action === 'status') {
      // Historical output follows the invoice's immutable provenance, not the
      // current rollout flags or checkout mode. A rolled-back server_v2 row
      // must still expose its stored simplified/cleared artifact.
      const state = invoiceAuth.target.v2Invoice === true
        ? await loadOutputStateV2(supabase as any, invoiceId, invoiceAuth.target.tenantId)
        : await loadLegacyOutputState(supabase as any, invoiceId, invoiceAuth.target.tenantId)
      await auditEvent(supabase as any, {
        ...auditBase,
        action: 'zatca_output_state_read',
        status: 'succeeded',
        metadata: { operation: action },
      })
      return jsonResponse({
        ...state,
        schemaVersion: capabilities.schemaVersion,
        edgeFunctionVersion: capabilities.edgeFunctionVersion,
        minimumClientVersion: capabilities.minimumClientVersion,
        compatible: capabilities.compatible,
        immutableFinalizationEnabled: capabilities.immutableFinalizationEnabled,
        databaseFeatureEnabled: capabilities.databaseFeatureEnabled,
        legacySubmitAvailable: capabilities.legacySubmitAvailable,
        branchV2Ready: checkoutMode === 'v2',
        checkoutMode,
      })
    }

    if (action === 'retry') {
      if (invoiceAuth.target.v2Invoice !== true) {
        return jsonResponse({
          error: 'Legacy invoices use the unchanged legacy retry contract',
          code: 'LEGACY_RETRY_CONTRACT_REQUIRED',
        }, 409)
      }
      const state = await loadOutputStateV2(
        supabase as any,
        invoiceId,
        invoiceAuth.target.tenantId,
      )
      if (state.documentKind !== 'simplified' || state.artifactStage !== 'simplified_final') {
        return jsonResponse({
          error: 'Only an immutable simplified_final artifact can use durable reporting retry',
          code: 'STORED_SIMPLIFIED_ARTIFACT_REQUIRED',
        }, 409)
      }
      const queued = await supabase.rpc('enqueue_zatca_reporting_outbox_v2', {
        p_invoice_id: invoiceId,
        p_source: source,
      })
      if (queued.error) {
        return jsonResponse({
          error: safeZatcaText(queued.error.message, 180) ?? 'Unable to queue reporting retry',
          code: 'DURABLE_REPORTING_RETRY_FAILED',
        }, 409)
      }
      const queuedState = rpcObject(queued.data)
      if (queuedState.status === 'blocked') {
        return jsonResponse({
          ...state,
          error: safeZatcaText(queuedState.error, 180) ?? 'Reporting is blocked for operator review',
          code: 'REPORTING_OUTBOX_BLOCKED',
          reportingDispatch: 'blocked',
          durable: true,
        }, 409)
      }
      scheduleReportingOutboxDrain(supabase as any, invoiceId)
      await auditEvent(supabase as any, {
        ...auditBase,
        action: 'zatca_reporting_retry_queued',
        status: 'succeeded',
        metadata: { source, operation: action, dispatch: queuedState.status },
      })
      return jsonResponse({
        ...state,
        reportingDispatch: queuedState.status,
        durable: true,
      })
    }

    if (action === 'recover_immutable_pair') {
      if (!TENANT_SUBMIT_ROLES.has(callerProfile.role)) {
        return jsonResponse({
          error: 'Recovery requires an authenticated owner or admin',
          code: 'RECOVERY_OPERATOR_REQUIRED',
        }, 403)
      }
      if (invoiceAuth.target.branchId !== RECOVERY_BRANCH_ID
          || body?.confirmation !== `recover:${RECOVERY_BRANCH_ID}:865-866`) {
        return jsonResponse({
          error: 'Recovery scope or confirmation does not match the immutable incident pair',
          code: 'RECOVERY_SCOPE_MISMATCH',
        }, 409)
      }
      const recovery = await validateImmutableRecoveryTarget(supabase as any, invoiceId)
      let queuedRecovery: Record<string, any> | null = null
      if (!recovery.alreadyReported) {
        const queued = await supabase.rpc('enqueue_zatca_reporting_outbox_v2', {
          p_invoice_id: invoiceId,
          p_source: 'authenticated_operator_recovery',
        })
        if (queued.error) {
          return jsonResponse({
            error: safeZatcaText(queued.error.message, 180) ?? 'Unable to queue recovery target',
            code: 'RECOVERY_OUTBOX_FAILED',
          }, 409)
        }
        queuedRecovery = rpcObject(queued.data)
      }
      const dispatch = recovery.alreadyReported
        ? { status: 'accepted' as const, invoiceId }
        : queuedRecovery?.status === 'blocked'
        ? {
            status: 'blocked' as const,
            invoiceId,
            error: safeZatcaText(queuedRecovery.error, 180)
              ?? 'Reporting is blocked for operator review',
          }
        : await processReportingOutboxV2(
          supabase as any,
          `operator-recovery:${user.id}`,
          invoiceId,
        )
      const state = await loadOutputStateV2(
        supabase as any,
        invoiceId,
        invoiceAuth.target.tenantId,
      )
      const accepted = dispatch.status === 'accepted'
        && state.invoiceStatus === 'reported'
        && state.finalizationStatus === 'reported'
      await auditEvent(supabase as any, {
        ...auditBase,
        action: 'zatca_immutable_pair_recovery',
        severity: accepted ? 'info' : 'warning',
        status: accepted ? 'succeeded' : 'failed',
        metadata: {
          source,
          operation: action,
          invoiceNumber: recovery.target.invoiceNumber,
          counterNumber: recovery.target.counterNumber,
          dispatchStatus: dispatch.status,
        },
      })
      return jsonResponse({
        ...state,
        recovery: {
          accepted,
          dispatchStatus: dispatch.status,
          invoiceNumber: recovery.target.invoiceNumber,
          counterNumber: recovery.target.counterNumber,
          stopped: !accepted,
          error: dispatch.error ?? null,
        },
      })
    }

    const result = useLegacyProcessor
      ? await processLegacyInvoiceDisabledMode(
        supabase as any,
        invoiceId,
        invoiceAuth.target.tenantId,
        source,
      )
      : await processInvoiceV2(
        supabase as any,
        invoiceId,
        invoiceAuth.target.tenantId,
        source,
        action,
      )
    const succeeded = useLegacyProcessor
      ? ['reported', 'cleared'].includes(result.invoiceStatus)
      : action === 'finalize'
      ? ['locally_finalized', 'provisional_signed', 'cleared_final'].includes(result.finalizationStatus)
      : result.documentKind === 'simplified' && result.artifactStage === 'simplified_final'
      ? true
      : ['reported', 'cleared'].includes(result.invoiceStatus)
    await auditEvent(supabase as any, {
      ...auditBase,
      action: succeeded ? 'zatca_submit_succeeded' : 'zatca_submit_failed',
      severity: succeeded ? 'info' : 'warning',
      status: succeeded ? 'succeeded' : 'failed',
      metadata: {
        source,
        operation: action,
        invoiceStatus: result.invoiceStatus,
        diagnostics: result.diagnostics ? safeSubmitDiagnosticSummary(result.diagnostics) : undefined,
      },
    })
    if (result.documentKind === 'simplified' && result.artifactStage === 'simplified_final') {
      scheduleReportingOutboxDrain(supabase as any, invoiceId)
    }
    return jsonResponse(result)

  } catch (err: any) {
    const message = safeZatcaText(err.message ?? 'unknown', 240) ?? 'Internal server error'
    console.error('[zatca-submit] unexpected error:', message)
    return jsonResponse({ error: message }, 500)
  }
})
