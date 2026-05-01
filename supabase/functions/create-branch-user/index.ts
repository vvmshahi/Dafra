import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function decodeJWTPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded  = base64 + '='.repeat((4 - base64.length % 4) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Step 1: Read DAFRA_SERVICE_ROLE_KEY (manually-set secret) ─────────
    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('DAFRA_SERVICE_ROLE_KEY')

    console.log('[create-branch-user] SUPABASE_URL present:', !!supabaseUrl)
    console.log('[create-branch-user] DAFRA_SERVICE_ROLE_KEY present:', !!SERVICE_ROLE_KEY)
    console.log('[create-branch-user] key prefix:', SERVICE_ROLE_KEY?.substring(0, 15) ?? 'MISSING')
    console.log('[create-branch-user] key is JWT (eyJ):', SERVICE_ROLE_KEY?.startsWith('eyJ') ?? false)

    if (!SERVICE_ROLE_KEY || !SERVICE_ROLE_KEY.startsWith('eyJ')) {
      console.error('[create-branch-user] Invalid service role key:', SERVICE_ROLE_KEY?.substring(0, 20) ?? 'MISSING')
      return new Response(JSON.stringify({ error: 'Server configuration error - invalid key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(supabaseUrl, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Step 2: Extract and decode the caller's JWT ───────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerJWT  = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!callerJWT) {
      console.error('[create-branch-user] Missing Authorization header')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const jwtPayload = decodeJWTPayload(callerJWT)
    if (!jwtPayload) {
      console.error('[create-branch-user] Could not decode JWT')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const now = Math.floor(Date.now() / 1000)
    if (typeof jwtPayload.exp === 'number' && jwtPayload.exp < now) {
      console.error('[create-branch-user] JWT expired')
      return new Response(JSON.stringify({ error: 'Unauthorized: token expired' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const callerId = jwtPayload.sub as string | undefined
    if (!callerId) {
      console.error('[create-branch-user] JWT has no sub claim')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.log('[create-branch-user] Caller user_id:', callerId)

    // ── Step 3: Verify caller role via adminClient (bypasses RLS) ─────────
    const { data: callerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', callerId)
      .single()

    console.log('[create-branch-user] Caller profile:', JSON.stringify(callerProfile), '| error:', profileErr?.message ?? 'none')

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
    const { email, password, full_name, tenant_id, branch_id } = await req.json()

    console.log('[create-branch-user] Request: email=', email, '| tenant_id=', tenant_id, '| branch_id=', branch_id)

    if (!email || !password || !tenant_id || !branch_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email, password, tenant_id, branch_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (tenant_id !== callerProfile.tenant_id) {
      console.error('[create-branch-user] Tenant mismatch — body:', tenant_id, 'caller:', callerProfile.tenant_id)
      return new Response(JSON.stringify({ error: 'Forbidden: tenant mismatch' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step 5: Create the auth user via admin API ────────────────────────
    const normalizedEmail = email.trim().toLowerCase()
    console.log('[create-branch-user] Creating auth user:', normalizedEmail)

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
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

    // ── Step 6: Set the user_profiles row ────────────────────────────────
    const { data: updatedRows, error: updateErr } = await adminClient
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
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })

      if (upsertErr) {
        console.error('[create-branch-user] Profile upsert failed:', upsertErr.message)
        return new Response(
          JSON.stringify({ user_id: newUserId, warning: 'Profile setup failed: ' + upsertErr.message }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      console.log('[create-branch-user] Profile upserted successfully')
    }

    console.log('[create-branch-user] Success — user_id:', newUserId)
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
