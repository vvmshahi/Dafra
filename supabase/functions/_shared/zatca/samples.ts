import { create as xmlCreate } from 'https://esm.sh/xmlbuilder2@4.0.3'
import { secp256k1 } from 'https://esm.sh/@noble/curves@2.2.0/secp256k1.js'
import { extractEcPrivateKeyScalar, signZatcaInvoiceHash } from './signing_core.mjs'
import { buildZatcaPhase2Qr } from './phase2_qr.mjs'
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
  redactedWarnings?: Array<{ code?: string; message?: string }>
  redactedErrors?: Array<{ code?: string; message?: string }>
  responseBodySafeSummary?: string
  zatcaHeaders?: Record<string, string>
  debugInvoiceHash?: string
  debugSignedInvoiceXmlBase64?: string
  debugIssueDate?: string
  debugIssueTime?: string
  debugQrTimestamp?: string
  debugTransformedCanonicalHash?: string
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
  onTrace?: (event: ComplianceSampleTraceEvent) => void
}

export interface ComplianceSampleTraceEvent {
  stage: 'sample_payload_built' | 'zatca_sample_request_started' | 'zatca_sample_response_received'
  type: ComplianceSampleType
  status: 'success' | 'failed'
  httpStatus?: number
  message?: string
  redactedWarnings?: Array<{ code?: string; message?: string }>
  redactedErrors?: Array<{ code?: string; message?: string }>
}

interface SignedCompliancePayload {
  type: ComplianceSampleType
  uuid: string
  invoiceHash: string
  invoice: string
  signedXml: string
  isStandard: boolean
  issueDate: string
  issueTime: string
  qrTimestamp: string
  transformedCanonicalHash: string
}

export interface SandboxComplianceValidationInvoice {
  documentKind: 'invoice' | 'credit_note'
  invoiceNumber: string
  uuid: string
  issueDate: string
  issueTime: string
  seller: SampleSeller
  subtotal: number
  discountTotal: number
  taxableAmount: number
  taxAmount: number
  totalAmount: number
  billingReferenceId?: string
  noteReason?: string
  lines: Array<{
    id: number
    name: string
    quantity: number
    discountAmount: number
    lineNetAmount: number
    taxRate: number
    taxAmount: number
    lineTotal: number
  }>
}

export interface PreparedSandboxComplianceValidation {
  documentKind: 'invoice' | 'credit_note'
  invoiceHash: string
  uuid: string
  invoice: string
  signedXml: string
  signatureValue?: string
  qrCode?: string
}

class ComplianceSampleAssertionError extends Error {
  statusString: string

  constructor(statusString: string, message: string) {
    super(message)
    this.name = 'ComplianceSampleAssertionError'
    this.statusString = statusString
  }
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

  for (const [index, type] of sampleTypes.entries()) {
    let payload: SignedCompliancePayload
    try {
      logComplianceSampleStage('sample payload build started', type)
      payload = await buildCompliancePayload(params, type, index + 1)
      logComplianceSampleStage('sample payload build completed', type)
      params.onTrace?.({
        stage: 'sample_payload_built',
        type,
        status: 'success',
        message: 'Compliance sample payload built locally.',
      })
    } catch (err) {
      const statusString = localFailureStatusString(err, 'PAYLOAD_BUILD_FAILED')
      logComplianceSampleException(type, statusString, err)
      params.onTrace?.({
        stage: 'sample_payload_built',
        type,
        status: 'failed',
        message: safeLocalDiagnosticMessage(err),
      })
      results.push(buildLocalComplianceFailure(type, statusString, err))
      continue
    }

    const result = await submitComplianceSample(params, payload)
    results.push(result)
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
    profileId: 'reporting:1.0',
    typeCodeName: data.isSimplified ? '0200000' : '0100000',
    invoiceTypeCode: data.invoiceTypeCode,
    requireBuyer: !data.isSimplified,
  })
  const { signedXml, invoiceHash, qrTimestamp, transformedCanonicalHash } = await signInvoice(
    unsignedXml,
    privateKey,
    params.complianceCertificate,
    safeSampleTimestamp(data.issueDateTime, data.issueDate, data.issueTime),
  )

  return {
    type,
    uuid: data.uuid,
    invoiceHash,
    invoice: utf8ToBase64(signedXml),
    signedXml,
    isStandard: !data.isSimplified,
    issueDate: data.issueDate,
    issueTime: data.issueTime,
    qrTimestamp,
    transformedCanonicalHash,
  }
}

