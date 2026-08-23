const PEM_CERTIFICATE = 'CERTIFICATE'

export function normalizeZatcaCertificate(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw certificateError('ZATCA_CERT_BASE64_INVALID', 'Certificate value is empty')
  }
  const trimmed = value.trim()
  if (trimmed.includes(`-----BEGIN ${PEM_CERTIFICATE}-----`)) return normalizePem(trimmed, 'pem')
  const decoded = strictBase64Decode(trimmed)
  if (decoded[0] === 0x30) {
    validateDerCertificate(decoded)
    return { der: decoded, format: 'base64_der', decodedLength: decoded.length }
  }
  const text = new TextDecoder().decode(decoded).trim()
  if (text.includes(`-----BEGIN ${PEM_CERTIFICATE}-----`)) return normalizePem(text, 'base64_pem')
  if (isStrictBase64(text)) {
    const secondDecoded = strictBase64Decode(text)
    if (secondDecoded[0] === 0x30) {
      validateDerCertificate(secondDecoded)
      return { der: secondDecoded, format: 'double_base64_der', decodedLength: secondDecoded.length }
    }
    const secondText = new TextDecoder().decode(secondDecoded).trim()
    if (secondText.includes(`-----BEGIN ${PEM_CERTIFICATE}-----`)) {
      return normalizePem(secondText, 'double_base64_pem')
    }
  }
  throw certificateError('ZATCA_CERT_X509_INVALID', 'Decoded certificate is neither DER nor PEM')
}

export function inspectZatcaCertificate(value) {
  const result = {
    originalLength: typeof value === 'string' ? value.length : 0,
    leadingWhitespace: typeof value === 'string' ? /^\s/.test(value) : false,
    trailingWhitespace: typeof value === 'string' ? /\s$/.test(value) : false,
    base64DecodeSucceeds: false,
    decodedLength: 0,
    decodedUtf8Text: false,
    decodedBeginsPem: false,
    decodedBeginsDerSequence: false,
    secondBase64Layer: false,
    secondDecodeSucceeds: false,
    secondDecodedLength: 0,
    secondDecodedUtf8Text: false,
    secondDecodedBeginsPem: false,
    secondDecodedBeginsDerSequence: false,
    secondX509Parse: false,
    secondTopLevelTag: null,
    secondDeclaredLength: null,
    secondActualLength: 0,
    secondLengthConsistent: false,
    secondTrailingBytes: null,
    secondTruncated: false,
    secondAsn1Complete: false,
    secondX509Shape: false,
    secondFirstEightHex: null,
    pemCertificateBlocks: 0,
    format: null,
  }
  if (typeof value !== 'string' || value.trim() === '') return result
  const trimmed = value.trim()
  result.pemCertificateBlocks = countPemCertificates(trimmed)
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) {
    result.format = 'pem'
    return result
  }
  try {
    const decoded = strictBase64Decode(trimmed)
    result.base64DecodeSucceeds = true
    result.decodedLength = decoded.length
    result.decodedBeginsDerSequence = decoded[0] === 0x30
    const text = new TextDecoder().decode(decoded)
    result.decodedUtf8Text = !text.includes('\uFFFD') && /[\x09\x0A\x0D\x20-\x7E]/.test(text)
    const compactText = text.trim()
    result.decodedBeginsPem = compactText.startsWith('-----BEGIN CERTIFICATE-----')
    result.pemCertificateBlocks = Math.max(result.pemCertificateBlocks, countPemCertificates(compactText))
    if (result.decodedBeginsDerSequence) result.format = 'base64_der'
    else if (result.decodedBeginsPem) result.format = 'base64_pem'
    else if (isStrictBase64(compactText)) {
      result.secondBase64Layer = true
      try {
        const secondDecoded = strictBase64Decode(compactText)
        result.secondDecodeSucceeds = true
        result.secondDecodedLength = secondDecoded.length
        result.secondActualLength = secondDecoded.length
        result.secondFirstEightHex = Array.from(secondDecoded.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')
        result.secondDecodedBeginsDerSequence = secondDecoded[0] === 0x30
        const secondText = new TextDecoder().decode(secondDecoded).trim()
        result.secondDecodedUtf8Text = !secondText.includes('\uFFFD') && /[\x09\x0A\x0D\x20-\x7E]/.test(secondText)
        result.secondDecodedBeginsPem = secondText.startsWith('-----BEGIN CERTIFICATE-----')
        if (result.secondDecodedBeginsDerSequence) {
          validateDerCertificate(secondDecoded)
          const structure = inspectDerStructure(secondDecoded)
          result.secondTopLevelTag = structure.topLevelTag
          result.secondDeclaredLength = structure.declaredLength
          result.secondLengthConsistent = structure.lengthConsistent
          result.secondTrailingBytes = structure.trailingBytes
          result.secondTruncated = structure.truncated
          result.secondAsn1Complete = structure.complete
          result.secondX509Shape = structure.x509Shape
          result.secondX509Parse = structure.x509Shape
          result.format = 'double_base64_der'
        } else if (result.secondDecodedBeginsPem) {
          normalizePem(secondText, 'double_base64_pem')
          result.secondX509Parse = true
          result.format = 'double_base64_pem'
        } else {
          result.format = 'double_base64_non_certificate'
        }
      } catch {
        result.format = 'double_base64_invalid'
      }
    } else result.format = 'non_certificate'
  } catch {
    result.format = 'malformed_base64'
  }
  return result
}

