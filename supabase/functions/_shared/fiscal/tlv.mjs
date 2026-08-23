const MAX_TLV_VALUE_BYTES = 255

export function encodeTlvField(tag, value) {
  if (!Number.isInteger(tag) || tag < 1 || tag > 255) throw new Error('TLV tag must be an unsigned byte')
  if (typeof value !== 'string' || value.length === 0) throw new Error(`TLV tag ${tag} value must be non-empty text`)
  const bytes = new TextEncoder().encode(value)
  if (bytes.length > MAX_TLV_VALUE_BYTES) throw new Error(`TLV tag ${tag} value exceeds 255 UTF-8 bytes`)
  return new Uint8Array([tag, bytes.length, ...bytes])
}

export function buildTlvBase64(fields) {
  if (!Array.isArray(fields) || fields.length === 0) throw new Error('TLV fields are required')
  const bytes = fields.map(({ tag, value }) => encodeTlvField(tag, value))
  const length = bytes.reduce((sum, field) => sum + field.length, 0)
  const payload = new Uint8Array(length)
  let offset = 0
  for (const field of bytes) {
    payload.set(field, offset)
    offset += field.length
  }
  return bytesToBase64(payload)
}

export function decodeTlvBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    throw new Error('TLV payload must be canonical Base64')
  }
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  const fields = []
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) throw new Error('Truncated TLV header')
    const tag = bytes[offset++]
    const length = bytes[offset++]
    if (offset + length > bytes.length) throw new Error(`Truncated TLV tag ${tag}`)
    const raw = bytes.slice(offset, offset + length)
    fields.push({ tag, value: new TextDecoder().decode(raw), byteLength: length })
    offset += length
  }
  return fields
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
