const ADDITIONAL_DOCUMENT_REFERENCE =
  /<cac:AdditionalDocumentReference\b[^>]*>([\s\S]*?)<\/cac:AdditionalDocumentReference>/gi
const DIRECT_REFERENCE_ID =
  /^\s*<cbc:ID(?:\s[^>]*)?>([^<]*)<\/cbc:ID>/i
const EMBEDDED_TEXT_DOCUMENT =
  /<cac:Attachment\b[^>]*>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject\b[^>]*>([^<]*)<\/cbc:EmbeddedDocumentBinaryObject>[\s\S]*?<\/cac:Attachment>/i

/**
 * Extract the signed QR only from the UBL AdditionalDocumentReference whose
 * direct cbc:ID child is QR. PIH and unrelated embedded documents are never
 * eligible fallbacks.
 */
export function extractSignedQrCode(signedXml) {
  if (typeof signedXml !== 'string' || signedXml.length === 0) {
    throw new Error('Signed XML is required for QR extraction')
  }

  const matches = []
  for (const reference of signedXml.matchAll(ADDITIONAL_DOCUMENT_REFERENCE)) {
    const block = reference[1]
    const id = block.match(DIRECT_REFERENCE_ID)?.[1]?.trim()
    if (id !== 'QR') continue

    const payload = block.match(EMBEDDED_TEXT_DOCUMENT)?.[1]?.trim()
    if (!payload) throw new Error('QR document reference has no embedded payload')
    matches.push(payload)
  }

  if (matches.length === 0) throw new Error('Signed XML has no QR document reference')
  if (matches.length > 1) throw new Error('Signed XML has multiple QR document references')
  return matches[0]
}
