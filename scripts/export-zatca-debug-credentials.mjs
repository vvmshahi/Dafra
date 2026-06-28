import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { createHash, webcrypto } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const OUT_DIR = '.zatca-debug'
const PRIVATE_KEY_PATH = `${OUT_DIR}/private-key.pem`
const COMPLIANCE_CERTIFICATE_PATH = `${OUT_DIR}/compliance-certificate.pem`

const TARGET = {
  branchId: '371dee75-6e46-496e-89e7-1a7492b51a3c',
  tenantId: '630f6faf-fc0e-4523-a569-1179fe13de1a',
  environment: 'production',
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function base64ToBytes(value) {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

async function decryptText(stored, secret) {
  const [version, ivB64, encB64] = String(stored ?? '').split(':')
  if (version !== 'v1' || !ivB64 || !encB64) {
    throw new Error('Encrypted credential has invalid format')
  }

  const digest = createHash('sha256').update(secret, 'utf8').digest()
  const key = await webcrypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(encB64),
  )
  return new TextDecoder().decode(plain)
}

async function writeSecretFile(path, value) {
  await writeFile(path, value, { mode: 0o600 })
  try {
    await chmod(path, 0o600)
  } catch {
    // Best effort on platforms/filesystems that do not support POSIX modes.
  }
}

async function main() {
  const supabaseUrl = requireEnv('SUPABASE_URL')
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const encryptionKey = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase
    .from('zatca_production_credentials')
    .select('encrypted_private_key, encrypted_compliance_csid')
    .eq('branch_id', TARGET.branchId)
    .eq('tenant_id', TARGET.tenantId)
    .eq('environment', TARGET.environment)
    .maybeSingle()

  if (error) throw new Error(`Unable to load production credentials: ${error.message}`)
  if (!data?.encrypted_private_key || !data?.encrypted_compliance_csid) {
    throw new Error('Target production onboarding row is missing required encrypted credentials')
  }

  const privateKeyPem = await decryptText(data.encrypted_private_key, encryptionKey)
  const complianceCertificate = await decryptText(data.encrypted_compliance_csid, encryptionKey)

  await mkdir(OUT_DIR, { recursive: true })
  await writeSecretFile(PRIVATE_KEY_PATH, privateKeyPem)
  await writeSecretFile(COMPLIANCE_CERTIFICATE_PATH, complianceCertificate)

  console.log(JSON.stringify({
    exported: true,
    files: {
      privateKey: PRIVATE_KEY_PATH,
      complianceCertificate: COMPLIANCE_CERTIFICATE_PATH,
    },
    byteLengths: {
      privateKey: Buffer.byteLength(privateKeyPem, 'utf8'),
      complianceCertificate: Buffer.byteLength(complianceCertificate, 'utf8'),
    },
  }, null, 2))
}

main().catch(error => {
  console.error(JSON.stringify({
    exported: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2))
  process.exit(1)
})
