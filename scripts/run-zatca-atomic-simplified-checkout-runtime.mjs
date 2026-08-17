import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const suite = join(root, 'scripts/test-zatca-atomic-simplified-checkout-runtime.mjs')
const providedWorkdir = process.env.DAFRA_ATOMIC_TEST_WORKDIR
const run = (args, options = {}) => execFileSync('supabase', args, { cwd: root, stdio: 'inherit', ...options })
const runSuite = workdir => execFileSync(process.execPath, [suite], { cwd: root, stdio: 'inherit', env: { ...process.env, DAFRA_ATOMIC_TEST_WORKDIR: workdir } })

if (providedWorkdir) {
  runSuite(providedWorkdir)
  process.exit(0)
}

const workdir = mkdtempSync(join(tmpdir(), 'dafra-atomic-disposable.'))
const projectId = basename(workdir).replace(/[^a-zA-Z0-9_]/g, '_')
const configPath = join(workdir, 'supabase/config.toml')
try {
  cpSync(join(root, 'supabase'), join(workdir, 'supabase'), { recursive: true })
  const config = readFileSync(configPath, 'utf8')
  writeFileSync(configPath, config.replace(/^project_id = ".*"$/m, `project_id = "${projectId}"`))
  run(['start', '--workdir', workdir])
  run(['db', 'reset', '--local', '--workdir', workdir])
  runSuite(workdir)
} finally {
  try { run(['stop', '--workdir', workdir]) } finally { rmSync(workdir, { recursive: true, force: true }) }
}
