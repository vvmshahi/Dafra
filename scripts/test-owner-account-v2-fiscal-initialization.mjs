import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sql = await readFile(new URL('../supabase/migrations/20260824000600_owner_account_provisioning_v2.sql', import.meta.url), 'utf8')
const fiscalSql = await readFile(new URL('../supabase/migrations/20260824000500_generation_onboarding_c.sql', import.meta.url), 'utf8')
const functionSql = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.complete_owner_account_provisioning_v2'))
let count = 0
const check = (condition, message) => { assert.ok(condition, message); count += 1 }

check(sql.includes('tenant_fiscal_onboarding_intents_pkey'), 'fiscal intent upsert uses its named primary key')
check(sql.includes('tenant_onboarding_status_tenant_id_key'), 'onboarding upsert uses its named tenant key')
check(sql.includes('user_profiles_pkey'), 'profile upsert uses its named primary key')
check(!functionSql.includes('ON CONFLICT (tenant_id)'), 'complete function has no ambiguous tenant conflict target')
check(functionSql.includes("v_failure_step := 'initialize_fiscal_policy'"), 'fiscal initialization step is tracked')
check(functionSql.includes("v_intent := CASE WHEN v_payload->>'fiscal_intent' = 'generation' THEN 'generation' ELSE 'integration' END"), 'Generation and Integration mapping remains explicit')
check(functionSql.includes("CASE WHEN v_intent = 'generation' THEN 'not_required' ELSE 'zatca_setup_pending' END"), 'Generation onboarding status remains separate')
check(fiscalSql.includes("NEW.fiscal_regime := 'generation'"), 'Generation fiscal regime remains represented')
check(fiscalSql.includes("NEW.fiscal_activation_state := 'generation_active'"), 'Generation activation state remains represented')
check(functionSql.includes('fiscal_policy_revision'), 'policy revision remains returned')
check(functionSql.includes("state = 'failed_recoverable'"), 'compensation failure state remains intact')
check(functionSql.includes('IDEMPOTENCY_CONFLICT') || sql.includes('IDEMPOTENCY_CONFLICT'), 'idempotency conflict contract remains present')

console.log(`Owner account V2 fiscal initialization contract passed (${count} assertions)`)
