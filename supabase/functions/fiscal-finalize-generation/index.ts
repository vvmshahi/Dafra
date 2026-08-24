import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildGenerationQr } from '../_shared/fiscal/generation_qr.mjs'
import { validateGenerationInvoiceSnapshot, GENERATION_ERRORS } from '../_shared/fiscal/generation_validation.mjs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function sha256Hex(value: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(bytes =>
    Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''))
}

function errorCode(error: unknown): string {
  const message = String((error as { message?: unknown })?.message ?? error)
  if (message.includes('FISCAL_POLICY_CHANGED')) return 'FISCAL_POLICY_CHANGED'
  if (message.includes('IDEMPOTENCY_CONFLICT')) return 'IDEMPOTENCY_CONFLICT'
  if (message.includes('BRANCH_ACCESS_DENIED')) return 'BRANCH_ACCESS_DENIED'
  if (message.includes('GENERATION_POLICY_INVALID')) return GENERATION_ERRORS.POLICY_INVALID
  if (message.includes('GENERATION_VALIDATION_FAILED')) return GENERATION_ERRORS.VALIDATION_FAILED
  return GENERATION_ERRORS.FINALIZATION_FAILED
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !serviceKey || !anonKey) return response({ error: GENERATION_ERRORS.FINALIZATION_FAILED }, 500)
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return response({ error: 'FISCAL_POLICY_UNAUTHORIZED' }, 401)
    const body = await req.json()
    const allowed = ['invoice_id', 'branch_id', 'checkout_idempotency_key', 'expected_policy_revision']
    if (!body || Object.keys(body).some(key => !allowed.includes(key))) return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 400)
    const { invoice_id, branch_id, checkout_idempotency_key, expected_policy_revision } = body
    if (!isUuid(invoice_id) || !isUuid(branch_id) || typeof checkout_idempotency_key !== 'string'
      || checkout_idempotency_key.trim().length < 8 || !Number.isInteger(expected_policy_revision) || expected_policy_revision < 1) {
      return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 400)
    }

    const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: user, error: authError } = await db.auth.getUser(token)
    if (authError || !user.user) return response({ error: 'FISCAL_POLICY_UNAUTHORIZED' }, 401)
    const actorId = user.user.id
    const authenticatedDb = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const [{ data: policy, error: policyError }, { data: invoice, error: invoiceError }, { data: snapshot, error: snapshotError }, { data: branch, error: branchError }] = await Promise.all([
      authenticatedDb.rpc('resolve_fiscal_policy', { p_branch_id: branch_id }),
      db.from('invoices').select('id, invoice_number, branch_id, tenant_id, status, zatca_invoice_type, original_invoice_id, fiscal_lifecycle_state, fiscal_document_snapshot_hash').eq('id', invoice_id).maybeSingle(),
      db.rpc('build_zatca_atomic_receipt_snapshot_v2', { p_invoice_id: invoice_id }),
      db.from('branches').select('id, tenant_id, fiscal_regime, fiscal_activation_state, fiscal_policy_revision').eq('id', branch_id).maybeSingle(),
    ])
    if (policyError || !policy || invoiceError || snapshotError || branchError || !invoice || !snapshot || !branch || invoice.branch_id !== branch_id || policy.regime !== 'generation') {
      return response({ error: GENERATION_ERRORS.POLICY_INVALID }, 422)
    }
    if (policy.policyRevision !== expected_policy_revision) return response({ error: 'FISCAL_POLICY_CHANGED' }, 409)
    if (invoice.status !== 'posted' || invoice.original_invoice_id || !['simplified', 'standard'].includes(invoice.zatca_invoice_type)) {
      return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 422)
    }

    validateGenerationInvoiceSnapshot(snapshot)
    const canonicalSnapshot = { ...snapshot, invoice_id: invoice.id, branch_id: branch.id, tenant_id: branch.tenant_id }
    const snapshotJson = JSON.stringify(canonicalSnapshot)
    const snapshotHash = await sha256Hex(snapshotJson)
    const requestFingerprint = await sha256Hex(JSON.stringify({ invoice_id, branch_id, checkout_idempotency_key, expected_policy_revision, snapshotHash }))
    let qrCode: string
    try {
      qrCode = buildGenerationQr({
        sellerName: snapshot.seller.business_name || snapshot.seller.display_name,
        sellerVatNumber: snapshot.seller.vat_number,
        timestamp: new Date().toISOString(),
        totalIncludingVat: snapshot.total,
        vatTotal: snapshot.tax_amount,
      })
    } catch {
      return response({ error: GENERATION_ERRORS.QR_FAILED }, 422)
    }

    const { data: result, error: finalizeError } = await db.rpc('finalize_generation_invoice_v1', {
      p_invoice_id: invoice_id, p_branch_id: branch_id, p_actor_user_id: actorId,
      p_checkout_idempotency_key: checkout_idempotency_key.trim(),
      p_expected_policy_revision: expected_policy_revision, p_document_snapshot: canonicalSnapshot,
      p_snapshot_hash: snapshotHash, p_qr_payload: qrCode, p_request_fingerprint: requestFingerprint,
    })
    if (finalizeError) {
      const code = errorCode(finalizeError)
      return response({ error: code }, code === 'IDEMPOTENCY_CONFLICT' || code === 'FISCAL_POLICY_CHANGED' ? 409 : 422)
    }
    return response(result as Record<string, unknown>)
  } catch (error) {
    const code = errorCode(error)
    return response({ error: code }, 422)
  }
})
