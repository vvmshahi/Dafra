import { useState, useEffect, useCallback } from 'react'
import {
  Plus, LayoutGrid, List, Search, Tag, Pencil, Trash2, Package, X, FolderPlus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Category, VatTreatment } from '@/types'
import ProductDrawer from './ProductDrawer'
import CategoriesModal from './CategoriesModal'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategorySnap {
  name: string
  name_ar: string | null
  color: string | null
  icon: string | null
}

export interface ProductRow {
  id: string
  tenant_id: string
  category_id: string | null
  name: string
  name_ar: string | null
  description: string | null
  sku: string | null
  price: number
  image_url: string | null
  is_active: boolean
  is_available: boolean
  sort_order: number
  vat_treatment: VatTreatment
  notes: string | null
  is_service: boolean
  categories: CategorySnap | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VAT_LABELS: Record<VatTreatment, string> = {
  inherit:   'Branch Default',
  exclusive: 'Excl. VAT',
  inclusive: 'Incl. VAT',
  exempt:    'VAT Exempt',
}

const VAT_BADGE: Record<VatTreatment, 'neutral' | 'info' | 'gold'> = {
  inherit:   'neutral',
  exclusive: 'neutral',
  inclusive: 'info',
  exempt:    'gold',
}

const CATEGORY_ICON_PRESETS = [
  '🍔', '🍟', '🥤', '🌯', '🍕', '🍗', '🐟', '☕', '🍰',
  '🛍️', '📦', '🧾', '🏷️', '🛒', '🎁',
  '🛠️', '✂️', '🚗', '📱', '💻',
  '⭐', '🔥', '✅', '💳', '📊',
]

const normalizeIcon = (value: string) => value.trim() || '📦'

const isIconTooLong = (value: string) => Array.from(value.trim()).length > 10

// ── Category filter tab ───────────────────────────────────────────────────────

function CategoryTab({
  label, active, color, onClick,
}: {
  label: string; active: boolean; color?: string | null; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
      className={`flex-shrink-0 text-xs font-medium px-3.5 py-1.5 rounded-xl border transition-all duration-150 ${
        active
          ? 'bg-primary-500 border-primary-500 text-white shadow-sm'
          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800'
      }`}
    >
      {label}
    </button>
  )
}

// ── Product card (grid view) ──────────────────────────────────────────────────

function ProductCard({
  product, onEdit, onDelete, onToggle,
}: {
  product: ProductRow
  onEdit: () => void
  onDelete: () => void
  onToggle: (v: boolean) => void
}) {
  const color = product.categories?.color ?? '#6b7280'
  const icon  = product.categories?.icon  ?? '📦'
  const vat   = product.vat_treatment ?? 'inherit'

  return (
    <div className="card group relative flex flex-col hover:shadow-md transition-shadow duration-200 overflow-hidden">
      {/* Image / placeholder */}
      <div className="relative h-36 flex-shrink-0" style={{ backgroundColor: color + '18' }}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl select-none">{icon}</span>
          </div>
        )}

        {/* Availability status */}
        <button
          onClick={() => onToggle(!product.is_available)}
          title="Toggle POS availability"
          aria-label={`Mark ${product.name} as ${product.is_available ? 'unavailable' : 'available'}`}
          className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border shadow-sm transition-colors ${
            product.is_available
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              : 'bg-white/90 text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          {product.is_available ? 'Available' : 'Unavailable'}
        </button>

        {/* Touch-friendly action buttons */}
        <div className="absolute top-2 left-2 flex gap-1">
          <button
            onClick={onEdit}
            aria-label={`Edit ${product.name}`}
            className="w-7 h-7 bg-white/90 backdrop-blur-sm rounded-lg flex items-center justify-center shadow-sm border border-white/70 hover:bg-white hover:text-primary-600 transition-colors"
          >
            <Pencil size={12} className="text-gray-600" />
          </button>
          <button
            onClick={onDelete}
            aria-label={`Delete ${product.name}`}
            className="w-7 h-7 bg-white/90 backdrop-blur-sm rounded-lg flex items-center justify-center shadow-sm border border-white/70 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={12} className="text-red-500" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col flex-1 gap-1">
        <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-1">{dn(product.name, product.name_ar)}</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          {product.categories && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: color + '22', color }}
            >
              {dn(product.categories.name, product.categories.name_ar)}
            </span>
          )}
          <Badge variant={VAT_BADGE[vat]}>{VAT_LABELS[vat]}</Badge>
        </div>
        <p className="text-base font-bold text-primary-600 mt-auto pt-2">
          <Rial amount={Number(product.price)} />
        </p>
      </div>
    </div>
  )
}

// ── Product row (list view) ───────────────────────────────────────────────────

