import { create as xmlCreate } from 'https://esm.sh/xmlbuilder2@4.0.3'
import { secp256k1 } from 'https://esm.sh/@noble/curves@2.2.0/secp256k1.js'
import { DOMParser } from 'https://esm.sh/@xmldom/xmldom@0.9.10'
import type { FunctionalityMap } from './config.ts'

export type ComplianceSampleType =
  | 'simplified_invoice'
  | 'simplified_credit_note'
  | 'simplified_debit_note'
  | 'standard_invoice'
  | 'standard_credit_note'
  | 'standard_debit_note'

export interface ComplianceSampleResult {
  type: ComplianceSampleType
  invoiceKind?: 'simplified' | 'standard'
  documentKind?: 'invoice' | 'credit_note' | 'debit_note'
  accepted?: boolean
  status: 'accepted' | 'blocked' | 'ambiguous_failed'
  dryRun?: boolean
  httpStatus?: number
  statusString?: string
  validationStatus?: string
  reportingStatus?: string
  clearanceStatus?: string
  warningsCount?: number
  errorsCount?: number
  redactedErrors?: Array<{ code?: string; message?: string }>
  message?: string
}

export interface SampleSeller {
  name: string
  vatNumber: string
  crNumber: string
  street: string
  buildingNumber: string
  district: string
  city: string
  postalCode: string
  countryCode: string
}

export interface SubmitComplianceSamplesParams {
  baseUrl: string
  functionalityMap: FunctionalityMap
  complianceCsid: string
  complianceSecret: string
  complianceCertificate: string
  privateKeyPem: string
  seller: SampleSeller
}

interface SignedCompliancePayload {
  type: ComplianceSampleType
  uuid: string
  invoiceHash: string
  invoice: string
  isStandard: boolean
}

const SIMPLIFIED: ComplianceSampleType[] = [
  'simplified_invoice',
  'simplified_credit_note',
  'simplified_debit_note',
]

const STANDARD: ComplianceSampleType[] = [
  'standard_invoice',
  'standard_credit_note',
  'standard_debit_note',
]

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

export function requiredComplianceSamples(map: FunctionalityMap): ComplianceSampleType[] {
  if (map === '0100') return SIMPLIFIED
  if (map === '1000') return STANDARD
  return [...STANDARD, ...SIMPLIFIED]
}

export function simulatedComplianceResults(map: FunctionalityMap): ComplianceSampleResult[] {
  return requiredComplianceSamples(map).map(type => ({
    type,
    status: 'accepted',
    dryRun: true,
  }))
}

export async function submitComplianceSamples(params: SubmitComplianceSamplesParams): Promise<ComplianceSampleResult[]> {
  const sampleTypes = requiredComplianceSamples(params.functionalityMap)
  const results: ComplianceSampleResult[] = []

  for (let i = 0; i < sampleTypes.length; i++) {
    const type = sampleTypes[i]
    const payload = await buildCompliancePayload(params, type, i + 1)
    const result = await submitComplianceSample(params, payload)
    results.push(result)

    if (result.status !== 'accepted') {
      for (const remainingType of sampleTypes.slice(i + 1)) {
        results.push({
          type: remainingType,
          invoiceKind: invoiceKindFor(remainingType),
          documentKind: documentKindFor(remainingType),
          accepted: false,
          status: 'blocked',
          message: 'Not submitted because a previous compliance sample failed.',
        })
      }
      break
    }
  }

  return results
}

