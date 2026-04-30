/**
 * ZATCA Phase 2 — Invoice Submission Orchestration
 *
 * submitInvoiceToZatca(invoiceId):
 *   1. Fetch invoice + branch from DB
 *   2. Check if branch has Phase 2 active certificate
 *   3. If Phase 1 only: mark as not_required, return
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
  const db = supabase as any

  // 1. Fetch invoice
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

  if (invErr || !inv) { console.error('[ZATCA] invoice fetch failed', invErr); return }

  // 2. Skip if already submitted or cancelled
  if (['reported', 'cleared'].includes(inv.zatca_status)) return

  // 3. Fetch branch
  const { data: branch } = await db
    .from('branches')
    .select('*, zatca_phase')
    .eq('id', inv.branch_id)
    .single()

  if (!branch) { console.error('[ZATCA] branch not found'); return }

  // 4. Phase 1 only → skip
  if ((branch.zatca_phase ?? 1) < 2) {
    await db.from('invoices').update({ zatca_status: 'not_submitted' }).eq('id', invoiceId)
    return
  }

  // 5. Fetch active ZATCA certificate
  const { data: cert } = await db
    .from('zatca_certificates')
    .select('*')
    .eq('branch_id', inv.branch_id)
    .eq('status', 'active')
    .single()

  if (!cert || !cert.private_key_encrypted || !cert.production_csid) {
    console.warn('[ZATCA] no active certificate — queuing')
    await queueForRetry(invoiceId, inv.branch_id, inv.tenant_id, 'No active ZATCA certificate')
    return
  }

  try {
    // 6. Mark as pending
    await db.from('invoices').update({ zatca_status: 'pending' }).eq('id', invoiceId)

    // 7. Decrypt private key
    const privateKeyPem = await decryptPrivateKey(cert.private_key_encrypted)

    // 8. Build XML
    const isSimplified = inv.zatca_invoice_type === 'simplified'
    const xmlData = buildInvoiceXMLData({
      invoice: inv,
      branch,
      items:   inv.invoice_items ?? [],
      customer:inv.customers ?? null,
      isSimplified,
    })
    const unsignedXml = isSimplified
      ? buildSimplifiedInvoice(xmlData)
      : buildStandardInvoice(xmlData)

    // 9. Sign
    const { signedXml, invoiceHash } = await signInvoice(
      unsignedXml,
      privateKeyPem,
      cert.production_csid,  // base64 DER certificate
    )

    // 10. Submit via Edge Function
    const response: ZatcaSubmitResponse = await submitInvoice({
      invoiceId,
      signedXml,
      invoiceHash,
      uuid:        inv.zatca_uuid,
      invoiceType: isSimplified ? 'simplified' : 'standard',
      branchId:    inv.branch_id,
    })

    // 11. Update invoice
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
      zatca_prev_invoice_hash:  invoiceHash,   // used as PIH for NEXT invoice in this branch
    }).eq('id', invoiceId)

    // 12. Update last_invoice_hash on certificate
    await db.from('zatca_certificates')
      .update({ last_invoice_hash: invoiceHash, invoice_counter: (cert.invoice_counter ?? 0) + 1 })
      .eq('id', cert.id)

    if (newStatus === 'failed') {
      await queueForRetry(invoiceId, inv.branch_id, inv.tenant_id, JSON.stringify(response.errors))
    }

  } catch (err: any) {
    console.error('[ZATCA] submission error:', err)
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
