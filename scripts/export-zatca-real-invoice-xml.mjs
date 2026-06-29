import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, resolve } from 'node:path'

const OUT_DIR = '.zatca-debug'
const OUT_XML = `${OUT_DIR}/failed-real-invoice.xml`
const OUT_SUMMARY = `${OUT_DIR}/failed-real-invoice.summary.json`
const DEFAULT_INVOICE_ID = '61219ab8-bbd9-4525-9f4e-7d9dd9da8f24'
const DEFAULT_WORKSPACE_SDK_APPS = 'zatca-docs/zatca-einvoicing-sdk-Java-238-R3.4.8/Apps'
const DEFAULT_DEBUG_SDK_APPS = '.zatca-debug/sdk/zatca-einvoicing-sdk-Java-238-R3.4.8/Apps'
const DEFAULT_DESKTOP_SDK_APPS = `${process.env.HOME ?? ''}/Desktop/zatca-docs/zatca-einvoicing-sdk-Java-238-R3.4.8/Apps`

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

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function hasArg(name) {
  return process.argv.includes(name)
}

async function loadEnvFile(path = '.env') {
  const text = await readFile(path, 'utf8').catch(() => '')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const [key, ...valueParts] = trimmed.split('=')
    if (!process.env[key]) {
      process.env[key] = valueParts.join('=').replace(/^['"]|['"]$/g, '')
    }
  }
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

async function fetchInvoice(invoiceId) {
  await loadEnvFile()

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Set SUPABASE_URL or VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to export invoice XML.')
  }

  const keyRole = decodeJwtPayload(serviceKey).role ?? 'unknown'
  if (keyRole !== 'service_role') {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY does not look like a service_role JWT (detected role: ${keyRole}).`)
  }

  const select = [
    'id',
    'tenant_id',
    'branch_id',
    'invoice_number',
    'zatca_status',
    'zatca_uuid',
    'zatca_invoice_type',
    'zatca_counter_number',
    'zatca_prev_invoice_hash',
    'zatca_xml',
    'zatca_xml_hash',
    'zatca_qr_code',
    'zatca_submitted_at',
    'zatca_clearance_status',
    'zatca_reporting_response',
    'zatca_clearance_response',
    'zatca_warnings',
    'invoice_date',
    'created_at',
  ].join(',')
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/invoices`
  const query = new URLSearchParams({
    select,
    id: `eq.${invoiceId}`,
    limit: '1',
  })
  const res = await fetch(`${base}?${query.toString()}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Supabase invoice fetch failed: HTTP ${res.status}. ${redact(detail).slice(0, 500)}`)
  }

  const rows = await res.json()
  const invoice = Array.isArray(rows) ? rows[0] : undefined
  if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`)
  if (typeof invoice.zatca_xml !== 'string' || !invoice.zatca_xml.includes('<Invoice')) {
    throw new Error(`Invoice ${invoiceId} does not have stored signed zatca_xml.`)
  }
  return invoice
}

function canonicalizeInvoiceContent(xml) {
  return expandSelfClosingElements(rootWithC14nNamespaces(xml)
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, ''))
}

function rootWithC14nNamespaces(xml) {
  return xml.replace(
    /<Invoice xmlns="[^"]+" xmlns:cac="[^"]+" xmlns:cbc="[^"]+" xmlns:ext="[^"]+" xmlns:sig="[^"]+" xmlns:sac="[^"]+" xmlns:sbc="[^"]+" xmlns:ds="[^"]+" xmlns:xades="[^"]+">/,
    `<Invoice xmlns="${NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}" xmlns:sig="${NS.sig}" xmlns:xades="${NS.xades}">`,
  )
}

function expandSelfClosingElements(xml) {
  return xml.replace(/<([A-Za-z_][\w:.-]*)([^<>]*)\/>/g, '<$1$2></$1>')
}

function sha256Base64(value) {
  return createHash('sha256').update(value, 'utf8').digest('base64')
}

function extractXmlText(xml, pattern) {
  return (xml.match(pattern) ?? [])[1] ?? null
}

function extractDigestValues(xml) {
  return Array.from(xml.matchAll(/<ds:DigestValue\b[^>]*>([^<]*)<\/ds:DigestValue>/g), match => match[1])
}

function extractQrFromXml(xml) {
  return extractXmlText(
    xml,
    /<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject\b[^>]*>([^<]*)<\/cbc:EmbeddedDocumentBinaryObject>/,
  )
}

function extractQrTag(qrB64, tag) {
  if (!qrB64) return null
  try {
    const bytes = Buffer.from(qrB64.replace(/\s+/g, ''), 'base64')
    let offset = 0
    while (offset + 2 <= bytes.length) {
      const currentTag = bytes[offset++]
      const length = bytes[offset++]
      const value = bytes.subarray(offset, offset + length)
      if (currentTag === tag) return value.toString('utf8')
      offset += length
    }
  } catch {
    return null
  }
  return null
}

function messageCodes(value) {
  const directErrors = Array.isArray(value?.errors) ? value.errors : []
  const directWarnings = Array.isArray(value?.warnings) ? value.warnings : []
  const validationErrors = Array.isArray(value?.validationResults?.errorMessages)
    ? value.validationResults.errorMessages
    : []
  const validationWarnings = Array.isArray(value?.validationResults?.warningMessages)
    ? value.validationResults.warningMessages
    : []
  return {
    errors: [...directErrors, ...validationErrors]
      .map(item => typeof item?.code === 'string' ? item.code : undefined)
      .filter(Boolean),
    warnings: [...directWarnings, ...validationWarnings]
      .map(item => typeof item?.code === 'string' ? item.code : undefined)
      .filter(Boolean),
  }
}

function summarize(invoice, sdkOutput) {
  const xml = invoice.zatca_xml
  const transformedHash = sha256Base64(canonicalizeInvoiceContent(xml))
  const qrCode = extractQrFromXml(xml) ?? invoice.zatca_qr_code
  const qrHash = extractQrTag(qrCode, 0x06)
  const qrTimestamp = extractQrTag(qrCode, 0x03)
  const digestValues = extractDigestValues(xml)
  const response = invoice.zatca_reporting_response ?? invoice.zatca_clearance_response ?? {}
  const codes = messageCodes(response)

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    tenantId: invoice.tenant_id,
    branchId: invoice.branch_id,
    status: invoice.zatca_status,
    invoiceType: invoice.zatca_invoice_type,
    uuid: invoice.zatca_uuid,
    counterNumber: invoice.zatca_counter_number,
    outputXml: OUT_XML,
    storedXmlHash: invoice.zatca_xml_hash,
    sdkAlignedTransformedHash: transformedHash,
    storedHashMatchesTransformedHash: invoice.zatca_xml_hash === transformedHash,
    qrHash,
    qrHashMatchesTransformedHash: qrHash === transformedHash,
    dsInvoiceDigestValue: digestValues[0] ?? null,
    dsDigestMatchesTransformedHash: (digestValues[0] ?? null) === transformedHash,
    xadesSignedPropertiesDigestValue: digestValues[1] ?? null,
    certificateDigestValue: digestValues[2] ?? null,
    previousInvoiceHash: invoice.zatca_prev_invoice_hash,
    previousHashEqualsCurrentHash: invoice.zatca_prev_invoice_hash === invoice.zatca_xml_hash,
    issueDate: extractXmlText(xml, /<cbc:IssueDate\b[^>]*>([^<]+)<\/cbc:IssueDate>/),
    issueTime: extractXmlText(xml, /<cbc:IssueTime\b[^>]*>([^<]+)<\/cbc:IssueTime>/),
    qrTimestamp,
    signingTime: extractXmlText(xml, /<xades:SigningTime\b[^>]*>([^<]+)<\/xades:SigningTime>/),
    timestampsAligned:
      qrTimestamp === extractXmlText(xml, /<xades:SigningTime\b[^>]*>([^<]+)<\/xades:SigningTime>/) &&
      qrTimestamp === `${extractXmlText(xml, /<cbc:IssueDate\b[^>]*>([^<]+)<\/cbc:IssueDate>/)}T${extractXmlText(xml, /<cbc:IssueTime\b[^>]*>([^<]+)<\/cbc:IssueTime>/)}`,
    reportingStatus: response?.reportingStatus ?? null,
    clearanceStatus: response?.clearanceStatus ?? invoice.zatca_clearance_status ?? null,
    validationStatus: response?.validationResults?.status ?? null,
    errorCodes: codes.errors,
    warningCodes: codes.warnings,
    sdkValidation: sdkOutput ? summarizeSdkOutput(sdkOutput) : null,
  }
}

function sdkAppsDir() {
  const raw = argValue('--sdk-apps') ??
    process.env.ZATCA_SDK_APPS_DIR ??
    (existsSync(DEFAULT_DEBUG_SDK_APPS) ? DEFAULT_DEBUG_SDK_APPS :
      existsSync(DEFAULT_WORKSPACE_SDK_APPS) ? DEFAULT_WORKSPACE_SDK_APPS : DEFAULT_DESKTOP_SDK_APPS)
  return isAbsolute(raw) ? raw : resolve(raw)
}

function validateWithSdk() {
  const appsDir = sdkAppsDir()
  const fatoora = join(appsDir, 'fatoora')
  if (!existsSync(fatoora)) {
    throw new Error(`ZATCA SDK fatoora executable not found at ${fatoora}. Pass --sdk-apps <Apps dir>.`)
  }

  const env = {
    ...process.env,
    JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@11',
    FATOORA_HOME: appsDir,
  }
  env.PATH = `${env.JAVA_HOME}/bin:${env.PATH ?? ''}`

  return execFileSync(fatoora, ['-validate', '-invoice', `${process.cwd()}/${OUT_XML}`], {
    cwd: appsDir,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  })
}

function summarizeSdkOutput(output) {
  const checks = ['XSD', 'EN', 'KSA', 'PIH', 'QR', 'SIGNATURE']
  const summary = {}
  for (const check of checks) {
    const match = output.match(new RegExp(`${check}[^\\n]*(PASSED|FAILED)`, 'i'))
    if (match) summary[check.toLowerCase()] = match[1].toUpperCase()
  }
  const global = output.match(/GLOBAL VALIDATION RESULT\s*=\s*(PASSED|FAILED)/i)
  if (global) summary.global = global[1].toUpperCase()
  return summary
}

function redact(value) {
  return String(value ?? '').replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
}

async function main() {
  const invoiceId = argValue('--invoice-id') ?? DEFAULT_INVOICE_ID
  await mkdir(OUT_DIR, { recursive: true })

  const invoice = await fetchInvoice(invoiceId)
  await writeFile(OUT_XML, invoice.zatca_xml)

  let sdkOutput = null
  if (hasArg('--validate')) {
    sdkOutput = validateWithSdk()
    await writeFile(`${OUT_DIR}/failed-real-invoice.sdk-validation.txt`, sdkOutput)
  }

  const summary = summarize(invoice, sdkOutput)
  await writeFile(OUT_SUMMARY, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
