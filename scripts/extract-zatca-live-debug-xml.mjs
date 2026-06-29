import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { createHash } from 'node:crypto'

const OUT_DIR = '.zatca-debug'
const OUT_XML = `${OUT_DIR}/live-failed-simplified-invoice.xml`

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

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else files.push(path)
  }
  return files
}

function extractFromJson(value) {
  if (!value || typeof value !== 'object') return undefined
  if (typeof value.debugSignedInvoiceXmlBase64 === 'string') {
    return {
      xmlBase64: value.debugSignedInvoiceXmlBase64,
      debugInvoiceHash: typeof value.debugInvoiceHash === 'string' ? value.debugInvoiceHash : undefined,
      debugTransformedCanonicalHash: typeof value.debugTransformedCanonicalHash === 'string'
        ? value.debugTransformedCanonicalHash
        : undefined,
    }
  }
  if (typeof value.signed_invoice_xml_base64 === 'string') {
    return {
      xmlBase64: value.signed_invoice_xml_base64,
      debugInvoiceHash: typeof value.invoice_hash === 'string' ? value.invoice_hash : undefined,
      debugTransformedCanonicalHash: typeof value.transformed_canonical_hash === 'string'
        ? value.transformed_canonical_hash
        : undefined,
      source: value.id ? `zatca_production_debug_samples:${value.id}` : 'zatca_production_debug_samples',
      row: value,
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractFromJson(item)
      if (found) return found
    }
    return undefined
  }
  for (const nested of Object.values(value)) {
    const found = extractFromJson(nested)
    if (found) return found
  }
  return undefined
}

function extractFromText(text) {
  try {
    const parsed = JSON.parse(text)
    const found = extractFromJson(parsed)
    if (found) return found
  } catch {
    // Continue with loose text extraction.
  }

  const xmlBase64 =
    text.match(/"debugSignedInvoiceXmlBase64"\s*:\s*"([^"]+)"/)?.[1] ??
    text.match(/debugSignedInvoiceXmlBase64\s*[:=]\s*([A-Za-z0-9+/=]+)/)?.[1] ??
    text.match(/Signed sample XML base64:\s*([A-Za-z0-9+/=\s]+)/)?.[1]?.replace(/\s+/g, '')

  if (!xmlBase64) return undefined

  return {
    xmlBase64,
    debugInvoiceHash:
      text.match(/"debugInvoiceHash"\s*:\s*"([^"]+)"/)?.[1] ??
      text.match(/Sent invoiceHash:\s*([^\n]+)/)?.[1]?.trim(),
    debugTransformedCanonicalHash:
      text.match(/"debugTransformedCanonicalHash"\s*:\s*"([^"]+)"/)?.[1] ??
      text.match(/Canonical transformed hash:\s*([^\n]+)/)?.[1]?.trim(),
  }
}

async function findDebugPayload() {
  const explicit = argValue('--input')
  if (hasArg('--from-supabase')) return fetchLatestDebugPayload()

  const candidates = explicit
    ? [explicit]
    : (await listFiles(OUT_DIR))
      .filter(path => ['.json', '.txt', '.log'].includes(extname(path)))
      .sort()
      .reverse()

  for (const path of candidates) {
    const text = await readFile(path, 'utf8').catch(() => '')
    if (!text.includes('debugSignedInvoiceXmlBase64') && !text.includes('Signed sample XML base64')) continue
    const found = extractFromText(text)
    if (found?.xmlBase64) return { ...found, source: path }
  }
  return fetchLatestDebugPayload().catch(() => undefined)
}

