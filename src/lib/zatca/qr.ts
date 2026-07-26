// Read-only QR diagnostic decoder. Compliance QR payloads are constructed server-side;
// browser code may only render the final stored payload.

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
 * Decode a ZATCA TLV Base64 payload for diagnostics.
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
