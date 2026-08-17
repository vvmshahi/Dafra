import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Archive, Search, Phone, MapPin, User, Building2, BarChart3, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { ContentState } from '@/components/ui/ContentState'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Supplier } from '@/types'
import SupplierModal from './SupplierModal'
import { useTranslation } from 'react-i18next'
import {
  CompactDateRangeFilter,
  type DatePreset,
  formatDateRangeLabel,
  getDateRange,
} from '@/pages/reports/reportUtils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { archiveEntity, type ArchiveEntityClient } from '@/lib/archiveEntity'
import { toast } from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupplierWithStats extends Supplier {
  total_purchases:    number
  total_vat:          number
  purchase_count:     number
  last_purchase_date: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const { profile } = useAuth()
  const { t, i18n } = useTranslation(['suppliers', 'supplierIntelligence'])

  const [suppliers,   setSuppliers]   = useState<SupplierWithStats[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editing,     setEditing]     = useState<Supplier | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<SupplierWithStats | null>(null)
  const [archivingIds, setArchivingIds] = useState<Set<string>>(() => new Set())
  const [preset,      setPreset]      = useState<DatePreset>('this_month')
  const initialRange = getDateRange('this_month')
  const [startDate,   setStartDate]   = useState(initialRange.start)
  const [endDate,     setEndDate]     = useState(initialRange.end)

  const handlePreset = (nextPreset: DatePreset) => {
    setPreset(nextPreset)
    if (nextPreset !== 'custom') {
      const range = getDateRange(nextPreset)
      setStartDate(range.start)
      setEndDate(range.end)
    }
  }

  const load = useCallback(async () => {
    const bid = profile?.branch_id
    if (!bid) { setLoading(false); return }
    if (!startDate || !endDate) return
    setLoading(true)

    const [{ data: suppData }, totalsResult] = await Promise.all([
      supabase
        .from('suppliers')
        .select('*')
        .eq('branch_id', bid)
        .eq('is_active', true)
        .order('name'),
      (supabase as any).rpc('get_supplier_purchase_totals', {
        p_branch_id: bid,
        p_start_date: startDate,
        p_end_date: endDate,
      }),
    ])

    if (totalsResult.error) {
      console.error('[SuppliersPage] get_supplier_purchase_totals failed', totalsResult.error)
    }

    const totalsPayload = totalsResult.data as Record<string, unknown> | null
    const totalsRows = (
      Array.isArray(totalsPayload?.supplierTotals)
        ? totalsPayload?.supplierTotals
        : Array.isArray(totalsPayload?.supplier_totals)
        ? totalsPayload?.supplier_totals
        : []
    ) as Record<string, unknown>[]
    const aggMap = new Map<string, { total: number; vat: number; count: number; lastDate: string | null }>()
    for (const row of totalsRows) {
      const supplierId = stringOrNull(row.supplierId) ?? stringOrNull(row.supplier_id)
      if (!supplierId) continue
      aggMap.set(supplierId, {
        total: numberOrZero(row.totalPurchased ?? row.total_purchased),
        vat: numberOrZero(row.totalVat ?? row.total_vat),
        count: Math.trunc(numberOrZero(row.purchaseCount ?? row.purchase_count)),
        lastDate: stringOrNull(row.lastPurchaseDate) ?? stringOrNull(row.last_purchase_date),
      })
    }

    setSuppliers(
      ((suppData ?? []) as unknown as Supplier[]).map(s => ({
        ...s,
        total_purchases:    aggMap.get(s.id)?.total ?? 0,
        total_vat:          aggMap.get(s.id)?.vat ?? 0,
        purchase_count:     aggMap.get(s.id)?.count ?? 0,
        last_purchase_date: aggMap.get(s.id)?.lastDate ?? null,
      }))
    )
    setLoading(false)
  }, [profile?.branch_id, startDate, endDate])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setEditing(null); setDrawerOpen(true) }
  const openEdit = (s: Supplier) => { setEditing(s); setDrawerOpen(true) }

  const handleArchive = async () => {
    const target = archiveTarget
    if (!target || archivingIds.has(target.id)) return
    setArchivingIds(previous => new Set(previous).add(target.id))
    try {
      await archiveEntity(supabase as unknown as ArchiveEntityClient, 'suppliers', target.id)
      setSuppliers(prev => prev.filter(supplier => supplier.id !== target.id))
      setArchiveTarget(null)
      toast.success(t('success.archived'))
    } catch {
      toast.error(t('errors.archiveFailed'))
    } finally {
      setArchivingIds(previous => {
        const next = new Set(previous)
        next.delete(target.id)
        return next
      })
    }
  }

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      (s.name_ar ?? '').includes(q) ||
      (s.vat_number ?? '').includes(q) ||
      (s.cr_number ?? '').includes(q) ||
      (s.contact_person ?? '').toLowerCase().includes(q) ||
      (s.phone ?? '').includes(q)
    )
  })

  const totalPurchased = suppliers.reduce((s, sup) => s + sup.total_purchases, 0)
  const creditCount    = suppliers.filter(s => s.payment_terms !== 'cash').length
  const rangeLabel = formatDateRangeLabel(startDate, endDate)

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────── */}
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={(
          <>
            <Link
              to="/reports/suppliers"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#cfd9d1] bg-[#fffdf7] px-3 py-1.5 text-xs font-semibold text-[#31543f] shadow-sm transition-colors hover:border-[#9fb6a4] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173f2a]"
            >
              <BarChart3 size={14} />
              {t('supplierIntelligence:reports.openReports')}
            </Link>
            <Button size="sm" className="bg-[#173f2a] text-[#fff8e7] shadow-[0_4px_12px_rgba(15,36,25,0.18)] hover:bg-[#22563b] focus-visible:ring-[#173f2a]" onClick={openAdd}>
              <Plus size={14} />
              {t('add')}
            </Button>
          </>
        )}
      />

      {/* ── Summary cards ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-[#f7f8f8] px-4 py-3 shadow-[0_2px_10px_rgba(29,45,38,0.06)]">
          <p className="text-xs font-medium text-slate-500">{t('totalSuppliers')}</p>
          <p className="mt-0.5 text-xl font-bold text-slate-800">{suppliers.length}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">{t('activeVendors')}</p>
        </div>
        <div className="rounded-xl border border-[#31543f] bg-[#173f2a] px-4 py-3 shadow-[0_4px_12px_rgba(15,36,25,0.14)]">
          <p className="text-xs font-medium text-[#fff8e7]/75">{t('totalPurchased')}</p>
          <p className="mt-0.5 text-xl font-bold text-[#fff8e7]"><Rial amount={totalPurchased} /></p>
          <p className="mt-0.5 text-[10px] text-[#fff8e7]/65">{rangeLabel || t('selectedRange')}</p>
        </div>
        <div className="rounded-xl border border-[#b8d5d0] bg-[#edf6f4] px-4 py-3 shadow-[0_2px_10px_rgba(29,45,38,0.06)]">
          <p className="text-xs font-medium text-[#426965]">{t('creditTermsCount')}</p>
          <p className="mt-0.5 text-xl font-bold text-[#285e61]">{creditCount}</p>
          <p className="mt-0.5 text-[10px] text-[#426965]">{t('creditTermsSummary')}</p>
        </div>
      </div>

      {/* ── Filters + search ────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <CompactDateRangeFilter
            preset={preset}
            startDate={startDate}
            endDate={endDate}
            onPreset={handlePreset}
            onStartDate={value => { setPreset('custom'); setStartDate(value) }}
            onEndDate={value => { setPreset('custom'); setEndDate(value) }}
          />
          {rangeLabel && (
            <p className="text-xs text-gray-400">
              {t('purchasesFrom', { range: rangeLabel })}
            </p>
          )}
        </div>
        <div className="relative">
          <Search size={15} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="input ps-9"
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <ContentState kind="loading" className="py-20" />
      ) : filtered.length === 0 ? (
        <ContentState
          kind="empty"
          icon={Building2}
          title={t(search ? 'noneFound' : 'noneYet')}
          description={t(search ? 'trySearch' : 'emptyHint')}
          action={!search ? (
            <Button className="bg-[#173f2a] text-[#fff8e7] shadow-[0_4px_12px_rgba(15,36,25,0.18)] hover:bg-[#22563b] focus-visible:ring-[#173f2a]" onClick={openAdd}>
              <Plus size={15} />
              {t('add')}
            </Button>
          ) : undefined}
          className="py-20"
        />
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="flex-1">{t('columns.supplier')}</div>
            <div className="w-36 hidden md:block">{t('columns.contact')}</div>
            <div className="w-24 hidden sm:block">{t('columns.city')}</div>
            <div className="w-24 hidden lg:block">{t('columns.terms')}</div>
            <div className="w-40 text-end">{t('columns.purchased')}</div>
            <div className="w-24 flex-shrink-0" />
          </div>

          {filtered.map(supplier => (
            <div key={supplier.id}
              className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50/70 transition-colors">

              {/* Name + IDs */}
              <div className="flex-1 min-w-0 flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <Building2 size={15} className="text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <Link
                    to={`/suppliers/${supplier.id}`}
                    className="text-sm font-semibold text-gray-900 hover:text-primary-700 truncate block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    dir="auto"
                  >
                    {dn(supplier.name, supplier.name_ar)}
                  </Link>
                  {supplier.vat_number && (
                    <p className="text-[10px] text-gray-400">{t('vatShort')}: <bdi dir="ltr">{supplier.vat_number}</bdi></p>
                  )}
                </div>
              </div>

              {/* Contact */}
              <div className="w-36 hidden md:block min-w-0">
                {supplier.contact_person && (
                  <p className="text-xs text-gray-700 flex items-center gap-1 truncate">
                    <User size={10} className="text-gray-400 flex-shrink-0" />
                    <span dir="auto">{supplier.contact_person}</span>
                  </p>
                )}
                {supplier.phone && (
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <Phone size={10} className="text-gray-400 flex-shrink-0" />
                    <bdi dir="ltr">{supplier.phone}</bdi>
                  </p>
                )}
              </div>

              {/* City */}
              <div className="w-24 hidden sm:block">
                {supplier.city && (
                  <p className="text-xs text-gray-600 flex items-center gap-1">
                    <MapPin size={10} className="text-gray-400 flex-shrink-0" />
                    <span dir="auto">{supplier.city}</span>
                  </p>
                )}
              </div>

              {/* Terms */}
              <div className="w-24 hidden lg:block">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  supplier.payment_terms === 'cash'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}>
                  {supplier.payment_terms === 'cash' ? t('terms.cash') : supplier.payment_terms === 'credit_30' ? t('terms.net30') : supplier.payment_terms === 'credit_60' ? t('terms.net60') : t('terms.unknown')}
                </span>
              </div>

              {/* Total purchases */}
              <div className="w-40 text-end">
                <p className="text-sm font-bold text-gray-900 tabular-nums">
                  <Rial amount={supplier.total_purchases} />
                </p>
                {supplier.last_purchase_date ? (
                  <p className="text-[10px] text-gray-400">
                    {t('purchaseCount', { count: supplier.purchase_count })} · {t('lastPurchase', { date: new Date(supplier.last_purchase_date).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB', {
                      day: '2-digit', month: 'short', year: '2-digit',
                    }) })}
                  </p>
                ) : (
                  <p className="text-[10px] text-gray-300">{t('noPurchases')}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 w-24 justify-end">
                <Link
                  to={`/suppliers/${supplier.id}`}
                  aria-label={t('supplierIntelligence:actions.viewActivity')}
                  title={t('supplierIntelligence:actions.viewActivity')}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-amber-50 hover:text-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <ChevronRight size={14} className={i18n.resolvedLanguage === 'ar-SA' ? 'rotate-180' : ''} />
                </Link>
                <button onClick={() => openEdit(supplier)}
                  aria-label={t('edit')}
                  title={t('edit')}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <Pencil size={14} />
                </button>
                <button onClick={() => setArchiveTarget(supplier)}
                  aria-label={t(archivingIds.has(supplier.id) ? 'actions.archiving' : 'actions.archive')}
                  title={t('actions.archive')}
                  disabled={archivingIds.has(supplier.id)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-600 hover:bg-amber-50 hover:text-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-wait disabled:opacity-50">
                  {archivingIds.has(supplier.id) ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SupplierModal
        open={drawerOpen}
        supplier={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
      <ConfirmDialog
        open={archiveTarget !== null}
        kind="supplierArchive"
        name={archiveTarget?.name}
        busy={archiveTarget ? archivingIds.has(archiveTarget.id) : false}
        confirmVariant="gold"
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => void handleArchive()}
      />
    </div>
  )
}
