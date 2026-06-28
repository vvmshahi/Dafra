/**
 * ZATCA Phase 2 — Sandbox PKCS#10 CSR Generation
 * Pure TypeScript inline ASN.1 encoder — no external ASN.1 library required.
 *
 * Production CSR generation lives in Supabase Edge Functions. This browser
 * helper is retained only for the legacy sandbox certificate flow.
 *
 * Subject: C, O, OU, CN
 * SAN: ONE directoryName [4] with five RDNs (surName, userId, title, registeredAddress, businessCategory)
 * Extensions: basicConstraints (CA:FALSE), SAN, ZATCA-Code-Signing (OID 1.3.6.1.4.1.311.20.2)
 * Signature: ecdsaWithSHA256 / secp256k1
 */

import type { ZatcaKeyPair } from './crypto'
import { p1363ToDer, ecdsaSign } from './crypto'

// ── OID registry ──────────────────────────────────────────────────────────────
const OIDs = {
  commonName:         '2.5.4.3',
  surName:            '2.5.4.4',
  countryName:        '2.5.4.6',
  organizationName:   '2.5.4.10',
  organizationalUnit: '2.5.4.11',
  title:              '2.5.4.12',
  businessCategory:   '2.5.4.15',
  registeredAddress:  '2.5.4.26',
  userId:             '0.9.2342.19200300.100.1.1',
  zatcaCodeSigning:   '1.3.6.1.4.1.311.20.2',
  extensionRequest:   '1.2.840.113549.1.9.14',
  subjectAltName:     '2.5.29.17',
  basicConstraints:   '2.5.29.19',
} as const

// ── Params ────────────────────────────────────────────────────────────────────

export interface ZatcaCSRParams {
  commonName:   string  // EGS unit name
  branchId:     string  // used to build EGS serial "1-Meem|2-POS|3-{branchId}"
  vatNumber:    string  // 15-digit VAT number (SAN userId)
  branchName:   string  // OU
  businessName: string  // O (legal name)
  invoiceType:  string  // "1100" = standard + simplified (SAN title)
  location:     string  // branch address (SAN registeredAddress)
  industry:     string  // business sector (SAN businessCategory)
}

// ── CSR builder ───────────────────────────────────────────────────────────────

