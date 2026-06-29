import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface CallerProfile {
  role: string
  tenant_id: string | null
}

interface TenantRow {
  id: string
  name: string
}

interface TenantDeletionPlan {
  authUserIds: string[]
  branchIds: string[]
  invoiceIds: string[]
  purchaseIds: string[]
  productionConnectedCredentialCount: number
  counts: Record<string, number>
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function serviceRoleKey(): string | null {
  return Deno.env.get('DAFRA_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

function bearerToken(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
}

function isAuthorizedForTenantDelete(caller: CallerProfile, tenantId: string): boolean {
  if (caller.role === 'super_admin') return true
  return caller.role === 'owner' && caller.tenant_id === tenantId
}

async function countQuery(query: any, label: string): Promise<number> {
  const { count, error } = await query
  if (error) throw new Error(`Unable to count ${label}`)
  return count ?? 0
}

function countRows(adminClient: any, table: string, label: string, applyFilters: (query: any) => any): Promise<number> {
  return countQuery(applyFilters(adminClient.from(table).select('id', { count: 'exact', head: true })), label)
}

async function collectTenantDeletionPlan(adminClient: any, tenant: TenantRow): Promise<TenantDeletionPlan> {
  const { data: profileRows, error: profileErr } = await adminClient
    .from('user_profiles')
    .select('id')
    .eq('tenant_id', tenant.id)

  if (profileErr) throw new Error('Unable to inspect tenant users')
  const authUserIds = (profileRows ?? []).map((row: { id: string }) => row.id)

  const { data: branchRows, error: branchErr } = await adminClient
    .from('branches')
    .select('id')
    .eq('tenant_id', tenant.id)

  if (branchErr) throw new Error('Unable to inspect branches')
  const branchIds = (branchRows ?? []).map((row: { id: string }) => row.id)

  const { data: invoiceRows, error: invoiceErr } = await adminClient
    .from('invoices')
    .select('id')
    .eq('tenant_id', tenant.id)

  if (invoiceErr) throw new Error('Unable to inspect invoices')
  const invoiceIds = (invoiceRows ?? []).map((row: { id: string }) => row.id)

  const { data: purchaseRows, error: purchaseErr } = await adminClient
    .from('purchases')
    .select('id')
    .eq('tenant_id', tenant.id)

  if (purchaseErr) throw new Error('Unable to inspect purchases')
  const purchaseIds = (purchaseRows ?? []).map((row: { id: string }) => row.id)

  const productionConnectedCredentialCount = await countRows(
    adminClient,
    'zatca_production_credentials',
    'production ZATCA credentials',
    query => query
      .eq('tenant_id', tenant.id)
      .eq('environment', 'production')
      .eq('onboarding_status', 'production_connected'),
  )

  const counts: Record<string, number> = {
    tenants: 1,
    auth_users: authUserIds.length,
    branches: await countRows(adminClient, 'branches', 'branches', query => query.eq('tenant_id', tenant.id)),
    user_profiles: await countRows(adminClient, 'user_profiles', 'user profiles', query => query.eq('tenant_id', tenant.id)),
    zatca_production_credentials_connected: productionConnectedCredentialCount,
    zatca_production_credentials_total: await countRows(adminClient, 'zatca_production_credentials', 'production ZATCA credential rows', query => query.eq('tenant_id', tenant.id)),
    sync_queue: await countRows(adminClient, 'sync_queue', 'sync queue rows', query => query.eq('tenant_id', tenant.id)),
    pos_sessions: await countRows(adminClient, 'pos_sessions', 'POS sessions', query => query.eq('tenant_id', tenant.id)),
    day_closings: await countRows(adminClient, 'day_closings', 'day closings', query => query.eq('tenant_id', tenant.id)),
    zatca_certificates: await countRows(adminClient, 'zatca_certificates', 'ZATCA certificates', query => query.eq('tenant_id', tenant.id)),
    purchases: await countRows(adminClient, 'purchases', 'purchases', query => query.eq('tenant_id', tenant.id)),
    purchase_items: purchaseIds.length > 0
      ? await countRows(adminClient, 'purchase_items', 'purchase items', query => query.in('purchase_id', purchaseIds))
      : 0,
    inventory_items: branchIds.length > 0
      ? await countRows(adminClient, 'inventory_items', 'inventory items', query => query.eq('tenant_id', tenant.id).in('branch_id', branchIds))
      : 0,
    invoice_items: invoiceIds.length > 0
      ? await countRows(adminClient, 'invoice_items', 'invoice items', query => query.in('invoice_id', invoiceIds))
      : 0,
    payments: invoiceIds.length > 0
      ? await countRows(adminClient, 'payments', 'payments', query => query.in('invoice_id', invoiceIds))
      : 0,
    invoices: await countRows(adminClient, 'invoices', 'invoices', query => query.eq('tenant_id', tenant.id)),
    expenses: await countRows(adminClient, 'expenses', 'expenses', query => query.eq('tenant_id', tenant.id)),
    fixed_expenses: await countRows(adminClient, 'fixed_expenses', 'fixed expenses', query => query.eq('tenant_id', tenant.id)),
    employees: await countRows(adminClient, 'employees', 'employees', query => query.eq('tenant_id', tenant.id)),
    products: await countRows(adminClient, 'products', 'products', query => query.eq('tenant_id', tenant.id)),
    categories: await countRows(adminClient, 'categories', 'categories', query => query.eq('tenant_id', tenant.id)),
    customers: await countRows(adminClient, 'customers', 'customers', query => query.eq('tenant_id', tenant.id)),
    suppliers: await countRows(adminClient, 'suppliers', 'suppliers', query => query.eq('tenant_id', tenant.id)),
    tenant_subscriptions: await countRows(adminClient, 'tenant_subscriptions', 'tenant subscriptions', query => query.eq('tenant_id', tenant.id)),
  }

  return {
    authUserIds,
    branchIds,
    invoiceIds,
    purchaseIds,
    productionConnectedCredentialCount,
    counts,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const SERVICE_ROLE_KEY = serviceRoleKey()

    if (!SERVICE_ROLE_KEY || !SERVICE_ROLE_KEY.startsWith('eyJ')) {
      return jsonResponse({ error: 'Server configuration error' }, 500)
    }

    const adminClient = createClient(supabaseUrl, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const callerJWT = bearerToken(req)
    if (!callerJWT) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(callerJWT)
    if (authError || !caller) {
      return jsonResponse({ error: 'Invalid token' }, 401)
    }

    const { data: callerProfile, error: profileErr } = await adminClient
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', caller.id)
      .maybeSingle()

    if (profileErr || !callerProfile) {
      return jsonResponse({ error: 'Could not verify caller' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId.trim() : ''
    const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim() : ''
    const dryRun = body?.dryRun === true

    if (!tenantId) {
      return jsonResponse({ error: 'Missing required field: tenantId' }, 400)
    }

    const { data: tenantRow, error: tenantErr } = await adminClient
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .maybeSingle()

    if (tenantErr) {
      return jsonResponse({ error: 'Unable to verify tenant access' }, 500)
    }

    if (!tenantRow) {
      return jsonResponse({ error: 'Tenant not found or access denied' }, 404)
    }

    const tenant = tenantRow as TenantRow
    const allowed = isAuthorizedForTenantDelete(callerProfile as CallerProfile, tenant.id)
    console.info('[delete-tenant] audit:', {
      action: 'delete_tenant_authorize',
      targetTenantId: tenant.id,
      callerRole: callerProfile.role,
      dryRun,
      allowed,
    })

    if (!allowed) {
      return jsonResponse({ error: 'Forbidden' }, 403)
    }

    const plan = await collectTenantDeletionPlan(adminClient, tenant)

    if (dryRun) {
      console.info('[delete-tenant] audit:', {
        action: 'delete_tenant_dry_run',
        targetTenantId: tenant.id,
        callerRole: callerProfile.role,
        productionProtected: plan.productionConnectedCredentialCount > 0,
      })
      return jsonResponse({
        success: true,
        dryRun: true,
        deletionBlocked: plan.productionConnectedCredentialCount > 0,
        reason: plan.productionConnectedCredentialCount > 0
          ? 'Tenant has production-connected ZATCA credentials'
          : null,
        counts: plan.counts,
        requiredConfirmation: 'tenant_name',
      })
    }

    if (confirmation !== tenant.name.trim()) {
      return jsonResponse({ error: 'Confirmation phrase does not match tenant name' }, 400)
    }

    if (plan.productionConnectedCredentialCount > 0) {
      console.info('[delete-tenant] audit:', {
        action: 'delete_tenant_blocked',
        targetTenantId: tenant.id,
        callerRole: callerProfile.role,
        reason: 'production_connected_zatca_credentials',
      })
      return jsonResponse({ error: 'Tenant has production-connected ZATCA credentials. Disconnect production submission before deletion.' }, 409)
    }

    console.info('[delete-tenant] audit:', {
      action: 'delete_tenant_start',
      targetTenantId: tenant.id,
      callerRole: callerProfile.role,
      counts: plan.counts,
    })

    if (plan.invoiceIds.length > 0) {
      await adminClient.from('invoices').update({ session_id: null }).in('id', plan.invoiceIds)
    }

    await adminClient.from('expenses').update({ session_id: null }).eq('tenant_id', tenant.id)
    await adminClient.from('sync_queue').delete().eq('tenant_id', tenant.id)
    await adminClient.from('pos_sessions').delete().eq('tenant_id', tenant.id)
    await adminClient.from('day_closings').delete().eq('tenant_id', tenant.id)
    await adminClient.from('zatca_certificates').delete().eq('tenant_id', tenant.id)

    if (plan.purchaseIds.length > 0) {
      await adminClient.from('purchase_items').delete().in('purchase_id', plan.purchaseIds)
    }

    await adminClient.from('purchases').delete().eq('tenant_id', tenant.id)

    if (plan.branchIds.length > 0) {
      await adminClient.from('inventory_items').delete().eq('tenant_id', tenant.id).in('branch_id', plan.branchIds)
    }

    if (plan.invoiceIds.length > 0) {
      await adminClient.from('invoice_items').delete().in('invoice_id', plan.invoiceIds)
      await adminClient.from('payments').delete().in('invoice_id', plan.invoiceIds)
    }

    await adminClient.from('invoices').delete().eq('tenant_id', tenant.id)
    await adminClient.from('expenses').delete().eq('tenant_id', tenant.id)
    await adminClient.from('fixed_expenses').delete().eq('tenant_id', tenant.id)
    await adminClient.from('employees').delete().eq('tenant_id', tenant.id)
    await adminClient.from('products').delete().eq('tenant_id', tenant.id)
    await adminClient.from('categories').delete().eq('tenant_id', tenant.id)
    await adminClient.from('customers').delete().eq('tenant_id', tenant.id)
    await adminClient.from('suppliers').delete().eq('tenant_id', tenant.id)
    await adminClient.from('branches').delete().eq('tenant_id', tenant.id)
    await adminClient.from('tenant_subscriptions').delete().eq('tenant_id', tenant.id)
    await adminClient.from('user_profiles').delete().eq('tenant_id', tenant.id)
    await adminClient.from('tenants').delete().eq('id', tenant.id)

    let authDeleteFailures = 0
    for (const authId of plan.authUserIds) {
      const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(authId)
      if (deleteAuthErr) {
        authDeleteFailures += 1
        console.error('[delete-tenant] auth user deletion failed:', deleteAuthErr.message)
      }
    }

    if (authDeleteFailures > 0) {
      return jsonResponse({ error: 'Tenant data deleted but one or more auth users could not be removed' }, 500)
    }

    console.info('[delete-tenant] audit:', {
      action: 'delete_tenant_complete',
      targetTenantId: tenant.id,
      callerRole: callerProfile.role,
    })

    return jsonResponse({ success: true })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[delete-tenant] unhandled error:', message)
    return jsonResponse({ error: message }, 500)
  }
})
