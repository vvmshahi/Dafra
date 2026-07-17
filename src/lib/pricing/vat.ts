import type { VatTreatment } from '@/types'

export type BranchVatMode = 'exclusive' | 'inclusive'
export type EffectiveVatTreatment = Exclude<VatTreatment, 'inherit'>

export interface VatPriceBreakdown {
  enteredPrice: number
  subtotal: number
  vatAmount: number
  customerTotal: number
  effectiveTreatment: EffectiveVatTreatment
}

export const STANDARD_VAT_RATE = 0.15

export function resolveEffectiveVatTreatment(
  treatment: VatTreatment,
  branchMode: BranchVatMode,
): EffectiveVatTreatment {
  return treatment === 'inherit' ? branchMode : treatment
}

// Mirrors public.pos_checkout's positive NUMERIC line calculations:
// inclusive rounds the customer total and extracted subtotal first; exclusive
// rounds the subtotal and VAT separately. The database remains authoritative.
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateVatPriceBreakdown(
  price: number,
  treatment: VatTreatment,
  branchMode: BranchVatMode,
): VatPriceBreakdown | null {
  if (!Number.isFinite(price) || price < 0) return null

  const effectiveTreatment = resolveEffectiveVatTreatment(treatment, branchMode)
  const enteredPrice = roundCurrency(price)

  if (effectiveTreatment === 'inclusive') {
    const customerTotal = enteredPrice
    const subtotal = roundCurrency(customerTotal / (1 + STANDARD_VAT_RATE))
    return {
      enteredPrice,
      subtotal,
      vatAmount: roundCurrency(customerTotal - subtotal),
      customerTotal,
      effectiveTreatment,
    }
  }

  if (effectiveTreatment === 'exclusive') {
    const subtotal = enteredPrice
    const vatAmount = roundCurrency(subtotal * STANDARD_VAT_RATE)
    return {
      enteredPrice,
      subtotal,
      vatAmount,
      customerTotal: roundCurrency(subtotal + vatAmount),
      effectiveTreatment,
    }
  }

  return {
    enteredPrice,
    subtotal: enteredPrice,
    vatAmount: 0,
    customerTotal: enteredPrice,
    effectiveTreatment,
  }
}
