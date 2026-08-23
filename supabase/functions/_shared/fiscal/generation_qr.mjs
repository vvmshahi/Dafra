import { buildTlvBase64 } from './tlv.mjs'

const GENERATION_TAGS = Object.freeze([1, 2, 3, 4, 5])

export function buildGenerationQr({
  sellerName,
  sellerVatNumber,
  timestamp,
  totalIncludingVat,
  vatTotal,
}) {
  const qr = buildTlvBase64([
    { tag: 1, value: normalizeText(sellerName, 'seller name') },
    { tag: 2, value: normalizeVat(sellerVatNumber) },
    { tag: 3, value: normalizeTimestamp(timestamp) },
    { tag: 4, value: normalizeAmount(totalIncludingVat, 'total including VAT') },
    { tag: 5, value: normalizeAmount(vatTotal, 'VAT total') },
  ])
  return qr
}

export function generationQrTags() {
  return GENERATION_TAGS.slice()
}

function normalizeText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
  return value.trim()
}

function normalizeVat(value) {
  const vat = normalizeText(value, 'seller VAT registration number')
  if (!/^\d{15}$/.test(vat)) throw new Error('seller VAT registration number must contain 15 digits')
  return vat
}

function normalizeTimestamp(value) {
  const timestamp = normalizeText(value, 'invoice timestamp')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
    throw new Error('invoice timestamp must be ISO 8601 with timezone')
  }
  return timestamp
}

function normalizeAmount(value, label) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number`)
  return number.toFixed(2)
}
