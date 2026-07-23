import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Calendar, Filter, Eye, TrendingUp, FileText, Receipt, RefreshCw, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { InvoiceType, PaymentMethod, ZatcaStatus } from '@/types/database'
import { saudiDateStr, saudiNow } from '@/lib/utils/date'
import { retryFailedSubmissions } from '@/lib/zatca/submission'
import { isPermanentDemoSandboxBranch } from '@/lib/zatca/submission'
import { getSandboxValidationStatuses } from '@/lib/zatca/api'
import CreateCreditNoteModal, { type CreditNoteCreatedResult } from './CreateCreditNoteModal'
import {
  INVOICE_LIST_STALE_MS,
  getCachedInvoiceRows,
  invoiceListViewKey,
  setCachedInvoiceRows,
  subscribeInvoiceListCache,
  updateCachedInvoiceRows,
  upsertInvoiceListRow,
  type InvoiceListRow,
  type InvoiceListScope,
} from '@/lib/invoices/invoiceListCache'

// ── Types ─────────────────────────────────────────────────────────────────────

type InvoiceRow = InvoiceListRow

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  sandbox_validated: { label: 'Submitted', bg: 'bg-green-50', text: 'text-green-700' },
  sandbox_validated_with_warnings: { label: 'Submitted with warnings', bg: 'bg-amber-50', text: 'text-amber-700' },
  sandbox_validation_pending: { label: 'Pending', bg: 'bg-gray-100', text: 'text-gray-500' },
  sandbox_validation_rejected: { label: 'Rejected', bg: 'bg-red-50', text: 'text-red-700' },
  sandbox_validation_failed: { label: 'Failed', bg: 'bg-red-50', text: 'text-red-600' },
  sandbox_not_validated: { label: 'Not submitted', bg: 'bg-gray-100', text: 'text-gray-600' },
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

