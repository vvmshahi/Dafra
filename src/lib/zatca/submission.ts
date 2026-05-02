/**
 * ZATCA Phase 2 — Invoice Submission Orchestration
 *
 * submitInvoiceToZatca(invoiceId):
 *   1. Fetch invoice from DB
 *   2. Check for active Phase 2 certificate (by cert, not branch.zatca_phase)
 *   3. If Phase 1 only (no active cert): mark as not_submitted, return
 *   4. Build UBL XML
 *   5. Decrypt private key, sign invoice (XAdES)
 *   6. Submit to ZATCA via Edge Function (report or clear)
 *   7. Update invoice zatca_status + store XML + hash
 *   8. On failure: add to sync_queue for retry
 */

import { supabase } from '@/lib/supabase'
import { decryptPrivateKey } from './crypto'
import { buildSimplifiedInvoice, buildStandardInvoice, buildInvoiceXMLData } from './xml'
import { signInvoice } from './signing'
import { submitInvoice, ZatcaSubmitResponse } from './api'

// ── Main entry point ──────────────────────────────────────────────────────────

export async function submitInvoiceToZatca(invoiceId: string): Promise<void> {
  console.log('[ZATCA] submitInvoiceToZatca called for invoice:', invoiceId)
  const db = supabase as any

  // 1. Fetch invoice
  console.log('[ZATCA] step 1: fetching invoice...')
  const { data: inv, error: invErr } = await db
    .from('invoices')
    .select(`
      id, invoice_number, zatca_uuid, zatca_invoice_type, invoice_date, created_at,
      zatca_counter_number, zatca_prev_invoice_hash, zatca_status,
      subtotal, discount_amount, taxable_amount, tax_amount, total_amount,
      branch_id, tenant_id, customer_id,
      invoice_items(id, name, quantity, unit_price, discount_amount, subtotal, tax_rate, tax_amount, total),
      customers(name, vat_number)
    `)
    .eq('id', invoiceId)
    .single()

  if (invErr || !inv) {
    console.error('[ZATCA] invoice fetch failed:', invErr)
    return
  }
  console.log('[ZATCA] invoice found:', inv.invoice_number, '| status:', inv.zatca_status)

  // 2. Skip if already submitted or cancelled
  if (['reported', 'cleared'].includes(inv.zatca_status)) {
    console.log('[ZATCA] already submitted (', inv.zatca_status, ') — skipping')
    return
  }

  // 3. Fetch branch
  console.log('[ZATCA] step 3: fetching branch...')
  const { data: branch } = await db
    .from('branches')
    .select('*')
    .eq('id', inv.branch_id)
    .single()

  if (!branch) {
    console.error('[ZATCA] branch not found for id:', inv.branch_id)
    return
  }
  console.log('[ZATCA] branch found:', branch.name, '| id:', branch.id)

  // 4. Check for active Phase 2 certificate — do NOT rely on branch.zatca_phase
  //    (zatca_phase column is never auto-updated; cert status is the source of truth)
  console.log('[ZATCA] step 4: checking for active Phase 2 certificate...')
  const { data: cert, error: certFetchErr } = await db
    .from('zatca_certificates')
    .select('*')
    .eq('branch_id', inv.branch_id)
    .eq('status', 'active')
    .single()

  console.log('[ZATCA] cert query result:', {
    found: !!cert,
    error: certFetchErr?.message,
    hasProdCsid: !!cert?.production_csid,
    hasPrivateKey: !!cert?.private_key_encrypted,
    certStatus: cert?.status,
  })

  // Phase 1 mode: no active production cert → not_submitted
  if (!cert?.production_csid) {
    console.log('[ZATCA] no active Phase 2 certificate found — Phase 1 mode, marking not_submitted')
    await db.from('invoices').update({ zatca_status: 'not_submitted' }).eq('id', invoiceId)
    return
  }

  // Active cert found but private key missing
  if (!cert.private_key_encrypted) {
    console.warn('[ZATCA] Phase 2 cert found but private_key_encrypted is null — queuing for retry')
    await queueForRetry(invoiceId, inv.branch_id, inv.tenant_id, 'Phase 2 cert active but private key missing')
    return
  }

  console.log('[ZATCA] Phase 2 active — proceeding with XML build + sign + submit')

  try {
    // 5. Mark as pending
    console.log('[ZATCA] step 5: marking invoice as pending...')
    await db.from('invoices').update({ zatca_status: 'pending' }).eq('id', invoiceId)

    // 6. Decrypt private key
    console.log('[ZATCA] step 6: decrypting private key...')
    const privateKeyPem = await decryptPrivateKey(cert.private_key_encrypted)
    console.log('[ZATCA] private key decrypted OK')

    // 7. Build XML
    const isSimplified = inv.zatca_invoice_type === 'simplified'
    console.log('[ZATCA] step 7: building XML (isSimplified:', isSimplified, ')...')
    const xmlData = buildInvoiceXMLData({
      invoice:     inv,
      branch,
      items:       inv.invoice_items ?? [],
      customer:    inv.customers ?? null,
      isSimplified,
    })
    const unsignedXml = isSimplified
      ? buildSimplifiedInvoice(xmlData)
      : buildStandardInvoice(xmlData)
    console.log('[ZATCA] XML built, length:', unsignedXml.length)

    // 8. Sign
    console.log('[ZATCA] step 8: signing invoice...')
    const { signedXml, invoiceHash } = await signInvoice(
      unsignedXml,
      privateKeyPem,
      cert.production_csid,
    )
    console.log('[ZATCA] invoice signed OK, hash prefix:', invoiceHash.substring(0, 20) + '...')

    // 9. Submit via Edge Function
    console.log('[ZATCA] step 9: submitting to ZATCA via edge function...')
    const response: ZatcaSubmitResponse = await submitInvoice({
      invoiceId,
      signedXml,
      invoiceHash,
      uuid:        inv.zatca_uuid,
      invoiceType: isSimplified ? 'simplified' : 'standard',
      branchId:    inv.branch_id,
    })
    console.log('[ZATCA] edge function response status:', response.status)

    // 10. Update invoice
    const newStatus = response.status === 'REPORTED' ? 'reported'
                    : response.status === 'CLEARED'  ? 'cleared'
                    : 'failed'

    await db.from('invoices').update({
      zatca_status:             newStatus,
      zatca_xml:                signedXml,
      zatca_xml_hash:           invoiceHash,
      zatca_submission_id:      response.submissionId ?? null,
      zatca_submitted_at:       new Date().toISOString(),
      zatca_clearance_status:   response.clearanceStatus  ?? null,
      zatca_reporting_response: response.zatcaResponse    ?? null,
      zatca_warnings:           response.warnings?.length ? { warnings: response.warnings } : null,
      zatca_prev_invoice_hash:  invoiceHash,
    }).eq('id', invoiceId)
    console.log('[ZATCA] invoice updated to status:', newStatus)

    // 11. Update certificate counter
    await db.from('zatca_certificates')
      .update({ last_invoice_hash: invoiceHash, invoice_counter: (cert.invoice_counter ?? 0) + 1 })
      .eq('id', cert.id)

    if (newStatus === 'failed') {
      await queueForRetry(invoiceId, inv.branch_id, inv.tenant_id, JSON.stringify(response.errors))
    }

  } catch (err: any) {
    console.error('[ZATCA] submission error:', err.message)
    console.error('[ZATCA] stack:', err.stack)
    await db.from('invoices').update({ zatca_status: 'failed' }).eq('id', invoiceId)
    await queueForRetry(invoiceId, inv.branch_id, inv.tenant_id, err.message ?? 'unknown error')
  }
}

