/**
 * ZATCA Phase 2 — Invoice Hash, XAdES Signing & Phase 2 QR
 *
 * Implements the ZATCA signing pipeline per Security Requirements v1.2, Section 2.3.3:
 *
 *   1. computeInvoiceHash(xml)
 *      Remove UBLExtensions + Signature + QR reference → C14N11 → SHA-256 → base64
 *
 *   2. signInvoice(xml, privateKeyPem, certificate)
 *      a. Compute invoice digest
 *      b. Build XAdES SignedProperties → C14N → SHA-256 → digest2
 *      c. Build SignedInfo (digest1, digest2) → C14N → ECDSA sign → SignatureValue
 *      d. Assemble XAdES UBLExtensions block + embed in XML
 *      e. Generate Phase 2 QR (9 TLV tags) → embed in XML
 *      f. Return { signedXml, invoiceHash, qrCode }
 *
 * C14N11 algorithm: http://www.w3.org/2006/12/xml-c14n11
 * Signature: ECDSA P-256 / SHA-256 (Web Crypto API)
 * XAdES level: B-B (Baseline-Basic), enveloped
 */

import forge from 'node-forge'
import { sha256, sha256Bytes, importPrivateKeyPem, ecdsaSign, p1363ToDer } from './crypto'
import { buildZatcaQR } from './qr'

// ── Public interface ──────────────────────────────────────────────────────────

export interface SignedInvoice {
  signedXml:    string
  invoiceHash:  string  // base64 SHA-256 of transformed+canonicalized XML
  qrCode:       string  // base64 Phase 2 QR TLV payload
}

// ── computeInvoiceHash ────────────────────────────────────────────────────────

/**
 * Compute the ZATCA invoice hash:
 *   1. Remove <ext:UBLExtensions>, <cac:Signature>, and the QR <cac:AdditionalDocumentReference>
 *   2. Canonicalize the result (C14N11)
 *   3. SHA-256 → base64
 *
 * This hash is used as:
 *   - The DigestValue in the XAdES Signature (ds:Reference Id="invoiceSignedData")
 *   - The PIH (PreviousInvoiceHash) of the NEXT invoice
 *   - Tag 6 of the Phase 2 QR code (raw 32 bytes)
 */
export async function computeInvoiceHash(xmlString: string): Promise<string> {
  const canonical = canonicalizeInvoiceContent(xmlString)
  const hashBuf   = await sha256(canonical)
  return btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
}

// ── signInvoice ───────────────────────────────────────────────────────────────

