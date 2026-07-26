const REQUIRED_TAGS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9])
const MAX_TLV_VALUE_BYTES = 255
const MAX_QR_BASE64_CHARACTERS = 700
const ID_EC_PUBLIC_KEY_OID = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
const SECP256K1_OID = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x0a])

/**
 * Build the one active ZATCA Phase 2 QR contract used by SDK 3.4.8:
 * tags 1-7 are UTF-8 text; tags 8-9 retain their certificate DER values.
 */
export function buildZatcaPhase2Qr({
  sellerName,
  vatNumber,
  timestamp,
  totalAmount,
  vatAmount,
  invoiceHashBase64,
  signatureValueBase64,
  publicKeySpki,
  certificateSignatureDer,
}) {
  const invoiceHash = strictBase64ToBytes(invoiceHashBase64, 'invoice hash')
  assertExactLength(invoiceHash, 32, 'invoice hash')
  const signatureValue = strictBase64ToBytes(signatureValueBase64, 'XML SignatureValue')
  if (signatureValue.length === 0) throw new Error('XML SignatureValue must decode to non-empty bytes')
  validateDerSpki(publicKeySpki)
  validateDerEcdsaSignature(certificateSignatureDer)

  const fields = [
    tlvText(1, sellerName, 'seller name'),
    tlvText(2, vatNumber, 'VAT registration number'),
    tlvText(3, timestamp, 'invoice timestamp'),
    tlvText(4, formatAmount(totalAmount, 'invoice total'), 'invoice total'),
    tlvText(5, formatAmount(vatAmount, 'VAT total'), 'VAT total'),
    tlvText(6, invoiceHashBase64, 'invoice hash'),
    tlvText(7, signatureValueBase64, 'XML SignatureValue'),
    tlvBytes(8, publicKeySpki, 'ECDSA public key SPKI'),
    tlvBytes(9, certificateSignatureDer, 'certificate ECDSA signature'),
  ]

  const payload = concatBytes(fields)
  const parsedTags = parseTlvTags(payload)
  if (!arraysEqual(parsedTags, REQUIRED_TAGS)) {
    throw new Error('ZATCA Phase 2 QR tags must occur exactly once in order 1 through 9')
  }

  const qr = bytesToBase64(payload)
  if (qr.length > MAX_QR_BASE64_CHARACTERS) {
    throw new Error(`ZATCA Phase 2 QR exceeds ${MAX_QR_BASE64_CHARACTERS} Base64 characters`)
  }
  return qr
}

export function strictBase64ToBytes(value, label = 'value') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be non-empty Base64`)
  }
  if (value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical Base64`)
  }
  let decoded
  try {
    decoded = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  } catch {
    throw new Error(`${label} is not valid Base64`)
  }
  if (bytesToBase64(decoded) !== value) {
    throw new Error(`${label} is not canonical Base64`)
  }
  return decoded
}

export function validateDerSpki(spki) {
  assertBytes(spki, 'ECDSA public key SPKI')
  if (spki.length === 0) throw new Error('ECDSA public key SPKI must be non-empty')

  const outer = readDerElement(spki, 0, 0x30, 'SPKI sequence')
  if (outer.nextOffset !== spki.length) throw new Error('ECDSA public key SPKI has trailing DER data')

  const algorithm = readDerElement(spki, outer.valueOffset, 0x30, 'SPKI algorithm identifier')
  const algorithmOid = readDerElement(spki, algorithm.valueOffset, 0x06, 'SPKI algorithm OID')
  if (!derOidValueEquals(spki, algorithmOid, ID_EC_PUBLIC_KEY_OID)) {
    throw new Error('ECDSA public key SPKI algorithm must be id-ecPublicKey')
  }
  const parameterOid = readDerElement(spki, algorithmOid.nextOffset, 0x06, 'SPKI parameter OID')
  if (parameterOid.nextOffset !== algorithm.nextOffset) {
    throw new Error('ECDSA public key SPKI has invalid algorithm parameters')
  }
  if (!derOidValueEquals(spki, parameterOid, SECP256K1_OID)) {
    throw new Error('ECDSA public key SPKI curve must be secp256k1')
  }
  if (algorithm.nextOffset >= outer.nextOffset) {
    throw new Error('ECDSA public key SPKI is missing its subjectPublicKey')
  }
  const publicKey = readDerElement(spki, algorithm.nextOffset, 0x03, 'SPKI subjectPublicKey')
  if (publicKey.nextOffset !== outer.nextOffset) {
    throw new Error('ECDSA public key SPKI has unexpected DER fields')
  }
  if (publicKey.valueLength !== 66 ||
      spki[publicKey.valueOffset] !== 0 ||
      spki[publicKey.valueOffset + 1] !== 0x04) {
    throw new Error('ECDSA public key SPKI has an invalid BIT STRING')
  }
}

