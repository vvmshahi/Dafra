import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ChevronLeft, ChevronRight, Loader2, RefreshCw, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useLocale } from '@/localization/useLocale'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { loadCustomerReceivablesReport } from '@/lib/customers/receivables'
import type { Branch } from '@/types'

const PAGE_SIZE = 50

type ReportData = {
  summary: { totalReceivables: number; customerCredit: number; customerCount: number; paymentsReceived: number; unappliedCredit: number; overdueReceivables: number }
  balances: Array<{ receivableAccountId: string; name: string; nameAr: string | null; balance: number }>
  branchComparison: Array<{ branchId: string; debits: number; credits: number; balance: number }>
  filters: { ownerConsolidated: boolean }
}

function isoDate(offsetDays = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return value.toISOString().slice(0, 10)
}

function asNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeReport(value: any): ReportData {
  return {
    summary: {
      totalReceivables: asNumber(value?.summary?.totalReceivables), customerCredit: asNumber(value?.summary?.customerCredit),
      customerCount: asNumber(value?.summary?.customerCount), paymentsReceived: asNumber(value?.summary?.paymentsReceived),
      unappliedCredit: asNumber(value?.summary?.unappliedCredit), overdueReceivables: asNumber(value?.summary?.overdueReceivables),
    },
    balances: (value?.balances ?? []).map((row: any) => ({
      receivableAccountId: String(row.receivableAccountId), name: String(row.name ?? '—'),
      nameAr: row.nameAr ? String(row.nameAr) : null, balance: asNumber(row.balance),
    })),
    branchComparison: (value?.branchComparison ?? []).map((row: any) => ({
      branchId: String(row.branchId), debits: asNumber(row.debits), credits: asNumber(row.credits), balance: asNumber(row.balance),
    })),
    filters: { ownerConsolidated: Boolean(value?.filters?.ownerConsolidated) },
  }
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: React.ReactNode; tone?: 'slate' | 'amber' | 'emerald' }) {
  const classes = tone === 'amber' ? 'border-amber-100 bg-amber-50 text-amber-950' : tone === 'emerald' ? 'border-emerald-100 bg-emerald-50 text-emerald-950' : 'border-slate-100 bg-slate-50 text-slate-950'
  return <div className={`rounded-2xl border p-4 ${classes}`}><p className="text-xs font-semibold text-current/65">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>
}

