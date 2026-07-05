import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'
import { validateBranchUsername } from '../_shared/branch-username.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GENERIC_LOGIN_MESSAGE = 'Invalid login credentials'

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, message: GENERIC_LOGIN_MESSAGE }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('DAFRA_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey || !serviceRoleKey.startsWith('eyJ')) {
      return jsonResponse({ ok: false, message: 'Server configuration error' }, 500)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      actorRole: 'anonymous',
      targetType: 'branch_login_username',
      ipHash,
      requestId: reqId,
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'branch_username_resolve_attempted',
      status: 'attempted',
    })

    const rate = ipHash
      ? await enforceRateLimit(adminClient as any, {
        ...auditBase,
        action: 'resolve_branch_username',
        scope: 'ip',
        scopeId: ipHash,
        maxAttempts: 30,
        windowSeconds: 300,
        metadata: { hasIpHash: true },
      })
      : { allowed: true, retryAfterSeconds: 0 }

    if (!ipHash) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_username_resolve_rate_limit_skipped',
        severity: 'warning',
        status: 'attempted',
        metadata: { reason: 'ip_hash_unavailable' },
      })
    } else if (!rate.allowed) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_username_resolve_rate_limited',
        severity: 'warning',
        status: 'blocked',
        metadata: { retryAfterSeconds: rate.retryAfterSeconds },
      })

      const body = rateLimitBody(rate)
      return jsonResponse({
        ok: false,
        message: body.error,
        retryAfterSeconds: rate.retryAfterSeconds,
      }, 429)
    }

    let payload: unknown
    try {
      payload = await req.json()
    } catch {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_username_resolve_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { reason: 'invalid_json' },
      })
      return jsonResponse({ ok: false, message: GENERIC_LOGIN_MESSAGE })
    }

    const rawUsername = typeof payload === 'object' && payload !== null && 'username' in payload
      ? (payload as { username?: unknown }).username
      : ''

    const username = validateBranchUsername(rawUsername)
    if (!username.ok) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_username_resolve_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { reason: 'invalid_username' },
      })
      return jsonResponse({ ok: false, message: GENERIC_LOGIN_MESSAGE })
    }

    const { data: mapping, error: lookupErr } = await adminClient
      .from('branch_login_usernames')
      .select('internal_auth_email')
      .eq('normalized_username', username.normalizedUsername)
      .eq('is_active', true)
      .maybeSingle()

    if (lookupErr) {
      console.warn('[resolve-branch-username] lookup failed:', lookupErr.message)
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_username_resolve_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { reason: 'lookup_error' },
      })
      return jsonResponse({ ok: false, message: GENERIC_LOGIN_MESSAGE })
    }

    if (!mapping?.internal_auth_email) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_username_resolve_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { reason: 'not_found' },
      })
      return jsonResponse({ ok: false, message: GENERIC_LOGIN_MESSAGE })
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'branch_username_resolved',
      status: 'succeeded',
    })

    return jsonResponse({ ok: true, authEmail: mapping.internal_auth_email })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[resolve-branch-username] Unhandled error:', message)
    return jsonResponse({ ok: false, message: GENERIC_LOGIN_MESSAGE }, 500)
  }
})
