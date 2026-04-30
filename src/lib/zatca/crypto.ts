/**
 * ZATCA Phase 2 — Key Generation & Encryption
 * Uses Web Crypto API (ECDSA P-256 / secp256r1)
 *
 * Private keys are AES-256-GCM encrypted with a PBKDF2-derived key
 * before being stored in zatca_certificates.private_key_encrypted.
 * The encryption secret is the VITE_ZATCA_KEY_SECRET env var.
 */

const ECDSA_ALG: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }
const APP_SECRET = import.meta.env.VITE_ZATCA_KEY_SECRET ?? 'dafra-zatca-local-secret'

export interface ZatcaKeyPair {
  privateKey:    CryptoKey
  publicKey:     CryptoKey
  privateKeyPem: string
  publicKeyPem:  string
  publicKeyDer:  ArrayBuffer  // SPKI — passed to CSR builder
}

// ── Key generation ────────────────────────────────────────────────────────────

/** Generate ECDSA P-256 key pair using Web Crypto API */
export async function generateKeyPair(): Promise<ZatcaKeyPair> {
  const kp = await crypto.subtle.generateKey(ECDSA_ALG, true, ['sign', 'verify'])

  const [privDer, pubDer] = await Promise.all([
    crypto.subtle.exportKey('pkcs8', kp.privateKey),
    crypto.subtle.exportKey('spki',  kp.publicKey),
  ])

  return {
    privateKey:    kp.privateKey,
    publicKey:     kp.publicKey,
    privateKeyPem: derToPem(privDer, 'PRIVATE KEY'),
    publicKeyPem:  derToPem(pubDer,  'PUBLIC KEY'),
    publicKeyDer:  pubDer,
  }
}

/** Import a PKCS#8 PEM private key for signing operations */
export async function importPrivateKeyPem(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemToDer(pem), ECDSA_ALG, false, ['sign'])
}

/** Sign a byte buffer with the ECDSA private key. Returns IEEE P1363 format (r‖s). */
export async function ecdsaSign(privateKey: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data)
}

/** SHA-256 hash of a UTF-8 string, returned as ArrayBuffer */
export async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
}

/** SHA-256 hash of raw bytes */
export async function sha256Bytes(input: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', input)
}

// ── P1363 → DER ECDSA signature conversion ───────────────────────────────────
// Web Crypto produces IEEE P1363 format (r‖s, 32 bytes each).
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

// ── Encryption for DB storage ─────────────────────────────────────────────────

/**
 * AES-256-GCM encrypt a private key PEM.
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

/** Decrypt a stored encrypted private key */
export async function decryptPrivateKey(stored: string): Promise<string> {
  const [ivB64, encB64] = stored.split(':')
  const iv  = b64ToBuf(ivB64)
  const enc = b64ToBuf(encB64)
  const key = await deriveAesKey()
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc)
  return new TextDecoder().decode(dec)
}

async function deriveAesKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(APP_SECRET), 'PBKDF2', false, ['deriveKey'],
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

export function pemToDer(pem: string): ArrayBuffer {
  const b64   = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bytes = atob(b64)
  return new Uint8Array(Array.from(bytes, c => c.charCodeAt(0))).buffer
}

function bufToB64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
}

function b64ToBuf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}
