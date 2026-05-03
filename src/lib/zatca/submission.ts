import { supabase } from '@/lib/supabase'

export async function submitInvoiceToZatca(invoiceId: string, branchId: string): Promise<boolean> {
  const { data: cert } = await (supabase as any)
    .from('zatca_certificates')
    .select('production_csid')
    .eq('branch_id', branchId)
    .eq('status', 'active')
    .maybeSingle()

  if (!cert?.production_csid) return false

  const { error } = await supabase.functions.invoke('zatca-submit', { body: { invoiceId } })
  if (error) throw new Error(error.message)
  return true
}

export async function retryFailedSubmissions(_tenantId: string): Promise<void> {}
