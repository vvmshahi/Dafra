import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronDown, ChevronUp, ImagePlus, PackageCheck, SlidersHorizontal, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { calculateVatPriceBreakdown, type BranchVatMode } from '@/lib/pricing/vat'
import { isStockModuleVisible, resolveBusinessType } from '@/lib/utils/businessType'
import type { Category, ProductSecurePayload, ProductSecureResult, ProductSecureUpdatePayload, ProductSkuSuggestionResult, VatTreatment } from '@/types'
import type { ProductRow } from './ProductsPage'
import { ProductUnitsSection } from './ProductUnitsSection'
import { useTranslation } from 'react-i18next'

// ── VAT options ───────────────────────────────────────────────────────────────

const VAT_OPTIONS: VatTreatment[] = ['inherit', 'exclusive', 'inclusive', 'exempt']

// ── Accordion section ─────────────────────────────────────────────────────────

function Section({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        {open
          ? <ChevronUp size={16} className="text-gray-400" />
          : <ChevronDown size={16} className="text-gray-400" />
        }
      </button>
      {open && <div className="px-4 py-4 space-y-4 bg-white">{children}</div>}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  product: ProductRow | null
  categories: Category[]
  products: ProductRow[]
  onClose: () => void
  onSaved: () => void
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const formatStockQuantity = (value: number | null | undefined) => {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0'
  if (Number.isInteger(numeric)) return String(numeric)
  return numeric.toFixed(3).replace(/\.?0+$/, '')
}

const createStockAdjustmentKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `stock-adjustment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const formatPreviewMoney = (value: number) =>
  `SAR ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface ProductDraft {
  name: string
  nameAr: string
  categoryId: string
  description: string
  price: string
  vatTreatment: VatTreatment
  isAvailable: boolean
  sortOrder: string
  sku: string
  skuManuallyEdited: boolean
  notes: string
  trackStock: boolean
}

function readProductDraft(key: string): ProductDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ProductDraft : null
  } catch {
    return null
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductDrawer({ open, product, categories, onClose, onSaved }: Props) {
  const { profile, tenant, branch } = useAuth()
  const { t } = useTranslation(['products', 'inventory', 'common'])
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const initializedFormKey = useRef<string | null>(null)
  const skipNextDraftWrite = useRef(false)

  const [s0, setS0] = useState(true)   // Basic Info
  const [s1, setS1] = useState(true)   // Pricing & VAT
  const [s2, setS2] = useState(true)   // Selling units
  const [s3, setS3] = useState(true)   // Image
  const [s4, setS4] = useState(true)   // Settings

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Form state
  const [name,         setName]         = useState('')
  const [nameAr,       setNameAr]       = useState('')
  const [categoryId,   setCategoryId]   = useState('')
  const [description,  setDescription]  = useState('')
  const [price,        setPrice]        = useState('')
  const [vatTreatment, setVatTreatment] = useState<VatTreatment>('inherit')
  const [imageFile,    setImageFile]    = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isAvailable,  setIsAvailable]  = useState(true)
  const [sortOrder,    setSortOrder]    = useState('0')
  const [sku,          setSku]          = useState('')
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(false)
  const [suggestedSku, setSuggestedSku] = useState<string | null>(null)
  const [skuSuggesting, setSkuSuggesting] = useState(false)
  const [notes,        setNotes]        = useState('')
  const [trackStock,   setTrackStock]   = useState(false)
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('')
  const [adjustmentIdempotencyKey, setAdjustmentIdempotencyKey] = useState<string | null>(null)
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [createdTrackedProduct, setCreatedTrackedProduct] = useState<{ id: string; name: string } | null>(null)
  const [pendingTrackedProduct, setPendingTrackedProduct] = useState<{ id: string; name: string } | null>(null)
  const [createdProductWasTracked, setCreatedProductWasTracked] = useState(false)
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null)
  const [savedStockBaseline, setSavedStockBaseline] = useState<string | null>(null)
  const [packageEditorDirty, setPackageEditorDirty] = useState(false)
  const [productCreatedMessage, setProductCreatedMessage] = useState(false)

  const businessType = resolveBusinessType(tenant?.business_type)
  const stockModuleVisible = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })
  const hasStockContext = tenant !== null && branch !== null
  const stockControlsAllowed = hasStockContext && businessType === 'trading' && stockModuleVisible && product?.is_service !== true
  const currentStockQuantity = Number(product?.stock_quantity ?? 0)
  const productWasTracked = Boolean(product?.track_stock)
  const stockUnavailableMessage = !hasStockContext
    ? ''
    : businessType === 'service'
    ? 'Stock tracking is hidden for service businesses.'
    : product?.is_service
      ? 'Service products cannot track stock.'
      : branch?.stock_enabled === false
        ? 'Stock tracking is disabled for this branch.'
        : ''

  const baseline = product
    ? JSON.stringify({
        name: product.name,
        nameAr: product.name_ar ?? '',
        categoryId: product.category_id ?? '',
        description: product.description ?? '',
        price: String(product.price),
        vatTreatment: (product.vat_treatment as VatTreatment) ?? 'inherit',
        imagePreview: product.image_url,
        isAvailable: product.is_available ?? true,
        sortOrder: String(product.sort_order ?? 0),
        sku: product.sku ?? '',
        notes: product.notes ?? '',
      })
    : JSON.stringify({
        name: '',
        nameAr: '',
        categoryId: '',
        description: '',
        price: '',
        vatTreatment: 'inherit',
        imagePreview: null,
        isAvailable: true,
        sortOrder: '0',
        sku: '',
        notes: '',
      })

  const current = JSON.stringify({
    name,
    nameAr,
    categoryId,
    description,
    price,
    vatTreatment,
    imagePreview,
    isAvailable,
    sortOrder,
    sku,
    notes,
  })

  const stockBaseline = product
    ? JSON.stringify({
        trackStock: productWasTracked,
        adjustmentQuantity: '',
      })
    : JSON.stringify({
        trackStock: stockControlsAllowed,
        adjustmentQuantity: '',
      })
  const stockCurrent = JSON.stringify({
    trackStock,
    adjustmentQuantity,
  })

  const hasUnsavedChanges = open && !saving && (
    imageFile !== null ||
    current !== (savedBaseline ?? baseline) ||
    packageEditorDirty ||
    (stockControlsAllowed && stockCurrent !== (savedStockBaseline ?? stockBaseline))
  )

  const resolvedTenantId = profile?.tenant_id ?? tenant?.id ?? ''
  const resolvedBranchId = profile?.branch_id ?? branch?.id ?? ''
  const draftKey = resolvedTenantId && resolvedBranchId
    ? `kubri:product-draft:${resolvedTenantId}:${resolvedBranchId}:${product ? `edit:${product.id}` : 'add'}`
    : ''
  const selectedCategory = categoryId
    ? categories.find(c => c.id === categoryId)
    : null
  const formBranchIsActive = Boolean(branch?.id && (!product || product.branch_id === branch.id))
  const branchVatMode: BranchVatMode | null = formBranchIsActive && branch?.vat_mode === 'inclusive'
    ? 'inclusive'
    : formBranchIsActive && branch?.vat_mode === 'exclusive'
      ? 'exclusive'
      : null
  const numericPrice = price !== '' && price !== '.' ? Number(price) : Number.NaN
  const pricePreview = vatTreatment === 'inherit' && !branchVatMode
    ? null
    : calculateVatPriceBreakdown(numericPrice, vatTreatment, branchVatMode ?? 'exclusive')

  // Initialize once per opened product. Background auth/profile refreshes must
  // never reset an already mounted form.
  useEffect(() => {
    if (!open) {
      initializedFormKey.current = null
      return
    }
    if (!draftKey || initializedFormKey.current === draftKey) return
    initializedFormKey.current = draftKey
    const draft = readProductDraft(draftKey)
    skipNextDraftWrite.current = true
    if (open && product) {
      setName(draft?.name ?? product.name)
      setNameAr(draft?.nameAr ?? product.name_ar ?? '')
      setCategoryId(draft?.categoryId ?? product.category_id ?? '')
      setDescription(draft?.description ?? product.description ?? '')
      setPrice(draft?.price ?? String(product.price))
      setVatTreatment(draft?.vatTreatment ?? (product.vat_treatment as VatTreatment) ?? 'inherit')
      setImagePreview(product.image_url)
      setIsAvailable(draft?.isAvailable ?? product.is_available ?? true)
      setSortOrder(draft?.sortOrder ?? String(product.sort_order ?? 0))
      setSku(draft?.sku ?? product.sku ?? '')
      setSkuManuallyEdited(draft?.skuManuallyEdited ?? true)
      setSuggestedSku(null)
      setSkuSuggesting(false)
      setNotes(draft?.notes ?? product.notes ?? '')
      setTrackStock(draft?.trackStock ?? Boolean(product.track_stock))
    } else {
      setName(draft?.name ?? '')
      setNameAr(draft?.nameAr ?? '')
      setCategoryId(draft?.categoryId ?? '')
      setDescription(draft?.description ?? '')
      setPrice(draft?.price ?? '')
      setVatTreatment(draft?.vatTreatment ?? 'inherit')
      setImagePreview(null)
      setIsAvailable(draft?.isAvailable ?? true)
      setSortOrder(draft?.sortOrder ?? '0')
      setSku(draft?.sku ?? '')
      setSkuManuallyEdited(draft?.skuManuallyEdited ?? false)
      setSuggestedSku(null)
      setSkuSuggesting(false)
      setNotes(draft?.notes ?? '')
      setTrackStock(draft?.trackStock ?? stockControlsAllowed)
    }
    setImageFile(null)
    setAdjustmentQuantity('')
    setAdjustmentIdempotencyKey(null)
    setShowAdjustment(false)
    setCreatedProductId(null)
    setCreatedTrackedProduct(null)
    setPendingTrackedProduct(null)
    setCreatedProductWasTracked(false)
    setSavedBaseline(null)
    setSavedStockBaseline(null)
    setPackageEditorDirty(false)
    setProductCreatedMessage(false)
    setError('')
  }, [open, product, draftKey, stockControlsAllowed])

  useEffect(() => {
    if (!open || createdProductId || !draftKey || initializedFormKey.current !== draftKey) return
    if (skipNextDraftWrite.current) {
      skipNextDraftWrite.current = false
      return
    }
    const draft: ProductDraft = {
      name, nameAr, categoryId, description, price, vatTreatment,
      isAvailable, sortOrder, sku, skuManuallyEdited, notes, trackStock,
    }
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)) } catch {}
  }, [
    open, createdProductId, draftKey, name, nameAr, categoryId, description, price, vatTreatment,
    isAvailable, sortOrder, sku, skuManuallyEdited, notes, trackStock,
  ])

  const clearDraft = () => {
    if (!draftKey) return
    try { sessionStorage.removeItem(draftKey) } catch {}
  }

  useEffect(() => {
    if (!open || product || createdProductId || skuManuallyEdited || !resolvedBranchId || !name.trim()) {
      setSuggestedSku(null)
      setSkuSuggesting(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSkuSuggesting(true)
      try {
        const { data, error: suggestErr } = await supabase.rpc('suggest_product_sku', {
          p_payload: {
            name: name.trim(),
            branch_id: resolvedBranchId,
          },
        })

        if (cancelled) return
        if (suggestErr) {
          setSuggestedSku(null)
          return
        }

        const result = data as ProductSkuSuggestionResult | null
        if (result?.sku) {
          setSuggestedSku(result.sku)
          setSku(result.sku)
        }
      } finally {
        if (!cancelled) setSkuSuggesting(false)
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, product, createdProductId, skuManuallyEdited, resolvedBranchId, name])

  useEffect(() => {
    if (!open || !categoryId) return

    const category = categories.find(c => c.id === categoryId)
    if (
      !category ||
      category.tenant_id !== resolvedTenantId ||
      category.branch_id !== resolvedBranchId
    ) {
      setCategoryId('')
    }
  }, [open, categoryId, categories, resolvedTenantId, resolvedBranchId])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError(t('products:image.invalidType'))
      e.target.value = ''
      return
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError(t('products:image.tooLarge'))
      e.target.value = ''
      return
    }

    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    setError('')
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const requestClose = () => {
    if (hasUnsavedChanges && !confirm(t('products:actions.discard'))) return
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    clearDraft()
    if (pendingTrackedProduct) {
      setCreatedTrackedProduct(pendingTrackedProduct)
      return
    }
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError(t('products:errors.nameRequired')); return }
    const numericPrice = Number(price)
    if (!price || isNaN(numericPrice)) { setError(t('products:errors.priceRequired')); return }
    if (numericPrice < 0) { setError(t('products:errors.priceNegative')); return }
    if (!resolvedTenantId || !resolvedBranchId) {
      setError(t('products:errors.branchRequired'))
      return
    }
    if (categoryId && !selectedCategory) {
      setError(t('products:errors.categoryInvalid'))
      return
    }
    if (selectedCategory?.tenant_id !== undefined && selectedCategory.tenant_id !== resolvedTenantId) {
      setError(t('products:errors.categoryBusinessInvalid'))
      return
    }
    if (selectedCategory?.branch_id !== undefined && selectedCategory.branch_id !== resolvedBranchId) {
      setError(t('products:errors.categoryBranchInvalid'))
      return
    }

    let adjustmentDelta: number | null = null
    let manualAdjustmentKey: string | null = null
    if (stockControlsAllowed && product && adjustmentQuantity.trim() !== '') {
      adjustmentDelta = Number(adjustmentQuantity)
      if (!Number.isFinite(adjustmentDelta) || adjustmentDelta === 0) {
        setError(t('products:errors.adjustmentZero'))
        return
      }
      if (currentStockQuantity + adjustmentDelta < 0) {
        setError(t('products:errors.stockNegative'))
        return
      }
      manualAdjustmentKey = adjustmentIdempotencyKey ?? createStockAdjustmentKey()
      if (!adjustmentIdempotencyKey) setAdjustmentIdempotencyKey(manualAdjustmentKey)
    }

    if (stockControlsAllowed && product && productWasTracked && !trackStock) {
      const confirmed = confirm(t('products:inventory.disableConfirm'))
      if (!confirmed) return
    }

    setSaving(true)
    setError('')

    try {
      const tid = resolvedTenantId
      let imageUrl: string | null = product?.image_url ?? null

      // Upload new image if selected
      if (imageFile) {
        const ext  = imageFile.name.split('.').pop() ?? 'jpg'
        const path = `${tid}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('product-images')
          .upload(path, imageFile, { upsert: true })
        if (upErr) { console.error('[ProductDrawer] image upload failed', upErr); setError(t('products:image.uploadFailed')); return }
        const { data: { publicUrl } } = supabase.storage
          .from('product-images')
          .getPublicUrl(path)
        imageUrl = publicUrl
      } else if (imagePreview === null) {
        // User explicitly removed the image
        imageUrl = null
      }

      const payload: Omit<ProductSecurePayload, 'branch_id'> = {
        name:          name.trim(),
        name_ar:       nameAr.trim()       || null,
        category_id:   categoryId          || null,
        description:   description.trim()  || null,
        price:         numericPrice,
        vat_treatment: vatTreatment,
        image_url:     imageUrl,
        is_available:  isAvailable,
        sort_order:    Number(sortOrder)   || 0,
        sku:           sku.trim()          || null,
        notes:         notes.trim()        || null,
      }

      let savedProductId = product?.id ?? createdProductId
      const isFirstProductSave = !product && !createdProductId
      const shouldShowTrackedCreationSuccess = isFirstProductSave && trackStock && stockControlsAllowed
      let normalizedSku = sku.trim()

      if (product || createdProductId) {
        if (!savedProductId) {
          setError(t('products:errors.idRequired'))
          return
        }
        const updatePayload: ProductSecureUpdatePayload = {
          ...payload,
          product_id: savedProductId,
        }
        const { data, error: err } = await supabase.rpc('update_product_secure', {
          p_payload: updatePayload,
        })
        if (err) {
          console.error('Product update failed', { code: err.code, message: err.message })
          setError(t('products:errors.saveFailed'))
          return
        }
        const result = data as ProductSecureResult | null
        if (result?.sku) {
          normalizedSku = result.sku
          setSku(result.sku)
        }
      } else {
        const { data, error: err } = await supabase.rpc('create_product_secure', {
          p_payload: {
            ...payload,
            branch_id: resolvedBranchId,
          },
        })
        if (err) { console.error('[ProductDrawer] create failed', err); setError(t('products:errors.saveFailed')); return }
        const result = data as ProductSecureResult | null
        savedProductId = result?.product_id ?? null
        if (result?.sku) {
          normalizedSku = result.sku
          setSku(result.sku)
        }
        if (result?.product_id) setCreatedProductId(result.product_id)
      }

      if (stockControlsAllowed && savedProductId) {
        const stockPayload: Record<string, unknown> = { product_id: savedProductId }

        if (isFirstProductSave && trackStock) {
          stockPayload.track_stock = true
          stockPayload.opening_stock_quantity = 0
          stockPayload.reason = 'opening_stock'
        } else if (createdProductId && trackStock !== createdProductWasTracked) {
          stockPayload.track_stock = trackStock
          stockPayload.reason = trackStock ? 'opening_stock' : 'tracking_disabled'
          if (trackStock) stockPayload.opening_stock_quantity = 0
        } else if (product && trackStock !== productWasTracked) {
          stockPayload.track_stock = trackStock
          stockPayload.reason = trackStock ? 'opening_stock' : 'tracking_disabled'
          if (trackStock) stockPayload.opening_stock_quantity = 0
        }

        if (product && adjustmentDelta !== null) {
          stockPayload.adjustment_quantity = adjustmentDelta
          stockPayload.idempotency_key = manualAdjustmentKey
          stockPayload.reason = 'manual_adjustment'
        }

        if (Object.keys(stockPayload).length > 1) {
          const { error: stockErr } = await (supabase as any).rpc('update_product_stock_settings', {
            p_payload: stockPayload,
          })

          if (stockErr) {
            const prefix = product
              ? 'Product details were saved, but stock settings were not updated: '
              : 'Product was created, but stock setup was not completed: '
            console.error('[ProductDrawer] stock settings failed', { prefix, error: stockErr })
            setError(t('products:errors.saveFailed'))
            return
          }
        }
      }

      setAdjustmentIdempotencyKey(null)
      clearDraft()
      if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
      setImageFile(null)
      setImagePreview(imageUrl)
      setSavedBaseline(JSON.stringify({
        name,
        nameAr,
        categoryId,
        description,
        price,
        vatTreatment,
        imagePreview: imageUrl,
        isAvailable,
        sortOrder,
        sku: normalizedSku,
        notes,
      }))
      setSavedStockBaseline(JSON.stringify({
        trackStock,
        adjustmentQuantity: '',
      }))
      setCreatedProductWasTracked(trackStock)
      setAdjustmentQuantity('')
      onSaved()
      if (isFirstProductSave && savedProductId) {
        setProductCreatedMessage(true)
        if (shouldShowTrackedCreationSuccess) {
          setPendingTrackedProduct({ id: savedProductId, name: name.trim() })
        }
        return
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  if (createdTrackedProduct) {
    return (
      <>
        <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
        <div className="fixed inset-y-0 right-0 w-full max-w-[480px] bg-white shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">{t('products:created')}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {t('products:createdHint')}
              </p>
            </div>
            <button type="button" onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 px-6 py-5">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
              <p className="text-sm font-semibold text-gray-900">{createdTrackedProduct.name}</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {t('products:openingStockHint')}
              </p>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('products:done')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onClose()
                navigate('/inventory', {
                  state: {
                    stockTab: 'product',
                    openProductStockReceiptFor: createdTrackedProduct.id,
                  },
                })
              }}
            >
              {t('products:addOpeningStock')}
            </Button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={requestClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-[560px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {product ? t('products:edit') : t('products:add')}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {product ? t('products:editHint') : t('products:addHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* ── Body ────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">

            {/* Basic Info */}
            <Section title={t('products:sections.basic')} open={s0} onToggle={() => setS0(v => !v)}>
              <div>
                <label className="label">
                  {t('products:fields.name')} <span className="text-red-500">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('products:placeholders.name')}
                />
              </div>
              <div>
                <label className="label">{t('products:fields.nameAr')}</label>
                <input
                  className="input text-right"
                  dir="rtl"
                  value={nameAr}
                  onChange={e => setNameAr(e.target.value)}
                  placeholder="اسم المنتج"
                />
              </div>
              <div>
                <label className="label">{t('products:fields.category')}</label>
                <select
                  className="input"
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                >
                  <option value="">— {t('products:category.none')} —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.icon ? `${c.icon} ${c.name_ar || c.name}` : (c.name_ar || c.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('products:fields.description')}</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={t('products:placeholders.description')}
                />
              </div>
            </Section>

            {/* Pricing & VAT */}
            <Section title={t('products:sections.pricing')} open={s1} onToggle={() => setS1(v => !v)}>
              <div>
                <label className="label">
                  Price (SAR) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">
                    SAR
                  </span>
                  <MoneyInput
                    className="input pl-12"
                    value={price}
                    onValueChange={setPrice}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="label">{t('products:fields.vatTreatment')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {VAT_OPTIONS.map(value => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setVatTreatment(value)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                        vatTreatment === value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <p className="text-xs font-semibold">{t(`products:pricing.${value === 'exempt' ? 'exemptOption' : value}`)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{t(`products:pricing.${value}Desc`)}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5" aria-live="polite" aria-label={t('products:pricing.preview')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{t('products:pricing.preview')}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-gray-500">{t('products:pricing.previewHint')}</p>
                  </div>
                  {vatTreatment === 'inherit' && branchVatMode && (
                    <span className="rounded-full border border-primary-100 bg-primary-50 px-2 py-1 text-[10px] font-semibold text-primary-700">
                      Using branch default: VAT {branchVatMode}
                    </span>
                  )}
                </div>

                {!pricePreview ? (
                  <p className="mt-3 text-xs leading-5 text-gray-500">
                    {vatTreatment === 'inherit' && !branchVatMode
                      ? 'The active branch VAT setting is needed before this preview can be calculated.'
                      : 'Enter a price to see the VAT and customer total.'}
                  </p>
                ) : pricePreview.effectiveTreatment === 'inclusive' ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <dt className="text-gray-500">{t('products:pricing.customerPays')}</dt>
                    <dd className="text-right font-bold tabular-nums text-gray-900">{formatPreviewMoney(pricePreview.customerTotal)}</dd>
                    <dt className="text-gray-500">{t('products:pricing.beforeVat')}</dt>
                    <dd className="text-right font-semibold tabular-nums text-gray-700">{formatPreviewMoney(pricePreview.subtotal)}</dd>
                    <dt className="text-gray-500">{t('products:pricing.includedVat')}</dt>
                    <dd className="text-right font-semibold tabular-nums text-amber-700">{formatPreviewMoney(pricePreview.vatAmount)}</dd>
                  </dl>
                ) : pricePreview.effectiveTreatment === 'exclusive' ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <dt className="text-gray-500">{t(vatTreatment === 'inherit' ? 'products:pricing.enteredPrice' : 'products:pricing.beforeVat')}</dt>
                    <dd className="text-right font-semibold tabular-nums text-gray-700">{formatPreviewMoney(pricePreview.subtotal)}</dd>
                    <dt className="text-gray-500">{t('products:pricing.vat15')}</dt>
                    <dd className="text-right font-semibold tabular-nums text-amber-700">{formatPreviewMoney(pricePreview.vatAmount)}</dd>
                    <dt className="border-t border-gray-200 pt-2 font-semibold text-gray-700">{t('products:pricing.customerPays')}</dt>
                    <dd className="border-t border-gray-200 pt-2 text-right font-bold tabular-nums text-gray-900">{formatPreviewMoney(pricePreview.customerTotal)}</dd>
                  </dl>
                ) : (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <dt className="text-gray-500">{t('products:pricing.customerPays')}</dt>
                    <dd className="text-right font-bold tabular-nums text-gray-900">{formatPreviewMoney(pricePreview.customerTotal)}</dd>
                    <dt className="text-gray-500">{t('products:pricing.vat')}</dt>
                    <dd className="text-right font-semibold tabular-nums text-gray-700">{formatPreviewMoney(0)}</dd>
                    <dt className="text-gray-500">{t('products:pricing.treatment')}</dt>
                    <dd className="text-end font-semibold text-gray-700">{t('products:pricing.exempt')}</dd>
                  </dl>
                )}
              </div>
            </Section>

            {/* Selling units and cartons */}
            <Section title={t('products:sections.units')} open={s2} onToggle={() => setS2(v => !v)}>
              {productCreatedMessage && (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-3 text-xs leading-5 text-emerald-800" role="status">
                  {t('products:units.productCreated')}
                </div>
              )}
              <ProductUnitsSection
                productId={product?.id ?? createdProductId}
                basePrice={price}
                serviceRestricted={businessType === 'service' || product?.is_service === true}
                stockEnabled={stockModuleVisible}
                onDirtyChange={setPackageEditorDirty}
              />
            </Section>

            {/* Product Image */}
            <Section title={t('products:sections.image')} open={s3} onToggle={() => setS3(v => !v)}>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleImageChange}
              />
              {imagePreview ? (
                <div className="relative group/img">
                  <img
                    src={imagePreview}
                    alt={t('products:image.preview')}
                    className="w-full h-44 object-cover rounded-xl border border-gray-200"
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="bg-white text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow hover:bg-gray-50"
                    >
                      {t('products:image.change')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
                        setImageFile(null)
                        setImagePreview(null)
                      }}
                      className="bg-white text-red-500 text-xs font-medium px-3 py-1.5 rounded-lg shadow hover:bg-red-50"
                    >
                      {t('products:image.remove')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full h-36 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 hover:bg-primary-50/30 transition-colors group/upload"
                >
                  <ImagePlus size={24} className="text-gray-300 group-hover/upload:text-primary-400 transition-colors" />
                  <p className="text-xs text-gray-400 group-hover/upload:text-primary-500 transition-colors">
                    {t('products:image.upload')}
                  </p>
                  <p className="text-[10px] text-gray-300">{t('products:image.formats')}</p>
                </button>
              )}
            </Section>

            {/* Settings */}
            <Section title={t('products:sections.settings')} open={s4} onToggle={() => setS4(v => !v)}>
              {/* Show in POS toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">{t('products:inventory.showInPos')}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t('products:inventory.showInPosHint')}</p>
                </div>
                <Switch
                  checked={isAvailable}
                  onChange={setIsAvailable}
                  ariaLabel="Show in POS"
                />
              </div>

              {stockControlsAllowed ? (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm">
                        <PackageCheck size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{t('products:inventory.track')}</p>
                        <p className="mt-0.5 text-xs leading-5 text-gray-500">
                          {product
                            ? 'Sales reduce tracked stock automatically. Use Adjust Stock for audited quantity changes.'
                            : 'Sales reduce tracked stock automatically. New products start at zero; receive quantity and cost from Product Stock.'}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={trackStock}
                      onChange={next => {
                        if (!next) {
                          setAdjustmentQuantity('')
                          setShowAdjustment(false)
                        }
                        setTrackStock(next)
                      }}
                      ariaLabel="Track inventory"
                      className={trackStock ? 'bg-emerald-500' : undefined}
                    />
                  </div>

                  {product && (
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/80 p-2.5 text-xs">
                      <div>
                        <p className="text-gray-400">{t('products:inventory.current')}</p>
                        <p className={`mt-0.5 font-semibold ${productWasTracked ? 'text-gray-800' : 'text-gray-500'}`}>
                          {productWasTracked ? formatStockQuantity(product.stock_quantity) : t('products:status.notTracked')}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">{t('products:inventory.trackingStatus')}</p>
                        <p className={`mt-0.5 font-semibold ${trackStock ? 'text-emerald-700' : 'text-gray-500'}`}>
                          {t(trackStock ? 'products:status.tracked' : 'products:status.notTracked')}
                        </p>
                      </div>
                    </div>
                  )}

                  {product && productWasTracked && trackStock && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setShowAdjustment(v => !v)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"
                      >
                        <SlidersHorizontal size={13} />
                        {t('inventory:actions.adjust')}
                      </button>

                      {showAdjustment && (
                        <div className="rounded-lg border border-emerald-100 bg-white p-3">
                          <label className="label">{t('products:fields.adjustmentQuantity')}</label>
                          <input
                            className="input"
                            type="number"
                            step="0.001"
                            value={adjustmentQuantity}
                            onChange={e => {
                              setAdjustmentQuantity(e.target.value)
                              setAdjustmentIdempotencyKey(null)
                            }}
                            placeholder={t('products:placeholders.adjustment')}
                          />
                          <p className="mt-1 text-xs leading-5 text-gray-400">
                            Use a positive number to add stock or a negative number to reduce it. The final stock cannot go below zero.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {product && productWasTracked && !trackStock && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      Stock quantity and history will be preserved, but POS sales will stop checking stock for this product.
                    </div>
                  )}
                </div>
              ) : stockUnavailableMessage ? (
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3 text-xs leading-5 text-gray-500">
                  {stockUnavailableMessage}
                </div>
              ) : null}

              <div>
                <label className="label">{t('products:fields.sku')}</label>
                <input
                  className="input"
                  value={sku}
                  onChange={e => {
                    setSku(e.target.value)
                    setSkuManuallyEdited(e.target.value.trim() !== '')
                    if (e.target.value.trim() === '') setSuggestedSku(null)
                  }}
                  placeholder={t('products:placeholders.sku')}
                />
                <p className="text-xs text-gray-400 mt-1">
                  {skuSuggesting
                    ? 'Generating SKU...'
                    : skuManuallyEdited
                      ? 'SKU will be normalized and checked when saving.'
                      : suggestedSku
                        ? `Suggested SKU: ${suggestedSku}`
                        : 'Leave blank to generate a SKU automatically.'}
                </p>
              </div>

              <div>
                <label className="label">{t('products:fields.sortOrder')}</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={sortOrder}
                  onChange={e => setSortOrder(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-gray-400 mt-1">{t('products:inventory.lowerFirst')}</p>
              </div>

              <div>
                <label className="label">{t('products:fields.notes')}</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder={t('products:placeholders.notes')}
                />
              </div>
            </Section>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────── */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={requestClose}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {product || createdProductId ? t('products:actions.update') : t('products:actions.save')}
            </Button>
          </div>

        </form>
      </div>
    </>
  )
}
