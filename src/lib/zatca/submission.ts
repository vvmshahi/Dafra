import { supabase } from '@/lib/supabase'

export type ZatcaSubmitSource = 'auto_checkout' | 'auto_credit_note' | 'manual_retry' | 'bulk_retry'

export interface ZatcaSubmitResult {
  ok: boolean
  invoiceStatus: string
  retryable: boolean
}

export interface ZatcaSubmitOptions {
  source?: ZatcaSubmitSource
}

export async function submitInvoiceToZatcaDetailed(
  invoiceId: string,
  branchId: string,
  options: ZatcaSubmitOptions = {},
): Promise<ZatcaSubmitResult> {
  const source = options.source ?? 'manual_retry'
  const { data, error } = await supabase.functions.invoke('zatca-submit', {
    body: { invoiceId, branchId, source },
  })
  if (error) throw new Error(error.message)
  const invoiceStatus = String(data?.invoiceStatus ?? 'error')
  return {
    ok: invoiceStatus === 'reported' || invoiceStatus === 'cleared',
    invoiceStatus,
    retryable: invoiceStatus === 'pending' || invoiceStatus === 'error',
  }
}

export async function submitInvoiceToZatca(invoiceId: string, branchId: string, options: ZatcaSubmitOptions = {}): Promise<boolean> {
  const result = await submitInvoiceToZatcaDetailed(invoiceId, branchId, options)
  return result.ok
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function submitInvoiceToZatcaWithRetry(
  invoiceId: string,
  branchId: string,
  options: ZatcaSubmitOptions & { retryDelayMs?: number } = {},
): Promise<ZatcaSubmitResult> {
  try {
    const first = await submitInvoiceToZatcaDetailed(invoiceId, branchId, options)
    if (first.ok || !first.retryable) return first
  } catch (error) {
    console.warn('[zatca submission] first attempt failed', {
      invoiceId,
      branchId,
      source: options.source ?? 'manual_retry',
      message: error instanceof Error ? error.message : String(error ?? ''),
    })
  }

  await wait(options.retryDelayMs ?? 1500)
  return submitInvoiceToZatcaDetailed(invoiceId, branchId, options)
}

export interface ZatcaRetrySummary {
  attempted: number
  succeeded: number
  failed: number
  errors: string[]
}

function safeRetryErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message || message.length > 180) return 'ZATCA retry failed. Please open the invoice for details.'
  if (/private[_ -]?key|secret|token|csid|certificate|authorization|csr|xml|signedInvoice/i.test(message)) {
    return 'ZATCA retry failed. Sensitive details were redacted.'
  }
  return message
}

export async function retryFailedSubmissions(tenantId: string, branchId?: string | null): Promise<ZatcaRetrySummary> {
  let query = supabase
    .from('invoices')
    .select('id, branch_id, invoice_number, zatca_status')
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')
    .in('zatca_status', ['failed', 'pending'])
    .order('created_at', { ascending: true })
    .limit(25)

  if (branchId) query = query.eq('branch_id', branchId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const summary: ZatcaRetrySummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  }

  for (const invoice of data ?? []) {
    summary.attempted += 1
    try {
      const ok = await submitInvoiceToZatca(invoice.id, invoice.branch_id, { source: 'bulk_retry' })
      if (ok) summary.succeeded += 1
      else {
        summary.failed += 1
        summary.errors.push(`${invoice.invoice_number}: still pending`)
      }
    } catch (err) {
      summary.failed += 1
      summary.errors.push(`${invoice.invoice_number}: ${safeRetryErrorMessage(err)}`)
    }
  }

  return summary
}
