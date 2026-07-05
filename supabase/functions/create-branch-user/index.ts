import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'
import { internalBranchAuthEmail, validateBranchUsername } from '../_shared/branch-username.ts'

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
    // ── Step 1: Read DAFRA_SERVICE_ROLE_KEY (manually-set secret) ─────────
    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('DAFRA_SERVICE_ROLE_KEY')

    if (!SERVICE_ROLE_KEY || !SERVICE_ROLE_KEY.startsWith('eyJ')) {
      return new Response(JSON.stringify({ error: 'Server configuration error - invalid key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(supabaseUrl, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Step 2: Verify caller's JWT ────────────────────────────────────────
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
    const callerId = caller.id

    // ── Step 3: Verify caller role via adminClient (bypasses RLS) ─────────
    const { data: callerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', callerId)
      .maybeSingle()

    console.log('[create-branch-user] Caller profile:', JSON.stringify(callerProfile))
    console.log('[create-branch-user] Profile error:', JSON.stringify(profileErr))

    if (profileErr || !callerProfile) {
      console.error('[create-branch-user] Could not read caller profile:', profileErr?.message)
      return new Response(JSON.stringify({ error: 'Could not verify caller: ' + (profileErr?.message ?? 'profile not found') }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (callerProfile.role !== 'owner') {
      console.error('[create-branch-user] Caller is not an owner:', callerProfile.role)
      return new Response(JSON.stringify({ error: 'Forbidden: owner role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step 4: Parse and validate request body ───────────────────────────
    const { email, username, password, full_name, tenant_id, branch_id } = await req.json()
    const requestedEmail = typeof email === 'string' ? email.trim() : ''
    const requestedUsername = typeof username === 'string' ? username.trim() : ''
    const usesUsername = requestedUsername.length > 0

    console.log('[create-branch-user] Request parsed:', {
      hasEmail: requestedEmail.length > 0,
      hasUsername: usesUsername,
      tenant_id,
      branch_id,
    })

    if ((!requestedEmail && !usesUsername) || !password || !tenant_id || !branch_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email or username, password, tenant_id, branch_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (tenant_id !== callerProfile.tenant_id) {
      console.error('[create-branch-user] Tenant mismatch — body:', tenant_id, 'caller:', callerProfile.tenant_id)
      return new Response(JSON.stringify({ error: 'Forbidden: tenant mismatch' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (typeof password !== 'string' || password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: branchRow, error: branchErr } = await adminClient
      .from('branches')
      .select('id, tenant_id')
      .eq('id', branch_id)
      .maybeSingle()

    if (branchErr || !branchRow || branchRow.tenant_id !== tenant_id) {
      return new Response(JSON.stringify({ error: 'Branch not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let normalizedEmail = requestedEmail.toLowerCase()
    let usernameMapping: {
      username: string
      normalizedUsername: string
      internalAuthEmail: string
    } | null = null

    if (usesUsername) {
      const usernameValidation = validateBranchUsername(requestedUsername)
      if (!usernameValidation.ok) {
        return new Response(JSON.stringify({ error: usernameValidation.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const internalAuthEmail = internalBranchAuthEmail(usernameValidation.normalizedUsername, branch_id)
      normalizedEmail = internalAuthEmail
      usernameMapping = {
        username: usernameValidation.normalizedUsername,
        normalizedUsername: usernameValidation.normalizedUsername,
        internalAuthEmail,
      }
    }

    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId: tenant_id,
      branchId: branch_id,
      actorUserId: callerId,
      actorRole: 'owner',
      targetType: 'branch',
      targetId: branch_id,
      ipHash,
      requestId: reqId,
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'branch_user_create_attempted',
      status: 'attempted',
    })

    const rate = await enforceRateLimit(adminClient as any, {
      ...auditBase,
      action: 'create_branch_user',
      scope: 'tenant',
      scopeId: tenant_id,
      maxAttempts: 10,
      windowSeconds: 3600,
    })

    if (!rate.allowed) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_user_create_rate_limited',
        severity: 'warning',
        status: 'blocked',
        metadata: { retryAfterSeconds: rate.retryAfterSeconds },
      })
      return new Response(JSON.stringify(rateLimitBody(rate)), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (usernameMapping) {
      const { data: existingUsername, error: existingUsernameErr } = await adminClient
        .from('branch_login_usernames')
        .select('id')
        .eq('normalized_username', usernameMapping.normalizedUsername)
        .maybeSingle()

      if (existingUsernameErr) {
        console.error('[create-branch-user] username lookup failed:', existingUsernameErr.message)
        await auditEvent(adminClient as any, {
          ...auditBase,
          action: 'branch_user_create_failed',
          severity: 'warning',
          status: 'failed',
          metadata: { stage: 'username_lookup' },
        })
        return new Response(JSON.stringify({ error: 'Could not validate username availability' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (existingUsername) {
        await auditEvent(adminClient as any, {
          ...auditBase,
          action: 'branch_user_create_failed',
          severity: 'warning',
          status: 'failed',
          metadata: { stage: 'username_lookup', reason: 'username_taken' },
        })
        return new Response(JSON.stringify({ error: 'Username is already taken' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Step 5: Create the auth user via admin API ────────────────────────
    console.log('[create-branch-user] Creating auth user:', {
      hasEmail: !usernameMapping,
      hasUsername: !!usernameMapping,
      branch_id,
    })

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name?.trim() ?? '',
        role:      'branch',
        tenant_id,
        branch_id,
        login_method: usernameMapping ? 'branch_username' : 'branch_email',
      },
    })

    if (createErr) {
      console.error('[create-branch-user] createUser failed:', createErr.message)
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'branch_user_create_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { stage: 'auth_create' },
      })
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = created.user.id
    console.log('[create-branch-user] Auth user created:', newUserId)
    const nowIso = new Date().toISOString()

    // ── Step 6: Set the user_profiles row ────────────────────────────────
    const { data: updatedRows, error: updateErr } = await adminClient
      .from('user_profiles')
      .update({
        role:       'branch',
        tenant_id,
        branch_id,
        full_name:  full_name?.trim() ?? '',
        email:      normalizedEmail,
        updated_at: nowIso,
      })
      .eq('id', newUserId)
      .select('id')

    console.log('[create-branch-user] Profile update: rows=', updatedRows?.length ?? 0, '| error=', updateErr?.message ?? 'none')

    if (!updatedRows?.length) {
      console.log('[create-branch-user] No row updated — upserting profile')
      const { error: upsertErr } = await adminClient
        .from('user_profiles')
        .upsert({
          id:         newUserId,
          role:       'branch',
          tenant_id,
          branch_id,
          full_name:  full_name?.trim() ?? '',
          email:      normalizedEmail,
          updated_at: nowIso,
        }, { onConflict: 'id' })

      if (upsertErr) {
        console.error('[create-branch-user] Profile upsert failed:', upsertErr.message)
        if (usernameMapping) {
          await adminClient.auth.admin.deleteUser(newUserId)
        }
        await auditEvent(adminClient as any, {
          ...auditBase,
          action: 'branch_user_create_failed',
          severity: 'warning',
          status: 'failed',
          targetType: 'user_profile',
          targetId: newUserId,
          metadata: { stage: 'profile_upsert' },
        })
        if (usernameMapping) {
          return new Response(
            JSON.stringify({ error: 'Profile setup failed: ' + upsertErr.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({ user_id: newUserId, warning: 'Profile setup failed: ' + upsertErr.message }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      console.log('[create-branch-user] Profile upserted successfully')
    }

    if (usernameMapping) {
      const { error: usernameInsertErr } = await adminClient
        .from('branch_login_usernames')
        .insert({
          tenant_id,
          branch_id,
          user_id: newUserId,
          username: usernameMapping.username,
          normalized_username: usernameMapping.normalizedUsername,
          internal_auth_email: usernameMapping.internalAuthEmail,
          created_by: callerId,
          updated_by: callerId,
        })

      if (usernameInsertErr) {
        console.error('[create-branch-user] Username mapping insert failed:', usernameInsertErr.message)
        await adminClient.auth.admin.deleteUser(newUserId)
        await auditEvent(adminClient as any, {
          ...auditBase,
          action: 'branch_user_create_failed',
          severity: 'warning',
          status: 'failed',
          targetType: 'user_profile',
          targetId: newUserId,
          metadata: {
            stage: 'username_mapping_insert',
            reason: usernameInsertErr.code === '23505' ? 'username_taken' : 'insert_failed',
          },
        })

        return new Response(
          JSON.stringify({
            error: usernameInsertErr.code === '23505'
              ? 'Username is already taken'
              : 'Username setup failed: ' + usernameInsertErr.message,
          }),
          {
            status: usernameInsertErr.code === '23505' ? 409 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        )
      }
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'branch_user_created',
      status: 'succeeded',
      targetType: 'user_profile',
      targetId: newUserId,
      metadata: { branchId: branch_id, loginMode: usernameMapping ? 'username' : 'email' },
    })

    console.log('[create-branch-user] Success — user_id:', newUserId)
    return new Response(JSON.stringify({
      user_id: newUserId,
      ...(usernameMapping ? { username: usernameMapping.normalizedUsername } : {}),
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[create-branch-user] Unhandled error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
