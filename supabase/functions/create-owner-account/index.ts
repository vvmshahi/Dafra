import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
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

    // ── Verify caller is super_admin ─────────────────────────────────────────
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
      .select('role')
      .eq('id', caller.id)
      .maybeSingle()

    if (profileErr || !callerProfile) {
      return new Response(JSON.stringify({ error: 'Could not verify caller' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (callerProfile.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: super_admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = await req.json()
    const {
      company_name, company_name_ar, vat_number, cr_number,
      email, phone, city,
      plan_id, duration_months, ends_at, branch_count,
      pay_method, pay_ref, notes,
    } = body

    if (!company_name || !vat_number || !email || !plan_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: company_name, vat_number, email, plan_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const normalizedEmail = email.trim().toLowerCase()

    // ── Step 1: Create auth user (no password — email invite handles setup) ──
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email:         normalizedEmail,
      email_confirm: true,
      user_metadata: { full_name: company_name.trim(), role: 'owner' },
    })

    if (createErr) {
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = created.user.id
    console.log('[create-owner-account] Auth user created:', newUserId)

    // ── Step 2: Create tenant ────────────────────────────────────────────────
    const { data: tenantRow, error: tenantErr } = await adminClient
      .from('tenants')
      .insert({
        name:         company_name.trim(),
        name_ar:      company_name_ar?.trim() || null,
        vat_number:   vat_number.trim(),
        cr_number:    cr_number?.trim() || null,
        email:        normalizedEmail,
        phone:        phone?.trim() || null,
        city:         city?.trim() || null,
        country:      'SA',
        is_active:    true,
        address:      notes?.trim() || null,
        max_branches: branch_count ?? 999,
      })
      .select('id')
      .single()

    if (tenantErr || !tenantRow) {
      await adminClient.auth.admin.deleteUser(newUserId)
      return new Response(
        JSON.stringify({ error: 'Failed to create tenant: ' + (tenantErr?.message ?? 'unknown') }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const tenantId = tenantRow.id
    console.log('[create-owner-account] Tenant created:', tenantId)

    // Link the auto-created user_profiles row to this tenant immediately
    await adminClient
      .from('user_profiles')
      .update({ tenant_id: tenantId })
      .eq('id', newUserId)

    // ── Step 3: Create main branch ───────────────────────────────────────────
    const { data: branchRow, error: branchErr } = await adminClient
      .from('branches')
      .insert({
        tenant_id:       tenantId,
        name:            company_name.trim(),
        name_ar:         company_name_ar?.trim() || null,
        city:            city?.trim() || null,
        is_main_branch:  true,
        is_active:       true,
        invoice_counter: 0,
      })
      .select('id')
      .single()

    if (branchErr || !branchRow) {
      await adminClient.from('tenants').delete().eq('id', tenantId)
      await adminClient.auth.admin.deleteUser(newUserId)
      return new Response(
        JSON.stringify({ error: 'Failed to create branch: ' + (branchErr?.message ?? 'unknown') }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const branchId = branchRow.id
    console.log('[create-owner-account] Branch created:', branchId)

    // ── Step 4: Upsert user profile ──────────────────────────────────────────
    const { error: profileUpsertErr } = await adminClient
      .from('user_profiles')
      .upsert({
        id:         newUserId,
        role:       'owner',
        tenant_id:  tenantId,
        branch_id:  branchId,
        full_name:  company_name.trim(),
        email:      normalizedEmail,
        is_active:  true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    if (profileUpsertErr) {
      console.error('[create-owner-account] Profile upsert failed:', profileUpsertErr.message)
    }

    // ── Step 5: Create subscription ──────────────────────────────────────────
    const isLifetime    = duration_months === 0
    const paymentNote   = [pay_method, pay_ref].filter(Boolean).join(' · ') || null

    const { error: subErr } = await adminClient
      .from('tenant_subscriptions')
      .insert({
        tenant_id:               tenantId,
        plan_id,
        status:                  'active',
        starts_at:               new Date().toISOString(),
        ends_at:                 isLifetime ? null : (ends_at ?? null),
        trial_ends_at:           null,
        cancelled_at:            null,
        moyasar_subscription_id: isLifetime ? 'Lifetime Free' : paymentNote,
      })

    if (subErr) {
      console.error('[create-owner-account] Subscription insert failed:', subErr.message)
    }

    // ── Step 6: Send password setup email ────────────────────────────────────
    let emailWarning: string | null = null

    const { error: linkErr } = await adminClient.auth.admin.generateLink({
      type:  'recovery',
      email: normalizedEmail,
    })

    if (linkErr) {
      console.error('[create-owner-account] Password setup email failed:', linkErr.message)
      emailWarning = `Account created but password setup email failed: ${linkErr.message}. Send a manual password reset from the Supabase dashboard.`
    } else {
      console.log('[create-owner-account] Password setup email sent to:', normalizedEmail)
    }

    const response: Record<string, unknown> = {
      user_id:   newUserId,
      tenant_id: tenantId,
      branch_id: branchId,
      email:     normalizedEmail,
    }
    if (emailWarning) response.warning = emailWarning

    return new Response(JSON.stringify(response), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[create-owner-account] Unhandled error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
