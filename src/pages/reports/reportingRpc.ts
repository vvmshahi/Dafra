import { supabase } from '@/lib/supabase'

export function reportParams(startDate: string, endDate: string, branchId: string | null) {
  return {
    p_start_date: startDate,
    p_end_date: endDate,
    p_branch_id: branchId,
  }
}

export async function loadReportSummary<T extends object>(
  functionName: string,
  params: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  const { data, error } = await (supabase as any).rpc(functionName, params)
  if (error) throw error
  return { ...fallback, ...(data ?? {}) } as T
}

export function reportErrorMessage(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : error instanceof Error
    ? error.message
    : ''

  if (/unauthorized|permission|42501|jwt|session/i.test(message)) {
    return 'Your session or report permissions could not be verified. Refresh the page or sign in again. If it continues, contact support.'
  }

  if (/function|schema cache|could not find/i.test(message)) {
    return 'The reporting update may not be applied yet. Apply the SQL patch, then refresh the app.'
  }

  return 'Please refresh and try again. If this continues, contact support with the report name, branch, and date range.'
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
