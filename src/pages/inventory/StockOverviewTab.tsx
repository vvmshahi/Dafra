import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, AlertTriangle, Package } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { InventoryItem, Category, Supplier } from '@/types'
import StockItemDrawer from './StockItemDrawer'
import { useTranslation } from 'react-i18next'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategorySnap { name: string; name_ar: string | null; color: string | null; icon: string | null }
interface SupplierSnap  { name: string; name_ar: string | null }

interface ItemRow extends InventoryItem {
  categories: CategorySnap | null
  suppliers:  SupplierSnap | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UNIT_LABEL: Record<string, string> = {
  pieces: 'pcs', kg: 'kg', grams: 'g', liters: 'L',
  ml: 'ml', boxes: 'boxes', bags: 'bags', other: '',
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function stockStatus(item: InventoryItem): 'ok' | 'low' | 'out' {
  if (item.current_quantity <= 0) return 'out'
  if (item.minimum_quantity > 0 && item.current_quantity <= item.minimum_quantity) return 'low'
  return 'ok'
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SumCard({ label, value, sub, accent }: {
  label: string; value: React.ReactNode; sub?: string; accent?: 'green' | 'amber' | 'red'
}) {
  const vClx =
    accent === 'green' ? 'text-emerald-600' :
    accent === 'amber' ? 'text-amber-600'   :
    accent === 'red'   ? 'text-red-500'     :
    'text-gray-900'

  return (
    <div className="flex-1 min-w-36 rounded-xl px-4 py-3 bg-white border border-gray-100 shadow-card">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${vClx}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StockOverviewTab() {
  const { profile } = useAuth()
  const { t, i18n } = useTranslation('inventory')

  const [items,       setItems]       = useState<ItemRow[]>([])
  const [categories,  setCategories]  = useState<Category[]>([])
  const [suppliers,   setSuppliers]   = useState<Supplier[]>([])
  const [loading,     setLoading]     = useState(true)
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editing,     setEditing]     = useState<InventoryItem | null>(null)

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) { setLoading(false); return }

    const [{ data: itemData }, { data: catData }, { data: supData }] = await Promise.all([
      supabase
        .from('inventory_items')
        .select('*, categories(name,name_ar,color,icon), suppliers(name,name_ar)')
        .eq('branch_id', bid)
        .order('name'),
      supabase
        .from('categories')
        .select('*')
        .eq('tenant_id', tid)
        .eq('is_active', true)
        .order('sort_order')
        .order('name'),
      supabase
        .from('suppliers')
        .select('*')
        .eq('tenant_id', tid)
        .eq('is_active', true)
        .order('name'),
    ])

    setItems((itemData ?? []) as unknown as ItemRow[])
    setCategories((catData ?? []) as unknown as Category[])
    setSuppliers((supData ?? []) as unknown as Supplier[])
    setLoading(false)
  }, [profile?.tenant_id, profile?.branch_id])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setEditing(null); setDrawerOpen(true) }
  const openEdit = (item: InventoryItem) => { setEditing(item); setDrawerOpen(true) }

  // Summary stats
  const totalValue = items.reduce((s, i) => s + i.current_quantity * i.unit_cost, 0)
  const lowStock   = items.filter(i => stockStatus(i) !== 'ok').length
  const firstOfMonth = new Date(); firstOfMonth.setDate(1); firstOfMonth.setHours(0, 0, 0, 0)
  const addedThisMonth = items.filter(i => new Date(i.created_at) >= firstOfMonth).length