export async function generateCSR(
  params: ZatcaCSRParams,
  keyPair: ZatcaKeyPair,
): Promise<string> {
  console.log('[ZATCA CSR] version: 5.0 — pure TypeScript ASN.1')
  const egsSn = `1-Meem|2-POS|3-${params.branchId}`

  // Subject: C, O, OU, CN
  const subject = seq([
    rdn(OIDs.countryName,        'SA', TAG.PRINTABLESTRING),
    rdn(OIDs.organizationName,   params.businessName),
    rdn(OIDs.organizationalUnit, params.branchName),
    rdn(OIDs.commonName,         params.commonName),
  ])

  // SPKI passthrough — raw DER from key generation
  const spki = asn1FromDer(new Uint8Array(keyPair.publicKeyDer))

  // SubjectAlternativeName: ONE directoryName [4] with five RDNs
  const sanDirName = asn1Node(CLS.CONTEXT_SPECIFIC, 4, true, [
    seq([
      rdn(OIDs.surName,           egsSn),
      rdn(OIDs.userId,            params.vatNumber),
      rdn(OIDs.title,             params.invoiceType),
      rdn(OIDs.registeredAddress, params.location),
      rdn(OIDs.businessCategory,  params.industry),
    ]),
  ])
  const sanValue = asn1ToDer(seq([sanDirName]))
  const sanExt = seq([
    oid(OIDs.subjectAltName),
    asn1Node(CLS.UNIVERSAL, TAG.OCTETSTRING, false, sanValue),
  ])

  // basicConstraints: CA:FALSE — DER of empty SEQUENCE
  const bcValue = asn1ToDer(seq([]))
  const basicConstraintsExt = seq([
    oid(OIDs.basicConstraints),
    asn1Node(CLS.UNIVERSAL, TAG.OCTETSTRING, false, bcValue),
  ])

  // ZATCA-Code-Signing extension
  const zatcaValue = asn1ToDer(asn1Node(CLS.UNIVERSAL, TAG.UTF8, false, 'ZATCA-Code-Signing'))
  const zatcaExt = seq([
    oid(OIDs.zatcaCodeSigning),
    asn1Node(CLS.UNIVERSAL, TAG.OCTETSTRING, false, zatcaValue),
  ])

  // extensionRequest attribute (order: basicConstraints → SAN → ZATCA-Code-Signing)
  const extensions = seq([
    oid(OIDs.extensionRequest),
    asn1Node(CLS.UNIVERSAL, TAG.SET, true, [
      seq([basicConstraintsExt, sanExt, zatcaExt]),
    ]),
  ])
  const attributes = asn1Node(CLS.CONTEXT_SPECIFIC, 0, true, [extensions])

  // CertificationRequestInfo
  const cri = seq([
    asn1Node(CLS.UNIVERSAL, TAG.INTEGER, false, new Uint8Array([0])), // version 0
    subject,
    spki,
    attributes,
  ])

  // Sign CRI DER with secp256k1 / SHA-256
  const criDer   = asn1ToDer(cri)
  const sigP1363 = await ecdsaSign(keyPair.privateKey, criDer)
  const sigDer   = p1363ToDer(new Uint8Array(sigP1363))

  // sigAlgorithm: SEQUENCE { OID ecdsaWithSHA256 }
  const sigAlgDer = new Uint8Array([
    0x30, 0x0a,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02,
  ])

  // BIT STRING wrapper for DER signature
  const bsContentLen = sigDer.length + 1  // +1 for unused-bits byte 0x00
  const bitStringDer = bsContentLen < 128
    ? new Uint8Array([0x03, bsContentLen,       0x00, ...sigDer])
    : new Uint8Array([0x03, 0x81, bsContentLen, 0x00, ...sigDer])

  // Outer SEQUENCE { CRI || sigAlg || BIT STRING }
  const content = new Uint8Array([...criDer, ...sigAlgDer, ...bitStringDer])
  const seqLen  = content.length
  const seqHdr: number[] = seqLen < 128 ? [0x30, seqLen]
                          : seqLen < 256 ? [0x30, 0x81, seqLen]
                          :                [0x30, 0x82, (seqLen >> 8) & 0xff, seqLen & 0xff]
  const certReqDer = new Uint8Array([...seqHdr, ...content])

  // PEM encode
  const b64   = btoa(Array.from(certReqDer, c => String.fromCharCode(c)).join(''))
  const lines = b64.match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN CERTIFICATE REQUEST-----\n${lines}\n-----END CERTIFICATE REQUEST-----`
}

// ── Minimal inline ASN.1 encoder ─────────────────────────────────────────────

const CLS = { UNIVERSAL: 0, CONTEXT_SPECIFIC: 2 } as const
const TAG = {
  INTEGER: 2, BITSTRING: 3, OCTETSTRING: 4, OID: 6,
  UTF8: 12, SEQUENCE: 16, SET: 17, PRINTABLESTRING: 19,
} as const

interface Asn1 {
  cls: number
  tag: number
  constructed: boolean
  value: string | Uint8Array | Asn1[]
  rawDer?: Uint8Array
}

function asn1Node(cls: number, tag: number, constructed: boolean, value: string | Uint8Array | Asn1[]): Asn1 {
  return { cls, tag, constructed, value }
}

function asn1FromDer(der: Uint8Array): Asn1 {
  return { cls: 0, tag: 0, constructed: false, value: der, rawDer: der }
}

function asn1ToDer(node: Asn1): Uint8Array {
  if (node.rawDer) return node.rawDer
  const tagByte = ((node.cls & 0x3) << 6) | (node.constructed ? 0x20 : 0) | (node.tag & 0x1f)
  let content: Uint8Array
  if (node.constructed) {
    const parts = (node.value as Asn1[]).map(asn1ToDer)
    const total = parts.reduce((s, p) => s + p.length, 0)
    content = new Uint8Array(total)
    let off = 0
    for (const p of parts) { content.set(p, off); off += p.length }
  } else if (node.value instanceof Uint8Array) {
    content = node.value
  } else {
    content = new TextEncoder().encode(node.value as string)
  }
  const lenArr = derLen(content.length)
  const out = new Uint8Array(1 + lenArr.length + content.length)
  out[0] = tagByte
  out.set(lenArr, 1)
  out.set(content, 1 + lenArr.length)
  return out
}

function derLen(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len])
  if (len < 0x100) return new Uint8Array([0x81, len])
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff])
}

function oidEncode(oidStr: string): Uint8Array {
  const parts = oidStr.split('.').map(Number)
  const bytes: number[] = [40 * parts[0] + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    let n = parts[i]
    const tmp: number[] = [n & 0x7f]
    n >>= 7
    while (n > 0) { tmp.unshift((n & 0x7f) | 0x80); n >>= 7 }
    bytes.push(...tmp)
  }
  return new Uint8Array(bytes)
}

function seq(children: Asn1[]): Asn1 {
  return asn1Node(CLS.UNIVERSAL, TAG.SEQUENCE, true, children)
}

function oid(oidStr: string): Asn1 {
  return asn1Node(CLS.UNIVERSAL, TAG.OID, false, oidEncode(oidStr))
}

function rdn(oidStr: string, value: string, tag = TAG.UTF8): Asn1 {
  return asn1Node(CLS.UNIVERSAL, TAG.SET, true, [
    seq([oid(oidStr), asn1Node(CLS.UNIVERSAL, tag, false, value)]),
  ])
}
