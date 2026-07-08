import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Search, Phone, MapPin, User, Building2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Supplier } from '@/types'
import SupplierDrawer from './SupplierDrawer'
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

const TERMS_LABEL: Record<string, string> = {
  cash: 'Cash', credit_30: 'Net 30', credit_60: 'Net 60',
}

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
    if (!confirm(`Delete supplier "${name}"?`)) return
    const q = supabase as unknown as { from: (t: string) => any }
    await q.from('suppliers').update({ is_active: false }).eq('id', id)
    setSuppliers(prev => prev.filter(s => s.id !== id))
  }

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase()
    return (
      s.name.toLowerCase().includes(q) ||
      (s.name_ar ?? '').includes(q) ||
      (s.vat_number ?? '').includes(q) ||
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
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">Suppliers</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Manage your supply chain and purchase relationships
          </p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus size={14} />
          Add Supplier
        </Button>
      </div>

      {/* ── Summary cards ───────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
          <p className="text-xs font-medium text-gray-400">Total Suppliers</p>
          <p className="text-xl font-bold text-gray-900 mt-0.5">{suppliers.length}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">active vendors</p>
        </div>
        <div className="rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
          <p className="text-xs font-medium text-gray-400">Total Purchased</p>
          <p className="text-xl font-bold text-emerald-600 mt-0.5"><Rial amount={totalPurchased} /></p>
          <p className="text-[10px] text-gray-400 mt-0.5">{rangeLabel || 'selected range'}</p>
        </div>
        <div className="rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
          <p className="text-xs font-medium text-gray-400">On Credit Terms</p>
          <p className="text-xl font-bold text-amber-600 mt-0.5">{creditCount}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Net 30 / Net 60</p>
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
              Purchases from <span className="font-medium text-gray-600">{rangeLabel}</span>
            </p>
          )}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder="Search by name, VAT number, contact person..."
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
            {search ? 'No suppliers found' : 'No suppliers yet'}
          </p>
          <p className="text-gray-400 text-sm mt-1 max-w-xs">
            {search
              ? 'Try a different search term'
              : 'Add your first supplier to track purchases and stock'}
          </p>
          {!search && (
            <Button className="mt-5" onClick={openAdd}>
              <Plus size={15} />
              Add Supplier
            </Button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="flex-1">Supplier</div>
            <div className="w-36 hidden md:block">Contact</div>
            <div className="w-24 hidden sm:block">City</div>
            <div className="w-24 hidden lg:block">Terms</div>
            <div className="w-40 text-right">Purchased in Range</div>
            <div className="w-16 flex-shrink-0" />
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
                  <p className="text-sm font-semibold text-gray-900 truncate">{dn(supplier.name, supplier.name_ar)}</p>
                  {supplier.vat_number && (
                    <p className="text-[10px] text-gray-400">VAT: {supplier.vat_number}</p>
                  )}
                </div>
              </div>

              {/* Contact */}
              <div className="w-36 hidden md:block min-w-0">
                {supplier.contact_person && (
                  <p className="text-xs text-gray-700 flex items-center gap-1 truncate">
                    <User size={10} className="text-gray-400 flex-shrink-0" />
                    {supplier.contact_person}
                  </p>
                )}
                {supplier.phone && (
                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                    <Phone size={10} className="text-gray-400 flex-shrink-0" />
                    {supplier.phone}
                  </p>
                )}
              </div>

              {/* City */}
              <div className="w-24 hidden sm:block">
                {supplier.city && (
                  <p className="text-xs text-gray-600 flex items-center gap-1">
                    <MapPin size={10} className="text-gray-400 flex-shrink-0" />
                    {supplier.city}
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
                  {TERMS_LABEL[supplier.payment_terms] ?? supplier.payment_terms}
                </span>
              </div>

              {/* Total purchases */}
              <div className="w-40 text-right">
                <p className="text-sm font-bold text-gray-900 tabular-nums">
                  <Rial amount={supplier.total_purchases} />
                </p>
                {supplier.last_purchase_date ? (
                  <p className="text-[10px] text-gray-400">
                    {supplier.purchase_count} purchase{supplier.purchase_count === 1 ? '' : 's'} · Last: {new Date(supplier.last_purchase_date).toLocaleDateString('en-GB', {
                      day: '2-digit', month: 'short', year: '2-digit',
                    })}
                  </p>
                ) : (
                  <p className="text-[10px] text-gray-300">No purchases yet</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 w-16 justify-end">
                <button onClick={() => openEdit(supplier)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                  <Pencil size={14} />
                </button>
                <button onClick={() => handleDelete(supplier.id, supplier.name)}
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
