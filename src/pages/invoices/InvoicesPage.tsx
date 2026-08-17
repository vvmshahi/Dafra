import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Eye, TrendingUp, FileText, Receipt, RefreshCw, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { InvoiceType, PaymentMethod, ZatcaStatus } from '@/types/database'
import {
  formatSaudiDate,
  formatSaudiDateTime,
  formatSaudiTime,
  saudiDatePresetRange,
  saudiDateRangeUtc,
  saudiDateStr,
} from '@/lib/utils/date'
import { usePosSession, type PosSession } from '@/hooks/usePosSession'
import { retryFailedSubmissions } from '@/lib/zatca/submission'
import { isPermanentDemoSandboxBranch } from '@/lib/zatca/submission'
import { getSandboxValidationStatuses } from '@/lib/zatca/api'
import CreateCreditNoteModal, { type CreditNoteCreatedResult } from './CreateCreditNoteModal'
import AtomicCreditNoteReceiptView from './AtomicCreditNoteReceiptView'
import { PageHeader } from '@/components/ui/PageHeader'
import { FilterPresetRow } from '@/components/ui/FilterPanel'
import { ContentState } from '@/components/ui/ContentState'
import { Button } from '@/components/ui/Button'
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
type OwnerInvoiceBranch = {
  id: string
  name: string
  name_ar: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type QuickRange = 'today' | 'yesterday' | 'this_month' | 'last_month' | 'custom'
type SessionShortcut = 'current' | 'previous'

function quickRangeDates(range: Exclude<QuickRange, 'custom'>) {
  return saudiDatePresetRange(range)
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string, locale: string) {
  return formatSaudiDate(s, locale)
}

function fmtTime(s: string | null | undefined, locale: string) {
  if (!s) return '—'
  return formatSaudiTime(s, locale)
}

type DocumentBadgeConfig = { label: string; bg: string; text: string; ring: string; dot: string }

const ZATCA_BADGE: Record<string, DocumentBadgeConfig> = {
  not_submitted: { label: 'Not Required', bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-500/20', dot: 'bg-slate-400' },
  pending: { label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-600/20', dot: 'bg-amber-500' },
  reported: { label: 'Reported', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20', dot: 'bg-emerald-500' },
  cleared: { label: 'Cleared', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20', dot: 'bg-emerald-500' },
  failed: { label: 'Failed', bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-600/20', dot: 'bg-red-500' },
  sandbox_validated: { label: 'Submitted', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20', dot: 'bg-emerald-500' },
  sandbox_validated_with_warnings: { label: 'Submitted with warnings', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-600/20', dot: 'bg-amber-500' },
  sandbox_validation_pending: { label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-600/20', dot: 'bg-amber-500' },
  sandbox_validation_rejected: { label: 'Rejected', bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-600/20', dot: 'bg-red-500' },
  sandbox_validation_failed: { label: 'Failed', bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-600/20', dot: 'bg-red-500' },
  sandbox_not_validated: { label: 'Not submitted', bg: 'bg-slate-50', text: 'text-slate-600', ring: 'ring-slate-500/20', dot: 'bg-slate-400' },
}

const PAY_BADGE: Record<string, DocumentBadgeConfig> = {
  cash: { label: 'Cash', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-600/20', dot: 'bg-emerald-500' },
  card: { label: 'Card', bg: 'bg-indigo-50', text: 'text-indigo-700', ring: 'ring-indigo-600/20', dot: 'bg-indigo-500' },
  split: { label: 'Split', bg: 'bg-teal-50', text: 'text-teal-700', ring: 'ring-teal-600/20', dot: 'bg-teal-500' },
  bank_transfer: { label: 'Bank', bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-600/20', dot: 'bg-sky-500' },
  credit: { label: 'Customer credit', bg: 'bg-rose-50', text: 'text-rose-800', ring: 'ring-rose-700/20', dot: 'bg-rose-700' },
  partial_credit: { label: 'Customer credit', bg: 'bg-rose-50', text: 'text-rose-800', ring: 'ring-rose-700/20', dot: 'bg-rose-700' },
  other: { label: 'Other', bg: 'bg-gray-50', text: 'text-gray-600', ring: 'ring-gray-500/20', dot: 'bg-gray-400' },
}

function DocumentBadge({ label, bg, text, ring, dot }: DocumentBadgeConfig) {
  return (
    <span className={`inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${bg} ${text} ${ring}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function CreditContext({ row, t }: { row: InvoiceRow; t: TFunction }) {
  const isCreditNote = row.documentType === 'credit_note'
  if (isCreditNote && row.invoiceReference) {
    return (
      <p className="mt-1 text-[10px] leading-4 text-gray-500 [overflow-wrap:anywhere]">
        {t('invoices:forInvoice', { number: row.invoiceReference })}
      </p>
    )
  }
  if (isCreditNote || row.creditStatus === 'none') return null
  return (
    <div className={`mt-1 text-[10px] leading-4 ${row.creditStatus === 'full' ? 'text-emerald-700' : 'text-amber-700'}`}>
      <p className="font-semibold">
        {row.creditStatus === 'full' ? t('invoices:fullyCredited') : t('invoices:partiallyCredited')}
      </p>
      {row.linkedCreditNoteNumber ? (
        <p className="[overflow-wrap:anywhere]">
          {t('invoices:latestCreditNote', { number: row.linkedCreditNoteNumber })}
          {row.creditNoteCount > 1 ? ` · ${t('invoices:notesCount', { count: row.creditNoteCount })}` : ''}
        </p>
      ) : null}
    </div>
  )
}

const INVOICE_KPI_TONES = {
  netRevenue: 'bg-gradient-to-br from-[#1B6B3A] to-[#0F2419]',
  creditNotes: 'bg-gradient-to-br from-[#334155] to-[#1e293b]',
  netVat: 'bg-gradient-to-br from-[#285e61] to-[#1f3f43]',
  documents: 'bg-gradient-to-br from-[#334155] to-[#1e293b]',
} as const

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
  if (role && !['owner', 'branch'].includes(role)) return t('validation:creditPermissionDenied')
  if (row.creditStatus === 'full' || row.remainingRefundableQuantity <= 0) return t('invoices:fullyCreditedReason')
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { t, i18n } = useTranslation(['invoices', 'creditNotes', 'payments', 'validation', 'common'])
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [ownerBranches, setOwnerBranches] = useState<OwnerInvoiceBranch[]>([])
  const [selectedOwnerBranchId, setSelectedOwnerBranchId] = useState<string | null>(null)
  const [ownerBranchesLoading, setOwnerBranchesLoading] = useState(false)
  const [ownerBranchesError, setOwnerBranchesError] = useState(false)
  const effectiveBranchId = profile?.role === 'branch'
    ? profile.branch_id
    : selectedOwnerBranchId
  const {
    session: activeSession,
    loading: activeSessionLoading,
    error: activeSessionError,
    resolvedBranchId: activeSessionBranchId,
    fetchActiveSession,
  } = usePosSession(effectiveBranchId ?? undefined, profile?.tenant_id, undefined)

  const [rows,    setRows]    = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryingZatca, setRetryingZatca] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [creditModalRow, setCreditModalRow] = useState<InvoiceRow | null>(null)
  const [creditNoteResult, setCreditNoteResult] = useState<CreditNoteCreatedResult | null>(null)
  const [previousSession, setPreviousSession] = useState<PosSession | null>(null)
  const [previousSessionLoading, setPreviousSessionLoading] = useState(true)
  const [filterReady, setFilterReady] = useState(false)
  const initializedBranchRef = useRef<string | null>(null)

  const { start: defaultStart, end: defaultEnd } = quickRangeDates('today')
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate,   setEndDate]   = useState(defaultEnd)
  const [quickRange, setQuickRange] = useState<QuickRange | null>(null)
  const [sessionShortcut, setSessionShortcut] = useState<SessionShortcut | null>(null)
  const [search,    setSearch]    = useState('')
  const [payFilter, setPayFilter] = useState('all')
  const [zatcaFilter, setZatcaFilter] = useState('all')
  const pageSize = 100
  const filtersResolved = filterReady && initializedBranchRef.current === effectiveBranchId
  const selectedSession = sessionShortcut === 'current'
    ? activeSession
    : sessionShortcut === 'previous'
    ? previousSession
    : null
  const scope = useMemo<InvoiceListScope | null>(() => (
    profile?.tenant_id
    && effectiveBranchId
    && filtersResolved
    && (!sessionShortcut || selectedSession)
  ) ? ({
    tenantId: profile.tenant_id,
    branchId: effectiveBranchId,
    startDate,
    endDate,
    page: 0,
    pageSize,
    sessionId: selectedSession?.id ?? null,
  }) : null, [
    profile?.tenant_id,
    effectiveBranchId,
    startDate,
    endDate,
    selectedSession?.id,
    filtersResolved,
    sessionShortcut,
  ])

  const viewKey = scope
    ? invoiceListViewKey(scope, { search, paymentMethod: payFilter, zatcaStatus: zatcaFilter })
    : 'invoice-list-unscoped'

  function applyQuickRange(range: QuickRange) {
    setSessionShortcut(null)
    setQuickRange(range)
    if (range === 'custom') return

    const next = quickRangeDates(range)
    setStartDate(next.start)
    setEndDate(next.end)
  }

  function updateManualDate(which: 'start' | 'end', value: string) {
    setSessionShortcut(null)
    setQuickRange('custom')
    if (which === 'start') {
      setStartDate(value)
      return
    }
    setEndDate(value)
  }

  function applySessionShortcut(shortcut: SessionShortcut) {
    const session = shortcut === 'current' ? activeSession : previousSession
    if (!session) return
    setQuickRange(null)
    setSessionShortcut(shortcut)
  }

  useEffect(() => {
    if (profile?.role !== 'owner' || !profile.tenant_id) {
      setOwnerBranches([])
      setSelectedOwnerBranchId(null)
      setOwnerBranchesLoading(false)
      setOwnerBranchesError(false)
      return
    }

    let cancelled = false
    setOwnerBranchesLoading(true)
    setOwnerBranchesError(false)
    ;(async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name, name_ar')
        .eq('tenant_id', profile.tenant_id)
        .order('name')
      if (cancelled) return
      if (error) {
        setOwnerBranches([])
        setSelectedOwnerBranchId(null)
        setOwnerBranchesError(true)
      } else {
        const branches = (data ?? []) as OwnerInvoiceBranch[]
        setOwnerBranches(branches)
        setSelectedOwnerBranchId(current =>
          current && branches.some(branch => branch.id === current)
            ? current
            : (branches[0]?.id ?? null))
      }
      setOwnerBranchesLoading(false)
    })()
    return () => { cancelled = true }
  }, [profile?.role, profile?.tenant_id])

  useEffect(() => {
    const branchId = effectiveBranchId
    if (!branchId) {
      initializedBranchRef.current = null
      setFilterReady(false)
      setPreviousSession(null)
      setPreviousSessionLoading(false)
      return
    }
    let cancelled = false
    setPreviousSessionLoading(true)
    ;(async () => {
      const { data, error } = await (supabase as any)
        .from('pos_sessions')
        .select('id, branch_id, tenant_id, opened_by, opened_at, opening_cash, status, closed_at')
        .eq('tenant_id', profile.tenant_id)
        .eq('branch_id', branchId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      if (error) {
        console.error('[InvoicesPage] previous session query failed', error)
        setPreviousSession(null)
      } else {
        setPreviousSession((data ?? [])[0] ?? null)
      }
      setPreviousSessionLoading(false)
    })()
    return () => { cancelled = true }
  }, [effectiveBranchId, profile?.tenant_id])

  useEffect(() => {
    const branchId = effectiveBranchId
    if (
      !branchId
      || activeSessionLoading
      || activeSessionError
      || activeSessionBranchId !== branchId
      || initializedBranchRef.current === branchId
    ) return
    initializedBranchRef.current = branchId
    const today = quickRangeDates('today')
    setStartDate(today.start)
    setEndDate(today.end)
    if (activeSession) {
      setSessionShortcut('current')
      setQuickRange(null)
    } else {
      setSessionShortcut(null)
      setQuickRange('today')
    }
    setFilterReady(true)
  }, [
    effectiveBranchId,
    activeSession,
    activeSessionBranchId,
    activeSessionError,
    activeSessionLoading,
  ])

  useEffect(() => {
    if (!filterReady || activeSessionLoading || sessionShortcut !== 'current' || activeSession) return
    const today = quickRangeDates('today')
    setSessionShortcut(null)
    setQuickRange('today')
    setStartDate(today.start)
    setEndDate(today.end)
  }, [activeSession, activeSessionLoading, filterReady, sessionShortcut])

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
        const baseQuery = supabase
          .from('invoices')
          .select(`
            id, branch_id, session_id, invoice_number, invoice_reference, zatca_invoice_type, invoice_date, created_at, status, is_demo,
            subtotal, tax_amount, total_amount, payment_method, payment_status, zatca_status,
            customers(name),
            invoice_items(id, quantity),
            payments(method)
          `)
          .eq('tenant_id', tid)
          .eq('branch_id', activeScope.branchId)
        const boundedQuery = activeScope.sessionId
          ? baseQuery.eq('session_id', activeScope.sessionId)
          : (() => {
            const range = saudiDateRangeUtc(activeScope.startDate, activeScope.endDate)
            return baseQuery.gte('created_at', range.start).lte('created_at', range.end)
          })()
        const { data, error: invoiceError } = await boundedQuery
          .order('created_at', { ascending: false })
          .range(0, activeScope.pageSize - 1)
        if (invoiceError) throw invoiceError

        if (cancelled) return

        const invoices = data ?? []
        const customerCreditInvoiceIds = new Set<string>()
        const { data: creditOperations } = await (supabase as any)
          .from('customer_receivable_operations')
          .select('action, response')
          .eq('branch_id', activeScope.branchId)
          .eq('action', 'credit_checkout')
          .limit(1000)
        const invoiceIds = new Set(invoices.map((invoice: any) => String(invoice.id)))
        for (const operation of creditOperations ?? []) {
          const invoiceId = String(operation?.response?.invoice_id ?? '')
          if (invoiceIds.has(invoiceId)) customerCreditInvoiceIds.add(invoiceId)
        }
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
          const isCustomerCredit = inv.zatca_invoice_type !== 'credit_note' && customerCreditInvoiceIds.has(inv.id)
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
          isDemo:        inv.is_demo === true,
          isSandboxDemo: demoSandbox && inv.is_demo !== true,
          id:            inv.id,
          branchId:      inv.branch_id,
          invoiceNumber: inv.invoice_number,
          date:          inv.invoice_date,
          createdAt:     inv.created_at,
          sessionId:     inv.session_id ?? null,
          customerName:  (inv.customers as any)?.name ?? null,
          itemsCount:    invoiceItems.length,
          subtotal:      Number(inv.subtotal),
          taxAmount:     Number(inv.tax_amount),
          totalAmount:   Number(inv.total_amount),
          paymentMethod: isCustomerCredit
            ? 'credit'
            : payments.length > 0
            ? (isSplitPayment ? 'split' : payments[0].method)
            : inv.payment_method ?? null,
          zatcaStatus: inv.zatca_status as ZatcaStatus,
          displayZatcaStatus: demoSandbox && inv.is_demo !== true
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
    creditNotes: filtered.reduce((s, r) => s + (r.documentType === 'credit_note' ? r.totalAmount : 0), 0),
    creditNoteCount: filtered.filter(r => r.documentType === 'credit_note').length,
  }
  const periodLabel = sessionShortcut
    ? t(`invoices:${sessionShortcut === 'current' ? 'currentSession' : 'previousSession'}`)
    : quickRange === 'custom'
    ? t('invoices:dateRange', {
        start: fmtDate(startDate, i18n.language),
        end: fmtDate(endDate, i18n.language),
      })
    : t(`invoices:${quickRange === 'this_month' ? 'thisMonth' : quickRange === 'last_month' ? 'lastMonth' : quickRange ?? 'today'}`)
  const hasActiveFilters = sessionShortcut !== null
    || quickRange !== 'today'
    || startDate !== defaultStart
    || endDate !== defaultEnd
    || search.trim() !== ''
    || payFilter !== 'all'
    || zatcaFilter !== 'all'
  const demoSandbox = isPermanentDemoSandboxBranch(profile?.tenant_id, effectiveBranchId)
  const retryableZatcaCount = demoSandbox ? 0 : rows.filter(r => r.status !== 'cancelled' && (r.zatcaStatus === 'failed' || r.zatcaStatus === 'pending')).length
  const emptyTitle = sessionShortcut === 'current'
    ? t('invoices:noCurrentSessionInvoices')
    : sessionShortcut === 'previous'
    ? t('invoices:noPreviousSessionInvoices')
    : quickRange === 'today'
    ? t('invoices:noInvoicesToday')
    : t('invoices:noInvoicesDateRange')
  const emptyDescription = sessionShortcut
    ? t('invoices:sessionEmptyHint')
    : t('invoices:noDocumentsHint')

  function resetFilters() {
    setStartDate(defaultStart)
    setEndDate(defaultEnd)
    if (activeSession) {
      setSessionShortcut('current')
      setQuickRange(null)
    } else {
      setSessionShortcut(null)
      setQuickRange('today')
    }
    setSearch('')
    setPayFilter('all')
    setZatcaFilter('all')
  }

  const documentRows = filtered.map(r => {
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
    const pay = payBase ? {
      ...payBase,
      label: r.paymentMethod === 'cash' ? t('payments:cash')
        : r.paymentMethod === 'card' ? t('payments:card')
        : r.paymentMethod === 'split' ? t('payments:split')
        : r.paymentMethod === 'bank_transfer' ? t('payments:bankTransfer')
        : r.paymentMethod === 'credit' || r.paymentMethod === 'partial_credit' ? t('payments:customerCredit')
        : t('payments:other'),
    } : null
    return {
      row: r,
      zatca,
      pay,
      isCancelled: r.status === 'cancelled',
      isCreditNote: r.documentType === 'credit_note',
      creditDisabledReason: creditNoteDisabledReason(r, profile?.role, t),
    }
  })

  async function handleRetryZatca() {
    const tid = profile?.tenant_id
    if (!tid || retryingZatca) return
    setRetryingZatca(true)
    try {
      const result = await retryFailedSubmissions(tid, effectiveBranchId)
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

  function renderDocumentActions(document: typeof documentRows[number]) {
    const { row: r, creditDisabledReason: disabledReason } = document
    return (
      <div className="inline-grid w-[74px] grid-cols-2 items-center gap-2" data-invoice-action-slots>
        <button
          type="button"
          onClick={() => navigate(`/invoices/${r.id}`)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition-[background-color,border-color,color,transform] duration-150 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.97]"
          title={t('invoices:viewDocument')}
          aria-label={t('invoices:viewDocumentNumber', { number: r.invoiceNumber })}
        >
          <Eye size={15} aria-hidden="true" />
        </button>
        {!disabledReason ? (
          <button
            type="button"
            onClick={() => setCreditModalRow(r)}
            title={t('creditNotes:create')}
            aria-label={t('creditNotes:create')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition-[background-color,border-color,color,transform] duration-150 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 active:scale-[0.97]"
          >
            <RotateCcw size={15} aria-hidden="true" />
          </button>
        ) : (
          <span className="h-8 w-8" aria-hidden="true" data-invoice-action-placeholder />
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const ownerBranchSelector = profile?.role === 'owner' ? (
    <label className="block max-w-sm text-xs font-semibold text-gray-700">
      <span className="mb-1 block">{t('invoices:branchFilter')}</span>
      <select
        value={selectedOwnerBranchId ?? ''}
        disabled={ownerBranchesLoading || ownerBranches.length === 0}
        onChange={event => setSelectedOwnerBranchId(event.target.value || null)}
        className="input min-h-10 w-full pe-8 text-sm"
      >
        {ownerBranches.length === 0 && (
          <option value="">{t(ownerBranchesLoading ? 'invoices:loadingBranches' : 'invoices:noBranches')}</option>
        )}
        {ownerBranches.map(branch => (
          <option key={branch.id} value={branch.id}>
            {i18n.language.startsWith('ar') ? (branch.name_ar || branch.name) : branch.name}
          </option>
        ))}
      </select>
    </label>
  ) : null

  if (!filtersResolved) {
    return (
      <div className="min-w-0 space-y-4" aria-live="polite">
        <PageHeader
          eyebrow={t('invoices:branchDocuments')}
          title={t('invoices:title')}
          description={t('invoices:subtitle')}
        />
        {ownerBranchSelector}
        {ownerBranchesError ? (
          <ContentState
            kind="error"
            title={t('invoices:branchLoadFailed')}
            description={t('validation:networkUnavailable')}
          />
        ) : profile?.role === 'owner' && !ownerBranchesLoading && ownerBranches.length === 0 ? (
          <ContentState kind="empty" title={t('invoices:noBranches')} />
        ) : activeSessionError ? (
          <ContentState
            kind="error"
            title={t('invoices:sessionResolutionFailed')}
            description={t('invoices:sessionResolutionFailedHint')}
            action={(
              <Button type="button" size="sm" onClick={() => void fetchActiveSession()}>
                {t('common:retry')}
              </Button>
            )}
          />
        ) : (
          <ContentState kind="loading" title={t('invoices:resolvingSessionFilter')} />
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        eyebrow={t('invoices:branchDocuments')}
        title={t('invoices:title')}
        description={t('invoices:subtitle')}
        actions={(
          <>
            {refreshing && rows.length > 0 && (
              <span className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-gray-500" aria-live="polite">
                <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
                {t('invoices:updating')}
              </span>
            )}
            {retryableZatcaCount > 0 && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={handleRetryZatca}
                loading={retryingZatca}
                title={t('invoices:retryTitle')}
                aria-label={t('invoices:retryTitle')}
                className="min-h-9"
              >
                {!retryingZatca && <RefreshCw size={14} aria-hidden="true" />}
                {t('invoices:retryZatca', { count: retryableZatcaCount })}
              </Button>
            )}
          </>
        )}
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" aria-label={t('invoices:documentSummary')}>
        {[
          { label: t('invoices:netRevenue'), value: <Rial amount={summary.revenue} />, sub: periodLabel, icon: TrendingUp, tone: INVOICE_KPI_TONES.netRevenue },
          { label: t('invoices:creditNotes'), value: <Rial amount={summary.creditNotes} />, sub: t('invoices:creditNotesCount', { count: summary.creditNoteCount }), icon: Receipt, tone: INVOICE_KPI_TONES.creditNotes },
          { label: t('invoices:netVat'), value: <Rial amount={summary.vat} />, sub: periodLabel, icon: Receipt, tone: INVOICE_KPI_TONES.netVat },
          { label: t('invoices:documents'), value: String(summary.count), sub: periodLabel, icon: FileText, tone: INVOICE_KPI_TONES.documents },
        ].map(metric => (
          <article
            key={metric.label}
            className={`relative min-h-[96px] overflow-hidden rounded-2xl border border-white/10 p-3 shadow-card-md ring-1 ring-black/10 sm:min-h-[104px] sm:p-3.5 [@media(max-height:740px)]:min-h-[94px] ${metric.tone}`}
          >
            <div className="flex h-full items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase leading-4 tracking-wide text-white/65 [overflow-wrap:anywhere] rtl:normal-case rtl:tracking-normal">
                  {metric.label}
                </p>
                <p dir="ltr" className="mt-1.5 text-xl font-black tracking-tight text-white tabular-nums sm:text-2xl [&>span>span:first-child]:text-[0.72em] [&>span>span:first-child]:opacity-80">
                  {metric.value}
                </p>
                <p className="mt-1 text-[11px] font-medium leading-4 text-white/60 [overflow-wrap:anywhere]">{metric.sub}</p>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/10">
                <metric.icon size={17} className="text-white/90" aria-hidden="true" />
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-px bg-white/25" />
          </article>
        ))}
      </section>

      <section
        className="space-y-2 rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm"
        aria-labelledby="invoice-filters-heading"
        data-invoice-compact-filters
      >
        <h2 id="invoice-filters-heading" className="sr-only">{t('invoices:filters')}</h2>
        {ownerBranchSelector}
        <fieldset>
          <legend className="sr-only">{t('invoices:sessionShortcuts')}</legend>
          <FilterPresetRow label={t('invoices:sessionShortcuts')}>
            {([
              {
                key: 'current',
                label: activeSession ? t('invoices:currentSession') : t('invoices:noActiveSession'),
                disabled: !activeSession,
              },
              {
                key: 'previous',
                label: previousSessionLoading
                  ? t('invoices:loadingPreviousSession')
                  : previousSession
                  ? t('invoices:previousSession')
                  : t('invoices:noPreviousSession'),
                disabled: previousSessionLoading || !previousSession,
              },
            ] as const).map(option => (
              <button
                key={option.key}
                type="button"
                onClick={() => applySessionShortcut(option.key)}
                aria-pressed={sessionShortcut === option.key}
                disabled={option.disabled}
                className={`min-h-8 shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-[background-color,color,transform,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 ${
                  sessionShortcut === option.key
                    ? 'border-primary-800 bg-primary-800 text-white shadow-sm'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-primary-50 hover:text-primary-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </FilterPresetRow>
        </fieldset>

        <fieldset>
          <legend className="sr-only">{t('invoices:datePresets')}</legend>
          <FilterPresetRow label={t('invoices:datePresets')}>
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
                aria-pressed={quickRange === option.key}
                className={`min-h-8 shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-[background-color,color,transform,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.97] ${
                  quickRange === option.key
                    ? 'bg-primary-700 text-white shadow-sm'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-primary-50 hover:text-primary-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </FilterPresetRow>
        </fieldset>

        {selectedSession && (
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg bg-primary-50 px-2.5 py-1.5 text-[11px] font-medium text-primary-900" aria-live="polite">
            <span className="font-bold">
              {t(`invoices:${sessionShortcut === 'current' ? 'currentSession' : 'previousSession'}`)}
            </span>
            <span aria-hidden="true">·</span>
            <bdi dir="ltr">
              {sessionShortcut === 'current'
                ? t('invoices:sessionOpenedAt', {
                  time: formatSaudiTime(selectedSession.opened_at, i18n.language),
                })
                : t('invoices:sessionClosedAt', {
                  dateTime: formatSaudiDateTime(selectedSession.closed_at!, i18n.language),
                })}
            </bdi>
            <span aria-hidden="true">·</span>
            <span>{t('invoices:documentsCount', { count: summary.count })}</span>
          </p>
        )}

        <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(130px,0.8fr)_minmax(130px,0.8fr)_minmax(230px,1.7fr)_minmax(140px,0.85fr)_minmax(140px,0.85fr)_auto]">
          <label className="min-w-0 text-[10px] font-semibold text-gray-600">
            <span className="mb-0.5 block">{t('invoices:from')}</span>
            <input
              type="date"
              value={startDate}
              onChange={event => updateManualDate('start', event.target.value)}
              disabled={sessionShortcut !== null}
              className="input min-h-9 w-full px-2 text-xs tabular-nums"
            />
          </label>

          <label className="min-w-0 text-[10px] font-semibold text-gray-600">
            <span className="mb-0.5 block">{t('invoices:to')}</span>
            <input
              type="date"
              value={endDate}
              onChange={event => updateManualDate('end', event.target.value)}
              disabled={sessionShortcut !== null}
              className="input min-h-9 w-full px-2 text-xs tabular-nums"
            />
          </label>

          <label className="min-w-0 text-[10px] font-semibold text-gray-600 sm:col-span-2 lg:col-span-2 xl:col-span-1">
            <span className="mb-1 block">{t('invoices:search')}</span>
            <span className="relative block">
              <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t('invoices:searchPlaceholder')}
                className="input min-h-9 w-full ps-9 text-xs"
              />
            </span>
          </label>

          <label className="min-w-0 text-[10px] font-semibold text-gray-600">
            <span className="mb-0.5 block">{t('invoices:paymentMethod')}</span>
            <select
              value={payFilter}
              onChange={event => setPayFilter(event.target.value)}
              className="input min-h-9 w-full pe-8 text-xs"
            >
              <option value="all">{t('invoices:allMethods')}</option>
              <option value="cash">{t('payments:cash')}</option>
              <option value="card">{t('payments:card')}</option>
              <option value="split">{t('payments:splitPayment')}</option>
              <option value="bank_transfer">{t('payments:bankTransfer')}</option>
            </select>
          </label>

          <label className="min-w-0 text-[10px] font-semibold text-gray-600">
            <span className="mb-0.5 block">{t('invoices:zatcaStatus')}</span>
            <select
              value={zatcaFilter}
              onChange={event => setZatcaFilter(event.target.value)}
              className="input min-h-9 w-full pe-8 text-xs"
            >
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
          </label>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters} className="min-h-9 self-end px-2.5">
              <X size={13} aria-hidden="true" />
              {t('invoices:clearFilters')}
            </Button>
          )}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm" aria-labelledby="invoice-documents-heading">
        <h2 id="invoice-documents-heading" className="sr-only">{t('invoices:documents')}</h2>

        {loading && rows.length === 0 ? (
          <ContentState kind="loading" title={t('invoices:loadingLabel')} />
        ) : loadError && rows.length === 0 ? (
          <ContentState
            kind="error"
            title={t('invoices:loadFailed')}
            description={t('validation:networkUnavailable')}
            action={(
              <Button type="button" size="sm" onClick={() => setRefreshKey(key => key + 1)}>
                {t('common:retry')}
              </Button>
            )}
          />
        ) : documentRows.length === 0 ? (
          <ContentState
            kind="empty"
            icon={FileText}
            title={rows.length === 0 ? emptyTitle : t('invoices:noMatchingDocuments')}
            description={rows.length === 0 ? emptyDescription : t('invoices:tryDifferentFilter')}
            action={hasActiveFilters ? (
              <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>
                {t('invoices:clearFilters')}
              </Button>
            ) : undefined}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block" data-invoice-desktop-table>
              <table className="w-full min-w-[1040px] border-separate border-spacing-0">
                <caption className="sr-only">{t('invoices:documentTableCaption', { period: periodLabel })}</caption>
                <thead>
                  <tr>
                    {[
                      [t('invoices:documentNumber'), 'text-start'],
                      [t('invoices:date'), 'text-start'],
                      [t('invoices:time'), 'text-start'],
                      [t('invoices:customer'), 'text-start'],
                      [t('invoices:lines'), 'text-end'],
                      [t('invoices:beforeVat'), 'text-end'],
                      [t('invoices:vat'), 'text-end'],
                      [t('invoices:total'), 'text-end'],
                      [t('invoices:method'), 'text-center'],
                      ['ZATCA', 'text-center'],
                      [t('invoices:documentActions'), 'text-center'],
                    ].map(([label, alignment]) => (
                      <th
                        key={label}
                        scope="col"
                        className={`sticky top-0 z-10 border-b border-[#0B1C13] bg-[#173F2A] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#FFF8E7] rtl:normal-case rtl:tracking-normal ${alignment}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {documentRows.map(document => {
                    const { row: r, zatca, pay, isCancelled, isCreditNote } = document
                    return (
                      <tr
                        key={r.id}
                        className={`group transition-colors hover:bg-primary-50/35 ${
                          isCreditNote ? 'bg-amber-50/25' : ''
                        } ${isCancelled ? 'opacity-50' : ''}`}
                      >
                        <td className={`px-2.5 py-2 align-top ${isCreditNote ? 'border-s-2 border-amber-300' : ''}`}>
                          <div className="min-w-[116px]">
                            <div className="flex flex-wrap items-center gap-1">
                              <span dir="ltr" className="font-mono text-xs font-bold text-gray-950">{r.invoiceNumber}</span>
                              {isCreditNote && (
                                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-inset ring-amber-600/20">
                                  {t('invoices:creditNoteShort')}
                                </span>
                              )}
                              {isCancelled && (
                                <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600 ring-1 ring-inset ring-red-600/20">
                                  {t('invoices:void')}
                                </span>
                              )}
                            </div>
                            <CreditContext row={r} t={t} />
                          </div>
                        </td>
                        <td dir="ltr" className="whitespace-nowrap px-2.5 py-2 align-top text-xs text-gray-500 tabular-nums">
                          {fmtDate(r.createdAt, i18n.language)}
                        </td>
                        <td dir="ltr" className="whitespace-nowrap px-2.5 py-2 align-top text-xs text-gray-500 tabular-nums">
                          {fmtTime(r.createdAt, i18n.language)}
                        </td>
                        <td dir="auto" className="max-w-[180px] px-2.5 py-2 align-top text-xs text-gray-800 [overflow-wrap:anywhere]">
                          {r.customerName ?? t('invoices:walkInCustomer')}
                        </td>
                        <td className="px-2.5 py-2 text-end align-top text-xs text-gray-500 tabular-nums">{r.itemsCount}</td>
                        <td dir="ltr" className={`px-2.5 py-2 text-end align-top text-xs tabular-nums ${isCreditNote ? 'text-amber-700' : 'text-gray-600'}`}>
                          {isCreditNote ? `-${fmt(r.subtotal)}` : fmt(r.subtotal)}
                        </td>
                        <td dir="ltr" className={`px-2.5 py-2 text-end align-top text-xs tabular-nums ${isCreditNote ? 'text-amber-700' : 'text-gray-600'}`}>
                          {isCreditNote ? `-${fmt(r.taxAmount)}` : fmt(r.taxAmount)}
                        </td>
                        <td dir="ltr" className="px-2.5 py-2 text-end align-top text-sm font-bold tabular-nums">
                          {isCreditNote ? <span className="text-amber-700">- <Rial amount={r.totalAmount} /></span> : <Rial amount={r.totalAmount} />}
                        </td>
                        <td className="px-2.5 py-2 text-center align-top">
                          {pay ? <DocumentBadge {...pay} /> : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-2.5 py-2 text-center align-top"><DocumentBadge {...zatca} /></td>
                        <td className="px-2.5 py-1.5 text-center align-top">{renderDocumentActions(document)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50">
                    <th scope="row" colSpan={5} className="border-t border-gray-200 px-2.5 py-2.5 text-start text-xs font-bold text-gray-600">
                      {t('invoices:documentsCount', { count: filtered.length })}
                    </th>
                    <td dir="ltr" className="border-t border-gray-200 px-2.5 py-2.5 text-end text-xs font-bold text-gray-700 tabular-nums">
                      <Rial amount={summary.revenue - summary.vat} />
                    </td>
                    <td dir="ltr" className="border-t border-gray-200 px-2.5 py-2.5 text-end text-xs font-bold text-amber-700 tabular-nums">
                      <Rial amount={summary.vat} />
                    </td>
                    <td dir="ltr" className="border-t border-gray-200 px-2.5 py-2.5 text-end text-sm font-black text-primary-700 tabular-nums">
                      <Rial amount={summary.revenue} />
                    </td>
                    <td colSpan={3} className="border-t border-gray-200" />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="grid gap-3 p-3 lg:hidden sm:grid-cols-2" data-invoice-mobile-cards>
              {documentRows.map(document => {
                const { row, zatca, pay, isCancelled, isCreditNote } = document
                return (
                  <article
                    key={row.id}
                    className={`min-w-0 rounded-xl border bg-white p-4 shadow-sm ${
                      isCreditNote ? 'border-amber-200 border-s-2 bg-amber-50/20' : 'border-gray-100'
                    } ${isCancelled ? 'opacity-55' : ''}`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span dir="ltr" className="font-mono text-sm font-black text-gray-950 [overflow-wrap:anywhere]">{row.invoiceNumber}</span>
                          {row.isDemo && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-900 ring-1 ring-inset ring-amber-300">DEMO · NOT A TAX INVOICE</span>}
                          {row.isSandboxDemo && <span className="rounded-md bg-primary-50 px-1.5 py-0.5 text-[9px] font-black text-primary-800 ring-1 ring-inset ring-primary-200">SANDBOX</span>}
                          <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ring-1 ring-inset ${
                            isCreditNote
                              ? 'bg-amber-50 text-amber-700 ring-amber-600/20'
                              : 'bg-slate-50 text-slate-600 ring-slate-500/20'
                          }`}>
                            {isCreditNote ? t('invoices:creditNote') : t('invoices:invoice')}
                          </span>
                          {isCancelled && <span className="text-[9px] font-bold text-red-600">{t('invoices:void')}</span>}
                        </div>
                        <p dir="ltr" className="mt-1 text-[11px] text-gray-500 tabular-nums">
                          {fmtDate(row.createdAt, i18n.language)} · {fmtTime(row.createdAt, i18n.language)}
                        </p>
                      </div>
                      <p dir="ltr" className={`shrink-0 text-sm font-black tabular-nums ${isCreditNote ? 'text-amber-700' : 'text-gray-950'}`}>
                        {isCreditNote ? '- ' : ''}<Rial amount={row.totalAmount} />
                      </p>
                    </div>

                    <p dir="auto" className="mt-3 text-sm font-semibold text-gray-800 [overflow-wrap:anywhere]">
                      {row.customerName ?? t('invoices:walkInCustomer')}
                    </p>
                    <CreditContext row={row} t={t} />

                    <dl className="mt-3 grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400 rtl:normal-case rtl:tracking-normal">{t('invoices:paymentMethod')}</dt>
                        <dd className="mt-1">{pay ? <DocumentBadge {...pay} /> : <span className="text-xs text-gray-300">—</span>}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400 rtl:normal-case rtl:tracking-normal">ZATCA</dt>
                        <dd className="mt-1"><DocumentBadge {...zatca} /></dd>
                      </div>
                    </dl>

                    <div className="mt-4 flex justify-end border-t border-gray-100 pt-3">
                      {renderDocumentActions(document)}
                    </div>
                  </article>
                )
              })}
            </div>
          </>
        )}
        {loadError && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800" role="alert">
            <span>{t('invoices:refreshFailed')}</span>
            <button
              type="button"
              onClick={() => setRefreshKey(key => key + 1)}
              className="min-h-9 rounded-lg px-2 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              {t('common:retry')}
            </button>
          </div>
        )}
      </section>

      <CreateCreditNoteModal
        key={creditModalRow?.id ?? 'closed-credit-note-modal'}
        open={!!creditModalRow}
        invoice={creditModalRow ? {
          id: creditModalRow.id,
          branch_id: creditModalRow.branchId,
          invoice_number: creditModalRow.invoiceNumber,
          total_amount: creditModalRow.totalAmount,
          invoice_date: creditModalRow.date,
          customer_name: creditModalRow.customerName,
          zatca_document_kind: creditModalRow.documentType === 'standard'
            ? 'standard'
            : 'simplified',
        } : null}
        defaultRefundMethod={(creditModalRow?.paymentMethod === 'split' ? 'other' : (creditModalRow?.paymentMethod ?? 'cash')) as PaymentMethod}
        onClose={() => setCreditModalRow(null)}
        onCreated={(result: CreditNoteCreatedResult) => {
          if (profile?.tenant_id && effectiveBranchId) {
            const demoStatus = demoSandbox
              ? (result.autoSubmitSucceeded ? 'sandbox_validated' : 'sandbox_validation_failed')
              : result.zatcaStatus
            upsertInvoiceListRow(profile.tenant_id, {
              id: result.creditNoteId,
              branchId: effectiveBranchId,
              invoiceNumber: result.creditNoteNumber,
              date: saudiDateStr(result.createdAt),
              createdAt: result.createdAt,
              sessionId: activeSession?.id ?? null,
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
              invoiceReference: result.originalInvoiceNumber,
              linkedCreditNoteId: null,
              linkedCreditNoteNumber: null,
              creditNoteCount: 0,
              creditStatus: 'none',
              remainingRefundableQuantity: 0,
            })
            updateCachedInvoiceRows(profile.tenant_id, effectiveBranchId, cachedRows => cachedRows.map(row => row.id === result.originalInvoiceId ? {
              ...row,
              linkedCreditNoteId: result.creditNoteId,
              linkedCreditNoteNumber: result.creditNoteNumber,
              creditNoteCount: row.creditNoteCount + (result.idempotentReplay ? 0 : 1),
              creditStatus: 'partial',
            } : row))
          }
          setCreditModalRow(null)
          setCreditNoteResult(result)
          if (!result.atomicReceipt) {
            setRefreshKey(key => key + 1)
          }
        }}
      />
      {creditNoteResult && (
        <AtomicCreditNoteReceiptView
          result={creditNoteResult}
          onOpenPrinterSettings={() => navigate('/device-printer')}
          onClose={() => {
            setCreditNoteResult(null)
            setRefreshKey(key => key + 1)
          }}
        />
      )}
    </div>
  )
}
