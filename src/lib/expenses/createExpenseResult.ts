export interface CreatedExpenseResult {
  ok: true
  expense_id: string
  expense_before_vat: number
  vat_amount: number
  total_paid: number
  idempotent_replay: boolean
}

/** Validates the only success shape returned by public.create_expense_v1. */
export function isCreatedExpenseResult(value: unknown): value is CreatedExpenseResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>
  return result.ok === true
    && typeof result.expense_id === 'string'
    && result.expense_id.length > 0
    && typeof result.expense_before_vat === 'number'
    && typeof result.vat_amount === 'number'
    && typeof result.total_paid === 'number'
    && typeof result.idempotent_replay === 'boolean'
}
