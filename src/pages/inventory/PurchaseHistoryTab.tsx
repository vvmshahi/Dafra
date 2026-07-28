import { useState, useEffect, useCallback } from 'react'
import { Plus, Eye, ShoppingCart, Paperclip, X, Trash2, AlertTriangle, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { Purchase, PurchaseItem, Supplier } from '@/types'
import PurchaseBillModal from './PurchaseBillModal'
import {
  COMPACT_DATE_PRESETS,
  CompactDateRangeFilter,
  type DatePreset,
  formatDateRangeLabel,
  getDateRange,
} from '../reports/reportUtils'
import { useTranslation } from 'react-i18next'
import { displayName as dn } from '@/lib/utils/display'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupplierSnap { name: string; name_ar: string | null }

interface PurchaseRow extends Purchase {
  suppliers:      SupplierSnap | null
  purchase_items: { id: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EDIT_WINDOW_DAYS = 45

const PAY_BADGE: Record<string, 'success' | 'info' | 'neutral'> = {
  cash: 'success', card: 'info', bank_transfer: 'neutral',
}
// ── Purchase detail modal ─────────────────────────────────────────────────────

function PurchaseDetailModal({
  purchase, items, loading, onClose, onOpenBill,
}: {
  purchase:   PurchaseRow
  items:      PurchaseItem[]
  loading:    boolean
  onClose:    () => void
  onOpenBill: (purchase: PurchaseRow) => void
}) {
  const { t, i18n } = useTranslation(['purchases', 'common'])
  const supplierName = purchase.suppliers ? dn(purchase.suppliers.name, purchase.suppliers.name_ar) : '—'
  const pay          = purchase.payment_method
  const mode         = purchase.purchase_mode ?? 'detailed_receiving'
  const receiving    = purchase.receiving_status ?? 'not_applicable'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h3 className="text-base font-bold text-gray-900">{t('purchases:details')}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(purchase.purchase_date).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })}
                {supplierName !== '—' && ` · ${supplierName}`}
              </p>
            </div>
            <button onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Meta */}
            <div className="flex gap-3 text-sm">
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{t('purchases:fields.supplier')}</p>
                <p className="font-medium text-gray-800 mt-0.5">{supplierName}</p>
              </div>
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{t('purchases:fields.type')}</p>
                <p className="font-medium text-gray-800 mt-0.5">{mode === 'simple_bill' ? t('purchases:mode.bill') : t('purchases:mode.stock')}</p>
              </div>
              {['detailed_receiving', 'receive_stock'].includes(mode) && (
                <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{t('purchases:fields.status')}</p>
                  <p className="font-medium text-gray-800 mt-0.5">{receiving === 'confirmed' || receiving === 'confirmed_legacy' ? t('purchases:status.stockAdded') : receiving === 'cancelled' || receiving === 'reversed' ? t('purchases:status.deleted') : t('purchases:status.pending')}</p>
                </div>
              )}
              <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{t('purchases:sections.payment')}</p>
                <p className="font-medium text-gray-800 mt-0.5">
                  {t(`purchases:paymentMethod.${pay}`, { defaultValue: t('purchases:paymentMethod.unknown') })}
                  {purchase.payment_status ? ` · ${t(`purchases:status.${purchase.payment_status}`, { defaultValue: t('purchases:status.unknown') })}` : ''}
                </p>
              </div>
            </div>

            {purchase.bill_number && (
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{t('purchases:fields.billNumber')}</p>
                <p className="font-medium text-gray-800 mt-0.5">{purchase.bill_number}</p>
              </div>
            )}

            {/* Bill image */}
            {(purchase.bill_path || purchase.bill_url) && (
              <button type="button" onClick={() => onOpenBill(purchase)}
                className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-sm text-amber-700 hover:bg-amber-100 transition-colors">
                <Paperclip size={14} />
                <span className="font-medium">{t('purchases:viewBill')}</span>
              </button>
            )}

            {/* Line items */}
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">{t('purchases:sections.items')}</p>
              {loading ? (
                <div className="flex justify-center py-6"><LoadingSpinner /></div>
              ) : items.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">{t('purchases:noItems')}</p>
              ) : (
                <div className="space-y-1.5">
                  {/* Header */}
                  <div className="flex gap-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2">
                    <div className="flex-1">{t('purchases:fields.item')}</div>
                    <div className="w-16 text-end">{t('purchases:fields.quantity')}</div>
                    <div className="w-24 text-end">{t('purchases:fields.unitCost')}</div>
                    <div className="w-24 text-end">{t('purchases:fields.total')}</div>
                  </div>
                  {items.map(item => (
                    <div key={item.id}
                      className="flex gap-2 px-2 py-2 rounded-lg bg-gray-50 text-sm">
                      <div className="flex-1 font-medium text-gray-800 truncate">{item.name}</div>
                      <div className="w-16 text-right tabular-nums text-gray-600">
                        {Number(item.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })}
                      </div>
                      <div className="w-24 text-right tabular-nums text-gray-600">
                        <Rial amount={item.unit_cost} />
                      </div>
                      <div className="w-24 text-right tabular-nums font-semibold text-gray-800">
                        <Rial amount={item.total} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>{t('purchases:fields.subtotal')}</span>
                <span className="tabular-nums"><Rial amount={purchase.subtotal} /></span>
              </div>
              {purchase.vat_amount > 0 && (
                <div className="flex justify-between text-gray-600">
                  <span>{t('purchases:fields.vat')} (15%)</span>
                  <span className="tabular-nums"><Rial amount={purchase.vat_amount} /></span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5">
                <span>{t('purchases:fields.totalPaid')}</span>
                <span className="tabular-nums text-emerald-600"><Rial amount={purchase.total_amount} /></span>
              </div>
            </div>

            {purchase.notes && (
              <div className="bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('purchases:fields.notes')}</p>
                <p className="text-sm text-gray-600">{purchase.notes}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100">
            <Button variant="secondary" className="w-full" onClick={onClose}>{t('common:close')}</Button>
          </div>
        </div>
      </div>
    </>
  )
}

function DeletePurchaseModal({
  purchase, deleting, error, confirmed, onConfirmed, onClose, onDelete,
}: {
  purchase: PurchaseRow
  deleting: boolean
  error: string
  confirmed: boolean
  onConfirmed: (value: boolean) => void
  onClose: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation(['purchases', 'common'])
  const supplierName = purchase.suppliers ? dn(purchase.suppliers.name, purchase.suppliers.name_ar) : t('purchases:noSupplierLower')

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
          <div className="px-6 py-5 border-b border-gray-100 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-500 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900">{t('purchases:delete')}</h3>
              <p className="text-sm text-gray-500 mt-1">
                {t('purchases:deleteHint')}
              </p>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">{t('purchases:fields.supplier')}</span>
                <span className="font-medium text-gray-700 truncate">{supplierName}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">{t('purchases:fields.total')}</span>
                <span className="font-semibold text-gray-900"><Rial amount={purchase.total_amount} /></span>
              </div>
              <div className="flex justify-between gap-3 mt-1">
                <span className="text-gray-500">{t('purchases:fields.date')}</span>
                <span className="font-medium text-gray-700">{new Date(purchase.purchase_date).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB')}</span>
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-gray-200 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={e => onConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-gray-600">
                {t('purchases:deleteAcknowledge')}
              </span>
            </label>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>{t('common:cancel')}</Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              loading={deleting}
              disabled={!confirmed}
              onClick={onDelete}
            >
              {t('common:delete')}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function PurchaseHistoryTab() {
  const { profile } = useAuth()
  const { t, i18n } = useTranslation(['purchases', 'common'])
  const initialDateRange = getDateRange('today')

  const [purchases,       setPurchases]       = useState<PurchaseRow[]>([])
  const [suppliers,       setSuppliers]       = useState<Supplier[]>([])
  const [loading,         setLoading]         = useState(true)
  const [drawerOpen,      setDrawerOpen]      = useState(false)
  const [editingPurchase, setEditingPurchase] = useState<PurchaseRow | null>(null)

  // Detail modal
  const [viewingPurchase, setViewingPurchase] = useState<PurchaseRow | null>(null)
  const [viewingItems,    setViewingItems]    = useState<PurchaseItem[]>([])
  const [loadingItems,    setLoadingItems]    = useState(false)
  const [deleteTarget,    setDeleteTarget]    = useState<PurchaseRow | null>(null)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [deleteError,     setDeleteError]     = useState('')
  const [deleting,        setDeleting]        = useState(false)
  const [datePreset,      setDatePreset]      = useState<DatePreset>('today')
  const [startDate,       setStartDate]       = useState(initialDateRange.start)
  const [endDate,         setEndDate]         = useState(initialDateRange.end)

  const handleDatePreset = (nextPreset: DatePreset) => {
    setDatePreset(nextPreset)
    if (nextPreset === 'custom') return
    const nextRange = getDateRange(nextPreset)
    setStartDate(nextRange.start)
    setEndDate(nextRange.end)
  }

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) {
      setPurchases([])
      setSuppliers([])
      setLoading(false)
      return
    }

    setLoading(true)
    setSuppliers([])

    const [{ data: purData }, { data: supData }] = await Promise.all([
      supabase
        .from('purchases')
        .select('*, suppliers(name,name_ar), purchase_items(id)')
        .eq('branch_id', bid)
        .gte('purchase_date', startDate)
        .lte('purchase_date', endDate)
        .order('purchase_date', { ascending: false })
        .order('created_at',    { ascending: false }),
      supabase
        .from('suppliers')
        .select(`
          id,
          tenant_id,
          branch_id,
          name,
          name_ar,
          vat_number,
          cr_number,
          contact_person,
          phone,
          email,
          city,
          address,
          payment_terms,
          notes,
          is_active,
          created_at,
          updated_at
        `)
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .eq('is_active', true)
        .order('name'),
    ])

    setPurchases((purData ?? []) as unknown as PurchaseRow[])
    setSuppliers((supData ?? []) as unknown as Supplier[])
    setLoading(false)
  }, [profile?.id, profile?.role, profile?.tenant_id, profile?.branch_id, startDate, endDate])

  useEffect(() => { load() }, [load])

  const viewDetails = async (purchase: PurchaseRow) => {
    setViewingPurchase(purchase)
    setViewingItems([])
    setLoadingItems(true)
    const q = supabase as unknown as { from: (t: string) => any }
    const { data } = await q.from('purchase_items')
      .select('*')
      .eq('purchase_id', purchase.id)
      .order('created_at')
    setViewingItems((data ?? []) as unknown as PurchaseItem[])
    setLoadingItems(false)
  }

  const canDeleteBillOnly = (purchase: PurchaseRow) =>
    (purchase.purchase_mode ?? 'detailed_receiving') === 'simple_bill' &&
    purchase.purchase_items.length === 0

  const purchaseMode = (purchase: PurchaseRow) =>
    (purchase.purchase_mode ?? 'detailed_receiving') as string

  const receivingStatus = (purchase: PurchaseRow) =>
    purchase.receiving_status ?? 'not_applicable'

  const isDetailedReceiving = (purchase: PurchaseRow) =>
    ['detailed_receiving', 'receive_stock'].includes(purchaseMode(purchase))

  const isDeletedPurchase = (purchase: PurchaseRow) =>
    purchase.status === 'cancelled' ||
    ['cancelled', 'reversed'].includes(receivingStatus(purchase))

  const isInEditWindow = (purchase: PurchaseRow) => {
    const purchaseDate = new Date(`${purchase.purchase_date}T00:00:00`)
    const cutoff = new Date()
    cutoff.setHours(0, 0, 0, 0)
    cutoff.setDate(cutoff.getDate() - EDIT_WINDOW_DAYS)
    return purchaseDate >= cutoff
  }

  const isPendingStockReceiving = (purchase: PurchaseRow) =>
    isDetailedReceiving(purchase) &&
    (
      ['draft', 'pending_confirmation'].includes(receivingStatus(purchase)) ||
      (receivingStatus(purchase) === 'not_applicable' && purchase.status === 'draft')
    )

  const canEditPurchase = (purchase: PurchaseRow) =>
    isInEditWindow(purchase) &&
    !isDeletedPurchase(purchase) &&
    purchaseMode(purchase) === 'simple_bill' &&
    purchase.purchase_items.length === 0

  const canDeletePurchase = (purchase: PurchaseRow) =>
    isInEditWindow(purchase) &&
    !isDeletedPurchase(purchase) &&
    (
      canDeleteBillOnly(purchase) ||
      isPendingStockReceiving(purchase) ||
      (isDetailedReceiving(purchase) && receivingStatus(purchase) === 'confirmed')
    )

  const isCountedPurchase = (purchase: PurchaseRow) => {
    if (isDeletedPurchase(purchase)) return false
    if (['simple_bill', 'bill_only'].includes(purchaseMode(purchase))) return purchase.status === 'posted'
    return ['confirmed', 'confirmed_legacy'].includes(receivingStatus(purchase)) ||
      (purchaseMode(purchase) === 'detailed_receiving' && receivingStatus(purchase) === 'not_applicable' && purchase.status === 'posted')
  }

  const purchaseStatusLabel = (purchase: PurchaseRow) => {
    if (isDeletedPurchase(purchase)) return 'deleted'
    if (purchaseMode(purchase) === 'simple_bill') return 'bill'
    if (['confirmed', 'confirmed_legacy'].includes(receivingStatus(purchase))) return 'stockAdded'
    return 'pending'
  }

  const purchaseStatusVariant = (purchase: PurchaseRow): 'success' | 'warning' | 'danger' | 'neutral' => {
    if (isDeletedPurchase(purchase)) return 'danger'
    if (purchaseMode(purchase) === 'simple_bill') return 'neutral'
    if (['confirmed', 'confirmed_legacy'].includes(receivingStatus(purchase))) return 'success'
    return 'warning'
  }

  const openDelete = (purchase: PurchaseRow) => {
    setDeleteTarget(purchase)
    setDeleteConfirmed(false)
    setDeleteError('')
  }

  const closeDelete = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteConfirmed(false)
    setDeleteError('')
  }

  const openAdd = () => {
    setEditingPurchase(null)
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditingPurchase(null)
  }

  const openEdit = (purchase: PurchaseRow) => {
    if (!canEditPurchase(purchase)) return
    setEditingPurchase(purchase)
    setDrawerOpen(true)
  }

  const deletePurchaseBill = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')

    const fn = purchaseMode(deleteTarget) === 'simple_bill'
      ? 'delete_purchase_bill'
      : 'delete_purchase_receiving'

    const { error } = await (supabase as any).rpc(fn, {
      p_purchase_id: deleteTarget.id,
      p_confirm: deleteConfirmed,
    })

    if (error) {
      console.error('[PurchaseHistoryTab] delete failed', error)
      setDeleteError(t('purchases:errors.saveFailed'))
      setDeleting(false)
      return
    }

    setDeleting(false)
    setDeleteTarget(null)
    setDeleteConfirmed(false)
    await load()
  }

  const openBillAttachment = async (purchase: PurchaseRow) => {
    const opened = window.open('', '_blank', 'noopener,noreferrer')

    try {
      let url = purchase.bill_url

      if (purchase.bill_path) {
        const { data, error } = await supabase.storage
          .from('purchases-bills')
          .createSignedUrl(purchase.bill_path, 60 * 5)

        if (error) throw error
        url = data.signedUrl
      }

      if (!url) throw new Error('No bill attachment found')

      await (supabase as any).rpc('record_purchase_attachment_viewed', {
        p_purchase_id: purchase.id,
      }).catch(() => undefined)

      if (opened) {
        opened.location.href = url
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      if (opened) opened.close()
      console.error('[PurchaseHistoryTab] unable to open bill attachment', err)
      alert(t('purchases:unableOpenBill'))
    }
  }

  // Summary stats
  const countedPurchases = purchases.filter(isCountedPurchase)
  const totalSpent     = countedPurchases.reduce((s, p) => s + p.total_amount, 0)
  const totalVat       = countedPurchases.reduce((s, p) => s + p.vat_amount,   0)

  return (
    <div className="space-y-4">

      {/* ── Header row ──────────────────────────────────────── */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex gap-3 flex-1 flex-wrap min-w-0">
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-[#173f2a]/70 shadow-card">
            <p className="text-xs font-medium text-gray-500">{t('purchases:totalPurchased')}</p>
            <p className="text-lg font-bold text-primary-700 mt-0.5"><Rial amount={totalSpent} /></p>
            <p className="text-[10px] text-gray-500 mt-0.5">{t('purchases:purchaseCount', { count: purchases.length })}</p>
          </div>
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-[#173f2a]/70 shadow-card">
            <p className="text-xs font-medium text-gray-400">{t('purchases:vatPaid')}</p>
            <p className="text-lg font-bold text-amber-600 mt-0.5"><Rial amount={totalVat} /></p>
            <p className="text-[10px] text-gray-400 mt-0.5">{t('purchases:allPurchases')}</p>
          </div>
          <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-[#173f2a]/70 shadow-card">
            <p className="text-xs font-medium text-gray-400">{t('purchases:suppliersUsed')}</p>
            <p className="text-lg font-bold text-gray-900 mt-0.5">
              {new Set(purchases.map(p => p.supplier_id).filter(Boolean)).size}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">{t('purchases:uniqueVendors')}</p>
          </div>
        </div>
        <Button size="sm" onClick={openAdd} className="flex-shrink-0 self-start">
          <Plus size={14} />
          {t('purchases:new')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CompactDateRangeFilter
          preset={datePreset}
          startDate={startDate}
          endDate={endDate}
          presets={COMPACT_DATE_PRESETS}
          onPreset={handleDatePreset}
          onStartDate={value => { setDatePreset('custom'); setStartDate(value) }}
          onEndDate={value => { setDatePreset('custom'); setEndDate(value) }}
        />
        {startDate && endDate && (
          <p className="text-xs text-gray-400">
            {t('purchases:showingRange', { range: formatDateRangeLabel(startDate, endDate) })}
          </p>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : purchases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <ShoppingCart size={22} className="text-emerald-300" />
          </div>
          <p className="text-gray-700 font-semibold">{t('purchases:noneRange')}</p>
          <p className="text-gray-400 text-sm mt-1 max-w-xs">
            {t('purchases:noneRangeHint')}
          </p>
          <Button className="mt-5" onClick={openAdd}>
            <Plus size={15} />
            {t('purchases:new')}
          </Button>
        </div>
      ) : (
        <>
        <div className="grid gap-3 md:hidden" aria-label={t('purchases:title')}>
          {purchases.map(p => (
            <article key={p.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-bold text-gray-900">
                    {p.suppliers ? dn(p.suppliers.name, p.suppliers.name_ar) : t('purchases:noSupplierLower')}
                  </h3>
                  <p className="mt-1 break-words text-xs text-gray-500" dir="auto">
                    {p.bill_number || p.notes || (purchaseMode(p) === 'simple_bill' ? t('purchases:mode.bill') : t('purchases:mode.stock'))}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-black tabular-nums text-gray-900" dir="ltr"><Rial amount={p.total_amount} /></p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-gray-600" dir="ltr">{new Date(p.purchase_date).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB')}</span>
                <Badge variant={PAY_BADGE[p.payment_method] ?? 'neutral'}>{t(`purchases:paymentMethod.${p.payment_method}`, { defaultValue: t('purchases:paymentMethod.unknown') })}</Badge>
                <Badge variant={purchaseStatusVariant(p)} dot>{t(`purchases:status.${purchaseStatusLabel(p)}`, { defaultValue: t('purchases:status.unknown') })}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-1 border-t border-gray-100 pt-3">
                {p.bill_path || p.bill_url ? <button type="button" onClick={() => openBillAttachment(p)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50"><Paperclip size={14} />{t('purchases:fields.bill')}</button> : null}
                <button type="button" onClick={() => viewDetails(p)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-gray-700 hover:bg-gray-100"><Eye size={14} />{t('purchases:actions.view')}</button>
                {canEditPurchase(p) && <button type="button" onClick={() => openEdit(p)} aria-label={t('purchases:actions.edit')} className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100"><Pencil size={14} /></button>}
                {canDeletePurchase(p) && <button type="button" onClick={() => openDelete(p)} aria-label={t('purchases:actions.delete')} className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-600 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>}
              </div>
            </article>
          ))}
        </div>
        <div className="card hidden overflow-hidden md:block">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="w-24 flex-shrink-0">{t('purchases:fields.date')}</div>
            <div className="flex-1">{t('purchases:fields.supplier')}</div>
            <div className="w-16 text-center hidden sm:block">{t('purchases:fields.item')}</div>
            <div className="w-20 hidden lg:block">{t('purchases:fields.method')}</div>
            <div className="w-24 hidden md:block text-end">{t('purchases:fields.vat')}</div>
            <div className="w-32 text-end">{t('purchases:fields.total')}</div>
            <div className="w-20 flex-shrink-0 text-center">{t('purchases:fields.bill')}</div>
            <div className="w-36 flex-shrink-0 text-center" />
          </div>

          {purchases.map(p => (
            <div key={p.id}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50/70 transition-colors">

              {/* Date */}
              <div className="w-24 flex-shrink-0">
                <p className="text-sm font-medium text-gray-900">
                  {new Date(p.purchase_date).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB', {
                    day: '2-digit', month: 'short',
                  })}
                </p>
                <p className="text-[10px] text-gray-400">
                  {new Date(p.purchase_date).getFullYear()}
                </p>
              </div>

              {/* Supplier */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {p.suppliers ? dn(p.suppliers.name, p.suppliers.name_ar) : <span className="text-gray-400 font-normal">{t('purchases:noSupplierLower')}</span>}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {purchaseMode(p) === 'simple_bill' ? t('purchases:mode.bill') : t('purchases:mode.stock')}
                  {p.bill_number ? ` · Bill ${p.bill_number}` : ''}
                  {p.notes ? ` · ${p.notes}` : ''}
                </p>
                <div className="mt-1">
                  <Badge variant={purchaseStatusVariant(p)} dot>
                    {t(`purchases:status.${purchaseStatusLabel(p)}`, { defaultValue: t('purchases:status.unknown') })}
                  </Badge>
                </div>
              </div>

              {/* Item count */}
              <div className="w-16 text-center hidden sm:block">
                <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {purchaseMode(p) === 'simple_bill'
                    ? t('purchases:mode.bill')
                    : t('purchases:itemCount', { count: p.purchase_items.length })}
                </span>
              </div>

              {/* Payment method */}
              <div className="w-20 hidden lg:block">
                <Badge variant={PAY_BADGE[p.payment_method] ?? 'neutral'}>
                  {t(`purchases:paymentMethod.${p.payment_method}`, { defaultValue: t('purchases:paymentMethod.unknown') })}
                </Badge>
              </div>

              {/* VAT */}
              <div className="w-24 hidden md:block text-right">
                <p className="text-xs tabular-nums text-amber-600 font-medium">
                  {p.vat_amount > 0 ? <Rial amount={p.vat_amount} /> : '—'}
                </p>
              </div>

              {/* Total */}
              <div className="w-32 text-right">
                <p className="text-sm font-bold text-gray-900 tabular-nums">
                  <Rial amount={p.total_amount} />
                </p>
              </div>

              {/* Bill indicator */}
              <div className="w-20 flex-shrink-0 flex justify-center">
                {p.bill_path || p.bill_url ? (
                  <button type="button"
                    onClick={e => { e.stopPropagation(); openBillAttachment(p) }}
                    className="flex items-center gap-1 text-[10px] font-medium text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg transition-colors">
                    <Paperclip size={10} />
                    {t('purchases:fields.bill')}
                  </button>
                ) : (
                  <span className="text-gray-300 text-xs">—</span>
                )}
              </div>

              {/* Actions */}
              <div className="w-36 flex-shrink-0 flex justify-center gap-1">
                <button
                  onClick={() => viewDetails(p)}
                  className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  title={t('purchases:actions.view')}
                >
                  <Eye size={14} />
                </button>
                {canEditPurchase(p) && (
                  <button
                    onClick={() => openEdit(p)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                    title={t('purchases:actions.edit')}
                  >
                    <Pencil size={14} />
                  </button>
                )}
                {canDeletePurchase(p) && (
                  <button
                    onClick={() => openDelete(p)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title={t('purchases:actions.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Footer total */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-t border-gray-100">
            <div className="w-24 flex-shrink-0 text-xs font-semibold text-gray-500">
              {t('purchases:purchaseCount', { count: purchases.length })}
            </div>
            <div className="flex-1" />
            <div className="w-16 hidden sm:block" />
            <div className="w-20 hidden lg:block" />
            <div className="w-24 hidden md:block text-right">
              <p className="text-xs font-bold text-amber-600 tabular-nums"><Rial amount={totalVat} /></p>
            </div>
            <div className="w-32 text-right">
              <p className="text-sm font-bold text-primary-600 tabular-nums"><Rial amount={totalSpent} /></p>
              <p className="text-[10px] text-gray-400">{t('purchases:totalSpent')}</p>
            </div>
            <div className="w-20" />
            <div className="w-36" />
          </div>
        </div>
        </>
      )}

      <PurchaseBillModal
        open={drawerOpen}
        suppliers={suppliers}
        tenantId={profile?.tenant_id ?? ''}
        branchId={profile?.branch_id ?? ''}
        editingPurchase={editingPurchase}
        onClose={closeDrawer}
        onSaved={load}
      />

      {viewingPurchase && (
        <PurchaseDetailModal
          purchase={viewingPurchase}
          items={viewingItems}
          loading={loadingItems}
          onClose={() => { setViewingPurchase(null); setViewingItems([]) }}
          onOpenBill={openBillAttachment}
        />
      )}

      {deleteTarget && (
        <DeletePurchaseModal
          purchase={deleteTarget}
          deleting={deleting}
          error={deleteError}
          confirmed={deleteConfirmed}
          onConfirmed={setDeleteConfirmed}
          onClose={closeDelete}
          onDelete={deletePurchaseBill}
        />
      )}

    </div>
  )
}
