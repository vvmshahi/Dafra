import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Calendar, Filter, Eye, TrendingUp, FileText, Receipt, RefreshCw, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { InvoiceType, PaymentMethod, ZatcaStatus } from '@/types/database'
import { saudiNow } from '@/lib/utils/date'
import { retryFailedSubmissions } from '@/lib/zatca/submission'
import CreateCreditNoteModal from './CreateCreditNoteModal'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  branchId: string
  invoiceNumber: string
  date: string
  createdAt: string
  customerName: string | null
  itemsCount: number
  subtotal: number
  taxAmount: number
  totalAmount: number
  paymentMethod: string | null
  zatcaStatus: ZatcaStatus
  status: string
  documentType: InvoiceType
  invoiceReference: string | null
  linkedCreditNoteId: string | null
  linkedCreditNoteNumber: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function thisMonth() {
  const now = saudiNow()
  const first = new Date(now); first.setUTCDate(1)
  return {
    start: first.toISOString().split('T')[0],
    end:   now.toISOString().split('T')[0],
  }
}

type QuickRange = 'today' | 'yesterday' | 'this_month' | 'last_month' | 'custom'

function dateInputValue(date: Date) {
  return date.toISOString().split('T')[0]
}

function quickRangeDates(range: Exclude<QuickRange, 'custom'>) {
  const now = saudiNow()
  const today = dateInputValue(now)

  if (range === 'today') {
    return { start: today, end: today }
  }

  if (range === 'yesterday') {
    const yesterday = new Date(now)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const value = dateInputValue(yesterday)
    return { start: value, end: value }
  }

  if (range === 'last_month') {
    const firstOfThisMonth = new Date(now)
    firstOfThisMonth.setUTCDate(1)
    const lastOfPreviousMonth = new Date(firstOfThisMonth)
    lastOfPreviousMonth.setUTCDate(0)
    const firstOfPreviousMonth = new Date(lastOfPreviousMonth)
    firstOfPreviousMonth.setUTCDate(1)
    return {
      start: dateInputValue(firstOfPreviousMonth),
      end: dateInputValue(lastOfPreviousMonth),
    }
  }

  const first = new Date(now)
  first.setUTCDate(1)
  return { start: dateInputValue(first), end: today }
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTime(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const ZATCA_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  not_submitted: { label: 'Not Required', bg: 'bg-blue-50',    text: 'text-blue-600'    },
  pending:       { label: 'Pending',       bg: 'bg-gray-100',   text: 'text-gray-500'    },
  reported:      { label: 'Reported',      bg: 'bg-green-50',   text: 'text-green-700'   },
  cleared:       { label: 'Cleared',       bg: 'bg-emerald-50', text: 'text-emerald-700' },
  failed:        { label: 'Failed',        bg: 'bg-red-50',     text: 'text-red-600'     },
}

const PAY_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  cash:          { label: 'Cash',  bg: 'bg-emerald-50', text: 'text-emerald-700' },
  card:          { label: 'Card',  bg: 'bg-indigo-50',  text: 'text-indigo-700'  },
  split:         { label: 'Split', bg: 'bg-slate-100',  text: 'text-slate-700'   },
  bank_transfer: { label: 'Bank',  bg: 'bg-amber-50',   text: 'text-amber-700'   },
  other:         { label: 'Other', bg: 'bg-gray-50',    text: 'text-gray-600'    },
}

