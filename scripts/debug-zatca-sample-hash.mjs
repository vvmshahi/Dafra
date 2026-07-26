import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { extractEcPrivateKeyScalar, signZatcaInvoiceHash } from '../supabase/functions/_shared/zatca/signing_core.mjs'
import { buildZatcaPhase2Qr } from '../supabase/functions/_shared/zatca/phase2_qr.mjs'

const OUT_DIR = '.zatca-debug'
const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  sbc: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
}

const FIRST_INVOICE_HASH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function certificatePemFromBody(certPemBody) {
  if (!certPemBody) return ''
  return `-----BEGIN CERTIFICATE-----\n${certPemBody.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
}

function base64ToBytes(value) {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

function sha256Base64(value) {
  return createHash('sha256').update(value, 'utf8').digest('base64')
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest()
}

function escText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;')
}

function derLen(buf, off) {
  const b = buf[off++]
  if (b < 0x80) return [b, off]
  const n = b & 0x7f
  let len = 0
  for (let i = 0; i < n; i++) len = (len << 8) | buf[off++]
  return [len, off]
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function privateKeyFromPem(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bytes = base64ToBytes(b64)
  return extractEcPrivateKeyScalar(bytes)
}

function decodeCertificateToken(token) {
  const trimmed = token.trim()
  if (!trimmed) return { certPemBody: '', certDer: new Uint8Array(0) }
  if (trimmed.includes('BEGIN CERTIFICATE')) {
    const certPemBody = trimmed.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    return { certPemBody, certDer: base64ToBytes(certPemBody) }
  }

  const compact = token.replace(/[\r\n\s]+/g, '')
  const onceBytes = base64ToBytes(compact)
  if (onceBytes[0] === 0x30) return { certPemBody: compact, certDer: onceBytes }

  const onceText = new TextDecoder().decode(onceBytes).trim()
  if (onceText.includes('BEGIN CERTIFICATE')) {
    const certPemBody = onceText.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    return { certPemBody, certDer: base64ToBytes(certPemBody) }
  }

  const certPemBody = onceText.replace(/\s+/g, '')
  return { certPemBody, certDer: base64ToBytes(certPemBody) }
}

function extractCertSerial(certDer) {
  try {
    let off = 0
    off++; const [, o1] = derLen(certDer, off); off = o1
    off++; const [, o2] = derLen(certDer, off); off = o2
    if (certDer[off] === 0xA0) {
      off++; const [vl, o3] = derLen(certDer, off); off = o3 + vl
    }
    if (certDer[off] !== 0x02) return '0'
    off++; const [sl, o4] = derLen(certDer, off)
    const sn = certDer.slice(o4, o4 + sl)
    const hex = bytesToHex(sn).replace(/^0+/, '') || '0'
    return BigInt('0x' + hex).toString()
  } catch {
    return '0'
  }
}

function extractCertSignatureValue(certDer) {
  try {
    let off = 0
    off++; const [, o1] = derLen(certDer, off); off = o1
    off++; const [tbsLen, o2] = derLen(certDer, off); off = o2 + tbsLen
    off++; const [algLen, o3] = derLen(certDer, off); off = o3 + algLen
    if (certDer[off] !== 0x03) return new Uint8Array(0)
    off++; const [sigLen, o4] = derLen(certDer, off)
    return certDer.slice(o4 + 1, o4 + sigLen)
  } catch {
    return new Uint8Array(0)
  }
}

function extractCertIssuerName(certDer) {
  try {
    let off = 0
    off++; const [, o1] = derLen(certDer, off); off = o1
    off++; const [, o2] = derLen(certDer, off); off = o2
    if (certDer[off] === 0xA0) {
      off++; const [vl, o3] = derLen(certDer, off); off = o3 + vl
    }
    off++; const [sl, o4] = derLen(certDer, off); off = o4 + sl
    off++; const [al, o5] = derLen(certDer, off); off = o5 + al
    if (certDer[off] !== 0x30) return ''
    off++; const [issLen, issOff] = derLen(certDer, off)
    const issEnd = issOff + issLen
    const rdns = []
    let pos = issOff
    while (pos < issEnd) {
      if (certDer[pos] !== 0x31) break
      pos++; const [setLen, setOff] = derLen(certDer, pos); pos = setOff + setLen
      let p = setOff
      if (certDer[p] !== 0x30) continue
      p++; const [, seqOff] = derLen(certDer, p); p = seqOff
      if (certDer[p] !== 0x06) continue
      p++; const [oidLen, oidOff] = derLen(certDer, p)
      const oid = parseDerOid(certDer.slice(oidOff, oidOff + oidLen))
      p = oidOff + oidLen
      p++; const [valLen, valOff] = derLen(certDer, p)
      rdns.push(`${oid}=${new TextDecoder().decode(certDer.slice(valOff, valOff + valLen))}`)
    }
    return rdns.reverse().join(', ')
  } catch {
    return ''
  }
}

function parseDerOid(bytes) {
  const hex = bytesToHex(bytes)
  const known = {
    '550403': 'CN',
    '550406': 'C',
    '550407': 'L',
    '550408': 'ST',
    '55040a': 'O',
    '55040b': 'OU',
    '0992268993f22c640119': 'DC',
  }
  return known[hex] ?? `OID:${hex}`
}

function extractCertPublicKeySpki(certDer) {
  try {
    let off = 0
    off++; const [, o1] = derLen(certDer, off); off = o1
    off++; const [, o2] = derLen(certDer, off); off = o2
    if (certDer[off] === 0xA0) {
      off++; const [vl, o3] = derLen(certDer, off); off = o3 + vl
    }
    off++; const [sl, o4] = derLen(certDer, off); off = o4 + sl
    off++; const [al, o5] = derLen(certDer, off); off = o5 + al
    off++; const [il, o6] = derLen(certDer, off); off = o6 + il
    off++; const [vld, o7] = derLen(certDer, off); off = o7 + vld
    off++; const [subl, o8] = derLen(certDer, off); off = o8 + subl
    const spkiStart = off
    off++; const [spkiLen, spkiOff] = derLen(certDer, off)
    return certDer.slice(spkiStart, spkiOff + spkiLen)
  } catch {
    return new Uint8Array(0)
  }
}

function certificatePublicKeyPoint(certPemBody) {
  if (!certPemBody) return new Uint8Array(0)
  const spki = new Uint8Array(createPublicKey(certificatePemFromBody(certPemBody)).export({
    type: 'spki',
    format: 'der',
  }))
  return spki[spki.length - 65] === 0x04 ? spki.slice(-65) : new Uint8Array(0)
}

function privateKeyMatchesCertificate(privateKey, certPemBody) {
  try {
    const derivedPublicKey = secp256k1.getPublicKey(privateKey, false)
    const certPublicKey = certificatePublicKeyPoint(certPemBody)
    return certPublicKey.length === derivedPublicKey.length
      && bytesToHex(certPublicKey) === bytesToHex(derivedPublicKey)
  } catch {
    return false
  }
}

function extractQrTag(qrB64, tag) {
  const bytes = base64ToBytes(qrB64)
  let offset = 0
  while (offset + 2 <= bytes.length) {
    const currentTag = bytes[offset++]
    const length = bytes[offset++]
    const value = bytes.slice(offset, offset + length)
    if (currentTag === tag) return value
    offset += length
  }
  return new Uint8Array(0)
}

function buildSampleData() {
  const issueDate = '2026-06-28'
  const issueTime = '12:00:00'
  return {
    invoiceNumber: 'COMP-SIMPLIFIED-INVOICE-01',
    uuid: '11111111-1111-4111-8111-111111111111',
    issueDate,
    issueTime,
    issueDateTime: `${issueDate}T${issueTime}`,
    invoiceTypeCode: '388',
    counterValue: 1,
    prevInvoiceHash: FIRST_INVOICE_HASH,
    sellerName: 'ZATCA Debug Seller',
    sellerVat: '300000000000003',
    sellerCrn: '1010101000',
    sellerAddress: {
      street: 'King Fahd Road',
      buildingNo: '1234',
      city: 'Riyadh',
      postalCode: '12345',
      district: 'Al Olaya',
      countryCode: 'SA',
    },
    subtotal: 100,
    discountTotal: 0,
    taxableAmount: 100,
    taxAmount: 15,
    totalAmount: 115,
    lineNetAmt: 100,
    lineTaxAmount: 15,
    lineTotal: 115,
    qrCode: '',
  }
}

function buildInvoice(data) {
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="${NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ext="${NS.ext}" xmlns:sig="${NS.sig}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}" xmlns:ds="${NS.ds}" xmlns:xades="${NS.xades}"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures><sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature Id="signature"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/></ds:SignedInfo><ds:SignatureValue></ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate></ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><cbc:ProfileID>reporting:1.0</cbc:ProfileID><cbc:ID>${data.invoiceNumber}</cbc:ID><cbc:UUID>${data.uuid}</cbc:UUID><cbc:IssueDate>${data.issueDate}</cbc:IssueDate><cbc:IssueTime>${data.issueTime}</cbc:IssueTime><cbc:InvoiceTypeCode name="0200000">${data.invoiceTypeCode}</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode><cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>${data.counterValue}</cbc:UUID></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${data.prevInvoiceHash}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${data.qrCode}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference><cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature><cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="CRN">${data.sellerCrn}</cbc:ID></cac:PartyIdentification><cac:PostalAddress><cbc:StreetName>${data.sellerAddress.street}</cbc:StreetName><cbc:BuildingNumber>${data.sellerAddress.buildingNo}</cbc:BuildingNumber><cbc:CitySubdivisionName>${data.sellerAddress.district}</cbc:CitySubdivisionName><cbc:CityName>${data.sellerAddress.city}</cbc:CityName><cbc:PostalZone>${data.sellerAddress.postalCode}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${data.sellerAddress.countryCode}</cbc:IdentificationCode></cac:Country></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>${data.sellerVat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>${data.sellerName}</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty></cac:AccountingCustomerParty><cac:PaymentMeans><cbc:PaymentMeansCode>10</cbc:PaymentMeansCode></cac:PaymentMeans><cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason><cbc:Amount currencyID="SAR">0.00</cbc:Amount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:AllowanceCharge><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount></cac:TaxTotal><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="SAR">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="SAR">100.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="SAR">100.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="SAR">115.00</cbc:TaxInclusiveAmount><cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount><cbc:PayableAmount currencyID="SAR">115.00</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="PCE">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="SAR">100.00</cbc:LineExtensionAmount><cac:TaxTotal><cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount><cbc:RoundingAmount currencyID="SAR">115.00</cbc:RoundingAmount></cac:TaxTotal><cac:Item><cbc:Name>Compliance sample item</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>15.00</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="SAR">100.00</cbc:PriceAmount><cbc:BaseQuantity unitCode="PCE">1</cbc:BaseQuantity></cac:Price></cac:InvoiceLine></Invoice>`
}

