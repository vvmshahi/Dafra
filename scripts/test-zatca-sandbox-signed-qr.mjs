import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractSignedQrCode } from '../supabase/functions/_shared/zatca/signed_qr.mjs'

const pih = Buffer.alloc(64, 0x35).toString('base64')
const tagLengths = [49, 15, 19, 5, 4, 44, 96, 88, 71]
const tlv = Buffer.concat(tagLengths.map((length, index) =>
  Buffer.concat([Buffer.from([index + 1, length]), Buffer.alloc(length, index + 1)]),
))
const qr = tlv.toString('base64')

assert.equal(pih.length, 88)
assert.equal(tlv.length, 409)
assert.equal(qr.length, 548)

const reference = (id, payload) =>
  `<cac:AdditionalDocumentReference><cbc:ID>${id}</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${payload}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`

assert.equal(
  extractSignedQrCode(`<Invoice>${reference('PIH', pih)}${reference('QR', qr)}</Invoice>`),
  qr,
  'PIH before QR must return QR',
)
assert.equal(
  extractSignedQrCode(`<Invoice>${reference('QR', qr)}${reference('PIH', pih)}</Invoice>`),
  qr,
  'QR before PIH must return QR',
)
assert.equal(
  extractSignedQrCode(`<Invoice>${reference('PIH', pih)}${reference('  QR  ', `  ${qr}\n`)}</Invoice>`),
  qr,
  'surrounding ID and payload whitespace must be trimmed only',
)
assert.notEqual(
  extractSignedQrCode(`<Invoice>${reference('PIH', pih)}${reference('QR', qr)}</Invoice>`),
  pih,
  'PIH must never be returned',
)
assert.throws(
  () => extractSignedQrCode(`<Invoice>${reference('PIH', pih)}</Invoice>`),
  /no QR document reference/,
)
assert.throws(
  () => extractSignedQrCode(`<Invoice>${reference('QR', qr)}${reference('QR', qr)}</Invoice>`),
  /multiple QR document references/,
)
assert.equal(
  extractSignedQrCode(`<Invoice>${reference('QR', qr)}</Invoice>`),
  qr,
  'QR payload must be returned unchanged',
)

const productionSource = fs.readFileSync(
  new URL('../supabase/functions/zatca-submit/index.ts', import.meta.url),
  'utf8',
)
assert.doesNotMatch(
  productionSource,
  /signed_qr\.mjs/,
  'sandbox extractor must not alter the production submission path',
)

console.log('Sandbox signed-XML QR extractor tests passed')
