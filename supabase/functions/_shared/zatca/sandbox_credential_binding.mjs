import { secp256k1 } from 'https://esm.sh/@noble/curves@2.2.0/secp256k1.js'
import { classifySandboxOperationalCertificatePolicy } from './sandbox_mock_operational_policy.mjs'

function base64ToBytes(value) {
  if (typeof atob === 'function') return Uint8Array.from(atob(value), char => char.charCodeAt(0))
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'base64'))
  throw new Error('No base64 decoder is available')
}

function derLength(bytes, offset) {
  const first = bytes[offset++]
  if (first < 0x80) return [first, offset]
  const count = first & 0x7f
  if (count === 0 || count > 4 || offset + count > bytes.length) throw new Error('Invalid DER length')
  let length = 0
  for (let index = 0; index < count; index++) length = (length * 256) + bytes[offset++]
  return [length, offset]
}

function derElement(bytes, start) {
  if (!(bytes instanceof Uint8Array) || start >= bytes.length) throw new Error('DER element is missing')
  const tag = bytes[start]
  const [length, contentStart] = derLength(bytes, start + 1)
  const end = contentStart + length
  if (end > bytes.length) throw new Error('DER element is truncated')
  return { tag, start, contentStart, end, next: end }
}

function ecPointToSpki(point) {
  const oidEc = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidCurve = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algorithmContent = new Uint8Array([...oidEc, ...oidCurve])
  const algorithm = new Uint8Array([0x30, algorithmContent.length, ...algorithmContent])
  const bitStringContent = new Uint8Array([0, ...point])
  const bitString = new Uint8Array([0x03, bitStringContent.length, ...bitStringContent])
  const content = new Uint8Array([...algorithm, ...bitString])
  return new Uint8Array([0x30, content.length, ...content])
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

function certificateDer(token) {
  const trimmed = String(token ?? '').trim()
  if (!trimmed) throw new Error('Certificate is missing')
  if (trimmed.includes('BEGIN CERTIFICATE')) {
    return base64ToBytes(trimmed.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  }
  const compact = trimmed.replace(/[\r\n\s]+/g, '')
  const once = base64ToBytes(compact)
  if (once[0] === 0x30) return once
  const decoded = new TextDecoder().decode(once).trim()
  if (decoded.includes('BEGIN CERTIFICATE')) {
    return base64ToBytes(decoded.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
  }
  return base64ToBytes(decoded.replace(/\s+/g, ''))
}

function certificateTbsNodes(der) {
  const certificate = derElement(der, 0)
  const tbs = derElement(der, certificate.contentStart)
  if (certificate.tag !== 0x30 || tbs.tag !== 0x30) throw new Error('Invalid X.509 certificate')
  let offset = tbs.contentStart
  let node = derElement(der, offset)
  if (node.tag === 0xa0) {
    offset = node.next
    node = derElement(der, offset)
  }
  const serial = node
  offset = serial.next
  offset = derElement(der, offset).next // signature algorithm
  const issuer = derElement(der, offset)
  const validity = derElement(der, issuer.next)
  const subject = derElement(der, validity.next)
  const spki = derElement(der, subject.next)
  return { issuer, validity, spki }
}

function decodeOid(bytes, node) {
  if (node.tag !== 0x06 || node.contentStart >= node.end) return null
  const values = []
  const first = bytes[node.contentStart]
  values.push(Math.floor(first / 40), first % 40)
  let value = 0
  for (let index = node.contentStart + 1; index < node.end; index++) {
    value = (value << 7) | (bytes[index] & 0x7f)
    if ((bytes[index] & 0x80) === 0) {
      values.push(value)
      value = 0
    }
  }
  return value === 0 ? values.join('.') : null
}

function decodeDerText(bytes, node) {
  if (![0x0c, 0x13, 0x14, 0x16, 0x17, 0x18, 0x1e].includes(node.tag)) return null
  let value
  if (node.tag === 0x1e) {
    if ((node.end - node.contentStart) % 2 !== 0) return null
    value = String.fromCharCode(...Array.from({ length: (node.end - node.contentStart) / 2 }, (_, index) =>
      (bytes[node.contentStart + index * 2] << 8) | bytes[node.contentStart + index * 2 + 1]))
  } else value = new TextDecoder().decode(bytes.slice(node.contentStart, node.end))
  const normalized = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
  return normalized && normalized.length <= 240 ? normalized : null
}

function x509Name(bytes, node) {
  if (node.tag !== 0x30) return null
  const labels = {
    '2.5.4.3': 'CN',
    '2.5.4.6': 'C',
    '2.5.4.10': 'O',
    '2.5.4.11': 'OU',
    '2.5.4.5': 'SERIALNUMBER',
  }
  const parts = []
  for (let rdnOffset = node.contentStart; rdnOffset < node.end;) {
    const rdn = derElement(bytes, rdnOffset)
    if (rdn.tag !== 0x31) return null
    for (let attributeOffset = rdn.contentStart; attributeOffset < rdn.end;) {
      const attribute = derElement(bytes, attributeOffset)
      if (attribute.tag !== 0x30) return null
      const oid = derElement(bytes, attribute.contentStart)
      const value = derElement(bytes, oid.next)
      const oidText = decodeOid(bytes, oid)
      const valueText = decodeDerText(bytes, value)
      if (oidText && valueText) parts.push(`${labels[oidText] ?? oidText}=${valueText}`)
      attributeOffset = attribute.next
    }
    rdnOffset = rdn.next
  }
  const result = parts.join(', ')
  return result && result.length <= 480 ? result : null
}

function certificateValidity(bytes, node) {
  if (node.tag !== 0x30) return { validFrom: null, validTo: null }
  const from = derElement(bytes, node.contentStart)
  const to = derElement(bytes, from.next)
  return {
    validFrom: decodeDerText(bytes, from),
    validTo: decodeDerText(bytes, to),
  }
}

function csrDer(csrPem) {
  const compact = String(csrPem ?? '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  if (!compact) throw new Error('CSR is missing')
  return base64ToBytes(compact)
}

function uniqueVatNumber(der, label) {
  const text = new TextDecoder().decode(der)
  const candidates = [...new Set(text.match(/3\d{13}3/g) ?? [])]
  if (candidates.length !== 1) {
    throw new Error(`${label} VAT identity is missing or ambiguous`)
  }
  return candidates[0]
}

export function certificatePublicKeySpki(certificateToken) {
  const der = certificateDer(certificateToken)
  const { spki } = certificateTbsNodes(der)
  const algorithm = derElement(der, spki.contentStart)
  const bitString = derElement(der, algorithm.next)
  if (spki.tag !== 0x30 || algorithm.tag !== 0x30 || bitString.tag !== 0x03 || der[bitString.contentStart] !== 0) {
    throw new Error('Invalid certificate SubjectPublicKeyInfo')
  }
  return ecPointToSpki(secp256k1.Point.fromBytes(der.slice(bitString.contentStart + 1, bitString.end)).toBytes(false))
}

export function certificateOperationalMetadata(certificateToken) {
  const der = certificateDer(certificateToken)
  const { issuer, validity } = certificateTbsNodes(der)
  return {
    der,
    issuer: x509Name(der, issuer),
    ...certificateValidity(der, validity),
  }
}

export function csrPublicKeySpki(csrPem) {
  const der = csrDer(csrPem)
  const csr = derElement(der, 0)
  const certificationRequestInfo = derElement(der, csr.contentStart)
  if (csr.tag !== 0x30 || csr.next !== der.length || certificationRequestInfo.tag !== 0x30) throw new Error('Invalid CSR')
  const version = derElement(der, certificationRequestInfo.contentStart)
  const subject = derElement(der, version.next)
  const spki = derElement(der, subject.next)
  const algorithm = derElement(der, spki.contentStart)
  const bitString = derElement(der, algorithm.next)
  if (version.tag !== 0x02 || subject.tag !== 0x30 || spki.tag !== 0x30 || algorithm.tag !== 0x30 || bitString.tag !== 0x03 || der[bitString.contentStart] !== 0) {
    throw new Error('Invalid CSR SubjectPublicKeyInfo')
  }
  return ecPointToSpki(secp256k1.Point.fromBytes(der.slice(bitString.contentStart + 1, bitString.end)).toBytes(false))
}

/**
 * The Compliance certificate is the Sandbox signing certificate. It must stay
 * bound to the generated CSR/private key throughout Sandbox onboarding and
 * final document signing.
 */
export function assessSandboxComplianceBinding({ privateKey, csrPem, complianceCertificate }) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error('Sandbox signing private key is invalid')
  }
  const privateSpki = privateKeyPublicKeySpki(privateKey)
  const storedCsrSpki = csrPublicKeySpki(csrPem)
  const signingCertificateSpki = certificatePublicKeySpki(complianceCertificate)
  return {
    privateKeyEqualsCsr: equalBytes(privateSpki, storedCsrSpki),
    privateKeyEqualsSigningCertificate: equalBytes(privateSpki, signingCertificateSpki),
    csrEqualsSigningCertificate: equalBytes(storedCsrSpki, signingCertificateSpki),
  }
}

/**
 * Computes strict key and VAT facts for a Sandbox operational certificate.
 * Callers must apply the bounded Sandbox mock policy separately; this helper
 * deliberately does not decide readiness on its own.
 */
export function assessSandboxProductionBinding({ privateKey, csrPem, productionCertificate, branchVat }) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error('Sandbox signing private key is invalid')
  }
  const normalizedBranchVat = String(branchVat ?? '').trim()
  if (!/^3\d{13}3$/.test(normalizedBranchVat)) {
    throw new Error('Sandbox branch VAT identity is invalid')
  }
  const privateSpki = privateKeyPublicKeySpki(privateKey)
  const storedCsrSpki = csrPublicKeySpki(csrPem)
  const productionCertificateSpki = certificatePublicKeySpki(productionCertificate)
  const csrVat = uniqueVatNumber(csrDer(csrPem), 'CSR')
  const productionCertificateVat = uniqueVatNumber(certificateDer(productionCertificate), 'Production certificate')
  return {
    privateKeyEqualsCsr: equalBytes(privateSpki, storedCsrSpki),
    privateKeyEqualsProductionCertificate: equalBytes(privateSpki, productionCertificateSpki),
    csrEqualsProductionCertificate: equalBytes(storedCsrSpki, productionCertificateSpki),
    csrVat,
    productionCertificateVat,
    branchVat: normalizedBranchVat,
    csrVatEqualsBranch: csrVat === normalizedBranchVat,
    productionCertificateVatEqualsCsr: productionCertificateVat === csrVat,
    productionCertificateVatEqualsBranch: productionCertificateVat === normalizedBranchVat,
  }
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Classifies the Sandbox operational credential without weakening the signing
 * key gate. Production callers must never use this Sandbox-only classifier.
 */
export async function assessSandboxOperationalCertificate({
  environment,
  privateKey,
  csrPem,
  productionCertificate,
  branchVat,
}) {
  const binding = assessSandboxProductionBinding({
    privateKey,
    csrPem,
    productionCertificate,
    branchVat,
  })
  const metadata = certificateOperationalMetadata(productionCertificate)
  const productionCertificateSpki = certificatePublicKeySpki(productionCertificate)
  const policy = classifySandboxOperationalCertificatePolicy({
    environment,
    ...binding,
    productionCertificateSpkiFingerprint: await sha256Hex(productionCertificateSpki),
  })
  return {
    ...binding,
    ...policy,
    environment,
    productionCertificateFingerprint: await sha256Hex(metadata.der),
    productionCertificateSpkiFingerprint: policy.productionCertificateSpkiFingerprint,
    productionCertificateIssuer: metadata.issuer,
    productionCertificateValidFrom: metadata.validFrom,
    productionCertificateValidTo: metadata.validTo,
  }
}

export function certificateVatNumber(certificateToken) {
  return uniqueVatNumber(certificateDer(certificateToken), 'Certificate')
}

export function csrVatNumber(csrPem) {
  return uniqueVatNumber(csrDer(csrPem), 'CSR')
}

export function privateKeyPublicKeySpki(privateKey) {
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new Error('Sandbox signing private key is invalid')
  }
  return ecPointToSpki(secp256k1.getPublicKey(privateKey, false))
}
