const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1'
const OID_SECP256K1 = '1.3.132.0.10'

export function inspectX509Certificate(der) {
  try {
    const certificate = readNode(der, 0)
    const certificateChildren = readChildren(der, certificate)
    if (certificate.tag !== 0x30 || certificateChildren.length !== 3) {
      throw new Error('certificate sequence shape invalid')
    }
    const [tbs, signatureAlgorithm, signatureValue] = certificateChildren
    const tbsChildren = readChildren(der, tbs)
    let index = 0
    let version = 1
    if (tbsChildren[index]?.tag === 0xa0) {
      const versionNode = readChildren(der, tbsChildren[index])[0]
      version = versionNode?.content?.[0] ?? null
      index++
    }
    const serialNumber = tbsChildren[index++]
    const tbsSignature = tbsChildren[index++]
    const issuer = tbsChildren[index++]
    const validity = tbsChildren[index++]
    const subject = tbsChildren[index++]
    const subjectPublicKeyInfo = tbsChildren[index++]
    const extensionsNode = tbsChildren.find(node => node.tag === 0xa3)
    const extensionData = extensionsNode ? parseExtensions(der, extensionsNode) : { count: 0, oids: [], criticalOids: [] }
    const spkiChildren = readChildren(der, subjectPublicKeyInfo)
    const spkiAlgorithmChildren = readChildren(der, spkiChildren[0])
    const publicKeyAlgorithmOid = oidValue(der, spkiAlgorithmChildren[0])
    const curveOid = spkiAlgorithmChildren[1] && oidValue(der, spkiAlgorithmChildren[1])
    const publicKeyBitString = spkiChildren[1]
    const publicPoint = publicKeyBitString && der.slice(publicKeyBitString.contentStart + 1, publicKeyBitString.end)
    const complete = certificate.next === der.length &&
      tbs.tag === 0x30 && signatureAlgorithm.tag === 0x30 && signatureValue.tag === 0x03 &&
      serialNumber?.tag === 0x02 && tbsSignature?.tag === 0x30 &&
      issuer?.tag === 0x30 && validity?.tag === 0x30 && subject?.tag === 0x30 &&
      subjectPublicKeyInfo?.tag === 0x30 && spkiChildren.length === 2 &&
      spkiChildren[0]?.tag === 0x30 && publicKeyBitString?.tag === 0x03 &&
      publicKeyBitString.contentStart < publicKeyBitString.end &&
      publicKeyBitString.contentStart + 1 < publicKeyBitString.end
    return {
      valid: Boolean(complete),
      topLevelTag: certificate.tag,
      declaredLength: certificate.declaredLength,
      actualLength: der.length,
      complete,
      trailingBytes: certificate.next < der.length ? der.length - certificate.next : 0,
      truncated: certificate.next > der.length,
      version,
      serialNumberLength: serialNumber?.contentLength ?? null,
      signatureOid: oidValue(der, signatureAlgorithmChildren(der, signatureAlgorithm)),
      issuerPresent: issuer?.tag === 0x30,
      validityPresent: validity?.tag === 0x30,
      subjectPresent: subject?.tag === 0x30,
      subjectPublicKeyInfoPresent: subjectPublicKeyInfo?.tag === 0x30,
      publicKeyAlgorithmOid,
      curveOid,
      publicKeyLength: publicPoint?.length ?? null,
      extensionCount: extensionData.count,
      extensionOids: extensionData.oids,
      criticalExtensionOids: extensionData.criticalOids,
      unknownCriticalExtensionOids: extensionData.criticalOids.filter(oid => !KNOWN_CRITICAL_OIDS.has(oid)),
    }
  } catch (error) {
    return {
      valid: false,
      parseFailure: error instanceof Error ? error.message : 'ASN.1 structure invalid',
      topLevelTag: der?.[0] ?? null,
      actualLength: der?.length ?? 0,
    }
  }
}

