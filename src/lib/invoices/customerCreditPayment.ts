export type CustomerCreditPaymentStatus = 'unpaid' | 'partial' | 'paid'

export interface CustomerCreditPaymentSummary {
  readonly isCustomerCredit: boolean
  readonly paymentStatus: CustomerCreditPaymentStatus
  readonly initialPayment: number
  readonly initialPaymentMethod: string | null
  readonly amountPaid: number
  readonly balanceDue: number
}

export interface CustomerCreditLedgerEntry { readonly sourceKind?: string | null; readonly sourceId?: string | null; readonly debitAmount?: number | string | null }
export interface CustomerCreditOperation { readonly action?: string | null; readonly invoiceId?: string | null }
export interface CustomerCreditAllocation { readonly receiptId?: string | null; readonly amount?: number | string | null }
export interface CustomerCreditReceipt { readonly id: string; readonly origin?: string | null; readonly method?: string | null }
export interface CustomerCreditTender { readonly receiptId?: string | null; readonly method?: string | null }

const numberValue = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export function resolveCustomerCreditPaymentSummary(input: {
  invoiceId: string
  totalAmount: number | string
  paymentStatus?: string | null
  creditOperations: readonly CustomerCreditOperation[]
  ledgerEntries: readonly CustomerCreditLedgerEntry[]
  allocations: readonly CustomerCreditAllocation[]
  receipts: readonly CustomerCreditReceipt[]
  tenders: readonly CustomerCreditTender[]
}): CustomerCreditPaymentSummary | null {
  const isCustomerCredit = input.creditOperations.some(operation => operation.action === 'credit_checkout' && operation.invoiceId === input.invoiceId)
  if (!isCustomerCredit) return null
  const receiptById = new Map(input.receipts.map(receipt => [receipt.id, receipt]))
  const initialReceiptIds = new Set(input.receipts.filter(receipt => receipt.origin === 'checkout_initial').map(receipt => receipt.id))
  const amountPaid = roundMoney(input.allocations.reduce((sum, allocation) => sum + numberValue(allocation.amount), 0))
  const initialPayment = roundMoney(input.allocations.filter(allocation => allocation.receiptId && initialReceiptIds.has(allocation.receiptId)).reduce((sum, allocation) => sum + numberValue(allocation.amount), 0))
  const total = roundMoney(numberValue(input.totalAmount))
  const balanceDue = roundMoney(Math.max(total - amountPaid, 0))
  const paymentStatus: CustomerCreditPaymentStatus = balanceDue <= 0.005 || input.paymentStatus === 'paid'
    ? 'paid'
    : initialPayment > 0.005 || input.paymentStatus === 'partial' ? 'partial' : 'unpaid'
  const initialTenders = input.tenders.filter(tender => tender.receiptId && initialReceiptIds.has(tender.receiptId)).map(tender => tender.method).filter((method): method is string => !!method)
  const receiptMethods = [...initialReceiptIds].map(id => receiptById.get(id)?.method).filter((method): method is string => !!method)
  const methods = [...new Set([...initialTenders, ...receiptMethods])]
  return { isCustomerCredit, paymentStatus, initialPayment, initialPaymentMethod: methods.length > 1 ? 'split' : methods[0] ?? null, amountPaid, balanceDue }
}