function rootWithC14nNamespaces(xml) {
  return xml.replace(
    /<Invoice xmlns="[^"]+" xmlns:cac="[^"]+" xmlns:cbc="[^"]+" xmlns:ext="[^"]+" xmlns:sig="[^"]+" xmlns:sac="[^"]+" xmlns:sbc="[^"]+" xmlns:ds="[^"]+" xmlns:xades="[^"]+">/,
    `<Invoice xmlns="${NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}" xmlns:sig="${NS.sig}" xmlns:xades="${NS.xades}">`,
  )
}

function canonicalizeInvoiceContent(xml) {
  return rootWithC14nNamespaces(xml)
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, '')
}

function computeInvoiceHash(xml) {
  return sha256Base64(canonicalizeInvoiceContent(xml))
}

function buildSignedProperties(signingTime, certDigest, issuerDn, serialNumber) {
  const indent = n => '\n' + ' '.repeat(n)
  return `<xades:SignedProperties Id="xadesSignedProperties">`
    + indent(36) + `<xades:SignedSignatureProperties>`
    + indent(40) + `<xades:SigningTime>${escText(signingTime)}</xades:SigningTime>`
    + indent(40) + `<xades:SigningCertificate>`
    + indent(44) + `<xades:Cert>`
    + indent(48) + `<xades:CertDigest>`
    + indent(52) + `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`
    + indent(52) + `<ds:DigestValue>${escText(certDigest)}</ds:DigestValue>`
    + indent(48) + `</xades:CertDigest>`
    + indent(48) + `<xades:IssuerSerial>`
    + indent(52) + `<ds:X509IssuerName>${escText(issuerDn)}</ds:X509IssuerName>`
    + indent(52) + `<ds:X509SerialNumber>${escText(serialNumber)}</ds:X509SerialNumber>`
    + indent(48) + `</xades:IssuerSerial>`
    + indent(44) + `</xades:Cert>`
    + indent(40) + `</xades:SigningCertificate>`
    + indent(36) + `</xades:SignedSignatureProperties>`
    + indent(32) + `</xades:SignedProperties>`
}

