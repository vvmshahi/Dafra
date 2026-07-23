import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const base = 'scripts/sql/zatca-phase2-finalization-v2'
const runbook = read(`${base}/RELEASE_PACKAGING_AND_MAINTENANCE_RUNBOOK.md`)
const stepScript = read(`${base}/operator/run_sql_step.sh`)
const baselineScript = read(`${base}/operator/capture_protected_baseline.sh`)
const flagGuard = read(`${base}/operator/verify_flags_false.sql`)
const verifier = read(`${base}/06_verification.sql`)
const branchVerifier = read(`${base}/10_branch_readiness_verification.sql`)
const atomicRollout = read(`${base}/ATOMIC_SIMPLIFIED_CHECKOUT_ROLLOUT.md`)

for (const script of [
  `${base}/operator/run_sql_step.sh`,
  `${base}/operator/capture_protected_baseline.sh`,
]) {
  const checked = spawnSync('bash', ['-n', script], { cwd: root, encoding: 'utf8' })
  assert.equal(checked.status, 0, `${script}: ${checked.stderr}`)
}

for (const step of ['00', '01', '02', '03', '04', '04a', '05', '06', '09', '10', '11', '12']) {
  assert.match(stepScript, new RegExp(`\\b${step.replace('04a', '04a')}\\)`))
  assert.match(runbook, new RegExp(`run_sql_step\\.sh ${step}\\b`))
}

assert.match(stepScript, /set -Eeuo pipefail/)
assert.match(stepScript, /--set=ON_ERROR_STOP=1/)
assert.match(stepScript, /lock_timeout=/)
assert.match(stepScript, /statement_timeout=/)
assert.match(stepScript, /shasum -a 256/)
assert.match(stepScript, /tee/)
assert.match(stepScript, /verify_flags_false\.sql/)
assert.match(stepScript, /MAINTENANCE_APPROVED/)
assert.match(stepScript, /CLIENT_DRAIN_CONFIRMED/)
assert.match(stepScript, /EDGE_KILL_SWITCH_CONFIRMED_FALSE/)
assert.match(stepScript, /status --porcelain=v1 --untracked-files=all/)
assert.doesNotMatch(stepScript, /UPDATE\s+public\.zatca_finalization_runtime/i)

assert.match(flagGuard, /BEGIN TRANSACTION READ ONLY/)
assert.match(flagGuard, /ZATCA_FLAGS_NOT_FALSE/)
assert.match(flagGuard, /immutable_finalization_enabled/)
assert.match(flagGuard, /simplified_enabled/)
assert.match(flagGuard, /standard_enabled/)
assert.match(flagGuard, /atomic_simplified_checkout_enabled/)

assert.match(verifier, /v_total <> 59/)
assert.match(verifier, /v_pass <> 54/)
assert.match(verifier, /v_review <> 5/)
assert.match(verifier, /v_fail <> 0/)
assert.match(branchVerifier, /^BEGIN;$/m)
assert.match(branchVerifier, /CREATE TEMP TABLE/)
assert.match(branchVerifier, /ROLLBACK;/)
assert.match(branchVerifier, /v_total <> 15/)
assert.match(branchVerifier, /v_pass <> 15/)
assert.match(branchVerifier, /v_fail <> 0/)

for (const capture of [
  'git_commit.txt',
  'git_branch.txt',
  'zatca_submit_version.json',
  'vercel_production.txt',
  'edge_kill_switch.txt',
  '00_hosted_preflight.log',
]) assert.match(baselineScript, new RegExp(capture.replace('.', '\\.')))
assert.doesNotMatch(baselineScript, /supabase secrets list/)
assert.doesNotMatch(baselineScript, /SUPABASE_SERVICE_ROLE_KEY/)
assert.doesNotMatch(baselineScript, /DATABASE_URL/)
assert.match(baselineScript, /EXPECTED_RELEASE_COMMIT/)
assert.match(baselineScript, /release checkout is not clean/)

for (let section = 1; section <= 13; section += 1) {
  assert.match(runbook, new RegExp(`## ${section}\\.`))
}
assert.match(runbook, /A\. Release package and maintenance runbook are ready/)
assert.match(runbook, /Do not stage or commit/)
assert.match(runbook, /Authenticated table-wide SELECT[^]*not a normal\s+rollback/)
assert.match(runbook, /43 recorded decisions\/checks/)
assert.match(atomicRollout, /atomic_simplified_checkout_enabled/)
assert.match(atomicRollout, /one explicitly approved branch/)
assert.match(atomicRollout, /Rollback is flag-only/)
assert.match(atomicRollout, /INV-0826 and INV-0827 remain historical reconciliation incidents/)

console.log('ZATCA release package: operator scripts, 59-row gate, runbook, and safety invariants passed')
