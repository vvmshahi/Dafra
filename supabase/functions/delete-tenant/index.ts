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
    const { tenantId } = await req.json()

    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'Missing required field: tenantId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('[delete-tenant] Starting deletion for tenant:', tenantId)

    // ── Step 1: Find owner auth user ID ──────────────────────────────────────
    const { data: ownerProfile } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
      .maybeSingle()

    const authUserId = ownerProfile?.id ?? null
    console.log('[delete-tenant] Owner auth user ID:', authUserId)

    // ── Step 2: Collect invoice IDs for cascading deletes ────────────────────
    const { data: invoiceRows } = await adminClient
      .from('invoices')
      .select('id')
      .eq('tenant_id', tenantId)

    const invoiceIds = (invoiceRows ?? []).map((r: { id: string }) => r.id)

    // ── Step 3: Delete in dependency order ───────────────────────────────────

    // a. Nullify session_id FK on invoices
    if (invoiceIds.length > 0) {
      await adminClient
        .from('invoices')
        .update({ session_id: null })
        .in('id', invoiceIds)
      console.log('[delete-tenant] Cleared session_id on invoices')
    }

    // b. Nullify session_id FK on expenses
    await adminClient
      .from('expenses')
      .update({ session_id: null })
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Cleared session_id on expenses')

    // c. Delete POS sessions
    await adminClient
      .from('pos_sessions')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted pos_sessions')

    // d. Delete day closings
    await adminClient
      .from('day_closings')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted day_closings')

    // e. Delete invoice items
    if (invoiceIds.length > 0) {
      await adminClient
        .from('invoice_items')
        .delete()
        .in('invoice_id', invoiceIds)
      console.log('[delete-tenant] Deleted invoice_items')
    }

    // f. Delete payments
    if (invoiceIds.length > 0) {
      await adminClient
        .from('payments')
        .delete()
        .in('invoice_id', invoiceIds)
      console.log('[delete-tenant] Deleted payments')
    }

    // g. Delete invoices
    await adminClient
      .from('invoices')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted invoices')

    // h. Delete expenses
    await adminClient
      .from('expenses')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted expenses')

    // i. Delete products
    await adminClient
      .from('products')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted products')

    // j. Delete categories
    await adminClient
      .from('categories')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted categories')

    // k. Delete customers
    await adminClient
      .from('customers')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted customers')

    // l. Delete branches
    await adminClient
      .from('branches')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted branches')

    // m. Delete tenant subscriptions
    await adminClient
      .from('tenant_subscriptions')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted tenant_subscriptions')

    // n. Delete tenant
    await adminClient
      .from('tenants')
      .delete()
      .eq('id', tenantId)
    console.log('[delete-tenant] Deleted tenant')

    // o. Delete user profiles
    await adminClient
      .from('user_profiles')
      .delete()
      .eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted user_profiles')

    // p. Delete auth user
    if (authUserId) {
      const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(authUserId)
      if (deleteAuthErr) {
        console.error('[delete-tenant] Auth user deletion failed:', deleteAuthErr.message)
        return new Response(
          JSON.stringify({ error: 'Tenant data deleted but auth user removal failed: ' + deleteAuthErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      console.log('[delete-tenant] Deleted auth user:', authUserId)
    }

    console.log('[delete-tenant] Deletion complete for tenant:', tenantId)

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[delete-tenant] Unhandled error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
