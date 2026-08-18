import { useState, useEffect } from 'react'
import { Info } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmtMonth,
  SkeletonCard, SkeletonTable, ReportErrorState, SectionHeader,
} from './reportUtils'
import { Rial } from '@/components/ui/RiyalSymbol'
import { asArray, loadReportSummary, reportErrorMessage, reportParams } from './reportingRpc'
import { useTranslation } from 'react-i18next'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthVat {
  month:          string
  grossSales:     number
  creditNotes:    number
  salesAmount:    number
  vatOnSales:     number
  vatCredited:    number
  vatCollected:   number
  purchaseAmount: number
  vatPaidPur:     number
  expenseAmount:  number
  vatPaidExp:     number
  netPayable:     number
}

interface VatData {
  grossSales:     number
  creditNotes:    number
  vatOnSales:     number
  vatCredited:    number
  vatCollected:  number
  vatPaidTotal:  number
  netPayable:    number
  salesTotal:    number
  monthlyRows:   MonthVat[]
}

const EMPTY_VAT_DATA: VatData = {
  grossSales: 0,
  creditNotes: 0,
  vatOnSales: 0,
  vatCredited: 0,
  vatCollected: 0,
  vatPaidTotal: 0,
  netPayable: 0,
  salesTotal: 0,
  monthlyRows: [],
}