function normalizePem(pem, format) {
  if (countPemCertificates(pem) !== 1) {
    throw certificateError('ZATCA_CERT_PEM_INVALID', 'Expected exactly one X.509 certificate PEM block')
  }
  const match = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/)
  if (!match) throw certificateError('ZATCA_CERT_PEM_INVALID', 'Certificate PEM delimiters are invalid')
  const der = strictBase64Decode(match[1].replace(/\s+/g, ''))
  validateDerCertificate(der)
  return { der, format, decodedLength: der.length }
}

function validateDerCertificate(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0x30) {
    throw certificateError('ZATCA_CERT_X509_INVALID', 'Certificate is not a DER SEQUENCE')
  }
  const length = readDerLength(bytes, 1)
  if (length.end !== bytes.length) {
    throw certificateError('ZATCA_CERT_X509_INVALID', 'Certificate DER is truncated or has trailing data')
  }
}

function inspectDerStructure(bytes) {
  try {
    const root = derNode(bytes, 0)
    const complete = root.next === bytes.length
    const children = []
    if (root.tag === 0x30) {
      let offset = root.contentStart
      while (offset < root.end) {
        const child = derNode(bytes, offset)
        children.push(child)
        offset = child.next
      }
    }
    return {
      topLevelTag: root.tag,
      declaredLength: root.declaredLength,
      lengthConsistent: root.end === bytes.length,
      trailingBytes: root.end < bytes.length ? bytes.length - root.end : 0,
      truncated: root.end > bytes.length,
      complete,
      x509Shape: complete && root.tag === 0x30 && children.length === 3 &&
        children[0].tag === 0x30 && children[1].tag === 0x30 && children[2].tag === 0x03,
    }
  } catch {
    return {
      topLevelTag: bytes[0] ?? null,
      declaredLength: null,
      lengthConsistent: false,
      trailingBytes: null,
      truncated: true,
      complete: false,
      x509Shape: false,
    }
  }
}

function derNode(bytes, offset) {
  if (offset >= bytes.length) throw certificateError('ZATCA_CERT_X509_INVALID', 'DER node is missing')
  const start = offset
  const tag = bytes[offset++]
  if (offset >= bytes.length) throw certificateError('ZATCA_CERT_X509_INVALID', 'DER length is missing')
  const firstLength = bytes[offset++]
  let declaredLength = firstLength
  if (firstLength & 0x80) {
    const count = firstLength & 0x7f
    if (count === 0 || count > 4 || offset + count > bytes.length) {
      throw certificateError('ZATCA_CERT_X509_INVALID', 'DER length is invalid')
    }
    declaredLength = 0
    for (let i = 0; i < count; i++) declaredLength = (declaredLength * 256) + bytes[offset++]
  }
  const end = offset + declaredLength
  if (end > bytes.length) throw certificateError('ZATCA_CERT_X509_INVALID', 'DER is truncated')
  return { start, tag, contentStart: offset, end, next: end, declaredLength }
}

function readDerLength(bytes, offset) {
  if (offset >= bytes.length) throw certificateError('ZATCA_CERT_X509_INVALID', 'Certificate DER length is missing')
  const first = bytes[offset]
  if ((first & 0x80) === 0) return { length: first, end: offset + 1 + first }
  const count = first & 0x7f
  if (count === 0 || count > 4 || offset + 1 + count > bytes.length) {
    throw certificateError('ZATCA_CERT_X509_INVALID', 'Certificate DER length is invalid')
  }
  let length = 0
  for (let i = 0; i < count; i++) length = (length * 256) + bytes[offset + 1 + i]
  return { length, end: offset + 1 + count + length }
}

function strictBase64Decode(value) {
  if (!isStrictBase64(value)) throw certificateError('ZATCA_CERT_BASE64_INVALID', 'Certificate Base64 is invalid')
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), c => c.charCodeAt(0))
  } catch {
    throw certificateError('ZATCA_CERT_BASE64_INVALID', 'Certificate Base64 could not be decoded')
  }
}

function isStrictBase64(value) {
  if (!value || /[^A-Za-z0-9+/_=-]/.test(value)) return false
  const compact = value.replace(/-/g, '+').replace(/_/g, '/')
  if (compact.length % 4 === 1) return false
  return !/=.+/.test(compact.replace(/=*$/, ''))
}

function countPemCertificates(value) {
  return (value.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length
}

function certificateError(code, message) {
  const error = new Error(message)
  error.name = code
  error.code = code
  return error
}
