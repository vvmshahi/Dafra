import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders,
  isUuid,
  jsonResponse,
  requireEnv,
  safeErrorMessage,
} from '../_shared/zatca/config.ts'
import {
  loadOwnedBranch,
  requireTenantOwner,
  ZatcaAuthContractError,
} from '../_shared/zatca/auth.ts'

interface ResetRequest {
  branchId?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json() as ResetRequest
    if (!isUuid(body.branchId)) return jsonResponse({ error: 'Invalid branch' }, 400)

    const db = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    )
    const owner = await requireTenantOwner(db, req)
    const branch = await loadOwnedBranch(db, body.branchId, owner.tenantId)

    const reset = await db.rpc('reset_failed_zatca_onboarding', {
      p_branch_id: branch.id,
      p_actor_id: owner.userId,
      p_reason: 'Owner requested a fresh Production onboarding attempt.',
    })
    if (reset.error) throw new Error(reset.error.message)

    return jsonResponse({
      ok: true,
      branchId: branch.id,
      environment: 'production',
      onboardingStatus: 'not_started',
      reset: reset.data,
      message: 'Failed onboarding was archived. This branch is ready for new onboarding.',
    })
  } catch (err) {
    if (err instanceof ZatcaAuthContractError) {
      return jsonResponse({ error: err.message, code: err.code }, 401)
    }
    return jsonResponse({ error: safeErrorMessage(err) }, 400)
  }
})