async function buildCompliancePayload(
  params: SubmitComplianceSamplesParams,
  type: ComplianceSampleType,
  sequence: number,
): Promise<SignedCompliancePayload> {
  const privateKey = privateKeyFromPem(params.privateKeyPem)
  const data = buildSampleData(type, params.seller, sequence)
  const unsignedXml = buildInvoice(data, {
    profileId: data.isSimplified ? 'reporting:1.0' : 'clearance:1.0',
    typeCodeName: data.isSimplified ? '0200000' : '0100000',
    invoiceTypeCode: data.invoiceTypeCode,
    requireBuyer: !data.isSimplified,
  })
  const { signedXml, invoiceHash } = await signInvoice(unsignedXml, privateKey, params.complianceCertificate)
  await assertInvoiceHashMatches(signedXml, invoiceHash)

  return {
    type,
    uuid: data.uuid,
    invoiceHash,
    invoice: utf8ToBase64(signedXml),
    isStandard: !data.isSimplified,
  }
}

async function submitComplianceSample(
  params: SubmitComplianceSamplesParams,
  payload: SignedCompliancePayload,
): Promise<ComplianceSampleResult> {
  const credentials = btoa(`${params.complianceCsid}:${params.complianceSecret}`)
  const res = await fetch(`${params.baseUrl}/compliance/invoices`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'accept-version': 'V2',
      'accept-language': 'en',
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
      ...(payload.isStandard ? { 'Clearance-Status': '1' } : {}),
    },
    body: JSON.stringify({
      invoiceHash: payload.invoiceHash,
      uuid: payload.uuid,
      invoice: payload.invoice,
    }),
  })

  const body = await safeJson(res)
  return summarizeComplianceResponse(payload.type, res.status, body)
}

function summarizeComplianceResponse(
  type: ComplianceSampleType,
  httpStatus: number,
  body: any,
): ComplianceSampleResult {
  const invoiceKind = invoiceKindFor(type)
  const documentKind = documentKindFor(type)
  const validationStatus = upperString(body?.validationResults?.status)
  const reportingStatus = upperString(body?.reportingStatus)
  const clearanceStatus = upperString(body?.clearanceStatus)
  const redactedErrors = redactedZatcaErrors(body)
  const errorsCount = redactedErrors.length
  const warningsCount = countMessages(body?.warnings) + countMessages(body?.validationResults?.warningMessages)
  const acceptance = isExplicitComplianceSampleAccepted({
    httpStatus,
    parseFailed: body?._parseFailed === true,
    invoiceKind,
    validationStatus,
    reportingStatus,
    clearanceStatus,
    errorsCount,
  })

  return {
    type,
    invoiceKind,
    documentKind,
    accepted: acceptance.accepted,
    status: acceptance.status,
    httpStatus,
    statusString: acceptance.statusString,
    validationStatus,
    reportingStatus,
    clearanceStatus,
    warningsCount,
    errorsCount,
    redactedErrors,
    message: acceptance.message,
  }
}