export default function CustomerReceivablesReportPage() {
  const { t, i18n } = useTranslation('receivables')
  const { profile } = useAuth()
  const { isRtl } = useLocale()
  const [startDate, setStartDate] = useState(() => isoDate(-30))
  const [endDate, setEndDate] = useState(() => isoDate())
  const [branchId, setBranchId] = useState<string | null>(profile?.role === 'branch' ? profile.branch_id : null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canChooseBranch = ['owner', 'admin', 'accountant'].includes(profile?.role ?? '')

  useEffect(() => {
    if (!profile?.tenant_id) return
    let stale = false
    void supabase.from('branches').select('*').eq('tenant_id', profile.tenant_id).eq('is_active', true).order('name')
      .then(({ data: rows }) => { if (!stale) setBranches((rows ?? []) as unknown as Branch[]) })
    return () => { stale = true }
  }, [profile?.tenant_id])

  useEffect(() => { if (profile?.role === 'branch' && profile.branch_id) setBranchId(profile.branch_id) }, [profile?.branch_id, profile?.role])

  const refresh = async () => {
    if (!startDate || !endDate || startDate > endDate) { setError(t('report.invalidRange')); return }
    setLoading(true)
    setError(null)
    try {
      setData(normalizeReport(await loadCustomerReceivablesReport({ branchId, startDate, endDate, page, pageSize: PAGE_SIZE })))
    } catch (loadError) {
      console.error('Unable to load customer receivables report', loadError)
      setData(null)
      setError(t('report.loadFailed'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [branchId, endDate, page, startDate])

  const branchNames = useMemo(() => new Map(branches.map(branch => [branch.id, isRtl ? branch.name_ar || branch.name : branch.name])), [branches, isRtl])
  const summary = data?.summary
  const canGoNext = (data?.balances.length ?? 0) === PAGE_SIZE

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><BarChart3 size={20} /></span><div><h1 className="text-xl font-bold text-slate-950">{t('report.title')}</h1><p className="mt-0.5 text-sm text-slate-500">{t('report.subtitle')}</p></div></div>
        <Link to="/reports" className="text-sm font-semibold text-primary-700 hover:text-primary-800">{t('report.back')}</Link>
      </header>

      <section className="card grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('report.filters')}>
        <label className="space-y-1 text-xs font-semibold text-slate-700"><span>{t('report.from')}</span><input type="date" className="input w-full" value={startDate} onChange={event => { setStartDate(event.target.value); setPage(1) }} /></label>
        <label className="space-y-1 text-xs font-semibold text-slate-700"><span>{t('report.to')}</span><input type="date" className="input w-full" value={endDate} onChange={event => { setEndDate(event.target.value); setPage(1) }} /></label>
        {canChooseBranch && <label className="space-y-1 text-xs font-semibold text-slate-700"><span>{t('report.branch')}</span><select className="input w-full" value={branchId ?? ''} onChange={event => { setBranchId(event.target.value || null); setPage(1) }}><option value="">{t('report.allBranches')}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{isRtl ? branch.name_ar || branch.name : branch.name}</option>)}</select></label>}
        <div className="flex items-end"><Button variant="secondary" className="w-full" onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}{t('report.refresh')}</Button></div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('report.summary')}>
        <Metric label={t('report.totalReceivables')} value={<Rial amount={summary?.totalReceivables ?? 0} />} tone="amber" />
        <Metric label={t('report.customerCredit')} value={<Rial amount={summary?.customerCredit ?? 0} />} tone="emerald" />
        <Metric label={t('report.overdue')} value={<Rial amount={summary?.overdueReceivables ?? 0} />} tone={(summary?.overdueReceivables ?? 0) > 0 ? 'amber' : 'slate'} />
        <Metric label={t('report.paymentsReceived')} value={<Rial amount={summary?.paymentsReceived ?? 0} />} tone="emerald" />
        <Metric label={t('report.unappliedCredit')} value={<Rial amount={summary?.unappliedCredit ?? 0} />} tone="emerald" />
        <Metric label={t('report.customerCount')} value={(summary?.customerCount ?? 0).toLocaleString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-US')} />
      </section>

      <section className="card overflow-hidden" aria-labelledby="ar-balance-heading">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h2 id="ar-balance-heading" className="font-bold text-slate-950">{t('report.customerBalances')}</h2><p className="text-xs text-slate-500">{data?.filters.ownerConsolidated ? t('report.consolidated') : t('report.branchScoped')}</p></div><WalletCards size={18} className="text-slate-400" /></div>
        {loading ? <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-primary-600" /></div> : data?.balances.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 text-start font-semibold">{t('report.customer')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.balance')}</th></tr></thead><tbody>{data.balances.map(row => <tr key={row.receivableAccountId} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-800">{isRtl ? row.nameAr || row.name : row.name}</td><td className={`px-4 py-3 text-end font-semibold ${row.balance > 0 ? 'text-amber-800' : row.balance < 0 ? 'text-emerald-700' : 'text-slate-600'}`}><Rial amount={Math.abs(row.balance)} /></td></tr>)}</tbody></table></div> : <p className="px-4 py-10 text-center text-sm text-slate-500">{t('report.empty')}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3"><Button size="sm" variant="secondary" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={15} />{t('report.previous')}</Button><Button size="sm" variant="secondary" disabled={loading || !canGoNext} onClick={() => setPage(value => value + 1)}>{t('report.next')}<ChevronRight size={15} /></Button></div>
      </section>

      <section className="card overflow-hidden" aria-labelledby="ar-branches-heading">
        <div className="border-b border-slate-100 px-4 py-3"><h2 id="ar-branches-heading" className="font-bold text-slate-950">{t('report.branchComparison')}</h2></div>
        {data?.branchComparison.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3 text-start font-semibold">{t('report.branch')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.debits')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.credits')}</th><th className="px-4 py-3 text-end font-semibold">{t('report.balance')}</th></tr></thead><tbody>{data.branchComparison.map(row => <tr key={row.branchId} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-800">{branchNames.get(row.branchId) ?? row.branchId}</td><td className="px-4 py-3 text-end"><Rial amount={row.debits} /></td><td className="px-4 py-3 text-end"><Rial amount={row.credits} /></td><td className="px-4 py-3 text-end font-semibold"><Rial amount={row.balance} /></td></tr>)}</tbody></table></div> : <p className="px-4 py-8 text-center text-sm text-slate-500">{t('report.noBranchActivity')}</p>}
      </section>
    </div>
  )
}