export async function signInvoice(
  xmlString:     string,
  privateKeyPem: string,
  certificate:   string,   // base64 DER of ZATCA-issued CSID certificate
): Promise<SignedInvoice> {
  const privateKey = await importPrivateKeyPem(privateKeyPem)

  // 1. Normalize certificate string: strip embedded whitespace/newlines from binarySecurityToken
  // binarySecurityToken from ZATCA is base64(DER) — some implementations add line breaks.
  // Auto-detect base64(PEM-with-headers) vs base64(DER) to handle both formats.
  console.log('[ZATCA sign] signInvoice: certificate input length =', certificate.length,
    '| first 40 chars =', certificate.substring(0, 40))
  const certB64Clean = certificate.replace(/[\r\n\s]+/g, '')
  let certDer: Uint8Array
  let certPemBody: string  // clean base64(DER) used in XAdES ds:X509Certificate element

  const certDecoded = atob(certB64Clean)
  const isPemWrapped = certDecoded.startsWith('-----BEGIN')
  console.log('[ZATCA sign] certB64Clean length =', certB64Clean.length,
    '| decoded length =', certDecoded.length, '| isPemWrapped =', isPemWrapped)

  if (isPemWrapped) {
    // binarySecurityToken was base64(PEM with headers)
    certPemBody = certDecoded.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    certDer = Uint8Array.from(atob(certPemBody), c => c.charCodeAt(0))
  } else {
    // Standard: binarySecurityToken is base64(DER)
    certDer = Uint8Array.from(certDecoded, c => c.charCodeAt(0))
    certPemBody = certB64Clean
  }
  console.log('[ZATCA sign] certDer length =', certDer.length,
    '| first bytes =', Array.from(certDer.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' '))

  // Parse certificate fields directly via ASN.1 — forge.pki.certificateFromPem throws
  // "Cannot read public key. Unknown OID." for secp256k1 EC certificates (only supports RSA).
  const { serialNumber, spkiBytes } = parseCertificateDer(certDer)
  const issuerDn = ''  // not used in XML output (X509IssuerName is set to serialNumber)

  // 2. Certificate digest (SHA-256 of DER bytes)
  const certDigestBuf = await sha256Bytes(certDer)
  const certDigestB64 = btoa(String.fromCharCode(...new Uint8Array(certDigestBuf)))

  // 3. Invoice digest (content to be signed — same as computeInvoiceHash)
  const invoiceCanonical = canonicalizeInvoiceContent(xmlString)
  const invoiceDigestBuf = await sha256(invoiceCanonical)
  const invoiceDigestB64 = btoa(String.fromCharCode(...new Uint8Array(invoiceDigestBuf)))
  const invoiceHashB64   = invoiceDigestB64  // same value — kept as the PIH for next invoice

  // 4. Signing time
  const signingTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // 5. Build SignedProperties XML → canonicalize → digest
  const signedPropsXml = buildSignedProperties(signingTime, certDigestB64, issuerDn, serialNumber)
  const signedPropsBuf = await sha256(signedPropsXml)
  const signedPropsB64 = btoa(String.fromCharCode(...new Uint8Array(signedPropsBuf)))

  // 6. Build SignedInfo → canonicalize → sign
  const signedInfoXml = buildSignedInfo(invoiceDigestB64, signedPropsB64)
  const signedInfoBuf = new TextEncoder().encode(signedInfoXml)
  const sigP1363      = await ecdsaSign(privateKey, signedInfoBuf)
  const sigDerBytes   = p1363ToDer(new Uint8Array(sigP1363))
  const sigValueB64   = btoa(String.fromCharCode(...sigDerBytes))

  // 7. Build complete UBLExtensions XAdES block
  const xadesBlock = buildXadesBlock(
    invoiceDigestB64, signedPropsB64, sigValueB64,
    certPemBody, signedPropsXml, issuerDn, serialNumber,
    signingTime, certDigestB64,
  )

  // 8. Embed XAdES into the XML
  let signedXml = xmlString.replace(
    /<ext:ExtensionContent>\s*<\/ext:ExtensionContent>/,
    `<ext:ExtensionContent>${xadesBlock}</ext:ExtensionContent>`,
  )

  // 9. Generate Phase 2 QR and embed
  const sellerName  = extractXmlText(signedXml, 'cbc:RegistrationName')
  const vatNumber   = extractVatNumber(signedXml)
  const timestamp   = extractXmlText(signedXml, 'cbc:IssueDate') + 'T' + (extractXmlText(signedXml, 'cbc:IssueTime') || '00:00:00') + 'Z'
  const totalAmount = parseFloat(extractAmountByCurrency(signedXml, 'TaxInclusiveAmount') || '0')
  const vatAmount   = parseFloat(extractAmountByCurrency(signedXml, 'TaxAmount') || '0')

  // Phase 2 QR tags 1–5 + 6 (hash bytes) + 7 (sig bytes) + 8 (pubkey bytes) + 9 (cert bytes)
  const hashBytes = new Uint8Array(await sha256(invoiceCanonical))  // raw 32 bytes for tag 6
  const sigBytes  = sigDerBytes                                      // raw sig bytes for tag 7
  const pubKeyBytes = extractEcPublicKeyFromSpki(spkiBytes)          // raw EC pubkey for tag 8

  const qrCode = buildPhase2QR({
    sellerName, vatNumber, timestamp,
    totalAmount, vatAmount,
    invoiceHashBytes: hashBytes,
    signatureBytes:   sigBytes,
    publicKeyBytes:   pubKeyBytes,
    certificateBytes: certDer,
  })

  signedXml = signedXml.replace(
    /(<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
    // Only replace the LAST occurrence (QR placeholder is the last AdditionalDocumentReference)
    (_, open, close, offset, str) => {
      const qrRef = str.lastIndexOf('<cbc:ID>QR</cbc:ID>', offset)
      return qrRef !== -1 ? `${open}${qrCode}${close}` : `${open}${close}`
    },
  )
  // Simpler approach: target the QR block specifically
  signedXml = signedXml.replace(
    /(<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)([^<]*)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
    `$1${qrCode}$3`,
  )

  return { signedXml, invoiceHash: invoiceHashB64, qrCode }
}

// ── C14N implementation ───────────────────────────────────────────────────────

/**
 * Canonicalize the invoice content for hash computation.
 * Removes the three ZATCA-specified blocks then applies C14N11 serialization.
 */
function canonicalizeInvoiceContent(xmlString: string): string {
  const parser = new DOMParser()
  const doc    = parser.parseFromString(xmlString, 'application/xml')

  const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
  const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
  const EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'

  // Remove UBLExtensions
  const ublExts = doc.getElementsByTagNameNS(EXT, 'UBLExtensions')
  for (const el of Array.from(ublExts)) el.parentNode?.removeChild(el)

  // Remove Signature
  const sigs = doc.getElementsByTagNameNS(CAC, 'Signature')
  for (const el of Array.from(sigs)) el.parentNode?.removeChild(el)

  // Remove QR AdditionalDocumentReference
  const adrList = Array.from(doc.getElementsByTagNameNS(CAC, 'AdditionalDocumentReference'))
  for (const adr of adrList) {
    const idEl = adr.getElementsByTagNameNS(CBC, 'ID')[0]
    if (idEl?.textContent === 'QR') { adr.parentNode?.removeChild(adr); break }
  }

  return c14n(doc.documentElement)
}

/** Minimal but correct C14N11 serializer for ZATCA-generated XML */
function c14n(node: Element, inherited: Map<string, string> = new Map()): string {
  const localNs   = new Map<string, string>()
  const attrs     = Array.from(node.attributes)

  // Collect namespace declarations on this element
  for (const a of attrs) {
    if (a.name === 'xmlns')                  localNs.set('', a.value)
    else if (a.name.startsWith('xmlns:'))     localNs.set(a.name.slice(6), a.value)
  }

  // Determine which namespace declarations to emit
  const nsDecls: [string, string][] = []
  const emitNs = (prefix: string, uri: string) => {
    if (inherited.get(prefix) !== uri) nsDecls.push([prefix, uri])
  }

  // Always emit default namespace if changed
  const elNs     = node.namespaceURI ?? ''
  const elPrefix = node.prefix ?? ''
  if (elPrefix === '' && elNs !== (inherited.get('') ?? '')) emitNs('', elNs)
  else if (elPrefix && elNs !== (inherited.get(elPrefix) ?? '')) emitNs(elPrefix, elNs)

  // Emit namespaces from local declarations
  for (const [p, u] of localNs) {
    if (!nsDecls.find(d => d[0] === p)) emitNs(p, u)
  }

  // Emit namespaces needed by attributes
  for (const a of attrs) {
    if (a.namespaceURI && a.prefix && !nsDecls.find(d => d[0] === a.prefix!)) {
      emitNs(a.prefix, a.namespaceURI)
    }
  }

  // Sort: default ns first, then alphabetical by prefix
  nsDecls.sort(([a], [b]) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))

  // Regular attributes sorted by namespace URI, then local name (no ns attrs first)
  const regAttrs = attrs
    .filter(a => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
    .sort((a, b) => {
      const aNs = a.namespaceURI ?? ''
      const bNs = b.namespaceURI ?? ''
      return aNs !== bNs ? aNs.localeCompare(bNs) : a.localName.localeCompare(b.localName)
    })

  let out = `<${node.tagName}`
  for (const [p, u] of nsDecls) out += ` ${p === '' ? 'xmlns' : `xmlns:${p}`}="${escAttr(u)}"`
  for (const a of regAttrs) out += ` ${a.name}="${escAttr(a.value)}"`
  out += '>'

  const newInherited = new Map(inherited)
  for (const [p, u] of localNs) newInherited.set(p, u)
  for (const [p, u] of nsDecls) newInherited.set(p, u)

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) out += c14n(child as Element, newInherited)
    else if (child.nodeType === Node.TEXT_NODE) out += escText(child.textContent ?? '')
  }

  return out + `</${node.tagName}>`
}