function isExplicitComplianceSampleAccepted(params: {
  httpStatus: number
  parseFailed: boolean
  invoiceKind: 'simplified' | 'standard'
  validationStatus?: string
  reportingStatus?: string
  clearanceStatus?: string
  errorsCount: number
}): {
  accepted: boolean
  status: ComplianceSampleResult['status']
  statusString: string
  message: string
} {
  const httpOk = params.httpStatus >= 200 && params.httpStatus < 300
  if (!httpOk) {
    return {
      accepted: false,
      status: 'blocked',
      statusString: `HTTP_${params.httpStatus}`,
      message: 'ZATCA compliance check failed for this sample.',
    }
  }
  if (params.parseFailed) {
    return {
      accepted: false,
      status: 'ambiguous_failed',
      statusString: 'NON_JSON_RESPONSE',
      message: 'ZATCA returned a non-JSON compliance response.',
    }
  }
  if (params.errorsCount > 0) {
    return {
      accepted: false,
      status: 'blocked',
      statusString: 'ERRORS_PRESENT',
      message: 'ZATCA compliance check returned errors for this sample.',
    }
  }
  if (params.validationStatus !== 'PASS') {
    return {
      accepted: false,
      status: params.validationStatus ? 'blocked' : 'ambiguous_failed',
      statusString: params.validationStatus ? `VALIDATION_${params.validationStatus}` : 'VALIDATION_STATUS_MISSING',
      message: params.validationStatus
        ? 'ZATCA validation did not explicitly pass for this sample.'
        : 'ZATCA response did not include an explicit validation pass status.',
    }
  }
  if (params.invoiceKind === 'simplified' && params.reportingStatus && params.reportingStatus !== 'REPORTED') {
    return {
      accepted: false,
      status: 'blocked',
      statusString: `REPORTING_${params.reportingStatus}`,
      message: 'ZATCA reporting status did not explicitly report this sample.',
    }
  }
  if (params.invoiceKind === 'standard' && params.clearanceStatus && params.clearanceStatus !== 'CLEARED') {
    return {
      accepted: false,
      status: 'blocked',
      statusString: `CLEARANCE_${params.clearanceStatus}`,
      message: 'ZATCA clearance status did not explicitly clear this sample.',
    }
  }

  return {
    accepted: true,
    status: 'accepted',
    statusString: params.invoiceKind === 'simplified'
      ? (params.reportingStatus ? `VALIDATION_PASS_REPORTING_${params.reportingStatus}` : 'VALIDATION_PASS')
      : (params.clearanceStatus ? `VALIDATION_PASS_CLEARANCE_${params.clearanceStatus}` : 'VALIDATION_PASS'),
    message: 'Accepted by ZATCA compliance check.',
  }
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { _parseFailed: true }
  }
}

function countMessages(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function upperString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toUpperCase() : undefined
}

function redactedZatcaErrors(body: any): Array<{ code?: string; message?: string }> {
  const values = [
    ...arrayValue(body?.errors),
    ...arrayValue(body?.validationResults?.errorMessages),
  ]
  return values.slice(0, 5).map(item => ({
    code: safeText(item?.code ?? item?.type ?? item?.category),
    message: safeText(item?.message ?? item?.error ?? item?.description),
  })).filter(item => item.code || item.message)
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').slice(0, 180)
  if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|xml/i.test(cleaned)) {
    return 'Sensitive detail redacted.'
  }
  return cleaned
}

function invoiceKindFor(type: ComplianceSampleType): 'simplified' | 'standard' {
  return type.startsWith('simplified') ? 'simplified' : 'standard'
}

function documentKindFor(type: ComplianceSampleType): 'invoice' | 'credit_note' | 'debit_note' {
  if (type.includes('credit')) return 'credit_note'
  if (type.includes('debit')) return 'debit_note'
  return 'invoice'
}

function buildSampleData(type: ComplianceSampleType, seller: SampleSeller, sequence: number): any {
  const isSimplified = type.startsWith('simplified')
  const noteKind = type.includes('credit') ? 'credit' : type.includes('debit') ? 'debit' : 'invoice'
  const invoiceTypeCode = noteKind === 'credit' ? '381' : noteKind === 'debit' ? '383' : '388'
  const prefix = type.toUpperCase().replaceAll('_', '-')
  const issue = saudiIssueDate(new Date())

  return {
    isSimplified,
    invoiceNumber: `COMP-${prefix}-${String(sequence).padStart(2, '0')}`,
    uuid: crypto.randomUUID(),
    issueDate: issue.date,
    issueTime: issue.time,
    invoiceTypeCode,
    counterValue: sequence,
    prevInvoiceHash: FIRST_INVOICE_HASH,
    billingReferenceId: noteKind === 'invoice' ? undefined : `COMP-ORIGINAL-${String(sequence).padStart(2, '0')}`,
    noteReason: noteKind === 'credit' ? 'Compliance credit note sample' :
      noteKind === 'debit' ? 'Compliance debit note sample' : undefined,
    sellerName: seller.name,
    sellerVat: seller.vatNumber,
    sellerCrn: seller.crNumber,
    sellerAddress: {
      street: seller.street,
      buildingNo: seller.buildingNumber,
      city: seller.city,
      postalCode: seller.postalCode,
      district: seller.district,
      countryCode: seller.countryCode,
    },
    buyer: isSimplified ? undefined : {
      name: 'ZATCA Compliance Sample Buyer',
      vatNumber: '300000000000003',
      crn: '1010101000',
      address: {
        street: 'King Fahd Road',
        buildingNo: '1234',
        city: 'Riyadh',
        postalCode: '12345',
        district: 'Al Olaya',
        countryCode: 'SA',
      },
    },
    subtotal: 100,
    discountTotal: 0,
    taxableAmount: 100,
    taxAmount: 15,
    totalAmount: 115,
    lines: [{
      id: 1,
      name: 'Compliance sample item',
      qty: 1,
      discountAmt: 0,
      lineNetAmt: 100,
      taxRate: 0.15,
      taxAmount: 15,
      lineTotal: 115,
    }],
    taxBreakdowns: [{
      taxableAmount: 100,
      taxAmount: 15,
      vatCategoryCode: 'S',
      taxRate: 0.15,
    }],
    qrCode: '',
  }
}