function VatKpi({ label, value, sub, primary = false, positive = false, quiet = false }: { label: string; value: React.ReactNode; sub: string; primary?: boolean; positive?: boolean; quiet?: boolean }) {
  return <div className={`min-h-[5.5rem] rounded-xl border px-3 py-2.5 ${primary ? 'border-[#0F2419] bg-[#0F2419] text-[#FFF9E8]' : 'border-[#1B6B3A]/20 bg-[#fffdf7] text-slate-900'}`}><p className={`text-[10px] font-bold uppercase tracking-wide ${primary ? 'text-[#F3D98B]' : 'text-slate-500'}`}>{label}</p><p className={`mt-1 text-base font-black tabular-nums ${primary ? 'text-[#FFF9E8]' : quiet ? 'text-slate-400' : positive ? 'text-[#1B6B3A]' : 'text-[#0F2419]'}`}>{value}</p><p className={`mt-0.5 text-[10px] leading-4 ${primary ? 'text-white/60' : 'text-slate-400'}`}>{sub}</p></div>
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VatReport({ startDate, endDate, branchId }: ReportProps) {
  const { t } = useTranslation('reports')
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<VatData | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
      setLoading(true)
      setError(null)
      try {
        const summary = await loadReportSummary<VatData>(
          'get_vat_support_summary',
          reportParams(startDate, endDate, branchId),
          EMPTY_VAT_DATA,
        )
        if (cancelled) return
        setData({
          ...summary,
          monthlyRows: asArray<MonthVat>(summary.monthlyRows),
        })
      } catch (error) {
        console.error('Unable to load VAT support summary', error)
        if (!cancelled) {
          setData(null)
          setError(t('reports:errors.load'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [startDate, endDate, branchId, profile?.tenant_id])

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-3">{[0,1,2].map(i => <SkeletonCard key={i} />)}</div>
        <SkeletonTable rows={6} />
      </div>
    )
  }

  if (error) return <ReportErrorState message={error} />

  const monthlyRows = data?.monthlyRows ?? []
  const purchaseInputVatTotal = monthlyRows.reduce((sum, row) => sum + row.vatPaidPur, 0)
  const expenseInputVatTotal = monthlyRows.reduce((sum, row) => sum + row.vatPaidExp, 0)

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <VatKpi label={t('metrics.vatSales')} value={<Rial amount={data?.vatOnSales ?? 0} />} sub="VAT before credit notes" primary />
        <VatKpi label={t('metrics.vatCredited')} value={<Rial amount={data?.vatCredited ?? 0} />} sub="VAT reduced by returns" quiet={(data?.vatCredited ?? 0) === 0} />
        <VatKpi label={t('metrics.netVat')} value={<Rial amount={data?.vatCollected ?? 0} />} sub="sales VAT minus credited VAT" positive />
        <VatKpi label={t('metrics.inputVat')} value={<Rial amount={data?.vatPaidTotal ?? 0} />} sub="claimable purchases + expenses" quiet={(data?.vatPaidTotal ?? 0) === 0} />
        <VatKpi label={t('metrics.netVatEstimate')} value={<Rial amount={data?.netPayable ?? 0} />} sub="Output − Input VAT" positive={(data?.netPayable ?? 0) <= 0} />
      </div>

      {/* ── VAT support note ──────────────────────────────────────── */}
      <div className="flex gap-2.5 rounded-xl border border-[#1B6B3A]/20 bg-[#f8fbf7] px-3 py-2.5">
        <Info className="mt-0.5 shrink-0 text-[#1B6B3A]" size={15} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-[#0F2419]">{t('vat.title')}</p>
          <p className="mt-0.5 text-xs leading-4 text-slate-500">
            This report is for business review and VAT support. Final filing should be reviewed by your accountant.
          </p>
        </div>
      </div>

      {/* ── Monthly VAT breakdown table ─────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <SectionHeader title={t('vat.monthly')} />
        </div>
        <div className="overflow-x-auto" tabIndex={0} aria-label={t('vat.monthly')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1B6B3A]/10 bg-[#f8fbf7] text-[9px] font-bold uppercase tracking-wide text-slate-400">
                <th className="sticky left-0 z-10 bg-[#f8fbf7] px-4 py-2 text-left">Month</th><th colSpan={3} className="px-4 py-2 text-left">Sales</th><th colSpan={3} className="px-4 py-2 text-left">Output VAT</th><th colSpan={4} className="px-4 py-2 text-left">Input VAT</th><th className="px-4 py-2 text-left">Support estimate</th>
              </tr>
              <tr className="border-b border-gray-100">
                {[
                  'Month', 'Gross Sales', 'Credit Notes', 'Net Sales', 'VAT on Sales', 'VAT Credited', 'Net VAT',
                  'Purchases', 'Input VAT (Pur.)',
                  'Expenses', 'Input VAT (Exp.)',
                  'Net Payable',
                ].map(h => (
                  <th key={h} className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${h === 'Month' ? 'sticky left-0 z-10 bg-[#fffdf7] text-left text-slate-600' : 'text-right text-slate-500'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map(r => (
                <tr key={r.month} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="sticky left-0 z-10 bg-[#fffdf7] px-4 py-2.5 font-medium text-gray-700 whitespace-nowrap">{fmtMonth(r.month)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.grossSales} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600"><Rial amount={r.creditNotes} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.salesAmount} /></td>
                  <td className="px-4 py-3 tabular-nums text-[#1B6B3A]"><Rial amount={r.vatOnSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={r.vatCredited} /></td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-[#1B6B3A]"><Rial amount={r.vatCollected} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.purchaseAmount} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={r.vatPaidPur} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.expenseAmount} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={r.vatPaidExp} /></td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${r.netPayable > 0 ? 'text-red-600' : r.netPayable < 0 ? 'text-[#1B6B3A]' : 'text-slate-400'}`}>
                    <Rial amount={r.netPayable} />
                  </td>
                </tr>
              ))}
              {/* Totals */}
              {monthlyRows.length > 0 && (
                <tr className="border-t-2 border-[#1B6B3A]/20 bg-[#f8fbf7] font-bold">
                  <td className="px-4 py-3 text-gray-700">{t('common.total')}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={data!.grossSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={data!.creditNotes} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={data!.salesTotal} /></td>
                  <td className="px-4 py-3 tabular-nums text-[#1B6B3A]"><Rial amount={data!.vatOnSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={data!.vatCredited} /></td>
                  <td className="px-4 py-3 tabular-nums text-[#1B6B3A]"><Rial amount={data!.vatCollected} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={purchaseInputVatTotal} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600"><Rial amount={expenseInputVatTotal} /></td>
                  <td className={`px-4 py-3 tabular-nums ${data!.netPayable > 0 ? 'text-red-600' : data!.netPayable < 0 ? 'text-[#1B6B3A]' : 'text-slate-400'}`}>
                    <Rial amount={data!.netPayable} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {monthlyRows.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">{t('vat.empty')}</div>
        )}
      </div>
    </div>
  )
}
