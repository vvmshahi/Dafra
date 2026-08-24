import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = await read('supabase/migrations/20260824000600_owner_account_provisioning_v2.sql')
const edge = await read('supabase/functions/create-owner-account-v2/index.ts')
let count = 0
const check = (condition, message) => { assert.ok(condition, message); count += 1 }

for (const step of [
  'validate_request', 'create_auth_user', 'begin_db_provisioning', 'create_tenant',
  'link_owner_profile', 'create_subscription', 'create_first_branch',
  'initialize_fiscal_policy', 'finalize_db_provisioning', 'generate_setup_link',
  'update_onboarding_status',
]) check(migration.includes(`v_failure_step := '${step}'`) || edge.includes(`failureStep = '${step}'`), `step ${step} is tracked`)

for (const field of ['failure_step', 'failure_code', 'failure_message_safe', 'failure_detail_safe', 'failure_hint_safe', 'failure_sqlstate', 'failure_source', 'failed_at', 'compensation_status']) {
  check(migration.includes(field), `${field} is persisted`)
}
check(migration.includes('GET STACKED DIAGNOSTICS'), 'SQLSTATE diagnostics are captured')
check(migration.includes('RETURNED_SQLSTATE'), 'returned SQLSTATE is captured')
check(migration.includes('PG_EXCEPTION_DETAIL'), 'safe detail is captured')
check(migration.includes('PG_EXCEPTION_HINT'), 'safe hint is captured')
check(migration.includes("state = 'failed_recoverable'"), 'recoverable state is retained')
check(migration.includes("compensation_status = 'db_rollback_complete'"), 'database rollback is recorded')
check(edge.includes('deleteUser(createdAuthUserId)'), 'auth compensation remains active')
check(edge.includes("failure_step: diagnostic?.failure_step"), 'safe failure step is returned')
check(edge.includes("failure_code: diagnostic?.failure_code"), 'safe failure code is returned')
check(!migration.match(/failure_(?:message|detail|hint)_safe[\s\S]{0,300}(?:password|service_role|jwt|setup.?link)/i), 'diagnostics do not intentionally persist secrets')

console.log(`Owner account V2 observability contract passed (${count} assertions)`)