async function submitComplianceSample(
  params: SubmitComplianceSamplesParams,
  payload: SignedCompliancePayload,
): Promise<ComplianceSampleResult> {
  try {
    const credentials = btoa(`${params.complianceCsid}:${params.complianceSecret}`)
    const requestBody = await buildFinalComplianceRequestBody(payload)

    logComplianceSampleStage('ZATCA sample submit started', payload.type)
    params.onTrace?.({
      stage: 'zatca_sample_request_started',
      type: payload.type,
      status: 'success',
      message: 'Compliance sample request started.',
    })
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
      body: JSON.stringify(requestBody),
    })
    logComplianceSampleStage('sample submit completed', payload.type, { httpStatus: res.status })

    const body = await safeJson(res)
    const result = safeSummarizeComplianceResponse(payload.type, res.status, body, res.headers)
    params.onTrace?.({
      stage: 'zatca_sample_response_received',
      type: payload.type,
      status: result.status === 'accepted' ? 'success' : 'failed',
      httpStatus: res.status,
      message: result.message,
      redactedWarnings: result.redactedWarnings,
      redactedErrors: result.redactedErrors,
    })

    if (result.status !== 'accepted') {
      attachFailedSampleXmlDebug(result, payload)
      try {
        console.warn('[zatca-compliance-samples] rejection:', JSON.stringify(stripComplianceSampleDebug([result])[0] ?? {}))
      } catch {
        console.warn('[zatca-compliance-samples] rejection: diagnostics stringify failed')
      }
    }

    return result
  } catch (err) {
    const statusString = localFailureStatusString(err, 'COMPLIANCE_SAMPLE_SUBMISSION_FAILED')
    logComplianceSampleException(payload.type, statusString, err)
    const result = buildLocalComplianceFailure(payload.type, statusString, err)
    attachFailedSampleXmlDebug(result, payload)
    params.onTrace?.({
      stage: 'zatca_sample_response_received',
      type: payload.type,
      status: 'failed',
      message: result.message,
      redactedWarnings: result.redactedWarnings,
      redactedErrors: result.redactedErrors,
    })
    return result
  }
}

async function buildFinalComplianceRequestBody(payload: SignedCompliancePayload): Promise<{
  invoiceHash: string
  uuid: string
  invoice: string
}> {
  const finalSignedXml = payload.signedXml
  const finalInvoiceHash = await computeInvoiceHash(finalSignedXml)

  if (
    finalInvoiceHash !== payload.invoiceHash ||
    finalInvoiceHash !== payload.transformedCanonicalHash
  ) {
    throw new Error('Final ZATCA compliance sample hash assertion failed before submission.')
  }

  const finalInvoice = utf8ToBase64(finalSignedXml)
  if (finalInvoice !== payload.invoice) {
    throw new Error('Final ZATCA compliance sample invoice payload assertion failed before submission.')
  }

  return {
    invoiceHash: finalInvoiceHash,
    uuid: payload.uuid,
    invoice: finalInvoice,
  }
}

