import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Plus, LayoutGrid, List, Search, Tag, Pencil, Archive, Package, X, Printer,
  Barcode, AlertTriangle, RefreshCw, Building2, ArrowLeftRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PageHeader } from '@/components/ui/PageHeader'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial, sarStr } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Branch, Category, VatTreatment } from '@/types'
import ProductDrawer from './ProductDrawer'
import CategoriesModal from './CategoriesModal'
import { CategoryEmojiPicker } from '@/components/ui/CategoryEmojiPicker'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import BarcodeBatchPrintDrawer from '@/components/barcodes/BarcodeBatchPrintDrawer'
import BarcodeQuickPrintDialog, {
  type BarcodeQuickPrintChoice,
} from '@/components/barcodes/BarcodeQuickPrintDialog'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { normalizeBarcode, type BarcodeType } from '@/lib/barcodes/barcode'
import { getProductBarcodePrintStatus } from '@/lib/barcodes/labelApi'
import { isStockModuleVisible } from '@/lib/utils/businessType'
import {
  CATALOGUE_VAT_TONES,
  PRODUCTS_DEFAULT_VIEW,
  catalogueStockStatus,
  catalogueTextMatches,
} from '@/lib/products/catalogue'
import { archiveProduct, type ProductArchiveClient } from '@/lib/products/archiveProduct'
import { useBranchBillingConfig } from '@/hooks/useBranchBillingConfig'
import {
  getCatalogueItemCreationCapabilities,
  getCataloguePresentation,
} from '@/lib/products/cataloguePresentation'
import { useSearchParams } from 'react-router-dom'
import CatalogueExportDialog from './CatalogueExportDialog'

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
  branch_id: string | null
  category_id: string | null
  name: string
  name_ar: string | null
  description: string | null
  sku: string | null
  barcode: string | null
  price: number
  stock_quantity: number | null
  min_stock_alert: number | null
  track_stock: boolean
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

const STOCK_STYLES = {
  success: { text: 'text-emerald-700', dot: 'bg-emerald-500' },
  warning: { text: 'text-amber-800', dot: 'bg-amber-500' },
  danger: { text: 'text-red-700', dot: 'bg-red-500' },
  neutral: { text: 'text-gray-500', dot: 'bg-gray-400' },
} as const

const VAT_TAG_STYLES = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  neutral: 'bg-stone-100 text-stone-700 ring-stone-500/20',
  teal: 'bg-teal-50 text-teal-800 ring-teal-600/20',
} as const

interface PrintSelection {
  product: ProductRow
  choices: BarcodeQuickPrintChoice[]
  selected: BarcodeQuickPrintChoice
}

interface RawUnit {
  id: string
  name: string
  name_ar: string | null
  is_base: boolean
  is_active: boolean
  resolved_selling_price: number
}

interface RawBarcode {
  id: string
  product_unit_id: string
  barcode: string
  barcode_type: BarcodeType
  is_primary: boolean
  is_active: boolean
}

type CatalogueBranchContext = Pick<
  Branch,
  'id' | 'name' | 'name_ar' | 'is_active' | 'stock_enabled' | 'vat_mode'
>

const normalizeIcon = (value: string) => value.trim()

const isIconTooLong = (value: string) => Array.from(value.trim()).length > 10

// ── Category filter tab ───────────────────────────────────────────────────────

function CategoryTab({
  label, active, onClick,
}: {
  label: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-pressed={active}
      className={`max-w-52 flex-shrink-0 truncate rounded-lg border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 ${
        active
          ? 'border-[#173f2a] bg-[#173f2a] text-[#fff8dc] shadow-sm ring-1 ring-gold-400/60'
          : 'border-[#31543f] bg-[#244b36] text-[#eef7ed] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-[#4d785b] hover:bg-[#2d5b42] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2'
      }`}
    >
      {label}
    </button>
  )
}

