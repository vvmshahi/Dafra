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
}

const TENANT_SUBMIT_ROLES = new Set(['owner', 'admin'])
const AUTO_SUBMIT_SOURCES = new Set(['auto_checkout', 'auto_credit_note'])
const SUBMIT_SOURCES = new Set(['auto_checkout', 'auto_credit_note', 'manual_retry', 'bulk_retry'])

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
    .select('id, tenant_id, branch_id')
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
    .att('schemeID', 'CRN').txt(data.sellerCrn || '0000000000')
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
    sellerName:      branch.business_name || branch.name || '',
    sellerNameAr:    branch.business_name_ar ?? branch.business_name ?? branch.name ?? '',
    sellerVat:       branch.vat_number ?? '',
    sellerCrn:       branch.cr_number ?? undefined,
    sellerAddress: {
      street:      branch.street ?? '',
      buildingNo:  branch.building_number ?? '0000',
      city:        branch.city ?? '',
      postalCode:  branch.postal_code ?? '00000',
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

// ── QR builder (Phase 1 + Phase 2) ───────────────────────────────────────────

function tlvStr(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const buf = new Uint8Array(2 + bytes.length)
  buf[0] = tag; buf[1] = bytes.length; buf.set(bytes, 2)
  return buf
}
function tlvBytes(tag: number, bytes: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2 + bytes.length)
  buf[0] = tag; buf[1] = bytes.length; buf.set(bytes, 2)
  return buf
}
function concatArrays(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(len); let off = 0
  for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

// Phase 2 QR — all 9 tags (tags 1–9). Embedded in XML and stored in DB for receipts.
// 9 tags required by ZATCA; omitting tag 9 (cert CA sig) causes QRCODE_INVALID.
function buildPhase2QR(
  sellerName: string, vatNumber: string, timestamp: string,
  totalAmount: number, vatAmount: number,
  hashB64: string, sigB64: string, pubKeySpki: Uint8Array, certSigValue: Uint8Array,
): string {
  const all = concatArrays(
    tlvStr(0x01, sellerName), tlvStr(0x02, vatNumber),
    tlvStr(0x03, timestamp),
    tlvStr(0x04, totalAmount.toFixed(2)), tlvStr(0x05, vatAmount.toFixed(2)),
    tlvStr(0x06, hashB64), tlvStr(0x07, sigB64),
    tlvBytes(0x08, pubKeySpki), tlvBytes(0x09, certSigValue),
  )
  return btoa(String.fromCharCode(...all))
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
  const qrCode = buildPhase2QR(
    sellerName, vatNumber, timestamp, totalAmount, vatAmount,
    invoiceHashB64, sigValueB64, pubKeySpki, certSigValue,
  )
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

// ── Main invoice processor ────────────────────────────────────────────────────

async function processInvoice(db: any, invoiceId: string, callerTenantId: string, source: string): Promise<{
  invoiceStatus: string
  diagnostics?: SubmitDiagnostics
}> {
  console.info('[zatca-submit] processInvoice:', { invoiceId, source })

  const { data: inv, error: invErr } = await db
    .from('invoices')
    .select(`id, invoice_number, invoice_reference, original_invoice_id, credit_reason,
      zatca_uuid, zatca_invoice_type, zatca_type_code, invoice_date, created_at,
      zatca_counter_number, zatca_prev_invoice_hash, zatca_xml_hash, zatca_status,
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
    return { invoiceStatus: inv.zatca_status }
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

  const { data: branch } = await db
    .from('branches')
    .select(`
      id, name, business_name, display_name,
      vat_number, cr_number, building_number,
      street, district, city, postal_code, country,
      phone, zatca_phase, show_logo, logo_url,
      receipt_footer, show_footer, show_cash_change,
      print_mode, show_website, website,
      show_email, email
    `)
    .eq('id', inv.branch_id)
    .eq('tenant_id', callerTenantId)
    .single()

  if (!branch) {
    console.error('[zatca-submit] branch not found:', inv.branch_id)
    return { invoiceStatus: 'error' }
  }

  const sellerName = branch.business_name || branch.name || ''
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

  try {
    await db.from('invoices').update({ zatca_status: 'pending' }).eq('id', invoiceId)

    const secretKey = credentials.privateKey

    const isSimplified = inv.zatca_invoice_type === 'simplified'
      || (isCreditNote && originalInvoice?.zatca_invoice_type === 'simplified')
    console.info('[zatca-submit] building XML:', {
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

    console.info('[zatca-submit] signing XML:', { invoiceId, environment: credentials.environment })
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
    console.info('[zatca-submit] signed invoice:', { invoiceId, environment: credentials.environment })

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
      zatca_xml:                signedXml,
      zatca_xml_hash:           invoiceHash,
      zatca_signature:           signatureValue,
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

    return { invoiceStatus: newStatus }

  } catch (err: any) {
    if (isZatcaSubmitAssertionError(err)) {
      diagnostics = { ...diagnostics, ...err.diagnostics }
      console.error('[zatca-submit] local validation failed:', JSON.stringify({
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
      return { invoiceStatus: 'failed' }
    }

    console.error('[zatca-submit] error:', safeZatcaText(err.message ?? 'unknown', 240))
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
    return { invoiceStatus: retryStatus, diagnostics }
  }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders })

  const url = new URL(req.url)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!anonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }

    const callerJWT = bearerToken(req)
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

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

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

    const body = await req.json().catch(() => ({}))
    const invoiceId = body?.invoiceId as string | undefined
    const source = normalizeSubmitSource(body?.source)
    if (!invoiceId) {
      return jsonResponse({ error: 'Missing required field: invoiceId' }, 400)
    }

    const invoiceAuth = await authorizeInvoiceSubmission(supabase as any, invoiceId, callerProfile)
    if (!invoiceAuth.ok) return invoiceAuth.response

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
      metadata: { source },
    })

    const rate = await enforceRateLimit(supabase as any, {
      ...auditBase,
      action: 'zatca_submit_invoice',
      scope: 'invoice',
      scopeId: invoiceId,
      maxAttempts: 8,
      windowSeconds: 600,
      metadata: { source },
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

    const result = await processInvoice(supabase as any, invoiceId, invoiceAuth.target.tenantId, source)
    const succeeded = ['reported', 'cleared'].includes(result.invoiceStatus)
    await auditEvent(supabase as any, {
      ...auditBase,
      action: succeeded ? 'zatca_submit_succeeded' : 'zatca_submit_failed',
      severity: succeeded ? 'info' : 'warning',
      status: succeeded ? 'succeeded' : 'failed',
      metadata: {
        source,
        invoiceStatus: result.invoiceStatus,
        diagnostics: result.diagnostics ? safeSubmitDiagnosticSummary(result.diagnostics) : undefined,
      },
    })
    return jsonResponse(result)

  } catch (err: any) {
    const message = safeZatcaText(err.message ?? 'unknown', 240) ?? 'Internal server error'
    console.error('[zatca-submit] unexpected error:', message)
    return jsonResponse({ error: message }, 500)
  }
})
