/**
 * ZATCA Phase 2 — PKCS#10 CSR Generation
 *
 * Builds a PKCS#10 CertificationRequest using node-forge's ASN.1 module,
 * incorporating the ZATCA-mandated Subject fields and SubjectAlternativeNames.
 *
 * ZATCA CSR fields (Security Features Impl. Standards v1.2, Section 2.2.1):
 *   Subject:  CN, OID 2.5.4.97 (orgId), OU, O, C, OID 2.5.4.15 (invoiceType)
 *   SANs:     EGS serial (as serialNumber), Location (2.5.4.26), Industry (2.5.4.15)
 *
 * Key pair is generated via Web Crypto API (ECDSA P-256).
 * The CSR TBS is signed with Web Crypto and converted from IEEE P1363 to DER.
 */

import forge from 'node-forge'
import type { ZatcaKeyPair } from './crypto'
import { p1363ToDer, ecdsaSign } from './crypto'

const { asn1 } = forge

// ── OID registry ──────────────────────────────────────────────────────────────
const OIDs = {
  ecPublicKey:             '1.2.840.10045.2.1',
  prime256v1:              '1.2.840.10045.3.1.7',
  ecdsaWithSHA256:         '1.2.840.10045.4.3.2',
  commonName:              '2.5.4.3',
  serialNumber:            '2.5.4.5',
  countryName:             '2.5.4.6',
  organizationName:        '2.5.4.10',
  organizationalUnit:      '2.5.4.11',
  organizationIdentifier:  '2.5.4.97',  // ZATCA: VAT number (non-standard OID)
  businessCategory:        '2.5.4.15',  // ZATCA: invoice type in Subject + industry in SAN
  registeredAddress:       '2.5.4.26',  // ZATCA: branch location in SAN
  extensionRequest:        '1.2.840.113549.1.9.14',
  subjectAltName:          '2.5.29.17',
} as const

// ── Params ────────────────────────────────────────────────────────────────────

export interface ZatcaCSRParams {
  commonName:     string  // EGS unit name
  branchId:       string  // used to build serial "1-Dafra|2-POS|3-{branchId}"
  vatNumber:      string  // 15-digit SAT VAT number (OID 2.5.4.97)
  branchName:     string  // OU
  businessName:   string  // O (legal name)
  invoiceType:    string  // "1100" = standard + simplified
  location:       string  // branch address (SAN)
  industry:       string  // business sector (SAN)
}

// ── CSR builder ───────────────────────────────────────────────────────────────

/**
 * Generate a PKCS#10 CSR PEM string for ZATCA CSID registration.
 * The caller must provide the key pair from crypto.generateKeyPair().
 */
export async function generateCSR(
  params: ZatcaCSRParams,
  keyPair: ZatcaKeyPair,
): Promise<string> {
  const egsSn = `1-Dafra|2-POS|3-${params.branchId}`

  // ── Subject ───────────────────────────────────────────────────────────────
  const subject = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    rdn(OIDs.commonName,            params.commonName),
    rdn(OIDs.organizationIdentifier,params.vatNumber),
    rdn(OIDs.organizationalUnit,    params.branchName),
    rdn(OIDs.organizationName,      params.businessName),
    rdn(OIDs.countryName,           'SA', asn1.Type.PRINTABLESTRING),
    rdn(OIDs.businessCategory,      params.invoiceType),
  ])

  // ── SubjectPublicKeyInfo (parse SPKI from Web Crypto export) ─────────────
  const spkiBytes = forge.util.createBuffer(
    String.fromCharCode(...new Uint8Array(keyPair.publicKeyDer))
  )
  const spki = asn1.fromDer(spkiBytes)

  // ── Extensions (SubjectAlternativeNames) ──────────────────────────────────
  const sanExt = buildSanExtension([
    { oid: OIDs.serialNumber,      value: egsSn },
    { oid: OIDs.registeredAddress, value: params.location },
    { oid: OIDs.businessCategory,  value: params.industry },
  ])

  const extensions = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
      asn1.oidToDer(OIDs.extensionRequest).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [sanExt]),
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

  // ── Sign TBS with Web Crypto ECDSA ────────────────────────────────────────
  const criDerStr = asn1.toDer(cri).getBytes()
  const criBytes  = new Uint8Array(Array.from(criDerStr, c => c.charCodeAt(0)))
  const sigP1363  = await ecdsaSign(keyPair.privateKey, criBytes)
  const sigDer    = p1363ToDer(new Uint8Array(sigP1363))

  // ── CertificationRequest ──────────────────────────────────────────────────
  const certReq = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    cri,
    // Signature algorithm: ecdsa-with-SHA256
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
        asn1.oidToDer(OIDs.ecdsaWithSHA256).getBytes()),
    ]),
    // Signature value as BIT STRING (unused bits = 0)
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BITSTRING, false,
      '\x00' + String.fromCharCode(...sigDer)),
  ])

  // ── PEM encode ────────────────────────────────────────────────────────────
  const derStr = asn1.toDer(certReq).getBytes()
  const b64    = forge.util.encode64(derStr)
  const lines  = b64.match(/.{1,64}/g)!.join('\n')
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

/**
 * Build SubjectAlternativeName extension (OID 2.5.29.17).
 * Each SAN entry is encoded as a directoryName [4] containing
 * a single-attribute Name with the given custom OID.
 */
function buildSanExtension(
  entries: { oid: string; value: string }[],
): forge.asn1.Asn1 {
  const generalNames = entries.map(({ oid, value }) =>
    // [4] EXPLICIT SEQUENCE { SET { SEQUENCE { OID, UTF8String } } }
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 4, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, [
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
              asn1.oidToDer(oid).getBytes()),
            asn1.create(asn1.Class.UNIVERSAL, asn1.Type.UTF8, false, value),
          ]),
        ]),
      ]),
    ])
  )

  const sanValue = asn1.toDer(
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, generalNames)
  ).getBytes()

  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
      asn1.oidToDer(OIDs.subjectAltName).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, sanValue),
  ])
}