function VatBadge({
  treatment,
  view,
}: {
  treatment: VatTreatment | null | undefined
  view: 'grid' | 'list'
}) {
  const { t } = useTranslation('products')
  const value = treatment && treatment in CATALOGUE_VAT_TONES ? treatment : null
  if (!value) {
    return <span className="inline-flex rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold leading-4 text-red-700 ring-1 ring-inset ring-red-600/20">{t(view === 'grid' ? 'catalogueVatGrid.unknown' : 'catalogueVat.unknown')}</span>
  }
  const tone = CATALOGUE_VAT_TONES[value]
  return (
    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-4 ring-1 ring-inset ${VAT_TAG_STYLES[tone]}`}>
      {t(`${view === 'grid' ? 'catalogueVatGrid' : 'catalogueVat'}.${value}`)}
    </span>
  )
}

function StockBadge({
  product,
  branchStockEnabled,
}: {
  product: ProductRow
  branchStockEnabled: boolean
}) {
  const { t } = useTranslation('products')
  const stock = catalogueStockStatus({
    stockQuantity: product.stock_quantity,
    trackStock: product.track_stock,
    isService: product.is_service,
    branchStockEnabled,
    lowStockThreshold: product.min_stock_alert,
  })
  const styles = STOCK_STYLES[stock.tone]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold leading-4 ${styles.text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} aria-hidden="true" />
      {t(stock.key, { count: stock.count })}
    </span>
  )
}

function ServiceBadge() {
  const { t } = useTranslation('products')
  return (
    <span className="inline-flex rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-sky-800 ring-1 ring-inset ring-sky-600/15">
      {t('itemType.service')}
    </span>
  )
}

// ── Product card (grid view) ──────────────────────────────────────────────────

function ProductCard({
  product, onEdit, onArchive, onPrint, printLoading, archiveLoading, branchStockEnabled,
}: {
  product: ProductRow
  onEdit: () => void
  onArchive: () => void
  onPrint: (trigger: HTMLButtonElement) => void
  printLoading: boolean
  archiveLoading: boolean
  branchStockEnabled: boolean
}) {
  const { t } = useTranslation('products')
  const color = product.categories?.color ?? '#6b7280'
  const icon  = product.categories?.icon  ?? ''

  return (
    <div className="card group relative flex flex-col hover:shadow-md transition-shadow duration-200 overflow-hidden">
      {/* Image / placeholder */}
      <div className="relative h-32 flex-shrink-0" style={{ backgroundColor: color + '18' }}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={dn(product.name, product.name_ar)}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {icon
              ? <span className="text-4xl select-none">{icon}</span>
              : <Package size={34} className="text-gray-300" aria-hidden="true" />}
          </div>
        )}

        {/* Touch-friendly action buttons */}
        <div className="absolute start-2 top-2 flex gap-1">
          <button
            onClick={onEdit}
            title={t('actions.editProduct', { name: dn(product.name, product.name_ar) })}
            aria-label={t('actions.editProduct', { name: dn(product.name, product.name_ar) })}
            className="w-9 h-9 bg-white/95 backdrop-blur-sm rounded-lg flex items-center justify-center shadow-sm border border-white/70 hover:bg-white hover:text-primary-600 transition-colors"
          >
            <Pencil size={13} className="text-gray-600" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={printLoading}
            onClick={event => {
              event.stopPropagation()
              onPrint(event.currentTarget)
            }}
            title={t('actions.printBarcode')}
            aria-label={t('actions.printBarcodeFor', { name: dn(product.name, product.name_ar) })}
            className="w-9 h-9 bg-white/95 backdrop-blur-sm rounded-lg flex items-center justify-center shadow-sm border border-white/70 text-gray-600 hover:bg-white hover:text-primary-700 transition-colors disabled:cursor-wait disabled:opacity-60"
          >
            {printLoading
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" aria-hidden="true" />
              : <Barcode size={14} aria-hidden="true" />}
          </button>
          <button
            type="button"
            disabled={archiveLoading}
            onClick={onArchive}
            title={t('actions.archiveProduct', { name: dn(product.name, product.name_ar) })}
            aria-label={t('actions.archiveProduct', { name: dn(product.name, product.name_ar) })}
            aria-busy={archiveLoading || undefined}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/70 bg-white/95 text-amber-700 shadow-sm backdrop-blur-sm transition-colors hover:border-amber-200 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {archiveLoading
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-200 border-t-amber-700" aria-hidden="true" />
              : <Archive size={13} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col flex-1 gap-1">
        <p className="min-h-10 text-sm font-semibold text-gray-900 leading-5 line-clamp-2" dir="auto">{dn(product.name, product.name_ar)}</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {product.categories && (
            <span
              className="max-w-full truncate border-s-2 px-1.5 text-[10px] font-medium leading-4 text-gray-600"
              style={{ borderColor: color }}
            >
              {dn(product.categories.name, product.categories.name_ar)}
            </span>
          )}
          {product.is_service && <ServiceBadge />}
          <VatBadge treatment={product.vat_treatment} view="grid" />
        </div>
        <p className="text-base font-bold text-primary-700 mt-auto pt-2">
          <Rial amount={Number(product.price)} />
        </p>
        {!product.is_service && (
          <div className="mt-1">
            <StockBadge product={product} branchStockEnabled={branchStockEnabled} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Product row (list view) ───────────────────────────────────────────────────

function ProductListRow({
  product, onEdit, onArchive, onPrint, printLoading, archiveLoading, branchStockEnabled,
}: {
  product: ProductRow
  onEdit: () => void
  onArchive: () => void
  onPrint: (trigger: HTMLButtonElement) => void
  printLoading: boolean
  archiveLoading: boolean
  branchStockEnabled: boolean
}) {
  const { t } = useTranslation('products')
  const color = product.categories?.color ?? '#6b7280'
  const icon  = product.categories?.icon  ?? ''

  return (
    <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 transition-colors hover:bg-gray-50 last:border-0">
      {/* Thumbnail */}
      <div
        className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-lg overflow-hidden"
        style={{ backgroundColor: color + '18' }}
      >
        {product.image_url ? (
          <img src={product.image_url} alt={dn(product.name, product.name_ar)} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          icon
            ? <span className="select-none">{icon}</span>
            : <Package size={17} className="text-gray-300" aria-hidden="true" />
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate" dir="auto">{dn(product.name, product.name_ar)}</p>
        {product.is_service && <span className="mt-1 inline-flex"><ServiceBadge /></span>}
        {(product.sku || product.barcode) && (
          <p className="truncate text-[11px] text-gray-500" dir="ltr">
            {product.sku ? `SKU: ${product.sku}` : `Barcode: ${product.barcode}`}
          </p>
        )}
        <span className="mt-1 inline-flex lg:hidden">
          {!product.is_service && <StockBadge product={product} branchStockEnabled={branchStockEnabled} />}
        </span>
      </div>

      {/* Category */}
      <div className="w-28 flex-shrink-0 hidden sm:block">
        {product.categories ? (
          <span
            className="block max-w-full truncate border-s-2 px-1.5 text-[10px] font-medium leading-4 text-gray-600"
            style={{ borderColor: color }}
          >
            {dn(product.categories.name, product.categories.name_ar)}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        )}
      </div>

      {/* VAT */}
      <div className="w-28 flex-shrink-0 hidden md:block">
        <VatBadge treatment={product.vat_treatment} view="list" />
      </div>

      {/* Stock */}
      <div className="w-28 flex-shrink-0 hidden lg:block">
        {!product.is_service && <StockBadge product={product} branchStockEnabled={branchStockEnabled} />}
      </div>

      {/* Price */}
      <div className="w-24 flex-shrink-0 text-right">
        <p className="text-sm font-bold text-primary-600"><Rial amount={Number(product.price)} /></p>
      </div>

      {/* Actions */}
      <div className="flex w-[116px] flex-shrink-0 items-center justify-end gap-1">
        <button
          type="button"
          onClick={onEdit}
          title={t('actions.editProduct', { name: dn(product.name, product.name_ar) })}
          aria-label={t('actions.editProduct', { name: dn(product.name, product.name_ar) })}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-800"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={printLoading}
          onClick={event => {
            event.stopPropagation()
            onPrint(event.currentTarget)
          }}
          title={t('actions.printBarcode')}
          aria-label={t('actions.printBarcodeFor', { name: dn(product.name, product.name_ar) })}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-wait disabled:opacity-60"
        >
          {printLoading
            ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" aria-hidden="true" />
            : <Barcode size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          disabled={archiveLoading}
          onClick={onArchive}
          title={t('actions.archiveProduct', { name: dn(product.name, product.name_ar) })}
          aria-label={t('actions.archiveProduct', { name: dn(product.name, product.name_ar) })}
          aria-busy={archiveLoading || undefined}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-amber-700 shadow-sm transition-colors hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          {archiveLoading
            ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-200 border-t-amber-700" aria-hidden="true" />
            : <Archive size={14} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  filtered, onAdd, onClear, title, hint, addLabel, canAdd,
}: {
  filtered: boolean
  onAdd: () => void
  onClear: () => void
  title?: string
  hint?: string
  addLabel?: string
  canAdd: boolean
}) {
  const { t } = useTranslation(['products', 'common'])
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
        <Package size={28} className="text-primary-300" />
      </div>
      <p className="text-gray-700 font-semibold">
        {title ?? (filtered ? t('products:noResults') : t('products:noProducts'))}
      </p>
      <p className="text-gray-400 text-sm mt-1 max-w-xs">
        {hint ?? (filtered
          ? t('products:noResultsHint')
          : t('products:emptyHint'))}
      </p>
      {!filtered && canAdd && (
        <Button className="mt-5" onClick={onAdd}>
          <Plus size={15} />
          {addLabel ?? t('products:add')}
        </Button>
      )}
      {filtered && (
        <Button variant="secondary" className="mt-5" onClick={onClear}>
          {t('products:actions.clearFilters')}
        </Button>
      )}
    </div>
  )
}

function AddCategoryDialog({
  open, categories, tenantId, branchId, onClose, onCreated,
}: {
  open: boolean
  categories: Category[]
  tenantId: string | null
  branchId: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation(['products', 'common'])
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📦')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const skipNextDraftWrite = useRef(false)
  const draftKey = tenantId && branchId
    ? `kubri:category-draft:${tenantId}:${branchId}:add`
    : ''

  useEffect(() => {
    if (open && draftKey) {
      skipNextDraftWrite.current = true
      try {
        const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null') as { name?: unknown; icon?: unknown } | null
        if (typeof saved?.name === 'string') setName(saved.name)
        if (typeof saved?.icon === 'string') setIcon(saved.icon)
      } catch {}
    } else if (!open) {
      setName('')
      setIcon('📦')
      setError('')
      setSaving(false)
    }
  }, [open, draftKey])

  useEffect(() => {
    if (!open || !draftKey) return
    if (skipNextDraftWrite.current) {
      skipNextDraftWrite.current = false
      return
    }
    try { sessionStorage.setItem(draftKey, JSON.stringify({ name, icon })) } catch {}
  }, [open, draftKey, name, icon])

  const closeDialog = () => {
    if (draftKey) {
      try { sessionStorage.removeItem(draftKey) } catch {}
    }
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) { setError(t('products:category.nameRequired')); return }
    if (!tenantId || !branchId) { setError(t('products:errors.branchRequired')); return }

    const cleanIcon = normalizeIcon(icon)
    if (isIconTooLong(cleanIcon)) { setError(t('products:category.iconTooLong')); return }

    const duplicate = categories.some(cat =>
      cat.name.trim().toLowerCase() === cleanName.toLowerCase()
    )
    if (duplicate) { setError(t('products:category.duplicate')); return }

    setSaving(true)
    setError('')
    const nextSortOrder = categories.length
      ? Math.max(...categories.map(cat => Number(cat.sort_order ?? 0))) + 1
      : 0

    const q = supabase as unknown as { from: (t: string) => any }
    const { error: err } = await q.from('categories').insert({
      tenant_id: tenantId,
      branch_id: branchId,
      name: cleanName,
      color: '#1c5c2e',
      icon: cleanIcon || null,
      sort_order: nextSortOrder,
    })

    if (err) {
      console.error('[AddCategoryDialog] insert failed', err)
      setError(t('products:errors.saveFailed'))
      setSaving(false)
      return
    }

    setSaving(false)
    onCreated()
    closeDialog()
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={closeDialog} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-lg max-h-[90vh] rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">{t('products:category.add')}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('products:categoryCreateHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4 overflow-y-auto">
            <div>
              <div>
                <label className="label">{t('products:category.name')}</label>
                <input
                  className="input"
                  value={name}
                  onChange={e => { setName(e.target.value); setError('') }}
                  placeholder={t('products:placeholders.category')}
                  autoFocus
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
              <label className="label text-xs">{t('products:category.icon')}</label>
              <CategoryEmojiPicker value={icon} categoryName={name}
                onChange={value => { setIcon(value); setError('') }} />
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
              {t('products:categoryCreatedAtEnd')}
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={closeDialog}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {t('products:category.add')}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { profile, tenant, branch: authBranch } = useAuth()
  const { t } = useTranslation(['products', 'printing'])
  const [searchParams, setSearchParams] = useSearchParams()
  const uiStateRestored = useRef(false)
  const isBranchUser = profile?.role === 'branch'
  const isOwnerAdmin = profile?.role === 'owner' || profile?.role === 'admin'
  const [ownerBranches, setOwnerBranches] = useState<CatalogueBranchContext[]>([])
  const [ownerBranchesLoading, setOwnerBranchesLoading] = useState(false)
  const [ownerBranchesFailed, setOwnerBranchesFailed] = useState(false)
  const requestedOwnerBranchId = searchParams.get('branch')
  const selectedOwnerBranch = isOwnerAdmin && requestedOwnerBranchId
    ? ownerBranches.find(candidate => candidate.id === requestedOwnerBranchId) ?? null
    : null
  const catalogueBranch = isBranchUser ? authBranch : selectedOwnerBranch
  const catalogueBranchId = isBranchUser
    ? profile?.branch_id ?? authBranch?.id ?? null
    : selectedOwnerBranch?.id ?? null
  const {
    config: effectiveBillingConfig,
    loading: billingConfigLoading,
  } = useBranchBillingConfig(catalogueBranchId)
  const presentation = getCataloguePresentation(effectiveBillingConfig)
  const itemTypeCapabilities = getCatalogueItemCreationCapabilities(effectiveBillingConfig)
  const canCreateCatalogueItem = !billingConfigLoading && (
    itemTypeCapabilities.productsEnabled || itemTypeCapabilities.servicesEnabled
  )
  const canExportCatalogue = isOwnerAdmin || isBranchUser

  const [products,   setProducts]   = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading,    setLoading]    = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [viewMode,   setViewMode]   = useState<'grid' | 'list'>(PRODUCTS_DEFAULT_VIEW)
  const [search,     setSearch]     = useState('')
  const [activeCat,  setActiveCat]  = useState('all')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing,    setEditing]    = useState<ProductRow | null>(null)
  const [catsOpen,   setCatsOpen]   = useState(false)
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [batchPrintOpen, setBatchPrintOpen] = useState(false)
  const [printLoadingId, setPrintLoadingId] = useState<string | null>(null)
  const [printSelection, setPrintSelection] = useState<PrintSelection | null>(null)
  const [printError, setPrintError] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<ProductRow | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [barcodeState, setBarcodeState] = useState<{
    kind: 'loading' | 'match' | 'none' | 'conflict' | 'error' | 'unavailable'
    productId?: string
    unitName?: string
    unitId?: string
    barcodeId?: string
  } | null>(null)
  const barcodeRequestRef = useRef(0)
  const lastBarcodeRequestRef = useRef<{ code: string; at: number } | null>(null)
  const mountedRef = useRef(true)
  const previousFiltersRef = useRef<{ search: string; activeCat: string } | null>(null)
  const printTriggerRef = useRef<HTMLButtonElement | null>(null)
  const archivePendingRef = useRef(false)
  const uiStateKey = profile?.tenant_id && catalogueBranchId
    ? `kubri:products-ui:${profile.tenant_id}:${catalogueBranchId}`
    : ''

  useEffect(() => {
    if (!isOwnerAdmin || !profile?.tenant_id) {
      setOwnerBranches([])
      setOwnerBranchesLoading(false)
      setOwnerBranchesFailed(false)
      return
    }
    let active = true
    setOwnerBranchesLoading(true)
    setOwnerBranchesFailed(false)
    void supabase
      .from('branches')
      .select('id, name, name_ar, is_active, stock_enabled, vat_mode')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .order('is_main_branch', { ascending: false })
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setOwnerBranches([])
          setOwnerBranchesFailed(true)
        } else {
          setOwnerBranches((data ?? []) as CatalogueBranchContext[])
        }
        setOwnerBranchesLoading(false)
      })
    return () => { active = false }
  }, [isOwnerAdmin, profile?.tenant_id])

  useEffect(() => {
    uiStateRestored.current = false
    setProducts([])
    setCategories([])
    setSearch('')
    setActiveCat('all')
    setDrawerOpen(false)
    setEditing(null)
    setCatsOpen(false)
    setAddCatOpen(false)
    setExportOpen(false)
    setBatchPrintOpen(false)
    setPrintSelection(null)
    setArchiveTarget(null)
    setBarcodeState(null)
  }, [catalogueBranchId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      barcodeRequestRef.current += 1
    }
  }, [])

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = catalogueBranchId
    if (!tid || !bid) { setLoading(false); return }

    setLoading(true)
    setLoadError(false)
    const [{ data: prods, error: productsError }, { data: cats, error: categoriesError }] = await Promise.all([
      supabase
        .from('products')
        .select([
          'id', 'tenant_id', 'branch_id', 'category_id', 'name', 'name_ar', 'description',
          'sku', 'barcode', 'price', 'stock_quantity', 'min_stock_alert', 'track_stock', 'image_url',
          'is_active', 'is_available', 'sort_order', 'vat_treatment', 'notes', 'is_service',
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

    if (productsError || categoriesError) {
      setLoadError(true)
      setLoading(false)
      return
    }

    const loadedProducts = (prods ?? []) as unknown as ProductRow[]
    setProducts(loadedProducts)
    setCategories((cats ?? []) as unknown as Category[])
    if (!uiStateRestored.current && uiStateKey) {
      uiStateRestored.current = true
      try {
        const saved = JSON.parse(sessionStorage.getItem(uiStateKey) ?? 'null') as {
          search?: unknown; activeCat?: unknown
          drawerOpen?: unknown; editingId?: unknown; addCatOpen?: unknown
        } | null
        if (saved) {
          if (typeof saved.search === 'string') setSearch(saved.search)
          if (typeof saved.activeCat === 'string') setActiveCat(saved.activeCat)
          if (saved.addCatOpen === true) setAddCatOpen(true)
          if (saved.drawerOpen === true) {
            const editingProduct = typeof saved.editingId === 'string'
              ? loadedProducts.find(item => item.id === saved.editingId) ?? null
              : null
            setEditing(editingProduct)
            setDrawerOpen(true)
          }
        }
      } catch {}
    }
    setLoading(false)
  }, [catalogueBranchId, profile?.tenant_id, uiStateKey])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!uiStateKey || !uiStateRestored.current) return
    try {
      sessionStorage.setItem(uiStateKey, JSON.stringify({
        search,
        activeCat,
        drawerOpen,
        editingId: editing?.id ?? null,
        addCatOpen,
      }))
    } catch {}
  }, [uiStateKey, search, activeCat, drawerOpen, editing?.id, addCatOpen])

  const openAdd  = () => {
    if (!canCreateCatalogueItem) return
    setEditing(null)
    setDrawerOpen(true)
  }
  const openEdit = (p: ProductRow) => { setEditing(p); setDrawerOpen(true) }

  const handleArchive = async () => {
    const id = archiveTarget?.id
    if (!id || archivePendingRef.current) return
    archivePendingRef.current = true
    setArchivingId(id)
    try {
      await archiveProduct(supabase as unknown as ProductArchiveClient, id)
      setProducts(prev => prev.filter(product => product.id !== id))
      setArchiveTarget(null)
      toast.success(t('archive.success'))
    } catch {
      toast.error(t('archive.error'))
    } finally {
      archivePendingRef.current = false
      setArchivingId(null)
    }
  }

  const branchStockEnabled = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: catalogueBranch?.stock_enabled,
  })

  const resolveBarcode = useCallback(async (rawValue: string) => {
    const branchId = catalogueBranchId
    const code = normalizeBarcode(rawValue)
    if (!branchId || code.length < 3) return
    const now = performance.now()
    const previousRequest = lastBarcodeRequestRef.current
    if (previousRequest?.code === code && now - previousRequest.at < 180) return
    lastBarcodeRequestRef.current = { code, at: now }

    if (!previousFiltersRef.current) {
      previousFiltersRef.current = { search, activeCat }
    }
    const requestId = ++barcodeRequestRef.current
    setSearch(code)
    setBarcodeState({ kind: 'loading' })

    const { data, error } = await (supabase as any).rpc('resolve_product_unit_barcode', {
      p_branch_id: branchId,
      p_barcode: code,
    })
    if (!mountedRef.current || requestId !== barcodeRequestRef.current) return

    if (error) {
      setBarcodeState({
        kind: error.code === '21000' || error.code === '23505' ? 'conflict' : 'error',
      })
      return
    }

    const rows = Array.isArray(data) ? data : []
    if (rows.length > 1) {
      setBarcodeState({ kind: 'conflict' })
      return
    }
    const row = rows[0]
    const legacyMatch = products.find(product =>
      product.barcode && normalizeBarcode(product.barcode) === code
    )
    if (row && row.resolution_status !== 'active' && !legacyMatch) {
      setBarcodeState({ kind: 'unavailable' })
      return
    }
    const productId = row?.resolution_status === 'active' ? String(row.product_id) : legacyMatch?.id
    const product = products.find(item => item.id === productId)
    if (!product) {
      setBarcodeState({ kind: row ? 'unavailable' : 'none' })
      return
    }
    setBarcodeState({
      kind: 'match',
      productId: product.id,
      unitName: row ? String(row.unit_name_ar || row.unit_name || '') : undefined,
      unitId: row?.product_unit_id ? String(row.product_unit_id) : undefined,
      barcodeId: row?.barcode_id ? String(row.barcode_id) : undefined,
    })
  }, [activeCat, catalogueBranchId, products, search])

  const selectOwnerBranch = (branchId: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      if (branchId) next.set('branch', branchId)
      else next.delete('branch')
      return next
    })
  }

  useBarcodeScanner({
    enabled: true,
    blocked: drawerOpen || catsOpen || addCatOpen || batchPrintOpen || printSelection !== null,
    onScan: async capture => {
      await resolveBarcode(capture.code)
    },
  })

  const clearBarcodeResult = () => {
    barcodeRequestRef.current += 1
    const previous = previousFiltersRef.current
    setBarcodeState(null)
    setSearch(previous?.search ?? '')
    setActiveCat(previous?.activeCat ?? activeCat)
    previousFiltersRef.current = null
  }

  const handleSearchChange = (value: string) => {
    barcodeRequestRef.current += 1
    previousFiltersRef.current = null
    setBarcodeState(null)
    setSearch(value)
  }

  const openBarcodePrint = async (product: ProductRow, trigger: HTMLButtonElement) => {
    if (printLoadingId) return
    printTriggerRef.current = trigger
    setPrintLoadingId(product.id)
    setPrintError('')
    try {
      const [{ data: unitData, error: unitError }, { data: barcodeData, error: barcodeError }, printStatus] = await Promise.all([
        (supabase as any).rpc('get_product_units', { p_product_id: product.id }),
        (supabase as any).rpc('list_product_unit_barcodes', { p_product_id: product.id }),
        getProductBarcodePrintStatus(product.id).catch(() => null),
      ])
      if (unitError || barcodeError) throw unitError ?? barcodeError
      const units = ((unitData ?? []) as RawUnit[]).filter(unit => unit.is_active)
      const barcodes = ((barcodeData ?? []) as RawBarcode[]).filter(row => row.is_active)
      const choices = units.flatMap(unit => barcodes
        .filter(row => row.product_unit_id === unit.id)
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))
        .map<BarcodeQuickPrintChoice>(row => ({
          barcodeId: row.id,
          barcode: row.barcode,
          barcodeType: row.barcode_type,
          unitId: unit.id,
          unitName: unit.name_ar || unit.name,
          price: sarStr(Number(unit.resolved_selling_price ?? product.price)),
          hasPrinted: printStatus ? (printStatus.get(row.id)?.printCount ?? 0) > 0 : null,
        })))
      const baseUnitId = units.find(unit => unit.is_base)?.id
      const resolvedSelection = barcodeState?.kind === 'match' && barcodeState.productId === product.id
        ? choices.find(choice =>
          (barcodeState.barcodeId && choice.barcodeId === barcodeState.barcodeId)
          || (!barcodeState.barcodeId && barcodeState.unitId && choice.unitId === barcodeState.unitId),
        )
        : undefined
      const selected = resolvedSelection
        ?? choices.find(choice => choice.unitId === baseUnitId)
        ?? choices[0]
      if (!selected) {
        setPrintError(t('errors.barcodeNotAssigned'))
        return
      }
      setPrintSelection({ product, choices, selected })
    } catch {
      setPrintError(t('errors.barcodePrintLoadFailed'))
    } finally {
      setPrintLoadingId(null)
    }
  }

  const closeBarcodePrint = () => {
    setPrintSelection(null)
    window.setTimeout(() => printTriggerRef.current?.focus(), 0)
  }

  const filtered = useMemo(() => {
    if (barcodeState?.kind === 'match') {
      return products.filter(product => product.id === barcodeState.productId)
    }
    if (barcodeState && barcodeState.kind !== 'match') return []
    const normalizedSearchBarcode = normalizeBarcode(search)
    const exactLegacyMatch = normalizedSearchBarcode
      ? products.find(product =>
        product.barcode && normalizeBarcode(product.barcode) === normalizedSearchBarcode
      )
      : undefined
    if (exactLegacyMatch) {
      return [exactLegacyMatch]
    }
    return products.filter(product => {
      const matchSearch = catalogueTextMatches(search, product)
      const matchCat = activeCat === 'all' || product.category_id === activeCat
      return matchSearch && matchCat
    })
  }, [activeCat, barcodeState, products, search])

  const isFiltered = search.length > 0 || activeCat !== 'all'

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────── */}
      <PageHeader
        title={t(presentation.titleKey)}
        description={t(presentation.subtitleKey)}
        meta={catalogueBranchId && !loading ? (
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-600">
            {products.length}
          </span>
        ) : undefined}
        actions={catalogueBranchId ? (
          <div data-catalogue-command-bar className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <div data-catalogue-management-actions className="flex flex-wrap items-center gap-1 rounded-xl border border-[#dbe5dc] bg-[#f8fbf7] p-1">
              <Button variant="secondary" size="sm" onClick={() => setCatsOpen(true)} className="border-transparent bg-transparent shadow-none hover:border-[#dbe5dc] hover:bg-white">
                <Tag size={14} aria-hidden="true" />
                {t('category.manage')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setBatchPrintOpen(true)} className="border-transparent bg-transparent shadow-none text-gray-600 hover:border-[#dbe5dc] hover:bg-white">
                <Printer size={14} aria-hidden="true" />
                {t('printing:barcodeLabels.batch.open')}
              </Button>
            </div>
            <div data-catalogue-priority-actions className="flex items-center gap-2 sm:ms-auto">
              {canExportCatalogue && (
                <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)} className="border-[#a9c6ad] bg-[#fffefa] text-[#173f2a] shadow-sm hover:border-[#6e9a75] hover:bg-[#f1f7f2] focus-visible:ring-[#173f2a]">
                  <ArrowLeftRight size={14} aria-hidden="true" />
                  Import / Export
                </Button>
              )}
              {canCreateCatalogueItem && (
                <Button size="sm" onClick={openAdd} className="border border-[#0B1C13] !bg-[#173F2A] text-[#FFF8E7] shadow-[0_3px_8px_rgba(15,36,25,0.18)] hover:!bg-[#0F2419] focus-visible:ring-[#173F2A]">
                  <Plus size={14} aria-hidden="true" />
                  {t(presentation.addActionKey)}
                </Button>
              )}
            </div>
          </div>
        ) : undefined}
      />

      {isOwnerAdmin && (
        <section
          data-catalogue-branch-selector
          className="rounded-2xl border border-[#dbe5dc] bg-[#f8fbf7] px-4 py-3 shadow-[0_1px_0_rgba(16,41,30,0.03)] sm:flex sm:items-center sm:justify-between sm:gap-5"
          aria-label={t('branchSelector.label')}
          aria-busy={billingConfigLoading || undefined}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e5efe6] text-[#173f2a]" aria-hidden="true">
              <Building2 size={17} />
            </span>
            <div className="min-w-0">
              <label htmlFor="catalogue-branch" className="block text-sm font-bold text-[#173f2a]">
                {t('branchSelector.label')}
              </label>
              <p className="mt-0.5 text-xs leading-5 text-gray-600">
                {catalogueBranch
                  ? t('branchSelector.selected', { branch: dn(catalogueBranch.name, catalogueBranch.name_ar) })
                  : t('branchSelector.help')}
              </p>
            </div>
          </div>
          <div className="mt-3 shrink-0 sm:mt-0 sm:w-72">
            <select
              id="catalogue-branch"
              value={selectedOwnerBranch?.id ?? ''}
              onChange={event => selectOwnerBranch(event.target.value)}
              disabled={ownerBranchesLoading}
              className="input w-full bg-white text-sm disabled:cursor-wait"
              aria-describedby={ownerBranchesFailed ? 'catalogue-branch-error' : undefined}
            >
              <option value="">{ownerBranchesLoading ? t('branchSelector.loading') : t('branchSelector.select')}</option>
              {ownerBranches.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {dn(candidate.name, candidate.name_ar)}
                </option>
              ))}
            </select>
            {ownerBranchesFailed && (
              <p id="catalogue-branch-error" className="mt-1.5 text-xs font-medium text-red-700" role="alert">
                {t('branchSelector.loadFailed')}
              </p>
            )}
          </div>
        </section>
      )}

      {!catalogueBranchId ? (
        <div data-catalogue-branch-required className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#cdd9ce] bg-[#fbfdfb] px-6 py-20 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e5efe6] text-[#173f2a]" aria-hidden="true">
            <Building2 size={22} />
          </span>
          <p className="mt-4 font-bold text-gray-900">{t('branchSelector.selectionRequiredTitle')}</p>
          <p className="mt-1 max-w-sm text-sm leading-6 text-gray-500">{t('branchSelector.selectionRequiredHelp')}</p>
        </div>
      ) : (
        <>

      {/* ── Category filter tabs ────────────────────────────────── */}
      {categories.length > 0 && (
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none"
          role="group"
          aria-label={t('category.filterLabel')}
        >
          <CategoryTab
            label={t('all')}
            active={activeCat === 'all'}
            onClick={() => setActiveCat('all')}
          />
          {categories.map(c => (
            <CategoryTab
              key={c.id}
              label={c.icon ? `${c.icon} ${dn(c.name, c.name_ar)}` : dn(c.name, c.name_ar)}
              active={activeCat === c.id}
              onClick={() => setActiveCat(c.id)}
            />
          ))}
        </div>
      )}

      {/* ── Search + view toggle ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="relative flex-1 max-w-md">
          <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && normalizeBarcode(search).length >= 3) {
                event.preventDefault()
                void resolveBarcode(search)
              }
            }}
            className="input ps-9 pe-9 py-2 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => barcodeState ? clearBarcodeResult() : handleSearchChange('')}
              aria-label={t('common:clearSearch')}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-xl border border-[#dbe5dc] bg-[#f8fbf7] p-0.5 shadow-[0_1px_0_rgba(16,41,30,0.03)] flex-shrink-0" role="group" aria-label={t('viewMode')}>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-label={t('viewList')}
            aria-pressed={viewMode === 'list'}
            className={`rounded-[10px] p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173f2a] ${
              viewMode === 'list' ? 'bg-[#173f2a] text-white shadow-sm' : 'text-gray-400 hover:bg-white hover:text-[#173f2a]'
            }`}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label={t('viewGrid')}
            aria-pressed={viewMode === 'grid'}
            className={`rounded-[10px] p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173f2a] ${
              viewMode === 'grid' ? 'bg-[#173f2a] text-white shadow-sm' : 'text-gray-400 hover:bg-white hover:text-[#173f2a]'
            }`}
          >
            <LayoutGrid size={15} />
          </button>
        </div>
      </div>

      <div className="min-h-5" aria-live="polite" aria-atomic="true">
        {barcodeState?.kind === 'loading' && (
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600" aria-hidden="true" />
            {t('barcodeSearch.loading')}
          </p>
        )}
        {barcodeState?.kind === 'match' && (
          <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <Barcode size={13} aria-hidden="true" />
            {t('barcodeSearch.match')}
            {barcodeState.unitName && <span className="font-normal text-emerald-700" dir="auto">· {barcodeState.unitName}</span>}
            <button type="button" className="ms-1 rounded-full p-0.5 hover:bg-emerald-100" onClick={clearBarcodeResult} aria-label={t('barcodeSearch.clear')}>
              <X size={12} aria-hidden="true" />
            </button>
          </p>
        )}
        {printError && (
          <p className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />{printError}
          </p>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-24">
          <LoadingSpinner size="lg" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-red-100 bg-red-50/60 py-20 text-center" role="alert">
          <AlertTriangle size={28} className="text-red-400" aria-hidden="true" />
          <p className="mt-3 font-semibold text-red-800">{t('errors.loadFailed')}</p>
          <p className="mt-1 text-sm text-red-600">{t('errors.loadFailedHint')}</p>
          <Button variant="secondary" className="mt-5" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" />{t('actions.retry')}
          </Button>
        </div>
      ) : barcodeState?.kind === 'loading' ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white py-20 text-center" role="status">
          <LoadingSpinner size="lg" />
          <p className="mt-3 text-sm font-semibold text-gray-700">{t('barcodeSearch.loading')}</p>
        </div>
      ) : barcodeState && barcodeState.kind !== 'match' ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white py-20 text-center" role={barcodeState.kind === 'none' ? 'status' : 'alert'}>
          <Barcode size={30} className={barcodeState.kind === 'none' ? 'text-gray-300' : 'text-red-400'} aria-hidden="true" />
          <p className="mt-3 font-semibold text-gray-800">
            {t(`barcodeSearch.${barcodeState.kind === 'none' ? 'notFound' : barcodeState.kind}`)}
          </p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">{t('barcodeSearch.tryAgain')}</p>
          <Button variant="secondary" className="mt-5" onClick={clearBarcodeResult}>
            {t('barcodeSearch.clear')}
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          filtered={isFiltered}
          onAdd={openAdd}
          onClear={() => { setSearch(''); setActiveCat('all') }}
          title={activeCat !== 'all' && !search.trim() ? t('empty.category') : undefined}
          hint={activeCat !== 'all' && !search.trim() ? t('empty.categoryHint') : undefined}
          addLabel={t(presentation.addActionKey)}
          canAdd={canCreateCatalogueItem}
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              onEdit={() => openEdit(p)}
              onArchive={() => setArchiveTarget(p)}
              onPrint={trigger => void openBarcodePrint(p, trigger)}
              printLoading={printLoadingId === p.id}
              archiveLoading={archivingId === p.id}
              branchStockEnabled={branchStockEnabled}
            />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* List header */}
          <div className="flex items-center gap-3 border-b border-[#dbe5dc] bg-[#f8fbf7] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#526b59]">
            <div className="w-10 flex-shrink-0" />
            <div className="flex-1">{t('columns.product')}</div>
            <div className="w-28 flex-shrink-0 hidden sm:block">{t('columns.category')}</div>
            <div className="w-28 flex-shrink-0 hidden md:block">{t('columns.vat')}</div>
            <div className="w-28 flex-shrink-0 hidden lg:block">{t('columns.stock')}</div>
            <div className="w-24 flex-shrink-0 text-end">{t('columns.price')}</div>
            <div className="w-[116px] flex-shrink-0 text-center">{t('columns.actions')}</div>
          </div>
          {filtered.map(p => (
            <ProductListRow
              key={p.id}
              product={p}
              onEdit={() => openEdit(p)}
              onArchive={() => setArchiveTarget(p)}
              onPrint={trigger => void openBarcodePrint(p, trigger)}
              printLoading={printLoadingId === p.id}
              archiveLoading={archivingId === p.id}
              branchStockEnabled={branchStockEnabled}
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
        branchId={catalogueBranchId}
        branchContext={catalogueBranch}
        itemTypeCapabilities={itemTypeCapabilities}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
      <CategoriesModal
        open={catsOpen}
        categories={categories}
        products={products}
        onClose={() => setCatsOpen(false)}
        onChanged={load}
        onAddCategory={() => {
          setCatsOpen(false)
          setAddCatOpen(true)
        }}
      />
      <AddCategoryDialog
        open={addCatOpen}
        categories={categories}
        tenantId={profile?.tenant_id ?? null}
        branchId={catalogueBranchId}
        onClose={() => setAddCatOpen(false)}
        onCreated={load}
      />
      {catalogueBranchId && profile?.tenant_id && catalogueBranch && (
        <CatalogueExportDialog
          open={exportOpen}
          branchId={catalogueBranchId}
          tenantId={profile.tenant_id}
          branchName={dn(catalogueBranch.name, catalogueBranch.name_ar)}
          branchStockEnabled={branchStockEnabled}
          canExport={canExportCatalogue}
          initialSearch={search}
          initialCategoryId={activeCat === 'all' ? '' : activeCat}
          onImportComplete={load}
          onClose={() => setExportOpen(false)}
        />
      )}
      {catalogueBranchId && <BarcodeBatchPrintDrawer
        open={batchPrintOpen}
        branchId={catalogueBranchId}
        businessName={tenant?.business_name_ar || tenant?.business_name || tenant?.name || catalogueBranch?.name_ar || catalogueBranch?.name || null}
        products={products}
        onClose={() => setBatchPrintOpen(false)}
      />}
      {printSelection && catalogueBranchId && (
        <BarcodeQuickPrintDialog
          open
          branchId={catalogueBranchId}
          barcodeId={printSelection.selected.barcodeId}
          barcode={printSelection.selected.barcode}
          barcodeType={printSelection.selected.barcodeType}
          productId={printSelection.product.id}
          productName={printSelection.product.name}
          productNameAr={printSelection.product.name_ar}
          unitId={printSelection.selected.unitId}
          unitName={printSelection.selected.unitName}
          price={printSelection.selected.price}
          sku={printSelection.product.sku}
          businessName={tenant?.business_name_ar || tenant?.business_name || tenant?.name || catalogueBranch?.name_ar || catalogueBranch?.name || null}
          hasPrinted={printSelection.selected.hasPrinted}
          choices={printSelection.choices}
          onClose={closeBarcodePrint}
          onPrinted={() => undefined}
        />
      )}
      <ConfirmDialog
        open={archiveTarget !== null}
        kind="archive"
        busy={archivingId !== null}
        destructive={false}
        confirmVariant="gold"
        cancelLabel={t('common:cancel')}
        onConfirm={() => void handleArchive()}
        onClose={() => { if (!archivePendingRef.current) setArchiveTarget(null) }}
      />
        </>
      )}
    </div>
  )
}
