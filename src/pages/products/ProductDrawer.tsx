import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, ImagePlus, PackageCheck, SlidersHorizontal, AlertTriangle, Box,
  Barcode, CircleDollarSign, ClipboardList, PackageOpen, Check, Plus, Minus,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { calculateVatPriceBreakdown, type BranchVatMode } from '@/lib/pricing/vat'
import { isStockModuleVisible, resolveBusinessType } from '@/lib/utils/businessType'
import type { Branch, Category, ProductSecurePayload, ProductSecureResult, ProductSecureUpdatePayload, ProductSkuSuggestionResult, VatTreatment } from '@/types'
import type { ProductRow } from './ProductsPage'
import { ProductUnitsSection } from './ProductUnitsSection'
import { useTranslation } from 'react-i18next'
import {
  isPositiveQuantityInputDraft,
  projectStockAdjustment,
  type StockAdjustmentOperation,
} from '@/lib/products/productEditorUi'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// ── VAT options ───────────────────────────────────────────────────────────────

const VAT_OPTIONS: VatTreatment[] = ['inherit', 'exclusive', 'inclusive', 'exempt']

type ProductTab = 'general' | 'pricing' | 'inventory' | 'units' | 'barcodes'
export type ProductDrawerInitialTab = ProductTab
export type ProductDrawerInitialStockAction = 'add' | 'adjust' | null

