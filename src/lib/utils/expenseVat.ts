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
    desc: '15% VAT included in paid amount',
  },
]

function roundMoney(value: number) {
  return Number(value.toFixed(2))
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
