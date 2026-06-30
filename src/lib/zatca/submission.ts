import { supabase } from '@/lib/supabase'

export async function submitInvoiceToZatca(invoiceId: string, branchId: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('zatca-submit', { body: { invoiceId, branchId } })
  if (error) throw new Error(error.message)
  return data?.invoiceStatus === 'reported' || data?.invoiceStatus === 'cleared'
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
      const ok = await submitInvoiceToZatca(invoice.id, invoice.branch_id)
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