export function extractCanonicalEcSpki(der) {
  const certificate = readNode(der, 0)
  const [tbs] = readChildren(der, certificate)
  const tbsChildren = readChildren(der, tbs)
  let index = tbsChildren[0]?.tag === 0xa0 ? 1 : 0
  index += 5
  const spki = tbsChildren[index]
  const spkiChildren = readChildren(der, spki)
  const algorithmChildren = readChildren(der, spkiChildren[0])
  const algorithmOid = oidValue(der, algorithmChildren[0])
  const curveOid = algorithmChildren[1] && oidValue(der, algorithmChildren[1])
  const bitString = spkiChildren[1]
  if (algorithmOid !== OID_EC_PUBLIC_KEY || curveOid !== OID_SECP256K1 || bitString.tag !== 0x03 || der[bitString.contentStart] !== 0) {
    throw new Error('Unsupported or invalid EC SubjectPublicKeyInfo')
  }
  const point = der.slice(bitString.contentStart + 1, bitString.end)
  if (point.length !== 65 || point[0] !== 0x04) throw new Error('Invalid uncompressed EC public key')
  return { spki: ecPointToSpki(point), point }
}

function parseExtensions(bytes, extensionsNode) {
  const sequence = readChildren(bytes, extensionsNode)[0]
  const extensionNodes = readChildren(bytes, sequence)
  const oids = []
  const criticalOids = []
  for (const extension of extensionNodes) {
    const children = readChildren(bytes, extension)
    const oid = oidValue(bytes, children[0])
    oids.push(oid)
    if (children[1]?.tag === 0x01 && children[1].contentLength === 1 && bytes[children[1].contentStart] !== 0) criticalOids.push(oid)
  }
  return { count: extensionNodes.length, oids, criticalOids }
}

function signatureAlgorithmChildren(bytes, algorithm) {
  return readChildren(bytes, algorithm)[0]
}

function readChildren(bytes, node) {
  if ((node.tag & 0x20) === 0) return []
  const children = []
  let offset = node.contentStart
  while (offset < node.end) {
    const child = readNode(bytes, offset)
    children.push(child)
    offset = child.next
  }
  if (offset !== node.end) throw new Error('ASN.1 child boundary mismatch')
  return children
}

function readNode(bytes, offset) {
  if (!(bytes instanceof Uint8Array) || offset >= bytes.length) throw new Error('ASN.1 node missing')
  const start = offset
  const tag = bytes[offset++]
  if (offset >= bytes.length) throw new Error('ASN.1 length missing')
  const firstLength = bytes[offset++]
  let contentLength = firstLength
  if (firstLength & 0x80) {
    const count = firstLength & 0x7f
    if (count === 0 || count > 4 || offset + count > bytes.length) throw new Error('ASN.1 length invalid')
    contentLength = 0
    for (let i = 0; i < count; i++) contentLength = (contentLength * 256) + bytes[offset++]
  }
  const end = offset + contentLength
  if (end > bytes.length) throw new Error('ASN.1 truncated')
  return { start, tag, contentStart: offset, end, next: end, declaredLength: contentLength, contentLength, content: bytes.slice(offset, end) }
}

function oidValue(bytes, node) {
  if (!node || node.tag !== 0x06 || node.contentLength === 0) return null
  const values = []
  const first = bytes[node.contentStart]
  values.push(Math.min(2, Math.floor(first / 40)), first - Math.min(2, Math.floor(first / 40)) * 40)
  let value = 0
  for (let i = node.contentStart + 1; i < node.end; i++) {
    value = (value << 7) | (bytes[i] & 0x7f)
    if ((bytes[i] & 0x80) === 0) {
      values.push(value)
      value = 0
    }
  }
  if (value !== 0) throw new Error('ASN.1 OID truncated')
  return values.join('.')
}

function ecPointToSpki(point) {
  const oidEc = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidCurve = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a])
  const algorithmContent = new Uint8Array([...oidEc, ...oidCurve])
  const algorithm = new Uint8Array([0x30, algorithmContent.length, ...algorithmContent])
  const bitContent = new Uint8Array([0, ...point])
  const bitString = new Uint8Array([0x03, bitContent.length, ...bitContent])
  const content = new Uint8Array([...algorithm, ...bitString])
  return new Uint8Array([0x30, content.length, ...content])
}

const KNOWN_CRITICAL_OIDS = new Set(['2.5.29.15', '2.5.29.19', '2.5.29.37'])
