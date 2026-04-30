// ZATCA Phase 1 Simplified Invoice QR Code — TLV Base64 Encoding
// Specification: ZATCA e-Invoice Implementation Standards v3.2.1
// Each field: tag (1 byte) + length (1 byte) + UTF-8 value bytes

export interface ZatcaQRInput {
  sellerName:  string  // Tag 1: legal seller name (Arabic preferred)
  vatNumber:   string  // Tag 2: seller VAT registration number
  timestamp:   string  // Tag 3: invoice date/time (ISO 8601 with timezone)
  totalAmount: number  // Tag 4: invoice total with VAT
  vatAmount:   number  // Tag 5: VAT total
}

function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const buf   = new Uint8Array(2 + bytes.length)
  buf[0] = tag
  buf[1] = bytes.length
  buf.set(bytes, 2)
  return buf
}

/** Returns the Base64-encoded TLV payload for ZATCA Phase 1 QR code. */
export function buildZatcaQR(input: ZatcaQRInput): string {
  const fields = [
    tlv(0x01, input.sellerName),
    tlv(0x02, input.vatNumber),
    tlv(0x03, input.timestamp),
    tlv(0x04, input.totalAmount.toFixed(2)),
    tlv(0x05, input.vatAmount.toFixed(2)),
  ]
  const totalLen = fields.reduce((s, f) => s + f.length, 0)
  const combined = new Uint8Array(totalLen)
  let offset = 0
  for (const f of fields) {
    combined.set(f, offset)
    offset += f.length
  }
  let binary = ''
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i])
  return btoa(binary)
}
