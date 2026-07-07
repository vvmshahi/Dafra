import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl      = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('DAFRA_SERVICE_ROLE_KEY')

    if (!SERVICE_ROLE_KEY || !SERVICE_ROLE_KEY.startsWith('eyJ')) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(supabaseUrl, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Verify caller is owner ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerJWT  = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!callerJWT) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(callerJWT)
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role, tenant_id, is_active')
      .eq('id', caller.id)
      .maybeSingle()

    if (
      profileErr ||
      !callerProfile ||
      callerProfile.is_active !== true ||
      !['owner', 'admin'].includes(callerProfile.role)
    ) {
      return new Response(JSON.stringify({ error: 'Forbidden: owner/admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const { branch_id, new_password } = await req.json()

    if (!branch_id || !new_password) {
      return new Response(JSON.stringify({ error: 'Missing required fields: branch_id, new_password' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (new_password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Verify branch belongs to caller's tenant ──────────────────────────────
    const { data: branchRow } = await adminClient
      .from('branches')
      .select('id, tenant_id')
      .eq('id', branch_id)
      .maybeSingle()

    if (!branchRow || branchRow.tenant_id !== callerProfile.tenant_id) {
      return new Response(JSON.stringify({ error: 'Branch not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId: callerProfile.tenant_id,
      branchId: branch_id,
      actorUserId: caller.id,
      actorRole: callerProfile.role,
      targetType: 'branch',
      targetId: branch_id,
      ipHash,
      requestId: reqId,
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'branch_password_reset_attempted',
      severity: 'warning',
      status: 'attempted',
    })

    const rate = await enforceRateLimit(adminClient as any, {
      ...auditBase,
      action: 'reset_branch_password',
      scope: 'branch',
      scopeId: branch_id,
      maxAttempts: 5,
      windowSeconds: 3600,
    })

    if (!rate.allowed) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_password_reset_rate_limited',
        severity: 'warning',
        status: 'blocked',
        metadata: { retryAfterSeconds: rate.retryAfterSeconds },
      })
      return new Response(JSON.stringify(rateLimitBody(rate)), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Find branch user ──────────────────────────────────────────────────────
    const { data: branchUser } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('branch_id', branch_id)
      .eq('role', 'branch')
      .maybeSingle()

    if (!branchUser) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_password_reset_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { reason: 'branch_user_not_found' },
      })
      return new Response(JSON.stringify({ error: 'No branch user found for this branch' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Update password ───────────────────────────────────────────────────────
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(branchUser.id, {
      password: new_password,
    })

    if (updateErr) {
      console.error('[reset-branch-credential] updateUserById failed:', updateErr.message)
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_password_reset_failed',
        severity: 'warning',
        status: 'failed',
        targetType: 'user_profile',
        targetId: branchUser.id,
        metadata: { stage: 'auth_update' },
      })
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'branch_password_reset_completed',
      severity: 'warning',
      status: 'succeeded',
      targetType: 'user_profile',
      targetId: branchUser.id,
      metadata: { branchId: branch_id },
    })

    console.info('[reset-branch-credential] credential updated:', { branchId: branch_id, userId: branchUser.id })
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[reset-branch-credential] Unhandled error:', message)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