const PRODUCT_TABS: { id: ProductTab; icon: typeof Box }[] = [
  { id: 'general', icon: ClipboardList },
  { id: 'pricing', icon: CircleDollarSign },
  { id: 'inventory', icon: PackageOpen },
  { id: 'units', icon: Box },
  { id: 'barcodes', icon: Barcode },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  product: ProductRow | null
  categories: Category[]
  products: ProductRow[]
  /** Explicit branch context for Owner/Admin catalogue management. */
  branchId?: string | null
  branchContext?: Pick<Branch, 'id' | 'stock_enabled' | 'vat_mode'> | null
  initialTab?: ProductDrawerInitialTab
  initialStockAction?: ProductDrawerInitialStockAction
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

export default function ProductDrawer({
  open,
  product,
  categories,
  branchId,
  branchContext,
  initialTab = 'general',
  initialStockAction = null,
  onClose,
  onSaved,
}: Props) {
  const { profile, tenant, branch: authBranch } = useAuth()
  const { t } = useTranslation(['products', 'inventory', 'common'])
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<HTMLInputElement>(null)
  const stockAdjustmentRef = useRef<HTMLInputElement>(null)
  const stockFocusKeyRef = useRef<string | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const tabRefs = useRef<Partial<Record<ProductTab, HTMLButtonElement | null>>>({})
  const initializedFormKey = useRef<string | null>(null)
  const skipNextDraftWrite = useRef(false)

  const [activeTab, setActiveTab] = useState<ProductTab>('general')
  const [visitedTabs, setVisitedTabs] = useState<Set<ProductTab>>(new Set(['general', 'pricing', 'inventory']))
  const [discardOpen, setDiscardOpen] = useState(false)
  const [disableStockOpen, setDisableStockOpen] = useState(false)
  const disableStockConfirmedRef = useRef(false)
  const [pendingRoute, setPendingRoute] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'price', string>>>({})
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
  const [adjustmentOperation, setAdjustmentOperation] = useState<StockAdjustmentOperation>('add')
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
  const [baseUnitDisplayName, setBaseUnitDisplayName] = useState('')

  const activeBranch = branchContext ?? authBranch
  const businessType = resolveBusinessType(tenant?.business_type)
  const stockModuleVisible = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: activeBranch?.stock_enabled,
  })
  const hasStockContext = tenant !== null && activeBranch !== null
  const stockControlsAllowed = hasStockContext && businessType === 'trading' && stockModuleVisible && product?.is_service !== true
  const currentStockQuantity = Number(product?.stock_quantity ?? 0)
  const productWasTracked = Boolean(product?.track_stock)
  const stockUnavailableMessage = !hasStockContext
    ? ''
    : businessType === 'service'
    ? 'Stock tracking is hidden for service businesses.'
    : product?.is_service
      ? 'Service products cannot track stock.'
      : activeBranch?.stock_enabled === false
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
  const dirtyTabs = useMemo(() => {
    const baselineValue = JSON.parse(savedBaseline ?? baseline)
    const result = new Set<ProductTab>()
    if (
      name !== baselineValue.name || nameAr !== baselineValue.nameAr
      || categoryId !== baselineValue.categoryId || description !== baselineValue.description
      || imagePreview !== baselineValue.imagePreview || imageFile !== null
      || isAvailable !== baselineValue.isAvailable || sortOrder !== baselineValue.sortOrder
      || sku !== baselineValue.sku || notes !== baselineValue.notes
    ) result.add('general')
    if (price !== baselineValue.price || vatTreatment !== baselineValue.vatTreatment) result.add('pricing')
    if (stockControlsAllowed && stockCurrent !== (savedStockBaseline ?? stockBaseline)) result.add('inventory')
    if (packageEditorDirty) result.add('units')
    return result
  }, [
    savedBaseline, baseline, name, nameAr, categoryId, description, imagePreview, imageFile,
    isAvailable, price, vatTreatment, stockControlsAllowed, stockCurrent, savedStockBaseline,
    stockBaseline, packageEditorDirty, sortOrder, sku, notes,
  ])

  const resolvedTenantId = profile?.tenant_id ?? tenant?.id ?? ''
  const resolvedBranchId = branchId ?? profile?.branch_id ?? activeBranch?.id ?? ''
  const draftKey = resolvedTenantId && resolvedBranchId
    ? `kubri:product-draft:${resolvedTenantId}:${resolvedBranchId}:${product ? `edit:${product.id}` : 'add'}`
    : ''
  const selectedCategory = categoryId
    ? categories.find(c => c.id === categoryId)
    : null
  const formBranchIsActive = Boolean(activeBranch?.id && (!product || product.branch_id === activeBranch.id))
  const branchVatMode: BranchVatMode | null = formBranchIsActive && activeBranch?.vat_mode === 'inclusive'
    ? 'inclusive'
    : formBranchIsActive && activeBranch?.vat_mode === 'exclusive'
      ? 'exclusive'
      : null
  const numericPrice = price !== '' && price !== '.' ? Number(price) : Number.NaN
  const pricePreview = vatTreatment === 'inherit' && !branchVatMode
    ? null
    : calculateVatPriceBreakdown(numericPrice, vatTreatment, branchVatMode ?? 'exclusive')
  const stockProjection = projectStockAdjustment(
    currentStockQuantity,
    adjustmentQuantity,
    adjustmentOperation,
  )

  // Initialize once per opened product. Background auth/profile refreshes must
  // never reset an already mounted form.
  useEffect(() => {
    if (!open) {
      initializedFormKey.current = null
      stockFocusKeyRef.current = null
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
    setAdjustmentOperation('add')
    setAdjustmentIdempotencyKey(null)
    setShowAdjustment(initialStockAction !== null)
    setCreatedProductId(null)
    setCreatedTrackedProduct(null)
    setPendingTrackedProduct(null)
    setCreatedProductWasTracked(false)
    setSavedBaseline(null)
    setSavedStockBaseline(null)
    setPackageEditorDirty(false)
    setProductCreatedMessage(false)
    setActiveTab(initialTab)
    setVisitedTabs(new Set(['general', 'pricing', 'inventory']))
    setBaseUnitDisplayName('')
    setFieldErrors({})
    setDiscardOpen(false)
    setPendingRoute(null)
    setError('')
  }, [open, product, draftKey, stockControlsAllowed, initialTab, initialStockAction])

  useEffect(() => {
    if (!open || !product || initialTab !== 'inventory' || initialStockAction === null) return
    if (activeTab !== 'inventory' || !showAdjustment) return
    const focusKey = `${product.id}:${initialStockAction}`
    if (stockFocusKeyRef.current === focusKey) return
    stockFocusKeyRef.current = focusKey
    const frame = window.requestAnimationFrame(() => stockAdjustmentRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, initialStockAction, initialTab, open, product, showAdjustment])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    const focusTimer = window.setTimeout(() => {
      if (initialStockAction === null) initialFocusRef.current?.focus()
    }, 0)
    return () => {
      window.clearTimeout(focusTimer)
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
      previousFocusRef.current?.focus()
    }
  }, [initialStockAction, open])

  useEffect(() => {
    if (!discardOpen) return
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('#product-discard-dialog button')?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [discardOpen])

  useEffect(() => {
    if (!open || !hasUnsavedChanges) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const routeGuard = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || event.defaultPrevented) return
      const destination = new URL(target.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      event.preventDefault()
      event.stopPropagation()
      setPendingRoute(`${destination.pathname}${destination.search}${destination.hash}`)
      setDiscardOpen(true)
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', routeGuard, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', routeGuard, true)
    }
  }, [open, hasUnsavedChanges])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (discardOpen) {
          setDiscardOpen(false)
          setPendingRoute(null)
        }
        else requestClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = discardOpen
        ? document.getElementById('product-discard-dialog')
        : dialogRef.current
      if (!root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.hasAttribute('hidden') && element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

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
    if (hasUnsavedChanges) {
      setPendingRoute(null)
      setDiscardOpen(true)
      return
    }
    performClose()
  }

  const performClose = () => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    clearDraft()
    if (pendingTrackedProduct) {
      setCreatedTrackedProduct(pendingTrackedProduct)
      return
    }
    onClose()
  }

  const discardAndContinue = () => {
    const route = pendingRoute
    setDiscardOpen(false)
    setPendingRoute(null)
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview)
    clearDraft()
    onClose()
    if (route) navigate(route)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFieldErrors({})
    if (!name.trim()) {
      const message = t('products:errors.nameRequired')
      setFieldErrors({ name: message })
      setError(message)
      setActiveTab('general')
      window.setTimeout(() => initialFocusRef.current?.focus(), 0)
      return
    }
    const numericPrice = Number(price)
    if (!price || isNaN(numericPrice)) {
      const message = t('products:errors.priceRequired')
      setFieldErrors({ price: message })
      setError(message)
      setActiveTab('pricing')
      return
    }
    if (numericPrice < 0) {
      const message = t('products:errors.priceNegative')
      setFieldErrors({ price: message })
      setError(message)
      setActiveTab('pricing')
      return
    }
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
      if (stockProjection.error === 'invalid' || stockProjection.delta === null) {
        setError(t('products:editor.adjustmentInvalid'))
        return
      }
      if (stockProjection.error === 'exceedsAvailable') {
        setError(t('products:editor.adjustmentExceeds'))
        return
      }
      adjustmentDelta = stockProjection.delta
      manualAdjustmentKey = adjustmentIdempotencyKey ?? createStockAdjustmentKey()
      if (!adjustmentIdempotencyKey) setAdjustmentIdempotencyKey(manualAdjustmentKey)
    }

    if (stockControlsAllowed && product && productWasTracked && !trackStock) {
      if (!disableStockConfirmedRef.current) {
        setDisableStockOpen(true)
        return
      }
      disableStockConfirmedRef.current = false
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
      setAdjustmentOperation('add')
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
      <div className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-2 md:left-[var(--app-sidebar-width)] md:p-5">
        <div role="dialog" aria-modal="true" aria-labelledby="product-created-title"
          aria-describedby="product-created-description"
          className="flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 id="product-created-title" className="text-base font-bold text-gray-900">{t('products:created')}</h2>
              <p id="product-created-description" className="text-xs text-gray-500 mt-0.5">
                {t('products:createdHint')}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label={t('common:close')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
              <X size={18} aria-hidden="true" />
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
      </div>
    )
  }

  const persistedProductId = product?.id ?? createdProductId
  const selectTab = (tab: ProductTab) => {
    setActiveTab(tab)
    setVisitedTabs(currentTabs => new Set(currentTabs).add(tab))
  }
  const handleTabKeyDown = (event: React.KeyboardEvent, tab: ProductTab) => {
    const index = PRODUCT_TABS.findIndex(item => item.id === tab)
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!direction) return
    event.preventDefault()
    const next = PRODUCT_TABS[(index + direction + PRODUCT_TABS.length) % PRODUCT_TABS.length].id
    selectTab(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-0 md:left-[var(--app-sidebar-width)] md:p-4" onMouseDown={event => event.stopPropagation()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
        aria-describedby="product-modal-description"
        className="flex h-full w-full flex-col overflow-hidden bg-[#fffdf7] shadow-2xl md:h-[min(90vh,900px)] md:w-[min(82%,1180px)] md:min-w-[min(880px,calc(100%_-_32px))] md:rounded-2xl md:border md:border-white/20"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="shrink-0 bg-[#173f2a] px-4 py-3 text-white sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 id="product-modal-title" className="truncate text-base font-bold sm:text-lg">
                    {product ? t('products:edit') : t('products:add')}
                  </h2>
                  {hasUnsavedChanges && (
                    <span className="text-xs font-semibold text-[#e7ca78]" role="status">
                      {t('products:editor.unsaved')}
                    </span>
                  )}
                </div>
                <p id="product-modal-description" className="mt-0.5 truncate text-xs text-white/70">
                  {product
                    ? (nameAr || name || product.name)
                    : t('products:editor.addDescription')}
                </p>
                {(product || createdProductId) && sku && (
                  <p className="mt-1 truncate text-[11px] text-[#e7ca78]" dir="ltr">
                    {t('products:editor.itemCode')}: <bdi>{sku}</bdi>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={requestClose}
                aria-label={t('common:close')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white/75 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#e7ca78]"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="shrink-0 border-b border-[#e8e1d1] bg-white px-2 sm:px-5">
            <div role="tablist" aria-label={t('products:editor.tabsLabel')} className="flex overflow-x-auto scrollbar-none">
              {PRODUCT_TABS.map(({ id, icon: Icon }) => {
                const selected = activeTab === id
                const hasError = (id === 'general' && fieldErrors.name) || (id === 'pricing' && fieldErrors.price)
                return (
                  <button
                    key={id}
                    ref={element => { tabRefs.current[id] = element }}
                    type="button"
                    role="tab"
                    id={`product-tab-${id}`}
                    aria-controls={`product-panel-${id}`}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectTab(id)}
                    onKeyDown={event => handleTabKeyDown(event, id)}
                    className={`relative flex h-12 shrink-0 items-center gap-2 px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 sm:px-4 ${
                      selected ? 'text-[#173f2a]' : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {t(`products:editor.tabs.${id}`)}
                    {dirtyTabs.has(id) && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label={t('products:editor.unsaved')} />}
                    {hasError && <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-label={t('products:editor.error')} />}
                    {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#b89138]" />}
                  </button>
                )
              })}
            </div>
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
            {error && (
              <div className="mx-auto mb-4 flex max-w-4xl items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <button
                  type="button"
                  className="text-start font-medium underline-offset-2 hover:underline"
                  onClick={() => selectTab(fieldErrors.price ? 'pricing' : 'general')}
                >
                  {error}
                </button>
              </div>
            )}

            <section
              role="tabpanel"
              id="product-panel-general"
              aria-labelledby="product-tab-general"
              hidden={activeTab !== 'general'}
              className="mx-auto max-w-4xl space-y-5"
            >
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_136px]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="product-name">{t('products:fields.name')} <span className="text-red-500">*</span></label>
                    <input ref={initialFocusRef} id="product-name" className="input" value={name} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'product-name-error' : undefined} onChange={event => { setName(event.target.value); setFieldErrors(currentErrors => ({ ...currentErrors, name: undefined })); setError('') }} placeholder={t('products:placeholders.name')} />
                    {fieldErrors.name && <p id="product-name-error" className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>}
                  </div>
                  <div>
                    <label className="label" htmlFor="product-name-ar">{t('products:fields.nameAr')}</label>
                    <input id="product-name-ar" className="input text-right" dir="rtl" value={nameAr} onChange={event => setNameAr(event.target.value)} placeholder="اسم المنتج" />
                  </div>
                  <div className="sm:max-w-xs">
                    <label className="label" htmlFor="product-category">{t('products:fields.category')}</label>
                    <select id="product-category" className="input" value={categoryId} onChange={event => setCategoryId(event.target.value)}>
                      <option value="">— {t('products:category.none')} —</option>
                      {categories.map(category => <option key={category.id} value={category.id}>{category.icon ? `${category.icon} ${category.name_ar || category.name}` : category.name_ar || category.name}</option>)}
                    </select>
                  </div>
                  <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                    <div><p className="text-sm font-semibold text-gray-800">{t('products:inventory.showInPos')}</p><p className="text-[11px] text-gray-500">{t('products:inventory.showInPosHint')}</p></div>
                    <Switch checked={isAvailable} onChange={setIsAvailable} ariaLabel={t('products:inventory.showInPos')} />
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleImageChange} />
                  <button type="button" onClick={() => fileRef.current?.click()} aria-label={imagePreview ? t('products:image.change') : t('products:image.upload')} className="flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-white text-gray-400 transition-colors hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500">
                    {imagePreview ? <img src={imagePreview} alt={t('products:image.preview')} className="h-full w-full object-cover" /> : <ImagePlus size={24} aria-hidden="true" />}
                  </button>
                  <div className="flex flex-wrap justify-center gap-1.5 text-[11px]">
                    <button type="button" className="min-h-9 rounded-lg px-2 font-semibold text-primary-700 hover:bg-primary-50" onClick={() => fileRef.current?.click()}>{imagePreview ? t('products:image.change') : t('products:image.upload')}</button>
                    {imagePreview && <button type="button" className="min-h-9 rounded-lg px-2 font-semibold text-red-600 hover:bg-red-50" onClick={() => { if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview); setImageFile(null); setImagePreview(null) }}>{t('products:image.remove')}</button>}
                  </div>
                  <p className="text-center text-[9px] leading-4 text-gray-400">{t('products:image.formats')}</p>
                </div>
              </div>

              <details className="rounded-xl border border-gray-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500">{t('products:editor.detailsDisclosure')}</summary>
                <div className="grid gap-4 border-t border-gray-100 p-4 sm:grid-cols-2">
                  <div><label className="label" htmlFor="product-description">{t('products:fields.description')}</label><textarea id="product-description" className="input resize-none" rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder={t('products:placeholders.description')} /></div>
                  <div><label className="label" htmlFor="product-notes">{t('products:editor.internalNote')}</label><textarea id="product-notes" className="input resize-none" rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder={t('products:placeholders.notes')} /></div>
                </div>
              </details>
            </section>

            <section role="tabpanel" id="product-panel-pricing" aria-labelledby="product-tab-pricing" hidden={activeTab !== 'pricing'} className="mx-auto max-w-4xl space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                <label className="label" htmlFor="product-price">
                  {baseUnitDisplayName ? t('products:editor.pricePerUnit', { unit: baseUnitDisplayName }) : t('products:fields.sellingPrice')} <span className="text-red-500">*</span>
                </label>
                <div className="relative max-w-sm">
                  <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">SAR</span>
                  <MoneyInput id="product-price" className="input ps-12" value={price} onValueChange={value => { setPrice(value); setFieldErrors(currentErrors => ({ ...currentErrors, price: undefined })); setError('') }} placeholder="0.00" aria-invalid={Boolean(fieldErrors.price)} aria-describedby={fieldErrors.price ? 'product-price-error' : undefined} />
                </div>
                {fieldErrors.price && <p id="product-price-error" className="mt-1 text-xs text-red-600">{fieldErrors.price}</p>}
              </div>
              <fieldset className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
                <legend className="label px-1">{t('products:fields.vatTreatment')}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
                  {VAT_OPTIONS.map(value => (
                    <label key={value} className={`group relative flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition-[border-color,background-color,box-shadow] duration-150 active:scale-[0.99] ${
                      vatTreatment === value
                        ? 'border-primary-500 bg-primary-50/80 shadow-[0_0_0_1px_rgba(34,120,77,0.08)]'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}>
                      <input
                        type="radio"
                        name="vat-treatment"
                        value={value}
                        checked={vatTreatment === value}
                        onChange={() => setVatTreatment(value)}
                        className="peer sr-only"
                      />
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        vatTreatment === value ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 bg-white text-transparent'
                      } peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2`}>
                        <Check size={13} strokeWidth={3} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-xs font-bold ${vatTreatment === value ? 'text-primary-900' : 'text-gray-800'}`}>{t(`products:editor.vatLabels.${value}`)}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-gray-500">{t(`products:editor.vatHelp.${value}`)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5" aria-live="polite">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" />
                  <p className="text-sm font-bold text-emerald-950">{t('products:pricing.preview')}</p>
                </div>
                {!pricePreview ? (
                  <p className="mt-3 text-xs text-emerald-900/70">{t('products:editor.previewUnavailable')}</p>
                ) : (
                  <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-emerald-900/70">{t('products:pricing.beforeVat')}</dt><dd className="text-end font-semibold tabular-nums text-emerald-950">{formatPreviewMoney(pricePreview.subtotal)}</dd>
                    <dt className="text-emerald-900/70">{t('products:pricing.vat')}</dt><dd className="text-end font-semibold tabular-nums text-emerald-950">{formatPreviewMoney(pricePreview.vatAmount)}</dd>
                    <dt className="mt-1 border-t border-emerald-200 pt-3 font-bold text-emerald-950">{t('products:pricing.customerPays')}</dt><dd className="mt-1 border-t border-emerald-200 pt-3 text-end text-lg font-extrabold tabular-nums text-emerald-800">{formatPreviewMoney(pricePreview.customerTotal)}</dd>
                  </dl>
                )}
              </div>
            </section>

            <section role="tabpanel" id="product-panel-inventory" aria-labelledby="product-tab-inventory" hidden={activeTab !== 'inventory'} className="mx-auto max-w-4xl space-y-4">
              {stockControlsAllowed ? (
                <div className="space-y-4 rounded-2xl border border-emerald-100 bg-white p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><PackageCheck size={18} /></span>
                      <div><p className="font-bold text-gray-900">{t('products:inventory.track')}</p><p className="mt-1 text-xs leading-5 text-gray-500">{t('products:editor.stockHelp')}</p></div>
                    </div>
                    <Switch checked={trackStock} onChange={next => { if (!next) { setAdjustmentQuantity(''); setAdjustmentOperation('add'); setShowAdjustment(false) } setTrackStock(next) }} ariaLabel={t('products:inventory.track')} />
                  </div>
                  {product && (
                    <dl className="grid gap-3 rounded-xl bg-gray-50 p-4 sm:grid-cols-2">
                      <div><dt className="text-xs text-gray-500">{t('products:inventory.current')}</dt><dd className="mt-1 text-lg font-bold tabular-nums text-gray-900">{productWasTracked ? formatStockQuantity(product.stock_quantity) : t('products:status.notTracked')}</dd></div>
                      <div><dt className="text-xs text-gray-500">{t('products:inventory.trackingStatus')}</dt><dd className={`mt-1 text-sm font-bold ${trackStock ? 'text-emerald-700' : 'text-gray-600'}`}>{t(trackStock ? 'products:editor.trackingEnabled' : 'products:editor.trackingDisabled')}</dd></div>
                    </dl>
                  )}
                  {product && productWasTracked && trackStock && (
                    <div>
                      <Button type="button" variant="secondary" onClick={() => setShowAdjustment(currentValue => !currentValue)}><SlidersHorizontal size={14} />{t('inventory:actions.adjust')}</Button>
                      {showAdjustment && (
                        <div className="mt-3 space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
                          <fieldset>
                            <legend className="label">{t('products:editor.adjustmentOperation')}</legend>
                            <div className="grid grid-cols-2 gap-2" role="radiogroup">
                              {(['add', 'remove'] as const).map(operation => {
                                const selected = adjustmentOperation === operation
                                const Icon = operation === 'add' ? Plus : Minus
                                return (
                                  <label key={operation} className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-[border-color,background-color,color] active:scale-[0.98] ${
                                    selected
                                      ? operation === 'add' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-amber-500 bg-amber-50 text-amber-800'
                                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                  }`}>
                                    <input type="radio" name="stock-operation" value={operation} checked={selected} onChange={() => { setAdjustmentOperation(operation); setAdjustmentIdempotencyKey(null) }} className="peer sr-only" />
                                    <Icon size={15} aria-hidden="true" />
                                    <span className="peer-focus-visible:rounded peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2">{t(`products:editor.${operation}Stock`)}</span>
                                  </label>
                                )
                              })}
                            </div>
                          </fieldset>
                          <div>
                            <label className="label" htmlFor="stock-adjustment">{t('products:fields.adjustmentQuantity')}</label>
                            <input
                              ref={stockAdjustmentRef}
                              id="stock-adjustment"
                              className="input max-w-sm"
                              type="number"
                              min="0"
                              step="0.001"
                              inputMode="decimal"
                              value={adjustmentQuantity}
                              aria-invalid={stockProjection.error !== null}
                              aria-describedby={stockProjection.error ? 'stock-adjustment-error' : 'stock-adjustment-help'}
                              onChange={event => {
                                if (!isPositiveQuantityInputDraft(event.target.value)) return
                                setAdjustmentQuantity(event.target.value)
                                setAdjustmentIdempotencyKey(null)
                              }}
                              placeholder={t('products:placeholders.adjustment')}
                            />
                            <p id="stock-adjustment-help" className="mt-1 text-[11px] text-gray-500">{t('products:editor.positiveQuantityHelp')}</p>
                            {stockProjection.error && (
                              <p id="stock-adjustment-error" className="mt-1 text-xs font-medium text-red-700" role="alert">
                                {t(stockProjection.error === 'exceedsAvailable' ? 'products:editor.adjustmentExceeds' : 'products:editor.adjustmentInvalid')}
                              </p>
                            )}
                          </div>
                          {stockProjection.quantity !== null && (
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-gray-200 bg-white p-3 text-xs" aria-live="polite">
                              <dt className="text-gray-500">{t('products:inventory.current')}</dt>
                              <dd className="text-end font-bold tabular-nums text-gray-900">{formatStockQuantity(currentStockQuantity)}</dd>
                              <dt className="text-gray-500">{t(`products:editor.${adjustmentOperation === 'add' ? 'adding' : 'removing'}`)}</dt>
                              <dd className="text-end font-bold tabular-nums text-gray-900">{formatStockQuantity(stockProjection.quantity)}</dd>
                              <dt className="border-t border-gray-100 pt-2 font-semibold text-gray-700">{t('products:editor.newStock')}</dt>
                              <dd className={`border-t border-gray-100 pt-2 text-end text-base font-extrabold tabular-nums ${stockProjection.error ? 'text-red-700' : 'text-emerald-700'}`}>{formatStockQuantity(stockProjection.projectedStock)}</dd>
                            </dl>
                          )}
                          <div className="flex items-start gap-2 text-[11px] leading-5 text-gray-600"><AlertTriangle size={13} className="mt-1 shrink-0 text-amber-600" aria-hidden="true" /><p>{t('products:editor.adjustmentIndependent')}</p></div>
                        </div>
                      )}
                    </div>
                  )}
                  {product && productWasTracked && !trackStock && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{t('products:editor.disableTrackingWarning')}</div>}
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">{stockUnavailableMessage || t('products:editor.stockUnavailable')}</div>
              )}
            </section>

            <section role="tabpanel" id="product-panel-units" aria-labelledby="product-tab-units" hidden={activeTab !== 'units'} className="mx-auto max-w-5xl">
              {!persistedProductId ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center"><Box className="mx-auto text-gray-300" /><p className="mt-3 font-bold text-gray-800">{t('products:editor.saveFirst')}</p></div>
              ) : visitedTabs.has('units') ? (
                <>
                  {productCreatedMessage && <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800" role="status">{t('products:units.productCreated')}</div>}
                  <ProductUnitsSection productId={persistedProductId} basePrice={price} productName={name.trim()} productNameAr={nameAr.trim() || null} sku={sku.trim() || null} serviceRestricted={businessType === 'service' || product?.is_service === true} stockEnabled={stockModuleVisible} onDirtyChange={setPackageEditorDirty} onBaseUnitName={setBaseUnitDisplayName} view="units" />
                </>
              ) : null}
            </section>

            <section role="tabpanel" id="product-panel-barcodes" aria-labelledby="product-tab-barcodes" hidden={activeTab !== 'barcodes'} className="mx-auto max-w-5xl">
              {!persistedProductId ? (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center"><Barcode className="mx-auto text-gray-300" /><p className="mt-3 font-bold text-gray-800">{t('products:editor.saveFirst')}</p></div>
              ) : visitedTabs.has('barcodes') ? (
                  <ProductUnitsSection productId={persistedProductId} basePrice={price} productName={name.trim()} productNameAr={nameAr.trim() || null} sku={sku.trim() || null} serviceRestricted={businessType === 'service' || product?.is_service === true} stockEnabled={stockModuleVisible} onDirtyChange={() => {}} onBaseUnitName={setBaseUnitDisplayName} view="barcodes" barcodeAutoFocus={activeTab === 'barcodes'} />
              ) : null}
            </section>

          </main>

          <footer className="shrink-0 border-t border-[#e8e1d1] bg-white px-4 py-3 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <p className="hidden max-w-xl text-xs leading-5 text-gray-500 sm:block">{t('products:editor.saveBoundary')}</p>
              <div className="ms-auto flex gap-2">
                <Button type="button" variant="secondary" onClick={requestClose}>{t('common:cancel')}</Button>
                <Button type="submit" loading={saving}>{product || createdProductId ? t('products:editor.saveProduct') : t('products:add')}</Button>
              </div>
            </div>
          </footer>
        </form>
      </div>

      <ConfirmDialog open={discardOpen} kind="discard" title={t('products:editor.discardTitle')} body={t('products:editor.discardDescription', { areas: Array.from(dirtyTabs).map(tab => t(`products:editor.tabs.${tab}`)).join(', ') })} confirmLabel={t('products:editor.discard')} destructive onClose={() => { setDiscardOpen(false); setPendingRoute(null) }} onConfirm={discardAndContinue} />
      <ConfirmDialog open={disableStockOpen} kind="deactivateStock" onClose={() => setDisableStockOpen(false)} onConfirm={() => { setDisableStockOpen(false); disableStockConfirmedRef.current = true; void handleSubmit({ preventDefault() {} } as React.FormEvent) }} />
    </div>
  )
}
