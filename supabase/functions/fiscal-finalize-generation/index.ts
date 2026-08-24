import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildGenerationQr } from '../_shared/fiscal/generation_qr.mjs'
import { validateGenerationInvoiceSnapshot, GENERATION_ERRORS } from '../_shared/fiscal/generation_validation.mjs'
import { classifyGenerationFinalizerPreflight } from '../_shared/fiscal/generation_finalizer_preflight.mjs'

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
  if (message.includes('CROSS_REGIME_NOTE_NOT_ALLOWED')) return 'CROSS_REGIME_NOTE_NOT_ALLOWED'
  if (message.includes('GENERATION_POLICY_INVALID')) return GENERATION_ERRORS.POLICY_INVALID
  if (message.includes('GENERATION_VALIDATION_FAILED')) return GENERATION_ERRORS.VALIDATION_FAILED
  return GENERATION_ERRORS.FINALIZATION_FAILED
}

function sanitizeLogText(value: unknown): string | null {
  if (value == null) return null
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|secret|token|authorization|private[_-]?key)\s*[:=]\s*)[^\s,}]+/gi, '$1[REDACTED]')
    .slice(0, 500)
}

function safeDbError(error: unknown) {
  const value = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null
  return {
    code: sanitizeLogText(value?.code),
    message: sanitizeLogText(value?.message ?? error),
    details: sanitizeLogText(value?.details),
    hint: sanitizeLogText(value?.hint),
  }
}

function logDiagnostic(params: {
  correlationId: string
  failureStage: string
  failureCode: string
  invoiceId: string | null
  branchId: string | null
  expectedPolicyRevision: number | null
  checkoutIdempotencyKey: string | null
  error?: unknown
}) {
  console.error(JSON.stringify({
    event: 'generation_finalizer_failure',
    timestamp: new Date().toISOString(),
    correlation_id: params.correlationId,
    failure_stage: params.failureStage,
    failure_code: params.failureCode,
    invoice_id: params.invoiceId,
    branch_id: params.branchId,
    expected_policy_revision: params.expectedPolicyRevision,
    checkout_idempotency_key: params.checkoutIdempotencyKey,
    ...(params.error ? { upstream_error: safeDbError(params.error) } : {}),
  }))
}