function buildInvoice(data: any, opts: any): string {
  const root = (xmlCreate({ version: '1.0', encoding: 'UTF-8' }) as any)
    .ele(NS.invoice, 'Invoice')
    .att('xmlns:cac', NS.cac).att('xmlns:cbc', NS.cbc).att('xmlns:ext', NS.ext)
    .att('xmlns:sig', NS.sig).att('xmlns:sac', NS.sac).att('xmlns:sbc', NS.sbc)
    .att('xmlns:ds', NS.ds).att('xmlns:xades', NS.xades)

  const ublExt = root.ele(NS.ext, 'UBLExtensions').ele(NS.ext, 'UBLExtension')
  ublExt.ele(NS.ext, 'ExtensionURI').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
  const extContent = ublExt.ele(NS.ext, 'ExtensionContent')
  const ublDocSig = extContent.ele(NS.sig, 'UBLDocumentSignatures')
  const sigInfo = ublDocSig.ele(NS.sac, 'SignatureInformation')
  sigInfo.ele(NS.cbc, 'ID').txt('urn:oasis:names:specification:ubl:signature:1')
  sigInfo.ele(NS.sbc, 'ReferencedSignatureID').txt('urn:oasis:names:specification:ubl:signature:Invoice')
  const dsSig = sigInfo.ele(NS.ds, 'Signature').att('Id', 'signature')
  const dsSigInfo = dsSig.ele(NS.ds, 'SignedInfo')
  dsSigInfo.ele(NS.ds, 'CanonicalizationMethod').att('Algorithm', 'http://www.w3.org/2006/12/xml-c14n11')
  dsSigInfo.ele(NS.ds, 'SignatureMethod').att('Algorithm', 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256')
  dsSig.ele(NS.ds, 'SignatureValue').txt('')
  dsSig.ele(NS.ds, 'KeyInfo').ele(NS.ds, 'X509Data').ele(NS.ds, 'X509Certificate').txt('')

  root.ele(NS.cbc, 'ProfileID').txt(opts.profileId)
  root.ele(NS.cbc, 'ID').txt(data.invoiceNumber)
  root.ele(NS.cbc, 'UUID').txt(data.uuid)
  root.ele(NS.cbc, 'IssueDate').txt(data.issueDate)
  root.ele(NS.cbc, 'IssueTime').txt(data.issueTime)
  root.ele(NS.cbc, 'InvoiceTypeCode').att('name', opts.typeCodeName).txt(opts.invoiceTypeCode)
  root.ele(NS.cbc, 'DocumentCurrencyCode').txt('SAR')
  root.ele(NS.cbc, 'TaxCurrencyCode').txt('SAR')

  if (data.billingReferenceId) {
    const billingRef = root.ele(NS.cac, 'BillingReference')
    const invoiceDocRef = billingRef.ele(NS.cac, 'InvoiceDocumentReference')
    invoiceDocRef.ele(NS.cbc, 'ID').txt(data.billingReferenceId)
    invoiceDocRef.ele(NS.cbc, 'IssueDate').txt(data.issueDate)
  }

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
    .att('mimeCode', 'text/plain').txt(data.qrCode)

  const sig = root.ele(NS.cac, 'Signature')
  sig.ele(NS.cbc, 'ID').txt('urn:oasis:names:specification:ubl:signature:Invoice')
  sig.ele(NS.cbc, 'SignatureMethod').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades')

  const supplier = root.ele(NS.cac, 'AccountingSupplierParty').ele(NS.cac, 'Party')
  supplier.ele(NS.cac, 'PartyIdentification').ele(NS.cbc, 'ID')
    .att('schemeID', 'CRN').txt(data.sellerCrn)
  appendAddress(supplier, data.sellerAddress)
  const sellerTax = supplier.ele(NS.cac, 'PartyTaxScheme')
  sellerTax.ele(NS.cbc, 'CompanyID').txt(data.sellerVat)
  sellerTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
  supplier.ele(NS.cac, 'PartyLegalEntity').ele(NS.cbc, 'RegistrationName').txt(data.sellerName)

  const customerParty = root.ele(NS.cac, 'AccountingCustomerParty')
  if (opts.requireBuyer && data.buyer) {
    const customer = customerParty.ele(NS.cac, 'Party')
    customer.ele(NS.cac, 'PartyIdentification').ele(NS.cbc, 'ID')
      .att('schemeID', 'CRN').txt(data.buyer.crn)
    appendAddress(customer, data.buyer.address)
    const buyerTax = customer.ele(NS.cac, 'PartyTaxScheme')
    buyerTax.ele(NS.cbc, 'CompanyID').txt(data.buyer.vatNumber)
    buyerTax.ele(NS.cac, 'TaxScheme').ele(NS.cbc, 'ID').txt('VAT')
    customer.ele(NS.cac, 'PartyLegalEntity').ele(NS.cbc, 'RegistrationName').txt(data.buyer.name)
  }

  const paymentMeans = root.ele(NS.cac, 'PaymentMeans')
  paymentMeans.ele(NS.cbc, 'PaymentMeansCode').txt('10')
  if (data.noteReason) paymentMeans.ele(NS.cbc, 'InstructionNote').txt(data.noteReason)

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
    price.ele(NS.cbc, 'PriceAmount').att('currencyID', 'SAR').txt(fmt(line.lineNetAmt / line.qty))
    price.ele(NS.cbc, 'BaseQuantity').att('unitCode', 'PCE').txt('1')
  }

  return root.end({ prettyPrint: false }) as string
}

