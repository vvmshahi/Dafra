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

    // ── Step 1: Collect ALL auth user IDs before any deletes ────────────────
    const [{ data: ownerProfile }, { data: branchProfiles }] = await Promise.all([
      adminClient
        .from('user_profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .maybeSingle(),
      adminClient
        .from('user_profiles')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('role', 'branch'),
    ])

    const allAuthIds: string[] = [
      ownerProfile?.id,
      ...((branchProfiles ?? []).map((p: { id: string }) => p.id)),
    ].filter((id): id is string => !!id)

    console.log('[delete-tenant] Auth user IDs to delete:', allAuthIds.length, allAuthIds)

    // ── Step 2: Collect IDs needed for child-table deletes ───────────────────

    // Branch IDs (for tables with only branch_id, not tenant_id)
    const { data: branchRows } = await adminClient
      .from('branches')
      .select('id')
      .eq('tenant_id', tenantId)
    const branchIds = (branchRows ?? []).map((r: { id: string }) => r.id)
    console.log('[delete-tenant] Branch count:', branchIds.length)

    // Invoice IDs (for invoice_items and payments)
    const { data: invoiceRows } = await adminClient
      .from('invoices')
      .select('id')
      .eq('tenant_id', tenantId)
    const invoiceIds = (invoiceRows ?? []).map((r: { id: string }) => r.id)
    console.log('[delete-tenant] Invoice count:', invoiceIds.length)

    // Purchase IDs (for purchase_items)
    const { data: purchaseRows } = await adminClient
      .from('purchases')
      .select('id')
      .eq('tenant_id', tenantId)
    const purchaseIds = (purchaseRows ?? []).map((r: { id: string }) => r.id)
    console.log('[delete-tenant] Purchase count:', purchaseIds.length)

    // ── Step 3: Delete in dependency order ───────────────────────────────────

    // 1. Nullify session_id FK on invoices (breaks pos_session FK before deleting sessions)
    if (invoiceIds.length > 0) {
      await adminClient.from('invoices').update({ session_id: null }).in('id', invoiceIds)
    }
    console.log('[delete-tenant] Cleared session_id on invoices')

    // 2. Nullify session_id FK on expenses
    await adminClient.from('expenses').update({ session_id: null }).eq('tenant_id', tenantId)
    console.log('[delete-tenant] Cleared session_id on expenses')

    // 3. Delete sync_queue
    await adminClient.from('sync_queue').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted sync_queue')

    // 4. Delete POS sessions
    await adminClient.from('pos_sessions').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted pos_sessions')

    // 5. Delete day closings
    await adminClient.from('day_closings').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted day_closings')

    // 6. Delete ZATCA certificates (branch_id scoped — no tenant_id column)
    if (branchIds.length > 0) {
      await adminClient.from('zatca_certificates').delete().in('branch_id', branchIds)
    }
    console.log('[delete-tenant] Deleted zatca_certificates')

    // 7. Delete purchase_items (must precede purchases)
    if (purchaseIds.length > 0) {
      await adminClient.from('purchase_items').delete().in('purchase_id', purchaseIds)
    }
    console.log('[delete-tenant] Deleted purchase_items')

    // 8. Delete purchases
    await adminClient.from('purchases').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted purchases')

    // 9. Delete inventory items (branch_id scoped)
    if (branchIds.length > 0) {
      await adminClient.from('inventory_items').delete().in('branch_id', branchIds)
    }
    console.log('[delete-tenant] Deleted inventory_items')

    // 10. Delete invoice items
    if (invoiceIds.length > 0) {
      await adminClient.from('invoice_items').delete().in('invoice_id', invoiceIds)
    }
    console.log('[delete-tenant] Deleted invoice_items')

    // 11. Delete payments
    if (invoiceIds.length > 0) {
      await adminClient.from('payments').delete().in('invoice_id', invoiceIds)
    }
    console.log('[delete-tenant] Deleted payments')

    // 12. Delete invoices
    await adminClient.from('invoices').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted invoices')

    // 13. Delete expenses
    await adminClient.from('expenses').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted expenses')

    // 14. Delete fixed expenses
    await adminClient.from('fixed_expenses').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted fixed_expenses')

    // 15. Delete employees
    await adminClient.from('employees').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted employees')

    // 16. Delete products
    await adminClient.from('products').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted products')

    // 17. Delete categories
    await adminClient.from('categories').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted categories')

    // 18. Delete customers
    await adminClient.from('customers').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted customers')

    // 19. Delete suppliers
    await adminClient.from('suppliers').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted suppliers')

    // 20. Delete branches
    await adminClient.from('branches').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted branches')

    // 21. Delete tenant subscriptions
    await adminClient.from('tenant_subscriptions').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted tenant_subscriptions')

    // 22. Delete user profiles (BEFORE tenants to avoid FK violation)
    await adminClient.from('user_profiles').delete().eq('tenant_id', tenantId)
    console.log('[delete-tenant] Deleted user_profiles')

    // 23. Delete tenant record
    await adminClient.from('tenants').delete().eq('id', tenantId)
    console.log('[delete-tenant] Deleted tenant')

    // 24. Delete ALL auth users (owner + all branch users)
    const authErrors: string[] = []
    for (const authId of allAuthIds) {
      const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(authId)
      if (deleteAuthErr) {
        console.error('[delete-tenant] Auth user deletion failed:', authId, deleteAuthErr.message)
        authErrors.push(`${authId}: ${deleteAuthErr.message}`)
      } else {
        console.log('[delete-tenant] Deleted auth user:', authId)
      }
    }

    if (authErrors.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Tenant data deleted but some auth users could not be removed: ' + authErrors.join('; ') }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
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
