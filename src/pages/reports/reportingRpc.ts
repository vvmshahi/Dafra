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

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