function diagnosticResponse(params: {
  correlationId: string
  failureStage: string
  failureCode: string
  invoiceId: string | null
  branchId: string | null
  expectedPolicyRevision: number | null
  checkoutIdempotencyKey: string | null
  error?: unknown
}) {
  logDiagnostic(params)
  return response({
    error: params.failureCode,
    failure_stage: params.failureStage,
    correlation_id: params.correlationId,
  }, 422)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const correlationId = crypto.randomUUID()
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !serviceKey || !anonKey) return response({ error: GENERATION_ERRORS.FINALIZATION_FAILED }, 500)
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return response({ error: 'FISCAL_POLICY_UNAUTHORIZED' }, 401)
    const body = await req.json()
    const allowed = ['action', 'invoice_id', 'parent_invoice_id', 'branch_id', 'note_type', 'reason', 'return_stock', 'checkout_idempotency_key', 'expected_policy_revision']
    if (!body || Object.keys(body).some(key => !allowed.includes(key))) return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 400)
    const action = body.action === 'status' ? 'status' : 'finalize'
    let { invoice_id, parent_invoice_id, branch_id, note_type, reason, return_stock, checkout_idempotency_key, expected_policy_revision } = body
    if (action === 'status') {
      if (!isUuid(invoice_id) || !isUuid(branch_id)) return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 400)
    }
    if ((!isUuid(invoice_id) && !isUuid(parent_invoice_id)) || !isUuid(branch_id) || typeof checkout_idempotency_key !== 'string'
      || checkout_idempotency_key.trim().length < 8 || !Number.isInteger(expected_policy_revision) || expected_policy_revision < 1) {
      if (action !== 'status') return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 400)
    }

    const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: user, error: authError } = await db.auth.getUser(token)
    if (authError || !user.user) return response({ error: 'FISCAL_POLICY_UNAUTHORIZED' }, 401)
    const actorId = user.user.id

    if (action === 'status') {
      const [{ data: profile, error: profileError }, { data: branch, error: branchError }, { data: invoice, error: invoiceError }, { data: operation, error: operationError }] = await Promise.all([
        db.from('user_profiles').select('id, tenant_id, branch_id, role, is_active').eq('id', actorId).maybeSingle(),
        db.from('branches').select('id, tenant_id, fiscal_regime').eq('id', branch_id).maybeSingle(),
        db.from('invoices').select('id, branch_id, tenant_id, invoice_number, zatca_invoice_type, status, fiscal_regime_at_issue, fiscal_lifecycle_state, fiscal_artifact_stage, fiscal_qr_payload').eq('id', invoice_id).maybeSingle(),
        db.from('generation_fiscal_operations_v1').select('state, error_code, fiscal_result').eq('invoice_id', invoice_id).maybeSingle(),
      ])
      if (profileError || branchError || invoiceError || operationError || !profile?.is_active || !branch || !invoice
        || profile.tenant_id !== branch.tenant_id || invoice.branch_id !== branch.id || invoice.tenant_id !== branch.tenant_id
        || (profile.role !== 'owner' && !(profile.role === 'branch' && profile.branch_id === branch.id))) {
        return response({ error: 'BRANCH_ACCESS_DENIED' }, 403)
      }
      if (branch.fiscal_regime !== 'generation' && invoice.fiscal_regime_at_issue !== 'generation') {
        return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 422)
      }
      const issued = invoice.fiscal_lifecycle_state === 'generation_issued'
      const stored = operation?.fiscal_result && typeof operation.fiscal_result === 'object' ? operation.fiscal_result : {}
      return response({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        documentKind: invoice.zatca_invoice_type,
        lifecycleState: invoice.fiscal_lifecycle_state ?? 'not_started',
        artifactStage: invoice.fiscal_artifact_stage ?? 'none',
        finalizationStatus: issued ? 'generation_issued' : operation?.state === 'failed' ? 'finalization_failed' : 'finalization_required',
        canPrint: issued && Boolean(invoice.fiscal_qr_payload),
        canShare: issued && Boolean(invoice.fiscal_qr_payload),
        qrCode: issued ? (typeof stored.qrCode === 'string' ? stored.qrCode : invoice.fiscal_qr_payload) : null,
        error: operation?.state === 'failed' ? operation.error_code : null,
      })
    }

    if ((!isUuid(invoice_id) && !isUuid(parent_invoice_id)) || !isUuid(branch_id) || typeof checkout_idempotency_key !== 'string'
      || checkout_idempotency_key.trim().length < 8 || !Number.isInteger(expected_policy_revision) || expected_policy_revision < 1) {
      return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 400)
    }
    const authenticatedDb = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    if (!invoice_id) {
      if (!isUuid(parent_invoice_id) || !['credit_note', 'debit_note'].includes(note_type) || typeof reason !== 'string' || reason.trim().length < 3) {
        return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 400)
      }
      const { data: created, error: createError } = await authenticatedDb.rpc('create_generation_note_v1', {
        p_payload: {
          parent_invoice_id,
          branch_id,
          note_type,
          reason: reason.trim(),
          return_stock: return_stock === true,
          idempotency_key: checkout_idempotency_key.trim(),
          expected_policy_revision,
        },
      })
      if (createError || !created?.invoice_id) {
        const code = errorCode(createError ?? GENERATION_ERRORS.FINALIZATION_FAILED)
        return response({ error: code }, code === 'FISCAL_POLICY_CHANGED' || code === 'CROSS_REGIME_NOTE_NOT_ALLOWED' || code === 'IDEMPOTENCY_CONFLICT' ? 409 : 422)
      }
      invoice_id = created.invoice_id
    }

    const [{ data: policy, error: policyError }, { data: invoice, error: invoiceError }, { data: snapshot, error: snapshotError }, { data: branch, error: branchError }] = await Promise.all([
      authenticatedDb.rpc('resolve_fiscal_policy', { p_branch_id: branch_id }),
      db.from('invoices').select('id, invoice_number, branch_id, tenant_id, status, zatca_invoice_type, original_invoice_id, fiscal_lifecycle_state, fiscal_document_snapshot_hash').eq('id', invoice_id).maybeSingle(),
      db.rpc('build_zatca_atomic_receipt_snapshot_v2', { p_invoice_id: invoice_id }),
      db.from('branches').select('id, tenant_id, fiscal_regime, fiscal_activation_state, fiscal_policy_revision').eq('id', branch_id).maybeSingle(),
    ])
    const preflightFailure = classifyGenerationFinalizerPreflight({
      policy,
      policyError,
      invoice,
      invoiceError,
      snapshot,
      snapshotError,
      branch,
      branchError,
      branchId: branch_id,
    })
    if (preflightFailure) {
      return diagnosticResponse({
        correlationId,
        failureStage: preflightFailure.stage,
        failureCode: preflightFailure.code,
        invoiceId: invoice_id,
        branchId: branch_id,
        expectedPolicyRevision: expected_policy_revision,
        checkoutIdempotencyKey: checkout_idempotency_key,
        error: preflightFailure.error,
      })
    }
    if (policy.policyRevision !== expected_policy_revision) return response({ error: 'FISCAL_POLICY_CHANGED' }, 409)
    if (invoice.status !== 'posted' || (!invoice.original_invoice_id && !['simplified', 'standard'].includes(invoice.zatca_invoice_type)) || (invoice.original_invoice_id && !['credit_note', 'debit_note'].includes(invoice.zatca_invoice_type))) {
      return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 422)
    }

    let parentSnapshot: Record<string, unknown> | undefined
    if (['credit_note', 'debit_note'].includes(invoice.zatca_invoice_type)) {
      const { data: parent, error: parentError } = await db.from('invoices').select('id, invoice_number, zatca_invoice_type, fiscal_regime_at_issue, fiscal_lifecycle_state, fiscal_issued_at').eq('id', snapshot.original_invoice_id).maybeSingle()
      if (parentError || !parent || parent.fiscal_regime_at_issue !== 'generation' || parent.fiscal_lifecycle_state !== 'generation_issued') {
        return response({ error: GENERATION_ERRORS.VALIDATION_FAILED }, 422)
      }
      parentSnapshot = { id: parent.id, invoiceNumber: parent.invoice_number, zatca_invoice_type: parent.zatca_invoice_type, fiscalRegimeAtIssue: parent.fiscal_regime_at_issue, lifecycleState: parent.fiscal_lifecycle_state, fiscalIssuedAt: parent.fiscal_issued_at }
    }
    const canonicalSnapshot = { ...snapshot, ...(parentSnapshot ? { parentSnapshot } : {}), invoice_id: invoice.id, branch_id: branch.id, tenant_id: branch.tenant_id }
    validateGenerationInvoiceSnapshot(canonicalSnapshot)
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
      logDiagnostic({
        correlationId,
        failureStage: 'finalization_rpc',
        failureCode: code,
        invoiceId: invoice_id,
        branchId: branch_id,
        expectedPolicyRevision: expected_policy_revision,
        checkoutIdempotencyKey: checkout_idempotency_key,
        error: finalizeError,
      })
      return response({ error: code, failure_stage: 'finalization_rpc', correlation_id: correlationId }, code === 'IDEMPOTENCY_CONFLICT' || code === 'FISCAL_POLICY_CHANGED' || code === 'CROSS_REGIME_NOTE_NOT_ALLOWED' ? 409 : 422)
    }
    return response(result as Record<string, unknown>)
  } catch (error) {
    const code = errorCode(error)
    const correlationId = crypto.randomUUID()
    logDiagnostic({
      correlationId,
      failureStage: 'request_processing',
      failureCode: code,
      invoiceId: null,
      branchId: null,
      expectedPolicyRevision: null,
      checkoutIdempotencyKey: null,
      error,
    })
    return response({ error: code, failure_stage: 'request_processing', correlation_id: correlationId }, 422)
  }
})
