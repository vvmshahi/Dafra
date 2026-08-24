import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'
import { resolveOwnerSetupRedirectUrl } from '../_shared/owner_setup_redirect.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function findAuthUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error('AUTH_LOOKUP_FAILED')
    const match = data.users.find((user: any) => user.email?.toLowerCase() === email)
    if (match) return match
    if (data.users.length < 1000) return null
  }
  throw new Error('AUTH_LOOKUP_INCOMPLETE')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  let operationId: string | null = null
  let createdAuthUserId: string | null = null
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const key = Deno.env.get('DAFRA_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!key?.startsWith('eyJ')) return json({ code: 'SERVER_CONFIGURATION_ERROR' }, 500)
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ code: 'UNAUTHORIZED' }, 401)
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(jwt)
    if (authError || !caller) return json({ code: 'UNAUTHORIZED' }, 401)
    const { data: profile } = await admin.from('user_profiles').select('role,is_active').eq('id', caller.id).maybeSingle()
    if (profile?.role !== 'super_admin' || profile?.is_active !== true) return json({ code: 'FORBIDDEN' }, 403)

    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const companyName = typeof body.company_name === 'string' ? body.company_name.trim() : ''
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : ''
    const accountType = body.account_type
    const fiscalIntent = body.fiscal_intent
    const branchCount = body.branch_count
    const paymentType = body.payment_type
    if (!companyName || !email || !idempotencyKey || !['production', 'demo'].includes(accountType)
      || !['generation', 'integration_setup'].includes(fiscalIntent)
      || typeof body.plan_id !== 'string' || !Number.isInteger(branchCount) || branchCount < 1 || branchCount > 100
      || !['one_time', 'monthly', 'lifetime_free'].includes(paymentType)) {
      return json({ code: 'INVALID_REQUEST' }, 400)
    }
    const payload = {
      company_name: companyName, company_name_ar: body.company_name_ar?.trim() || null,
      email, phone: body.phone?.trim() || null, city: body.city?.trim() || null,
      vat_number: body.vat_number?.trim() || null, cr_number: body.cr_number?.trim() || null,
      business_type: body.business_type === 'service' ? 'service' : 'trading',
      account_type: accountType, plan_id: body.plan_id, branch_count: branchCount,
      payment_type: paymentType, duration_months: Number.isInteger(body.duration_months) ? body.duration_months : 0,
      ends_at: body.ends_at || null, pay_method: body.pay_method || null, pay_ref: body.pay_ref || null,
      notes: body.notes?.trim() || null, fiscal_intent: fiscalIntent,
    }
    const { ends_at: _unstableExpiry, ...fingerprintPayload } = payload
    const fingerprint = await sha256(JSON.stringify(fingerprintPayload))
    const auditBase = { tenantId: null, branchId: null, actorUserId: caller.id, actorRole: 'super_admin', targetType: 'owner_account_v2', targetId: null, ipHash: await hashRequestIp(req), requestId: requestId(req) }
    const rate = await enforceRateLimit(admin as any, { ...auditBase, action: 'create_owner_account_v2', scope: 'actor', scopeId: caller.id, maxAttempts: 20, windowSeconds: 86400 })
    if (!rate.allowed) return json(rateLimitBody(rate), 429)
    const { data: acquired, error: acquireError } = await admin.rpc('acquire_owner_account_provisioning_v2', {
      p_idempotency_key: idempotencyKey, p_request_fingerprint: fingerprint,
      p_initiated_by: caller.id, p_request_payload: payload,
    })
    if (acquireError || !acquired?.[0]) {
      if (/IDEMPOTENCY_CONFLICT/.test(acquireError?.message ?? '')) return json({ code: 'IDEMPOTENCY_CONFLICT' }, 409)
      return json({ code: 'PROVISIONING_OPERATION_FAILED' }, 503)
    }
    const operation = acquired[0]
    operationId = operation.operation_id
    let authUser = await findAuthUserByEmail(admin, email)
    if (authUser && authUser.user_metadata?.owner_account_v2_operation_id !== operationId) {
      return json({ code: 'EMAIL_ALREADY_PROVISIONED' }, 409)
    }
    if (!authUser) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { full_name: companyName, role: 'owner', owner_account_v2_operation_id: operationId },
      })
      if (createError || !created.user) {
        await admin.from('owner_account_provisioning_v2').update({ state: 'failed_recoverable', last_error_code: 'AUTH_CREATE_FAILED', updated_at: new Date().toISOString() }).eq('id', operationId)
        await admin.rpc('set_owner_account_v2_setup_link', { p_operation_id: operationId, p_generated: false, p_error: 'AUTH_CREATE_FAILED' })
        return json({ code: 'AUTH_CREATE_FAILED' }, 400)
      }
      authUser = created.user
      createdAuthUserId = authUser.id
    }
    const { data: completed, error: completeError } = await admin.rpc('complete_owner_account_provisioning_v2', {
      p_operation_id: operationId, p_auth_user_id: authUser.id,
    })
    if (completeError || !completed?.[0]) {
      await admin.from('owner_account_provisioning_v2').update({ state: 'failed_recoverable', last_error_code: 'DB_PROVISIONING_FAILED', updated_at: new Date().toISOString() }).eq('id', operationId)
      if (createdAuthUserId) await admin.auth.admin.deleteUser(createdAuthUserId)
      return json({ code: 'PROVISIONING_FAILED_RECOVERABLE', provisioning_id: operationId }, 503)
    }
    const result = completed[0]
    let setupLink: string | null = null
    let setupError: string | null = null
    try {
      const link = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: resolveOwnerSetupRedirectUrl() } })
      setupLink = link.data?.properties?.action_link ?? null
      setupError = link.error?.message ?? (setupLink ? null : 'SETUP_LINK_MISSING')
    } catch (error) {
      setupError = error instanceof Error ? error.message : 'SETUP_LINK_FAILED'
    }
    await admin.rpc('set_owner_account_v2_setup_link', { p_operation_id: operationId, p_generated: !!setupLink, p_error: setupError })
    await admin.from('tenant_onboarding_status').update({
      owner_setup_status: setupLink ? 'owner_invited' : 'owner_invited',
      owner_setup_link_sent_at: setupLink ? new Date().toISOString() : null,
      updated_by: caller.id,
    }).eq('tenant_id', result.tenant_id)
    await auditEvent(admin as any, { ...auditBase, tenantId: result.tenant_id, targetId: operationId, action: 'owner_account_v2_created', severity: 'info', status: 'succeeded', metadata: { setupLinkGenerated: !!setupLink, fiscalIntent } })
    return json({
      code: setupLink ? 'OWNER_ACCOUNT_CREATED' : 'OWNER_ACCOUNT_CREATED_SETUP_LINK_PENDING',
      provisioning_status: 'complete', provisioning_id: operationId, user_id: result.auth_user_id,
      tenant_id: result.tenant_id, subscription_id: result.subscription_id, branch_id: result.branch_id,
      setup_link_generated: !!setupLink, ...(setupLink ? { setup_link: setupLink } : {}),
      fiscal_regime: result.fiscal_regime, activation_state: result.fiscal_activation_state,
      policy_revision: result.fiscal_policy_revision, idempotent_replay: operation.is_replay,
    })
  } catch (error) {
    if (createdAuthUserId) {
      try { const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('DAFRA_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } }); await admin.auth.admin.deleteUser(createdAuthUserId) } catch { /* compensation is best effort and operation remains recoverable */ }
    }
    console.error('[create-owner-account-v2]', { operationId, error: error instanceof Error ? error.message : 'INTERNAL_ERROR' })
    return json({ code: 'PROVISIONING_FAILED_RECOVERABLE', provisioning_id: operationId }, 503)
  }
})
