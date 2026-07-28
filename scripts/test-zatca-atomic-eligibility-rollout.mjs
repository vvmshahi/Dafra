import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
const atomic = read('supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql')
const recovered = read('supabase/migrations/20260727000200_recover_atomic_checkout_gate_sync_definition.sql')
const final = read('supabase/migrations/20260727000300_consolidate_atomic_checkout_final_eligibility_v2.sql')
const phase2 = read('supabase/migrations/20260729000200_atomic_default_new_retail_branches.sql')
const edge = read('supabase/functions/zatca-submit/index.ts')

assert.match(atomic, /atomic_simplified_checkout_enabled boolean NOT NULL DEFAULT false/)
assert.match(atomic, /enabled boolean NOT NULL DEFAULT false/)
assert.match(atomic, /STANDARD_DOCUMENT_REQUIRES_CLEARANCE_FLOW/)

assert.match(recovered, /get_zatca_atomic_checkout_eligibility_v2/)
assert.match(recovered, /sync_zatca_atomic_checkout_branch_gates_v2/)
assert.match(recovered, /missing_client_acknowledgement/)
assert.match(recovered, /v_desired := v_eligible OR/)
assert.match(recovered, /REVOKE ALL ON FUNCTION public\.sync_zatca_atomic_checkout_branch_gates_v2/)

assert.match(final, /evaluate_zatca_atomic_checkout_eligibility_v2/)
assert.match(final, /sync_zatca_atomic_checkout_branch_gates_v2/)
assert.match(final, /'status', 'legacy_required'/)
assert.match(final, /'atomic_rollout_disabled'/)
assert.match(final, /'atomic_branch_not_ready'/)
assert.match(final, /TO authenticated/)
assert.doesNotMatch(
  final,
  /GRANT EXECUTE ON FUNCTION public\.evaluate_zatca_atomic_checkout_eligibility_v2[^;]+TO service_role/,
)

assert.match(edge, /syncAtomicSimplifiedEligibilityV2/)
assert.match(edge, /atomicRolloutEnabled/)
assert.match(edge, /status: 'legacy_required'/)
assert.match(edge, /existing_legacy_idempotency/)

assert.match(phase2, /branches_20_provision_zatca_checkout_defaults_v1/)
assert.match(phase2, /awaiting_production_onboarding/)
assert.match(phase2, /checkoutPath[\s\S]*'atomic'[\s\S]*'legacy'/)
assert.match(phase2, /ATOMIC_NOT_READY/)
assert.doesNotMatch(phase2, /UPDATE public\.zatca_atomic_checkout_branch_gates_v2/)

console.log('ZATCA atomic eligibility rollout contracts passed')