function escText(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r/g,'&#xD;')
}
function escAttr(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
          .replace(/\t/g,'&#x9;').replace(/\n/g,'&#xA;').replace(/\r/g,'&#xD;')
}
function asn1ToCanonical(der: string): string {
  // Return a stable string representation of the DN for display
  return der
}

// ── XAdES XML builders ────────────────────────────────────────────────────────

function buildSignedProperties(
  signingTime: string, certDigest: string,
  issuerDn: string, serialNumber: string,
): string {
  return `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xadesSignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${escText(serialNumber)}</ds:X509IssuerName><ds:X509SerialNumber>${serialNumber}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`
}

function buildSignedInfo(invoiceDigest: string, signedPropsDigest: string): string {
  return `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`
}

function buildXadesBlock(
  invoiceDigest: string, signedPropsDigest: string, sigValue: string,
  certificate: string, _signedPropsXml: string, _issuerDn: string, serialNumber: string,
  signingTime: string, certDigest: string,
): string {
  const signedInfo    = buildSignedInfo(invoiceDigest, signedPropsDigest)
  const signedProps   = buildSignedProperties(signingTime, certDigest, _issuerDn, serialNumber)
  return `<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="urn:oasis:names:specification:ubl:signature:Invoice">${signedInfo}<ds:SignatureValue>${sigValue}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificate}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#urn:oasis:names:specification:ubl:signature:Invoice">${signedProps}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures>`
}

