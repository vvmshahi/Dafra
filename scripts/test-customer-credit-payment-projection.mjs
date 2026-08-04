import assert from 'node:assert/strict'
import { resolveCustomerCreditPaymentSummary } from '../src/lib/invoices/customerCreditPayment.ts'

const base = {
  invoiceId: 'invoice-1',
  totalAmount: 100,
  ledgerEntries: [{ sourceKind: 'invoice', sourceId: 'invoice-1', debitAmount: 100 }],
}

const unpaid = resolveCustomerCreditPaymentSummary({ ...base, paymentStatus: 'pending', allocations: [], receipts: [], tenders: [] })
assert.deepEqual(unpaid, {
  isCustomerCredit: true,
  paymentStatus: 'unpaid',
  initialPayment: 0,
  initialPaymentMethod: null,
  amountPaid: 0,
  balanceDue: 100,
})

const partial = resolveCustomerCreditPaymentSummary({
  ...base,
  paymentStatus: 'partial',
  allocations: [{ receiptId: 'receipt-1', amount: 25 }],
  receipts: [{ id: 'receipt-1', origin: 'checkout_initial', method: 'cash' }],
  tenders: [{ receiptId: 'receipt-1', method: 'cash' }],
})
assert.equal(partial?.paymentStatus, 'partial')
assert.equal(partial?.initialPayment, 25)
assert.equal(partial?.initialPaymentMethod, 'cash')
assert.equal(partial?.balanceDue, 75)

const settled = resolveCustomerCreditPaymentSummary({
  ...base,
  paymentStatus: 'paid',
  allocations: [{ receiptId: 'receipt-1', amount: 100 }],
  receipts: [{ id: 'receipt-1', origin: 'settlement', method: 'bank_transfer' }],
  tenders: [{ receiptId: 'receipt-1', method: 'bank_transfer' }],
})
assert.equal(settled?.paymentStatus, 'paid')
assert.equal(settled?.amountPaid, 100)
assert.equal(settled?.balanceDue, 0)

const ordinaryOther = resolveCustomerCreditPaymentSummary({
  ...base,
  ledgerEntries: [],
  paymentStatus: 'paid',
  allocations: [],
  receipts: [],
  tenders: [],
})
assert.equal(ordinaryOther, null)

console.log('Customer Credit payment projection checks passed.')