function appendAddress(parent: any, address: any): void {
  const postal = parent.ele(NS.cac, 'PostalAddress')
  postal.ele(NS.cbc, 'StreetName').txt(address.street)
  postal.ele(NS.cbc, 'BuildingNumber').txt(address.buildingNo)
  postal.ele(NS.cbc, 'CitySubdivisionName').txt(address.district)
  postal.ele(NS.cbc, 'CityName').txt(address.city)
  postal.ele(NS.cbc, 'PostalZone').txt(address.postalCode)
  postal.ele(NS.cac, 'Country').ele(NS.cbc, 'IdentificationCode').txt(address.countryCode)
}

async function signInvoice(xmlString: string, secretKey: Uint8Array, certificate: string): Promise<{
  signedXml: string
  invoiceHash: string
}> {
  const { certPemBody, certDer } = decodeCertificateToken(certificate)
  const serialNumber = extractCertSerial(certDer)
  const issuerName = extractCertIssuerName(certDer)
  const certSigValue = extractCertSignatureValue(certDer)
  const pubKeySpki = extractCertPublicKeySpki(certDer)

  const certDigestBytes = new Uint8Array(await sha256Bytes(new TextEncoder().encode(certPemBody)))
  const certDigestHex = bytesToHex(certDigestBytes)
  const certDigestB64 = btoa(certDigestHex)

  const invoiceDigestB64 = await computeInvoiceHash(xmlString)
  const signingTime = new Date().toISOString().replace(/\.\d{3}Z$/, '')
  const signedPropsXml = buildSignedProperties(signingTime, certDigestB64, issuerName, serialNumber)
  const signedPropsHashInput = toSignedPropsHashInput(signedPropsXml)
  const signedPropsBytes = new Uint8Array(await sha256Bytes(new TextEncoder().encode(signedPropsHashInput)))
  const signedPropsB64 = btoa(bytesToHex(signedPropsBytes))
  const signedInfoCanon = buildSignedInfoCanonical(invoiceDigestB64, signedPropsB64)
  const signedInfoHash = new Uint8Array(await sha256Bytes(new TextEncoder().encode(signedInfoCanon)))
  const sig = secp256k1.sign(signedInfoHash, secretKey) as unknown as Uint8Array
  const sigDerBytes = p1363ToDer(sig)
  const sigValueB64 = bytesToBase64(sigDerBytes)

  const xadesBlock = buildXadesBlock(
    invoiceDigestB64,
    signedPropsB64,
    sigValueB64,
    certPemBody,
    issuerName,
    serialNumber,
    signingTime,
    certDigestB64,
  )

  let signedXml = xmlString.replace(
    /<ext:ExtensionContent>[\s\S]*?<\/ext:ExtensionContent>/,
    `<ext:ExtensionContent>${xadesBlock}</ext:ExtensionContent>`,
  )

  const sellerName = (signedXml.match(/<cbc:RegistrationName[^>]*>([^<]+)<\/cbc:RegistrationName>/) ?? [])[1] ?? ''
  const vatNumber = (signedXml.match(/<cac:PartyTaxScheme>[\s\S]*?<cbc:CompanyID>([^<]+)<\/cbc:CompanyID>/) ?? [])[1] ?? ''
  const issueDate = (signedXml.match(/<cbc:IssueDate[^>]*>([^<]+)<\/cbc:IssueDate>/) ?? [])[1] ?? ''
  const issueTime = (signedXml.match(/<cbc:IssueTime[^>]*>([^<]+)<\/cbc:IssueTime>/) ?? [])[1] ?? '00:00:00'
  const totalAmount = parseFloat((signedXml.match(/<cbc:TaxInclusiveAmount[^>]*>([\d.]+)<\/cbc:TaxInclusiveAmount>/) ?? [])[1] ?? '0')
  const vatAmount = parseFloat((signedXml.match(/<cbc:TaxAmount[^>]*>([\d.]+)<\/cbc:TaxAmount>/) ?? [])[1] ?? '0')
  const qrCode = buildPhase2QR(
    sellerName,
    vatNumber,
    `${issueDate}T${issueTime}Z`,
    totalAmount,
    vatAmount,
    invoiceDigestB64,
    sigValueB64,
    pubKeySpki,
    certSigValue,
  )

  signedXml = signedXml.replace(
    /(<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)([^<]*)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
    `$1${qrCode}$3`,
  )

  const finalInvoiceHash = await computeInvoiceHash(signedXml)
  if (finalInvoiceHash !== invoiceDigestB64) {
    throw new Error('Compliance sample invoice hash mismatch after signing')
  }

  return { signedXml, invoiceHash: finalInvoiceHash }
}

