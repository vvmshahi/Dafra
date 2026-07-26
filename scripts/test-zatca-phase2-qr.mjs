import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import {
  buildZatcaPhase2Qr,
  strictBase64ToBytes,
  validateDerEcdsaSignature,
  validateDerSpki,
} from '../supabase/functions/_shared/zatca/phase2_qr.mjs'

const ROOT = new URL('../', import.meta.url)
const ID_EC_PUBLIC_KEY_OID = Uint8Array.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
const SECP256K1_OID = Uint8Array.from([0x2b, 0x81, 0x04, 0x00, 0x0a])
const PRIME256V1_OID = Uint8Array.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07])
const RSA_ENCRYPTION_OID = Uint8Array.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01])
const BUILDER_CONSUMERS = [
  'supabase/functions/zatca-submit/index.ts',
  'supabase/functions/zatca-submit-sandbox-demo/index.ts',
  'supabase/functions/_shared/zatca/samples.ts',
  'scripts/debug-zatca-sample-hash.mjs',
]

const hash = Uint8Array.from({ length: 32 }, (_, index) => index)
const invoiceSignatureDer = ecdsaDerSignature(
  Uint8Array.from({ length: 32 }, (_, index) => 0x20 + index),
  Uint8Array.from({ length: 32 }, (_, index) => 0x40 + index),
)
const publicKeyCoordinates = Uint8Array.from({ length: 64 }, (_, index) => 0x40 + index)
const publicKeySpki = ecSpki(publicKeyCoordinates, ID_EC_PUBLIC_KEY_OID, SECP256K1_OID)
const certificateSignatureDer = ecdsaDerSignature(
  Uint8Array.from({ length: 32 }, (_, index) => 0x10 + index),
  Uint8Array.from({ length: 32 }, (_, index) => 0x60 + index),
)
const hashBase64 = Buffer.from(hash).toString('base64')
const signatureValueBase64 = Buffer.from(invoiceSignatureDer).toString('base64')
const fixture = {
  sellerName: 'شركة كبرى',
  vatNumber: '300000000000003',
  timestamp: '2026-07-23T12:34:56',
  totalAmount: 115,
  vatAmount: 15,
  invoiceHashBase64: hashBase64,
  signatureValueBase64,
  publicKeySpki,
  certificateSignatureDer,
}

function parseTlv(base64) {
  const payload = Buffer.from(base64, 'base64')
  const fields = []
  let offset = 0
  while (offset < payload.length) {
    assert.ok(offset + 2 <= payload.length, 'TLV header must not be truncated')
    const tag = payload[offset++]
    const length = payload[offset++]
    assert.ok(offset + length <= payload.length, `tag ${tag} must not be truncated`)
    fields.push({ tag, value: payload.subarray(offset, offset + length) })
    offset += length
  }
  return { payload, fields }
}

function derInteger(value) {
  let offset = 0
  while (offset < value.length - 1 && value[offset] === 0) offset++
  const trimmed = Buffer.from(value.subarray(offset))
  const bytes = trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes])
}

function ecdsaDerSignature(r, s) {
  const body = Buffer.concat([derInteger(r), derInteger(s)])
  return Uint8Array.from(Buffer.concat([Buffer.from([0x30, body.length]), body]))
}

function derOid(value) {
  return Buffer.concat([Buffer.from([0x06, value.length]), Buffer.from(value)])
}

function ecSpki(coordinates, algorithmOid, curveOid) {
  assert.equal(coordinates.length, 64)
  const algorithmBody = Buffer.concat([derOid(algorithmOid), derOid(curveOid)])
  const algorithm = Buffer.concat([Buffer.from([0x30, algorithmBody.length]), algorithmBody])
  const subjectPublicKey = Buffer.concat([
    Buffer.from([0x03, 0x42, 0x00, 0x04]),
    Buffer.from(coordinates),
  ])
  const body = Buffer.concat([algorithm, subjectPublicKey])
  return Uint8Array.from(Buffer.concat([Buffer.from([0x30, body.length]), body]))
}

function assertFieldText(field, expected) {
  const bytes = new TextEncoder().encode(expected)
  assert.equal(field.value.length, bytes.length)
  assert.deepEqual(field.value, Buffer.from(bytes))
}

const qr = buildZatcaPhase2Qr(fixture)
const secondQr = buildZatcaPhase2Qr(fixture)
const { payload, fields } = parseTlv(qr)

assert.equal(qr, secondQr, 'identical fixture inputs must produce identical QR payloads')
assert.deepEqual(fields.map(field => field.tag), [1, 2, 3, 4, 5, 6, 7, 8, 9])
assert.equal(new Set(fields.map(field => field.tag)).size, 9, 'tags must not be duplicated')
for (const [index, expected] of [
  fixture.sellerName,
  fixture.vatNumber,
  fixture.timestamp,
  '115.00',
  '15.00',
].entries()) {
  assertFieldText(fields[index], expected)
}
assert.ok(fields[0].value.length > fixture.sellerName.length, 'Arabic length must use UTF-8 bytes')

assertFieldText(fields[5], hashBase64)
assert.equal(fields[5].value.length, 44)
assert.deepEqual(
  Buffer.from(strictBase64ToBytes(fields[5].value.toString('utf8'))),
  Buffer.from(hash),
)
assertFieldText(fields[6], signatureValueBase64)
assert.equal(fields[6].value.length, signatureValueBase64.length)
assert.deepEqual(
  Buffer.from(strictBase64ToBytes(fields[6].value.toString('utf8'))),
  Buffer.from(invoiceSignatureDer),
)
assert.deepEqual(fields[7].value, Buffer.from(publicKeySpki))
assert.equal(fields[7].value.length, publicKeySpki.length)
assert.deepEqual(fields[8].value, Buffer.from(certificateSignatureDer))
assert.equal(fields[8].value.length, certificateSignatureDer.length)