export async function prepareSandboxComplianceValidation(params: {
  invoice: SandboxComplianceValidationInvoice
  complianceCertificate: string
  privateKeyPem: string
}): Promise<PreparedSandboxComplianceValidation> {
  const input = params.invoice
  const data = {
    isSimplified: true,
    invoiceNumber: input.invoiceNumber,
    uuid: input.uuid,
    issueDate: input.issueDate,
    issueTime: input.issueTime,
    issueDateTime: `${input.issueDate}T${input.issueTime}`,
    invoiceTypeCode: input.documentKind === 'credit_note' ? '381' : '388',
    counterValue: 1,
    prevInvoiceHash: FIRST_INVOICE_HASH,
    sellerName: input.seller.name,
    sellerVat: input.seller.vatNumber,
    sellerCrn: input.seller.crNumber,
    sellerAddress: {
      street: input.seller.street,
      buildingNo: input.seller.buildingNumber,
      district: input.seller.district,
      city: input.seller.city,
      postalCode: input.seller.postalCode,
      countryCode: input.seller.countryCode,
    },
    buyer: undefined,
    billingReferenceId: input.billingReferenceId,
    noteReason: input.noteReason,
    subtotal: input.subtotal,
    discountTotal: input.discountTotal,
    taxableAmount: input.taxableAmount,
    taxAmount: input.taxAmount,
    totalAmount: input.totalAmount,
    lines: input.lines.map(line => ({
      id: line.id,
      name: line.name,
      qty: line.quantity,
      discountAmt: line.discountAmount,
      lineNetAmt: line.lineNetAmount,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      lineTotal: line.lineTotal,
    })),
    taxBreakdowns: [{
      taxableAmount: input.taxableAmount,
      taxAmount: input.taxAmount,
      vatCategoryCode: 'S',
      taxRate: 0.15,
    }],
    qrCode: '',
  }
  const unsignedXml = buildInvoice(data, {
    profileId: 'reporting:1.0',
    typeCodeName: '0200000',
    invoiceTypeCode: input.documentKind === 'credit_note' ? '381' : '388',
    requireBuyer: false,
  })
  const signed = await signInvoice(
    unsignedXml,
    privateKeyFromPem(params.privateKeyPem),
    params.complianceCertificate,
    `${input.issueDate}T${input.issueTime}`,
  )
  const payload: SignedCompliancePayload = {
    type: input.documentKind === 'credit_note' ? 'simplified_credit_note' : 'simplified_invoice',
    uuid: input.uuid,
    invoiceHash: signed.invoiceHash,
    invoice: utf8ToBase64(signed.signedXml),
    signedXml: signed.signedXml,
    isStandard: false,
    issueDate: input.issueDate,
    issueTime: input.issueTime,
    qrTimestamp: signed.qrTimestamp,
    transformedCanonicalHash: signed.transformedCanonicalHash,
  }
  const finalRequest = await buildFinalComplianceRequestBody(payload)
  return {
    ...finalRequest,
    documentKind: input.documentKind,
    signedXml: signed.signedXml,
  }
}

export async function submitSandboxComplianceValidation(params: {
  baseUrl: string
  complianceCsid: string
  complianceSecret: string
  prepared: PreparedSandboxComplianceValidation
}): Promise<ComplianceSampleResult> {
  const credentials = btoa(`${params.complianceCsid}:${params.complianceSecret}`)
  try {
    const response = await fetch(`${params.baseUrl}/compliance/invoices`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-version': 'V2',
        'accept-language': 'en',
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        invoiceHash: params.prepared.invoiceHash,
        uuid: params.prepared.uuid,
        invoice: params.prepared.invoice,
      }),
    })
    return safeSummarizeComplianceResponse(
      params.prepared.documentKind === 'credit_note' ? 'simplified_credit_note' : 'simplified_invoice',
      response.status,
      await safeJson(response),
      response.headers,
    )
  } catch {
    const creditNote = params.prepared.documentKind === 'credit_note'
    return {
      type: creditNote ? 'simplified_credit_note' : 'simplified_invoice',
      invoiceKind: 'simplified',
      documentKind: creditNote ? 'credit_note' : 'invoice',
      accepted: false,
      status: 'ambiguous_failed',
      statusString: 'COMPLIANCE_VALIDATION_TRANSPORT_FAILED',
      warningsCount: 0,
      errorsCount: 0,
      redactedWarnings: [],
      redactedErrors: [],
      message: 'Sandbox compliance validation did not return a definitive response.',
    }
  }
}

