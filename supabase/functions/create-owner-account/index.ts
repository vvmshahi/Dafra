import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'

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
    console.log('[create-owner-account] Request received:', req.method)

    const supabaseUrl      = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = Deno.env.get('DAFRA_SERVICE_ROLE_KEY')

    console.log('[create-owner-account] SUPABASE_URL present:', !!supabaseUrl)
    console.log('[create-owner-account] DAFRA_SERVICE_ROLE_KEY present:', !!SERVICE_ROLE_KEY, 'starts with eyJ:', SERVICE_ROLE_KEY?.startsWith('eyJ'))

    if (!SERVICE_ROLE_KEY || !SERVICE_ROLE_KEY.startsWith('eyJ')) {
      console.error('[create-owner-account] FATAL: DAFRA_SERVICE_ROLE_KEY missing or malformed')
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

    console.log('[create-owner-account] Auth header present:', !!callerJWT)

    if (!callerJWT) {
      console.error('[create-owner-account] No Authorization header')
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(callerJWT)
    console.log('[create-owner-account] Caller lookup:', caller?.id ?? 'null', 'authError:', authError?.message ?? 'none')

    if (authError || !caller) {
      console.error('[create-owner-account] Invalid token:', authError?.message)
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle()

    console.log('[create-owner-account] Caller role:', callerProfile?.role ?? 'null', 'profileErr:', profileErr?.message ?? 'none')

    if (profileErr || !callerProfile) {
      console.error('[create-owner-account] Could not load caller profile:', profileErr?.message)
      return new Response(JSON.stringify({ error: 'Could not verify caller' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (callerProfile.role !== 'super_admin') {
      console.error('[create-owner-account] Caller is not super_admin, role:', callerProfile.role)
      return new Response(JSON.stringify({ error: 'Forbidden: super_admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = await req.json()
    const {
      company_name, company_name_ar, vat_number, cr_number,
      email, phone, city, business_type,
      plan_id, payment_type, duration_months, ends_at, branch_count,
      pay_method, pay_ref, notes,
    } = body
    const normalizedBusinessType = business_type === 'service' ? 'service' : 'trading'

    console.log('[create-owner-account] Body parsed:', {
      hasCompanyName: !!company_name,
      hasEmail: !!email,
      hasPlanId: !!plan_id,
      payment_type,
      business_type: normalizedBusinessType,
    })

    if (!company_name || !email || !plan_id) {
      console.error('[create-owner-account] Missing required fields')
      return new Response(
        JSON.stringify({ error: 'Missing required fields: company_name, email, plan_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const normalizedEmail = email.trim().toLowerCase()
    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId: null,
      branchId: null,
      actorUserId: caller.id,
      actorRole: 'super_admin',
      targetType: 'tenant',
      targetId: null,
      ipHash,
      requestId: reqId,
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'owner_account_create_attempted',
      severity: 'warning',
      status: 'attempted',
      metadata: { paymentType: payment_type ?? null, businessType: normalizedBusinessType },
    })

    const rate = await enforceRateLimit(adminClient as any, {
      ...auditBase,
      action: 'create_owner_account',
      scope: 'actor',
      scopeId: caller.id,
      maxAttempts: 20,
      windowSeconds: 86400,
      metadata: { paymentType: payment_type ?? null, businessType: normalizedBusinessType },
    })

    if (!rate.allowed) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_account_create_rate_limited',
        severity: 'warning',
        status: 'blocked',
        metadata: { retryAfterSeconds: rate.retryAfterSeconds },
      })
      return new Response(JSON.stringify(rateLimitBody(rate)), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Step 1: Create auth user ─────────────────────────────────────────────
    console.log('[create-owner-account] Step 1: Creating auth user')
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email:         normalizedEmail,
      email_confirm: true,
      user_metadata: { full_name: company_name.trim(), role: 'owner' },
    })

    if (createErr) {
      console.error('[create-owner-account] Step 1 FAILED — auth user creation:', createErr.message)
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_account_create_failed',
        severity: 'warning',
        status: 'failed',
        metadata: { stage: 'auth_create' },
      })
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = created.user.id
    console.log('[create-owner-account] Step 1 OK — auth user:', newUserId)

    // ── Step 2: Create tenant ────────────────────────────────────────────────
    console.log('[create-owner-account] Step 2: Creating tenant')
    const { data: tenantRow, error: tenantErr } = await adminClient
      .from('tenants')
      .insert({
        name:         company_name.trim(),
        name_ar:      company_name_ar?.trim() || null,
        vat_number:   vat_number?.trim() || null,
        cr_number:    cr_number?.trim() || null,
        email:        normalizedEmail,
        phone:        phone?.trim() || null,
        city:         city?.trim() || null,
        business_type: normalizedBusinessType,
        country:      'SA',
        is_active:    true,
        address:      notes?.trim() || null,
        max_branches: branch_count ?? 999,
      })
      .select('id')
      .single()

    if (tenantErr || !tenantRow) {
      console.error('[create-owner-account] Step 2 FAILED — tenant insert:', tenantErr?.message, tenantErr?.code, tenantErr?.details)
      await adminClient.auth.admin.deleteUser(newUserId)
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'owner_account_create_failed',
        severity: 'warning',
        status: 'failed',
        targetType: 'user_profile',
        targetId: newUserId,
        metadata: { stage: 'tenant_insert' },
      })
      return new Response(
        JSON.stringify({ error: 'Failed to create tenant: ' + (tenantErr?.message ?? 'unknown') }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const tenantId = tenantRow.id
    console.log('[create-owner-account] Step 2 OK — tenant:', tenantId)

    // ── Step 3: Link user profile to tenant immediately ──────────────────────
    console.log('[create-owner-account] Step 3: Linking user_profile to tenant')
    const { error: linkErr2 } = await adminClient
      .from('user_profiles')
      .update({ tenant_id: tenantId })
      .eq('id', newUserId)

    if (linkErr2) {
      console.error('[create-owner-account] Step 3 WARNING — profile link failed:', linkErr2.message)
    } else {
      console.log('[create-owner-account] Step 3 OK — profile linked')
    }

    // ── Step 4: Upsert user profile ──────────────────────────────────────────
    console.log('[create-owner-account] Step 4: Upserting user profile')
    const { error: profileUpsertErr } = await adminClient
      .from('user_profiles')
      .upsert({
        id:         newUserId,
        role:       'owner',
        tenant_id:  tenantId,
        full_name:  company_name.trim(),
        email:      normalizedEmail,
        is_active:  true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    if (profileUpsertErr) {
      console.error('[create-owner-account] Step 4 WARNING — profile upsert failed:', profileUpsertErr.message)
    } else {
      console.log('[create-owner-account] Step 4 OK — profile upserted')
    }

    // ── Step 5: Create subscription ──────────────────────────────────────────
    // NOTE: DB enum subscription_status only allows: trial, active, expired, cancelled
    // Lifetime free accounts use status='active' + ends_at=null (identified client-side)
    const isLifetime  = payment_type === 'lifetime_free' || duration_months === 0
    const paymentNote = [pay_method, pay_ref].filter(Boolean).join(' · ') || null

    console.log('[create-owner-account] Step 5: Creating subscription — isLifetime:', isLifetime, 'plan_id:', plan_id)
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
      console.error('[create-owner-account] Step 5 WARNING — subscription insert failed:', subErr.message, subErr.code, subErr.details)
    } else {
      console.log('[create-owner-account] Step 5 OK — subscription created')
    }

    // ── Step 6: Send setup email ────────────────────────────────────────────
    console.log('[create-owner-account] Step 6: Sending setup email')
    let emailWarning: string | null = null

    const { error: linkErr } = await adminClient.auth.admin.generateLink({
      type:  'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: 'https://dafra.vercel.app/reset-password',
      },
    })

    if (linkErr) {
      console.error('[create-owner-account] Step 6 WARNING — generateLink failed:', linkErr.message)
      emailWarning = `Account created but password setup email failed: ${linkErr.message}. Send a manual password reset from the Supabase dashboard.`
    } else {
      console.log('[create-owner-account] Step 6 OK — setup email sent')
    }

    const response: Record<string, unknown> = {
      user_id:   newUserId,
      tenant_id: tenantId,
      email:     normalizedEmail,
    }
    if (emailWarning) response.warning = emailWarning

    await auditEvent(adminClient as any, {
      ...auditBase,
      tenantId,
      action: 'owner_account_created',
      severity: 'warning',
      status: 'succeeded',
      targetType: 'tenant',
      targetId: tenantId,
      metadata: {
        userId: newUserId,
        emailLinkSent: !emailWarning,
        paymentType: payment_type ?? null,
        businessType: normalizedBusinessType,
      },
    })

    console.log('[create-owner-account] SUCCESS — returning 200')
    return new Response(JSON.stringify(response), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    const stack   = err instanceof Error ? err.stack   : undefined
    console.error('[create-owner-account] UNHANDLED ERROR:', message)
    console.error('[create-owner-account] Stack:', stack)
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