function toSignedPropsHashInput(sp) {
  return sp
    .replace('<xades:SignedProperties Id="xadesSignedProperties">',
      '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">')
    .replace('<ds:DigestMethod Algorithm=',
      '<ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm=')
    .replace('<ds:DigestValue>',
      '<ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">')
    .replace('<ds:X509IssuerName>',
      '<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">')
    .replace('<ds:X509SerialNumber>',
      '<ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">')
}

function buildSignedInfo(invoiceDigest, signedPropsDigest) {
  return `<ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`
}

function buildSignedInfoCanonical(invoiceDigest, signedPropsDigest) {
  return '<ds:SignedInfo>'
    + '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>'
    + '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>'
    + '<ds:Reference Id="invoiceSignedData" URI="">'
    + '<ds:Transforms>'
    + '<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform>'
    + '<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform>'
    + `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform>`
    + '<ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>'
    + '</ds:Transforms>'
    + '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>'
    + `<ds:DigestValue>${escText(invoiceDigest)}</ds:DigestValue>`
    + '</ds:Reference>'
    + '<ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">'
    + '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>'
    + `<ds:DigestValue>${escText(signedPropsDigest)}</ds:DigestValue>`
    + '</ds:Reference>'
    + '</ds:SignedInfo>'
}

function buildXadesBlock(invoiceDigest, signedPropsDigest, sigValue, certPemBody, issuerDn, serialNumber, signingTime, certDigest) {
  const signedInfo = buildSignedInfo(invoiceDigest, signedPropsDigest)
  const signedProps = buildSignedProperties(signingTime, certDigest, issuerDn, serialNumber)
  return `<sig:UBLDocumentSignatures xmlns:sig="${NS.sig}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}"><sac:SignatureInformation><cbc:ID xmlns:cbc="${NS.cbc}">urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="${NS.ds}" Id="signature">${signedInfo}<ds:SignatureValue>${sigValue}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certPemBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${NS.xades}" Target="signature">${signedProps}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures>`
}