async function fetchLatestDebugPayload() {
  await loadEnvFile()

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const branchId = argValue('--branch-id')

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Set SUPABASE_URL or VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to fetch latest debug XML from Supabase.')
  }

  const keyPayload = decodeJwtPayload(serviceKey)
  const keyRole = typeof keyPayload.role === 'string' ? keyPayload.role : 'unknown'
  if (keyRole !== 'service_role') {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY does not look like a service_role JWT (detected role: ${keyRole}). Use the project's service role key, not anon/authenticated keys.`)
  }

  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/zatca_production_debug_samples`
  const query = new URLSearchParams({
    select: '*',
    order: 'created_at.desc',
    limit: '1',
  })
  if (branchId) query.set('branch_id', `eq.${branchId}`)

  const res = await fetch(`${base}?${query.toString()}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const details = await res.text().catch(() => '')
    const safeDetails = details
      .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
      .slice(0, 500)
    const hint = res.status === 401
      ? 'Check SUPABASE_SERVICE_ROLE_KEY; the request was not authenticated.'
      : res.status === 403
        ? 'Check that supabase/zatca-production-debug-samples.sql was applied, including GRANT SELECT and the service_role SELECT policy.'
        : 'Check Supabase URL, table existence, and service-role permissions.'
    throw new Error(`Supabase debug fetch failed: HTTP ${res.status}. ${hint}${safeDetails ? ` Response: ${safeDetails}` : ''}`)
  }

  const rows = await res.json()
  const row = Array.isArray(rows) ? rows[0] : undefined
  const found = extractFromJson(row)
  if (!found?.xmlBase64) {
    throw new Error('No rows found in zatca_production_debug_samples.')
  }
  return {
    ...found,
    source: found.source ?? 'zatca_production_debug_samples',
  }
}

function rootWithC14nNamespaces(xml) {
  return xml.replace(
    /<Invoice xmlns="[^"]+" xmlns:cac="[^"]+" xmlns:cbc="[^"]+" xmlns:ext="[^"]+" xmlns:sig="[^"]+" xmlns:sac="[^"]+" xmlns:sbc="[^"]+" xmlns:ds="[^"]+" xmlns:xades="[^"]+">/,
    `<Invoice xmlns="${NS.invoice}" xmlns:cac="${NS.cac}" xmlns:cbc="${NS.cbc}" xmlns:ds="${NS.ds}" xmlns:ext="${NS.ext}" xmlns:sac="${NS.sac}" xmlns:sbc="${NS.sbc}" xmlns:sig="${NS.sig}" xmlns:xades="${NS.xades}">`,
  )
}

function canonicalizeInvoiceContent(xml) {
  return expandSelfClosingElements(rootWithC14nNamespaces(xml)
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
    .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, ''))
}

function expandSelfClosingElements(xml) {
  return xml.replace(/<([A-Za-z_][\w:.-]*)([^<>]*)\/>/g, '<$1$2></$1>')
}

function sha256Base64(value) {
  return createHash('sha256').update(value, 'utf8').digest('base64')
}

async function main() {
  const found = await findDebugPayload()
  if (!found) {
    throw new Error('No debugSignedInvoiceXmlBase64 found. Save the copied Edge response/error text as .zatca-debug/live-response.json or pass --input <file>.')
  }

  const xml = Buffer.from(found.xmlBase64.replace(/\s+/g, ''), 'base64').toString('utf8')
  if (!xml.includes('<Invoice')) throw new Error(`Decoded payload from ${found.source} does not look like XML.`)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_XML, xml)

  const transformedHash = sha256Base64(canonicalizeInvoiceContent(xml))
  const summary = {
    source: found.source,
    output: OUT_XML,
    sampleType: found.row?.sample_type ?? null,
    branchId: found.row?.branch_id ?? null,
    createdAt: found.row?.created_at ?? null,
    debugInvoiceHash: found.debugInvoiceHash ?? null,
    debugTransformedCanonicalHash: found.debugTransformedCanonicalHash ?? null,
    decodedTransformedHash: transformedHash,
    decodedMatchesDebugInvoiceHash: found.debugInvoiceHash ? transformedHash === found.debugInvoiceHash : null,
    decodedMatchesDebugTransformedCanonicalHash: found.debugTransformedCanonicalHash
      ? transformedHash === found.debugTransformedCanonicalHash
      : null,
  }

  await writeFile(`${OUT_DIR}/live-failed-simplified-invoice.summary.json`, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