function safeSummarizeComplianceResponse(
  type: ComplianceSampleType,
  httpStatus: number,
  body: any,
  headers?: Headers,
): ComplianceSampleResult {
  try {
    return summarizeComplianceResponse(type, httpStatus, body ?? {}, safeZatcaHeaders(headers))
  } catch (err) {
    console.error('[zatca-compliance-samples] extraction failed:', safeText(err instanceof Error ? err.message : String(err ?? 'unknown')) ?? 'diagnostic error')
    return fallbackComplianceResult(type, httpStatus)
  }
}

function attachFailedSampleXmlDebug(result: ComplianceSampleResult, payload: SignedCompliancePayload): void {
  try {
    if (Deno.env.get('ZATCA_CAPTURE_DEBUG_XML') !== 'true') return

    result.debugInvoiceHash = safeDebugText(payload?.invoiceHash, 500)
    result.debugSignedInvoiceXmlBase64 = safeDebugText(payload?.invoice, 80_000)
    result.debugIssueDate = safeDebugText(payload?.issueDate, 40)
    result.debugIssueTime = safeDebugText(payload?.issueTime, 40)
    result.debugQrTimestamp = safeDebugText(payload?.qrTimestamp, 80)
    result.debugTransformedCanonicalHash = safeDebugText(payload?.transformedCanonicalHash, 500)
  } catch {
    // Diagnostic capture must never change onboarding behavior.
  }
}

function buildLocalComplianceFailure(
  type: ComplianceSampleType,
  statusString: string,
  err?: unknown,
): ComplianceSampleResult {
  const message = safeLocalDiagnosticMessage(err)
  return {
    type,
    invoiceKind: invoiceKindFor(type),
    documentKind: documentKindFor(type),
    accepted: false,
    status: 'blocked',
    statusString,
    warningsCount: 0,
    errorsCount: 1,
    redactedWarnings: [],
    redactedErrors: [{
      code: statusString,
      message,
    }],
    responseBodySafeSummary: message,
    message,
  }
}

function isFinalHashAssertionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return message.includes('Final ZATCA compliance sample')
}

function localFailureStatusString(err: unknown, fallback: string): string {
  if (isComplianceSampleAssertionError(err)) return err.statusString
  return isFinalHashAssertionError(err) ? 'FINAL_HASH_ASSERTION_FAILED' : fallback
}

function isComplianceSampleAssertionError(err: unknown): err is ComplianceSampleAssertionError {
  return err instanceof ComplianceSampleAssertionError ||
    (err instanceof Error &&
      err.name === 'ComplianceSampleAssertionError' &&
      typeof (err as any).statusString === 'string')
}

function logComplianceSampleStage(
  stage: string,
  type: ComplianceSampleType,
  context?: Record<string, unknown>,
): void {
  try {
    const safeContext: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(context ?? {})) {
      safeContext[key] = safeExceptionField(String(value ?? ''), 160)
    }
    console.info('[zatca-compliance-samples] stage:', JSON.stringify({
      stage: safeStageField(stage, 120),
      sampleType: type,
      ...safeContext,
    }))
  } catch {
    console.info('[zatca-compliance-samples] stage: diagnostics stringify failed')
  }
}

function logComplianceSampleException(
  type: ComplianceSampleType,
  stage: string,
  err: unknown,
): void {
  try {
    console.error('[zatca-compliance-samples] local exception:', JSON.stringify({
      sampleType: type,
      stage: safeExceptionField(stage, 120),
      errorName: safeExceptionField(err instanceof Error ? err.name : typeof err, 120),
      message: safeExceptionField(err instanceof Error ? err.message : String(err ?? 'unknown'), 300),
    }))
  } catch {
    console.error('[zatca-compliance-samples] local exception: diagnostics stringify failed')
  }
}

export function stripComplianceSampleDebug(results: ComplianceSampleResult[] | undefined): ComplianceSampleResult[] {
  try {
    return (Array.isArray(results) ? results : []).map(result => {
      const safeResult = { ...((result ?? {}) as ComplianceSampleResult) }
      delete safeResult.debugInvoiceHash
      delete safeResult.debugSignedInvoiceXmlBase64
      delete safeResult.debugIssueDate
      delete safeResult.debugIssueTime
      delete safeResult.debugQrTimestamp
      delete safeResult.debugTransformedCanonicalHash
      return safeResult as ComplianceSampleResult
    })
  } catch {
    return []
  }
}

