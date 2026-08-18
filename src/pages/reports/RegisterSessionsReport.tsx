import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, Clock3, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Rial } from '@/components/ui/RiyalSymbol'
import { type RegisterSessionSummary, logRegisterSessionRpcError, normalizeRegisterSessionList, registerSessionRpcErrorMessage, registerSessionLabel, registerSessionTimeRange } from '@/lib/registerSessions'
import { useTranslation } from 'react-i18next'

interface ReportProps { branchId: string | null; startDate: string; endDate: string }

function SessionAmount({ label, amount, emphasis = false, quiet = false }: { label: string; amount: number; emphasis?: boolean; quiet?: boolean }) {
  return <div className={emphasis ? 'rounded-lg border border-[#B5943E]/30 bg-[#fffdf5] px-2.5 py-1.5' : ''}><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`${emphasis ? 'mt-0.5 text-base text-[#0F2419]' : 'mt-0.5 text-sm text-slate-900'} font-black tabular-nums ${quiet && amount === 0 ? 'text-slate-400' : ''}`}><Rial amount={amount} /></p></div>
}

function MetricZone({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-[#fffdf9] p-2.5"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#1B6B3A]">{title}</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">{children}</div></section>
}

function SessionDetails({ session }: { session: RegisterSessionSummary }) {
  const { t } = useTranslation('reports')
  const grossSales = session.totalSales + session.creditNoteTotal
  const diff = session.cashDifference ?? 0
  return <><div className="grid gap-2 border-t border-slate-100 px-3 py-2.5 md:grid-cols-3">
    <MetricZone title={t('sessions.salesZone')}><SessionAmount label={t('sessions.grossSales')} amount={grossSales} quiet /><SessionAmount label={t('sessions.creditNotes')} amount={session.creditNoteTotal} quiet /><SessionAmount label={t('sessions.netSales')} amount={session.totalSales} emphasis /><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('metrics.invoices')}</p><p className="mt-0.5 text-sm font-black tabular-nums text-slate-900">{session.invoiceCount}</p></div></MetricZone>
    <MetricZone title={t('sessions.tendersZone')}><SessionAmount label={t('sessions.cash')} amount={session.cashTotal} quiet /><SessionAmount label={t('sessions.card')} amount={session.cardTotal} quiet /><SessionAmount label={t('sessions.bankTransfer')} amount={session.bankTransferTotal} quiet /><SessionAmount label={t('sessions.other')} amount={session.otherTotal} quiet /></MetricZone>
    <MetricZone title={t('sessions.taxCashZone')}><SessionAmount label={t('sessions.netVat')} amount={session.vatTotal} quiet /><SessionAmount label={t('sessions.expenses')} amount={session.expensesTotal} quiet /><SessionAmount label={t('sessions.expectedCash')} amount={session.expectedCash} emphasis /></MetricZone>
  </div>
  {session.status === 'closed' && <footer className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs"><span className="text-slate-500">{t('sessions.actualCash')} <strong className="ms-1 font-black tabular-nums text-slate-900"><Rial amount={session.actualCash ?? 0} /></strong></span><span className={Math.abs(diff) < 0.01 ? 'text-slate-500' : diff > 0 ? 'text-[#1B6B3A]' : 'text-red-700'}>{t('sessions.difference')} <strong className="ms-1 font-black tabular-nums"><Rial amount={diff} /></strong></span></footer>}</>
}

function SummaryMetric({ label, value, emphasis = false, quiet = false }: { label: string; value: React.ReactNode; emphasis?: boolean; quiet?: boolean }) {
  return <div className={emphasis ? 'rounded-md bg-[#fffdf5] px-2 py-1.5' : ''}><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`${emphasis ? 'text-[#0F2419]' : 'text-slate-900'} mt-0.5 text-xs font-black tabular-nums ${quiet ? 'text-slate-400' : ''}`}>{value}</p></div>
}

function SessionCard({ session, expanded, onToggle }: { session: RegisterSessionSummary; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation('reports')
  const isOpen = session.status === 'open'
  const current = isOpen || session.isCurrentSession
  const diff = session.cashDifference ?? 0
  const cardId = `session-details-${session.sessionId ?? session.branchId}`
  if (current) return <article className="relative overflow-hidden rounded-xl border border-[#B5943E]/55 bg-white shadow-sm"><span className="absolute inset-x-0 top-0 h-1 bg-[#0F2419]" aria-hidden="true" /><div className="flex flex-wrap items-start justify-between gap-3 px-3 pb-2.5 pt-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-black text-slate-950">{registerSessionLabel(session)}</h3><span className="rounded-full bg-[#e8f3e9] px-2 py-0.5 text-[10px] font-bold text-[#1B6B3A]">{t('status.open')}</span>{session.isLongOpen && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">{t('sessions.longOpen')}</span>}</div><p className="mt-0.5 truncate text-xs font-medium text-slate-600">{session.branchName}</p><p className="mt-0.5 text-[11px] text-slate-400">{registerSessionTimeRange(session)}</p></div><p className="rounded-lg border border-[#B5943E]/35 bg-[#fffdf5] px-2.5 py-1 text-[11px] font-semibold text-[#0F2419]">{t('sessions.stillOpen')}</p></div><SessionDetails session={session} /></article>

  return <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="grid gap-3 p-3 lg:grid-cols-[minmax(12rem,1.25fr)_minmax(0,2.6fr)_minmax(11rem,1fr)] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-black text-slate-950">{registerSessionLabel(session)}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{t('status.closed')}</span></div><p className="mt-1 truncate text-xs font-medium text-slate-600">{session.branchName}</p><p className="mt-0.5 text-[11px] text-slate-400">{registerSessionTimeRange(session)}</p></div><div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-5"><SummaryMetric label={t('sessions.netSales')} value={<Rial amount={session.totalSales} />} emphasis /><SummaryMetric label={t('metrics.invoices')} value={session.invoiceCount} /><SummaryMetric label={t('sessions.cash')} value={<Rial amount={session.cashTotal} />} quiet={session.cashTotal === 0} /><SummaryMetric label={t('sessions.card')} value={<Rial amount={session.cardTotal} />} quiet={session.cardTotal === 0} /><SummaryMetric label={t('sessions.netVat')} value={<Rial amount={session.vatTotal} />} quiet={session.vatTotal === 0} /></div><div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 lg:border-s lg:border-t-0 lg:ps-3 lg:pt-0"><div className="grid gap-1"><SummaryMetric label={t('sessions.expectedCash')} value={<Rial amount={session.expectedCash} />} emphasis /><SummaryMetric label={t('sessions.difference')} value={<Rial amount={diff} />} quiet={Math.abs(diff) < 0.01} /></div><button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={cardId} className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-bold text-[#1B6B3A] hover:bg-[#eff6ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A]"><ChevronDown className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} size={15} />{t(expanded ? 'sessions.hideDetails' : 'sessions.viewDetails')}</button></div></div>{expanded && <div id={cardId}><SessionDetails session={session} /></div>}</article>
}

export default function RegisterSessionsReport({ branchId, startDate, endDate }: ReportProps) {
  const { t } = useTranslation('reports')
  const [sessions, setSessions] = useState<RegisterSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(() => new Set())
  const load = useCallback(async () => {
    setLoading(true); setError('')
    const params = { ...(branchId ? { p_branch_id: branchId } : {}), p_limit: 80, p_start_date: startDate, p_end_date: endDate }
    try { const { data, error: rpcError } = await (supabase as any).rpc('get_register_sessions_filtered', { ...params }); if (rpcError) throw rpcError; setSessions(normalizeRegisterSessionList(data)); setExpandedSessions(new Set()) }
    catch (err) { logRegisterSessionRpcError('get_register_sessions_filtered', params, err); setSessions([]); setError(registerSessionRpcErrorMessage(err)) }
    finally { setLoading(false) }
  }, [branchId, startDate, endDate])
  useEffect(() => { load() }, [load])
  const toggleSession = (sessionKey: string) => setExpandedSessions(current => { const next = new Set(current); next.has(sessionKey) ? next.delete(sessionKey) : next.add(sessionKey); return next })
  if (loading) return <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-[#fffdf7] p-10"><Loader2 size={24} className="animate-spin text-slate-300" /></div>
  if (error) return <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5"><AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600" /><div className="flex-1"><p className="text-sm font-semibold text-amber-900">{t('sessions.loadFailed')}</p><p className="mt-1 text-xs text-amber-800">{error}</p></div><button onClick={load} className="text-xs font-semibold text-amber-900 hover:text-amber-700">{t('sessions.retry')}</button></div>
  if (sessions.length === 0) return <div className="rounded-xl border border-slate-200 bg-[#fffdf7] p-10 text-center"><Clock3 size={28} className="mx-auto mb-3 text-slate-300" /><p className="text-sm font-semibold text-slate-700">{t('sessions.empty')}</p><p className="mt-1 text-xs text-slate-400">{t('sessions.emptyHint')}</p></div>
  return <div className="space-y-3"><div className="flex items-center justify-between gap-3 px-1"><div><h2 className="text-sm font-black text-slate-950">{t('sessions.title')}</h2><p className="mt-0.5 text-xs text-slate-500">{t('sessions.subtitle')}</p></div><button onClick={load} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-[#fffdf7] px-3 text-xs font-semibold text-slate-700 hover:border-[#B5943E]/60 hover:bg-white"><RefreshCw size={13} />{t('sessions.refresh')}</button></div><div className="space-y-2">{sessions.map(session => { const key = session.sessionId ?? session.branchId; return <SessionCard key={key} session={session} expanded={expandedSessions.has(key)} onToggle={() => toggleSession(key)} /> })}</div></div>
}
