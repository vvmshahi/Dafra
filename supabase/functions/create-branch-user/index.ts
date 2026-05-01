/**
 * create-branch-user Edge Function
 *
 * Creates a branch login account without requiring email confirmation.
 * Only callable by authenticated owners within the same tenant.
 *
 * POST /functions/v1/create-branch-user
 * Body: { email, password, full_name, tenant_id, branch_id }
 * Returns: { user_id: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Step 1: Build service-role client ─────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    console.log('[create-branch-user] SUPABASE_URL present:', !!supabaseUrl)
    console.log('[create-branch-user] SERVICE_ROLE_KEY prefix:', serviceKey?.substring(0, 12) ?? 'MISSING')

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Step 2: Verify the caller is an authenticated owner ───────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')
    console.log('[create-branch-user] JWT present:', jwt.length > 0)

    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(jwt)
    if (authErr || !caller) {
      console.error('[create-branch-user] Auth failed:', authErr?.message)
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.log('[create-branch-user] Caller user_id:', caller.id)

    // ── Step 3: Verify caller is an owner ─────────────────────────────────
    const { data: callerProfile, error: profileErr } = await admin
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', caller.id)
      .single()

    if (profileErr || !callerProfile) {
      console.error('[create-branch-user] Could not read caller profile:', profileErr?.message)
      return new Response(JSON.stringify({ error: 'Could not verify caller role' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.log('[create-branch-user] Caller role:', callerProfile.role, '| tenant_id:', callerProfile.tenant_id)

    if (callerProfile.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Forbidden: owner role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step 4: Parse and validate body ───────────────────────────────────
    const body = await req.json()
    const { email, password, full_name, tenant_id, branch_id } = body
    console.log('[create-branch-user] Request body: email=', email, '| tenant_id=', tenant_id, '| branch_id=', branch_id)

    if (tenant_id !== callerProfile.tenant_id) {
      console.error('[create-branch-user] Tenant mismatch: body=', tenant_id, 'caller=', callerProfile.tenant_id)
      return new Response(JSON.stringify({ error: 'Forbidden: tenant mismatch' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!email || !password || !tenant_id || !branch_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email, password, tenant_id, branch_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step 5: Create auth user ──────────────────────────────────────────
    const normalizedEmail = email.trim().toLowerCase()
    console.log('[create-branch-user] Creating auth user:', normalizedEmail)

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name?.trim() ?? '',
        role:      'branch',
        tenant_id,
        branch_id,
      },
    })

    if (createErr) {
      console.error('[create-branch-user] createUser failed:', createErr.message)
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = created.user.id
    console.log('[create-branch-user] Auth user created:', newUserId)

    // ── Step 6: Set user_profiles row ────────────────────────────────────
    // The handle_new_user trigger may have created a row already.
    // Try update first; upsert if no row exists yet.
    const { data: updatedRows, error: updateErr } = await admin
      .from('user_profiles')
      .update({
        role:       'branch',
        tenant_id,
        branch_id,
        full_name:  full_name?.trim() ?? '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', newUserId)
      .select('id')

    console.log('[create-branch-user] Profile update result: rows=', updatedRows?.length ?? 0, '| error=', updateErr?.message ?? 'none')

    if (!updatedRows?.length) {
      // Trigger hasn't run yet — upsert the row directly.
      console.log('[create-branch-user] No row from trigger, upserting profile...')
      const { error: upsertErr } = await admin
        .from('user_profiles')
        .upsert({
          id:         newUserId,
          role:       'branch',
          tenant_id,
          branch_id,
          full_name:  full_name?.trim() ?? '',
          email:      normalizedEmail,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })

      if (upsertErr) {
        console.error('[create-branch-user] Profile upsert failed:', upsertErr.message)
        // Auth user exists but profile is incomplete — still return user_id
        // so the caller knows the auth account was created.
        return new Response(
          JSON.stringify({ user_id: newUserId, warning: 'Profile update failed: ' + upsertErr.message }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      console.log('[create-branch-user] Profile upserted successfully')
    }

    console.log('[create-branch-user] Done. user_id:', newUserId)
    return new Response(JSON.stringify({ user_id: newUserId }), {
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
