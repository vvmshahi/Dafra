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
    // Service-role client — can bypass RLS and call admin API
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Verify the calling user is an authenticated owner
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(jwt)
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify caller is an owner
    const { data: callerProfile } = await admin
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', caller.id)
      .single()

    if (!callerProfile || callerProfile.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Forbidden: owner role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, password, full_name, tenant_id, branch_id } = await req.json()

    // Ensure the branch belongs to the caller's tenant
    if (tenant_id !== callerProfile.tenant_id) {
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

    // Create auth user — email_confirm: true skips the confirmation email
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
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
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = created.user.id

    // The handle_new_user trigger should have created the user_profiles row.
    // Try update first; fall back to upsert in case the trigger hasn't fired yet.
    const { data: updatedRows } = await admin
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

    if (!updatedRows?.length) {
      // Trigger hasn't created the row yet — upsert it directly.
      const { error: upsertErr } = await admin
        .from('user_profiles')
        .upsert({
          id:         newUserId,
          role:       'branch',
          tenant_id,
          branch_id,
          full_name:  full_name?.trim() ?? '',
          email:      email.trim().toLowerCase(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
      if (upsertErr) {
        console.error('[create-branch-user] Profile upsert failed:', upsertErr.message)
      }
    }

    return new Response(JSON.stringify({ user_id: newUserId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
