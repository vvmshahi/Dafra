/**
 * Branch-scoped local ZATCA production disconnect.
 *
 * This does not revoke the device in FATOORA. It marks Dafra's stored
 * production connection inactive while keeping encrypted credentials for audit.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, isUuid, jsonResponse, requireEnv, safeErrorMessage } from '../_shared/zatca/config.ts'
import { loadOwnedBranch, requireTenantOwner } from '../_shared/zatca/auth.ts'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'

const REQUIRED_CONFIRMATION = 'DELETE ZATCA CONNECTION'

interface RequestBody {
  branchId?: unknown
  confirmation?: unknown
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const db = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    )
    const body = await readBody(req)

    if (!isUuid(body.branchId)) {
      return jsonResponse({ error: 'Invalid branch' }, 400)
    }

    if (body.confirmation !== REQUIRED_CONFIRMATION) {
      return jsonResponse({ error: 'Confirmation phrase did not match' }, 400)
    }

    const owner = await requireTenantOwner(db, req)
    const branch = await loadOwnedBranch(db, body.branchId, owner.tenantId)
    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId: owner.tenantId,
      branchId: branch.id,
      actorUserId: owner.userId,
      actorRole: 'owner',
      targetType: 'branch',
      targetId: branch.id,
      ipHash,
      requestId: reqId,
    }

    await auditEvent(db as any, {
      ...auditBase,
      action: 'zatca_disconnect_attempted',
      severity: 'warning',
      status: 'attempted',
    })

    const rate = await enforceRateLimit(db as any, {
      ...auditBase,
      action: 'zatca_disconnect_production',
      scope: 'branch',
      scopeId: branch.id,
      maxAttempts: 3,
      windowSeconds: 86400,
    })

    if (!rate.allowed) {
      await auditEvent(db as any, {
        ...auditBase,
        action: 'zatca_disconnect_rate_limited',
        severity: 'warning',
        status: 'blocked',
        metadata: { retryAfterSeconds: rate.retryAfterSeconds },
      })
      return jsonResponse(rateLimitBody(rate), 429)
    }

    const [pendingInvoices, pendingQueue, credentials] = await Promise.all([
      db
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', owner.tenantId)
        .eq('branch_id', branch.id)
        .eq('zatca_status', 'pending'),
      db
        .from('sync_queue')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', owner.tenantId)
        .eq('branch_id', branch.id)
        .eq('action', 'zatca_submit')
        .in('status', ['pending', 'processing']),
      db
        .from('zatca_production_credentials')
        .select('id, onboarding_status, functionality_map, connected_at, encrypted_production_csid, encrypted_production_secret')
        .eq('tenant_id', owner.tenantId)
        .eq('branch_id', branch.id)
        .eq('environment', 'production')
        .maybeSingle(),
    ])

    if (pendingInvoices.error) throw new Error('Unable to check pending invoices')
    if (pendingQueue.error) throw new Error('Unable to check pending ZATCA retry queue')
    if (credentials.error) throw new Error('Unable to load ZATCA production connection')

    const pendingInvoiceCount = pendingInvoices.count ?? 0
    const pendingQueueCount = pendingQueue.count ?? 0
    if (pendingInvoiceCount > 0 || pendingQueueCount > 0) {
      await auditEvent(db as any, {
        ...auditBase,
        action: 'zatca_disconnect_blocked',
        severity: 'warning',
        status: 'blocked',
        metadata: { pendingInvoiceCount, pendingQueueCount },
      })
      return jsonResponse({
        ok: false,
        branchId: branch.id,
        environment: 'production',
        onboardingStatus: credentials.data?.onboarding_status ?? 'not_started',
        error: 'This branch has pending ZATCA submissions. Retry or resolve them before removing the local connection.',
        pendingInvoiceCount,
        pendingQueueCount,
      }, 409)
    }

    if (!credentials.data) {
      await auditEvent(db as any, {
        ...auditBase,
        action: 'zatca_disconnect_completed',
        status: 'succeeded',
        metadata: { previousStatus: 'not_started' },
      })
      return jsonResponse({
        ok: true,
        branchId: branch.id,
        environment: 'production',
        onboardingStatus: 'not_started',
        message: 'No local ZATCA production connection exists for this branch.',
      })
    }

    const disconnectedAt = new Date().toISOString()
    const { error: updateErr } = await db
      .from('zatca_production_credentials')
      .update({
        onboarding_status: 'disconnected',
        disconnected_at: disconnectedAt,
        updated_by: owner.userId,
        last_error: 'Local ZATCA production connection removed by tenant owner.',
      })
      .eq('id', credentials.data.id)
      .eq('tenant_id', owner.tenantId)
      .eq('branch_id', branch.id)
      .eq('environment', 'production')

    if (updateErr) {
      console.error('[zatca-disconnect-production] update failed:', {
        message: updateErr.message,
        code: updateErr.code,
        branchId: branch.id,
        tenantId: owner.tenantId,
      })
      throw new Error('Unable to remove local ZATCA production connection')
    }

    console.info('[zatca-disconnect-production] disconnected:', {
      branchId: branch.id,
      tenantId: owner.tenantId,
      previousStatus: credentials.data.onboarding_status,
    })

    await auditEvent(db as any, {
      ...auditBase,
      action: 'zatca_disconnect_completed',
      severity: 'warning',
      status: 'succeeded',
      metadata: { previousStatus: credentials.data.onboarding_status },
    })

    return jsonResponse({
      ok: true,
      branchId: branch.id,
      environment: 'production',
      onboardingStatus: 'disconnected',
      functionalityMap: credentials.data.functionality_map,
      connectedAt: credentials.data.connected_at,
      disconnectedAt,
      productionCsidExists: !!credentials.data.encrypted_production_csid,
      productionSecretExists: !!credentials.data.encrypted_production_secret,
      message: 'Local ZATCA production connection removed for this branch. Manage the device in FATOORA separately if required.',
    })
  } catch (err) {
    const message = safeErrorMessage(err)
    const status = message === 'Unauthorized' ? 401 : message.startsWith('Forbidden') ? 403 : 500
    console.error('[zatca-disconnect-production] failed:', message)
    return jsonResponse({ error: message }, status)
  }
})

async function readBody(req: Request): Promise<RequestBody> {
  try {
    return await req.json()
  } catch {
    throw new Error('Invalid JSON request body')
  }
}