// ── Retry queue ───────────────────────────────────────────────────────────────

async function queueForRetry(
  invoiceId: string, branchId: string, tenantId: string, reason: string,
): Promise<void> {
  await (supabase as any).from('sync_queue').insert([{
    tenant_id:  tenantId,
    branch_id:  branchId,
    invoice_id: invoiceId,
    action:     'zatca_submit',
    payload:    { reason },
    status:     'pending',
    max_attempts: 5,
  }])
}

/**
 * Process the sync_queue — retry failed ZATCA submissions.
 * Call this periodically (e.g., from a scheduled Edge Function every 15 min).
 */
export async function retryFailedSubmissions(tenantId: string): Promise<void> {
  const db = supabase as any
  const { data: queue } = await db
    .from('sync_queue')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('action', 'zatca_submit')
    .eq('status', 'pending')
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(10)

  for (const item of (queue ?? [])) {
    await db.from('sync_queue')
      .update({ attempts: (item.attempts ?? 0) + 1, last_attempt_at: new Date().toISOString() })
      .eq('id', item.id)

    try {
      await submitInvoiceToZatca(item.invoice_id)
      await db.from('sync_queue').update({ status: 'success', processed_at: new Date().toISOString() }).eq('id', item.id)
    } catch (err: any) {
      const failed = (item.attempts ?? 0) + 1 >= 5
      await db.from('sync_queue').update({
        status:     failed ? 'failed' : 'pending',
        last_error: err.message,
      }).eq('id', item.id)
    }
  }
}
