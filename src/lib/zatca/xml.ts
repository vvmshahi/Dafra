/**
 * ZATCA Phase 2 — UBL 2.1 Invoice XML Builder
 * Spec: ZATCA XML Standard, Section 4 (Business Rules BR-*)
 *
 * buildSimplifiedInvoice → InvoiceTypeCode 388 / name="0200000" / ProfileID reporting:1.0
 * buildStandardInvoice   → InvoiceTypeCode 388 / name="0100000" / ProfileID clearance:1.0
 *
 * Both functions return raw XML string. Signing is done by signing.ts AFTER this.
 * The QR and Signature blocks are injected as placeholders here and filled by signing.ts.
 *
 * FIRST_INVOICE_HASH — base64(sha256("0")) per ZATCA spec (BR-KSA-26):
 *   NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==
 */

import { create } from 'xmlbuilder2'

export const FIRST_INVOICE_HASH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

// ── Namespaces ────────────────────────────────────────────────────────────────

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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SellerAddress {
  street:       string
  buildingNo:   string
  city:         string
  postalCode:   string
  district:     string
  countryCode:  string
}

export interface BuyerInfo {
  name:       string
  vatNumber?: string
}

export interface InvoiceLine {
  id:           number
  name:         string
  qty:          number
  unitPrice:    number
  discountAmt:  number
  lineNetAmt:   number
  taxRate:      number   // 0.15 for standard VAT
  taxAmount:    number
  lineTotal:    number
}

export interface TaxBreakdown {
  taxableAmount: number
  taxAmount:     number
  vatCategoryCode: 'S' | 'Z' | 'E' | 'O'  // S=standard, Z=zero, E=exempt, O=outside
  taxRate:       number
  exemptionCode?: string
}

export interface InvoiceXMLData {
  // Identity
  invoiceNumber:  string
  uuid:           string
  issueDate:      string  // YYYY-MM-DD
  issueTime:      string  // HH:MM:SS
  counterValue:   number
  prevInvoiceHash:string  // base64 sha256 of previous invoice
  // Seller
  sellerName:     string
  sellerNameAr:   string
  sellerVat:      string
  sellerAddress:  SellerAddress
  // Buyer (required for standard invoices)
  buyer?:         BuyerInfo
  // Totals
  subtotal:       number  // sum of line net amounts (excl. VAT)
  discountTotal:  number
  taxableAmount:  number
  taxAmount:      number
  totalAmount:    number  // including VAT
  // Lines & VAT
  lines:          InvoiceLine[]
  taxBreakdowns:  TaxBreakdown[]
  // Placeholders (filled by signing.ts)
  qrCode?:        string
}

// ── Main builders ─────────────────────────────────────────────────────────────

export function buildSimplifiedInvoice(data: InvoiceXMLData): string {
  return buildInvoice(data, {
    profileId:        'reporting:1.0',
    typeCodeName:     '0200000',
    includeSignature: true,
    requireBuyer:     false,
  })
}

export function buildStandardInvoice(data: InvoiceXMLData): string {
  return buildInvoice(data, {
    profileId:        'clearance:1.0',
    typeCodeName:     '0100000',
    includeSignature: true,
    requireBuyer:     true,
  })
}

// ── Core builder ──────────────────────────────────────────────────────────────

interface BuildOptions {
  profileId:        string
  typeCodeName:     string
  includeSignature: boolean
  requireBuyer:     boolean
}

