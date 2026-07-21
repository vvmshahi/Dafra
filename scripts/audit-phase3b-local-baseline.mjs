import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const migrationDir = resolve(root, 'supabase/migrations')
assert.ok(existsSync(migrationDir), 'migration directory is required')
const files = readdirSync(migrationDir).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort()
assert.deepEqual(files, [
  '20260721000100_dafra_current_schema_and_security.sql',
  '20260721000200_phase5x_document_language_snapshot.sql',
  '20260721000300_phase6a_identity_foundation.sql',
  '20260721000400_invoice_presentation_settings.sql',
])
const [baselineName, phase5xName, phase6aName, phase4bName] = files
const baseline = readFileSync(resolve(migrationDir, baselineName), 'utf8')
const phase5x = readFileSync(resolve(migrationDir, phase5xName), 'utf8')
const phase6a = readFileSync(resolve(migrationDir, phase6aName), 'utf8')
const phase4b = readFileSync(resolve(migrationDir, phase4bName), 'utf8')
const all = [baseline, phase5x, phase6a, phase4b].join('\n')

assert.match(baseline, /CREATE TYPE "public"\."user_role" AS ENUM \(\s*'super_admin',\s*'owner',\s*'branch'\s*\)/)
assert.doesNotMatch(all, /get_my_role\(\)[^;\n]*admin|role\s+(?:NOT\s+)?IN\s*\([^)]*'admin'/i)
const syncQueue = baseline.match(/CREATE TABLE(?: IF NOT EXISTS)? "public"\."sync_queue"[\s\S]*?\n\);/)?.[0] ?? ''
assert.equal((syncQueue.match(/"created_at"/g) ?? []).length, 1)
assert.doesNotMatch(all, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
assert.doesNotMatch(all, /REPLACE_WITH_YOUR_PASSWORD|BEGIN (?:RSA |EC )?PRIVATE KEY|service[_-]?role[_-]?key\s*[:=]\s*['"][^'"]+/i)
assert.doesNotMatch(all, /regenerate-qr-codes|seed-super-admin|diagnose-login|phase5t-demo|phase5u-demo|zatca-production-debug-samples/)
assert.match(phase5x, /document_language/)
assert.match(phase6a, /branch_compliance_profiles/)
assert.match(phase6a, /confirm_branch_official_seller_information/)
assert.match(phase6a, /FOR UPDATE/)
assert.match(phase6a, /p_confirmation IS NOT TRUE/)
assert.match(phase4b, /presentation_settings/)

const sourceFiles = readdirSync(resolve(root, 'src'), { recursive: true })
  .filter(name => /\.(?:ts|tsx)$/.test(name))
  .map(name => readFileSync(resolve(root, 'src', name), 'utf8'))
const source = sourceFiles.join('\n')
const tables = [...source.matchAll(/\.from\(['"]([a-zA-Z0-9_]+)['"]\)/g)].map(match => match[1])
const rpcs = [...source.matchAll(/\.rpc\(['"]([a-zA-Z0-9_]+)['"]/g)].map(match => match[1])
for (const table of new Set(tables)) assert.match(all, new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? (?:"public"\\.|public\\.)?"?${table}"?`), `missing table ${table}`)
for (const rpc of new Set(rpcs)) assert.match(all, new RegExp(`CREATE(?: OR REPLACE)? FUNCTION (?:"public"\\.|public\\.)?"?${rpc}"?`), `missing RPC ${rpc}`)

const safety = readFileSync(resolve(root, 'scripts/phase3-local-db.sh'), 'utf8')
assert.match(safety, /127\.0\.0\.1.*localhost|localhost.*127\.0\.0\.1/s)
assert.match(safety, /Refusing database operation/)
assert.match(safety, /DAFRA_ALLOW_LOCAL_RESET/)

console.log(`Phase 3B canonical local baseline assertions passed (${new Set(tables).size} tables, ${new Set(rpcs).size} RPCs referenced by src).`)
