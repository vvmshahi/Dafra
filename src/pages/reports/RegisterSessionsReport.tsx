import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Clock3, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Rial } from '@/components/ui/RiyalSymbol'
import {
  type RegisterSessionSummary,
  normalizeRegisterSessionList,
  registerSessionLabel,
  registerSessionTimeRange,
} from '@/lib/registerSessions'

interface ReportProps {
  branchId: string | null
}

function SessionAmount({ label, amount }: { label: string; amount: number }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-gray-900 tabular-nums"><Rial amount={amount} /></p>
    </div>
  )
}

export default function RegisterSessionsReport({ branchId }: ReportProps) {
  const [sessions, setSessions] = useState<RegisterSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcError } = await (supabase as any).rpc('get_register_sessions', {
        p_branch_id: branchId,
        p_limit: 80,
      })
      if (rpcError) throw rpcError
      setSessions(normalizeRegisterSessionList(data))
    } catch (err) {
      console.error('[RegisterSessionsReport] failed to load register sessions', err)
      setSessions([])
      setError('Register Sessions are unavailable until the Phase 5C-5A SQL patch is applied.')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="card p-10 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-300" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5 flex items-start gap-3">
        <AlertCircle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">Register Sessions could not be loaded</p>
          <p className="mt-1 text-xs text-amber-800">{error}</p>
        </div>
        <button onClick={load} className="text-xs font-semibold text-amber-900 hover:text-amber-700">
          Retry
        </button>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="card p-10 text-center">
        <Clock3 size={28} className="mx-auto mb-3 text-gray-300" />
        <p className="text-sm font-semibold text-gray-700">No Register Sessions yet</p>
        <p className="mt-1 text-xs text-gray-400">Open Register from the POS to start session-wise reporting.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Register Sessions</h2>
          <p className="text-xs text-gray-400 mt-0.5">Operational open-to-close reporting. Date-wise reports remain available in the other tabs.</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {sessions.map(session => {
        const diff = session.cashDifference ?? 0
        return (
          <div key={session.sessionId ?? session.branchId}
            className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gray-900">{registerSessionLabel(session)}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    session.isLongOpen
                      ? 'bg-amber-100 text-amber-700'
                      : session.status === 'open'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {session.isLongOpen ? 'Long open' : session.status === 'open' ? 'Open' : 'Closed'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{session.branchName}</p>
                <p className="mt-1 text-xs text-gray-400">{registerSessionTimeRange(session)}</p>
              </div>
              {session.isLongOpen && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  Close this register before starting a new shift.
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
              <SessionAmount label="Sales" amount={session.totalSales} />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Invoices</p>
                <p className="mt-1 text-sm font-bold text-gray-900 tabular-nums">{session.invoiceCount}</p>
              </div>
              <SessionAmount label="Cash" amount={session.cashTotal} />
              <SessionAmount label="Card" amount={session.cardTotal} />
              <SessionAmount label="VAT" amount={session.vatTotal} />
              <SessionAmount label="Credit notes" amount={session.creditNoteTotal} />
              <SessionAmount label="Expenses" amount={session.expensesTotal} />
              <SessionAmount label="Expected cash" amount={session.expectedCash} />
            </div>

            {session.status === 'closed' && (
              <div className="mt-4 flex flex-wrap gap-3 rounded-xl bg-gray-50 px-3 py-3 text-xs">
                <span className="font-medium text-gray-600">
                  Actual cash: <span className="font-bold text-gray-900"><Rial amount={session.actualCash ?? 0} /></span>
                </span>
                <span className={`font-medium ${Math.abs(diff) < 0.01 ? 'text-gray-600' : diff > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  Difference: <span className="font-bold"><Rial amount={diff} /></span>
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