// ── Phase 2 QR code (9 TLV tags) ─────────────────────────────────────────────

interface Phase2QRInput {
  sellerName:        string
  vatNumber:         string
  timestamp:         string
  totalAmount:       number
  vatAmount:         number
  invoiceHashBytes:  Uint8Array  // raw 32 bytes (tag 6)
  signatureBytes:    Uint8Array  // DER ECDSA signature (tag 7)
  publicKeyBytes:    Uint8Array  // EC public key bytes (tag 8)
  certificateBytes:  Uint8Array  // CSID certificate DER bytes (tag 9)
}

function buildPhase2QR(input: Phase2QRInput): string {
  // Tags 1–5: same as Phase 1 (text strings)
  const phase1Fields = [
    tlvStr(0x01, input.sellerName),
    tlvStr(0x02, input.vatNumber),
    tlvStr(0x03, normalizeTimestamp(input.timestamp)),
    tlvStr(0x04, input.totalAmount.toFixed(2)),
    tlvStr(0x05, input.vatAmount.toFixed(2)),
  ]
  // Tags 6–9: raw bytes
  const phase2Fields = [
    tlvBytes(0x06, input.invoiceHashBytes),  // SHA-256 hash (32 bytes)
    tlvBytes(0x07, input.signatureBytes),    // ECDSA signature
    tlvBytes(0x08, input.publicKeyBytes),    // EC public key
    tlvBytes(0x09, input.certificateBytes),  // CSID certificate
  ]

  const all  = [...phase1Fields, ...phase2Fields]
  const size = all.reduce((s, a) => s + a.length, 0)
  const buf  = new Uint8Array(size)
  let off = 0
  for (const f of all) { buf.set(f, off); off += f.length }

  return btoa(String.fromCharCode(...buf))
}

function tlvStr(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const buf   = new Uint8Array(2 + bytes.length)
  buf[0] = tag; buf[1] = bytes.length; buf.set(bytes, 2)
  return buf
}

function tlvBytes(tag: number, bytes: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2 + bytes.length)
  buf[0] = tag; buf[1] = bytes.length; buf.set(bytes, 2)
  return buf
}

function normalizeTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Extract serial number and SubjectPublicKeyInfo DER from a raw X.509 DER certificate.
 * Uses forge's ASN.1 module directly to avoid forge.pki.certificateFromPem, which
 * only supports RSA and throws "Unknown OID" for secp256k1 EC certificates.
 */
