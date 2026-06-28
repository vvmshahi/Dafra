import { supabase } from '@/lib/supabase'

export async function submitInvoiceToZatca(invoiceId: string, branchId: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('zatca-submit', { body: { invoiceId, branchId } })
  if (error) throw new Error(error.message)
  return data?.invoiceStatus !== 'not_submitted'
}

export async function retryFailedSubmissions(_tenantId: string): Promise<void> {}