function summarizeComplianceResponse(
  type: ComplianceSampleType,
  httpStatus: number,
  body: any,
  zatcaHeaders?: Record<string, string>,
): ComplianceSampleResult {
  const invoiceKind = invoiceKindFor(type)
  const documentKind = documentKindFor(type)
  const validationStatus = upperString(body?.validationResults?.status)
  const reportingStatus = upperString(body?.reportingStatus)
  const clearanceStatus = upperString(body?.clearanceStatus)
  const redactedWarnings = redactedZatcaWarnings(body)
  const redactedErrors = redactedZatcaErrors(body)
  const errorsCount = redactedErrors.length
  const warningsCount = redactedWarnings.length
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
    redactedWarnings,
    redactedErrors,
    responseBodySafeSummary: safeBodySummary(body),
    zatcaHeaders,
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
  try {
    const text = await res?.text?.()
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return { _parseFailed: true, _textSummary: safeText(text.slice(0, 600)) }
    }
  } catch {
    return { _parseFailed: true }
  }
}

function upperString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toUpperCase() : undefined
}

function redactedZatcaWarnings(body: any): Array<{ code?: string; message?: string }> {
  try {
    const values = [
      ...arrayValue(body?.warnings),
      ...arrayValue(body?.validationResults?.warningMessages),
    ]
    return redactZatcaMessages(values)
  } catch {
    return []
  }
}

function redactedZatcaErrors(body: any): Array<{ code?: string; message?: string }> {
  try {
    const values = [
      ...arrayValue(body?.errors),
      ...arrayValue(body?.validationResults?.errorMessages),
    ]
    return redactZatcaMessages(values)
  } catch {
    return []
  }
}

function redactZatcaMessages(values: any[]): Array<{ code?: string; message?: string }> {
  try {
    return arrayValue(values).slice(0, 5).map(item => ({
      code: safeText(item?.code ?? item?.type ?? item?.category),
      message: safeText(item?.message ?? item?.error ?? item?.description ?? (typeof item === 'string' ? item : undefined)),
    })).filter(item => item.code || item.message)
  } catch {
    return []
  }
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  if (!cleaned) return undefined
  if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|xml/i.test(cleaned)) {
    return 'Sensitive detail redacted.'
  }
  return cleaned
}

function safeDebugText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, '').slice(0, maxLength)
  if (!cleaned) return undefined
  return cleaned
}

function safeLocalDiagnosticMessage(err: unknown): string {
  const fallback = 'ZATCA compliance sample failed before submission. Sensitive details were redacted.'
  try {
    const raw = err instanceof Error ? err.message : String(err ?? fallback)
    const cleaned = raw
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220)
    if (!cleaned) return fallback
    if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|xml|invoice/i.test(cleaned)) {
      return fallback
    }
    return cleaned
  } catch {
    return fallback
  }
}

function safeExceptionField(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  if (!cleaned) return undefined
  if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|<\?xml|<Invoice|signedInvoiceXmlBase64|signed_invoice_xml_base64/i.test(cleaned)) {
    return 'Sensitive detail redacted.'
  }
  return cleaned
}

function safeStageField(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  return cleaned || undefined
}

function safeSampleTimestamp(value: unknown, issueDate?: unknown, issueTime?: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return value
  }

  const date = typeof issueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(issueDate)
    ? issueDate
    : undefined
  const time = typeof issueTime === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(issueTime)
    ? issueTime
    : undefined

  if (date && time) return `${date}T${time}`

  const fallback = saudiIssueDate(new Date())
  return fallback.dateTime
}

