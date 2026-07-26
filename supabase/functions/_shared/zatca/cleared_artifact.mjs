/**
 * Decode and validate a ZATCA standard-clearance artifact. This module is kept
 * runtime-neutral so the identical parser can be exercised by Node fixtures
 * and used by the Deno Edge Function.
 */
export async function parseZatcaClearedInvoice({
  clearedInvoice,
  expectedUuid,
  expectedInvoiceNumber,
  provisionalHash,
  computeHash,
}) {
  if (typeof clearedInvoice !== 'string' || clearedInvoice.length < 16 || clearedInvoice.length > 8_000_000) {
    throw new Error('ZATCA clearance response did not contain a valid clearedInvoice')
  }
  let binary
  try { binary = atob(clearedInvoice) } catch { throw new Error('ZATCA clearedInvoice is not valid base64') }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  if (!xml.startsWith('<') || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('ZATCA clearedInvoice is not safe UBL XML')
  }

  const value = (text, pattern, label) => {
    const matched = text.match(pattern)?.[1]?.trim()
    if (!matched) throw new Error(`ZATCA clearedInvoice is missing ${label}`)
    return matched
  }
  const identityXml = xml.replace(/<ext:UBLExtensions(?:\s[^>]*)?>[\s\S]*?<\/ext:UBLExtensions>/i, '')
  const uuid = value(identityXml, /<cbc:UUID(?:\s[^>]*)?>([^<]+)<\/cbc:UUID>/i, 'invoice UUID')
  const invoiceNumber = value(identityXml, /<cbc:ID(?:\s[^>]*)?>([^<]+)<\/cbc:ID>/i, 'invoice number')
  if (uuid !== expectedUuid || invoiceNumber !== expectedInvoiceNumber) {
    throw new Error('ZATCA clearedInvoice identity does not match the submitted invoice')
  }

  const qr = value(
    xml,
    /<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>[\s\S]*?<\/cac:AdditionalDocumentReference>/i,
    'final QR',
  )
  const signature = value(xml, /<ds:SignatureValue(?:\s[^>]*)?>([^<]+)<\/ds:SignatureValue>/i, 'clearance signature')
  const hash = await computeHash(xml)
  if (typeof hash !== 'string' || !hash) throw new Error('Unable to hash ZATCA clearedInvoice')

  return {
    xml, hash, signature, qr,
    metadata: { uuid, invoiceNumber, provisionalHash, clearedHash: hash },
  }
}