  return (
    <div className="space-y-4">

      {/* ── Header row ──────────────────────────────────────── */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex gap-3 flex-1 flex-wrap min-w-0">
          <SumCard label={t('materialMetrics.totalItems')} value={String(items.length)} sub={t('materialMetrics.inList')} />
          <SumCard label={t('metrics.totalValue')} value={<Rial amount={totalValue} />} sub={t('materialMetrics.currentCost')} accent="green" />
          <SumCard label={t('materialMetrics.lowOut')} value={String(lowStock)} sub={t('materialMetrics.restocking')} accent={lowStock > 0 ? 'amber' : undefined} />
          <SumCard label={t('materialMetrics.addedMonth')} value={String(addedThisMonth)} sub={t('materialMetrics.newItems')} />
        </div>
        <Button size="sm" onClick={openAdd} className="flex-shrink-0 self-start">
          <Plus size={14} />
          {t('addItem')}
        </Button>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
            <Package size={22} className="text-emerald-300" />
          </div>
          <p className="text-gray-700 font-semibold">{t('emptyItems')}</p>
          <p className="text-gray-400 text-sm mt-1 max-w-xs">
            {t('emptyItemsHint')}
          </p>
          <Button className="mt-5" onClick={openAdd}>
            <Plus size={15} />
            {t('addItem')}
          </Button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="flex-1">{t('columns.item')}</div>
            <div className="w-28 hidden md:block">{t('columns.category')}</div>
            <div className="w-28 text-end">{t('columns.quantity')}</div>
            <div className="w-28 hidden sm:block text-end">{t('columns.unitCost')}</div>
            <div className="w-28 text-end">{t('columns.totalValue')}</div>
            <div className="w-32 hidden lg:block">{t('columns.lastUpdated')}</div>
            <div className="w-10 flex-shrink-0" />
          </div>

          {items.map(item => {
            const status   = stockStatus(item)
            const catColor = item.categories?.color ?? '#6b7280'
            const catIcon  = item.categories?.icon  ?? ''
            const catName  = item.categories ? dn(item.categories.name, item.categories.name_ar) : null

            return (
              <div key={item.id}
                className={`flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors ${
                  status === 'out' ? 'bg-red-50/40' :
                  status === 'low' ? 'bg-amber-50/30' :
                  'hover:bg-gray-50/70'
                }`}>

                {/* Item name */}
                <div className="flex-1 min-w-0 flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
                    style={{ backgroundColor: catColor + '18' }}
                  >
                    {catIcon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate" dir="auto">{dn(item.name, item.name_ar)}</p>
                    {item.suppliers?.name && (
                      <p className="text-[10px] text-gray-400" dir="auto">{dn(item.suppliers.name, item.suppliers.name_ar)}</p>
                    )}
                  </div>
                </div>

                {/* Category */}
                <div className="w-28 hidden md:block">
                  {catName ? (
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: catColor + '22', color: catColor }}
                    >
                      {catName}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>

                {/* Quantity */}
                <div className="w-28 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {status !== 'ok' && (
                      <AlertTriangle size={12} className={
                        status === 'out' ? 'text-red-500' : 'text-amber-500'
                      } />
                    )}
                    <p className={`text-sm font-bold tabular-nums ${
                      status === 'out' ? 'text-red-600' :
                      status === 'low' ? 'text-amber-600' :
                      'text-gray-900'
                    }`}>
                      {item.current_quantity.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                      <span className="text-[10px] font-normal text-gray-400 ml-1">
                        {UNIT_LABEL[item.unit_type] ?? item.unit_type}
                      </span>
                    </p>
                  </div>
                  {status === 'out' && (
                    <p className="text-[10px] text-red-500 font-medium text-end">{t('status.outOfStock')}</p>
                  )}
                  {status === 'low' && (
                    <p className="text-[10px] text-amber-600 text-right">
                      {t('minimum', { value: `${item.minimum_quantity} ${UNIT_LABEL[item.unit_type]}` })}
                    </p>
                  )}
                </div>

                {/* Unit cost */}
                <div className="w-28 hidden sm:block text-right">
                  <p className="text-sm tabular-nums text-gray-700"><Rial amount={item.unit_cost} /></p>
                  <p className="text-[10px] text-gray-400">per {UNIT_LABEL[item.unit_type] || 'unit'}</p>
                </div>

                {/* Total value */}
                <div className="w-28 text-right">
                  <p className="text-sm font-semibold text-emerald-600 tabular-nums">
                    <Rial amount={item.current_quantity * item.unit_cost} />
                  </p>
                </div>

                {/* Last updated */}
                <div className="w-32 hidden lg:block">
                  <p className="text-xs text-gray-400">
                    {new Date(item.updated_at).toLocaleDateString(i18n.resolvedLanguage === 'ar-SA' ? 'ar-SA-u-nu-latn' : 'en-GB', {
                      day: '2-digit', month: 'short', year: '2-digit',
                    })}
                  </p>
                </div>

                {/* Edit */}
                <div className="w-10 flex-shrink-0 flex justify-end">
                  <button onClick={() => openEdit(item)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Footer total */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-t border-gray-100">
            <div className="flex-1 text-xs font-semibold text-gray-500">
              {t('itemsSummary', { count: items.length, attention: lowStock })}
            </div>
            <div className="w-28 hidden md:block" />
            <div className="w-28 text-right" />
            <div className="w-28 hidden sm:block" />
            <div className="w-28 text-right">
              <p className="text-sm font-bold text-emerald-600 tabular-nums">
                <Rial amount={totalValue} />
              </p>
              <p className="text-[10px] text-gray-400">{t('columns.totalValue')}</p>
            </div>
            <div className="w-32 hidden lg:block" />
            <div className="w-10" />
          </div>
        </div>
      )}

      <StockItemDrawer
        open={drawerOpen}
        item={editing}
        categories={categories}
        suppliers={suppliers}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  )
}
