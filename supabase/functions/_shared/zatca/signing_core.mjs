export const ZATCA_SIGNATURE_INPUT_KIND =
  'decoded invoiceHash bytes (ZATCA SDK SHA256withECDSA behavior)'

export function signZatcaInvoiceHash(invoiceHashB64, secretKey, secp256k1) {
  const signatureInput = base64ToBytes(invoiceHashB64)
  const signatureP1363 = secp256k1.sign(signatureInput, secretKey)
  const signatureDerBytes = p1363ToDer(signatureP1363)

  return {
    signatureInput,
    signatureInputKind: ZATCA_SIGNATURE_INPUT_KIND,
    signatureDerBytes,
    signatureValueBase64: bytesToBase64(signatureDerBytes),
  }
}

export function extractEcPrivateKeyScalar(bytes) {
  if (bytes.length === 32) return bytes
  for (let i = 0; i < bytes.length - 33; i++) {
    if (bytes[i] === 0x04 && bytes[i + 1] === 0x20) {
      return bytes.slice(i + 2, i + 34)
    }
  }
  throw new Error('Unsupported EC private key format')
}

function p1363ToDer(sig) {
  const r = sig.slice(0, 32)
  const s = sig.slice(32, 64)
  const rDer = derInt(r)
  const sDer = derInt(s)
  return new Uint8Array([0x30, rDer.length + sDer.length, ...rDer, ...sDer])
}

function derInt(n) {
  let i = 0
  while (i < n.length - 1 && n[i] === 0) i++
  const trimmed = n.slice(i)
  const value = (trimmed[0] & 0x80) ? new Uint8Array([0, ...trimmed]) : trimmed
  return new Uint8Array([0x02, value.length, ...value])
}

function base64ToBytes(value) {
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(value), c => c.charCodeAt(0))
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(value, 'base64'))
  }
  throw new Error('No base64 decoder is available in this runtime')
}

function bytesToBase64(bytes) {
  if (typeof btoa === 'function') {
    return btoa(String.fromCharCode(...bytes))
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  throw new Error('No base64 encoder is available in this runtime')
}