function Badge({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${bg} ${text}`}>
      {label}
    </span>
  )
}

function creditNoteDisabledReason(row: InvoiceRow, role: string | null | undefined): string | null {
  if (row.documentType === 'credit_note') return 'Credit notes cannot be credited in this MVP.'
  if (row.linkedCreditNoteId) return 'This invoice already has a full credit note.'
  if (row.status === 'cancelled') return 'Cancelled invoices cannot be credited here.'
  if (row.status !== 'posted') return 'Only posted invoices can be credited.'
  if (!(row.zatcaStatus === 'reported' || row.zatcaStatus === 'cleared')) return 'Only reported or cleared invoices can be credited.'
  if (role && !['owner', 'admin', 'branch'].includes(role)) return 'You do not have permission to create credit notes.'
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const [rows,    setRows]    = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [retryingZatca, setRetryingZatca] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [creditModalRow, setCreditModalRow] = useState<InvoiceRow | null>(null)

  const { start: defaultStart, end: defaultEnd } = thisMonth()
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate,   setEndDate]   = useState(defaultEnd)
  const [quickRange, setQuickRange] = useState<QuickRange>('this_month')
  const [search,    setSearch]    = useState('')
  const [payFilter, setPayFilter] = useState('all')
  const [zatcaFilter, setZatcaFilter] = useState('all')

  function applyQuickRange(range: QuickRange) {
    setQuickRange(range)
    if (range === 'custom') return

    const next = quickRangeDates(range)
    setStartDate(next.start)
    setEndDate(next.end)
  }

  function updateManualDate(which: 'start' | 'end', value: string) {
    setQuickRange('custom')
    if (which === 'start') {
      setStartDate(value)
      return
    }
    setEndDate(value)
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid) { setLoading(false); return }
      setLoading(true)
      try {
        const { data } = await supabase
          .from('invoices')
          .select(`
            id, branch_id, invoice_number, invoice_reference, zatca_invoice_type, invoice_date, created_at, status,
            subtotal, tax_amount, total_amount, zatca_status,
            customers(name),
            invoice_items(id),
            payments(method)
          `)
          .eq('tenant_id', tid)
          .eq('branch_id', profile?.branch_id)
          .gte('invoice_date', startDate)
          .lte('invoice_date', endDate)
          .order('created_at', { ascending: false })
          .limit(500)

        if (cancelled) return

        const invoices = data ?? []
        const normalInvoiceIds = invoices
          .filter((inv: any) => inv.zatca_invoice_type !== 'credit_note')
          .map((inv: any) => inv.id)

        const creditByOriginal = new Map<string, { id: string; invoice_number: string }>()
        if (normalInvoiceIds.length > 0) {
          const { data: creditNotes } = await supabase
            .from('invoices')
            .select('id, invoice_number, original_invoice_id, created_at')
            .eq('tenant_id', tid)
            .eq('branch_id', profile?.branch_id)
            .in('original_invoice_id', normalInvoiceIds)
            .eq('zatca_invoice_type', 'credit_note')
            .neq('status', 'cancelled')
            .order('created_at', { ascending: false })

          for (const creditNote of creditNotes ?? []) {
            const originalId = (creditNote as any).original_invoice_id
            if (originalId && !creditByOriginal.has(originalId)) {
              creditByOriginal.set(originalId, {
                id: (creditNote as any).id,
                invoice_number: (creditNote as any).invoice_number,
              })
            }
          }
        }

        if (cancelled) return

        const processed: InvoiceRow[] = invoices.map((inv: any) => {
          const linkedCreditNote = creditByOriginal.get(inv.id) ?? null
          const payments = Array.isArray(inv.payments) ? inv.payments : []
          const isSplitPayment = payments.length > 1
            && payments.some((payment: any) => payment.method === 'cash')
            && payments.some((payment: any) => payment.method === 'card')
          return {
          id:            inv.id,
          branchId:      inv.branch_id,
          invoiceNumber: inv.invoice_number,
          date:          inv.invoice_date,
          createdAt:     inv.created_at,
          customerName:  (inv.customers as any)?.name ?? null,
          itemsCount:    Array.isArray(inv.invoice_items) ? inv.invoice_items.length : 0,
          subtotal:      Number(inv.subtotal),
          taxAmount:     Number(inv.tax_amount),
          totalAmount:   Number(inv.total_amount),
          paymentMethod: payments.length > 0
            ? (isSplitPayment ? 'split' : payments[0].method)
            : null,
          zatcaStatus: inv.zatca_status as ZatcaStatus,
          status:      inv.status,
          documentType: inv.zatca_invoice_type as InvoiceType,
          invoiceReference: inv.invoice_reference ?? null,
          linkedCreditNoteId: linkedCreditNote?.id ?? null,
          linkedCreditNoteNumber: linkedCreditNote?.invoice_number ?? null,
        }
        })
        setRows(processed)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [startDate, endDate, profile?.tenant_id, profile?.branch_id, refreshKey])

  // ── Filtered ──────────────────────────────────────────────────────────────

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (q && !r.invoiceNumber.toLowerCase().includes(q) && !(r.customerName ?? '').toLowerCase().includes(q) && !(r.invoiceReference ?? '').toLowerCase().includes(q)) return false
    if (payFilter !== 'all' && r.paymentMethod !== payFilter) return false
    if (zatcaFilter !== 'all' && r.zatcaStatus !== zatcaFilter) return false
    return true
  })

  const summary = {
    count:   filtered.length,
    revenue: filtered.reduce((s, r) => s + (r.documentType === 'credit_note' ? -r.totalAmount : r.totalAmount), 0),
    vat:     filtered.reduce((s, r) => s + (r.documentType === 'credit_note' ? -r.taxAmount : r.taxAmount), 0),
  }
  const retryableZatcaCount = rows.filter(r => r.status !== 'cancelled' && (r.zatcaStatus === 'failed' || r.zatcaStatus === 'pending')).length

  async function handleRetryZatca() {
    const tid = profile?.tenant_id
    if (!tid || retryingZatca) return
    setRetryingZatca(true)
    try {
      const result = await retryFailedSubmissions(tid, profile?.branch_id)
      if (result.attempted === 0) {
        toast.info('No failed or pending ZATCA submissions found.')
      } else if (result.failed === 0) {
        toast.success(`Retried ${result.succeeded} ZATCA submission${result.succeeded !== 1 ? 's' : ''}.`)
      } else {
        toast.warning(`Retried ${result.attempted}. ${result.succeeded} succeeded, ${result.failed} need review.`)
      }
      setRefreshKey(key => key + 1)
    } catch (err: any) {
      toast.error(err?.message ?? 'Unable to retry ZATCA submissions.')
    } finally {
      setRetryingZatca(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">Branch documents</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">فواتير المبيعات · View invoices and credit notes</p>
        </div>
        {retryableZatcaCount > 0 && (
          <button
            type="button"
            onClick={handleRetryZatca}
            disabled={retryingZatca}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Retry failed or pending ZATCA submissions"
          >
            <RefreshCw size={14} className={retryingZatca ? 'animate-spin' : ''} />
            Retry ZATCA ({retryableZatcaCount})
          </button>
        )}
      </div>

      {/* ── Summary bar ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Total Invoices', value: String(summary.count), icon: FileText, color: 'text-primary-700', bg: 'bg-primary-50 ring-primary-100' },
          { label: 'Net Revenue',    value: <Rial amount={summary.revenue} />, icon: TrendingUp, color: 'text-emerald-700', bg: 'bg-emerald-50 ring-emerald-100' },
          { label: 'Net VAT',        value: <Rial amount={summary.vat} />,    icon: Receipt,    color: 'text-amber-700',   bg: 'bg-amber-50 ring-amber-100'   },
        ].map(s => (
          <div key={s.label} className="card px-5 py-4 flex items-center gap-4 border border-gray-100 shadow-sm">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ring-1 ${s.bg}`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-semibold">{s.label}</p>
              <p className="mt-0.5 text-lg font-bold text-gray-950 tabular-nums">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'today', label: 'Today' },
            { key: 'yesterday', label: 'Yesterday' },
            { key: 'this_month', label: 'This month' },
            { key: 'last_month', label: 'Last month' },
            { key: 'custom', label: 'Custom' },
          ].map(option => (
            <button
              key={option.key}
              type="button"
              onClick={() => applyQuickRange(option.key as QuickRange)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                quickRange === option.key
                  ? 'bg-primary-700 text-white shadow-sm'
                  : 'bg-gray-50 text-gray-600 hover:bg-primary-50 hover:text-primary-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(220px,1fr)_auto_auto] lg:items-center">
          {/* Date range */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Calendar size={14} className="text-gray-400" />
            <input type="date" value={startDate} onChange={e => updateManualDate('start', e.target.value)}
              className="input py-1.5 text-xs w-36" />
            <span className="text-gray-300 text-xs">–</span>
            <input type="date" value={endDate} onChange={e => updateManualDate('end', e.target.value)}
              className="input py-1.5 text-xs w-36" />
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice #, reference, or customer..."
              className="input pl-8 py-1.5 text-xs w-full" />
          </div>

          {/* Payment filter */}
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-gray-400" />
            <select value={payFilter} onChange={e => setPayFilter(e.target.value)}
              className="input py-1.5 text-xs pr-7 w-full sm:w-auto">
              <option value="all">All Methods</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="split">Split Payment</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>

          {/* ZATCA filter */}
          <select value={zatcaFilter} onChange={e => setZatcaFilter(e.target.value)}
            className="input py-1.5 text-xs pr-7">
            <option value="all">All ZATCA Status</option>
            <option value="not_submitted">Not Required</option>
            <option value="pending">Pending</option>
            <option value="reported">Reported</option>
            <option value="cleared">Cleared</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">

        {/* Table header */}
        <div className="flex min-w-[980px] gap-2 px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-gray-50/80">
          <div className="w-28">Document #</div>
          <div className="w-24">Date</div>
          <div className="w-16">Time</div>
          <div className="flex-1">Customer</div>
          <div className="w-10 text-right">Lines</div>
          <div className="w-24 text-right">Before VAT</div>
          <div className="w-20 text-right">VAT</div>
          <div className="w-24 text-right font-bold">Total</div>
          <div className="w-16 text-center">Method</div>
          <div className="w-24 text-center">ZATCA</div>
          <div className="w-20" />
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No invoices found for this filter.</p>
            <p className="text-xs text-gray-300 mt-1">Try a different date range or clear filters</p>
          </div>
        ) : (
          <>
            {filtered.map(r => {
              const zatca = ZATCA_BADGE[r.zatcaStatus] ?? ZATCA_BADGE.pending
              const pay   = r.paymentMethod ? (PAY_BADGE[r.paymentMethod] ?? PAY_BADGE.other) : null
              const isCancelled = r.status === 'cancelled'
              const isCreditNote = r.documentType === 'credit_note'
              const creditDisabledReason = creditNoteDisabledReason(r, profile?.role)
              return (
                <div
                  key={r.id}
                  className={`flex min-w-[980px] gap-2 px-4 py-3 border-t border-gray-50 items-center hover:bg-primary-50/30 transition-colors ${isCancelled ? 'opacity-50' : ''}`}
                >
                  <div className="w-28">
                    <span className="text-xs font-bold text-gray-900 font-mono">{r.invoiceNumber}</span>
                    {isCreditNote && (
                      <span className="ml-1 text-[9px] font-semibold text-amber-700 bg-amber-50 px-1 py-0.5 rounded">CN</span>
                    )}
                    {isCancelled && (
                      <span className="ml-1 text-[9px] font-semibold text-red-500 bg-red-50 px-1 py-0.5 rounded">VOID</span>
                    )}
                    {isCreditNote && r.invoiceReference && (
                      <p className="mt-0.5 text-[9px] text-gray-400">for {r.invoiceReference}</p>
                    )}
                    {!isCreditNote && r.linkedCreditNoteNumber && (
                      <p className="mt-0.5 text-[9px] text-amber-600">credited by {r.linkedCreditNoteNumber}</p>
                    )}
                  </div>
                  <div className="w-24 text-xs text-gray-500">{fmtDate(r.date)}</div>
                  <div className="w-16 text-xs text-gray-500 tabular-nums">{fmtTime(r.createdAt)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-800 truncate">{r.customerName ?? 'Walk-in Customer'}</p>
                  </div>
                  <div className="w-10 text-right text-xs text-gray-500 tabular-nums">{r.itemsCount}</div>
                  <div className="w-24 text-right text-xs text-gray-600 tabular-nums">
                    {isCreditNote ? `-${fmt(r.subtotal)}` : fmt(r.subtotal)}
                  </div>
                  <div className="w-20 text-right text-xs text-amber-600 tabular-nums">
                    {isCreditNote ? `-${fmt(r.taxAmount)}` : fmt(r.taxAmount)}
                  </div>
                  <div className="w-24 text-right text-sm font-bold text-gray-900 tabular-nums">
                    {isCreditNote ? (
                      <span className="text-amber-700">- <Rial amount={r.totalAmount} /></span>
                    ) : (
                      <Rial amount={r.totalAmount} />
                    )}
                  </div>
                  <div className="w-16 flex justify-center">
                    {pay ? <Badge {...pay} /> : <span className="text-gray-300 text-xs">—</span>}
                  </div>
                  <div className="w-24 flex justify-center">
                    <Badge {...zatca} />
                  </div>
                  <div className="w-20 flex justify-center gap-1">
                    <button
                      onClick={() => navigate(`/invoices/${r.id}`)}
                      className="p-1.5 rounded-lg hover:bg-primary-50 text-gray-400 hover:text-primary-600 transition-colors"
                      title="View"
                    >
                      <Eye size={14} />
                    </button>
                    {!isCreditNote && (
                      <button
                        type="button"
                        onClick={() => {
                          if (creditDisabledReason) return
                          setCreditModalRow(r)
                        }}
                        disabled={!!creditDisabledReason}
                        title={creditDisabledReason ?? 'Create credit note'}
                        aria-label={creditDisabledReason ?? 'Create credit note'}
                        className="p-1.5 rounded-lg text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Totals row */}
            <div className="flex min-w-[980px] gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200">
              <div className="w-28 text-xs font-semibold text-gray-500">
                {filtered.length} document{filtered.length !== 1 ? 's' : ''}
              </div>
              <div className="w-24" />
              <div className="w-16" />
              <div className="flex-1" />
              <div className="w-10" />
              <div className="w-24 text-right text-xs font-bold text-gray-700 tabular-nums">
                <Rial amount={summary.revenue - summary.vat} />
              </div>
              <div className="w-20 text-right text-xs font-bold text-amber-700 tabular-nums">
                <Rial amount={summary.vat} />
              </div>
              <div className="w-24 text-right text-sm font-bold text-primary-700 tabular-nums">
                <Rial amount={summary.revenue} />
              </div>
              <div className="w-16" />
              <div className="w-24" />
              <div className="w-20" />
            </div>
          </>
        )}
        </div>
      </div>

      <CreateCreditNoteModal
        open={!!creditModalRow}
        invoice={creditModalRow ? {
          id: creditModalRow.id,
          branch_id: creditModalRow.branchId,
          invoice_number: creditModalRow.invoiceNumber,
          total_amount: creditModalRow.totalAmount,
        } : null}
        defaultRefundMethod={(creditModalRow?.paymentMethod === 'split' ? 'other' : (creditModalRow?.paymentMethod ?? 'cash')) as PaymentMethod}
        onClose={() => setCreditModalRow(null)}
        onCreated={() => {
          setCreditModalRow(null)
          setRefreshKey(key => key + 1)
        }}
      />
    </div>
  )
}
