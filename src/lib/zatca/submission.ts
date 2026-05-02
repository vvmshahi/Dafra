import { supabase } from '@/lib/supabase'

export async function submitInvoiceToZatca(invoiceId: string): Promise<void> {
  console.log('[ZATCA] submitInvoiceToZatca →', invoiceId)
  const { error } = await supabase.functions.invoke('zatca-submit', {
    body: { invoiceId },
  })
  if (error) console.error('[ZATCA] edge function error:', error.message)
}

export async function retryFailedSubmissions(_tenantId: string): Promise<void> {
  // Retry logic is handled server-side by the edge function scheduler.
}
