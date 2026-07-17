import type { ExpenseVatClaimStatus, VatExpenseTreatment } from '@/types'

export type SimpleExpenseVatChoice = 'not_claimable' | 'claimable'

export const SIMPLE_EXPENSE_VAT_OPTIONS: {
  value: SimpleExpenseVatChoice
  label: string
  desc: string
}[] = [
  {
    value: 'not_claimable',
    label: 'No VAT / Not claimable',
    desc: 'Paid amount is fully expensed',
  },
  {
    value: 'claimable',
    label: 'VAT claimable',
    desc: 'Record the supplier tax-invoice details',
  },
]

function roundMoney(value: number) {
  return Number(value.toFixed(2))
}

export function isValidSaudiVatNumber(value: string) {
  return /^\d{15}$/.test(value)
}

export function expenseVatConsistency(
  totalPaidInput: number,
  expenseBeforeVatInput: number,
  vatAmountInput: number,
) {
  const totalPaid = roundMoney(totalPaidInput)
  const expenseBeforeVat = roundMoney(expenseBeforeVatInput)
  const vatAmount = roundMoney(vatAmountInput)
  const difference = roundMoney(expenseBeforeVat + vatAmount - totalPaid)
  const expectedVat = roundMoney(expenseBeforeVat * 0.15)

  return {
    consistent: Math.abs(difference) <= 0.02,
    difference,
    unusualRate: expenseBeforeVat > 0 && Math.abs(vatAmount - expectedVat) > 0.02,
  }
}

export function resolveExpenseVatChoice(
  claimStatus: ExpenseVatClaimStatus | string | null | undefined,
  treatment: VatExpenseTreatment | string | null | undefined,
  vatAmount: number | null | undefined,
): SimpleExpenseVatChoice {
  if (claimStatus === 'claimable') return 'claimable'
  if (!claimStatus && treatment === 'included' && Number(vatAmount ?? 0) > 0) {
    return 'claimable'
  }
  return 'not_claimable'
}

export function calculateExpenseVat(totalPaidInput: number, choice: SimpleExpenseVatChoice) {
  const totalPaid = roundMoney(totalPaidInput)

  if (choice === 'claimable') {
    const vatAmount = roundMoney((totalPaid * 15) / 115)
    return {
      amount: roundMoney(totalPaid - vatAmount),
      expenseBeforeVat: roundMoney(totalPaid - vatAmount),
      vatTreatment: 'included' as VatExpenseTreatment,
      vatClaimStatus: 'claimable' as ExpenseVatClaimStatus,
      vatAmount,
      totalPaid,
    }
  }

  return {
    amount: totalPaid,
    expenseBeforeVat: totalPaid,
    vatTreatment: 'no_vat' as VatExpenseTreatment,
    vatClaimStatus: 'not_claimable' as ExpenseVatClaimStatus,
    vatAmount: 0,
    totalPaid,
  }
}

export function effectiveExpenseVatClaimStatus(
  claimStatus: ExpenseVatClaimStatus | string | null | undefined,
  treatment: VatExpenseTreatment | string | null | undefined,
  vatAmount: number | null | undefined,
): ExpenseVatClaimStatus {
  if (
    claimStatus === 'claimable'
    || claimStatus === 'not_claimable'
    || claimStatus === 'no_vat'
    || claimStatus === 'needs_review'
  ) {
    return claimStatus
  }

  if (treatment && treatment !== 'no_vat' && Number(vatAmount ?? 0) > 0) {
    return 'needs_review'
  }

  return 'no_vat'
}
