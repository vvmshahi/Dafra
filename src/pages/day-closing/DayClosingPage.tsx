import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CalendarCheck2, Printer, CheckCircle2, AlertTriangle,
  TrendingUp, CreditCard, Banknote, Receipt, FileText,
  Loader2, Lock, ChevronRight, ShoppingBag,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { saudiDateStr } from '@/lib/utils/date'
import { useAuth } from '@/hooks/useAuth'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { Badge } from '@/components/ui/Badge'

const db = () => supabase as any

// ── Types ─────────────────────────────────────────────────────────────────────

interface DaySummary {
  totalSales:    number
  cashSales:     number
  cardSales:     number
  totalVat:      number
  invoiceCount:  number
  totalExpenses: number
  cashExpenses:  number
  cardExpenses:  number
  expectedCash:  number
  expenses:      ExpenseRow[]
}

interface ExpenseRow {
  id: string
  description: string
  vendor_name: string | null
  total_paid: number
  payment_method: string
}

interface PreviousClosing {
  id: string
  closing_date: string
  total_sales: number
  actual_cash: number
  cash_difference: number
  invoice_count: number
  notes: string | null
  created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function today() {
  return saudiDateStr()
}

function invoiceAccountingSign(invoice: { zatca_invoice_type?: string | null }): number {
  return invoice.zatca_invoice_type === 'credit_note' ? -1 : 1
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, amount, sub, icon: Icon, accent = 'green',
}: {
  label: string; amount: number; sub?: string
  icon: React.ElementType; accent?: 'green' | 'gold' | 'blue' | 'red' | 'gray'
}) {
  const colors = {
    green: 'bg-emerald-50 text-emerald-600',
    gold:  'bg-amber-50  text-amber-600',
    blue:  'bg-blue-50   text-blue-600',
    red:   'bg-red-50    text-red-600',
    gray:  'bg-gray-100  text-gray-500',
  }
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[accent]}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-400 font-medium">{label}</p>
        <p className="text-base font-bold text-gray-900 mt-0.5">
          <Rial amount={amount} />
        </p>
        {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Print report (hidden on screen, shown on print) ───────────────────────────

function PrintReport({
  summary, branchName, tenantName, closedByName,
  actualCash, notes, dateStr,
}: {
  summary: DaySummary
  branchName: string
  tenantName: string
  closedByName: string
  actualCash: number
  notes: string
  dateStr: string
}) {
  const diff = actualCash - summary.expectedCash
  const line = '─'.repeat(44)

  const row = (label: string, value: string) => {
    const pad = 44 - label.length - value.length
    return `${label}${' '.repeat(Math.max(1, pad))}${value}`
  }

  return (
    <div id="day-closing-print" className="hidden print:block font-mono text-[11px] text-black p-8 leading-relaxed">
      <pre style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>
{`${line}
         Kubri — DAY CLOSING REPORT
         ${tenantName}
         ${branchName}
         ${dateStr}
${line}
SALES SUMMARY
${row('Total Invoices:', String(summary.invoiceCount))}
${row('Total Sales:', 'SAR ' + fmt(summary.totalSales))}
${row('  Cash Sales:', 'SAR ' + fmt(summary.cashSales))}
${row('  Card Sales:', 'SAR ' + fmt(summary.cardSales))}
${row('VAT Collected:', 'SAR ' + fmt(summary.totalVat))}
${line}
EXPENSES
${row('Cash Expenses:', 'SAR ' + fmt(summary.cashExpenses))}
${row('Card Expenses:', 'SAR ' + fmt(summary.cardExpenses))}
${row('Total Expenses:', 'SAR ' + fmt(summary.totalExpenses))}
${line}
NET SUMMARY
${row('Net Cash in Hand:', 'SAR ' + fmt(summary.expectedCash))}
${row('Actual Cash Count:', 'SAR ' + fmt(actualCash))}
${row('Difference:', (diff >= 0 ? '+' : '') + 'SAR ' + fmt(diff))}
${line}
Closed by: ${closedByName}
Closing time: ${new Date().toLocaleString('en-SA')}
${notes ? `Notes: ${notes}\n` : ''}${line}`}
      </pre>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DayClosingPage() {
  const { profile, user, tenant } = useAuth()
  const printRef = useRef<HTMLDivElement>(null)

  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [summary,     setSummary]     = useState<DaySummary | null>(null)
  const [prevClosings,setPrevClosings]= useState<PreviousClosing[]>([])
  const [todayClosing,setTodayClosing]= useState<PreviousClosing | null>(null)
  const [branchName,  setBranchName]  = useState('')
  const [actualCash,  setActualCash]  = useState('')
  const [notes,       setNotes]       = useState('')
  const [saveMsg,     setSaveMsg]     = useState<string | null>(null)
  const [saveErr,     setSaveErr]     = useState<string | null>(null)

  const branchId = profile?.branch_id
  const tenantId = profile?.tenant_id
  const todayStr = today()
  const displayDate = new Date().toLocaleDateString('en-SA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // ── Load data ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!branchId || !tenantId) { setLoading(false); return }
    setLoading(true)

    const [branchRes, invRes, closingsRes] = await Promise.all([
      db().from('branches').select('name, name_ar').eq('id', branchId).single(),
      db().from('invoices')
        .select('id, total_amount, tax_amount, zatca_invoice_type')
        .eq('branch_id', branchId)
        .eq('invoice_date', todayStr)
        .neq('status', 'cancelled'),
      db().from('day_closings')
        .select('*')
        .eq('branch_id', branchId)
        .order('closing_date', { ascending: false })
        .limit(11),
    ])

    // Branch name
    const b = branchRes.data
    setBranchName(b?.name_ar?.trim() ? b.name_ar : (b?.name ?? ''))

    // Check if already closed today
    const allClosings: PreviousClosing[] = closingsRes.data ?? []
    const todayClose = allClosings.find(c => c.closing_date === todayStr) ?? null
    setTodayClosing(todayClose)
    setPrevClosings(allClosings.filter(c => c.closing_date !== todayStr).slice(0, 10))

    // Today's invoices
    const invoices: any[] = invRes.data ?? []
    const invoiceIds = invoices.map(i => i.id)
    const signByInvoiceId = new Map(
      invoices.map(invoice => [invoice.id, invoiceAccountingSign(invoice)]),
    )
    const totalSales   = invoices.reduce((s, i) => s + invoiceAccountingSign(i) * Number(i.total_amount ?? 0), 0)
    const totalVat     = invoices.reduce((s, i) => s + invoiceAccountingSign(i) * Number(i.tax_amount ?? 0), 0)
    const invoiceCount = invoices.length

    // Payments for today's invoices
    let cashSales = 0, cardSales = 0
    if (invoiceIds.length > 0) {
      const { data: payments } = await db()
        .from('payments')
        .select('invoice_id, method, amount')
        .in('invoice_id', invoiceIds)
      for (const p of payments ?? []) {
        const signedAmount = (signByInvoiceId.get(p.invoice_id) ?? 1) * Number(p.amount ?? 0)
        if (p.method === 'cash') cashSales += signedAmount
        else if (p.method === 'card') cardSales += signedAmount
      }
    }

    // Today's expenses
    const { data: expData } = await db()
      .from('expenses')
      .select('id, description, vendor_name, total_paid, payment_method')
      .eq('branch_id', branchId)
      .eq('expense_date', todayStr)
      .order('created_at', { ascending: false })

    const expenses: ExpenseRow[] = expData ?? []
    const cashExpenses = expenses
      .filter(e => e.payment_method === 'cash')
      .reduce((s, e) => s + Number(e.total_paid ?? 0), 0)
    const cardExpenses = expenses
      .filter(e => e.payment_method !== 'cash')
      .reduce((s, e) => s + Number(e.total_paid ?? 0), 0)
    const totalExpenses = cashExpenses + cardExpenses
    const expectedCash  = cashSales - cashExpenses

    setSummary({
      totalSales, cashSales, cardSales, totalVat, invoiceCount,
      totalExpenses, cashExpenses, cardExpenses, expectedCash, expenses,
    })
    setLoading(false)
  }, [branchId, tenantId, todayStr])

  useEffect(() => { load() }, [load])

  // ── Reconciliation ─────────────────────────────────────────────────────────

  const actualCashNum  = parseFloat(actualCash) || 0
  const difference     = actualCashNum - (summary?.expectedCash ?? 0)
  const isMatch        = Math.abs(difference) < 0.01
  const isShort        = difference < -0.01

  // ── Close day ──────────────────────────────────────────────────────────────

  async function closeDay() {
    if (!summary || !branchId || !tenantId) return
    if (!actualCash) { setSaveErr('Please enter the actual cash counted'); return }
    if (!confirm('Close the day? This records final figures for today.')) return

    setSaving(true)
    setSaveErr(null)

    const payload = {
      tenant_id:      tenantId,
      branch_id:      branchId,
      closing_date:   todayStr,
      total_sales:    summary.totalSales,
      cash_sales:     summary.cashSales,
      card_sales:     summary.cardSales,
      total_vat:      summary.totalVat,
      invoice_count:  summary.invoiceCount,
      total_expenses: summary.totalExpenses,
      cash_expenses:  summary.cashExpenses,
      card_expenses:  summary.cardExpenses,
      expected_cash:  summary.expectedCash,
      actual_cash:    actualCashNum,
      cash_difference:difference,
      notes:          notes.trim() || null,
      closed_by:      user?.id ?? null,
    }

    const { error } = await db().from('day_closings').upsert(payload, { onConflict: 'branch_id,closing_date' })
    setSaving(false)

    if (error) { setSaveErr(error.message); return }
    setSaveMsg('Day closed successfully')
    load()
  }

  // ── Print ──────────────────────────────────────────────────────────────────

  function handlePrint() {
    window.print()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'Unknown'
  const tenantName  = tenant?.name ?? 'Kubri'

  if (!branchId) {
    return (
      <div className="card p-12 text-center">
        <Lock size={32} className="text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-500">No branch assigned</p>
        <p className="text-xs text-gray-400 mt-1">Ask your administrator to assign a branch to your account</p>
      </div>
    )
  }

  return (
    <>
      {/* ── Print report (hidden on screen) ─────────────────────── */}
      {summary && (
        <PrintReport
          summary={summary}
          branchName={branchName}
          tenantName={tenantName}
          closedByName={displayName}
          actualCash={actualCashNum}
          notes={notes}
          dateStr={displayDate}
        />
      )}

      {/* ── Screen content ──────────────────────────────────────── */}
      <div className="space-y-5 print:hidden">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalendarCheck2 size={18} className="text-primary-600" />
              <h2 className="text-base font-semibold text-gray-900">Day Closing</h2>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{displayDate} · {branchName}</p>
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Printer size={14} /> Print Report
          </button>
        </div>

        {/* Already-closed banner */}
        {todayClosing && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
            <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-800">Today is already closed</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Closed at {new Date(todayClosing.created_at).toLocaleTimeString('en-SA', { hour: '2-digit', minute: '2-digit' })} ·
                Actual cash: <Rial amount={todayClosing.actual_cash} /> ·
                Difference: <span className={todayClosing.cash_difference < -0.01 ? 'text-red-600' : 'text-emerald-700'}>
                  {todayClosing.cash_difference >= 0 ? '+' : ''}{sarStr(todayClosing.cash_difference)}
                </span>
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-primary-400" />
          </div>
        ) : !summary ? null : (
          <>
            {/* ── Sales summary ───────────────────────────────────── */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sales Summary</h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                <KpiCard label="Total Sales"      amount={summary.totalSales}   icon={TrendingUp} accent="green"
                  sub={`${summary.invoiceCount} invoice${summary.invoiceCount !== 1 ? 's' : ''}`} />
                <KpiCard label="Cash Sales"       amount={summary.cashSales}    icon={Banknote}   accent="green" />
                <KpiCard label="Card Sales"       amount={summary.cardSales}    icon={CreditCard} accent="blue" />
                <KpiCard label="VAT Collected"    amount={summary.totalVat}     icon={Receipt}    accent="gold" />
                <KpiCard label="Total Invoices"   amount={summary.invoiceCount} icon={FileText}   accent="gray"
                  sub="today" />
              </div>
            </div>

            {/* ── Expenses summary ────────────────────────────────── */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Expenses Today</h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <KpiCard label="Cash Expenses"  amount={summary.cashExpenses}   icon={Banknote}   accent="red" />
                <KpiCard label="Card Expenses"  amount={summary.cardExpenses}   icon={CreditCard} accent="red" />
                <KpiCard label="Total Expenses" amount={summary.totalExpenses}  icon={ShoppingBag}accent="red" />
              </div>
            </div>

            {/* ── Expense list ─────────────────────────────────────── */}
            {summary.expenses.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Expense Detail</h3>
                </div>
                <div className="divide-y divide-gray-50">
                  {summary.expenses.map(e => (
                    <div key={e.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{e.description}</p>
                        {e.vendor_name && <p className="text-xs text-gray-400">{e.vendor_name}</p>}
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={e.payment_method === 'cash' ? 'success' : 'neutral'}>
                          {e.payment_method}
                        </Badge>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums">
                          <Rial amount={e.total_paid} />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Expenses</span>
                  <span className="text-sm font-bold text-gray-900"><Rial amount={summary.totalExpenses} /></span>
                </div>
              </div>
            )}

            {/* ── Cash Reconciliation ──────────────────────────────── */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Banknote size={16} className="text-primary-600" />
                <h3 className="text-sm font-semibold text-gray-900">Cash Reconciliation</h3>
              </div>

              {/* Expected */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-[11px] text-gray-400 font-medium">Expected Cash in Hand</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    <Rial amount={summary.expectedCash} />
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Cash sales − cash expenses</p>
                </div>

                {/* Actual */}
                <div className="space-y-1.5">
                  <label className="label">Actual Cash Counted</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-mono text-sm">ê</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={actualCash}
                      onChange={e => setActualCash(e.target.value)}
                      placeholder="0.00"
                      className="input pl-8 tabular-nums"
                      disabled={!!todayClosing}
                    />
                  </div>
                </div>

                {/* Difference */}
                {actualCash !== '' && (
                  <div className={`rounded-xl px-4 py-3 ${
                    isMatch ? 'bg-emerald-50' : isShort ? 'bg-red-50' : 'bg-amber-50'
                  }`}>
                    <p className="text-[11px] font-medium text-gray-500">Difference</p>
                    <p className={`text-lg font-bold mt-1 ${
                      isMatch ? 'text-emerald-700' : isShort ? 'text-red-600' : 'text-amber-700'
                    }`}>
                      {difference >= 0 ? '+' : ''}<Rial amount={Math.abs(difference)} />
                    </p>
                    <p className={`text-[10px] mt-0.5 ${
                      isMatch ? 'text-emerald-600' : isShort ? 'text-red-500' : 'text-amber-600'
                    }`}>
                      {isMatch ? '✓ Balanced' : isShort ? '↓ Short' : '↑ Over'}
                    </p>
                  </div>
                )}
              </div>

              {/* Notes */}
              {(!isMatch && actualCash !== '') && (
                <div>
                  <label className="label">
                    Notes <span className="text-gray-400">(explain discrepancy)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Reason for cash difference…"
                    className="input h-20 resize-none"
                    disabled={!!todayClosing}
                  />
                </div>
              )}

              {/* Messages */}
              {saveErr && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
                  <AlertTriangle size={13} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700">{saveErr}</p>
                </div>
              )}
              {saveMsg && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                  <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
                  <p className="text-xs text-emerald-700">{saveMsg}</p>
                </div>
              )}

              {/* Actions */}
              {!todayClosing && (
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Printer size={14} /> Print Report
                  </button>
                  <button
                    onClick={closeDay}
                    disabled={saving || !actualCash}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    {saving
                      ? <><Loader2 size={14} className="animate-spin" /> Closing…</>
                      : <><CalendarCheck2 size={14} /> Close Day</>
                    }
                  </button>
                </div>
              )}

              {todayClosing && !saveMsg && (
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors"
                >
                  <Printer size={14} /> Print Closing Report
                </button>
              )}
            </div>

            {/* ── Previous closings ────────────────────────────────── */}
            {prevClosings.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Previous Closings</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-50">
                        {['Date', 'Invoices', 'Total Sales', 'Actual Cash', 'Difference', 'Status'].map(h => (
                          <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {prevClosings.map(c => {
                        const diff = c.cash_difference
                        const balanced = Math.abs(diff) < 0.01
                        return (
                          <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                            <td className="px-5 py-3 text-sm font-medium text-gray-800">
                              {new Date(c.closing_date + 'T00:00:00').toLocaleDateString('en-SA', {
                                weekday: 'short', month: 'short', day: 'numeric',
                              })}
                            </td>
                            <td className="px-5 py-3 text-sm text-gray-600">{c.invoice_count}</td>
                            <td className="px-5 py-3 text-sm font-semibold text-gray-900 tabular-nums">
                              <Rial amount={c.total_sales} />
                            </td>
                            <td className="px-5 py-3 text-sm tabular-nums text-gray-700">
                              <Rial amount={c.actual_cash} />
                            </td>
                            <td className="px-5 py-3 text-sm tabular-nums font-semibold">
                              <span className={balanced ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-amber-600'}>
                                {diff >= 0 ? '+' : ''}{sarStr(diff)}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <Badge variant={balanced ? 'success' : 'warning'} dot>
                                {balanced ? 'Balanced' : diff < 0 ? 'Short' : 'Over'}
                              </Badge>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
