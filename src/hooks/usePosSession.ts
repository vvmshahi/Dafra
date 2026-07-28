import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { logRegisterSessionRpcError, normalizeRegisterSession } from '@/lib/registerSessions'

export interface PosSession {
  id: string
  branch_id: string
  tenant_id: string
  opened_by: string | null
  opened_at: string
  opening_cash: number
  status: 'open' | 'closed'
  closed_at: string | null
}

export interface ClosedSessionSummary {
  id: string
  opened_at: string
  closed_at: string
  opening_cash: number
  closing_cash_actual: number
  closing_cash_expected: number
  closing_cash_difference: number
  total_cash_sales: number
  total_card_sales: number
  total_session_sales: number
  total_expenses: number
  cash_expenses: number
  total_refunds: number
  total_invoices: number
  notes: string | null
}

const q = () => supabase as unknown as { from: (t: string) => any }

function posSessionFromRpc(value: unknown): PosSession {
  const summary = normalizeRegisterSession(value)
  if (!summary?.sessionId || !summary.openedAt || !summary.status) {
    throw new Error('Register session RPC returned an invalid session')
  }
  return {
    id: summary.sessionId,
    branch_id: summary.branchId,
    tenant_id: '',
    opened_by: null,
    opened_at: summary.openedAt,
    opening_cash: summary.openingCash,
    status: summary.status,
    closed_at: summary.closedAt,
  }
}

function closedSummaryFromRpc(value: unknown): ClosedSessionSummary {
  const summary = normalizeRegisterSession(value)
  if (!summary?.sessionId || !summary.openedAt || !summary.closedAt) {
    throw new Error('Register close RPC returned an invalid summary')
  }
  return {
    id: summary.sessionId,
    opened_at: summary.openedAt,
    closed_at: summary.closedAt,
    opening_cash: summary.openingCash,
    closing_cash_actual: summary.actualCash ?? 0,
    closing_cash_expected: summary.expectedCash,
    closing_cash_difference: summary.cashDifference ?? 0,
    total_cash_sales: summary.cashTotal,
    total_card_sales: summary.cardTotal,
    total_session_sales: summary.totalSales,
    total_expenses: summary.expensesTotal,
    cash_expenses: summary.cashExpenses,
    total_refunds: summary.creditNoteTotal,
    total_invoices: summary.invoiceCount,
    notes: null,
  }
}

export function usePosSession(
  branchId: string | undefined,
  tenantId: string | undefined,
  userId: string | undefined,
) {
  const [session, setSession] = useState<PosSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown | null>(null)
  const [resolvedBranchId, setResolvedBranchId] = useState<string | null>(null)

  const fetchActiveSession = useCallback(async () => {
    if (!branchId) {
      setSession(null)
      setResolvedBranchId(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setResolvedBranchId(null)
    setError(null)
    try {
      const { data, error: queryError } = await q().from('pos_sessions')
        .select('*')
        .eq('branch_id', branchId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
      if (queryError) {
        console.error('[usePosSession] active session query failed', queryError)
        setSession(null)
        setError(queryError)
        return
      }
      setSession((data ?? [])[0] ?? null)
    } finally {
      setResolvedBranchId(branchId)
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => {
    fetchActiveSession()
  }, [fetchActiveSession])

  const openSession = useCallback(async (openingCash: number): Promise<void> => {
    if (!branchId || !tenantId) return
    const { data, error } = await (supabase as any).rpc('open_register_session', {
      p_branch_id: branchId,
      p_opening_cash: openingCash,
    })
    if (error) {
      logRegisterSessionRpcError('open_register_session', {
        p_branch_id: branchId,
        p_opening_cash: openingCash,
      }, error)
      throw error
    }
    const nextSession = posSessionFromRpc(data)
    setSession({ ...nextSession, tenant_id: tenantId, opened_by: userId ?? null })
  }, [branchId, tenantId, userId])

  const closeSession = useCallback(async ({
    closingCashActual,
    notes,
    closingChecks,
  }: {
    closingCashActual: number
    notes: string
    closingChecks?: Record<string, unknown>
  }): Promise<ClosedSessionSummary> => {
    if (!session) throw new Error('No active session')
    const { data, error } = await (supabase as any).rpc('close_register_session', {
      p_session_id: session.id,
      p_actual_cash: closingCashActual,
      p_closing_checks: closingChecks ?? {},
      p_notes: notes,
    })
    if (error) {
      logRegisterSessionRpcError('close_register_session', {
        p_session_id: session.id,
        p_actual_cash: closingCashActual,
        p_closing_checks: closingChecks ?? {},
        p_notes: notes,
      }, error)
      throw error
    }

    setSession(null)
    return closedSummaryFromRpc(data)
  }, [session])

  return { session, loading, error, resolvedBranchId, openSession, closeSession, fetchActiveSession }
}