export function validateDerEcdsaSignature(signature) {
  assertBytes(signature, 'certificate ECDSA signature')
  if (signature.length === 0) throw new Error('certificate ECDSA signature must be non-empty')

  const sequence = readDerElement(signature, 0, 0x30, 'ECDSA signature sequence')
  if (sequence.nextOffset !== signature.length) {
    throw new Error('certificate ECDSA signature has trailing DER data')
  }
  const r = readPositiveDerInteger(signature, sequence.valueOffset, 'ECDSA signature r')
  const s = readPositiveDerInteger(signature, r.nextOffset, 'ECDSA signature s')
  if (s.nextOffset !== sequence.nextOffset) {
    throw new Error('certificate ECDSA signature must contain exactly r and s')
  }
}

function tlvText(tag, value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be non-empty`)
  }
  return tlvBytes(tag, new TextEncoder().encode(value), label)
}

function tlvBytes(tag, value, label) {
  assertBytes(value, label)
  if (value.length === 0) throw new Error(`${label} must be non-empty`)
  if (value.length > MAX_TLV_VALUE_BYTES) {
    throw new Error(`${label} exceeds the one-byte TLV length limit`)
  }
  return new Uint8Array([tag, value.length, ...value])
}

function formatAmount(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`)
  }
  return value.toFixed(2)
}

function parseTlvTags(payload) {
  const tags = []
  let offset = 0
  while (offset < payload.length) {
    if (offset + 2 > payload.length) throw new Error('Truncated ZATCA TLV header')
    const tag = payload[offset++]
    const length = payload[offset++]
    if (offset + length > payload.length) throw new Error(`Truncated ZATCA TLV tag ${tag}`)
    tags.push(tag)
    offset += length
  }
  return tags
}

function readPositiveDerInteger(bytes, offset, label) {
  const integer = readDerElement(bytes, offset, 0x02, label)
  if (integer.valueLength === 0) throw new Error(`${label} must be non-empty`)
  const first = bytes[integer.valueOffset]
  if ((first & 0x80) !== 0) throw new Error(`${label} must not be negative`)
  if (integer.valueLength > 1 && first === 0 && (bytes[integer.valueOffset + 1] & 0x80) === 0) {
    throw new Error(`${label} is not canonical DER`)
  }
  return integer
}

function derOidValueEquals(bytes, oid, expected) {
  if (oid.valueLength !== expected.length) return false
  for (let index = 0; index < expected.length; index++) {
    if (bytes[oid.valueOffset + index] !== expected[index]) return false
  }
  return true
}

function readDerElement(bytes, offset, expectedTag, label) {
  if (offset >= bytes.length || bytes[offset++] !== expectedTag) {
    throw new Error(`${label} has an invalid DER tag`)
  }
  const length = readDerLength(bytes, offset)
  const valueOffset = length.nextOffset
  const nextOffset = valueOffset + length.length
  if (nextOffset > bytes.length) throw new Error(`${label} is truncated`)
  return { valueOffset, valueLength: length.length, nextOffset }
}

function readDerLength(bytes, offset) {
  if (offset >= bytes.length) throw new Error('Truncated DER length')
  const first = bytes[offset++]
  if ((first & 0x80) === 0) return { length: first, nextOffset: offset }
  const count = first & 0x7f
  if (count === 0 || count > 2 || offset + count > bytes.length) {
    throw new Error('Unsupported DER length')
  }
  if (bytes[offset] === 0) throw new Error('Non-canonical DER length')
  let length = 0
  for (let i = 0; i < count; i++) length = (length << 8) | bytes[offset++]
  if (length < 128) throw new Error('Non-canonical DER length')
  return { length, nextOffset: offset }
}

function assertExactLength(value, expected, label) {
  assertBytes(value, label)
  if (value.length !== expected) {
    throw new Error(`${label} must be exactly ${expected} bytes`)
  }
}

function assertBytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} must be a Uint8Array`)
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