function extractInvoiceTimestamp(xmlString: string): { issueDate?: string; issueTime?: string } {
  try {
    return {
      issueDate: (xmlString.match(/<cbc:IssueDate[^>]*>([^<]+)<\/cbc:IssueDate>/) ?? [])[1],
      issueTime: (xmlString.match(/<cbc:IssueTime[^>]*>([^<]+)<\/cbc:IssueTime>/) ?? [])[1],
    }
  } catch {
    return {}
  }
}

function safeBodySummary(body: any): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  try {
    return safeText(JSON.stringify(redactBodyValue(body)).slice(0, 1200))
  } catch {
    return undefined
  }
}

function redactBodyValue(value: any): any {
  try {
    if (Array.isArray(value)) return value.slice(0, 5).map(redactBodyValue)
    if (!value || typeof value !== 'object') return safePrimitive(value)

    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value ?? {}).slice(0, 30)) {
      if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|xml|invoice/i.test(key ?? '')) {
        out[key] = 'Sensitive detail redacted.'
      } else {
        out[key] = redactBodyValue(nested)
      }
    }
    return out
  } catch {
    return undefined
  }
}

function safePrimitive(value: any): any {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (typeof value !== 'string') return undefined
  return safeText(value) ?? undefined
}

function safeZatcaHeaders(headers?: Headers): Record<string, string> | undefined {
  if (!headers?.get) return undefined
  const interesting = [
    'request-id',
    'x-request-id',
    'correlation-id',
    'x-correlation-id',
    'zatca-correlation-id',
    'x-zatca-correlation-id',
    'trace-id',
    'x-trace-id',
  ]
  const values: Record<string, string> = {}
  try {
    for (const name of interesting) {
      const value = safeText(headers.get(name) ?? undefined)
      if (value) values[name] = value.slice(0, 120)
    }
  } catch {
    return undefined
  }
  return Object.keys(values).length > 0 ? values : undefined
}

