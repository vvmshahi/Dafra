import { supabase } from '@/lib/supabase'

type RpcErrorLike = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

export function reportParams(startDate: string, endDate: string, branchId: string | null) {
  return {
    p_start_date: startDate,
    p_end_date: endDate,
    p_branch_id: branchId,
  }
}

function errorFields(error: unknown): { code: string; message: string; details: string; hint: string } {
  if (typeof error === 'object' && error !== null) {
    const rpcError = error as RpcErrorLike
    return {
      code: typeof rpcError.code === 'string' ? rpcError.code : '',
      message: typeof rpcError.message === 'string' ? rpcError.message : '',
      details: typeof rpcError.details === 'string' ? rpcError.details : '',
      hint: typeof rpcError.hint === 'string' ? rpcError.hint : '',
    }
  }

  return {
    code: '',
    message: error instanceof Error ? error.message : String(error ?? ''),
    details: '',
    hint: '',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function logReportRpcError(functionName: string, params: Record<string, unknown>, error: unknown) {
  const fields = errorFields(error)
  console.error('[reportingRpc] RPC failed', {
    functionName,
    params,
    code: fields.code || null,
    message: fields.message || null,
    details: fields.details || null,
    hint: fields.hint || null,
    error,
  })
}

export async function loadReportSummary<T extends object>(
  functionName: string,
  params: Record<string, unknown>,
  fallback: T,
): Promise<T> {
  const { data, error } = await (supabase as any).rpc(functionName, params)
  if (error) {
    logReportRpcError(functionName, params, error)
    throw error
  }

  if (data == null) return { ...fallback } as T

  if (!isRecord(data)) {
    const parseError = Object.assign(
      new Error('Reporting RPC returned an unexpected response shape'),
      {
        code: 'REPORT_PARSE_ERROR',
        details: `Expected ${functionName} to return a JSON object.`,
      },
    )
    logReportRpcError(functionName, params, parseError)
    throw parseError
  }

  return { ...fallback, ...(data ?? {}) } as T
}

export function reportErrorMessage(error: unknown): string {
  const { code, message, details, hint } = errorFields(error)
  const combined = [code, message, details, hint].filter(Boolean).join(' ')

  if (/unauthorized|permission|42501|jwt|session/i.test(combined)) {
    return 'Your session or report permissions could not be verified. Refresh the page or sign in again. If it continues, contact support.'
  }

  if (/PGRST202|PGRST204|schema cache|could not find the function|function .* not found/i.test(combined)) {
    return 'The reporting RPC signature is not available yet. Apply the latest SQL patch, reload the Supabase REST schema, then refresh the app.'
  }

  if (/REPORT_PARSE_ERROR|unexpected response shape/i.test(combined)) {
    return 'Report data came back in an unexpected format. Refresh and try again, then contact support if it continues.'
  }

  if (/22023|invalid report date range|invalid dashboard date range/i.test(combined)) {
    return 'Choose a valid date range and try again.'
  }

  return 'Please refresh and try again. If this continues, contact support with the report name, branch, and date range.'
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
