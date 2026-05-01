// ZATCA Phase 1 Simplified Invoice QR Code — TLV Base64 Encoding
// Specification: Security Features Implementation Standards v1.2 (2023-05-19)
//                Section 4.1 — Structure of the QR code (pages 25–26)
//
// Phase 1 (Simplified Tax Invoices, mandatory from 4 Dec 2021): Tags 1–5
// Phase 2 (Standard Tax Invoices, mandatory from 1 Jan 2023): Tags 1–9
//   Tags 6–9 add: XML hash (SHA256), ECDSA signature, public key, ZATCA CA stamp.
//   This file implements Phase 1 only; Phase 2 requires server-side signing.
//
// TLV encoding rules per spec (Section 4.1):
//   Tag   : the tag number stored in exactly ONE byte
//   Length: the byte count of the UTF-8 encoded value, stored in ONE byte (unsigned)
//   Value : the UTF-8 byte array of the field value
//
// Order of operations:
//   1. Build TLV tuples for tags 1→5 (in order)
//   2. Concatenate all tuples into one byte array
//   3. Base64-encode the concatenated bytes → QR content string
//   4. Feed the Base64 string to a QR image generator (e.g. the `qrcode` npm package)

export interface TLVField {
  tag:   number
  label: string
  value: string
}

const TAG_LABELS: Record<number, string> = {
  1: 'Seller Name',
  2: 'VAT Number',
  3: 'Timestamp',
  4: 'Total with VAT',
  5: 'VAT Amount',
}

/**
 * Reverse the TLV Base64 encoding produced by buildZatcaQR().
 * Returns one entry per TLV tuple found in the byte stream.
 * Throws if the Base64 string is malformed.
 */
export function decodeTLV(base64: string): TLVField[] {
  const binary = atob(base64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const fields: TLVField[] = []
  let pos = 0
  while (pos < bytes.length) {
    if (pos + 1 >= bytes.length) break
    const tag = bytes[pos]
    const len = bytes[pos + 1]
    if (pos + 2 + len > bytes.length) break
    const value = new TextDecoder('utf-8').decode(bytes.slice(pos + 2, pos + 2 + len))
    fields.push({ tag, label: TAG_LABELS[tag] ?? `Tag ${tag}`, value })
    pos += 2 + len
  }
  return fields
}

export interface ZatcaQRInput {
  sellerName:  string  // Tag 1: legal seller name; Arabic preferred per ZATCA regulations
  vatNumber:   string  // Tag 2: seller VAT registration number (15-digit KSA format)
  timestamp:   string  // Tag 3: invoice date/time — any ISO 8601; see normalizeTimestamp()
  totalAmount: number  // Tag 4: invoice total WITH VAT (BT-112); exactly 2 decimal places
  vatAmount:   number  // Tag 5: VAT total (BT-110 from XML invoice); exactly 2 decimal places
}

/**
 * Convert any ISO 8601 timestamp to the ZATCA-required format: YYYY-MM-DDTHH:MM:SSZ
 *
 * The spec example (p.26): "2022-02-21T12:13:57Z"
 * — UTC timezone indicated by trailing Z (not +00:00)
 * — No fractional seconds
 *
 * Supabase returns timestamps as "2024-01-15T10:30:45.123456+00:00" — this function
 * converts that (and any other ISO 8601 variant) to the required form.
 */
function normalizeTimestamp(iso: string): string {
  // Date constructor parses all ISO 8601 variants; toISOString() always returns UTC.
  // toISOString() format: "YYYY-MM-DDTHH:MM:SS.mmmZ" — strip the milliseconds.
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Build one TLV tuple: 1-byte tag + 1-byte length (UTF-8 byte count) + UTF-8 value.
 * Maximum field size is 255 UTF-8 bytes (length fits in one unsigned byte).
 * Arabic text is correctly handled: TextEncoder always produces UTF-8 output.
 */
function tlv(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const buf   = new Uint8Array(2 + bytes.length)
  buf[0] = tag
  buf[1] = bytes.length  // unsigned 8-bit integer; adequate for all practical field sizes
  buf.set(bytes, 2)
  return buf
}

/**
 * Build and Base64-encode the ZATCA Phase 1 QR code TLV payload.
 *
 * Returns a Base64 ASCII string. Pass this directly to QRCode.toDataURL() or
 * store it in invoices.zatca_qr_code for display on the invoice PDF.
 *
 * Arabic seller names are fully supported: TextEncoder produces UTF-8 bytes (0–255 each),
 * which are mapped to Latin-1 code points before btoa() encodes them as Base64.
 */
export function buildZatcaQR(input: ZatcaQRInput): string {
  const fields = [
    tlv(0x01, input.sellerName),
    tlv(0x02, input.vatNumber),
    tlv(0x03, normalizeTimestamp(input.timestamp)),  // normalize to YYYY-MM-DDTHH:MM:SSZ
    tlv(0x04, input.totalAmount.toFixed(2)),         // exactly 2 decimal places per spec
    tlv(0x05, input.vatAmount.toFixed(2)),           // BT-110; exactly 2 decimal places
  ]

  const totalLen = fields.reduce((s, f) => s + f.length, 0)
  const combined = new Uint8Array(totalLen)
  let offset = 0
  for (const f of fields) {
    combined.set(f, offset)
    offset += f.length
  }

  // btoa() requires a Latin-1 binary string. Each byte (0–255) maps to a Latin-1 code
  // point, so converting via String.fromCharCode() is safe and correct — no data loss.
  let binary = ''
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i])
  return btoa(binary)
}
