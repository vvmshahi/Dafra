import { supabase } from '@/lib/supabase'
import { resolveCustomerCreditPaymentSummary, type CustomerCreditPaymentSummary } from './customerCreditPayment'

export async function loadCustomerCreditPaymentSummary(input: {
  invoiceId: string
  totalAmount: number | string
  paymentStatus?: string | null
}): Promise<CustomerCreditPaymentSummary | null> {
  const { data: ledgerEntries, error: ledgerError } = await (supabase as any)
    .from('customer_receivable_entries')
    .select('source_kind, source_id, debit_amount')
    .eq('source_kind', 'invoice')
    .eq('source_id', input.invoiceId)

  if (ledgerError || !ledgerEntries?.length) return null

  const { data: allocations, error: allocationError } = await (supabase as any)
    .from('customer_payment_allocations')
    .select('receipt_id, amount')
    .eq('invoice_id', input.invoiceId)
  if (allocationError) return null

  const receiptIds = [...new Set((allocations ?? []).map((row: any) => row.receipt_id).filter(Boolean))]
  if (receiptIds.length === 0) {
    return resolveCustomerCreditPaymentSummary({
      invoiceId: input.invoiceId,
      totalAmount: input.totalAmount,
      paymentStatus: input.paymentStatus,
      ledgerEntries: ledgerEntries.map((row: any) => ({ sourceKind: row.source_kind, sourceId: row.source_id, debitAmount: row.debit_amount })),
      allocations: [],
      receipts: [],
      tenders: [],
    })
  }

  const [{ data: receipts, error: receiptError }, { data: tenders, error: tenderError }] = await Promise.all([
    (supabase as any).from('customer_payment_receipts').select('id, origin, method').in('id', receiptIds),
    (supabase as any).from('customer_payment_receipt_tenders').select('receipt_id, method').in('receipt_id', receiptIds),
  ])
  if (receiptError || tenderError) return null

  return resolveCustomerCreditPaymentSummary({
    invoiceId: input.invoiceId,
    totalAmount: input.totalAmount,
    paymentStatus: input.paymentStatus,
    ledgerEntries: ledgerEntries.map((row: any) => ({ sourceKind: row.source_kind, sourceId: row.source_id, debitAmount: row.debit_amount })),
    allocations: (allocations ?? []).map((row: any) => ({ receiptId: row.receipt_id, amount: row.amount })),
    receipts: (receipts ?? []).map((row: any) => ({ id: row.id, origin: row.origin, method: row.method })),
    tenders: (tenders ?? []).map((row: any) => ({ receiptId: row.receipt_id, method: row.method })),
  })
}
