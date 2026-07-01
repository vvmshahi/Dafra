import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmtMonth,
  StatCard, SkeletonCard, SkeletonTable, ReportErrorState, SectionHeader,
} from './reportUtils'
import { Rial } from '@/components/ui/RiyalSymbol'
import { asArray, loadReportSummary, reportErrorMessage, reportParams } from './reportingRpc'

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function VatReport({ startDate, endDate, branchId }: ReportProps) {
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
          setError(reportErrorMessage(error))
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
      <div className="flex flex-wrap gap-3">
        <StatCard
          label="VAT on Sales"
          value={<Rial amount={data?.vatOnSales ?? 0} />}
          sub="VAT before credit notes"
          primary
        />
        <StatCard
          label="VAT Credited"
          value={<Rial amount={data?.vatCredited ?? 0} />}
          sub="VAT reduced by returns"
          accent="amber"
        />
        <StatCard
          label="Net VAT on Sales"
          value={<Rial amount={data?.vatCollected ?? 0} />}
          sub="sales VAT minus credited VAT"
          accent="emerald"
        />
        <StatCard
          label="Input VAT Support"
          value={<Rial amount={data?.vatPaidTotal ?? 0} />}
          sub="claimable purchases + expenses"
          accent="amber"
        />
        <StatCard
          label="Net VAT Support Estimate"
          value={<Rial amount={data?.netPayable ?? 0} />}
          sub="Output − Input VAT"
          accent={(data?.netPayable ?? 0) >= 0 ? 'red' : 'emerald'}
        />
      </div>

      {/* ── VAT support note ──────────────────────────────────────── */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex gap-3">
        <div>
          <p className="text-sm font-semibold text-amber-800">VAT Support Report</p>
          <p className="text-xs text-amber-700 mt-0.5">
            This report is for business review and VAT support. Final filing should be reviewed by your accountant.
          </p>
        </div>
      </div>

      {/* ── Monthly VAT breakdown table ─────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <SectionHeader title="Monthly VAT Breakdown" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {[
                  'Month', 'Gross Sales', 'Credit Notes', 'Net Sales', 'VAT on Sales', 'VAT Credited', 'Net VAT',
                  'Purchases', 'Input VAT (Pur.)',
                  'Expenses', 'Input VAT (Exp.)',
                  'Net Payable',
                ].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyRows.map(r => (
                <tr key={r.month} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">{fmtMonth(r.month)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.grossSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-700"><Rial amount={r.creditNotes} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.salesAmount} /></td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600"><Rial amount={r.vatOnSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-700"><Rial amount={r.vatCredited} /></td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600 font-semibold"><Rial amount={r.vatCollected} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.purchaseAmount} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-600"><Rial amount={r.vatPaidPur} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={r.expenseAmount} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-600"><Rial amount={r.vatPaidExp} /></td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${r.netPayable >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    <Rial amount={r.netPayable} />
                  </td>
                </tr>
              ))}
              {/* Totals */}
              {monthlyRows.length > 0 && (
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className="px-4 py-3 text-gray-700">Total</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={data!.grossSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-700"><Rial amount={data!.creditNotes} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={data!.salesTotal} /></td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600"><Rial amount={data!.vatOnSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-700"><Rial amount={data!.vatCredited} /></td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600"><Rial amount={data!.vatCollected} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600"><Rial amount={purchaseInputVatTotal} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600"><Rial amount={expenseInputVatTotal} /></td>
                  <td className={`px-4 py-3 tabular-nums ${data!.netPayable >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    <Rial amount={data!.netPayable} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {monthlyRows.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No VAT data for this period</div>
        )}
      </div>
    </div>
  )
}