assert.equal(Buffer.from(payload).toString('base64'), qr, 'complete TLV must be Base64 encoded exactly once')
assert.ok(qr.length <= 700)
assert.doesNotThrow(() => validateDerSpki(publicKeySpki))
assert.doesNotThrow(() => validateDerEcdsaSignature(certificateSignatureDer))
assert.throws(
  () => buildZatcaPhase2Qr({
    ...fixture,
    publicKeySpki: ecSpki(publicKeyCoordinates, ID_EC_PUBLIC_KEY_OID, PRIME256V1_OID),
  }),
  /secp256k1/,
)
assert.throws(
  () => buildZatcaPhase2Qr({
    ...fixture,
    publicKeySpki: ecSpki(publicKeyCoordinates, RSA_ENCRYPTION_OID, SECP256K1_OID),
  }),
  /id-ecPublicKey/,
)

for (const field of [
  'sellerName',
  'vatNumber',
  'timestamp',
  'invoiceHashBase64',
  'signatureValueBase64',
]) {
  assert.throws(
    () => buildZatcaPhase2Qr({ ...fixture, [field]: '' }),
    /non-empty/,
    `${field} must fail closed when empty`,
  )
}
for (const field of ['publicKeySpki', 'certificateSignatureDer']) {
  assert.throws(
    () => buildZatcaPhase2Qr({ ...fixture, [field]: new Uint8Array(0) }),
    /non-empty/,
    `${field} must fail closed when empty`,
  )
}
assert.throws(
  () => buildZatcaPhase2Qr({ ...fixture, sellerName: 'x'.repeat(256) }),
  /one-byte TLV length limit/,
)
assert.throws(
  () => buildZatcaPhase2Qr({ ...fixture, sellerName: 'x'.repeat(255) }),
  /exceeds 700 Base64 characters/,
)
assert.throws(
  () => buildZatcaPhase2Qr({
    ...fixture,
    signatureValueBase64: Buffer.alloc(192).toString('base64'),
  }),
  /one-byte TLV length limit/,
)
for (const malformed of ['!!!!', 'YQ=', 'YQ===', ' YQ==']) {
  assert.throws(
    () => buildZatcaPhase2Qr({ ...fixture, invoiceHashBase64: malformed }),
    /Base64/,
  )
  assert.throws(
    () => buildZatcaPhase2Qr({ ...fixture, signatureValueBase64: malformed }),
    /Base64/,
  )
}
assert.throws(
  () => buildZatcaPhase2Qr({
    ...fixture,
    invoiceHashBase64: Buffer.alloc(31).toString('base64'),
  }),
  /exactly 32 bytes/,
)
for (const invalidSpki of [
  Uint8Array.from([0x30, 0x00]),
  Uint8Array.from([0x30, 0x03, 0x30, 0x01, 0x00]),
  publicKeySpki.slice(0, -1),
]) {
  assert.throws(() => buildZatcaPhase2Qr({ ...fixture, publicKeySpki: invalidSpki }), /SPKI/)
}
for (const invalidSignature of [
  Uint8Array.from([0x30, 0x00]),
  Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x01]),
  Uint8Array.from([...certificateSignatureDer, 0]),
]) {
  assert.throws(
    () => buildZatcaPhase2Qr({ ...fixture, certificateSignatureDer: invalidSignature }),
    /signature/,
  )
}

for (const path of BUILDER_CONSUMERS) {
  const source = await readFile(new URL(path, ROOT), 'utf8')
  assert.match(source, /phase2_qr\.mjs/, `${path} must import the shared QR contract`)
  assert.match(source, /buildZatcaPhase2Qr\(/, `${path} must call the shared QR builder`)
  assert.doesNotMatch(source, /function buildPhase2QR\(/, `${path} must not retain a duplicate builder`)
  assert.ok(
    source.includes('`$1${qrCode}$3`'),
    `${path} must embed the generated QR variable unchanged`,
  )
  assert.doesNotMatch(
    source,
    /derEcdsaSignatureToP1363|ecPublicKeyCoordinatesFromSpki/,
    `${path} must not use the speculative QR representation`,
  )
}

const sharedQrSource = await readFile(
  new URL('supabase/functions/_shared/zatca/phase2_qr.mjs', ROOT),
  'utf8',
)
assert.doesNotMatch(sharedQrSource, /P1363|publicKeyCoordinates|signatureP1363/)

const productionSource = await readFile(
  new URL('supabase/functions/zatca-submit/index.ts', ROOT),
  'utf8',
)
assert.ok(
  productionSource.includes('`$1${qrCode}$3`'),
  'the generated QR must be embedded in the signed XML',
)
assert.match(productionSource, /qrCode,\s*signatureValue:/, 'the generated QR must be returned by signing')
assert.match(
  productionSource,
  /p_signature:\s*signed\.signatureValue,\s*p_qr:\s*signed\.qrCode/,
  'the returned QR must be passed unchanged to persisted artifact RPCs',
)
assert.match(
  productionSource,
  /zatca_qr_code:\s*qrCode/,
  'legacy persistence must store the returned QR unchanged',
)

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const chunks = []
  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) chunks.push(await readSourceTree(url))
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) chunks.push(await readFile(url, 'utf8'))
  }
  return chunks.join('\n')
}

const browserFiles = await readSourceTree(new URL('src/', ROOT))
assert.doesNotMatch(browserFiles, /buildZatcaPhase2Qr|buildZatcaQR|tlvBytes|tlvStr/)
assert.match(browserFiles, /QRCode\.toDataURL/, 'browser code may render final QR payloads')

console.log('ZATCA Phase 2 SDK-compatible QR contract tests passed')
