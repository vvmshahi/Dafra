import { secp256k1 } from 'https://esm.sh/@noble/curves@2.2.0/secp256k1.js'
import type { FunctionalityMap } from './config.ts'

const OIDs = {
  commonName: '2.5.4.3',
  surName: '2.5.4.4',
  countryName: '2.5.4.6',
  organizationName: '2.5.4.10',
  organizationalUnit: '2.5.4.11',
  title: '2.5.4.12',
  businessCategory: '2.5.4.15',
  registeredAddress: '2.5.4.26',
  userId: '0.9.2342.19200300.100.1.1',
  zatcaCodeSigning: '1.3.6.1.4.1.311.20.2',
  extensionRequest: '1.2.840.113549.1.9.14',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
} as const

const CLS = { UNIVERSAL: 0, CONTEXT_SPECIFIC: 2 } as const
const TAG = {
  INTEGER: 2,
  OCTETSTRING: 4,
  OID: 6,
  UTF8: 12,
  SEQUENCE: 16,
  SET: 17,
  PRINTABLESTRING: 19,
} as const

interface Asn1 {
  cls: number
  tag: number
  constructed: boolean
  value: string | Uint8Array | Asn1[]
  rawDer?: Uint8Array
}

export interface CsrParams {
  branchId: string
  commonName: string
  branchName: string
  businessName: string
  vatNumber: string
  functionalityMap: FunctionalityMap
  location: string
  industry: string
}

export interface GeneratedCsr {
  csrPem: string
  privateKeyPem: string
  publicKeyPem: string
  egsSerialNumber: string
}

export async function generateProductionCsr(params: CsrParams): Promise<GeneratedCsr> {
  const secretKey = secp256k1.utils.randomSecretKey()
  const publicKey = secp256k1.getPublicKey(secretKey, false)
  const publicKeyDer = buildSecp256k1Spki(publicKey)
  const egsSerialNumber = `1-Meem|2-POS|3-${params.branchId}`

  const subject = seq([
    rdn(OIDs.countryName, 'SA', TAG.PRINTABLESTRING),
    rdn(OIDs.organizationName, params.businessName),
    rdn(OIDs.organizationalUnit, params.branchName),
    rdn(OIDs.commonName, params.commonName),
  ])

  const spki = asn1FromDer(publicKeyDer)
  const sanDirName = asn1Node(CLS.CONTEXT_SPECIFIC, 4, true, [
    seq([
      rdn(OIDs.surName, egsSerialNumber),
      rdn(OIDs.userId, params.vatNumber),
      rdn(OIDs.title, params.functionalityMap),
      rdn(OIDs.registeredAddress, params.location),
      rdn(OIDs.businessCategory, params.industry),
    ]),
  ])
  const sanExt = seq([
    oid(OIDs.subjectAltName),
    asn1Node(CLS.UNIVERSAL, TAG.OCTETSTRING, false, asn1ToDer(seq([sanDirName]))),
  ])
  const basicConstraintsExt = seq([
    oid(OIDs.basicConstraints),
    asn1Node(CLS.UNIVERSAL, TAG.OCTETSTRING, false, asn1ToDer(seq([]))),
  ])
  const zatcaExt = seq([
    oid(OIDs.zatcaCodeSigning),
    asn1Node(
      CLS.UNIVERSAL,
      TAG.OCTETSTRING,
      false,
      asn1ToDer(asn1Node(CLS.UNIVERSAL, TAG.UTF8, false, 'ZATCA-Code-Signing')),
    ),
  ])
  const extensions = seq([
    oid(OIDs.extensionRequest),
    asn1Node(CLS.UNIVERSAL, TAG.SET, true, [seq([basicConstraintsExt, sanExt, zatcaExt])]),
  ])
  const attributes = asn1Node(CLS.CONTEXT_SPECIFIC, 0, true, [extensions])
  const cri = seq([
    asn1Node(CLS.UNIVERSAL, TAG.INTEGER, false, new Uint8Array([0])),
    subject,
    spki,
    attributes,
  ])

  const criDer = asn1ToDer(cri)
  const sigP1363 = secp256k1.sign(criDer, secretKey) as unknown as Uint8Array
  const sigDer = p1363ToDer(sigP1363)
  const sigAlgDer = new Uint8Array([
    0x30, 0x0a,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02,
  ])
  const bitStringDer = new Uint8Array([0x03, sigDer.length + 1, 0x00, ...sigDer])
  const content = new Uint8Array([...criDer, ...sigAlgDer, ...bitStringDer])
  const certReqDer = wrapSequence(content)

  return {
    csrPem: derToPem(certReqDer, 'CERTIFICATE REQUEST'),
    privateKeyPem: derToPem(secretKey, 'EC PRIVATE KEY'),
    publicKeyPem: derToPem(publicKeyDer, 'PUBLIC KEY'),
    egsSerialNumber,
  }
}