function creditNoteDisabledReason(row: InvoiceRow, role: string | null | undefined, t: TFunction): string | null {
  if (row.documentType === 'credit_note') return t('invoices:creditNotesCannotBeCredited')
  if (row.status === 'cancelled') return t('invoices:cancelledCannotCredit')
  if (row.status !== 'posted') return t('invoices:postedOnly')
  const submitted = row.displayZatcaStatus === 'sandbox_validated' ||
    row.displayZatcaStatus === 'sandbox_validated_with_warnings' ||
    row.zatcaStatus === 'reported' || row.zatcaStatus === 'cleared'
  if (!submitted) return row.displayZatcaStatus.startsWith('sandbox_')
    ? t('invoices:submitBeforeCredit')
    : t('invoices:reportedOnly')
  if (role && !['owner', 'admin', 'branch'].includes(role)) return t('validation:creditPermissionDenied')
  if (row.creditStatus === 'full' || row.remainingRefundableQuantity <= 0) return t('invoices:fullyCreditedReason')
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { t } = useTranslation(['invoices', 'creditNotes', 'payments', 'validation', 'common'])
  const { profile } = useAuth()
  const navigate    = useNavigate()

  const [rows,    setRows]    = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryingZatca, setRetryingZatca] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [creditModalRow, setCreditModalRow] = useState<InvoiceRow | null>(null)

  const { start: defaultStart, end: defaultEnd } = quickRangeDates('today')
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate,   setEndDate]   = useState(defaultEnd)
  const [quickRange, setQuickRange] = useState<QuickRange>('today')
  const [search,    setSearch]    = useState('')
  const [payFilter, setPayFilter] = useState('all')
  const [zatcaFilter, setZatcaFilter] = useState('all')
  const pageSize = 100
  const scope = useMemo<InvoiceListScope | null>(() => profile?.tenant_id && profile?.branch_id ? ({
    tenantId: profile.tenant_id,
    branchId: profile.branch_id,
    startDate,
    endDate,
    page: 0,
    pageSize,
  }) : null, [profile?.tenant_id, profile?.branch_id, startDate, endDate])

  const viewKey = scope
    ? invoiceListViewKey(scope, { search, paymentMethod: payFilter, zatcaStatus: zatcaFilter })
    : 'invoice-list-unscoped'

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
    const activeScope = scope
    if (!activeScope) { setRows([]); setLoading(false); return }

    const cached = getCachedInvoiceRows(activeScope)
    if (cached) {
      setRows(cached.rows)
      setLoading(false)
    } else {
      setRows([])
      setLoading(true)
    }

    async function load(silent = false) {
      const tid = activeScope.tenantId
      if (silent || cached) setRefreshing(true)
      else setLoading(true)
      setLoadError(null)
      try {
        const { data, error: invoiceError } = await supabase
          .from('invoices')
          .select(`
            id, branch_id, invoice_number, invoice_reference, zatca_invoice_type, invoice_date, created_at, status,
            subtotal, tax_amount, total_amount, zatca_status,
            customers(name),
            invoice_items(id, quantity),
            payments(method)
          `)
          .eq('tenant_id', tid)
          .eq('branch_id', activeScope.branchId)
          .gte('invoice_date', activeScope.startDate)
          .lte('invoice_date', activeScope.endDate)
          .order('created_at', { ascending: false })
          .range(0, activeScope.pageSize - 1)
        if (invoiceError) throw invoiceError

        if (cancelled) return

        const invoices = data ?? []
        const demoSandbox = isPermanentDemoSandboxBranch(tid, activeScope.branchId)
        const sandboxAttempts = demoSandbox
          ? await getSandboxValidationStatuses(invoices.map((invoice: any) => invoice.id)).catch(() => ({}))
          : {}
        const normalInvoiceIds = invoices
          .filter((inv: any) => inv.zatca_invoice_type !== 'credit_note')
          .map((inv: any) => inv.id)

        const creditByOriginal = new Map<string, { id: string; invoice_number: string; count: number }>()
        const creditedQuantityByOriginalItem = new Map<string, number>()
        if (normalInvoiceIds.length > 0) {
          const { data: creditNotes } = await supabase
            .from('invoices')
            .select('id, invoice_number, original_invoice_id, created_at')
            .eq('tenant_id', tid)
            .eq('branch_id', activeScope.branchId)
            .in('original_invoice_id', normalInvoiceIds)
            .eq('zatca_invoice_type', 'credit_note')
            .neq('status', 'cancelled')
            .order('created_at', { ascending: false })

          for (const creditNote of creditNotes ?? []) {
            const originalId = (creditNote as any).original_invoice_id
            if (!originalId) continue
            const existing = creditByOriginal.get(originalId)
            if (existing) {
              creditByOriginal.set(originalId, { ...existing, count: existing.count + 1 })
            } else {
              creditByOriginal.set(originalId, {
                id: (creditNote as any).id,
                invoice_number: (creditNote as any).invoice_number,
                count: 1,
              })
            }
          }

          const creditNoteIds = (creditNotes ?? []).map((creditNote: any) => creditNote.id).filter(Boolean)
          if (creditNoteIds.length > 0) {
            const { data: creditItems } = await supabase
              .from('invoice_items')
              .select('original_invoice_item_id, quantity')
              .in('invoice_id', creditNoteIds)
              .not('original_invoice_item_id', 'is', null)

            for (const item of creditItems ?? []) {
              const originalItemId = (item as any).original_invoice_item_id
              if (!originalItemId) continue
              const credited = Number((item as any).quantity ?? 0)
              creditedQuantityByOriginalItem.set(
                originalItemId,
                (creditedQuantityByOriginalItem.get(originalItemId) ?? 0) + credited,
              )
            }
          }
        }

        if (cancelled) return

        const processed: InvoiceRow[] = invoices.map((inv: any) => {
          const linkedCreditNote = creditByOriginal.get(inv.id) ?? null
          const payments = Array.isArray(inv.payments) ? inv.payments : []
          const invoiceItems = Array.isArray(inv.invoice_items) ? inv.invoice_items : []
          let originalQuantityTotal = 0
          let remainingRefundableQuantity = 0
          for (const item of invoiceItems) {
            const originalQuantity = Number((item as any).quantity ?? 0)
            const creditedQuantity = creditedQuantityByOriginalItem.get((item as any).id) ?? 0
            originalQuantityTotal += originalQuantity
            remainingRefundableQuantity += Math.max(originalQuantity - creditedQuantity, 0)
          }
          const creditStatus: InvoiceRow['creditStatus'] = inv.zatca_invoice_type === 'credit_note' || !linkedCreditNote
            ? 'none'
            : invoiceItems.length > 0 && remainingRefundableQuantity <= 0.0005
            ? 'full'
            : invoiceItems.length === 0
            ? 'full'
            : 'partial'
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
          itemsCount:    invoiceItems.length,
          subtotal:      Number(inv.subtotal),
          taxAmount:     Number(inv.tax_amount),
          totalAmount:   Number(inv.total_amount),
          paymentMethod: payments.length > 0
            ? (isSplitPayment ? 'split' : payments[0].method)
            : null,
          zatcaStatus: inv.zatca_status as ZatcaStatus,
          displayZatcaStatus: demoSandbox
            ? (sandboxAttempts[inv.id]?.status ?? 'sandbox_not_validated')
            : inv.zatca_status as ZatcaStatus,
          status:      inv.status,
          documentType: inv.zatca_invoice_type as InvoiceType,
          invoiceReference: inv.invoice_reference ?? null,
          linkedCreditNoteId: linkedCreditNote?.id ?? null,
          linkedCreditNoteNumber: linkedCreditNote?.invoice_number ?? null,
          creditNoteCount: linkedCreditNote?.count ?? 0,
          creditStatus,
          remainingRefundableQuantity: originalQuantityTotal > 0 ? remainingRefundableQuantity : 0,
        }
        })
        setRows(processed)
        setCachedInvoiceRows(activeScope, processed)
      } catch (error) {
        console.error('Failed to load invoices:', error)
        if (!cancelled) setLoadError(t('invoices:loadFailed'))
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false) }
      }
    }
    const stale = !cached || Date.now() - cached.updatedAt >= INVOICE_LIST_STALE_MS
    if (stale || refreshKey > 0) void load(Boolean(cached))

    const unsubscribe = subscribeInvoiceListCache(() => {
      if (cancelled) return
      const next = getCachedInvoiceRows(activeScope)
      if (next) setRows(next.rows)
    })
    const refreshOnFocus = () => { if (!cancelled) void load(true) }
    window.addEventListener('focus', refreshOnFocus)
    window.addEventListener('online', refreshOnFocus)
    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('focus', refreshOnFocus)
      window.removeEventListener('online', refreshOnFocus)
    }
  }, [scope, refreshKey])

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q && !r.invoiceNumber.toLowerCase().includes(q) && !(r.customerName ?? '').toLowerCase().includes(q) && !(r.invoiceReference ?? '').toLowerCase().includes(q)) return false
      if (payFilter !== 'all' && r.paymentMethod !== payFilter) return false
      if (zatcaFilter !== 'all' && r.displayZatcaStatus !== zatcaFilter) return false
      return true
    })
  }, [rows, viewKey, search, payFilter, zatcaFilter])

  const summary = {
    count:   filtered.length,
    revenue: filtered.reduce((s, r) => s + (r.documentType === 'credit_note' ? -r.totalAmount : r.totalAmount), 0),
    vat:     filtered.reduce((s, r) => s + (r.documentType === 'credit_note' ? -r.taxAmount : r.taxAmount), 0),
  }
  const demoSandbox = isPermanentDemoSandboxBranch(profile?.tenant_id, profile?.branch_id)
  const retryableZatcaCount = demoSandbox ? 0 : rows.filter(r => r.status !== 'cancelled' && (r.zatcaStatus === 'failed' || r.zatcaStatus === 'pending')).length

  async function handleRetryZatca() {
    const tid = profile?.tenant_id
    if (!tid || retryingZatca) return
    setRetryingZatca(true)
    try {
      const result = await retryFailedSubmissions(tid, profile?.branch_id)
      if (result.attempted === 0) {
        toast.info(t('invoices:noRetryableSubmissions'))
      } else if (result.failed === 0) {
        toast.success(t('invoices:retrySucceeded', { count: result.succeeded }))
      } else {
        toast.warning(t('invoices:retrySummary', result))
      }
      setRefreshKey(key => key + 1)
    } catch (err: any) {
      console.error('Failed to retry ZATCA submissions:', err)
      toast.error(t('invoices:retryFailed'))
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-600">{t('invoices:branchDocuments')}</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">{t('invoices:title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('invoices:subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
        {refreshing && rows.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400" aria-live="polite">
            <RefreshCw size={12} className="animate-spin" /> {t('invoices:updating')}
          </span>
        )}
        {retryableZatcaCount > 0 && (
          <button
            type="button"
            onClick={handleRetryZatca}
            disabled={retryingZatca}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
            title={t('invoices:retryTitle')}
          >
            <RefreshCw size={14} className={retryingZatca ? 'animate-spin' : ''} />
            {t('invoices:retryZatca', { count: retryableZatcaCount })}
          </button>
        )}
        </div>
      </div>

      {/* ── Summary bar ─────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: t('invoices:totalInvoices'), value: String(summary.count), icon: FileText, color: 'text-primary-700', bg: 'bg-primary-50 ring-primary-100' },
          { label: t('invoices:netRevenue'),    value: <Rial amount={summary.revenue} />, icon: TrendingUp, color: 'text-emerald-700', bg: 'bg-emerald-50 ring-emerald-100' },
          { label: t('invoices:netVat'),        value: <Rial amount={summary.vat} />,    icon: Receipt,    color: 'text-amber-700',   bg: 'bg-amber-50 ring-amber-100'   },
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
            { key: 'today', label: t('invoices:today') },
            { key: 'yesterday', label: t('invoices:yesterday') },
            { key: 'this_month', label: t('invoices:thisMonth') },
            { key: 'last_month', label: t('invoices:lastMonth') },
            { key: 'custom', label: t('invoices:custom') },
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
              placeholder={t('invoices:searchPlaceholder')}
              className="input pl-8 py-1.5 text-xs w-full" />
          </div>

          {/* Payment filter */}
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-gray-400" />
            <select value={payFilter} onChange={e => setPayFilter(e.target.value)}
              className="input py-1.5 text-xs pr-7 w-full sm:w-auto">
              <option value="all">{t('invoices:allMethods')}</option>
              <option value="cash">{t('payments:cash')}</option>
              <option value="card">{t('payments:card')}</option>
              <option value="split">{t('payments:splitPayment')}</option>
              <option value="bank_transfer">{t('payments:bankTransfer')}</option>
            </select>
          </div>

          {/* ZATCA filter */}
          <select value={zatcaFilter} onChange={e => setZatcaFilter(e.target.value)}
            className="input py-1.5 text-xs pr-7">
            <option value="all">{t('invoices:allStatuses')}</option>
            {demoSandbox ? (
              <>
                <option value="sandbox_validated">{t('invoices:submitted')}</option>
                <option value="sandbox_validated_with_warnings">{t('invoices:submittedWarnings')}</option>
                <option value="sandbox_validation_pending">{t('invoices:pending')}</option>
                <option value="sandbox_validation_rejected">{t('invoices:rejected')}</option>
                <option value="sandbox_validation_failed">{t('invoices:failed')}</option>
                <option value="sandbox_not_validated">{t('invoices:notSubmitted')}</option>
              </>
            ) : (
              <>
                <option value="not_submitted">{t('invoices:notRequired')}</option>
                <option value="pending">{t('invoices:pending')}</option>
                <option value="reported">{t('invoices:reported')}</option>
                <option value="cleared">{t('invoices:cleared')}</option>
                <option value="failed">{t('invoices:failed')}</option>
              </>
            )}
          </select>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">

        {/* Table header */}
        <div className="flex min-w-[980px] gap-2 px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-gray-50/80">
          <div className="w-28">{t('invoices:documentNumber')}</div>
          <div className="w-24">{t('invoices:date')}</div>
          <div className="w-16">{t('invoices:time')}</div>
          <div className="flex-1">{t('invoices:customer')}</div>
          <div className="w-10 text-end">{t('invoices:lines')}</div>
          <div className="w-24 text-end">{t('invoices:beforeVat')}</div>
          <div className="w-20 text-end">{t('invoices:vat')}</div>
          <div className="w-24 text-end font-bold">{t('invoices:total')}</div>
          <div className="w-16 text-center">{t('invoices:method')}</div>
          <div className="w-24 text-center">ZATCA</div>
          <div className="w-20" />
        </div>

        {loading && rows.length === 0 ? (
          <div className="divide-y divide-gray-50" aria-label={t('invoices:loadingLabel')}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex min-w-[980px] gap-2 px-4 py-3">
                {[112, 96, 64, 220, 40, 96, 80, 96, 64, 96].map((width, cell) => (
                  <div key={cell} className="h-4 animate-pulse rounded bg-gray-100" style={{ width }} />
                ))}
              </div>
            ))}
          </div>
        ) : loadError && rows.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm font-semibold text-gray-700">{t('invoices:loadFailed')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('validation:networkUnavailable')}</p>
            <button type="button" onClick={() => setRefreshKey(key => key + 1)} className="mt-3 rounded-lg bg-primary-700 px-3 py-2 text-xs font-semibold text-white">{t('common:retry')}</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText size={32} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{t('invoices:noResults')}</p>
            <p className="text-xs text-gray-300 mt-1">{t('invoices:tryDifferentFilter')}</p>
          </div>
        ) : (
          <>
            {filtered.map(r => {
              const zatcaBase = ZATCA_BADGE[r.displayZatcaStatus] ?? ZATCA_BADGE.pending
              const zatcaKey = r.displayZatcaStatus === 'sandbox_validated' ? 'submitted'
                : r.displayZatcaStatus === 'sandbox_validated_with_warnings' ? 'submittedWarnings'
                : r.displayZatcaStatus === 'sandbox_validation_rejected' ? 'rejected'
                : r.displayZatcaStatus === 'sandbox_not_validated' ? 'notSubmitted'
                : r.displayZatcaStatus === 'not_submitted' ? 'notRequired'
                : r.displayZatcaStatus === 'reported' ? 'reported'
                : r.displayZatcaStatus === 'cleared' ? 'cleared'
                : r.displayZatcaStatus.includes('failed') ? 'failed' : 'pending'
              const zatca = { ...zatcaBase, label: t(`invoices:${zatcaKey}`) }
              const payBase = r.paymentMethod ? (PAY_BADGE[r.paymentMethod] ?? PAY_BADGE.other) : null
              const pay = payBase ? { ...payBase, label: r.paymentMethod === 'cash' ? t('payments:cash') : r.paymentMethod === 'card' ? t('payments:card') : r.paymentMethod === 'split' ? t('payments:split') : r.paymentMethod === 'bank_transfer' ? t('payments:bankTransfer') : t('payments:other') } : null
              const isCancelled = r.status === 'cancelled'
              const isCreditNote = r.documentType === 'credit_note'
              const creditDisabledReason = creditNoteDisabledReason(r, profile?.role, t)
              return (
                <div
                  key={r.id}
                  className={`flex min-w-[980px] gap-2 px-4 py-3 border-t border-gray-50 items-center hover:bg-primary-50/30 transition-colors ${isCancelled ? 'opacity-50' : ''}`}
                >
                  <div className="w-28">
                    <span className="text-xs font-bold text-gray-900 font-mono">{r.invoiceNumber}</span>
                    {isCreditNote && (
                      <span className="ms-1 text-[9px] font-semibold text-amber-700 bg-amber-50 px-1 py-0.5 rounded">{t('invoices:creditNoteShort')}</span>
                    )}
                    {isCancelled && (
                      <span className="ms-1 text-[9px] font-semibold text-red-500 bg-red-50 px-1 py-0.5 rounded">{t('invoices:void')}</span>
                    )}
                    {isCreditNote && r.invoiceReference && (
                      <p className="mt-0.5 text-[9px] text-gray-400">{t('invoices:forInvoice', { number: r.invoiceReference })}</p>
                    )}
                    {!isCreditNote && r.creditStatus !== 'none' && (
                      <p className={`mt-0.5 text-[9px] ${r.creditStatus === 'full' ? 'text-emerald-700' : 'text-amber-600'}`}>
                        {r.creditStatus === 'full' ? t('invoices:fullyCredited') : t('invoices:partiallyCredited')}
                        {r.linkedCreditNoteNumber ? ` · ${t('invoices:latest', { number: r.linkedCreditNoteNumber })}` : ''}
                        {r.creditNoteCount > 1 ? ` · ${t('invoices:notesCount', { count: r.creditNoteCount })}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="w-24 text-xs text-gray-500">{fmtDate(r.date)}</div>
                  <div className="w-16 text-xs text-gray-500 tabular-nums">{fmtTime(r.createdAt)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-800 truncate">{r.customerName ?? t('invoices:walkInCustomer')}</p>
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
                      title={t('invoices:view')}
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
                        title={creditDisabledReason ?? t('creditNotes:create')}
                        aria-label={creditDisabledReason ?? t('creditNotes:create')}
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
                {t('invoices:documentsCount', { count: filtered.length })}
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
        {loadError && rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <span>{t('invoices:refreshFailed')}</span>
            <button type="button" onClick={() => setRefreshKey(key => key + 1)} className="font-semibold underline underline-offset-2">{t('common:retry')}</button>
          </div>
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
          zatca_document_kind: creditModalRow.documentType === 'standard'
            ? 'standard'
            : 'simplified',
        } : null}
        defaultRefundMethod={(creditModalRow?.paymentMethod === 'split' ? 'other' : (creditModalRow?.paymentMethod ?? 'cash')) as PaymentMethod}
        onClose={() => setCreditModalRow(null)}
        onCreated={(result: CreditNoteCreatedResult) => {
          if (profile?.tenant_id && profile.branch_id) {
            const demoStatus = demoSandbox
              ? (result.autoSubmitSucceeded ? 'sandbox_validated' : 'sandbox_validation_failed')
              : result.zatcaStatus
            upsertInvoiceListRow(profile.tenant_id, {
              id: result.creditNoteId,
              branchId: profile.branch_id,
              invoiceNumber: result.creditNoteNumber,
              date: saudiDateStr(result.createdAt),
              createdAt: result.createdAt,
              customerName: creditModalRow?.customerName ?? null,
              itemsCount: result.itemsCount,
              subtotal: result.subtotal,
              taxAmount: result.taxAmount,
              totalAmount: result.total,
              paymentMethod: result.refundMethod,
              zatcaStatus: result.zatcaStatus,
              displayZatcaStatus: demoStatus,
              status: 'posted',
              documentType: 'credit_note',
              invoiceReference: creditModalRow?.invoiceNumber ?? null,
              linkedCreditNoteId: null,
              linkedCreditNoteNumber: null,
              creditNoteCount: 0,
              creditStatus: 'none',
              remainingRefundableQuantity: 0,
            })
            updateCachedInvoiceRows(profile.tenant_id, profile.branch_id, cachedRows => cachedRows.map(row => row.id === result.originalInvoiceId ? {
              ...row,
              linkedCreditNoteId: result.creditNoteId,
              linkedCreditNoteNumber: result.creditNoteNumber,
              creditNoteCount: row.creditNoteCount + (result.idempotentReplay ? 0 : 1),
              creditStatus: 'partial',
            } : row))
          }
          setCreditModalRow(null)
          setRefreshKey(key => key + 1)
        }}
      />
    </div>
  )
}