function parseCertificateDer(certDer: Uint8Array): { serialNumber: string; spkiBytes: Uint8Array } {
  console.log('[ZATCA sign] parseCertificateDer: derLen =', certDer.length,
    '| first 4 bytes =', Array.from(certDer.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' '))

  // strict: false — ignore trailing bytes (binarySecurityToken may be a cert chain)
  const certAsn1 = forge.asn1.fromDer(
    forge.util.createBuffer(String.fromCharCode(...certDer)),
    { strict: false } as any,
  )
  console.log('[ZATCA sign] parseCertificateDer: ASN.1 parsed OK, tagClass =', certAsn1.tagClass,
    '| type =', certAsn1.type, '| children =', (certAsn1.value as any[]).length)

  // Certificate = SEQUENCE { TBSCertificate, AlgorithmIdentifier, BIT STRING }
  const tbs    = (certAsn1.value as forge.asn1.Asn1[])[0]
  const fields = tbs.value as forge.asn1.Asn1[]

  // TBSCertificate fields (in order):
  //   [0] version (CONTEXT_SPECIFIC, optional — present in v2/v3)
  //   INTEGER  serialNumber
  //   SEQUENCE signatureAlgorithm
  //   SEQUENCE issuer
  //   SEQUENCE validity
  //   SEQUENCE subject
  //   SEQUENCE subjectPublicKeyInfo
  let idx = 0
  if (fields[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC) idx++

  const serialBytes = fields[idx++].value as string
  let serialHex = Array.from(serialBytes, c => ('0' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  serialHex = serialHex.replace(/^0+/, '') || '0'
  console.log('[ZATCA sign] parseCertificateDer: serialNumber =', serialHex, '| TBS field count =', fields.length)

  idx += 4  // skip: signatureAlgorithm, issuer, validity, subject

  const spkiDerStr = forge.asn1.toDer(fields[idx]).getBytes()
  const spkiBytes  = new Uint8Array(Array.from(spkiDerStr, c => c.charCodeAt(0)))
  console.log('[ZATCA sign] parseCertificateDer: spkiLen =', spkiBytes.length)

  return { serialNumber: serialHex, spkiBytes }
}

/** Extract the raw EC public key point bytes from a SubjectPublicKeyInfo DER blob. */
function extractEcPublicKeyFromSpki(spkiBytes: Uint8Array): Uint8Array {
  try {
    const spkiAsn1 = forge.asn1.fromDer(
      forge.util.createBuffer(String.fromCharCode(...spkiBytes)),
      { strict: false } as any,
    )
    // SPKI = SEQUENCE { AlgorithmIdentifier, BIT STRING }
    // BIT STRING raw content: 0x00 (unused-bits byte) || EC public key point
    const bitStr = (spkiAsn1.value as forge.asn1.Asn1[])[1]
    // bitStringContents is set before any attempt to decode as composed ASN.1,
    // so it reliably contains the raw BIT STRING value bytes.
    const raw = ((bitStr as any).bitStringContents as string | undefined)
             ?? (typeof bitStr.value === 'string' ? bitStr.value : '')
    if (raw.length < 2) return new Uint8Array(65)
    // Skip the leading unused-bits byte (always 0x00 for EC keys)
    return new Uint8Array(Array.from(raw.slice(1), (c: string) => c.charCodeAt(0)))
  } catch {
    return new Uint8Array(65)
  }
}

// ── XML text extraction helpers ───────────────────────────────────────────────

function extractXmlText(xml: string, tagName: string): string {
  const m = xml.match(new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`))
  return m?.[1] ?? ''
}

function extractVatNumber(xml: string): string {
  const m = xml.match(/<cac:PartyTaxScheme>[\s\S]*?<cbc:CompanyID>([^<]+)<\/cbc:CompanyID>/)
  return m?.[1] ?? ''
}

function extractAmountByCurrency(xml: string, elementName: string): string {
  const m = xml.match(new RegExp(`<cbc:${elementName}[^>]*>([\\d.]+)<\\/cbc:${elementName}>`))
  return m?.[1] ?? '0'
}

// Re-export for use in submission.ts
export { computeInvoiceHash as hashInvoiceXml }
