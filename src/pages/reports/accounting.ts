export interface AccountingInvoiceLike {
  zatca_invoice_type?: string | null
}

export function invoiceAccountingSign(invoice: AccountingInvoiceLike): 1 | -1 {
  return invoice.zatca_invoice_type === 'credit_note' ? -1 : 1
}

export function signedInvoiceAmount(invoice: AccountingInvoiceLike, amount: unknown): number {
  return invoiceAccountingSign(invoice) * Number(amount ?? 0)
}

export function positiveInvoiceAmount(invoice: AccountingInvoiceLike, amount: unknown): number {
  return invoiceAccountingSign(invoice) === 1 ? Number(amount ?? 0) : 0
}

export function creditedInvoiceAmount(invoice: AccountingInvoiceLike, amount: unknown): number {
  return invoiceAccountingSign(invoice) === -1 ? Number(amount ?? 0) : 0
}

