/**
 * zatca-submit Edge Function — Full ZATCA Phase 2 pipeline (server-side Deno)
 *
 * Receives { invoiceId } from browser, then does everything:
 *   1. Fetch invoice + branch + active cert from DB
 *   2. Decrypt private key (AES-256-GCM / PBKDF2)
 *   3. Build UBL XML
 *   4. Sign (XAdES, secp256k1)
 *   5. Submit to the fixed ZATCA Integration Sandbox reporting API
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

// ── Constants ────────────────────────────────────────────────────────────────

const SANDBOX_BASE_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const FIRST_INVOICE_HASH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

interface SubmissionCredentials {
  privateKey: Uint8Array
  sandboxCsid: string
  sandboxSecret: string
}

interface SubmitDiagnostics {
  invoiceHash?: string
  finalXmlHash?: string
  qrHash?: string
  dsDigestValue?: string
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

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requireServiceRole(req: Request): void {
  const authorization = req.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i)
  if (!match) throw new Error('Unauthorized')

  try {
    const segments = match[1].split('.')
    if (segments.length !== 3) throw new Error('Malformed JWT')

    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const claims = JSON.parse(atob(padded)) as { role?: unknown }
    if (claims.role !== 'service_role') throw new Error('Invalid role')
  } catch {
    throw new Error('Unauthorized')
  }
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
  console.info('[zatca-submit-sandbox-demo] authorization decision:', {
    invoiceId: params.invoiceId ?? null,
    tenantId: params.tenantId ?? null,
    branchId: params.branchId ?? null,
    callerRole: params.callerRole ?? null,
    allowed: params.allowed,
  })
}

async function loadCallerProfile(db: any, userId: string): Promise<CallerProfile | null> {
  const { data, error } = await db
    .from('user_profiles')
    .select('id, role, tenant_id, branch_id, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[zatca-submit-sandbox-demo] caller profile lookup failed:', safeZatcaText(error.message, 160))
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
    console.warn('[zatca-submit-sandbox-demo] invoice authorization lookup failed:', safeZatcaText(error.message, 160))
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
    return { ok: false, response: jsonResponse({ error: 'Invoice not found or access denied' }, 404) }
  }

  return { ok: true, target }
}

// ── Crypto utilities ─────────────────────────────────────────────────────────

async function decryptServerEnvelope(stored: string, secret: string): Promise<string> {
  const [version, ivB64, encB64] = stored.split(':')
  if (version !== 'v1' || !ivB64 || !encB64) {
    throw new Error('Invalid encrypted Sandbox credential format')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0))
  const enc = Uint8Array.from(atob(encB64), c => c.charCodeAt(0))
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc)
  return new TextDecoder().decode(dec)
}

async function decryptServerPrivateKey(stored: string, secret: string): Promise<Uint8Array> {
  const pem = await decryptServerEnvelope(stored, secret)
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
    il.ele(NS.cbc, 'InvoicedQuantity').att('unitCode', line.unitCode ?? 'PCE').txt(String(line.qty))
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
    price.ele(NS.cbc, 'BaseQuantity').att('unitCode', line.unitCode ?? 'PCE').txt('1')
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
    sellerName:      branch.registered_seller_name || '',
    sellerNameAr:    branch.registered_seller_name_ar ?? branch.registered_seller_name ?? '',
    sellerVat:       branch.vat_number ?? '',
    sellerRegistrationScheme: branch.registration_scheme,
    sellerCrn:       branch.registration_identifier ?? undefined,
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
      unitCode: /^[A-Z0-9]{2,8}$/.test(String(it.selling_unit_code ?? '').trim().toUpperCase())
        ? String(it.selling_unit_code).trim().toUpperCase()
        : 'PCE',
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

async function loadSubmissionCredentials(db: any, branchId: string, tenantId: string): Promise<SubmissionCredentials & { deviceId: string }> {
  const { data: c, error } = await db.from('zatca_sandbox_credentials')
    .select('device_id,encrypted_private_key,encrypted_production_csid,encrypted_production_secret')
    .eq('tenant_id', tenantId).eq('branch_id', branchId).eq('environment', 'sandbox')
    .eq('status', 'active').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).single()
  if (error || !c?.encrypted_private_key || !c.encrypted_production_csid || !c.encrypted_production_secret) {
    throw new Error('Sandbox ZATCA credentials are missing or expired.')
  }
  const secret = Deno.env.get('ZATCA_SERVER_ENCRYPTION_KEY')
  if (!secret) throw new Error('ZATCA_SERVER_ENCRYPTION_KEY is not configured')
  return {
    deviceId: c.device_id,
    privateKey: await decryptServerPrivateKey(c.encrypted_private_key, secret),
    sandboxCsid: await decryptServerEnvelope(c.encrypted_production_csid, secret),
    sandboxSecret: await decryptServerEnvelope(c.encrypted_production_secret, secret),
  }
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

// ── Isolated Sandbox demo processor ──────────────────────────────────────────
async function rpc(db:any, name:string, args:Record<string,unknown>):Promise<any> {
  const {data,error}=await db.rpc(name,args); if(error) throw new Error(error.message); return data
}
async function processInvoice(db:any, invoiceId:string, tenantId:string, internalRetry:boolean):Promise<any> {
  const q=await db.from('invoices').select('id,invoice_number,invoice_reference,original_invoice_id,credit_reason,zatca_uuid,zatca_invoice_type,zatca_type_code,created_at,zatca_status,subtotal,discount_amount,taxable_amount,tax_amount,total_amount,branch_id,tenant_id,invoice_items(id,name,quantity,selling_unit_code,unit_price,discount_amount,subtotal,tax_rate,tax_amount,total),customers(name,vat_number)').eq('id',invoiceId).eq('tenant_id',tenantId).single()
  const inv=q.data; if(q.error||!inv) throw new Error('Invoice not found')
  const tq=await db.from('tenants').select('id').eq('id',tenantId).eq('is_demo',true).eq('is_active',true).single()
  const legacyBranch=await db.from('branches').select('id,tenant_id,compliance_identity_mode,name,business_name,business_name_ar,vat_number,cr_number,building_number,street,district,city,postal_code,country,zatca_environment,is_active').eq('id',inv.branch_id).eq('tenant_id',tenantId).eq('zatca_environment','sandbox').eq('is_active',true).single()
  const protectedMode=legacyBranch.data?.compliance_identity_mode==='protected'
  const bq=protectedMode
    ? await db.from('branch_compliance_profiles').select('branch_id,tenant_id,registered_seller_name,registered_seller_name_ar,vat_number,registration_scheme,registration_identifier,building_number,street,district,city,postal_code,country,validation_status').eq('branch_id',inv.branch_id).eq('tenant_id',tenantId).eq('validation_status','verified').single()
    : {data:legacyBranch.data?{...legacyBranch.data,registered_seller_name:legacyBranch.data.business_name||legacyBranch.data.name,registered_seller_name_ar:legacyBranch.data.business_name_ar,registration_scheme:'CRN',registration_identifier:legacyBranch.data.cr_number}:null,error:legacyBranch.error}
  if(tq.error||bq.error||!tq.data||!bq.data) throw new Error('Invoice is outside the authorized Sandbox demo scope')
  if(['reported','cleared'].includes(inv.zatca_status)) return {invoiceStatus:inv.zatca_status}
  if(inv.zatca_invoice_type==='standard') return {invoiceStatus:'not_submitted',error:'Standard invoice clearance is not supported in the Sandbox demo yet.'}
  if(inv.zatca_invoice_type==='debit_note') return {invoiceStatus:'not_submitted',error:'Debit notes are not supported in the Sandbox demo.'}
  if(!['simplified','credit_note'].includes(inv.zatca_invoice_type)) return {invoiceStatus:'not_submitted',error:'Unsupported Sandbox demo document type.'}
  let original:any=null
  if(inv.zatca_invoice_type==='credit_note'){
    if(!inv.original_invoice_id||inv.zatca_type_code!=='381'||!String(inv.credit_reason??'').trim()) throw new Error('Invalid credit note')
    const oq=await db.from('invoices').select('id,invoice_number,zatca_invoice_type,zatca_status').eq('id',inv.original_invoice_id).eq('tenant_id',tenantId).eq('branch_id',inv.branch_id).single()
    original=oq.data
    if(oq.error||!original||original.zatca_invoice_type!=='simplified'||!['reported','cleared'].includes(original.zatca_status)) throw new Error('Credit note must reference a reported simplified invoice')
  }
  const c=await loadSubmissionCredentials(db,inv.branch_id,tenantId)
  const rr=await rpc(db,'reserve_zatca_sandbox_submission',{p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_device_id:c.deviceId,p_invoice_id:inv.id})
  const r=Array.isArray(rr)?rr[0]:rr
  if(!r) throw new Error('Sandbox reservation failed')
  if(r.reservation_state==='accepted') return {invoiceStatus:'reported'}
  if(r.reservation_state==='rejected') return {invoiceStatus:'failed'}
  if(r.reservation_state==='cancelled_before_dispatch') throw new Error('Reservation cancelled before dispatch')
  let dispatchAlreadyMarked=false
  if(r.reservation_state==='dispatched') {
    if(!internalRetry) return {invoiceStatus:'pending',reservationState:'dispatched',reconciliationRequired:true}
    await rpc(db,'reconcile_zatca_sandbox_submission',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_environment:'sandbox',p_device_id:c.deviceId,p_invoice_id:inv.id,p_counter:r.invoice_counter,p_action:'mark_ambiguous'})
    r.reservation_state='ambiguous'
  }
  if(r.reservation_state==='ambiguous'&&!internalRetry) {
    return {invoiceStatus:'pending',reservationState:'ambiguous',reconciliationRequired:true}
  }
  if(r.reservation_state==='ambiguous'&&internalRetry) {
    await rpc(db,'reconcile_zatca_sandbox_submission',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_environment:'sandbox',p_device_id:c.deviceId,p_invoice_id:inv.id,p_counter:r.invoice_counter,p_action:'mark_dispatched'})
    dispatchAlreadyMarked=true
  }
  let signedXml=r.signed_xml, invoiceHash=r.invoice_hash, payload=r.submission_payload, signatureValue=r.signature_value, qrCode=r.qr_code
  if(!payload){
    const xmlInv={...inv,zatca_uuid:r.invoice_uuid,zatca_counter_number:Number(r.invoice_counter),zatca_prev_invoice_hash:r.previous_invoice_hash}
    const xmlData=buildInvoiceXMLData(xmlInv,bq.data,inv.invoice_items??[],inv.customers??null,true,original?{billingReferenceId:inv.invoice_reference||original.invoice_number,reason:String(inv.credit_reason).trim()}:undefined)
    const unsigned=buildInvoice(xmlData,{profileId:'reporting:1.0',typeCodeName:'0200000',invoiceTypeCode:inv.zatca_type_code??'388',includeSignature:true,requireBuyer:false})
    const signed=await signInvoice(unsigned,c.privateKey,c.sandboxCsid)
    signedXml=signed.signedXml; invoiceHash=signed.invoiceHash; signatureValue=signed.signatureValue; qrCode=signed.qrCode
    payload={invoiceHash,uuid:r.invoice_uuid,invoice:btoa(unescape(encodeURIComponent(signedXml)))}
    await rpc(db,'store_zatca_sandbox_signed_payload',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_device_id:c.deviceId,p_invoice_id:inv.id,p_invoice_hash:invoiceHash,p_signed_xml:signedXml,p_submission_payload:payload,p_signature_value:signatureValue,p_qr_code:qrCode})
  }
  if(!dispatchAlreadyMarked) await rpc(db,'mark_zatca_sandbox_dispatched',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_device_id:c.deviceId,p_invoice_id:inv.id})
  let response:Response
  try{
    response=await fetch(SANDBOX_BASE_URL+'/invoices/reporting/single',{method:'POST',headers:{accept:'application/json','accept-version':'V2','Content-Type':'application/json',Authorization:'Basic '+btoa(c.sandboxCsid+':'+c.sandboxSecret)},body:JSON.stringify(payload)})
  }catch(error){
    await rpc(db,'mark_zatca_sandbox_ambiguous',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_device_id:c.deviceId,p_invoice_id:inv.id,p_reason:safeZatcaText(error instanceof Error?error.message:'uncertain outcome',500)})
    return {invoiceStatus:'pending',reservationState:'ambiguous'}
  }
  let responseText:string
  try {
    responseText=await response.text()
  } catch (error) {
    await rpc(db,'mark_zatca_sandbox_ambiguous',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_device_id:c.deviceId,p_invoice_id:inv.id,p_reason:safeZatcaText(error instanceof Error?error.message:'uncertain response body',500)})
    return {invoiceStatus:'pending',reservationState:'ambiguous'}
  }
  let body:any={}
  try{body=responseText?JSON.parse(responseText):{}}catch{body={httpStatus:response.status}}
  const accepted=response.ok&&body?.reportingStatus==='REPORTED'&&zatcaMessageCodes(body,'error').length===0
  const definitive=accepted||(response.status>=400&&response.status<500)
  if(!definitive){
    await rpc(db,'mark_zatca_sandbox_ambiguous',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_device_id:c.deviceId,p_invoice_id:inv.id,p_reason:'Non-definitive HTTP '+response.status})
    return {invoiceStatus:'pending',reservationState:'ambiguous'}
  }
  const final=await rpc(db,'finalize_zatca_sandbox_submission',{p_reservation_id:r.reservation_id,p_tenant_id:tenantId,p_branch_id:inv.branch_id,p_device_id:c.deviceId,p_invoice_id:inv.id,p_outcome:accepted?'accepted':'rejected',p_http_status:response.status,p_response_body:body})
  return {invoiceStatus:final?.invoice_status??(accepted?'reported':'failed')}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{status:200,headers:corsHeaders})
  if(req.method!=='POST') return jsonResponse({error:'Method not allowed'},405)
  try{
    requireServiceRole(req)
    const body=await req.json().catch(()=>({}))
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['invoiceId','source'].includes(k))) return jsonResponse({error:'Unsupported request field'},400)
    const invoiceId=typeof body.invoiceId==='string'?body.invoiceId:''
    if(!invoiceId) return jsonResponse({error:'Missing required field: invoiceId'},400)
    const url=Deno.env.get('SUPABASE_URL')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!service) return jsonResponse({error:'Unauthorized'},401)
    const db=createClient(url,service,{auth:{persistSession:false}})
    const lookup=await db.from('invoices').select('tenant_id').eq('id',invoiceId).single()
    const tenantId=lookup.data?.tenant_id??''
    return jsonResponse(await processInvoice(db as any,invoiceId,tenantId,true))
  }catch(error){
    const message=safeZatcaText(error instanceof Error?error.message:'Internal error',240)
    if(message==='Unauthorized') return jsonResponse({error:'Unauthorized'},401)
    if(message==='Invoice is outside the authorized Sandbox demo scope') return jsonResponse({error:'Forbidden'},403)
    return jsonResponse({error:message},500)
  }
})
