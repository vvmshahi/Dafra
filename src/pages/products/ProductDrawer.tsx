import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ChevronDown, ChevronUp, ImagePlus, PackageCheck, SlidersHorizontal, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { isStockModuleVisible, resolveBusinessType } from '@/lib/utils/businessType'
import type { Category, VatTreatment } from '@/types'
import type { ProductRow } from './ProductsPage'

// ── VAT options ───────────────────────────────────────────────────────────────

const VAT_OPTIONS: { value: VatTreatment; label: string; desc: string }[] = [
  { value: 'inherit',   label: 'Branch Default',    desc: 'Follow branch VAT setting' },
  { value: 'exclusive', label: 'Always Exclusive',  desc: 'Price shown + VAT at checkout' },
  { value: 'inclusive', label: 'Always Inclusive',  desc: 'VAT already included in price' },
  { value: 'exempt',    label: 'VAT Exempt',        desc: 'Zero-rated or exempt item' },
]

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

const productErrorMessage = (message: string) => {
  if (message.includes('Product category does not belong')) {
    return 'Selected category does not match this branch. Refresh the page and select a category from this branch.'
  }
  return message
}

const stockErrorMessage = (message: string) => {
  if (/stock module is disabled/i.test(message)) return 'Stock tracking is disabled for this branch.'
  if (/service products cannot track stock/i.test(message)) return 'Service products cannot track stock.'
  if (/service businesses/i.test(message)) return 'Stock tracking is not available for service businesses.'
  if (/opening stock/i.test(message)) return message
  if (/adjustment would make stock negative/i.test(message)) return 'This adjustment would make stock negative.'
  if (/product belongs to another branch/i.test(message)) return 'This product belongs to another branch.'
  if (/permission|forbidden|unauthorized/i.test(message)) return 'You do not have permission to update product stock.'
  if (/unsupported stock|invalid stock|adjust stock before/i.test(message)) return message
  return 'Stock settings could not be saved. Check the stock values and try again.'
}

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductDrawer({ open, product, categories, products, onClose, onSaved }: Props) {
  const { profile, tenant, branch } = useAuth()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [s0, setS0] = useState(true)   // Basic Info
  const [s1, setS1] = useState(true)   // Pricing & VAT
  const [s2, setS2] = useState(true)   // Image
  const [s3, setS3] = useState(true)   // Settings

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
  const [notes,        setNotes]        = useState('')
  const [trackStock,   setTrackStock]   = useState(false)
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('')
  const [adjustmentIdempotencyKey, setAdjustmentIdempotencyKey] = useState<string | null>(null)
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [createdTrackedProduct, setCreatedTrackedProduct] = useState<{ id: string; name: string } | null>(null)

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
    current !== baseline ||
    createdProductId !== null ||
    (stockControlsAllowed && stockCurrent !== stockBaseline)
  )

  const resolvedTenantId = profile?.tenant_id ?? ''
  const resolvedBranchId = profile?.branch_id ?? ''
  const selectedCategory = categoryId
    ? categories.find(c => c.id === categoryId)
    : null

  // Populate form when editing, reset when adding
  useEffect(() => {
    if (open && product) {
      setName(product.name)
      setNameAr(product.name_ar ?? '')
      setCategoryId(product.category_id ?? '')
      setDescription(product.description ?? '')
      setPrice(String(product.price))
      setVatTreatment((product.vat_treatment as VatTreatment) ?? 'inherit')
      setImagePreview(product.image_url)
      setIsAvailable(product.is_available ?? true)
      setSortOrder(String(product.sort_order ?? 0))
      setSku(product.sku ?? '')
      setNotes(product.notes ?? '')
      setTrackStock(Boolean(product.track_stock))
    } else {
      setName('')
      setNameAr('')
      setCategoryId('')
      setDescription('')
      setPrice('')
      setVatTreatment('inherit')
      setImagePreview(null)
      setIsAvailable(true)
      setSortOrder('0')
      setSku('')
      setNotes('')
      setTrackStock(stockControlsAllowed)
    }
    setImageFile(null)
    setAdjustmentQuantity('')
    setAdjustmentIdempotencyKey(null)
    setShowAdjustment(false)
    setCreatedProductId(null)
    setCreatedTrackedProduct(null)
    setError('')
  }, [open, product, stockControlsAllowed])

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
      setError('Upload a JPEG, PNG, WebP, or GIF image.')
      e.target.value = ''
      return
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image must be 5 MB or smaller.')
      e.target.value = ''
      return
    }

    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    setError('')
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const requestClose = () => {
    if (hasUnsavedChanges && !confirm('Discard unsaved product changes?')) return
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Product name is required'); return }
    const numericPrice = Number(price)
    if (!price || isNaN(numericPrice)) { setError('A valid price is required'); return }
    if (numericPrice < 0) { setError('Price must be zero or higher'); return }
    if (!resolvedTenantId || !resolvedBranchId) {
      setError('Branch context is required before saving products.')
      return
    }
    if (categoryId && !selectedCategory) {
      setError('Select a valid category for this branch.')
      return
    }
    if (selectedCategory?.tenant_id !== undefined && selectedCategory.tenant_id !== resolvedTenantId) {
      setError('This category is not valid for this business.')
      return
    }
    if (selectedCategory?.branch_id !== undefined && selectedCategory.branch_id !== resolvedBranchId) {
      setError('This category belongs to another branch. Select a category for this branch.')
      return
    }

    const cleanSku = sku.trim().toLowerCase()
    if (cleanSku) {
      const duplicate = products.some(p =>
        p.id !== product?.id && (p.sku ?? '').trim().toLowerCase() === cleanSku
      )
      if (duplicate) { setError('SKU already exists for another product in this branch'); return }
    }

    let adjustmentDelta: number | null = null
    let manualAdjustmentKey: string | null = null
    if (stockControlsAllowed && product && adjustmentQuantity.trim() !== '') {
      adjustmentDelta = Number(adjustmentQuantity)
      if (!Number.isFinite(adjustmentDelta) || adjustmentDelta === 0) {
        setError('Enter a non-zero stock adjustment.')
        return
      }
      if (currentStockQuantity + adjustmentDelta < 0) {
        setError('This adjustment would make stock negative.')
        return
      }
      manualAdjustmentKey = adjustmentIdempotencyKey ?? createStockAdjustmentKey()
      if (!adjustmentIdempotencyKey) setAdjustmentIdempotencyKey(manualAdjustmentKey)
    }

    if (stockControlsAllowed && product && productWasTracked && !trackStock) {
      const confirmed = confirm('Disable stock tracking for this product? The current stock quantity and stock history will be preserved, but POS sales will stop checking stock.')
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
        if (upErr) { setError('Image upload failed: ' + upErr.message); return }
        const { data: { publicUrl } } = supabase.storage
          .from('product-images')
          .getPublicUrl(path)
        imageUrl = publicUrl
      } else if (imagePreview === null) {
        // User explicitly removed the image
        imageUrl = null
      }

      const payload: Record<string, unknown> = {
        tenant_id:     tid,
        branch_id:     resolvedBranchId,
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

      const q = supabase as unknown as { from: (t: string) => any }

      let savedProductId = product?.id ?? createdProductId
      const shouldShowTrackedCreationSuccess = !product && trackStock && stockControlsAllowed

      if (product || createdProductId) {
        const { error: err } = await q.from('products').update(payload).eq('id', savedProductId)
        if (err) { setError(productErrorMessage(err.message)); return }
      } else {
        const { data, error: err } = await q.from('products').insert(payload).select('id').single()
        if (err) { setError(productErrorMessage(err.message)); return }
        savedProductId = data.id
        setCreatedProductId(data.id)
      }

      if (stockControlsAllowed && savedProductId) {
        const stockPayload: Record<string, unknown> = { product_id: savedProductId }

        if (!product && trackStock) {
          stockPayload.track_stock = true
          stockPayload.opening_stock_quantity = 0
          stockPayload.reason = 'opening_stock'
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
            setError(prefix + stockErrorMessage(stockErr.message))
            return
          }
        }
      }

      setCreatedProductId(null)
      setAdjustmentIdempotencyKey(null)
      if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
      onSaved()
      if (shouldShowTrackedCreationSuccess && savedProductId) {
        setCreatedTrackedProduct({ id: savedProductId, name: name.trim() })
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
              <h2 className="text-base font-bold text-gray-900">Product created successfully.</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Add quantity, supplier, and purchase cost from Product Stock.
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
                Inventory tracking is enabled with zero stock. Use Add Opening Stock to receive the first quantity with its cost and supplier details.
              </p>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" onClick={onClose}>
              Done
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
              Add Opening Stock
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
                {product ? 'Edit Product' : 'Add Product'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {product ? 'Update product details below' : 'Fill in the details for your new product'}
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
            <Section title="Basic Information" open={s0} onToggle={() => setS0(v => !v)}>
              <div>
                <label className="label">
                  Product Name (English) <span className="text-red-500">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Chicken Shawarma"
                />
              </div>
              <div>
                <label className="label">Product Name (Arabic)</label>
                <input
                  className="input text-right"
                  dir="rtl"
                  value={nameAr}
                  onChange={e => setNameAr(e.target.value)}
                  placeholder="اسم المنتج"
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                >
                  <option value="">— No Category —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.icon ?? '📦'} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Optional product description"
                />
              </div>
            </Section>

            {/* Pricing & VAT */}
            <Section title="Pricing & VAT" open={s1} onToggle={() => setS1(v => !v)}>
              <div>
                <label className="label">
                  Price (SAR) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">
                    SAR
                  </span>
                  <input
                    className="input pl-12"
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="label">VAT Treatment</label>
                <div className="grid grid-cols-2 gap-2">
                  {VAT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVatTreatment(opt.value)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                        vatTreatment === opt.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <p className="text-xs font-semibold">{opt.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            {/* Product Image */}
            <Section title="Product Image" open={s2} onToggle={() => setS2(v => !v)}>
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
                    alt="Preview"
                    className="w-full h-44 object-cover rounded-xl border border-gray-200"
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="bg-white text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow hover:bg-gray-50"
                    >
                      Change
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
                      Remove
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
                    Click to upload image
                  </p>
                  <p className="text-[10px] text-gray-300">JPEG, PNG, WebP or GIF · max 5 MB</p>
                </button>
              )}
            </Section>

            {/* Settings */}
            <Section title="Settings" open={s3} onToggle={() => setS3(v => !v)}>
              {/* Show in POS toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Show in POS</p>
                  <p className="text-xs text-gray-400 mt-0.5">Product appears during billing/checkout</p>
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
                        <p className="text-sm font-semibold text-gray-800">Track inventory</p>
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
                        <p className="text-gray-400">Current stock</p>
                        <p className={`mt-0.5 font-semibold ${productWasTracked ? 'text-gray-800' : 'text-gray-500'}`}>
                          {productWasTracked ? formatStockQuantity(product.stock_quantity) : 'Not tracked'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Tracking status</p>
                        <p className={`mt-0.5 font-semibold ${trackStock ? 'text-emerald-700' : 'text-gray-500'}`}>
                          {trackStock ? 'Tracked' : 'Not tracked'}
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
                        Adjust Stock
                      </button>

                      {showAdjustment && (
                        <div className="rounded-lg border border-emerald-100 bg-white p-3">
                          <label className="label">Adjustment quantity</label>
                          <input
                            className="input"
                            type="number"
                            step="0.001"
                            value={adjustmentQuantity}
                            onChange={e => {
                              setAdjustmentQuantity(e.target.value)
                              setAdjustmentIdempotencyKey(null)
                            }}
                            placeholder="e.g. 5 or -2"
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
                <label className="label">SKU / Item Code</label>
                <input
                  className="input"
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                  placeholder="e.g. PROD-001 (optional)"
                />
              </div>

              <div>
                <label className="label">Sort Order</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={sortOrder}
                  onChange={e => setSortOrder(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-gray-400 mt-1">Lower numbers appear first in the POS grid</p>
              </div>

              <div>
                <label className="label">Notes / Kitchen Instructions</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. allergens, preparation notes, modifiers..."
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
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {product ? 'Save Changes' : 'Add Product'}
            </Button>
          </div>

        </form>
      </div>
    </>
  )
}
