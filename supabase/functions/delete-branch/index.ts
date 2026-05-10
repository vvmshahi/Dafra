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
    const { branchId } = await req.json()

    if (!branchId) {
      return new Response(JSON.stringify({ error: 'Missing required field: branchId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Verify branch belongs to caller's tenant ──────────────────────────────
    const { data: branchRow } = await adminClient
      .from('branches')
      .select('id, tenant_id, name')
      .eq('id', branchId)
      .maybeSingle()

    if (!branchRow || branchRow.tenant_id !== callerProfile.tenant_id) {
      return new Response(JSON.stringify({ error: 'Branch not found or access denied' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('[delete-branch] Starting deletion for branch:', branchId, branchRow.name)

    // ── Step 1: Find branch user profile ID (for auth deletion) ──────────────
    const { data: branchUser } = await adminClient
      .from('user_profiles')
      .select('id')
      .eq('branch_id', branchId)
      .eq('role', 'branch')
      .maybeSingle()

    const branchUserId = branchUser?.id ?? null
    console.log('[delete-branch] Branch auth user ID:', branchUserId)

    // ── Step 2: Collect invoice IDs for cascading deletes ────────────────────
    const { data: invoiceRows } = await adminClient
      .from('invoices')
      .select('id')
      .eq('branch_id', branchId)

    const invoiceIds = (invoiceRows ?? []).map((r: { id: string }) => r.id)
    console.log('[delete-branch] Invoice count:', invoiceIds.length)

    // ── Step 3: Delete in dependency order ───────────────────────────────────

    // a. Nullify session_id FK on invoices (breaks pos_session FK)
    if (invoiceIds.length > 0) {
      await adminClient.from('invoices').update({ session_id: null }).in('id', invoiceIds)
    }

    // b. Nullify session_id FK on expenses
    await adminClient.from('expenses').update({ session_id: null }).eq('branch_id', branchId)

    // c. Delete POS sessions
    await adminClient.from('pos_sessions').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted pos_sessions')

    // d. Delete day closings
    await adminClient.from('day_closings').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted day_closings')

    // e. Delete ZATCA certificates
    await adminClient.from('zatca_certificates').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted zatca_certificates')

    // f. Delete invoice items
    if (invoiceIds.length > 0) {
      await adminClient.from('invoice_items').delete().in('invoice_id', invoiceIds)
    }

    // g. Delete payments
    if (invoiceIds.length > 0) {
      await adminClient.from('payments').delete().in('invoice_id', invoiceIds)
    }

    // h. Delete invoices
    await adminClient.from('invoices').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted invoices')

    // i. Delete expenses
    await adminClient.from('expenses').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted expenses')

    // j. Delete inventory items
    await adminClient.from('inventory_items').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted inventory_items')

    // k. Delete employees linked to this branch
    await adminClient.from('employees').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted employees')

    // l. Delete user profiles for this branch
    await adminClient.from('user_profiles').delete().eq('branch_id', branchId)
    console.log('[delete-branch] Deleted user_profiles')

    // m. Delete the branch itself
    await adminClient.from('branches').delete().eq('id', branchId)
    console.log('[delete-branch] Deleted branch')

    // n. Delete auth user for the branch
    if (branchUserId) {
      const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(branchUserId)
      if (deleteAuthErr) {
        console.error('[delete-branch] Auth user deletion failed:', deleteAuthErr.message)
        return new Response(
          JSON.stringify({ error: 'Branch data deleted but auth user removal failed: ' + deleteAuthErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      console.log('[delete-branch] Deleted auth user:', branchUserId)
    }

    console.log('[delete-branch] Deletion complete for branch:', branchId)
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[delete-branch] Unhandled error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
