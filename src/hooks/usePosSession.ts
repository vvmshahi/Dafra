import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

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
  total_expenses: number
  total_invoices: number
  notes: string | null
}

const q = () => supabase as unknown as { from: (t: string) => any }

export function usePosSession(
  branchId: string | undefined,
  tenantId: string | undefined,
  userId: string | undefined,
) {
  const [session, setSession] = useState<PosSession | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchActiveSession = useCallback(async () => {
    if (!branchId) { setLoading(false); return }
    setLoading(true)
    try {
      const { data } = await q().from('pos_sessions')
        .select('*')
        .eq('branch_id', branchId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
      setSession((data ?? [])[0] ?? null)
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => {
    fetchActiveSession()
  }, [fetchActiveSession])

  const openSession = useCallback(async (openingCash: number): Promise<void> => {
    if (!branchId || !tenantId) return
    const { data, error } = await q().from('pos_sessions').insert({
      branch_id:    branchId,
      tenant_id:    tenantId,
      opened_by:    userId ?? null,
      opening_cash: openingCash,
      status:       'open',
    }).select('*').single()
    if (error) throw error
    setSession(data)
  }, [branchId, tenantId, userId])

  const closeSession = useCallback(async ({
    closingCashActual,
    notes,
  }: {
    closingCashActual: number
    notes: string
  }): Promise<ClosedSessionSummary> => {
    if (!session) throw new Error('No active session')

    const [{ data: invData }, { data: expData }] = await Promise.all([
      q().from('invoices')
        .select('total_amount, payment_method')
        .eq('session_id', session.id),
      q().from('expenses')
        .select('amount')
        .eq('session_id', session.id),
    ])

    const totalCashSales = (invData ?? [])
      .filter((i: any) => i.payment_method === 'cash')
      .reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0)
    const totalCardSales = (invData ?? [])
      .filter((i: any) => i.payment_method === 'card')
      .reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0)
    const totalExpenses = (expData ?? [])
      .reduce((s: number, e: any) => s + Number(e.amount ?? 0), 0)
    const totalInvoices = (invData ?? []).length
    const openingCash = Number(session.opening_cash)
    const closingCashExpected = openingCash + totalCashSales - totalExpenses
    const closingCashDifference = closingCashActual - closingCashExpected

    const { data, error } = await q().from('pos_sessions').update({
      closed_by:               userId ?? null,
      closed_at:               new Date().toISOString(),
      closing_cash_expected:   closingCashExpected,
      closing_cash_actual:     closingCashActual,
      closing_cash_difference: closingCashDifference,
      total_cash_sales:        totalCashSales,
      total_card_sales:        totalCardSales,
      total_expenses:          totalExpenses,
      total_invoices:          totalInvoices,
      notes:                   notes.trim() || null,
      status:                  'closed',
    }).eq('id', session.id).select('*').single()
    if (error) throw error

    setSession(null)
    return data as ClosedSessionSummary
  }, [session, userId])

  return { session, loading, openSession, closeSession, fetchActiveSession }
}