export function validateCsrInputs(params: CsrParams): string[] {
  const missing: string[] = []
  if (!params.businessName.trim()) missing.push('business name')
  if (!/^3\d{13}3$/.test(params.vatNumber)) missing.push('valid 15-digit VAT number')
  if (!params.branchName.trim()) missing.push('branch name')
  if (!params.location.trim()) missing.push('branch address')
  if (!params.commonName.trim()) missing.push('device name')
  return missing
}

function buildSecp256k1Spki(pubKeyBytes: Uint8Array): Uint8Array {
  const oidEcPub = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidSecp256k1 = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algIdInner = new Uint8Array([
    0x06, oidEcPub.length, ...oidEcPub,
    0x06, oidSecp256k1.length, ...oidSecp256k1,
  ])
  const algId = new Uint8Array([0x30, algIdInner.length, ...algIdInner])
  const bsInner = new Uint8Array([0x00, ...pubKeyBytes])
  const bitStr = new Uint8Array([0x03, bsInner.length, ...bsInner])
  return wrapSequence(new Uint8Array([...algId, ...bitStr]))
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
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    content = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      content.set(part, offset)
      offset += part.length
    }
  } else if (node.value instanceof Uint8Array) {
    content = node.value
  } else {
    content = new TextEncoder().encode(node.value)
  }
  const len = derLen(content.length)
  const out = new Uint8Array(1 + len.length + content.length)
  out[0] = tagByte
  out.set(len, 1)
  out.set(content, 1 + len.length)
  return out
}

function derLen(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len])
  if (len < 0x100) return new Uint8Array([0x81, len])
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff])
}

function wrapSequence(content: Uint8Array): Uint8Array {
  const len = derLen(content.length)
  const out = new Uint8Array(1 + len.length + content.length)
  out[0] = 0x30
  out.set(len, 1)
  out.set(content, 1 + len.length)
  return out
}

function oidEncode(oidStr: string): Uint8Array {
  const parts = oidStr.split('.').map(Number)
  const bytes: number[] = [40 * parts[0] + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    let n = parts[i]
    const tmp: number[] = [n & 0x7f]
    n >>= 7
    while (n > 0) {
      tmp.unshift((n & 0x7f) | 0x80)
      n >>= 7
    }
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

function p1363ToDer(sigBytes: Uint8Array): Uint8Array {
  const r = sigBytes.slice(0, 32)
  const s = sigBytes.slice(32, 64)
  const rDer = encodeDerInt(r)
  const sDer = encodeDerInt(s)
  return new Uint8Array([0x30, rDer.length + sDer.length, ...rDer, ...sDer])
}

function encodeDerInt(n: Uint8Array): Uint8Array {
  let start = 0
  while (start < n.length - 1 && n[start] === 0) start++
  const trimmed = n.slice(start)
  const needsPad = (trimmed[0] & 0x80) !== 0
  const value = needsPad ? new Uint8Array([0, ...trimmed]) : trimmed
  return new Uint8Array([0x02, value.length, ...value])
}

function derToPem(der: Uint8Array, label: string): string {
  const b64 = bytesToBase64(der)
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