function decodeCertificateToken(token: string): { certPemBody: string; certDer: Uint8Array } {
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

function privateKeyFromPem(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return base64ToBytes(b64)
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
}

async function sha256Bytes(input: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', input)
}

function p1363ToDer(sig: Uint8Array): Uint8Array {
  const r = sig.slice(0, 32)
  const s = sig.slice(32, 64)
  const rDer = derInt(r)
  const sDer = derInt(s)
  return new Uint8Array([0x30, rDer.length + sDer.length, ...rDer, ...sDer])
}

function derInt(n: Uint8Array): Uint8Array {
  let i = 0
  while (i < n.length - 1 && n[i] === 0) i++
  const trimmed = n.slice(i)
  const value = (trimmed[0] & 0x80) ? new Uint8Array([0, ...trimmed]) : trimmed
  return new Uint8Array([0x02, value.length, ...value])
}

function derLen(buf: Uint8Array, off: number): [number, number] {
  const b = buf[off++]
  if (b < 0x80) return [b, off]
  const n = b & 0x7f
  let len = 0
  for (let i = 0; i < n; i++) len = (len << 8) | buf[off++]
  return [len, off]
}

function extractCertSerial(certDer: Uint8Array): string {
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

function extractCertSignatureValue(certDer: Uint8Array): Uint8Array {
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

function parseDerOid(bytes: Uint8Array): string {
  const hex = bytesToHex(bytes)
  const known: Record<string, string> = {
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

function extractCertIssuerName(certDer: Uint8Array): string {
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
    const rdns: string[] = []
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

function extractCertPublicKeySpki(certDer: Uint8Array): Uint8Array {
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

function canonicalizeInvoiceContent(xmlString: string): string {
  const doc: any = new DOMParser().parseFromString(xmlString, 'application/xml')
  const ublExts = Array.from(doc.getElementsByTagNameNS(NS.ext, 'UBLExtensions') as any) as any[]
  for (const el of ublExts) el.parentNode?.removeChild(el)

  const sigs = Array.from(doc.getElementsByTagNameNS(NS.cac, 'Signature') as any) as any[]
  for (const el of sigs) el.parentNode?.removeChild(el)

  const adrList = Array.from(doc.getElementsByTagNameNS(NS.cac, 'AdditionalDocumentReference') as any) as any[]
  for (const adr of adrList) {
    const idEl = (adr.getElementsByTagNameNS(NS.cbc, 'ID') as any)[0]
    if (idEl?.textContent === 'QR') {
      adr.parentNode?.removeChild(adr)
      break
    }
  }

  return c14n(doc.documentElement)
}

async function computeInvoiceHash(xmlString: string): Promise<string> {
  const invoiceCanonical = canonicalizeInvoiceContent(xmlString)
  const invoiceDigestBuf = await sha256(invoiceCanonical)
  return bytesToBase64(new Uint8Array(invoiceDigestBuf))
}

async function assertInvoiceHashMatches(signedXml: string, invoiceHash: string): Promise<void> {
  const recomputedHash = await computeInvoiceHash(signedXml)
  if (recomputedHash !== invoiceHash) {
    throw new Error('Compliance sample invoice hash does not match signed XML payload')
  }
}

function c14n(node: any, inherited: Map<string, string> = new Map()): string {
  const localNs = new Map<string, string>()
  const attrs: any[] = []
  for (let i = 0; i < node.attributes.length; i++) attrs.push(node.attributes[i])

  for (const attr of attrs) {
    if (attr.name === 'xmlns') localNs.set('', attr.value)
    else if (attr.name.startsWith('xmlns:')) localNs.set(attr.name.slice(6), attr.value)
  }

  const nsDecls: [string, string][] = []
  const emitNs = (prefix: string, uri: string) => {
    if (inherited.get(prefix) !== uri) nsDecls.push([prefix, uri])
  }

  const elNs = node.namespaceURI ?? ''
  const elPrefix = node.prefix ?? ''
  if (elPrefix === '' && elNs !== (inherited.get('') ?? '')) emitNs('', elNs)
  else if (elPrefix && elNs !== (inherited.get(elPrefix) ?? '')) emitNs(elPrefix, elNs)

  for (const [prefix, uri] of localNs) {
    if (!nsDecls.find(decl => decl[0] === prefix)) emitNs(prefix, uri)
  }
  for (const attr of attrs) {
    if (attr.namespaceURI && attr.prefix && !nsDecls.find(decl => decl[0] === attr.prefix)) {
      emitNs(attr.prefix, attr.namespaceURI)
    }
  }

  nsDecls.sort(([a], [b]) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))

  const regAttrs = attrs
    .filter(attr => attr.name !== 'xmlns' && !attr.name.startsWith('xmlns:'))
    .sort((a, b) => {
      const aNs = a.namespaceURI ?? ''
      const bNs = b.namespaceURI ?? ''
      return aNs !== bNs ? aNs.localeCompare(bNs) : a.localName.localeCompare(b.localName)
    })

  let out = `<${node.tagName}`
  for (const [prefix, uri] of nsDecls) out += ` ${prefix === '' ? 'xmlns' : `xmlns:${prefix}`}="${escAttr(uri)}"`
  for (const attr of regAttrs) out += ` ${attr.name}="${escAttr(attr.value)}"`
  out += '>'

  const newInherited = new Map(inherited)
  for (const [prefix, uri] of localNs) newInherited.set(prefix, uri)
  for (const [prefix, uri] of nsDecls) newInherited.set(prefix, uri)

  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (child.nodeType === 1) out += c14n(child, newInherited)
    else if (child.nodeType === 3) out += escText(child.textContent ?? '')
  }

  return out + `</${node.tagName}>`
}

function buildSignedProperties(signingTime: string, certDigest: string, issuerDn: string, serialNumber: string): string {
  const indent = (n: number) => '\n' + ' '.repeat(n)
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

function toSignedPropsHashInput(sp: string): string {
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

function buildSignedInfo(invoiceDigest: string, signedPropsDigest: string): string {
  return `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`
}

function buildSignedInfoCanonical(invoiceDigest: string, signedPropsDigest: string): string {
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

function buildXadesBlock(
  invoiceDigest: string,
  signedPropsDigest: string,
  sigValue: string,
  certPemBody: string,
  issuerDn: string,
  serialNumber: string,
  signingTime: string,
  certDigest: string,
): string {
  const signedInfo = buildSignedInfo(invoiceDigest, signedPropsDigest)
  const signedProps = buildSignedProperties(signingTime, certDigest, issuerDn, serialNumber)
  return `<sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">${signedInfo}<ds:SignatureValue>${sigValue}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certPemBody}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">${signedProps}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures>`
}

function buildPhase2QR(
  sellerName: string,
  vatNumber: string,
  timestamp: string,
  totalAmount: number,
  vatAmount: number,
  hashB64: string,
  sigB64: string,
  pubKeySpki: Uint8Array,
  certSigValue: Uint8Array,
): string {
  const all = concatArrays(
    tlvStr(0x01, sellerName),
    tlvStr(0x02, vatNumber),
    tlvStr(0x03, new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z')),
    tlvStr(0x04, totalAmount.toFixed(2)),
    tlvStr(0x05, vatAmount.toFixed(2)),
    tlvStr(0x06, hashB64),
    tlvStr(0x07, sigB64),
    tlvBytes(0x08, pubKeySpki),
    tlvBytes(0x09, certSigValue),
  )
  return bytesToBase64(all)
}

function tlvStr(tag: number, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  return tlvBytes(tag, bytes)
}

function tlvBytes(tag: number, bytes: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2 + bytes.length)
  buf[0] = tag
  buf[1] = bytes.length
  buf.set(bytes, 2)
  return buf
}

function concatArrays(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((sum, arr) => sum + arr.length, 0)
  const out = new Uint8Array(len)
  let offset = 0
  for (const arr of arrs) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

function saudiIssueDate(date: Date): { date: string; time: string } {
  const saudi = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const [day, time] = saudi.toISOString().split('T')
  return { date: day, time: time.split('.')[0] }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')
}

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;')
}

function utf8ToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
