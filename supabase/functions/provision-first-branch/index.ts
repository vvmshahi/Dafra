import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'
import { internalBranchAuthEmail, validateBranchUsername } from '../_shared/branch-username.ts'
import { disposableDelay, disposableFault } from '../_shared/test-faults.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dafra-test-fault, x-dafra-test-fault-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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
  const started = Date.now()
  let provisioningId: string | null = null
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const key = Deno.env.get('DAFRA_SERVICE_ROLE_KEY')
    if (!key?.startsWith('eyJ')) return json({ code: 'SERVER_CONFIGURATION_ERROR' }, 500)
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(jwt)
    if (authError || !caller) return json({ code: 'UNAUTHORIZED' }, 401)
    const { data: profile } = await admin.from('user_profiles')
      .select('role,tenant_id,is_active').eq('id', caller.id).maybeSingle()
    if (!profile || !['owner', 'super_admin'].includes(profile.role) || profile.is_active !== true || !profile.tenant_id) {
      return json({ code: 'FORBIDDEN' }, 403)
    }
    const body = await req.json()
    const usernameResult = validateBranchUsername(typeof body.username === 'string' ? body.username : '')
    if (!usernameResult.ok || typeof body.password !== 'string' || body.password.length < 8 ||
        typeof body.name !== 'string' || !body.name.trim()) {
      return json({ code: 'INVALID_REQUEST' }, 400)
    }
    const auditBase = {
      tenantId: profile.tenant_id, branchId: null, actorUserId: caller.id,
      actorRole: profile.role, targetType: 'first_branch_provisioning', targetId: null,
      ipHash: await hashRequestIp(req), requestId: requestId(req),
    }
    const rate = await enforceRateLimit(admin as any, {
      ...auditBase, action: 'provision_first_branch', scope: 'tenant',
      scopeId: profile.tenant_id, maxAttempts: 20, windowSeconds: 3600,
    })
    if (!rate.allowed) return json(rateLimitBody(rate), 429)
    const branchPayload = {
      name: body.name.trim(), vat_number: body.vat_number?.trim() || null,
      cr_number: body.cr_number?.trim() || null, building_number: body.building_number?.trim() || null,
      postal_code: body.postal_code?.trim() || null, street: body.street?.trim() || null,
      district: body.district?.trim() || null, city: body.city?.trim() || null,
      phone: body.phone?.trim() || null, zatca_phase: body.zatca_phase === 2 ? 2 : 1,
    }
    const { data: prepared, error: prepareError } = await admin.rpc('prepare_first_branch_provisioning', {
      p_owner_id: caller.id, p_branch_payload: branchPayload,
    })
    if (prepareError || !prepared?.[0]) {
      const message = prepareError?.message ?? ''
      const code = /FIRST_BRANCH_INVALID_(NAME|VAT|CR|BUILDING|POSTAL|STREET|DISTRICT|CITY)/.test(message)
        ? 'INVALID_REQUEST'
        : /LIMIT/.test(message) ? 'BRANCH_LIMIT_REACHED'
        : /INACTIVE|SUSPEND/.test(prepareError?.message ?? '') ? 'TENANT_INACTIVE'
        : 'FAILED_RECOVERABLE'
      return json({ code }, code === 'FAILED_RECOVERABLE' ? 503 : code === 'INVALID_REQUEST' ? 400 : 409)
    }
    const state = prepared[0]
    provisioningId = state.provisioning_id
    if (state.state === 'complete') {
      return json({ code: 'COMPLETE', provisioning_id: provisioningId, branch_id: state.branch_id })
    }
    const internalEmail = internalBranchAuthEmail(usernameResult.normalizedUsername, state.branch_id)
    if (disposableFault(req, 'branch_auth_create')) {
      await admin.rpc('set_first_branch_provisioning_result', {
        p_provisioning_id: provisioningId, p_state: 'failed_recoverable',
        p_error_code: 'BRANCH_AUTH_CREATE_FAILED',
      })
      return json({
        code: 'CORE_BRANCH_READY_ACCESS_FAILED', provisioning_id: provisioningId,
        branch_id: state.branch_id,
      }, 503)
    }
    const { data: existingMapping } = await admin.from('branch_login_usernames')
      .select('user_id,branch_id').eq('normalized_username', usernameResult.normalizedUsername).maybeSingle()
    if (existingMapping && existingMapping.branch_id !== state.branch_id) {
      return json({
        code: 'RESUMABLE_LOGIN_CONFLICT', provisioning_id: provisioningId, branch_id: state.branch_id,
      }, 409)
    }
    let authUser = await findAuthUserByEmail(admin, internalEmail)
    if (authUser && authUser.user_metadata?.first_branch_provisioning_id !== provisioningId) {
      return json({
        code: 'RESUMABLE_LOGIN_CONFLICT', provisioning_id: provisioningId, branch_id: state.branch_id,
      }, 409)
    }
    if (!authUser) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: internalEmail, password: body.password, email_confirm: true,
        user_metadata: {
          full_name: body.name.trim(), first_branch_provisioning_id: provisioningId,
          login_method: 'branch_username',
        },
      })
      if (createError || !created.user) {
        const racedUser = await findAuthUserByEmail(admin, internalEmail)
        if (racedUser?.user_metadata?.first_branch_provisioning_id !== provisioningId) {
          await admin.rpc('set_first_branch_provisioning_result', {
            p_provisioning_id: provisioningId, p_state: 'failed_recoverable',
            p_error_code: 'BRANCH_AUTH_CREATE_FAILED',
          })
          return json({
            code: 'CORE_BRANCH_READY_ACCESS_FAILED', provisioning_id: provisioningId,
            branch_id: state.branch_id,
          }, 503)
        }
        authUser = racedUser
      } else {
        authUser = created.user
      }
    } else {
      const { error: updateError } = await admin.auth.admin.updateUserById(authUser.id, { password: body.password })
      if (updateError) return json({
        code: 'CORE_BRANCH_READY_ACCESS_FAILED', provisioning_id: provisioningId, branch_id: state.branch_id,
      }, 503)
    }
    const { error: completionError } = await admin.rpc('complete_first_branch_access', {
      p_provisioning_id: provisioningId, p_auth_user_id: authUser.id,
      p_username: usernameResult.normalizedUsername, p_internal_auth_email: internalEmail,
      p_full_name: body.name.trim(),
    })
    if (completionError) {
      const conflict = /USERNAME_CONFLICT/.test(completionError.message)
      await admin.rpc('set_first_branch_provisioning_result', {
        p_provisioning_id: provisioningId,
        p_state: conflict ? 'branch_ready' : 'failed_manual_review',
        p_error_code: conflict ? 'USERNAME_CONFLICT' : 'ACCESS_RECONCILIATION_FAILED',
      })
      return json({
        code: conflict ? 'RESUMABLE_LOGIN_CONFLICT' : 'MANUAL_REVIEW_REQUIRED',
        provisioning_id: provisioningId, branch_id: state.branch_id,
      }, 409)
    }
    await auditEvent(admin as any, {
      ...auditBase, branchId: state.branch_id, targetId: provisioningId,
      action: 'first_branch_provisioned', status: 'succeeded',
      metadata: { step: 'complete', durationMs: Date.now() - started },
    })
    console.info('[provision-first-branch]', {
      provisioningId, step: 'complete', result: 'COMPLETE', durationMs: Date.now() - started,
    })
    await disposableDelay(req, 'branch_response_after_complete')
    return json({ code: 'COMPLETE', provisioning_id: provisioningId, branch_id: state.branch_id })
  } catch {
    console.error('[provision-first-branch]', {
      provisioningId, step: 'unhandled', code: 'INTERNAL_ERROR', durationMs: Date.now() - started,
    })
    return json({ code: 'FAILED_RECOVERABLE', provisioning_id: provisioningId }, 500)
  }
})