function fallbackComplianceResult(type: ComplianceSampleType, httpStatus: number): ComplianceSampleResult {
  const invoiceKind = invoiceKindFor(type)
  return {
    type,
    invoiceKind,
    documentKind: documentKindFor(type),
    accepted: false,
    status: 'blocked',
    httpStatus,
    statusString: `HTTP_${httpStatus}`,
    warningsCount: 0,
    errorsCount: 0,
    redactedWarnings: [],
    redactedErrors: [],
    message: 'ZATCA compliance check failed for this sample.',
  }
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
    issueDateTime: issue.dateTime,
    supplyDate: !isSimplified && noteKind === 'invoice' ? issue.date : undefined,
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

  if (data.supplyDate) {
    root.ele(NS.cac, 'Delivery').ele(NS.cbc, 'ActualDeliveryDate').txt(data.supplyDate)
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
    if (line.discountAmt > 0) {
      const allowance = il.ele(NS.cac, 'AllowanceCharge')
      allowance.ele(NS.cbc, 'ChargeIndicator').txt('false')
      allowance.ele(NS.cbc, 'AllowanceChargeReason').txt('discount')
      allowance.ele(NS.cbc, 'Amount').att('currencyID', 'SAR').txt(fmt(line.discountAmt))
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

async function signInvoice(xmlString: string, secretKey: Uint8Array, certificate: string, sampleTimestamp: string): Promise<{
  signedXml: string
  invoiceHash: string
  qrTimestamp: string
  transformedCanonicalHash: string
}> {
  const { certPemBody, certDer } = decodeCertificateToken(certificate)
  const serialNumber = extractCertSerial(certDer)
  const issuerName = extractCertIssuerName(certDer)
  const certSigValue = extractCertSignatureValue(certDer)
  const pubKeySpki = extractCertPublicKeySpki(certDer)
  assertPrivateKeyMatchesCertificatePublicKey(secretKey, pubKeySpki)

  const certDigestBytes = new Uint8Array(await sha256Bytes(new TextEncoder().encode(certPemBody)))
  const certDigestHex = bytesToHex(certDigestBytes)
  const certDigestB64 = btoa(certDigestHex)

  // ZATCA invoiceHash is the digest of the invoice after the XMLDSig transforms:
  // remove ext:UBLExtensions, remove cac:Signature, remove QR AdditionalDocumentReference,
  // canonicalize, then SHA-256 + base64. The submitted invoice field remains the final
  // signed XML; it is intentionally not hashed as a whole document.
  const xmlTimestamp = extractInvoiceTimestamp(xmlString)
  const signingTime = safeSampleTimestamp(sampleTimestamp, xmlTimestamp.issueDate, xmlTimestamp.issueTime)
  const signedPropsXml = buildSignedProperties(signingTime, certDigestB64, issuerName, serialNumber)
  const signedPropsHashInput = toSignedPropsHashInput(signedPropsXml)
  const signedPropsBytes = new Uint8Array(await sha256Bytes(new TextEncoder().encode(signedPropsHashInput)))
  const signedPropsB64 = btoa(bytesToHex(signedPropsBytes))

  const stampInvoice = (invoiceDigestB64: string): { signedXml: string; qrTimestamp: string } => {
    // ZATCA SDK signs/verifies SHA256withECDSA over the decoded invoice hash
    // bytes, while ds:SignedInfo carries that same hash as DigestValue.
    const { signatureValueBase64: sigValueB64 } =
      signZatcaInvoiceHash(invoiceDigestB64, secretKey, secp256k1)

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
    const qrTimestamp = safeSampleTimestamp(undefined, issueDate, issueTime)
    const qrCode = buildZatcaPhase2Qr({
      sellerName,
      vatNumber,
      timestamp: qrTimestamp,
      totalAmount,
      vatAmount,
      invoiceHashBase64: invoiceDigestB64,
      signatureValueBase64: sigValueB64,
      publicKeySpki: pubKeySpki,
      certificateSignatureDer: certSigValue,
    })

    signedXml = signedXml.replace(
      /(<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)([^<]*)(<\/cbc:EmbeddedDocumentBinaryObject>)/,
      `$1${qrCode}$3`,
    )

    return { signedXml, qrTimestamp }
  }

  const invoiceHash = await computeInvoiceHash(xmlString)
  const stamped = stampInvoice(invoiceHash)
  const transformedCanonicalHash = await computeInvoiceHash(stamped.signedXml)
  assertFinalSignedXmlConsistency(stamped.signedXml, {
    invoiceHash,
    transformedCanonicalHash,
    issuerName,
    serialNumber,
  })

  return {
    signedXml: stamped.signedXml,
    invoiceHash,
    qrTimestamp: stamped.qrTimestamp,
    transformedCanonicalHash,
  }
}

function assertPrivateKeyMatchesCertificatePublicKey(secretKey: Uint8Array, pubKeySpki: Uint8Array): void {
  const certPublicKey = extractEcPointFromSpki(pubKeySpki)
  if (certPublicKey.length !== 65) {
    throw new ComplianceSampleAssertionError(
      'CERT_PUBLIC_KEY_EXTRACTION_FAILED',
      'Unable to extract ZATCA public key for local signing assertion.',
    )
  }

  const derivedPublicKey = secp256k1.getPublicKey(secretKey, false)
  if (!bytesEqual(derivedPublicKey, certPublicKey)) {
    throw new ComplianceSampleAssertionError(
      'SIGNING_KEY_PUBLIC_KEY_MISMATCH',
      'Signing key does not match ZATCA public key.',
    )
  }
}

function assertFinalSignedXmlConsistency(
  signedXml: string,
  expected: {
    invoiceHash: string
    transformedCanonicalHash: string
    issuerName: string
    serialNumber: string
  },
): void {
  const qrHash = extractQrHashFromXml(signedXml)
  const invoiceDigest = extractFirstDigestValue(signedXml)
  const xmlIssuerName = extractXmlText(signedXml, /<ds:X509IssuerName\b[^>]*>([^<]*)<\/ds:X509IssuerName>/)
  const xmlSerialNumber = extractXmlText(signedXml, /<ds:X509SerialNumber\b[^>]*>([^<]*)<\/ds:X509SerialNumber>/)

  if (expected.transformedCanonicalHash !== expected.invoiceHash) {
    throw new ComplianceSampleAssertionError(
      'FINAL_TRANSFORMED_HASH_MISMATCH',
      'Final transformed hash did not match signed payload hash.',
    )
  }
  if (qrHash !== expected.invoiceHash) {
    throw new ComplianceSampleAssertionError(
      'QR_HASH_MISMATCH',
      'QR tag 6 hash did not match signed payload hash.',
    )
  }
  if (invoiceDigest !== expected.invoiceHash) {
    throw new ComplianceSampleAssertionError(
      'SIGNED_INFO_DIGEST_MISMATCH',
      'XML invoice digest did not match signed payload hash.',
    )
  }
  if (xmlIssuerName !== expected.issuerName) {
    throw new ComplianceSampleAssertionError(
      'ISSUER_METADATA_MISMATCH',
      'XML issuer metadata did not match decoded credential issuer.',
    )
  }
  if (xmlSerialNumber !== expected.serialNumber) {
    throw new ComplianceSampleAssertionError(
      'SERIAL_METADATA_MISMATCH',
      'XML serial metadata did not match decoded credential serial.',
    )
  }
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
  return extractEcPrivateKeyScalar(base64ToBytes(b64))
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
}

async function sha256Bytes(input: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', input)
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

function extractEcPointFromSpki(spki: Uint8Array): Uint8Array {
  return spki[spki.length - 65] === 0x04 ? spki.slice(-65) : new Uint8Array(0)
}

function extractFirstDigestValue(xmlString: string): string | undefined {
  return extractXmlText(xmlString, /<ds:DigestValue\b[^>]*>([^<]*)<\/ds:DigestValue>/)
}

function extractQrHashFromXml(xmlString: string): string | undefined {
  try {
    const qrCode = extractXmlText(
      xmlString,
      /<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject\b[^>]*>([^<]*)<\/cbc:EmbeddedDocumentBinaryObject>/,
    )
    if (!qrCode) return undefined
    const bytes = base64ToBytes(qrCode)
    let offset = 0
    while (offset + 2 <= bytes.length) {
      const tag = bytes[offset++]
      const length = bytes[offset++]
      const value = bytes.slice(offset, offset + length)
      if (tag === 0x06) return new TextDecoder().decode(value)
      offset += length
    }
  } catch {
    return undefined
  }
  return undefined
}

function extractXmlText(xmlString: string, pattern: RegExp): string | undefined {
  return (xmlString.match(pattern) ?? [])[1]
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function canonicalizeInvoiceContent(xmlString: string): string {
  return expandSelfClosingElements(rootWithC14nNamespaces(xmlString)
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, ''))
}

async function computeInvoiceHash(xmlString: string): Promise<string> {
  const invoiceCanonical = canonicalizeInvoiceContent(xmlString)
  const invoiceDigestBuf = await sha256(invoiceCanonical)
  return bytesToBase64(new Uint8Array(invoiceDigestBuf))
}

function rootWithC14nNamespaces(xmlString: string): string {
  return xmlString.replace(
    /<Invoice xmlns="[^"]+" xmlns:cac="[^"]+" xmlns:cbc="[^"]+" xmlns:ext="[^"]+" xmlns:sig="[^"]+" xmlns:sac="[^"]+" xmlns:sbc="[^"]+" xmlns:ds="[^"]+" xmlns:xades="[^"]+">/,
    `<Invoice xmlns="${NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}" xmlns:sig="${NS.sig}" xmlns:xades="${NS.xades}">`,
  )
}

function expandSelfClosingElements(xmlString: string): string {
  return xmlString.replace(/<([A-Za-z_][\w:.-]*)([^<>]*)\/>/g, '<$1$2></$1>')
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
  return `<ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`
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

function saudiIssueDate(date: Date): { date: string; time: string; dateTime: string } {
  const saudi = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const [day, time] = saudi.toISOString().split('T')
  const clock = time.split('.')[0]
  return { date: day, time: clock, dateTime: `${day}T${clock}` }
}

function fmt(n: number): string {
  return n.toFixed(2)
}

function escText(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')
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