function signInvoice(xml, privateKey, certificate, sampleTimestamp) {
  const { certPemBody, certDer } = decodeCertificateToken(certificate)
  const serialNumber = extractCertSerial(certDer)
  const issuerName = extractCertIssuerName(certDer)
  const certSigValue = extractCertSignatureValue(certDer)
  const pubKeySpki = extractCertPublicKeySpki(certDer)
  const certDigestB64 = bytesToBase64(Buffer.from(bytesToHex(sha256Bytes(Buffer.from(certPemBody, 'utf8'))), 'utf8'))
  const invoiceHash = computeInvoiceHash(xml)
  const signingTime = sampleTimestamp
  const signedPropsXml = buildSignedProperties(signingTime, certDigestB64, issuerName, serialNumber)
  const signedPropsB64 = bytesToBase64(Buffer.from(bytesToHex(sha256Bytes(Buffer.from(toSignedPropsHashInput(signedPropsXml), 'utf8'))), 'utf8'))
  const signedInfoCanon = buildSignedInfoCanonical(invoiceHash, signedPropsB64)
  const {
    signatureInput,
    signatureInputKind,
    signatureDerBytes: sigDerBytes,
    signatureValueBase64: sigValueB64,
  } = signZatcaInvoiceHash(invoiceHash, privateKey, secp256k1)
  const signatureVerifiesInvoiceHash = certPemBody ? verifySignature(
    'sha256',
    Buffer.from(signatureInput),
    createPublicKey(certificatePemFromBody(certPemBody)),
    Buffer.from(sigValueB64, 'base64'),
  ) : false
  const xadesBlock = buildXadesBlock(invoiceHash, signedPropsB64, sigValueB64, certPemBody, issuerName, serialNumber, signingTime, certDigestB64)
  let signedXml = xml.replace(
    /<ext:ExtensionContent>[\s\S]*?<\/ext:ExtensionContent>/,
    `<ext:ExtensionContent>${xadesBlock}</ext:ExtensionContent>`,
  )
  const qrCode = buildZatcaPhase2Qr({
    sellerName: 'ZATCA Debug Seller',
    vatNumber: '300000000000003',
    timestamp: sampleTimestamp,
    totalAmount: 115,
    vatAmount: 15,
    invoiceHashBase64: invoiceHash,
    signatureValueBase64: sigValueB64,
    publicKeySpki: pubKeySpki,
    certificateSignatureDer: certSigValue,
  })
  signedXml = signedXml.replace(
    /(<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)([^<]*)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
    `$1${qrCode}$3`,
  )
  return {
    signedXml,
    invoiceHash,
    qrCode,
    signedInfoCanon,
    sigValueB64,
    signatureInputKind,
    signatureInputSha256Base64: bytesToBase64(sha256Bytes(Buffer.from(signatureInput))),
    signatureDerLength: sigDerBytes.length,
    privateKeyMatchesCertificatePublicKey: privateKeyMatchesCertificate(privateKey, certPemBody),
    signatureVerifiesInvoiceHash,
  }
}

