/**
 * ZATCA Phase 2 — Sandbox Key Generation & Encryption
 * Uses @noble/curves secp256k1 (required by ZATCA — Bitcoin curve, OID 1.3.132.0.10)
 *
 * Production keys are generated and stored only in Supabase Edge Functions.
 * This browser helper is retained for the legacy sandbox certificate flow.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'

const SANDBOX_KEY_SECRET = 'dafra-zatca-sandbox-only-secret'

export interface ZatcaKeyPair {
  privateKey:    Uint8Array    // raw 32-byte secp256k1 secret key
  publicKey:     Uint8Array    // uncompressed 65-byte EC point (0x04 prefix)
  privateKeyPem: string        // raw secret-key bytes as PEM (label: EC PRIVATE KEY)
  publicKeyPem:  string        // SPKI PEM (label: PUBLIC KEY)
  publicKeyDer:  ArrayBuffer   // SPKI DER — passed to CSR builder
}

// ── Sandbox key generation ────────────────────────────────────────────────────

/** Generate a sandbox secp256k1 key pair using @noble/curves */
export async function generateKeyPair(): Promise<ZatcaKeyPair> {
  const secretKey  = secp256k1.utils.randomSecretKey()                  // 32 bytes
  const pubKeyBytes = secp256k1.getPublicKey(secretKey, false)          // 65 bytes uncompressed

  const spkiDer = buildSecp256k1Spki(pubKeyBytes)

  return {
    privateKey:    secretKey,
    publicKey:     pubKeyBytes,
    privateKeyPem: derToPem(secretKey.buffer as ArrayBuffer, 'EC PRIVATE KEY'),
    publicKeyPem:  derToPem(spkiDer, 'PUBLIC KEY'),
    publicKeyDer:  spkiDer,
  }
}

/**
 * Sign data with secp256k1 / SHA-256. Returns 64-byte IEEE P1363 (r‖s) as ArrayBuffer.
 * noble/curves hashes with SHA-256 internally (prehash: true is the default) —
 * do NOT pre-hash here or the signature will be over SHA-256(SHA-256(data)).
 */
export async function ecdsaSign(secretKey: Uint8Array, data: BufferSource): Promise<ArrayBuffer> {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
    : new Uint8Array(data as ArrayBuffer)
  const sigP1363 = secp256k1.sign(bytes, secretKey)  // prehash: true (default) — SHA-256 applied internally
  return sigP1363.slice().buffer as ArrayBuffer
}

// ── P1363 → DER ECDSA signature conversion ───────────────────────────────────
// secp256k1.sign produces IEEE P1363 format (r‖s, 32 bytes each).
// PKCS#10 and XAdES require DER-encoded ECDSA-Sig-Value.

export function p1363ToDer(sigBytes: Uint8Array): Uint8Array {
  const r = sigBytes.slice(0, 32)
  const s = sigBytes.slice(32, 64)

  const rDer = encodeDerInt(r)
  const sDer = encodeDerInt(s)
  const seqLen = rDer.length + sDer.length
  return new Uint8Array([0x30, seqLen, ...rDer, ...sDer])
}

function encodeDerInt(n: Uint8Array): Uint8Array {
  let start = 0
  while (start < n.length - 1 && n[start] === 0) start++
  const trimmed  = n.slice(start)
  const needsPad = (trimmed[0] & 0x80) !== 0
  const val      = needsPad ? new Uint8Array([0, ...trimmed]) : trimmed
  return new Uint8Array([0x02, val.length, ...val])
}

// ── SPKI builder for secp256k1 ────────────────────────────────────────────────

/**
 * Build a SubjectPublicKeyInfo DER blob for secp256k1.
 * SEQUENCE {
 *   SEQUENCE { OID ecPublicKey, OID secp256k1 }
 *   BIT STRING { 0x00 || uncompressed-point (65 bytes) }
 * }
 */
function buildSecp256k1Spki(pubKeyBytes: Uint8Array): ArrayBuffer {
  const oidEcPub    = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]) // 1.2.840.10045.2.1
  const oidSecp256k1 = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x0a])             // 1.3.132.0.10

  const algIdInner = new Uint8Array([
    0x06, oidEcPub.length,     ...oidEcPub,
    0x06, oidSecp256k1.length, ...oidSecp256k1,
  ])
  const algId = new Uint8Array([0x30, algIdInner.length, ...algIdInner])

  const bsInner  = new Uint8Array([0x00, ...pubKeyBytes])  // unused-bits=0 + key
  const bitStr   = new Uint8Array([0x03, bsInner.length, ...bsInner])

  const spkiInner = new Uint8Array([...algId, ...bitStr])
  return new Uint8Array([0x30, spkiInner.length, ...spkiInner]).buffer as ArrayBuffer
}

// ── Sandbox encryption for DB storage ─────────────────────────────────────────

/**
 * AES-256-GCM encrypt a sandbox private key PEM.
 * Returns "{base64iv}:{base64ciphertext}" — safe to store in varchar column.
 */
export async function encryptPrivateKey(pem: string): Promise<string> {
  const iv      = crypto.getRandomValues(new Uint8Array(12))
  const key     = await deriveAesKey()
  const encBuf  = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(pem),
  )
  const ivB64  = bufToB64(iv)
  const encB64 = bufToB64(new Uint8Array(encBuf))
  return `${ivB64}:${encB64}`
}

async function deriveAesKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SANDBOX_KEY_SECRET), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('dafra-zatca-v1'), iterations: 100_000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── PEM / DER helpers ─────────────────────────────────────────────────────────

export function derToPem(der: ArrayBuffer, label: string): string {
  const b64   = bufToB64(new Uint8Array(der))
  const lines = b64.match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`
}

function bufToB64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
}
