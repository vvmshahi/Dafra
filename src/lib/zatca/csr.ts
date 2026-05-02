/**
 * ZATCA Phase 2 — PKCS#10 CSR Generation
 *
 * Builds a PKCS#10 CertificationRequest using node-forge's ASN.1 module.
 *
 * Key corrections vs prior version:
 *  - Curve: secp256k1 (OID 1.3.132.0.10) — NOT P-256
 *  - Subject: C, OU, O, CN only — no OID 2.5.4.97 or businessCategory in Subject
 *  - SAN: ONE directoryName [4] containing a single Name with five RDNs
 *    (surName=EGS serial, userId=VAT, title=invoiceType, registeredAddress, businessCategory)
 *  - Extension: ZATCA-Code-Signing (OID 1.3.6.1.4.1.311.20.2) required
 */

import forge from 'node-forge'
import type { ZatcaKeyPair } from './crypto'
import { p1363ToDer, ecdsaSign } from './crypto'

const { asn1 } = forge

// ── OID registry ──────────────────────────────────────────────────────────────
const OIDs = {
  ecPublicKey:       '1.2.840.10045.2.1',
  secp256k1:         '1.3.132.0.10',                    // Bitcoin curve — required by ZATCA
  ecdsaWithSHA256:   '1.2.840.10045.4.3.2',
  commonName:        '2.5.4.3',
  surName:           '2.5.4.4',                         // SAN: EGS serial number
  countryName:       '2.5.4.6',
  organizationName:  '2.5.4.10',
  organizationalUnit:'2.5.4.11',
  title:             '2.5.4.12',                        // SAN: invoice type (e.g. "1100")
  businessCategory:  '2.5.4.15',                        // SAN: industry sector
  registeredAddress: '2.5.4.26',                        // SAN: branch address
  userId:            '0.9.2342.19200300.100.1.1',       // SAN: VAT number
  zatcaCodeSigning:  '1.3.6.1.4.1.311.20.2',
  extensionRequest:  '1.2.840.113549.1.9.14',
  subjectAltName:    '2.5.29.17',
} as const

// ── Params ────────────────────────────────────────────────────────────────────

export interface ZatcaCSRParams {
  commonName:   string  // EGS unit name
  branchId:     string  // used to build EGS serial "1-Dafra|2-POS|3-{branchId}"
  vatNumber:    string  // 15-digit SAT VAT number (goes in SAN userId)
  branchName:   string  // OU
  businessName: string  // O (legal name)
  invoiceType:  string  // "1100" = standard + simplified (goes in SAN title)
  location:     string  // branch address (goes in SAN registeredAddress)
  industry:     string  // business sector (goes in SAN businessCategory)
}

// ── CSR builder ───────────────────────────────────────────────────────────────

export async function generateCSR(
  params: ZatcaCSRParams,
  keyPair: ZatcaKeyPair,
): Promise<string> {
  console.log('[ZATCA CSR] version: 3.0 — secp256k1 + manual BIT STRING assembly')
  const egsSn = `1-Dafra|2-POS|3-${params.branchId}`

  // ── Subject: C(PrintableString), OU, O, CN only ───────────────────────────
  const subject = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    rdn(OIDs.countryName,        'SA', asn1.Type.PRINTABLESTRING),
    rdn(OIDs.organizationalUnit, params.branchName),
    rdn(OIDs.organizationName,   params.businessName),
    rdn(OIDs.commonName,         params.commonName),
  ])

  // ── SubjectPublicKeyInfo (secp256k1 SPKI built in generateKeyPair) ────────
  const spkiBytes = forge.util.createBuffer(
    String.fromCharCode(...new Uint8Array(keyPair.publicKeyDer))
  )
  const spki = asn1.fromDer(spkiBytes)

  // ── SubjectAlternativeName: ONE directoryName with 5 RDNs ─────────────────
  const sanDirName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 4, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      rdn(OIDs.surName,          egsSn),
      rdn(OIDs.userId,           params.vatNumber),
      rdn(OIDs.title,            params.invoiceType),
      rdn(OIDs.registeredAddress, params.location),
      rdn(OIDs.businessCategory, params.industry),
    ]),
  ])

  const sanValue = asn1.toDer(
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [sanDirName])
  ).getBytes()

  const sanExt = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
      asn1.oidToDer(OIDs.subjectAltName).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, sanValue),
  ])

  // ── ZATCA-Code-Signing extension ──────────────────────────────────────────
  const zatcaExtValue = asn1.toDer(
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTF8, false, 'ZATCA-Code-Signing')
  ).getBytes()

  const zatcaExt = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
      asn1.oidToDer(OIDs.zatcaCodeSigning).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, zatcaExtValue),
  ])

  // ── extensionRequest attribute ────────────────────────────────────────────
  const extensions = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
      asn1.oidToDer(OIDs.extensionRequest).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [zatcaExt, sanExt]),
    ]),
  ])

  const attributes = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [extensions])

  // ── CertificationRequestInfo ───────────────────────────────────────────────
  const cri = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '\x00'), // version 0
    subject,
    spki,
    attributes,
  ])

  // ── Sign TBS with secp256k1 / SHA-256 ────────────────────────────────────
  const criDerStr = asn1.toDer(cri).getBytes()
  const criBytes  = new Uint8Array(Array.from(criDerStr, c => c.charCodeAt(0)))
  const sigP1363  = await ecdsaSign(keyPair.privateKey, criBytes)
  const sigDer    = p1363ToDer(new Uint8Array(sigP1363))

  // ── Assemble CertificationRequest manually ────────────────────────────────
  // forge has a bug encoding BIT STRING tag (emits 0x87 instead of 0x03),
  // so we build the outer SEQUENCE from raw bytes instead of using asn1.create.

  // signatureAlgorithm SEQUENCE { OID ecdsaWithSHA256 }
  const sigAlgDer = new Uint8Array([
    0x30, 0x0a,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02,
  ])

  // BIT STRING: tag 0x03 + length(1 unused-bits byte + sigDer) + 0x00 + sigDer
  const bsContentLen = sigDer.length + 1  // +1 for the unused-bits byte 0x00
  const bitStringDer = bsContentLen < 128
    ? new Uint8Array([0x03, bsContentLen,         0x00, ...sigDer])
    : new Uint8Array([0x03, 0x81, bsContentLen,   0x00, ...sigDer])

  // outer SEQUENCE { CRI || sigAlg || bitString }
  const content = new Uint8Array([...criBytes, ...sigAlgDer, ...bitStringDer])
  const seqLen  = content.length
  const seqHdr: number[] = seqLen < 128 ? [0x30, seqLen]
                         : seqLen < 256 ? [0x30, 0x81, seqLen]
                         :                [0x30, 0x82, (seqLen >> 8) & 0xff, seqLen & 0xff]
  const certReqDer = new Uint8Array([...seqHdr, ...content])

  // ── PEM encode ────────────────────────────────────────────────────────────
  const b64   = forge.util.encode64(String.fromCharCode(...certReqDer))
  const lines = b64.match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN CERTIFICATE REQUEST-----\n${lines}\n-----END CERTIFICATE REQUEST-----`
}

// ── ASN.1 helpers ─────────────────────────────────────────────────────────────

function rdn(oid: string, value: string, tag = asn1.Type.UTF8): forge.asn1.Asn1 {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
        asn1.oidToDer(oid).getBytes()),
      asn1.create(asn1.Class.UNIVERSAL, tag, false, value),
    ]),
  ])
}
