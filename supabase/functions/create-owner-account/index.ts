import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'
import { resolveOwnerSetupRedirectUrl } from '../_shared/owner_setup_redirect.ts'
import { disposableDelay, disposableFault } from '../_shared/test-faults.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dafra-test-fault, x-dafra-test-fault-secret',
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

async function normalizeLegacyBlankVat(admin: any, provisioningId: string): Promise<boolean> {
  const { data, error } = await admin.from('owner_provisioning_requests')
    .select('request_payload')
    .eq('id', provisioningId)
    .maybeSingle()
  if (error || !data) return false

  const payload = data.request_payload as Record<string, unknown>
  // Pre-fix requests persist blank VAT as an empty string. Normalize only this
  // nullable field and retain the durable original request/fingerprint.
  if (payload.vat_number !== '') return true
  const { error: updateError } = await admin.from('owner_provisioning_requests')
    .update({ request_payload: { ...payload, vat_number: null } })
    .eq('id', provisioningId)
  return !updateError
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const started = Date.now()
  let provisioningId: string | null = null
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    // Production retains the explicitly managed Dafra key; local Supabase
    // workers expose the equivalent standard service-role key by default.
    const serviceKey = Deno.env.get('DAFRA_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceKey?.startsWith('eyJ')) return json({ code: 'SERVER_CONFIGURATION_ERROR' }, 500)
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ code: 'UNAUTHORIZED' }, 401)
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(jwt)
    if (authError || !caller) return json({ code: 'UNAUTHORIZED' }, 401)
    const { data: callerProfile } = await admin.from('user_profiles').select('role,is_active').eq('id', caller.id).maybeSingle()
    if (callerProfile?.role !== 'super_admin' || callerProfile?.is_active !== true) {
      return json({ code: 'FORBIDDEN' }, 403)
    }

    const redirectTo = resolveOwnerSetupRedirectUrl()
    const body = await req.json()
    const normalizedEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const companyName = typeof body.company_name === 'string' ? body.company_name.trim() : ''
    const branchCount = body.branch_count
    const paymentType = body.payment_type
    if (!companyName || !normalizedEmail || typeof body.plan_id !== 'string'
      || !Number.isInteger(branchCount) || branchCount < 1 || branchCount > 100
      || !['one_time', 'monthly', 'lifetime_free'].includes(paymentType)) {
      return json({ code: 'INVALID_REQUEST' }, 400)
    }
    const safePayload = {
      company_name: companyName,
      company_name_ar: body.company_name_ar?.trim() || null,
      // Postgres UNIQUE permits multiple NULLs, but only one empty string.
      // Keep the fingerprint's legacy empty-string representation below so a
      // retry can acquire a request created before this normalization.
      vat_number: body.vat_number?.trim() || null,
      cr_number: body.cr_number?.trim() || null,
      phone: body.phone?.trim() || null,
      city: body.city?.trim() || null,
      business_type: body.business_type === 'service' ? 'service' : 'trading',
      branch_count: branchCount,
      payment_type: paymentType,
      duration_months: Number.isInteger(body.duration_months) ? body.duration_months : 0,
      ends_at: body.ends_at || null,
      pay_method: body.pay_method || null,
      pay_ref: body.pay_ref || null,
      notes: body.notes?.trim() || null,
    }
    // ends_at is intentionally excluded: the UI derives it from "now", so a
    // retry seconds later must still address the original durable request.
    const fingerprint = await sha256(JSON.stringify({
      email: normalizedEmail, plan_id: body.plan_id, company_name: safePayload.company_name,
      company_name_ar: safePayload.company_name_ar, vat_number: safePayload.vat_number ?? '',
      cr_number: safePayload.cr_number, phone: safePayload.phone, city: safePayload.city,
      business_type: safePayload.business_type, branch_count: safePayload.branch_count,
      payment_type: safePayload.payment_type, duration_months: safePayload.duration_months,
      pay_method: safePayload.pay_method, pay_ref: safePayload.pay_ref, notes: safePayload.notes,
    }))
    const auditBase = {
      tenantId: null, branchId: null, actorUserId: caller.id, actorRole: 'super_admin',
      targetType: 'owner_provisioning', targetId: null, ipHash: await hashRequestIp(req), requestId: requestId(req),
    }
    const rate = await enforceRateLimit(admin as any, {
      ...auditBase, action: 'create_owner_account', scope: 'actor', scopeId: caller.id,
      maxAttempts: 20, windowSeconds: 86400,
    })
    if (!rate.allowed) return json(rateLimitBody(rate), 429)

    const { data: acquired, error: acquireError } = await admin.rpc('acquire_owner_provisioning', {
      p_initiated_by: caller.id,
      p_normalized_email: normalizedEmail,
      p_plan_id: body.plan_id,
      p_request_fingerprint: fingerprint,
      p_request_payload: safePayload,
    })
    if (acquireError || !acquired?.[0]) {
      const code = /PLAN_NOT_ELIGIBLE/.test(acquireError?.message ?? '') ? 'PLAN_NOT_ELIGIBLE'
        : /INVALID_BRANCH_ALLOWANCE/.test(acquireError?.message ?? '') ? 'INVALID_REQUEST'
        : /LEGACY_BRANCH_ALLOWANCE_REVIEW_REQUIRED/.test(acquireError?.message ?? '') ? 'BRANCH_ENTITLEMENT_REVIEW_REQUIRED'
        : /CONFLICT/.test(acquireError?.message ?? '') ? 'CONFLICT_REQUEST_DATA' : 'FAILED_RECOVERABLE'
      return json({ code }, code === 'FAILED_RECOVERABLE' ? 503 : code === 'INVALID_REQUEST' ? 400 : 409)
    }
    const state = acquired[0]
    provisioningId = state.provisioning_id
    let authUserId = state.auth_user_id as string | null

    if (state.state !== 'complete' && !state.tenant_id && !await normalizeLegacyBlankVat(admin, provisioningId)) {
      console.error('[create-owner-account]', {
        provisioningId, step: 'normalize_legacy_vat', code: 'REQUEST_RECONCILIATION_FAILED',
        durationMs: Date.now() - started,
      })
      return json({ code: 'FAILED_RECOVERABLE', provisioning_id: provisioningId }, 503)
    }

    if (!authUserId) {
      const existing = await findAuthUserByEmail(admin, normalizedEmail)
      if (existing) {
        if (existing.user_metadata?.owner_provisioning_id !== provisioningId) {
          await admin.rpc('set_owner_provisioning_result', {
            p_provisioning_id: provisioningId, p_state: 'failed_manual_review',
            p_error_code: 'EXISTING_AUTH_IDENTITY',
          })
          return json({ code: 'CONFLICT_EXISTING_UNRELATED_USER', provisioning_id: provisioningId }, 409)
        }
        authUserId = existing.id
      } else {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
          user_metadata: { full_name: companyName, owner_provisioning_id: provisioningId },
        })
        if (createError || !created.user?.id) {
          const racedUser = await findAuthUserByEmail(admin, normalizedEmail)
          if (racedUser?.user_metadata?.owner_provisioning_id !== provisioningId) {
            await admin.rpc('set_owner_provisioning_result', {
              p_provisioning_id: provisioningId, p_state: 'failed_recoverable',
              p_error_code: 'AUTH_CREATE_FAILED',
            })
            return json({ code: 'FAILED_RECOVERABLE', provisioning_id: provisioningId }, 503)
          }
          authUserId = racedUser.id
        } else {
          authUserId = created.user.id
        }
      }
      const { error: attachError } = await admin.rpc('attach_owner_provisioning_auth', {
        p_provisioning_id: provisioningId, p_auth_user_id: authUserId,
      })
      if (attachError) {
        await admin.rpc('set_owner_provisioning_result', {
          p_provisioning_id: provisioningId, p_state: 'failed_manual_review',
          p_error_code: 'AUTH_RECONCILIATION_FAILED',
        })
        return json({ code: 'MANUAL_REVIEW_REQUIRED', provisioning_id: provisioningId }, 409)
      }
    }

    const { data: core, error: coreError } = await admin.rpc('complete_owner_provisioning_core', {
      p_provisioning_id: provisioningId,
    })
    if (coreError || !core?.[0]) {
      if (/(BRANCH_ALLOWANCE_MISSING|BRANCH_ENTITLEMENT_CONFLICT|ACTIVE_SUBSCRIPTION_CONFLICT)/.test(coreError?.message ?? '')) {
        await admin.rpc('set_owner_provisioning_result', {
          p_provisioning_id: provisioningId, p_state: 'failed_manual_review',
          p_error_code: 'BRANCH_ENTITLEMENT_REVIEW_REQUIRED',
        })
        return json({ code: 'BRANCH_ENTITLEMENT_REVIEW_REQUIRED', provisioning_id: provisioningId }, 409)
      }
      console.error('[create-owner-account]', {
        provisioningId, step: 'core', code: 'CORE_DATABASE_FAILED',
        databaseCode: typeof coreError?.code === 'string' ? coreError.code : null,
        durationMs: Date.now() - started,
      })
      await admin.rpc('set_owner_provisioning_result', {
        p_provisioning_id: provisioningId, p_state: 'failed_recoverable',
        p_error_code: 'CORE_DATABASE_FAILED',
      })
      return json({ code: 'FAILED_RECOVERABLE', provisioning_id: provisioningId }, 503)
    }
    const result = core[0]
    const forcedLinkFailure = disposableFault(req, 'owner_setup_link')
    const { data: linkData, error: linkError } = forcedLinkFailure
      ? { data: null, error: new Error('DISPOSABLE_SETUP_LINK_FAILURE') }
      : await admin.auth.admin.generateLink({
        type: 'recovery', email: normalizedEmail, options: { redirectTo },
      })
    const setupLink = linkData?.properties?.action_link
    if (linkError || !setupLink) {
      await admin.rpc('set_owner_provisioning_result', {
        p_provisioning_id: provisioningId, p_state: 'failed_recoverable',
        p_error_code: 'SETUP_LINK_UNAVAILABLE',
      })
      await auditEvent(admin as any, {
        ...auditBase, tenantId: result.tenant_id, targetId: provisioningId,
        action: 'owner_provisioning_partial', severity: 'warning', status: 'failed',
        metadata: { step: 'setup_link', code: 'SETUP_LINK_UNAVAILABLE', durationMs: Date.now() - started },
      })
      return json({
        code: 'CORE_COMPLETE_SETUP_LINK_FAILED', provisioning_id: provisioningId,
        user_id: authUserId, tenant_id: result.tenant_id, account_provisioned: true,
      }, 503)
    }
    await admin.rpc('set_owner_provisioning_result', {
      p_provisioning_id: provisioningId, p_state: 'complete', p_error_code: null,
    })
    await admin.from('tenant_onboarding_status').upsert({
      tenant_id: result.tenant_id, onboarding_status: 'owner_invited',
      owner_setup_status: 'owner_invited', owner_setup_link_sent_at: new Date().toISOString(),
      updated_by: caller.id,
    }, { onConflict: 'tenant_id' })
    const responseCode = state.is_replay
      ? (state.state === 'complete' ? 'COMPLETE_SETUP_LINK_REGENERATED' : 'RESUMED_AND_COMPLETE')
      : 'COMPLETE'
    console.info('[create-owner-account]', {
      provisioningId, step: 'complete', result: responseCode, durationMs: Date.now() - started,
    })
    await disposableDelay(req, 'owner_response_after_complete')
    return json({
      code: responseCode, provisioning_id: provisioningId, user_id: authUserId,
      tenant_id: result.tenant_id, subscription_id: result.subscription_id,
      setup_link_generated: true, setup_link: setupLink,
    })
  } catch (error) {
    console.error('[create-owner-account]', {
      provisioningId, step: 'unhandled', code: 'INTERNAL_ERROR', durationMs: Date.now() - started,
    })
    return json({ code: 'FAILED_RECOVERABLE', provisioning_id: provisioningId }, 500)
  }
})
