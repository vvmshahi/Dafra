import { resolveBranchDisplayName } from '@/lib/utils/localizedDisplayName.mjs'

export interface RegisterInvoiceRow {
  id: string
  invoiceNumber: string
  customerName: string
  displayTotal: number
  status: string
  invoiceDate: string
  documentType: string
  createdAt: string | null
}

export interface RegisterSessionSummary {
  sessionId: string | null
  branchId: string
  branchName: string
  logoUrl: string | null
  status: 'open' | 'closed' | null
  openedAt: string | null
  closedAt: string | null
  isCurrentSession: boolean
  isLastSession: boolean
  isLongOpen: boolean
  longOpenHours: number | null
  totalSales: number
  invoiceCount: number
  creditNoteTotal: number
  cashTotal: number
  cardTotal: number
  otherTotal: number
  bankTransferTotal: number
  vatTotal: number
  expensesTotal: number
  cashExpenses: number
  expectedCash: number
  actualCash: number | null
  cashDifference: number | null
  openingCash: number
  recentInvoices: RegisterInvoiceRow[]
}

type RpcErrorLike = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

export interface RegisterSessionRpcErrorInfo {
  code: string
  message: string
  details: string
  hint: string
  combined: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

export function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function booleanOr(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeInvoice(value: unknown): RegisterInvoiceRow | null {
  if (!isRecord(value)) return null
  const id = stringOrNull(pick(value, 'id'))
  if (!id) return null
  return {
    id,
    invoiceNumber: stringOrNull(pick(value, 'invoiceNumber', 'invoice_number')) ?? '',
    customerName: stringOrNull(pick(value, 'customerName', 'customer_name')) ?? 'Walk-in Customer',
    displayTotal: numberOrZero(pick(value, 'displayTotal', 'display_total')),
    status: stringOrNull(pick(value, 'status')) ?? 'posted',
    invoiceDate: stringOrNull(pick(value, 'invoiceDate', 'invoice_date')) ?? '',
    documentType: stringOrNull(pick(value, 'documentType', 'document_type')) ?? 'simplified',
    createdAt: stringOrNull(pick(value, 'createdAt', 'created_at')),
  }
}

export function normalizeRegisterSession(value: unknown): RegisterSessionSummary | null {
  if (!isRecord(value)) return null
  const branchId = stringOrNull(pick(value, 'branchId', 'branch_id'))
  if (!branchId) return null
  const status = stringOrNull(pick(value, 'status'))
  const recent = pick(value, 'recentInvoices', 'recent_invoices')
  return {
    sessionId: stringOrNull(pick(value, 'sessionId', 'session_id')),
    branchId,
    branchName: resolveBranchDisplayName(value, false, ''),
    logoUrl: stringOrNull(pick(value, 'logoUrl', 'logo_url')),
    status: status === 'open' || status === 'closed' ? status : null,
    openedAt: stringOrNull(pick(value, 'openedAt', 'opened_at')),
    closedAt: stringOrNull(pick(value, 'closedAt', 'closed_at')),
    isCurrentSession: booleanOr(pick(value, 'isCurrentSession', 'is_current_session')),
    isLastSession: booleanOr(pick(value, 'isLastSession', 'is_last_session')),
    isLongOpen: booleanOr(pick(value, 'isLongOpen', 'is_long_open')),
    longOpenHours: numberOrNull(pick(value, 'longOpenHours', 'long_open_hours')),
    totalSales: numberOrZero(pick(value, 'totalSales', 'total_sales')),
    invoiceCount: Math.trunc(numberOrZero(pick(value, 'invoiceCount', 'invoice_count'))),
    creditNoteTotal: numberOrZero(pick(value, 'creditNoteTotal', 'credit_note_total')),
    cashTotal: numberOrZero(pick(value, 'cashTotal', 'cash_total')),
    cardTotal: numberOrZero(pick(value, 'cardTotal', 'card_total')),
    otherTotal: numberOrZero(pick(value, 'otherTotal', 'other_total')),
    bankTransferTotal: numberOrZero(pick(value, 'bankTransferTotal', 'bank_transfer_total')),
    vatTotal: numberOrZero(pick(value, 'vatTotal', 'vat_total')),
    expensesTotal: numberOrZero(pick(value, 'expensesTotal', 'expenses_total')),
    cashExpenses: numberOrZero(pick(value, 'cashExpenses', 'cash_expenses')),
    expectedCash: numberOrZero(pick(value, 'expectedCash', 'expected_cash')),
    actualCash: numberOrNull(pick(value, 'actualCash', 'actual_cash')),
    cashDifference: numberOrNull(pick(value, 'cashDifference', 'cash_difference')),
    openingCash: numberOrZero(pick(value, 'openingCash', 'opening_cash')),
    recentInvoices: Array.isArray(recent)
      ? recent.map(normalizeInvoice).filter((row): row is RegisterInvoiceRow => !!row)
      : [],
  }
}

export function normalizeRegisterSessionList(value: unknown): RegisterSessionSummary[] {
  if (Array.isArray(value)) {
    return value.map(normalizeRegisterSession).filter((row): row is RegisterSessionSummary => !!row)
  }
  if (!isRecord(value)) return []
  const sessions = pick(value, 'sessions', 'registerSessions', 'register_sessions', 'branchSummaries', 'branch_summaries')
  return Array.isArray(sessions)
    ? sessions.map(normalizeRegisterSession).filter((row): row is RegisterSessionSummary => !!row)
    : []
}

export function registerSessionLabel(session: RegisterSessionSummary | null): string {
  if (!session?.sessionId) return 'No Register Session'
  if (session.status === 'open') return 'Current Register Session'
  return 'Last Register Session'
}

export function registerSessionTimeRange(session: RegisterSessionSummary | null): string {
  if (!session?.openedAt) return 'No register session yet'
  const opened = formatSaudiSessionDateTime(session.openedAt)
  if (session.status === 'open') return `Opened ${opened} -> Still open`
  if (session.closedAt) return `Opened ${opened} -> Closed ${formatSaudiSessionDateTime(session.closedAt)}`
  return `Opened ${opened}`
}

export function formatSaudiSessionDateTime(utcString: string): string {
  return new Date(utcString).toLocaleString('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function registerSessionRpcErrorInfo(error: unknown): RegisterSessionRpcErrorInfo {
  const fields = isRecord(error)
    ? {
        code: typeof (error as RpcErrorLike).code === 'string' ? String((error as RpcErrorLike).code) : '',
        message: typeof (error as RpcErrorLike).message === 'string' ? String((error as RpcErrorLike).message) : '',
        details: typeof (error as RpcErrorLike).details === 'string' ? String((error as RpcErrorLike).details) : '',
        hint: typeof (error as RpcErrorLike).hint === 'string' ? String((error as RpcErrorLike).hint) : '',
      }
    : {
        code: '',
        message: error instanceof Error ? error.message : String(error ?? ''),
        details: '',
        hint: '',
      }
  return {
    ...fields,
    combined: [fields.code, fields.message, fields.details, fields.hint].filter(Boolean).join(' '),
  }
}

export function logRegisterSessionRpcError(functionName: string, params: Record<string, unknown>, error: unknown) {
  const info = registerSessionRpcErrorInfo(error)
  console.error('[registerSessions] RPC failed', {
    functionName,
    params,
    code: info.code || null,
    message: info.message || null,
    details: info.details || null,
    hint: info.hint || null,
    error,
  })
}

export function registerSessionRpcErrorMessage(error: unknown): string {
  const { combined } = registerSessionRpcErrorInfo(error)

  if (/PGRST202|schema cache|could not find the function|function .* not found/i.test(combined)) {
    return 'Register Session RPC is not available in the Supabase REST schema yet. Reload the schema, then refresh.'
  }

  if (/permission|42501|unauthorized|jwt|session/i.test(combined)) {
    return 'Your session permissions could not be verified. Refresh and sign in again if needed.'
  }

  if (/22023|invalid/i.test(combined)) {
    return 'Register session request was invalid. Refresh and try again.'
  }

  return 'Register session data could not be loaded. Please refresh.'
}
