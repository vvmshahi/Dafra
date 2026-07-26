import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, Search, Phone, MapPin, User, Building2, BarChart3, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Supplier } from '@/types'
import SupplierDrawer from './SupplierDrawer'
import { useTranslation } from 'react-i18next'
import {
  CompactDateRangeFilter,
  type DatePreset,
  formatDateRangeLabel,
  getDateRange,
} from '@/pages/reports/reportUtils'

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

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t('deleteConfirm', { name }))) return
    const q = supabase as unknown as { from: (t: string) => any }
    const { error } = await q.from('suppliers').update({ is_active: false }).eq('id', id)
    if (error) { console.error('[SuppliersPage] delete failed', error); return }
    setSuppliers(prev => prev.filter(s => s.id !== id))
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">{t('title')}</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/reports/suppliers">
            <Button size="sm" variant="secondary">
              <BarChart3 size={14} />
              {t('supplierIntelligence:reports.openReports')}
            </Button>
          </Link>
          <Button size="sm" onClick={openAdd}>
            <Plus size={14} />
            {t('add')}
          </Button>
        </div>
      </div>

      {/* ── Summary cards ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
          <p className="text-xs font-medium text-gray-400">{t('totalSuppliers')}</p>
          <p className="text-xl font-bold text-gray-900 mt-0.5">{suppliers.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{t('activeVendors')}</p>
        </div>
        <div className="rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
          <p className="text-xs font-medium text-gray-400">{t('totalPurchased')}</p>
          <p className="text-xl font-bold text-emerald-600 mt-0.5"><Rial amount={totalPurchased} /></p>
          <p className="text-[10px] text-gray-400 mt-0.5">{rangeLabel || t('selectedRange')}</p>
        </div>
        <div className="rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
          <p className="text-xs font-medium text-gray-400">{t('creditTermsCount')}</p>
          <p className="text-xl font-bold text-amber-600 mt-0.5">{creditCount}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{t('creditTermsSummary')}</p>
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
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <Building2 size={22} className="text-emerald-300" />
          </div>
          <p className="text-gray-700 font-semibold">
            {search ? t('noneFound') : t('noneYet')}
          </p>
          <p className="text-gray-400 text-sm mt-1 max-w-xs">
            {search
              ? t('trySearch')
              : t('emptyHint')}
          </p>
          {!search && (
            <Button className="mt-5" onClick={openAdd}>
              <Plus size={15} />
              {t('add')}
            </Button>
          )}
        </div>
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
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-amber-50 hover:text-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <ChevronRight size={14} className={i18n.resolvedLanguage === 'ar-SA' ? 'rotate-180' : ''} />
                </Link>
                <button onClick={() => openEdit(supplier)}
                  aria-label={t('edit')}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  <Pencil size={14} />
                </button>
                <button onClick={() => handleDelete(supplier.id, supplier.name)}
                  aria-label={t('deleteConfirm', { name: supplier.name })}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SupplierDrawer
        open={drawerOpen}
        supplier={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  )
}
