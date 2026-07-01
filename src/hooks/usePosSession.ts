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

    // 1. Fetch invoices linked to this session (exclude cancelled)
    const { data: invData } = await q().from('invoices')
      .select('id, total_amount, tax_amount')
      .eq('session_id', session.id)
      .neq('status', 'cancelled')

    const invoiceIds = (invData ?? []).map((i: any) => i.id)

    // 2. Fetch payments for those invoices
    let paymentsData: any[] = []
    if (invoiceIds.length > 0) {
      const { data: pmtData } = await q().from('payments')
        .select('method, amount')
        .in('invoice_id', invoiceIds)
      paymentsData = pmtData ?? []
    }

    // 3. Fetch expenses for this session
    const { data: expData } = await q().from('expenses')
      .select('total_paid, payment_method')
      .eq('session_id', session.id)

    // 4. Calculate totals
    const cashSales = paymentsData
      .filter((p: any) => p.method === 'cash')
      .reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0)
    const cardSales = paymentsData
      .filter((p: any) => p.method === 'card')
      .reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0)
    const totalExpenses = (expData ?? [])
      .reduce((s: number, e: any) => s + Number(e.total_paid ?? 0), 0)
    const cashExpenses = (expData ?? [])
      .filter((e: any) => e.payment_method === 'cash')
      .reduce((s: number, e: any) => s + Number(e.total_paid ?? 0), 0)
    const totalInvoices = (invData ?? []).length

    // 5. Expected cash = opening + cash sales - cash expenses
    const openingCash = Number(session.opening_cash)
    const closingCashExpected = openingCash + cashSales - cashExpenses
    const closingCashDifference = closingCashActual - closingCashExpected

    // 6. Update session
    const { data, error } = await q().from('pos_sessions').update({
      closed_by:               userId ?? null,
      closed_at:               new Date().toISOString(),
      closing_cash_expected:   closingCashExpected,
      closing_cash_actual:     closingCashActual,
      closing_cash_difference: closingCashDifference,
      total_cash_sales:        cashSales,
      total_card_sales:        cardSales,
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