function ProductListRow({
  product, onEdit, onDelete, onToggle,
}: {
  product: ProductRow
  onEdit: () => void
  onDelete: () => void
  onToggle: (v: boolean) => void
}) {
  const color = product.categories?.color ?? '#6b7280'
  const icon  = product.categories?.icon  ?? '📦'
  const vat   = product.vat_treatment ?? 'inherit'

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
      {/* Thumbnail */}
      <div
        className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-lg overflow-hidden"
        style={{ backgroundColor: color + '18' }}
      >
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <span className="select-none">{icon}</span>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{dn(product.name, product.name_ar)}</p>
        {product.sku && <p className="text-[11px] text-gray-400">SKU: {product.sku}</p>}
      </div>

      {/* Category */}
      <div className="w-28 flex-shrink-0 hidden sm:block">
        {product.categories ? (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: color + '22', color }}
          >
            {product.categories.name}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </div>

      {/* VAT */}
      <div className="w-28 flex-shrink-0 hidden md:block">
        <Badge variant={VAT_BADGE[vat]}>{VAT_LABELS[vat]}</Badge>
      </div>

      {/* Price */}
      <div className="w-24 flex-shrink-0 text-right">
        <p className="text-sm font-bold text-primary-600"><Rial amount={Number(product.price)} /></p>
      </div>

      {/* Availability */}
      <button
        onClick={() => onToggle(!product.is_available)}
        className={`w-24 flex-shrink-0 text-center text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${
          product.is_available
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        }`}
      >
        {product.is_available ? 'Available' : 'Unavailable'}
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onEdit}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  filtered, onAdd, onClear,
}: {
  filtered: boolean
  onAdd: () => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
        <Package size={28} className="text-primary-300" />
      </div>
      <p className="text-gray-700 font-semibold">
        {filtered ? 'No products match your filters' : 'No products yet'}
      </p>
      <p className="text-gray-400 text-sm mt-1 max-w-xs">
        {filtered
          ? 'Try adjusting the search or category filter'
          : 'Add your first product to start selling on the POS'}
      </p>
      {!filtered && (
        <Button className="mt-5" onClick={onAdd}>
          <Plus size={15} />
          Add Product
        </Button>
      )}
      {filtered && (
        <Button variant="secondary" className="mt-5" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  )
}

function AddCategoryDialog({
  open, categories, onClose, onCreated,
}: {
  open: boolean
  categories: Category[]
  onClose: () => void
  onCreated: () => void
}) {
  const { profile } = useAuth()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📦')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setName('')
      setIcon('📦')
      setError('')
      setSaving(false)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) { setError('Category name is required'); return }
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) { setError('Branch context is required before adding categories.'); return }

    const cleanIcon = normalizeIcon(icon)
    if (isIconTooLong(cleanIcon)) { setError('Icon must be 10 characters or fewer.'); return }

    const duplicate = categories.some(cat =>
      cat.name.trim().toLowerCase() === cleanName.toLowerCase()
    )
    if (duplicate) { setError('Category already exists.'); return }

    setSaving(true)
    setError('')
    const nextSortOrder = categories.length
      ? Math.max(...categories.map(cat => Number(cat.sort_order ?? 0))) + 1
      : 0

    const q = supabase as unknown as { from: (t: string) => any }
    const { error: err } = await q.from('categories').insert({
      tenant_id: tid,
      branch_id: bid,
      name: cleanName,
      color: '#1c5c2e',
      icon: cleanIcon,
      sort_order: nextSortOrder,
    })

    if (err) {
      setError(err.message)
      setSaving(false)
      return
    }

    setSaving(false)
    onCreated()
    onClose()
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-lg max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">Add Category</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Create a new product category for this branch.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4 overflow-y-auto">
            <div className="flex items-start gap-3">
              <div className="w-16 flex-shrink-0">
                <label className="label">Icon</label>
                <div
                  className="w-14 h-11 rounded-xl border border-primary-200 bg-primary-50 text-2xl flex items-center justify-center"
                  aria-label="Selected category icon"
                >
                  {normalizeIcon(icon)}
                </div>
              </div>
              <div className="flex-1">
                <label className="label">Category name</label>
                <input
                  className="input"
                  value={name}
                  onChange={e => { setName(e.target.value); setError('') }}
                  placeholder="e.g. Beverages"
                  autoFocus
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 space-y-3">
              <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
                {CATEGORY_ICON_PRESETS.map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => { setIcon(preset); setError('') }}
                    className={`h-9 rounded-lg text-lg flex items-center justify-center transition-all ${
                      normalizeIcon(icon) === preset
                        ? 'bg-primary-100 ring-2 ring-primary-400'
                        : 'bg-white hover:bg-gray-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div>
                <label className="label text-xs">Custom icon</label>
                <input
                  className="input py-2 text-sm"
                  value={icon}
                  onChange={e => { setIcon(e.target.value); setError('') }}
                  maxLength={10}
                  placeholder="Paste emoji or short text"
                />
                <p className="text-[11px] text-gray-400 mt-1">Up to 10 characters. Empty uses 📦.</p>
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
              New categories are added to the end of your category order.
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              Add Category
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { profile } = useAuth()

  const [products,   setProducts]   = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading,    setLoading]    = useState(true)
  const [viewMode,   setViewMode]   = useState<'grid' | 'list'>('grid')
  const [search,     setSearch]     = useState('')
  const [activeCat,  setActiveCat]  = useState('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing,    setEditing]    = useState<ProductRow | null>(null)
  const [catsOpen,   setCatsOpen]   = useState(false)
  const [addCatOpen, setAddCatOpen] = useState(false)

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) { setLoading(false); return }

    const [{ data: prods }, { data: cats }] = await Promise.all([
      supabase
        .from('products')
        .select([
          'id', 'tenant_id', 'branch_id', 'category_id', 'name', 'name_ar', 'description',
          'sku', 'price', 'image_url', 'is_active', 'is_available', 'sort_order',
          'vat_treatment', 'notes', 'is_service',
          'categories(name,name_ar,color,icon)',
        ].join(','))
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name',       { ascending: true }),
      supabase
        .from('categories')
        .select('*')
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name',       { ascending: true }),
    ])

    setProducts((prods  ?? []) as unknown as ProductRow[])
    setCategories((cats ?? []) as unknown as Category[])
    setLoading(false)
  }, [profile?.tenant_id, profile?.branch_id])

  useEffect(() => { load() }, [load])

  const openAdd  = () => { setEditing(null); setDrawerOpen(true) }
  const openEdit = (p: ProductRow) => { setEditing(p); setDrawerOpen(true) }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this product? This cannot be undone.')) return
    const q = supabase as unknown as { from: (t: string) => any }
    await q.from('products').update({ is_active: false }).eq('id', id)
    setProducts(prev => prev.filter(p => p.id !== id))
  }

  const handleToggleAvailable = async (id: string, val: boolean) => {
    const q = supabase as unknown as { from: (t: string) => any }
    await q.from('products').update({ is_available: val }).eq('id', id)
    setProducts(prev => prev.map(p => p.id === id ? { ...p, is_available: val } : p))
  }

  const filtered = products.filter(p => {
    const query = search.trim()
    const q = query.toLowerCase()
    const matchSearch = !query
      || p.name.toLowerCase().includes(q)
      || (p.name_ar ?? '').includes(query)
      || (p.sku ?? '').toLowerCase().includes(q)
    const matchCat = activeCat === 'all' || p.category_id === activeCat
    return matchSearch && matchCat
  })

  const isFiltered = search.length > 0 || activeCat !== 'all'

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <h1 className="text-lg font-bold text-gray-900">Products</h1>
          {!loading && (
            <span className="text-xs font-semibold bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full">
              {products.length}
            </span>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCatsOpen(true)}>
          <Tag size={14} />
          Manage Categories
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setAddCatOpen(true)}>
          <FolderPlus size={14} />
          Add Category
        </Button>
        <Button size="sm" onClick={openAdd}>
          <Plus size={14} />
          Add Product
        </Button>
      </div>

      {/* ── Category filter tabs ────────────────────────────────── */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <CategoryTab
            label="All"
            active={activeCat === 'all'}
            onClick={() => setActiveCat('all')}
          />
          {categories.map(c => (
            <CategoryTab
              key={c.id}
              label={`${c.icon ?? '📦'} ${c.name}`}
              active={activeCat === c.id}
              color={c.color}
              onClick={() => setActiveCat(c.id)}
            />
          ))}
        </div>
      )}

      {/* ── Search + view toggle ────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, Arabic name, or SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9 py-2 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-white border border-gray-200 rounded-xl p-0.5 flex-shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-[10px] transition-colors ${
              viewMode === 'grid' ? 'bg-primary-500 text-white' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-[10px] transition-colors ${
              viewMode === 'list' ? 'bg-primary-500 text-white' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <List size={15} />
          </button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-24">
          <LoadingSpinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          filtered={isFiltered}
          onAdd={openAdd}
          onClear={() => { setSearch(''); setActiveCat('all') }}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              onEdit={() => openEdit(p)}
              onDelete={() => handleDelete(p.id)}
              onToggle={v => handleToggleAvailable(p.id, v)}
            />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* List header */}
          <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
            <div className="w-10 flex-shrink-0" />
            <div className="flex-1">Product</div>
            <div className="w-28 flex-shrink-0 hidden sm:block">Category</div>
            <div className="w-28 flex-shrink-0 hidden md:block">VAT</div>
            <div className="w-24 flex-shrink-0 text-right">Price</div>
            <div className="w-24 flex-shrink-0 text-center">Status</div>
            <div className="w-16 flex-shrink-0" />
          </div>
          {filtered.map(p => (
            <ProductListRow
              key={p.id}
              product={p}
              onEdit={() => openEdit(p)}
              onDelete={() => handleDelete(p.id)}
              onToggle={v => handleToggleAvailable(p.id, v)}
            />
          ))}
        </div>
      )}

      {/* ── Drawers / Modals ────────────────────────────────────── */}
      <ProductDrawer
        open={drawerOpen}
        product={editing}
        categories={categories}
        products={products}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
      <CategoriesModal
        open={catsOpen}
        categories={categories}
        products={products}
        onClose={() => setCatsOpen(false)}
        onChanged={load}
      />
      <AddCategoryDialog
        open={addCatOpen}
        categories={categories}
        onClose={() => setAddCatOpen(false)}
        onCreated={load}
      />
    </div>
  )
}