function buildInvoice(data: InvoiceXMLData, opts: BuildOptions): string {
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(NS.invoice, 'Invoice')
    .att('xmlns:cac', NS.cac)
    .att('xmlns:cbc', NS.cbc)
    .att('xmlns:ext', NS.ext)

  // ── UBLExtensions (signature placeholder) ─────────────────────────────────
  const ublExt = root.ele(NS.ext, 'UBLExtensions')
  const ext    = ublExt.ele(NS.ext, 'UBLExtension')
  ext.ele(NS.ext, 'ExtensionURI').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
  ext.ele(NS.ext, 'ExtensionContent').txt('')  // filled by signing.ts

  // ── Invoice metadata ──────────────────────────────────────────────────────
  root.ele(NS.cbc, 'ProfileID').txt(opts.profileId)
  root.ele(NS.cbc, 'ID').txt(data.invoiceNumber)
  root.ele(NS.cbc, 'UUID').txt(data.uuid)
  root.ele(NS.cbc, 'IssueDate').txt(data.issueDate)
  root.ele(NS.cbc, 'IssueTime').txt(data.issueTime)
  root.ele(NS.cbc, 'InvoiceTypeCode').att('name', opts.typeCodeName).txt('388')
  root.ele(NS.cbc, 'DocumentCurrencyCode').txt('SAR')
  root.ele(NS.cbc, 'TaxCurrencyCode').txt('SAR')

  // ── AdditionalDocumentReference: ICV (invoice counter) ───────────────────
  const icv = root.ele(NS.cac, 'AdditionalDocumentReference')
  icv.ele(NS.cbc, 'ID').txt('ICV')
  icv.ele(NS.cbc, 'UUID').txt(String(data.counterValue))

  // ── AdditionalDocumentReference: PIH (previous invoice hash) ─────────────
  const pih = root.ele(NS.cac, 'AdditionalDocumentReference')
  pih.ele(NS.cbc, 'ID').txt('PIH')
  const pihAtt = pih.ele(NS.cac, 'Attachment')
  pihAtt.ele(NS.cbc, 'EmbeddedDocumentBinaryObject')
    .att('mimeCode', 'text/plain')
    .txt(data.prevInvoiceHash)

  // ── AdditionalDocumentReference: QR ──────────────────────────────────────
  const qr = root.ele(NS.cac, 'AdditionalDocumentReference')
  qr.ele(NS.cbc, 'ID').txt('QR')
  const qrAtt = qr.ele(NS.cac, 'Attachment')
  qrAtt.ele(NS.cbc, 'EmbeddedDocumentBinaryObject')
    .att('mimeCode', 'text/plain')
    .txt(data.qrCode ?? '')

  // ── Signature reference ───────────────────────────────────────────────────
  if (opts.includeSignature) {
    const sig = root.ele(NS.cac, 'Signature')
    sig.ele(NS.cbc, 'ID').txt('urn:oasis:names:specification:ubl:signature:Invoice')
    sig.ele(NS.cbc, 'SignatureMethod')
      .txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
  }

  // ── Seller party ──────────────────────────────────────────────────────────
  const supplier = root.ele(NS.cac, 'AccountingSupplierParty')
    .ele(NS.cac, 'Party')

  const supplierIdent = supplier.ele(NS.cac, 'PartyIdentification')
  supplierIdent.ele(NS.cbc, 'ID').att('schemeID', 'CRN').txt(data.sellerVat)

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

  const sellerLegal = supplier.ele(NS.cac, 'PartyLegalEntity')
  sellerLegal.ele(NS.cbc, 'RegistrationName').txt(data.sellerName)

  // ── Buyer party ───────────────────────────────────────────────────────────
  if (opts.requireBuyer && data.buyer) {
    const customer = root.ele(NS.cac, 'AccountingCustomerParty')
      .ele(NS.cac, 'Party')
    if (data.buyer.vatNumber) {
      const buyerTax = customer.ele(NS.cac, 'PartyTaxScheme')
      buyerTax.ele(NS.cbc, 'CompanyID').txt(data.buyer.vatNumber)
      buyerTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
    }
    customer.ele(NS.cac, 'PartyLegalEntity')
      .ele(NS.cbc, 'RegistrationName').txt(data.buyer.name)
  }

  // ── Tax total ─────────────────────────────────────────────────────────────
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

  // ── Legal monetary total ──────────────────────────────────────────────────
  const lmt = root.ele(NS.cac, 'LegalMonetaryTotal')
  lmt.ele(NS.cbc, 'LineExtensionAmount').att('currencyID', 'SAR').txt(fmt(data.subtotal))
  lmt.ele(NS.cbc, 'TaxExclusiveAmount').att('currencyID', 'SAR').txt(fmt(data.taxableAmount))
  lmt.ele(NS.cbc, 'TaxInclusiveAmount').att('currencyID', 'SAR').txt(fmt(data.totalAmount))
  lmt.ele(NS.cbc, 'AllowanceTotalAmount').att('currencyID', 'SAR').txt(fmt(data.discountTotal))
  lmt.ele(NS.cbc, 'PayableAmount').att('currencyID', 'SAR').txt(fmt(data.totalAmount))

  // ── Invoice lines ─────────────────────────────────────────────────────────
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

  return root.end({ prettyPrint: false })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format number to exactly 2 decimal places per ZATCA spec */
function fmt(n: number): string {
  return n.toFixed(2)
}

/**
 * Build InvoiceXMLData from raw invoice DB data.
 * tax_rate in DB is stored as 0.15 (decimal), not 15.
 */
export function buildInvoiceXMLData(params: {
  invoice:     { id: string; invoice_number: string; zatca_uuid: string; invoice_date: string;
                 created_at: string; zatca_counter_number: number | null;
                 zatca_prev_invoice_hash: string | null; subtotal: number; discount_amount: number;
                 taxable_amount: number; tax_amount: number; total_amount: number; }
  branch:      { business_name: string; business_name_ar: string | null;
                 vat_number: string | null; street: string | null; building_number: string | null;
                 city: string | null; postal_code: string | null; district: string | null; country: string }
  items:       { id: string; name: string; quantity: number; unit_price: number;
                 discount_amount: number; subtotal: number; tax_rate: number;
                 tax_amount: number; total: number; }[]
  customer?:   { name: string; vat_number: string | null } | null
  isSimplified:boolean
}): InvoiceXMLData {
  const { invoice, branch, items, customer, isSimplified } = params
  const dt = new Date(invoice.created_at)

  const issueDate = invoice.invoice_date
  const issueTime = dt.toISOString().slice(11, 19)

  const lines: InvoiceLine[] = items.map((it, i) => ({
    id:          i + 1,
    name:        it.name,
    qty:         it.quantity,
    unitPrice:   it.unit_price,
    discountAmt: it.discount_amount,
    lineNetAmt:  it.subtotal,
    taxRate:     it.tax_rate,
    taxAmount:   it.tax_amount,
    lineTotal:   it.total,
  }))

  return {
    invoiceNumber:   invoice.invoice_number,
    uuid:            invoice.zatca_uuid,
    issueDate,
    issueTime,
    counterValue:    invoice.zatca_counter_number ?? 1,
    prevInvoiceHash: invoice.zatca_prev_invoice_hash ?? FIRST_INVOICE_HASH,
    sellerName:      branch.business_name,
    sellerNameAr:    branch.business_name_ar ?? branch.business_name,
    sellerVat:       branch.vat_number ?? '',
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
    subtotal:      invoice.subtotal,
    discountTotal: invoice.discount_amount,
    taxableAmount: invoice.taxable_amount,
    taxAmount:     invoice.tax_amount,
    totalAmount:   invoice.total_amount,
    lines,
    taxBreakdowns: [{
      taxableAmount:   invoice.taxable_amount,
      taxAmount:       invoice.tax_amount,
      vatCategoryCode: 'S',
      taxRate:         0.15,
    }],
  }
}
