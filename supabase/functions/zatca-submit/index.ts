/**
 * zatca-submit Edge Function — Full ZATCA Phase 2 pipeline (server-side Deno)
 *
 * Receives { invoiceId } from browser, then does everything:
 *   1. Fetch invoice + branch + active cert from DB
 *   2. Decrypt private key (AES-256-GCM / PBKDF2)
 *   3. Build UBL XML
 *   4. Sign (XAdES, secp256k1)
 *   5. Submit to ZATCA reporting/clearance API
 *   6. Update invoice status in DB
 *   7. Queue for retry on failure
 *
 * Replaces browser-side node-forge / xmlbuilder2 usage (polyfill conflicts).
 * All npm deps (node-forge, xmlbuilder2, @noble/curves) work natively in Deno.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create as xmlCreate } from 'npm:xmlbuilder2'
import { secp256k1 } from 'npm:@noble/curves/secp256k1'
import forge from 'npm:node-forge'
import { DOMParser } from 'npm:@xmldom/xmldom'

// ── Constants ────────────────────────────────────────────────────────────────

const ZATCA_URLS: Record<string, string> = {
  sandbox:    'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
}

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Must match VITE_ZATCA_KEY_SECRET set when the private key was encrypted in the browser
const APP_SECRET = Deno.env.get('ZATCA_KEY_SECRET') ?? 'dafra-zatca-local-secret'

const FIRST_INVOICE_HASH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

// Singleton DOMParser for C14N (xmldom)
const DOM_PARSER = new DOMParser()

// ── Crypto utilities ─────────────────────────────────────────────────────────

async function deriveAesKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('dafra-zatca-v1'), iterations: 100_000, hash: 'SHA-256' },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

async function decryptPrivateKey(stored: string): Promise<Uint8Array> {
  const [ivB64, encB64] = stored.split(':')
  const iv  = Uint8Array.from(atob(ivB64),  c => c.charCodeAt(0))
  const enc = Uint8Array.from(atob(encB64), c => c.charCodeAt(0))
  const key = await deriveAesKey()
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc)
  const pem = new TextDecoder().decode(dec)
  // PEM label "EC PRIVATE KEY" wraps raw 32-byte secp256k1 secret key
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
}
async function sha256Bytes(input: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', input)
}

function p1363ToDer(sig: Uint8Array): Uint8Array {
  const r = sig.slice(0, 32), s = sig.slice(32, 64)
  const rDer = derInt(r), sDer = derInt(s)
  return new Uint8Array([0x30, rDer.length + sDer.length, ...rDer, ...sDer])
}
function derInt(n: Uint8Array): Uint8Array {
  let i = 0; while (i < n.length - 1 && n[i] === 0) i++
  const t = n.slice(i)
  const v = (t[0] & 0x80) ? new Uint8Array([0, ...t]) : t
  return new Uint8Array([0x02, v.length, ...v])
}

// ── Certificate parsing (ASN.1, secp256k1-safe) ───────────────────────────────

function parseCertificateDer(certDer: Uint8Array): { serialNumber: string; spkiBytes: Uint8Array } {
  const certAsn1 = forge.asn1.fromDer(
    forge.util.createBuffer(String.fromCharCode(...certDer)), { strict: false } as any,
  )
  const tbs    = (certAsn1.value as forge.asn1.Asn1[])[0]
  const fields = tbs.value as forge.asn1.Asn1[]
  let idx = 0
  if (fields[0]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC) idx++
  const serialBytes = fields[idx++].value as string
  let serialHex = Array.from(serialBytes, c => ('0' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  serialHex = serialHex.replace(/^0+/, '') || '0'
  idx += 4  // skip signatureAlgorithm, issuer, validity, subject
  const spkiDerStr = forge.asn1.toDer(fields[idx]).getBytes()
  const spkiBytes  = new Uint8Array(Array.from(spkiDerStr, c => c.charCodeAt(0)))
  return { serialNumber: serialHex, spkiBytes }
}

function extractEcPublicKeyFromSpki(spkiBytes: Uint8Array): Uint8Array {
  try {
    const spkiAsn1 = forge.asn1.fromDer(
      forge.util.createBuffer(String.fromCharCode(...spkiBytes)), { strict: false } as any,
    )
    const bitStr = (spkiAsn1.value as forge.asn1.Asn1[])[1]
    const raw = ((bitStr as any).bitStringContents as string | undefined)
             ?? (typeof bitStr.value === 'string' ? bitStr.value : '')
    if (raw.length < 2) return new Uint8Array(65)
    return new Uint8Array(Array.from(raw.slice(1), (c: string) => c.charCodeAt(0)))
  } catch { return new Uint8Array(65) }
}

// ── XML builder (ported from xml.ts) ─────────────────────────────────────────

const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac:     'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc:     'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext:     'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig:     'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac:     'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  sbc:     'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
  ds:      'http://www.w3.org/2000/09/xmldsig#',
  xades:   'http://uri.etsi.org/01903/v1.3.2#',
}

function fmt(n: number): string { return n.toFixed(2) }

function buildInvoice(data: any, opts: any): string {
  const root = (xmlCreate({ version: '1.0', encoding: 'UTF-8' }) as any)
    .ele(NS.invoice, 'Invoice')
    .att('xmlns:cac', NS.cac).att('xmlns:cbc', NS.cbc).att('xmlns:ext', NS.ext)
    .att('xmlns:sig', NS.sig).att('xmlns:sac', NS.sac).att('xmlns:sbc', NS.sbc)
    .att('xmlns:ds', NS.ds).att('xmlns:xades', NS.xades)

  const ublExt = root.ele(NS.ext, 'UBLExtensions').ele(NS.ext, 'UBLExtension')
  ublExt.ele(NS.ext, 'ExtensionURI').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
  const extContent = ublExt.ele(NS.ext, 'ExtensionContent')
  const ublDocSig  = extContent.ele(NS.sig, 'UBLDocumentSignatures')
  const sigInfo    = ublDocSig.ele(NS.sac, 'SignatureInformation')
  sigInfo.ele(NS.cbc, 'ID').txt('urn:oasis:names:specification:ubl:signature:1')
  sigInfo.ele(NS.sbc, 'ReferencedSignatureID').txt('urn:oasis:names:specification:ubl:signature:Invoice')
  const dsSig     = sigInfo.ele(NS.ds, 'Signature').att('Id', 'signature')
  const dsSigInfo = dsSig.ele(NS.ds, 'SignedInfo')
  dsSigInfo.ele(NS.ds, 'CanonicalizationMethod').att('Algorithm', 'http://www.w3.org/2006/12/xml-c14n11')
  dsSigInfo.ele(NS.ds, 'SignatureMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256')
  const dsRef1   = dsSigInfo.ele(NS.ds, 'Reference').att('Id', 'invoiceSignedData').att('URI', '')
  const dsXforms = dsRef1.ele(NS.ds, 'Transforms')
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/TR/1999/REC-xpath-19991116')
    .ele(NS.ds, 'XPath').txt('not(//ancestor-or-self::ext:UBLExtensions)')
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/TR/1999/REC-xpath-19991116')
    .ele(NS.ds, 'XPath').txt('not(//ancestor-or-self::cac:Signature)')
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/TR/1999/REC-xpath-19991116')
    .ele(NS.ds, 'XPath').txt("not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])")
  dsXforms.ele(NS.ds, 'Transform').att('Algorithm', 'http://www.w3.org/2006/12/xml-c14n11')
  dsRef1.ele(NS.ds, 'DigestMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmlenc#sha256')
  dsRef1.ele(NS.ds, 'DigestValue').txt('')
  const dsRef2 = dsSigInfo.ele(NS.ds, 'Reference')
    .att('Type', 'http://www.w3.org/2000/09/xmldsig#SignatureProperties')
    .att('URI', '#xadesSignedProperties')
  dsRef2.ele(NS.ds, 'DigestMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmlenc#sha256')
  dsRef2.ele(NS.ds, 'DigestValue').txt('')
  dsSig.ele(NS.ds, 'SignatureValue').txt('')
  dsSig.ele(NS.ds, 'KeyInfo').ele(NS.ds, 'X509Data').ele(NS.ds, 'X509Certificate').txt('')
  const qp          = dsSig.ele(NS.ds, 'Object').ele(NS.xades, 'QualifyingProperties').att('Target', 'signature')
  const signedProps = qp.ele(NS.xades, 'SignedProperties').att('Id', 'xadesSignedProperties')
  const ssp         = signedProps.ele(NS.xades, 'SignedSignatureProperties')
  ssp.ele(NS.xades, 'SigningTime').txt(`${data.issueDate}T${data.issueTime}Z`)
  const certNode = ssp.ele(NS.xades, 'SigningCertificate').ele(NS.xades, 'Cert')
  const certDig  = certNode.ele(NS.xades, 'CertDigest')
  certDig.ele(NS.ds, 'DigestMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmlenc#sha256')
  certDig.ele(NS.ds, 'DigestValue').txt('')
  const issuer = certNode.ele(NS.xades, 'IssuerSerial')
  issuer.ele(NS.ds, 'X509IssuerName').txt('')
  issuer.ele(NS.ds, 'X509SerialNumber').txt('0')

  root.ele(NS.cbc, 'ProfileID').txt(opts.profileId)
  root.ele(NS.cbc, 'ID').txt(data.invoiceNumber)
  root.ele(NS.cbc, 'UUID').txt(data.uuid)
  root.ele(NS.cbc, 'IssueDate').txt(data.issueDate)
  root.ele(NS.cbc, 'IssueTime').txt(data.issueTime)
  root.ele(NS.cbc, 'InvoiceTypeCode').att('name', opts.typeCodeName).txt('388')
  root.ele(NS.cbc, 'DocumentCurrencyCode').txt('SAR')
  root.ele(NS.cbc, 'TaxCurrencyCode').txt('SAR')

  const icv = root.ele(NS.cac, 'AdditionalDocumentReference')
  icv.ele(NS.cbc, 'ID').txt('ICV')
  icv.ele(NS.cbc, 'UUID').txt(String(data.counterValue))

  const pih = root.ele(NS.cac, 'AdditionalDocumentReference')
  pih.ele(NS.cbc, 'ID').txt('PIH')
  pih.ele(NS.cac, 'Attachment').ele(NS.cbc, 'EmbeddedDocumentBinaryObject')
    .att('mimeCode', 'text/plain').txt(data.prevInvoiceHash)

  const qr = root.ele(NS.cac, 'AdditionalDocumentReference')
  qr.ele(NS.cbc, 'ID').txt('QR')
  qr.ele(NS.cac, 'Attachment').ele(NS.cbc, 'EmbeddedDocumentBinaryObject')
    .att('mimeCode', 'text/plain').txt(data.qrCode ?? '')

  if (opts.includeSignature) {
    const sig = root.ele(NS.cac, 'Signature')
    sig.ele(NS.cbc, 'ID').txt('urn:oasis:names:specification:ubl:signature:Invoice')
    sig.ele(NS.cbc, 'SignatureMethod').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
  }

  const supplier = root.ele(NS.cac, 'AccountingSupplierParty').ele(NS.cac, 'Party')
  supplier.ele(NS.cac, 'PartyIdentification').ele(NS.cbc, 'ID')
    .att('schemeID', 'CRN').txt(data.sellerCrn || '0000000000')
  const sellerAddr = supplier.ele(NS.cac, 'PostalAddress')
  sellerAddr.ele(NS.cbc, 'StreetName').txt(data.sellerAddress.street)
  sellerAddr.ele(NS.cbc, 'BuildingNumber').txt(data.sellerAddress.buildingNo)
  sellerAddr.ele(NS.cbc, 'CitySubdivisionName').txt(data.sellerAddress.district)
  sellerAddr.ele(NS.cbc, 'CityName').txt(data.sellerAddress.city)
  sellerAddr.ele(NS.cbc, 'PostalZone').txt(data.sellerAddress.postalCode)
  sellerAddr.ele(NS.cac, 'Country').ele(NS.cbc, 'IdentificationCode').txt(data.sellerAddress.countryCode)
  const sellerTax = supplier.ele(NS.cac, 'PartyTaxScheme')
  sellerTax.ele(NS.cbc, 'CompanyID').txt(data.sellerVat)
  sellerTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
  supplier.ele(NS.cac, 'PartyLegalEntity').ele(NS.cbc, 'RegistrationName').txt(data.sellerName)

  const customerParty = root.ele(NS.cac, 'AccountingCustomerParty')
  if (opts.requireBuyer && data.buyer) {
    const customer = customerParty.ele(NS.cac, 'Party')
    if (data.buyer.vatNumber) {
      const buyerTax = customer.ele(NS.cac, 'PartyTaxScheme')
      buyerTax.ele(NS.cbc, 'CompanyID').txt(data.buyer.vatNumber)
      buyerTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
    }
    customer.ele(NS.cac, 'PartyLegalEntity').ele(NS.cbc, 'RegistrationName').txt(data.buyer.name)
  }

  root.ele(NS.cac, 'PaymentMeans').ele(NS.cbc, 'PaymentMeansCode').txt(data.paymentMeansCode ?? '10')

  const headerAllowance = root.ele(NS.cac, 'AllowanceCharge')
  headerAllowance.ele(NS.cbc, 'ChargeIndicator').txt('false')
  headerAllowance.ele(NS.cbc, 'AllowanceChargeReason').txt('discount')
  headerAllowance.ele(NS.cbc, 'Amount').att('currencyID', 'SAR').txt(fmt(data.discountTotal))
  const headerTaxCat = headerAllowance.ele(NS.cac, 'TaxCategory')
  headerTaxCat.ele(NS.cbc, 'ID').txt('S')
  headerTaxCat.ele(NS.cbc, 'Percent').txt('15')
  headerTaxCat.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')

  root.ele(NS.cac, 'TaxTotal').ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(data.taxAmount))
  const taxTotal = root.ele(NS.cac, 'TaxTotal')
  taxTotal.ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(data.taxAmount))
  for (const bd of data.taxBreakdowns) {
    const sub = taxTotal.ele(NS.cac, 'TaxSubtotal')
    sub.ele(NS.cbc, 'TaxableAmount').att('currencyID', 'SAR').txt(fmt(bd.taxableAmount))
    sub.ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(bd.taxAmount))
    const cat = sub.ele(NS.cac, 'TaxCategory')
    cat.ele(NS.cbc, 'ID').txt(bd.vatCategoryCode)
    cat.ele(NS.cbc, 'Percent').txt((bd.taxRate * 100).toFixed(2))
    if (bd.exemptionCode) cat.ele(NS.cbc, 'TaxExemptionReasonCode').txt(bd.exemptionCode)
    cat.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
  }

  const lmt = root.ele(NS.cac, 'LegalMonetaryTotal')
  lmt.ele(NS.cbc, 'LineExtensionAmount').att('currencyID', 'SAR').txt(fmt(data.subtotal))
  lmt.ele(NS.cbc, 'TaxExclusiveAmount').att('currencyID', 'SAR').txt(fmt(data.taxableAmount))
  lmt.ele(NS.cbc, 'TaxInclusiveAmount').att('currencyID', 'SAR').txt(fmt(data.totalAmount))
  lmt.ele(NS.cbc, 'AllowanceTotalAmount').att('currencyID', 'SAR').txt(fmt(data.discountTotal))
  lmt.ele(NS.cbc, 'PayableAmount').att('currencyID', 'SAR').txt(fmt(data.totalAmount))

  for (const line of data.lines) {
    const il = root.ele(NS.cac, 'InvoiceLine')
    il.ele(NS.cbc, 'ID').txt(String(line.id))
    il.ele(NS.cbc, 'InvoicedQuantity').att('unitCode', 'PCE').txt(String(line.qty))
    il.ele(NS.cbc, 'LineExtensionAmount').att('currencyID', 'SAR').txt(fmt(line.lineNetAmt))
    if (line.discountAmt > 0) {
      const allow = il.ele(NS.cac, 'AllowanceCharge')
      allow.ele(NS.cbc, 'ChargeIndicator').txt('false')
      allow.ele(NS.cbc, 'AllowanceChargeReason').txt('discount')
      allow.ele(NS.cbc, 'Amount').att('currencyID', 'SAR').txt(fmt(line.discountAmt))
    }
    const lineTax = il.ele(NS.cac, 'TaxTotal')
    lineTax.ele(NS.cbc, 'TaxAmount').att('currencyID', 'SAR').txt(fmt(line.taxAmount))
    lineTax.ele(NS.cbc, 'RoundingAmount').att('currencyID', 'SAR').txt(fmt(line.lineTotal))
    const item = il.ele(NS.cac, 'Item')
    item.ele(NS.cbc, 'Name').txt(line.name)
    const itemTax = item.ele(NS.cac, 'ClassifiedTaxCategory')
    itemTax.ele(NS.cbc, 'ID').txt('S')
    itemTax.ele(NS.cbc, 'Percent').txt((line.taxRate * 100).toFixed(2))
    itemTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
    const price = il.ele(NS.cac, 'Price')
    price.ele(NS.cbc, 'PriceAmount').att('currencyID', 'SAR').txt(fmt(line.unitPrice))
    price.ele(NS.cbc, 'BaseQuantity').att('unitCode', 'PCE').txt('1')
  }

  return root.end({ prettyPrint: false }) as string
}

function buildInvoiceXMLData(inv: any, branch: any, items: any[], customer: any, isSimplified: boolean): any {
  const dt = new Date(inv.created_at)
  return {
    invoiceNumber:   inv.invoice_number,
    uuid:            inv.zatca_uuid,
    issueDate:       inv.invoice_date,
    issueTime:       dt.toISOString().slice(11, 19),
    counterValue:    inv.zatca_counter_number ?? 1,
    prevInvoiceHash: inv.zatca_prev_invoice_hash ?? FIRST_INVOICE_HASH,
    sellerName:      branch.business_name,
    sellerNameAr:    branch.business_name_ar ?? branch.business_name,
    sellerVat:       branch.vat_number ?? '',
    sellerCrn:       branch.cr_number ?? undefined,
    sellerAddress: {
      street:      branch.street ?? '',
      buildingNo:  branch.building_number ?? '0000',
      city:        branch.city ?? '',
      postalCode:  branch.postal_code ?? '00000',
      district:    branch.district ?? '',
      countryCode: branch.country || 'SA',
    },
    buyer: !isSimplified && customer
      ? { name: customer.name, vatNumber: customer.vat_number ?? undefined }
      : undefined,
    subtotal:      inv.subtotal,
    discountTotal: inv.discount_amount,
    taxableAmount: inv.taxable_amount,
    taxAmount:     inv.tax_amount,
    totalAmount:   inv.total_amount,
    lines: items.map((it: any, i: number) => ({
      id: i + 1, name: it.name, qty: it.quantity, unitPrice: it.unit_price,
      discountAmt: it.discount_amount, lineNetAmt: it.subtotal,
      taxRate: it.tax_rate, taxAmount: it.tax_amount, lineTotal: it.total,
    })),
    taxBreakdowns: [{
      taxableAmount: inv.taxable_amount, taxAmount: inv.tax_amount,
      vatCategoryCode: 'S', taxRate: 0.15,
    }],
    paymentMeansCode: undefined,
    qrCode: '',
  }
}

// ── QR builder (Phase 1 + Phase 2) ───────────────────────────────────────────

function tlvStr(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  const buf = new Uint8Array(2 + bytes.length)
  buf[0] = tag; buf[1] = bytes.length; buf.set(bytes, 2)
  return buf
}
function tlvBytes(tag: number, bytes: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2 + bytes.length)
  buf[0] = tag; buf[1] = bytes.length; buf.set(bytes, 2)
  return buf
}
function normTs(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z')
}
function concatArrays(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(len); let off = 0
  for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

function buildPhase2QR(
  sellerName: string, vatNumber: string, timestamp: string,
  totalAmount: number, vatAmount: number,
  hashBytes: Uint8Array, sigBytes: Uint8Array, pubKeyBytes: Uint8Array, certDer: Uint8Array,
): string {
  const all = concatArrays(
    tlvStr(0x01, sellerName), tlvStr(0x02, vatNumber),
    tlvStr(0x03, normTs(timestamp)),
    tlvStr(0x04, totalAmount.toFixed(2)), tlvStr(0x05, vatAmount.toFixed(2)),
    tlvBytes(0x06, hashBytes), tlvBytes(0x07, sigBytes),
    tlvBytes(0x08, pubKeyBytes), tlvBytes(0x09, certDer),
  )
  return btoa(String.fromCharCode(...all))
}

// ── C14N11 + XAdES signing ────────────────────────────────────────────────────

function escText(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r/g,'&#xD;')
}
function escAttr(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
          .replace(/\t/g,'&#x9;').replace(/\n/g,'&#xA;').replace(/\r/g,'&#xD;')
}

function c14n(node: any, inherited: Map<string, string> = new Map()): string {
  const localNs = new Map<string, string>()
  const attrs: any[] = []
  for (let i = 0; i < node.attributes.length; i++) attrs.push(node.attributes[i])

  for (const a of attrs) {
    if (a.name === 'xmlns') localNs.set('', a.value)
    else if (a.name.startsWith('xmlns:')) localNs.set(a.name.slice(6), a.value)
  }

  const nsDecls: [string, string][] = []
  const emitNs = (prefix: string, uri: string) => {
    if (inherited.get(prefix) !== uri) nsDecls.push([prefix, uri])
  }

  const elNs = node.namespaceURI ?? ''
  const elPrefix = node.prefix ?? ''
  if (elPrefix === '' && elNs !== (inherited.get('') ?? '')) emitNs('', elNs)
  else if (elPrefix && elNs !== (inherited.get(elPrefix) ?? '')) emitNs(elPrefix, elNs)

  for (const [p, u] of localNs) {
    if (!nsDecls.find(d => d[0] === p)) emitNs(p, u)
  }

  for (const a of attrs) {
    if (a.namespaceURI && a.prefix && !nsDecls.find(d => d[0] === a.prefix)) {
      emitNs(a.prefix, a.namespaceURI)
    }
  }

  nsDecls.sort(([a], [b]) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))

  const regAttrs = attrs
    .filter(a => a.name !== 'xmlns' && !a.name.startsWith('xmlns:'))
    .sort((a, b) => {
      const aNs = a.namespaceURI ?? '', bNs = b.namespaceURI ?? ''
      return aNs !== bNs ? aNs.localeCompare(bNs) : a.localName.localeCompare(b.localName)
    })

  let out = `<${node.tagName}`
  for (const [p, u] of nsDecls) out += ` ${p === '' ? 'xmlns' : `xmlns:${p}`}="${escAttr(u)}"`
  for (const a of regAttrs) out += ` ${a.name}="${escAttr(a.value)}"`
  out += '>'

  const newInherited = new Map(inherited)
  for (const [p, u] of localNs) newInherited.set(p, u)
  for (const [p, u] of nsDecls) newInherited.set(p, u)

  const children: any[] = []
  for (let i = 0; i < node.childNodes.length; i++) children.push(node.childNodes[i])
  for (const child of children) {
    if (child.nodeType === 1) out += c14n(child, newInherited)  // ELEMENT_NODE
    else if (child.nodeType === 3) out += escText(child.textContent ?? '')  // TEXT_NODE
  }

  return out + `</${node.tagName}>`
}

function canonicalizeInvoiceContent(xmlString: string): string {
  const doc: any = DOM_PARSER.parseFromString(xmlString, 'application/xml')

  const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'
  const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
  const EXT = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'

  const ublExts = Array.from(doc.getElementsByTagNameNS(EXT, 'UBLExtensions') as any) as any[]
  for (const el of ublExts) el.parentNode?.removeChild(el)

  const sigs = Array.from(doc.getElementsByTagNameNS(CAC, 'Signature') as any) as any[]
  for (const el of sigs) el.parentNode?.removeChild(el)

  const adrList = Array.from(doc.getElementsByTagNameNS(CAC, 'AdditionalDocumentReference') as any) as any[]
  for (const adr of adrList) {
    const idEl = (adr.getElementsByTagNameNS(CBC, 'ID') as any)[0]
    if (idEl?.textContent === 'QR') { adr.parentNode?.removeChild(adr); break }
  }

  return c14n(doc.documentElement)
}

function buildSignedProperties(signingTime: string, certDigest: string, _issuerDn: string, serialNumber: string): string {
  return `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="xadesSignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certDigest}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${escText(serialNumber)}</ds:X509IssuerName><ds:X509SerialNumber>${serialNumber}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`
}

function buildSignedInfo(invoiceDigest: string, signedPropsDigest: string): string {
  return `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`
}

function buildXadesBlock(
  invoiceDigest: string, signedPropsDigest: string, sigValue: string,
  certPemBody: string, _sp: string, _issuerDn: string, serialNumber: string,
  signingTime: string, certDigest: string,
): string {
  const signedInfo  = buildSignedInfo(invoiceDigest, signedPropsDigest)
  const signedProps = buildSignedProperties(signingTime, certDigest, _issuerDn, serialNumber)
  return `<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="urn:oasis:names:specification:ubl:signature:Invoice">${signedInfo}<ds:SignatureValue>${sigValue}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certPemBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#urn:oasis:names:specification:ubl:signature:Invoice">${signedProps}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures>`
}

async function signInvoice(xmlString: string, secretKey: Uint8Array, certificate: string): Promise<{
  signedXml: string; invoiceHash: string; qrCode: string
}> {
  // Normalize & decode certificate
  const certB64Clean = certificate.replace(/[\r\n\s]+/g, '')
  let certDer: Uint8Array, certPemBody: string
  const certDecoded = atob(certB64Clean)
  if (certDecoded.startsWith('-----BEGIN')) {
    certPemBody = certDecoded.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    certDer = Uint8Array.from(atob(certPemBody), c => c.charCodeAt(0))
  } else {
    certDer = Uint8Array.from(certDecoded, c => c.charCodeAt(0))
    certPemBody = certB64Clean
  }

  const { serialNumber, spkiBytes } = parseCertificateDer(certDer)
  const pubKeyBytes = extractEcPublicKeyFromSpki(spkiBytes)

  const certDigestBuf = await sha256Bytes(certDer)
  const certDigestB64 = btoa(String.fromCharCode(...new Uint8Array(certDigestBuf)))

  const invoiceCanonical = canonicalizeInvoiceContent(xmlString)
  const invoiceDigestBuf = await sha256(invoiceCanonical)
  const invoiceDigestB64 = btoa(String.fromCharCode(...new Uint8Array(invoiceDigestBuf)))
  const invoiceHashB64   = invoiceDigestB64

  const signingTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const signedPropsXml = buildSignedProperties(signingTime, certDigestB64, '', serialNumber)
  const signedPropsBuf = await sha256(signedPropsXml)
  const signedPropsB64 = btoa(String.fromCharCode(...new Uint8Array(signedPropsBuf)))

  const signedInfoXml  = buildSignedInfo(invoiceDigestB64, signedPropsB64)
  const signedInfoBuf  = new TextEncoder().encode(signedInfoXml)
  const sigCompact     = secp256k1.sign(signedInfoBuf, secretKey) as unknown as Uint8Array
  const sigDerBytes    = p1363ToDer(sigCompact)
  const sigValueB64    = btoa(String.fromCharCode(...sigDerBytes))

  const xadesBlock = buildXadesBlock(
    invoiceDigestB64, signedPropsB64, sigValueB64,
    certPemBody, signedPropsXml, '', serialNumber, signingTime, certDigestB64,
  )

  let signedXml = xmlString.replace(
    /<ext:ExtensionContent>\s*<\/ext:ExtensionContent>/,
    `<ext:ExtensionContent>${xadesBlock}</ext:ExtensionContent>`,
  )

  // Extract invoice metadata for QR
  const sellerName  = (signedXml.match(/<cbc:RegistrationName[^>]*>([^<]+)<\/cbc:RegistrationName>/) ?? [])[1] ?? ''
  const vatNumber   = (signedXml.match(/<cac:PartyTaxScheme>[\s\S]*?<cbc:CompanyID>([^<]+)<\/cbc:CompanyID>/) ?? [])[1] ?? ''
  const issueDate   = (signedXml.match(/<cbc:IssueDate[^>]*>([^<]+)<\/cbc:IssueDate>/) ?? [])[1] ?? ''
  const issueTime   = (signedXml.match(/<cbc:IssueTime[^>]*>([^<]+)<\/cbc:IssueTime>/) ?? [])[1] ?? '00:00:00'
  const timestamp   = `${issueDate}T${issueTime}Z`
  const totalAmount = parseFloat((signedXml.match(/<cbc:TaxInclusiveAmount[^>]*>([\d.]+)<\/cbc:TaxInclusiveAmount>/) ?? [])[1] ?? '0')
  const vatAmount   = parseFloat((signedXml.match(/<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/) ?? [])[1] ?? '0')

  const hashBytes = new Uint8Array(await sha256(invoiceCanonical))
  const qrCode = buildPhase2QR(
    sellerName, vatNumber, timestamp, totalAmount, vatAmount,
    hashBytes, sigDerBytes, pubKeyBytes, certDer,
  )

  signedXml = signedXml.replace(
    /(<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)([^<]*)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
    `$1${qrCode}$3`,
  )

  return { signedXml, invoiceHash: invoiceHashB64, qrCode }
}

// ── Retry queue ───────────────────────────────────────────────────────────────

async function queueForRetry(db: any, invoiceId: string, branchId: string, tenantId: string, reason: string): Promise<void> {
  await db.from('sync_queue').insert([{
    tenant_id: tenantId, branch_id: branchId, invoice_id: invoiceId,
    action: 'zatca_submit', payload: { reason }, status: 'pending', max_attempts: 5,
  }])
}

// ── Main invoice processor ────────────────────────────────────────────────────

async function processInvoice(db: any, invoiceId: string): Promise<{ invoiceStatus: string }> {
  console.log('[zatca-submit] processInvoice:', invoiceId)

  const { data: inv, error: invErr } = await db
    .from('invoices')
    .select(`id, invoice_number, zatca_uuid, zatca_invoice_type, invoice_date, created_at,
      zatca_counter_number, zatca_prev_invoice_hash, zatca_status,
      subtotal, discount_amount, taxable_amount, tax_amount, total_amount,
      branch_id, tenant_id, customer_id,
      invoice_items(id, name, quantity, unit_price, discount_amount, subtotal, tax_rate, tax_amount, total),
      customers(name, vat_number)`)
    .eq('id', invoiceId).single()

  if (invErr || !inv) {
    console.error('[zatca-submit] invoice fetch failed:', invErr?.message)
    return { invoiceStatus: 'error' }
  }

  if (['reported', 'cleared'].includes(inv.zatca_status)) {
    console.log('[zatca-submit] already submitted:', inv.zatca_status)
    return { invoiceStatus: inv.zatca_status }
  }

  const { data: branch } = await db.from('branches').select('*').eq('id', inv.branch_id).single()
  if (!branch) {
    console.error('[zatca-submit] branch not found:', inv.branch_id)
    return { invoiceStatus: 'error' }
  }

  const { data: cert, error: certErr } = await db
    .from('zatca_certificates').select('*')
    .eq('branch_id', inv.branch_id).eq('status', 'active').single()

  console.log('[zatca-submit] cert lookup:', { found: !!cert, error: certErr?.message, hasCsid: !!cert?.production_csid })

  if (!cert?.production_csid) {
    console.log('[zatca-submit] no active Phase 2 cert — marking not_submitted')
    await db.from('invoices').update({ zatca_status: 'not_submitted' }).eq('id', invoiceId)
    return { invoiceStatus: 'not_submitted' }
  }

  if (!cert.private_key_encrypted) {
    console.warn('[zatca-submit] active cert but missing private key — queuing retry')
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, 'private key missing')
    return { invoiceStatus: 'pending' }
  }

  try {
    await db.from('invoices').update({ zatca_status: 'pending' }).eq('id', invoiceId)

    console.log('[zatca-submit] decrypting private key...')
    const secretKey = await decryptPrivateKey(cert.private_key_encrypted)

    const isSimplified = inv.zatca_invoice_type === 'simplified'
    console.log('[zatca-submit] building XML, isSimplified:', isSimplified)
    const xmlData = buildInvoiceXMLData(inv, branch, inv.invoice_items ?? [], inv.customers ?? null, isSimplified)
    const unsignedXml = buildInvoice(xmlData, {
      profileId:        isSimplified ? 'reporting:1.0' : 'clearance:1.0',
      typeCodeName:     isSimplified ? '0200000' : '0100000',
      includeSignature: true,
      requireBuyer:     !isSimplified,
    })

    console.log('[zatca-submit] signing XML...')
    const { signedXml, invoiceHash, qrCode } = await signInvoice(unsignedXml, secretKey, cert.production_csid)
    console.log('[zatca-submit] signed OK, hash prefix:', invoiceHash.substring(0, 20))

    const env       = cert.environment === 'production' ? 'production' : 'sandbox'
    const baseUrl   = ZATCA_URLS[env]
    const endpoint  = isSimplified ? `${baseUrl}/invoices/reporting/single` : `${baseUrl}/invoices/clearance/single`
    const creds     = btoa(`${cert.production_csid}:${cert.production_secret}`)
    const xmlB64    = btoa(unescape(encodeURIComponent(signedXml)))

    console.log('[zatca-submit] submitting to ZATCA:', endpoint)
    const zatcaRes  = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'accept': 'application/json', 'accept-version': 'V2', 'Content-Type': 'application/json',
        'Authorization': `Basic ${creds}`,
        ...(isSimplified ? {} : { 'Clearance-Status': '1' }),
      },
      body: JSON.stringify({ invoiceHash, uuid: inv.zatca_uuid, invoice: xmlB64 }),
    })

    const responseText = await zatcaRes.text()
    console.log('[zatca-submit] ZATCA status:', zatcaRes.status, '| body:', responseText.substring(0, 300))
    const zatcaBody = (() => { try { return JSON.parse(responseText) } catch { return {} } })()

    const reportingStatus = zatcaBody?.reportingStatus as string | undefined
    const clearanceStatus = zatcaBody?.clearanceStatus as string | undefined
    let newStatus: string
    if (isSimplified) {
      newStatus = reportingStatus === 'REPORTED' ? 'reported' : 'failed'
    } else {
      newStatus = clearanceStatus === 'CLEARED' ? 'cleared' : 'failed'
    }
    const errors = (zatcaBody?.errors ?? []) as string[]
    if (errors.length > 0) newStatus = 'failed'
    console.log('[zatca-submit] final status:', newStatus)

    await db.from('invoices').update({
      zatca_status:             newStatus,
      zatca_xml:                signedXml,
      zatca_xml_hash:           invoiceHash,
      zatca_qr_code:            qrCode,
      zatca_submitted_at:       new Date().toISOString(),
      zatca_clearance_status:   clearanceStatus ?? null,
      zatca_reporting_response: zatcaBody ?? null,
      zatca_warnings:           zatcaBody?.warnings?.length ? { warnings: zatcaBody.warnings } : null,
      zatca_prev_invoice_hash:  invoiceHash,
    }).eq('id', invoiceId)

    await db.from('zatca_certificates')
      .update({ last_invoice_hash: invoiceHash, invoice_counter: (cert.invoice_counter ?? 0) + 1 })
      .eq('id', cert.id)

    if (newStatus === 'failed') {
      await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, JSON.stringify(zatcaBody?.errors))
    }

    return { invoiceStatus: newStatus }

  } catch (err: any) {
    console.error('[zatca-submit] error:', err.message, '\n', err.stack)
    await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
    await queueForRetry(db, invoiceId, inv.branch_id, inv.tenant_id, err.message ?? 'unknown')
    return { invoiceStatus: 'failed' }
  }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    const invoiceId = body?.invoiceId as string | undefined
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: 'Missing required field: invoiceId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await processInvoice(supabase as any, invoiceId)
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('[zatca-submit] unexpected error:', err)
    return new Response(JSON.stringify({ error: err.message ?? 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
