import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, resolve } from 'node:path'

const DEFAULT_WORKSPACE_SDK_APPS = 'zatca-docs/zatca-einvoicing-sdk-Java-238-R3.4.8/Apps'
const DEFAULT_DESKTOP_SDK_APPS = `${process.env.HOME ?? ''}/Desktop/zatca-docs/zatca-einvoicing-sdk-Java-238-R3.4.8/Apps`
const OUT_XML = '.zatca-debug/simplified_invoice.signed.xml'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  })
}

function sdkAppsDir() {
  const raw = argValue('--sdk-apps') ??
    process.env.ZATCA_SDK_APPS_DIR ??
    (existsSync(DEFAULT_WORKSPACE_SDK_APPS) ? DEFAULT_WORKSPACE_SDK_APPS : DEFAULT_DESKTOP_SDK_APPS)
  return isAbsolute(raw) ? raw : resolve(raw)
}

function main() {
  console.log('[zatca-validate] generating local compliance sample XML')
  const generateArgs = ['scripts/debug-zatca-sample-hash.mjs']
  const privateKey = argValue('--private-key')
  const certificate = argValue('--certificate')
  if (privateKey) generateArgs.push('--private-key', privateKey)
  if (certificate) generateArgs.push('--certificate', certificate)

  const generateOutput = run('node', generateArgs)
  console.log(generateOutput)

  if (!existsSync(OUT_XML)) {
    throw new Error(`Generated XML not found: ${OUT_XML}`)
  }

  const appsDir = sdkAppsDir()
  const fatoora = join(appsDir, 'fatoora')
  if (!existsSync(fatoora)) {
    throw new Error(
      `ZATCA SDK fatoora executable not found at ${fatoora}. ` +
      `Unzip the SDK or pass --sdk-apps <Apps dir>. XML generated at ${OUT_XML}.`,
    )
  }

  console.log(`[zatca-validate] validating exact XML with SDK: ${OUT_XML}`)
  const env = {
    ...process.env,
    JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@11',
    FATOORA_HOME: appsDir,
  }
  env.PATH = `${env.JAVA_HOME}/bin:${env.PATH ?? ''}`

  const sdkOutput = run(fatoora, ['-validate', '-invoice', `${process.cwd()}/${OUT_XML}`], {
    cwd: appsDir,
    env,
  })
  console.log(sdkOutput)
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
