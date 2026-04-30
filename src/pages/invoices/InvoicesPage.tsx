import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Calendar, Filter, Eye, TrendingUp, FileText, Receipt } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { ZatcaStatus } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function thisMonth() {
  const now = new Date()
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    end:   now.toISOString().slice(0, 10),
  }
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const [rows,    setRows]    = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)

  const { start: defaultStart, end: defaultEnd } = thisMonth()
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate,   setEndDate]   = useState(defaultEnd)
  const [search,    setSearch]    = useState('')
  const [payFilter, setPayFilter] = useState('all')
  const [zatcaFilter, setZatcaFilter] = useState('all')

  // ── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function load() {
      const tid = profile?.tenant_id
      if (!tid) return
      setLoading(true)
      try {
        const { data } = await supabase
          .from('invoices')
          .select(`
            id, invoice_number, invoice_date, created_at, status,
            subtotal, tax_amount, total_amount, zatca_status,
            customers(name),
            invoice_items(id),
            payments(method)
          `)
          .eq('tenant_id', tid)
          .gte('invoice_date', startDate)
          .lte('invoice_date', endDate)
          .order('created_at', { ascending: false })
          .limit(500)

        if (cancelled) return

        const processed: InvoiceRow[] = (data ?? []).map((inv: any) => ({
          id:            inv.id,
          invoiceNumber: inv.invoice_number,
          date:          inv.invoice_date,
          createdAt:     inv.created_at,
          customerName:  (inv.customers as any)?.name ?? null,
          itemsCount:    Array.isArray(inv.invoice_items) ? inv.invoice_items.length : 0,
          subtotal:      Number(inv.subtotal),
          taxAmount:     Number(inv.tax_amount),
          totalAmount:   Number(inv.total_amount),
          paymentMethod: Array.isArray(inv.payments) && inv.payments.length > 0
            ? inv.payments[0].method
            : null,
          zatcaStatus: inv.zatca_status as ZatcaStatus,
          status:      inv.status,
        }))
        setRows(processed)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [startDate, endDate, profile?.tenant_id])

  // ── Filtered ──────────────────────────────────────────────────────────────

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (q && !r.invoiceNumber.toLowerCase().includes(q) && !(r.customerName ?? '').toLowerCase().includes(q)) return false
    if (payFilter !== 'all' && r.paymentMethod !== payFilter) return false
    if (zatcaFilter !== 'all' && r.zatcaStatus !== zatcaFilter) return false
    return true
  })

  const summary = {
    count:   filtered.length,
    revenue: filtered.reduce((s, r) => s + r.totalAmount, 0),
    vat:     filtered.reduce((s, r) => s + r.taxAmount, 0),
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-400 mt-0.5">فواتير المبيعات · View and manage issued invoices</p>
        </div>
      </div>

      {/* ── Summary bar ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Invoices', value: String(summary.count), icon: FileText, color: 'text-primary-600', bg: 'bg-primary-50' },
          { label: 'Total Revenue',  value: `SAR ${fmt(summary.revenue)}`, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'VAT Collected',  value: `SAR ${fmt(summary.vat)}`,    icon: Receipt,    color: 'text-amber-600',   bg: 'bg-amber-50'   },
        ].map(s => (
          <div key={s.label} className="card px-5 py-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">{s.label}</p>
              <p className="text-lg font-bold text-gray-900">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────── */}
      <div className="card px-4 py-3 flex flex-wrap items-center gap-3">

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <Calendar size={14} className="text-gray-400" />
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="input py-1.5 text-xs w-36" />
          <span className="text-gray-300 text-xs">–</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="input py-1.5 text-xs w-36" />
        </div>

        <div className="h-5 w-px bg-gray-100" />

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search invoice # or customer…"
            className="input pl-8 py-1.5 text-xs w-full" />
        </div>

        <div className="h-5 w-px bg-gray-100" />

        {/* Payment filter */}
        <div className="flex items-center gap-1.5">
          <Filter size={13} className="text-gray-400" />
          <select value={payFilter} onChange={e => setPayFilter(e.target.value)}
            className="input py-1.5 text-xs pr-7">
            <option value="all">All Methods</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
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

      {/* ── Table ───────────────────────────────────────── */}
      <div className="card overflow-hidden">

        {/* Table header */}
        <div className="flex gap-2 px-4 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
          <div className="w-28">Invoice #</div>
          <div className="w-24">Date</div>
          <div className="flex-1">Customer</div>
          <div className="w-10 text-right">Items</div>
          <div className="w-24 text-right">Subtotal</div>
          <div className="w-20 text-right">VAT</div>
          <div className="w-24 text-right font-bold">Total</div>
          <div className="w-16 text-center">Method</div>
          <div className="w-24 text-center">ZATCA</div>
          <div className="w-10" />
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No invoices found</p>
            <p className="text-xs text-gray-300 mt-1">Try a different date range or clear filters</p>
          </div>
        ) : (
          <>
            {filtered.map(r => {
              const zatca = ZATCA_BADGE[r.zatcaStatus] ?? ZATCA_BADGE.pending
              const pay   = r.paymentMethod ? (PAY_BADGE[r.paymentMethod] ?? PAY_BADGE.other) : null
              const isCancelled = r.status === 'cancelled'
              return (
                <div
                  key={r.id}
                  className={`flex gap-2 px-4 py-3 border-t border-gray-50 items-center hover:bg-gray-50/60 transition-colors ${isCancelled ? 'opacity-50' : ''}`}
                >
                  <div className="w-28">
                    <span className="text-xs font-bold text-gray-900 font-mono">{r.invoiceNumber}</span>
                    {isCancelled && (
                      <span className="ml-1 text-[9px] font-semibold text-red-500 bg-red-50 px-1 py-0.5 rounded">VOID</span>
                    )}
                  </div>
                  <div className="w-24 text-xs text-gray-500">{fmtDate(r.date)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-800 truncate">{r.customerName ?? 'Walk-in Customer'}</p>
                  </div>
                  <div className="w-10 text-right text-xs text-gray-500 tabular-nums">{r.itemsCount}</div>
                  <div className="w-24 text-right text-xs text-gray-600 tabular-nums">
                    {fmt(r.subtotal)}
                  </div>
                  <div className="w-20 text-right text-xs text-amber-600 tabular-nums">
                    {fmt(r.taxAmount)}
                  </div>
                  <div className="w-24 text-right text-sm font-bold text-gray-900 tabular-nums">
                    SAR {fmt(r.totalAmount)}
                  </div>
                  <div className="w-16 flex justify-center">
                    {pay ? <Badge {...pay} /> : <span className="text-gray-300 text-xs">—</span>}
                  </div>
                  <div className="w-24 flex justify-center">
                    <Badge {...zatca} />
                  </div>
                  <div className="w-10 flex justify-center">
                    <button
                      onClick={() => navigate(`/invoices/${r.id}`)}
                      className="p-1.5 rounded-lg hover:bg-primary-50 text-gray-400 hover:text-primary-600 transition-colors"
                    >
                      <Eye size={14} />
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Totals row */}
            <div className="flex gap-2 px-4 py-3 bg-gray-50 border-t border-gray-200">
              <div className="w-28 text-xs font-semibold text-gray-500">
                {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
              </div>
              <div className="w-24" />
              <div className="flex-1" />
              <div className="w-10" />
              <div className="w-24 text-right text-xs font-bold text-gray-700 tabular-nums">
                SAR {fmt(summary.revenue - summary.vat)}
              </div>
              <div className="w-20 text-right text-xs font-bold text-amber-700 tabular-nums">
                SAR {fmt(summary.vat)}
              </div>
              <div className="w-24 text-right text-sm font-bold text-primary-700 tabular-nums">
                SAR {fmt(summary.revenue)}
              </div>
              <div className="w-16" />
              <div className="w-24" />
              <div className="w-10" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
