import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REDIRECT_TO = 'https://dafra.vercel.app/reset-password'

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('DAFRA_SERVICE_ROLE_KEY')

    if (!serviceRoleKey || !serviceRoleKey.startsWith('eyJ')) {
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const authHeader = req.headers.get('Authorization') ?? ''
    const callerJWT = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!callerJWT) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(callerJWT)
    if (authError || !caller) {
      return jsonResponse({ error: 'Invalid token' }, 401)
    }

    const { data: callerProfile, error: callerProfileErr } = await adminClient
      .from('user_profiles')
      .select('role, is_active')
      .eq('id', caller.id)
      .maybeSingle()

    if (callerProfileErr || !callerProfile || callerProfile.is_active !== true) {
      return jsonResponse({ error: 'Could not verify caller' }, 403)
    }

    if (callerProfile.role !== 'super_admin') {
      return jsonResponse({ error: 'Forbidden: super_admin role required' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const tenantId = typeof body?.tenant_id === 'string' ? body.tenant_id.trim() : ''

    if (!tenantId || !UUID_RE.test(tenantId)) {
      return jsonResponse({ error: 'Missing or invalid tenant_id' }, 400)
    }

    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId,
      branchId: null,
      actorUserId: caller.id,
      actorRole: 'super_admin',
      targetType: 'tenant',
      targetId: tenantId,
      ipHash,
      requestId: reqId,
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'owner_setup_link_resend_attempted',
      severity: 'warning',
      status: 'attempted',
    })

    const rate = await enforceRateLimit(adminClient as any, {
      ...auditBase,
      action: 'resend_owner_setup_link',
      scope: 'tenant',
      scopeId: tenantId,
      maxAttempts: 10,
      windowSeconds: 3600,
    })

    if (!rate.allowed) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_setup_link_resend_rate_limited',
        severity: 'warning',
        status: 'blocked',
        metadata: { retryAfterSeconds: rate.retryAfterSeconds },
      })
      return jsonResponse(rateLimitBody(rate), 429)
    }

    const { data: tenant, error: tenantErr } = await adminClient
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .maybeSingle()

    if (tenantErr) {
      return jsonResponse({ error: 'Could not verify tenant' }, 500)
    }

    if (!tenant) {
      return jsonResponse({ error: 'Tenant not found' }, 404)
    }

    const { data: ownerProfile, error: ownerErr } = await adminClient
      .from('user_profiles')
      .select('id, email, full_name, is_active, created_at')
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (ownerErr) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_setup_link_resend_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { stage: 'owner_lookup' },
      })
      return jsonResponse({ error: 'Could not find tenant owner' }, 500)
    }

    if (!ownerProfile) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_setup_link_resend_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { stage: 'owner_lookup', reason: 'owner_not_found' },
      })
      return jsonResponse({ error: 'Active tenant owner not found' }, 404)
    }

    let ownerEmail = typeof ownerProfile.email === 'string' ? ownerProfile.email.trim().toLowerCase() : ''
    if (!ownerEmail) {
      const { data: authUser, error: authUserErr } = await adminClient.auth.admin.getUserById(ownerProfile.id)
      if (authUserErr) {
        return jsonResponse({ error: 'Could not verify owner email' }, 500)
      }
      ownerEmail = authUser.user?.email?.trim().toLowerCase() ?? ''
    }

    if (!ownerEmail) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_setup_link_resend_failed',
        severity: 'warning',
        status: 'failed',
        targetType: 'user_profile',
        targetId: ownerProfile.id,
        metadata: { stage: 'owner_email_lookup' },
      })
      return jsonResponse({ error: 'Owner email not found' }, 400)
    }

    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: ownerEmail,
      options: {
        redirectTo: REDIRECT_TO,
      },
    })

    const setupLink = linkData?.properties?.action_link ?? null
    if (linkErr || !setupLink) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_setup_link_resend_failed',
        severity: 'warning',
        status: 'failed',
        targetType: 'user_profile',
        targetId: ownerProfile.id,
        metadata: { stage: 'generate_link' },
      })
      return jsonResponse({ error: 'Could not generate owner setup link' }, 500)
    }

    const nowIso = new Date().toISOString()
    const { data: onboardingRow } = await adminClient
      .from('tenant_onboarding_status')
      .select('id, onboarding_status, owner_setup_status, owner_setup_completed_at')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const ownerSetupComplete = onboardingRow?.owner_setup_status === 'owner_setup_complete' ||
      !!onboardingRow?.owner_setup_completed_at
    const nextOnboardingStatus = onboardingRow?.onboarding_status &&
      !['details_pending', 'owner_invited'].includes(onboardingRow.onboarding_status)
      ? onboardingRow.onboarding_status
      : 'owner_invited'

    const onboardingPayload = {
      tenant_id: tenantId,
      onboarding_status: nextOnboardingStatus,
      owner_setup_status: ownerSetupComplete ? 'owner_setup_complete' : 'owner_invited',
      owner_setup_link_sent_at: nowIso,
      updated_by: caller.id,
    }

    const onboardingQuery = onboardingRow?.id
      ? adminClient.from('tenant_onboarding_status').update(onboardingPayload).eq('id', onboardingRow.id)
      : adminClient.from('tenant_onboarding_status').insert(onboardingPayload)

    const { error: onboardingErr } = await onboardingQuery
    if (onboardingErr) {
      console.warn('[resend-owner-setup-link] onboarding update skipped:', onboardingErr.message)
    }

    const { error: noteErr } = await adminClient
      .from('tenant_support_notes')
      .insert({
        tenant_id: tenantId,
        note: `Owner setup link resent to ${ownerEmail}.`,
        note_type: 'onboarding',
        created_by: caller.id,
      })
    if (noteErr) {
      console.warn('[resend-owner-setup-link] support note skipped:', noteErr.message)
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'owner_setup_link_resent',
      severity: 'warning',
      status: 'succeeded',
      targetType: 'user_profile',
      targetId: ownerProfile.id,
      metadata: {
        ownerUserId: ownerProfile.id,
        ownerEmail,
        tenantName: tenant.name,
        onboardingUpdated: !onboardingErr,
        supportNoteCreated: !noteErr,
      },
    })

    return jsonResponse({
      setupLink,
      ownerEmail,
      ownerUserId: ownerProfile.id,
      ownerName: ownerProfile.full_name ?? null,
      ownerSetupLinkSentAt: nowIso,
      expiresNote: 'This setup link uses Supabase recovery link expiry settings.',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[resend-owner-setup-link] Unhandled error:', message)
    return jsonResponse({ error: 'Internal error' }, 500)
  }
})