function extractDigestValues(xml) {
  return Array.from(xml.matchAll(/<ds:DigestValue[^>]*>([^<]*)<\/ds:DigestValue>/g), match => match[1])
}

function verifyExtractedSignedInfo(signedXml, signedInfo) {
  const certBody = (signedXml.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/) ?? [])[1] ?? ''
  const sigValue = (signedXml.match(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/) ?? [])[1] ?? ''
  if (!certBody || !sigValue || !signedInfo) return false
  return verifySignature(
    'sha256',
    Buffer.from(signedInfo, 'utf8'),
    createPublicKey(certificatePemFromBody(certBody)),
    Buffer.from(sigValue, 'base64'),
  )
}

function preview(value) {
  return {
    length: value.length,
    start: value.slice(0, 180),
    end: value.slice(-180),
  }
}

async function loadInputs() {
  const privateKeyPath = argValue('--private-key') ?? process.env.ZATCA_DEBUG_PRIVATE_KEY_PEM_FILE
  const certificatePath = argValue('--certificate') ?? process.env.ZATCA_DEBUG_CERTIFICATE_FILE
  if (privateKeyPath && certificatePath) {
    return {
      mode: 'provided-local-files',
      privateKey: privateKeyFromPem(await readFile(privateKeyPath, 'utf8')),
      certificate: await readFile(certificatePath, 'utf8'),
    }
  }

  const privateKey = new Uint8Array(32)
  privateKey[31] = 1
  return {
    mode: 'synthetic-debug-only',
    privateKey,
    certificate: '',
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const inputs = await loadInputs()
  const sampleData = buildSampleData()
  const unsignedXml = buildInvoice(sampleData)
  const {
    signedXml,
    invoiceHash,
    qrCode,
    signedInfoCanon,
    sigValueB64,
    signatureInputKind,
    signatureInputSha256Base64,
    signatureDerLength,
    privateKeyMatchesCertificatePublicKey,
    signatureVerifiesInvoiceHash,
  } =
    signInvoice(unsignedXml, inputs.privateKey, inputs.certificate, sampleData.issueDateTime)
  const transformedUnsigned = canonicalizeInvoiceContent(unsignedXml)
  const transformedSigned = canonicalizeInvoiceContent(signedXml)
  const finalSignedXmlHash = sha256Base64(signedXml)
  const digestValues = extractDigestValues(signedXml)
  const qrHashBytes = extractQrTag(qrCode, 0x06)
  const qrHashText = new TextDecoder().decode(qrHashBytes)
  const qrHashRawBase64 = bytesToBase64(qrHashBytes)

  await writeFile(`${OUT_DIR}/simplified_invoice.unsigned.xml`, unsignedXml)
  await writeFile(`${OUT_DIR}/simplified_invoice.signed.xml`, signedXml)
  await writeFile(`${OUT_DIR}/simplified_invoice.transformed.c14n.xml`, transformedSigned)
  const signedInfoFromCode = signedInfoCanon
  const signedInfoRawFromXml = (signedXml.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/) ?? [])[0] ?? ''
  const signedInfoExtractedFromXml = (execFileSync('xmllint', ['--c14n11', `${OUT_DIR}/simplified_invoice.signed.xml`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }).match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/) ?? [])[0] ?? ''
  const signedInfoFromCodeHash = sha256Base64(signedInfoFromCode)
  const signedInfoExtractedFromXmlHash = sha256Base64(signedInfoExtractedFromXml)
  const signatureVerifiesExtractedSignedInfo = verifyExtractedSignedInfo(signedXml, signedInfoExtractedFromXml)
  const signatureVerifySummary = {
    signatureInputKind,
    canonicalizationMethod: 'http://www.w3.org/2006/12/xml-c14n11',
    signatureMethod: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
    signatureFormat: 'DER',
    signatureDerLength,
    signatureDerBase64: sigValueB64,
    invoiceHash,
    signatureInputSha256Base64,
    privateKeyMatchesCertificatePublicKey,
    verifiesOverDecodedInvoiceHashBytes: signatureVerifiesInvoiceHash,
    verifiesOverCanonicalSignedInfo: signatureVerifiesExtractedSignedInfo,
    signedInfoFromCodeHash,
    signedInfoExtractedFromXmlHash,
    signedInfoHashesEqual: signedInfoFromCodeHash === signedInfoExtractedFromXmlHash,
  }
  await writeFile(`${OUT_DIR}/signed-info.xml`, signedInfoRawFromXml || signedInfoFromCode)
  await writeFile(`${OUT_DIR}/signed-info.c14n.txt`, signedInfoExtractedFromXml || signedInfoFromCode)
  await writeFile(`${OUT_DIR}/signature.der.base64.txt`, `${sigValueB64}\n`)
  await writeFile(`${OUT_DIR}/signature.verify.summary.json`, JSON.stringify(signatureVerifySummary, null, 2))
  await writeFile(`${OUT_DIR}/simplified_invoice.summary.json`, JSON.stringify({
    mode: inputs.mode,
    apiInvoiceHash: invoiceHash,
    transformedUnsignedHash: sha256Base64(transformedUnsigned),
    transformedSignedHash: sha256Base64(transformedSigned),
    finalSignedXmlHash,
    qrHashText,
    qrHashRawBase64,
    xadesInvoiceDigest: digestValues[0] ?? null,
    xadesSignedPropertiesDigest: digestValues[1] ?? null,
    signedInfoFromCodeHash,
    signedInfoExtractedFromXmlHash,
    signedInfoHashesEqual: signedInfoFromCodeHash === signedInfoExtractedFromXmlHash,
    signatureInputKind,
    signatureFormat: 'DER',
    signatureDerLength,
    privateKeyMatchesCertificatePublicKey,
    signatureVerifiesInvoiceHash,
    signatureVerifiesExtractedSignedInfo,
    matches: {
      apiEqualsTransformedUnsigned: invoiceHash === sha256Base64(transformedUnsigned),
      apiEqualsTransformedSigned: invoiceHash === sha256Base64(transformedSigned),
      apiEqualsFinalSignedXml: invoiceHash === finalSignedXmlHash,
      apiEqualsQrHashText: invoiceHash === qrHashText,
      apiEqualsXadesInvoiceDigest: invoiceHash === (digestValues[0] ?? null),
    },
  }, null, 2))

  console.log(JSON.stringify({
    mode: inputs.mode,
    artifacts: OUT_DIR,
    apiInvoiceHash: invoiceHash,
    transformedUnsignedHash: sha256Base64(transformedUnsigned),
    transformedSignedHash: sha256Base64(transformedSigned),
    finalSignedXmlHash,
    qrHashText,
    qrHashRawBase64,
    xadesInvoiceDigest: digestValues[0] ?? null,
    xadesSignedPropertiesDigest: digestValues[1] ?? null,
    signedInfoFromCodeHash,
    signedInfoExtractedFromXmlHash,
    signedInfoHashesEqual: signedInfoFromCodeHash === signedInfoExtractedFromXmlHash,
    signatureInputKind,
    signatureFormat: 'DER',
    signatureDerLength,
    privateKeyMatchesCertificatePublicKey,
    signatureVerifiesInvoiceHash,
    signatureVerifiesExtractedSignedInfo,
    matches: {
      apiEqualsTransformedUnsigned: invoiceHash === sha256Base64(transformedUnsigned),
      apiEqualsTransformedSigned: invoiceHash === sha256Base64(transformedSigned),
      apiEqualsFinalSignedXml: invoiceHash === finalSignedXmlHash,
      apiEqualsQrHashText: invoiceHash === qrHashText,
      apiEqualsXadesInvoiceDigest: invoiceHash === (digestValues[0] ?? null),
    },
    transformedCanonicalPreview: preview(transformedSigned),
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
