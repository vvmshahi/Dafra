import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
      .select('role, tenant_id')
      .eq('id', caller.id)
      .maybeSingle()

    if (profileErr || !callerProfile || callerProfile.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Forbidden: owner role required' }), {
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

    // ── Find branch user ──────────────────────────────────────────────────────
    const { data: branchUser } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('branch_id', branch_id)
      .eq('role', 'branch')
      .maybeSingle()

    if (!branchUser) {
      return new Response(JSON.stringify({ error: 'No branch user found for this branch' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Update password ───────────────────────────────────────────────────────
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(branchUser.id, {
      password: new_password,
    })

    if (updateErr) {
      console.error('[reset-branch-password] updateUserById failed:', updateErr.message)
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('[reset-branch-password] Password reset for branch:', branch_id, 'user:', branchUser.id)
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[reset-branch-password] Unhandled error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
