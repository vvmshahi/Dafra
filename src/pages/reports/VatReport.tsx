import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  type ReportProps, fmt, fmtMonth, generateMonths,
  StatCard, SkeletonCard, SkeletonTable, SectionHeader,
} from './reportUtils'
import { Rial } from '@/components/ui/RiyalSymbol'
import { creditedInvoiceAmount, positiveInvoiceAmount, signedInvoiceAmount } from './accounting'

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function VatReport({ startDate, endDate, branchId }: ReportProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState<VatData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid || !startDate || !endDate) { setLoading(false); return }
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
            .select('invoice_date, total_amount, tax_amount, zatca_invoice_type')
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

        const grossSales   = invoices.reduce((s: number, i: any)  => s + positiveInvoiceAmount(i, i.total_amount), 0)
        const creditNotes  = invoices.reduce((s: number, i: any)  => s + creditedInvoiceAmount(i, i.total_amount), 0)
        const vatOnSales   = invoices.reduce((s: number, i: any)  => s + positiveInvoiceAmount(i, i.tax_amount), 0)
        const vatCredited  = invoices.reduce((s: number, i: any)  => s + creditedInvoiceAmount(i, i.tax_amount), 0)
        const vatCollected = invoices.reduce((s: number, i: any)  => s + signedInvoiceAmount(i, i.tax_amount), 0)
        const vatPaidPur   = purchases.reduce((s: number, p: any) => s + Number(p.vat_amount), 0)
        const vatPaidExp   = expenses.reduce((s: number, e: any)  => s + Number(e.vat_amount), 0)
        const vatPaidTotal = vatPaidPur + vatPaidExp
        const netPayable   = vatCollected - vatPaidTotal
        const salesTotal   = invoices.reduce((s: number, i: any)  => s + signedInvoiceAmount(i, i.total_amount), 0)

        // Monthly rows
        const months = generateMonths(startDate, endDate)
        const monthlyRows: MonthVat[] = months.map(m => {
          const inv = invoices.filter((i: any)  => (i.invoice_date  as string).startsWith(m))
          const pur = purchases.filter((p: any) => (p.purchase_date as string).startsWith(m))
          const exp = expenses.filter((e: any)  => (e.expense_date  as string).startsWith(m))
          const grossSales = inv.reduce((s: number, i: any) => s + positiveInvoiceAmount(i, i.total_amount), 0)
          const creditNotes = inv.reduce((s: number, i: any) => s + creditedInvoiceAmount(i, i.total_amount), 0)
          const salesAmount = inv.reduce((s: number, i: any) => s + signedInvoiceAmount(i, i.total_amount), 0)
          const vatOnSales = inv.reduce((s: number, i: any) => s + positiveInvoiceAmount(i, i.tax_amount), 0)
          const vatCredited = inv.reduce((s: number, i: any) => s + creditedInvoiceAmount(i, i.tax_amount), 0)
          const vc  = inv.reduce((s: number, i: any) => s + signedInvoiceAmount(i, i.tax_amount),  0)
          const pp  = pur.reduce((s: number, p: any) => s + Number(p.vat_amount),  0)
          const pe  = exp.reduce((s: number, e: any) => s + Number(e.vat_amount),  0)
          return {
            month:          m,
            grossSales,
            creditNotes,
            salesAmount,
            vatOnSales,
            vatCredited,
            vatCollected:   vc,
            purchaseAmount: pur.reduce((s: number, p: any) => s + Number(p.total_amount), 0),
            vatPaidPur:     pp,
            expenseAmount:  exp.reduce((s: number, e: any) => s + Number(e.total_paid),   0),
            vatPaidExp:     pe,
            netPayable:     vc - pp - pe,
          }
        })

        setData({ grossSales, creditNotes, vatOnSales, vatCredited, vatCollected, vatPaidTotal, netPayable, salesTotal, monthlyRows })
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
          label="Input VAT (Paid)"
          value={<Rial amount={data?.vatPaidTotal ?? 0} />}
          sub="VAT paid on purchases + expenses"
          accent="amber"
        />
        <StatCard
          label="Net VAT Payable to ZATCA"
          value={<Rial amount={data?.netPayable ?? 0} />}
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
            <strong><Rial amount={data?.netPayable ?? 0} /></strong> is due to ZATCA for this period.
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
                  'Month', 'Gross Sales', 'Credit Notes', 'Net Sales', 'VAT on Sales', 'VAT Credited', 'Net VAT',
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
              {(data?.monthlyRows ?? []).length > 0 && (
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className="px-4 py-3 text-gray-700">Total</td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={data!.grossSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-700"><Rial amount={data!.creditNotes} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700"><Rial amount={data!.salesTotal} /></td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600"><Rial amount={data!.vatOnSales} /></td>
                  <td className="px-4 py-3 tabular-nums text-amber-700"><Rial amount={data!.vatCredited} /></td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600"><Rial amount={data!.vatCollected} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600"><Rial amount={data!.vatPaidTotal} /></td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">—</td>
                  <td className="px-4 py-3 tabular-nums text-amber-600">—</td>
                  <td className={`px-4 py-3 tabular-nums ${data!.netPayable >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    <Rial amount={data!.netPayable} />
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
