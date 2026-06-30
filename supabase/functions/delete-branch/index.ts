import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface CallerProfile {
  role: string
  tenant_id: string | null
}

interface BranchRow {
  id: string
  tenant_id: string
  name: string
}

interface BranchDeletionPlan {
  branchUserIds: string[]
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

function isAuthorizedForBranchDelete(caller: CallerProfile, branch: BranchRow): boolean {
  if (caller.role === 'super_admin') return true
  return caller.role === 'owner' && caller.tenant_id === branch.tenant_id
}

async function countQuery(query: any, label: string): Promise<number> {
  const { count, error } = await query
  if (error) throw new Error(`Unable to count ${label}`)
  return count ?? 0
}

function countRows(adminClient: any, table: string, label: string, applyFilters: (query: any) => any): Promise<number> {
  return countQuery(applyFilters(adminClient.from(table).select('id', { count: 'exact', head: true })), label)
}

async function collectBranchDeletionPlan(adminClient: any, branch: BranchRow): Promise<BranchDeletionPlan> {
  const { data: branchUsers, error: branchUsersErr } = await adminClient
    .from('user_profiles')
    .select('id')
    .eq('tenant_id', branch.tenant_id)
    .eq('branch_id', branch.id)
    .eq('role', 'branch')

  if (branchUsersErr) throw new Error('Unable to inspect branch users')
  const branchUserIds = (branchUsers ?? []).map((row: { id: string }) => row.id)

  const { data: invoiceRows, error: invoicesErr } = await adminClient
    .from('invoices')
    .select('id')
    .eq('tenant_id', branch.tenant_id)
    .eq('branch_id', branch.id)

  if (invoicesErr) throw new Error('Unable to inspect invoices')
  const invoiceIds = (invoiceRows ?? []).map((row: { id: string }) => row.id)

  const { data: purchaseRows, error: purchasesErr } = await adminClient
    .from('purchases')
    .select('id')
    .eq('tenant_id', branch.tenant_id)
    .eq('branch_id', branch.id)

  if (purchasesErr) throw new Error('Unable to inspect purchases')
  const purchaseIds = (purchaseRows ?? []).map((row: { id: string }) => row.id)

  const productionConnectedCredentialCount = await countRows(
    adminClient,
    'zatca_production_credentials',
    'production ZATCA credentials',
    query => query
      .eq('tenant_id', branch.tenant_id)
      .eq('branch_id', branch.id)
      .eq('environment', 'production')
      .eq('onboarding_status', 'production_connected'),
  )

  const counts: Record<string, number> = {
    branches: 1,
    branch_auth_users: branchUserIds.length,
    zatca_production_credentials_connected: productionConnectedCredentialCount,
    sync_queue: await countRows(adminClient, 'sync_queue', 'sync queue rows', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    pos_sessions: await countRows(adminClient, 'pos_sessions', 'POS sessions', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    day_closings: await countRows(adminClient, 'day_closings', 'day closings', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    zatca_certificates: await countRows(adminClient, 'zatca_certificates', 'ZATCA certificates', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    invoices: await countRows(adminClient, 'invoices', 'invoices', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    invoice_items: invoiceIds.length > 0
      ? await countRows(adminClient, 'invoice_items', 'invoice items', query => query.in('invoice_id', invoiceIds))
      : 0,
    payments: invoiceIds.length > 0
      ? await countRows(adminClient, 'payments', 'payments', query => query.in('invoice_id', invoiceIds))
      : 0,
    expenses: await countRows(adminClient, 'expenses', 'expenses', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    fixed_expenses: await countRows(adminClient, 'fixed_expenses', 'fixed expenses', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    purchases: await countRows(adminClient, 'purchases', 'purchases', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    purchase_items: purchaseIds.length > 0
      ? await countRows(adminClient, 'purchase_items', 'purchase items', query => query.in('purchase_id', purchaseIds))
      : 0,
    inventory_items: await countRows(adminClient, 'inventory_items', 'inventory items', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    employees: await countRows(adminClient, 'employees', 'employees', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    suppliers: await countRows(adminClient, 'suppliers', 'suppliers', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
    user_profiles: await countRows(adminClient, 'user_profiles', 'user profiles', query => query.eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)),
  }

  return {
    branchUserIds,
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
    const branchId = typeof body?.branchId === 'string' ? body.branchId.trim() : ''
    const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim() : ''
    const dryRun = body?.dryRun === true

    if (!branchId) {
      return jsonResponse({ error: 'Missing required field: branchId' }, 400)
    }

    const { data: branchRow, error: branchErr } = await adminClient
      .from('branches')
      .select('id, tenant_id, name')
      .eq('id', branchId)
      .maybeSingle()

    if (branchErr) {
      return jsonResponse({ error: 'Unable to verify branch access' }, 500)
    }

    if (!branchRow) {
      return jsonResponse({ error: 'Branch not found or access denied' }, 404)
    }

    const branch = branchRow as BranchRow
    const allowed = isAuthorizedForBranchDelete(callerProfile as CallerProfile, branch)
    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId: branch.tenant_id,
      branchId: branch.id,
      actorUserId: caller.id,
      actorRole: String(callerProfile.role),
      targetType: 'branch',
      targetId: branch.id,
      ipHash,
      requestId: reqId,
    }
    console.info('[delete-branch] audit:', {
      action: 'delete_branch_authorize',
      targetTenantId: branch.tenant_id,
      targetBranchId: branch.id,
      callerRole: callerProfile.role,
      dryRun,
      allowed,
    })

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'delete_branch_attempted',
      severity: 'critical',
      status: allowed ? 'attempted' : 'blocked',
      metadata: { dryRun },
    })

    if (!allowed) {
      return jsonResponse({ error: 'Forbidden' }, 403)
    }

    if (!dryRun) {
      const rate = await enforceRateLimit(adminClient as any, {
        ...auditBase,
        action: 'delete_branch',
        scope: 'branch',
        scopeId: branch.id,
        maxAttempts: 3,
        windowSeconds: 86400,
      })

      if (!rate.allowed) {
        await auditEvent(adminClient as any, {
          ...auditBase,
          action: 'delete_branch_rate_limited',
          severity: 'critical',
          status: 'blocked',
          metadata: { retryAfterSeconds: rate.retryAfterSeconds },
        })
        return jsonResponse(rateLimitBody(rate), 429)
      }
    }

    const plan = await collectBranchDeletionPlan(adminClient, branch)

    if (dryRun) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'delete_branch_dry_run',
        severity: 'warning',
        status: plan.productionConnectedCredentialCount > 0 ? 'blocked' : 'succeeded',
        metadata: {
          productionProtected: plan.productionConnectedCredentialCount > 0,
          counts: plan.counts,
        },
      })
      console.info('[delete-branch] audit:', {
        action: 'delete_branch_dry_run',
        targetTenantId: branch.tenant_id,
        targetBranchId: branch.id,
        callerRole: callerProfile.role,
        productionProtected: plan.productionConnectedCredentialCount > 0,
      })
      return jsonResponse({
        success: true,
        dryRun: true,
        deletionBlocked: plan.productionConnectedCredentialCount > 0,
        reason: plan.productionConnectedCredentialCount > 0
          ? 'Branch has production-connected ZATCA credentials'
          : null,
        counts: plan.counts,
        requiredConfirmation: 'branch_name',
      })
    }

    if (confirmation !== branch.name.trim()) {
      return jsonResponse({ error: 'Confirmation phrase does not match branch name' }, 400)
    }

    if (plan.productionConnectedCredentialCount > 0) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'delete_branch_blocked',
        severity: 'critical',
        status: 'blocked',
        metadata: { reason: 'production_connected_zatca_credentials' },
      })
      console.info('[delete-branch] audit:', {
        action: 'delete_branch_blocked',
        targetTenantId: branch.tenant_id,
        targetBranchId: branch.id,
        callerRole: callerProfile.role,
        reason: 'production_connected_zatca_credentials',
      })
      return jsonResponse({ error: 'Branch has production-connected ZATCA credentials. Disconnect production submission before deletion.' }, 409)
    }

    console.info('[delete-branch] audit:', {
      action: 'delete_branch_start',
      targetTenantId: branch.tenant_id,
      targetBranchId: branch.id,
      callerRole: callerProfile.role,
      counts: plan.counts,
    })

    if (plan.invoiceIds.length > 0) {
      await adminClient.from('invoices').update({ session_id: null }).in('id', plan.invoiceIds)
    }

    await adminClient.from('expenses').update({ session_id: null }).eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('sync_queue').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('pos_sessions').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('day_closings').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('zatca_certificates').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)

    if (plan.invoiceIds.length > 0) {
      await adminClient.from('invoice_items').delete().in('invoice_id', plan.invoiceIds)
      await adminClient.from('payments').delete().in('invoice_id', plan.invoiceIds)
    }

    await adminClient.from('invoices').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('expenses').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('fixed_expenses').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)

    if (plan.purchaseIds.length > 0) {
      await adminClient.from('purchase_items').delete().in('purchase_id', plan.purchaseIds)
    }

    await adminClient.from('purchases').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('inventory_items').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('employees').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('suppliers').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('user_profiles').delete().eq('tenant_id', branch.tenant_id).eq('branch_id', branch.id)
    await adminClient.from('branches').delete().eq('tenant_id', branch.tenant_id).eq('id', branch.id)

    let authDeleteFailures = 0
    for (const branchUserId of plan.branchUserIds) {
      const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(branchUserId)
      if (deleteAuthErr) {
        authDeleteFailures += 1
        console.error('[delete-branch] auth user deletion failed:', deleteAuthErr.message)
      }
    }

    if (authDeleteFailures > 0) {
      await auditEvent(adminClient as any, {
        ...auditBase,
        action: 'delete_branch_failed',
        severity: 'critical',
        status: 'failed',
        metadata: { reason: 'auth_delete_failures', authDeleteFailures },
      })
      return jsonResponse({ error: 'Branch data deleted but one or more auth users could not be removed' }, 500)
    }

    await auditEvent(adminClient as any, {
      ...auditBase,
      action: 'delete_branch_completed',
      severity: 'critical',
      status: 'succeeded',
      metadata: { counts: plan.counts },
    })

    console.info('[delete-branch] audit:', {
      action: 'delete_branch_complete',
      targetTenantId: branch.tenant_id,
      targetBranchId: branch.id,
      callerRole: callerProfile.role,
    })

    return jsonResponse({ success: true })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error'
    console.error('[delete-branch] unhandled error:', message)
    return jsonResponse({ error: message }, 500)
  }
})
