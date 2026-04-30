import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt, fmtMonth, generateMonths,
  StatCard, SkeletonCard, SkeletonTable, SectionHeader,
} from './reportUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthVat {
  month:          string
  salesAmount:    number
  vatCollected:   number
  purchaseAmount: number
  vatPaidPur:     number
  expenseAmount:  number
  vatPaidExp:     number
  netPayable:     number
}

interface VatData {
  vatCollected:  number
  vatPaidTotal:  number
  netPayable:    number
  salesTotal:    number
  monthlyRows:   MonthVat[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VatReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<VatData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) return
      setLoading(true)
      try {
        const [
          { data: invData },
          { data: purData },
          { data: expData },
        ] = await Promise.all([
          // Output VAT from sales
          (branchId
            ? supabase.from('invoices').eq('branch_id', branchId)
            : supabase.from('invoices').eq('tenant_id', tid))
            .select('invoice_date, total_amount, tax_amount')
            .neq('status', 'cancelled')
            .gte('invoice_date', startDate)
            .lte('invoice_date', endDate),

          // Input VAT from purchases
          (branchId
            ? supabase.from('purchases').eq('branch_id', branchId)
            : supabase.from('purchases').eq('tenant_id', tid))
            .select('purchase_date, total_amount, vat_amount')
            .gte('purchase_date', startDate)
            .lte('purchase_date', endDate),

          // Input VAT from expenses
          (branchId
            ? supabase.from('expenses').eq('branch_id', branchId)
            : supabase.from('expenses').eq('tenant_id', tid))
            .select('expense_date, total_paid, vat_amount, vat_treatment')
            .gte('expense_date', startDate)
            .lte('expense_date', endDate)
            .neq('vat_treatment', 'no_vat'),
        ])

        if (cancelled) return

        const invoices  = (invData ?? []) as any[]
        const purchases = (purData ?? []) as any[]
        const expenses  = (expData ?? []) as any[]

        const vatCollected = invoices.reduce((s: number, i: any)  => s + Number(i.tax_amount), 0)
        const vatPaidPur   = purchases.reduce((s: number, p: any) => s + Number(p.vat_amount), 0)
        const vatPaidExp   = expenses.reduce((s: number, e: any)  => s + Number(e.vat_amount), 0)
        const vatPaidTotal = vatPaidPur + vatPaidExp
        const netPayable   = vatCollected - vatPaidTotal
        const salesTotal   = invoices.reduce((s: number, i: any)  => s + Number(i.total_amount), 0)

        // Monthly rows
        const months = generateMonths(startDate, endDate)
        const monthlyRows: MonthVat[] = months.map(m => {
          const inv = invoices.filter((i: any)  => (i.invoice_date  as string).startsWith(m))
          const pur = purchases.filter((p: any) => (p.purchase_date as string).startsWith(m))
          const exp = expenses.filter((e: any)  => (e.expense_date  as string).startsWith(m))
          const vc  = inv.reduce((s: number, i: any) => s + Number(i.tax_amount),  0)
          const pp  = pur.reduce((s: number, p: any) => s + Number(p.vat_amount),  0)
          const pe  = exp.reduce((s: number, e: any) => s + Number(e.vat_amount),  0)
          return {
            month:          m,
            salesAmount:    inv.reduce((s: number, i: any) => s + Number(i.total_amount), 0),
            vatCollected:   vc,
            purchaseAmount: pur.reduce((s: number, p: any) => s + Number(p.total_amount), 0),
            vatPaidPur:     pp,
            expenseAmount:  exp.reduce((s: number, e: any) => s + Number(e.total_paid),   0),
            vatPaidExp:     pe,
            netPayable:     vc - pp - pe,
          }
        })

        setData({ vatCollected, vatPaidTotal, netPayable, salesTotal, monthlyRows })
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

  return (
    <div className="space-y-5">

      {/* ── Summary cards ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          label="Output VAT (Collected)"
          value={`SAR ${fmt(data?.vatCollected ?? 0)}`}
          sub="VAT charged on sales"
          primary
        />
        <StatCard
          label="Input VAT (Paid)"
          value={`SAR ${fmt(data?.vatPaidTotal ?? 0)}`}
          sub="VAT paid on purchases + expenses"
          accent="amber"
        />
        <StatCard
          label="Net VAT Payable to ZATCA"
          value={`SAR ${fmt(data?.netPayable ?? 0)}`}
          sub="Output − Input VAT"
          accent={(data?.netPayable ?? 0) >= 0 ? 'red' : 'emerald'}
        />
      </div>

      {/* ── ZATCA note ──────────────────────────────────────── */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex gap-3">
        <div className="text-lg">🏛️</div>
        <div>
          <p className="text-sm font-semibold text-amber-800">ZATCA Quarterly Filing</p>
          <p className="text-xs text-amber-700 mt-0.5">
            VAT returns are typically filed quarterly. Net VAT payable of{' '}
            <strong>SAR {fmt(data?.netPayable ?? 0)}</strong> is due to ZATCA for this period.
            Consult your accountant before filing.
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
                  'Month', 'Sales', 'VAT Collected',
                  'Purchases', 'VAT Paid (Pur.)',
                  'Expenses', 'VAT Paid (Exp.)',
                  'Net Payable',
                ].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.monthlyRows ?? []).map(r => (
                <tr key={r.month} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">{fmtMonth(r.month)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">SAR {fmt(r.salesAmount)}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600 font-semibold">SAR {fmt(r.vatCollected)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">SAR {fmt(r.purchaseAmount)}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600">SAR {fmt(r.vatPaidPur)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">SAR {fmt(r.expenseAmount)}</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600">SAR {fmt(r.vatPaidExp)}</td>
                  <td className={`px-4 py-3 tabular-nums font-bold ${r.netPayable >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    SAR {fmt(r.netPayable)}
                  </td>
                </tr>
              ))}
              {/* Totals */}
              {(data?.monthlyRows ?? []).length > 0 && (
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className="px-4 py-3 text-gray-700">Total</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">SAR {fmt(data!.salesTotal)}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600">SAR {fmt(data!.vatCollected)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600">SAR {fmt(data!.vatPaidTotal)}</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600">—</td>
                  <td className={`px-4 py-3 tabular-nums ${data!.netPayable >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    SAR {fmt(data!.netPayable)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(data?.monthlyRows ?? []).length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No VAT data for this period</div>
        )}
      </div>
    </div>
  )
}
