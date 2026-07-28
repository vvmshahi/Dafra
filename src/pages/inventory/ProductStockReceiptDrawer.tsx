import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, PackagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { displayName as dn } from '@/lib/utils/display'
import type { Supplier } from '@/types'
import type { ProductStockRow } from './ProductStockTab'
import { useTranslation, type TFunction } from 'react-i18next'

interface Props {
  open: boolean
  products: ProductStockRow[]
  suppliers: Supplier[]
  initialProduct: ProductStockRow | null
  onClose: () => void
  onSaved: () => void
}

const formatStockQuantity = (value: number | null | undefined, scale = 3) => {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0'
  if (Number.isInteger(numeric)) return String(numeric)
  return numeric.toFixed(Math.max(0, Math.min(6, scale))).replace(/\.?0+$/, '')
}

const createReceiptKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `product-stock-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

interface ReceivingUnit {
  id: string
  name: string
  nameAr: string | null
  code: string
  conversionToBase: number
  quantityScale: number
  isBase: boolean
  version: number
}

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function ProductStockReceiptDrawer({
  open,
  products,
  suppliers,
  initialProduct,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation(['inventory', 'common', 'products'])
  const [productId, setProductId] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [receivingUnits, setReceivingUnits] = useState<ReceivingUnit[]>([])
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const unitsRequestRef = useRef(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const productSearchRef = useRef<HTMLInputElement>(null)
  const quantityRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const resetForm = useCallback(() => {
    setProductId('')
    setProductSearch('')
    setSupplierId('')
    setQuantity('')
    setUnitCost('')
    setReceivingUnits([])
    setSelectedUnitId('')
    setReference('')
    setNote('')
    setIdempotencyKey(null)
    setError('')
  }, [])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    resetForm()
    setProductId(initialProduct?.id ?? '')
    setUnitCost(initialProduct ? String(Number(initialProduct.cost ?? 0)) : '')
    setUnitsLoading(Boolean(initialProduct))
    const focusTimer = window.setTimeout(() => {
      if (initialProduct) quantityRef.current?.focus()
      else productSearchRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(focusTimer)
  }, [initialProduct, open, resetForm])

  const requestClose = useCallback(() => {
    if (saving) return
    resetForm()
    onClose()
    window.setTimeout(() => previousFocusRef.current?.focus(), 0)
  }, [onClose, resetForm, saving])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusable.length === 0) return
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
  }, [open, requestClose, saving])

  const selectedProduct = useMemo(
    () => products.find(product => product.id === productId) ?? null,
    [productId, products],
  )
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase()
    if (!query) return products
    return products.filter(product =>
      [product.name, product.name_ar, product.sku, product.resolved_barcode]
        .some(value => value?.toLocaleLowerCase().includes(query)),
    )
  }, [productSearch, products])
  const selectedUnit = useMemo(
    () => receivingUnits.find(unit => unit.id === selectedUnitId) ?? null,
    [receivingUnits, selectedUnitId],
  )
  const baseUnit = useMemo(
    () => receivingUnits.find(unit => unit.isBase) ?? null,
    [receivingUnits],
  )

  useEffect(() => {
    if (!open || !selectedProduct) {
      unitsRequestRef.current += 1
      setReceivingUnits([])
      setSelectedUnitId('')
      setUnitsLoading(false)
      return
    }
    const requestId = unitsRequestRef.current + 1
    unitsRequestRef.current = requestId
    setUnitsLoading(true)
    setError('')
    void (supabase as any).rpc('get_product_units', {
      p_product_id: selectedProduct.id,
    }).then(({ data, error: unitsError }: { data: any[] | null; error: any }) => {
      if (unitsRequestRef.current !== requestId) return
      if (unitsError) {
        console.warn('[ProductStockReceiptDrawer] receiving-unit load failed', {
          code: unitsError.code ?? 'unknown',
        })
        setReceivingUnits([])
        setSelectedUnitId('')
        setError(t('inventory:errors.packageLoadFailed'))
        return
      }
      const loaded: ReceivingUnit[] = (data ?? [])
        .filter(row => row.is_active === true && row.receiving_enabled === true)
        .map(row => ({
          id: String(row.id),
          name: String(row.name),
          nameAr: row.name_ar ?? null,
          code: String(row.unit_code ?? 'PCE'),
          conversionToBase: Number(row.conversion_to_base),
          quantityScale: Number(row.quantity_scale ?? 0),
          isBase: row.is_base === true,
          version: Number(row.version),
        }))
        .sort((left, right) => Number(right.isBase) - Number(left.isBase))
      setReceivingUnits(loaded)
      const base = loaded.find(unit => unit.isBase) ?? loaded[0] ?? null
      setSelectedUnitId(base?.id ?? '')
      if (base) setUnitCost(String(Number(selectedProduct.cost ?? 0) * base.conversionToBase))
    }).finally(() => {
      if (unitsRequestRef.current === requestId) setUnitsLoading(false)
    })
  }, [open, selectedProduct, t])

  const quantityNumber = Number(quantity)
  const unitCostNumber = Number(unitCost)
  const quantityStep = selectedUnit
    ? 10 ** -Math.max(0, Math.min(6, selectedUnit.quantityScale))
    : 0.001
  const quantityValid = quantity !== '' && Number.isFinite(quantityNumber) && quantityNumber > 0
  const costValid = unitCost !== '' && Number.isFinite(unitCostNumber) && unitCostNumber >= 0
  const baseQuantityAdded = quantityValid && selectedUnit
    ? quantityNumber * selectedUnit.conversionToBase
    : 0
  const currentStock = Number(selectedProduct?.stock_quantity ?? 0)
  const projectedStock = currentStock + baseQuantityAdded
  const totalCost = quantityValid && costValid ? quantityNumber * unitCostNumber : 0
  const projectedBaseCost = selectedUnit && costValid
    ? unitCostNumber / selectedUnit.conversionToBase
    : Number(selectedProduct?.cost ?? 0)
  const projectedStockValue = projectedStock * projectedBaseCost
  const formValid = Boolean(selectedProduct && selectedUnit && quantityValid && costValid && !unitsLoading)
  const baseUnitName = baseUnit
    ? dn(baseUnit.name, baseUnit.nameAr)
    : (selectedProduct?.unit ?? t('inventory:receipt.baseUnits'))
  const selectedUnitName = selectedUnit ? dn(selectedUnit.name, selectedUnit.nameAr) : ''

  const clearReceiptKey = () => setIdempotencyKey(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!selectedProduct || !selectedUnit) {
      setError(t('inventory:errors.selectTracked'))
      return
    }
    if (!quantityValid) {
      setError(t('inventory:errors.quantityPositive'))
      quantityRef.current?.focus()
      return
    }
    if (!costValid) {
      setError(t('inventory:errors.costNonNegative'))
      return
    }

    const receiptKey = idempotencyKey ?? createReceiptKey()
    if (!idempotencyKey) setIdempotencyKey(receiptKey)
    setSaving(true)
    setError('')

    try {
      const { error: rpcError } = await (supabase as any).rpc('receive_product_stock', {
        p_payload: {
          product_id: selectedProduct.id,
          product_unit_id: selectedUnit.id,
          package_quantity: quantityNumber,
          expected_product_unit_version: selectedUnit.version,
          supplier_id: supplierId || null,
          unit_cost: unitCostNumber,
          reference: reference.trim() || null,
          note: note.trim() || null,
          idempotency_key: receiptKey,
        },
      })

      if (rpcError) {
        console.error('[ProductStockReceiptDrawer] receive failed', rpcError)
        const message = stockReceiptError(rpcError.message ?? '', t)
        setError(message)
        toast.error(message)
        return
      }

      toast.success(t('inventory:receipt.success', {
        quantity: formatStockQuantity(baseQuantityAdded),
        unit: baseUnitName,
        product: dn(selectedProduct.name, selectedProduct.name_ar),
      }))
      setIdempotencyKey(null)
      onSaved()
      resetForm()
      onClose()
      window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-2 md:left-[var(--app-sidebar-width)] md:p-5"
      onMouseDown={event => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-receipt-title"
        aria-describedby="stock-receipt-subtitle"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[min(90vh,820px)]"
      >
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-shrink-0 items-center gap-3 border-b border-primary-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <PackagePlus size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="stock-receipt-title" className="text-base font-bold text-gray-900">
                {t('inventory:receipt.title')}
              </h2>
              <p id="stock-receipt-subtitle" className="mt-0.5 truncate text-xs text-gray-500">
                {selectedProduct
                  ? dn(selectedProduct.name, selectedProduct.name_ar)
                  : t('inventory:receipt.subtitle')}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              aria-label={t('common:close')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <section aria-labelledby="receipt-product-heading">
              <h3 id="receipt-product-heading" className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {t('inventory:receipt.product')}
              </h3>
              {!initialProduct && (
                <input
                  ref={productSearchRef}
                  id="stock-product-search"
                  className="input mb-2"
                  value={productSearch}
                  onChange={event => setProductSearch(event.target.value)}
                  placeholder={t('inventory:receipt.searchProducts')}
                  aria-label={t('inventory:receipt.searchProducts')}
                />
              )}
              <select
                id="stock-product"
                className="input"
                aria-label={t('inventory:receipt.product')}
                value={productId}
                onChange={event => {
                  setProductId(event.target.value)
                  setReceivingUnits([])
                  setSelectedUnitId('')
                  setQuantity('')
                  clearReceiptKey()
                }}
              >
                <option value="">{t('inventory:receipt.selectProduct')}</option>
                {filteredProducts.map(product => (
                  <option key={product.id} value={product.id}>{dn(product.name, product.name_ar)}</option>
                ))}
              </select>

              {selectedProduct && (
                <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/40 p-3">
                  <div className="flex items-center gap-2">
                    <Boxes size={16} className="text-primary-700" aria-hidden="true" />
                    <p className="min-w-0 truncate text-sm font-semibold text-gray-900" dir="auto">
                      {dn(selectedProduct.name, selectedProduct.name_ar)}
                    </p>
                    <span className="ms-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      {t('inventory:receipt.stockTracked')}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-6">
                    {[
                      [t('inventory:columns.category'), selectedProduct.categories ? dn(selectedProduct.categories.name, selectedProduct.categories.name_ar) : t('inventory:item.uncategorized')],
                      [t('products:fields.sku'), selectedProduct.sku || t('inventory:noSku')],
                      [t('products:fields.barcode'), selectedProduct.resolved_barcode || t('inventory:noBarcode')],
                      [t('inventory:item.currentQty'), formatStockQuantity(selectedProduct.stock_quantity)],
                      [t('inventory:columns.latestCost'), <Rial amount={Number(selectedProduct.cost ?? 0)} />],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="min-w-0">
                        <dt className="truncate text-gray-500">{label}</dt>
                        <dd className="mt-0.5 truncate font-semibold text-gray-800" dir="auto">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </section>

            <section className="grid gap-4 md:grid-cols-2" aria-labelledby="receipt-unit-heading">
              <div>
                <label id="receipt-unit-heading" className="label" htmlFor="stock-receiving-unit">
                  {t('inventory:receipt.receiveAs')}
                </label>
                <select
                  id="stock-receiving-unit"
                  className="input"
                  value={selectedUnitId}
                  disabled={!selectedProduct || unitsLoading || receivingUnits.length === 0}
                  onChange={event => {
                    const nextId = event.target.value
                    const nextUnit = receivingUnits.find(unit => unit.id === nextId)
                    setSelectedUnitId(nextId)
                    setQuantity('')
                    setUnitCost(nextUnit
                      ? String(Number(selectedProduct?.cost ?? 0) * nextUnit.conversionToBase)
                      : '')
                    clearReceiptKey()
                  }}
                >
                  {unitsLoading && <option value="">{t('inventory:receipt.loadingUnits')}</option>}
                  {!unitsLoading && receivingUnits.length === 0 && (
                    <option value="">{t('inventory:receipt.noReceivingUnits')}</option>
                  )}
                  {receivingUnits.map(unit => (
                    <option key={unit.id} value={unit.id}>{dn(unit.name, unit.nameAr)}</option>
                  ))}
                </select>
                {selectedUnit && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {selectedUnit.isBase
                      ? t('inventory:receipt.baseUnitHelper', { unit: selectedUnitName })
                      : t('inventory:receipt.containsBaseUnits', {
                          quantity: formatStockQuantity(selectedUnit.conversionToBase, 6),
                          unit: baseUnitName,
                        })}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="stock-received-quantity">{t('inventory:receipt.receivedQuantity')}</label>
                  <input
                    ref={quantityRef}
                    id="stock-received-quantity"
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step={quantityStep}
                    min={quantityStep}
                    value={quantity}
                    aria-invalid={quantity !== '' && !quantityValid}
                    aria-describedby="stock-quantity-help stock-quantity-error"
                    onChange={event => {
                      setQuantity(event.target.value)
                      clearReceiptKey()
                    }}
                    placeholder="0"
                  />
                  <p id="stock-quantity-help" className="mt-1 text-[11px] text-gray-500">
                    {t('inventory:receipt.quantityScale', { scale: selectedUnit?.quantityScale ?? 3 })}
                  </p>
                  {quantity !== '' && !quantityValid && (
                    <p id="stock-quantity-error" className="mt-1 text-xs font-medium text-red-600">
                      {t('inventory:errors.quantityPositive')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="stock-unit-cost">
                    {selectedUnit
                      ? t('inventory:receipt.costPerUnit', { unit: selectedUnitName })
                      : t('inventory:receipt.costPerSelectedUnit')}
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-xs font-semibold text-gray-500" aria-hidden="true">
                      SAR
                    </span>
                    <MoneyInput
                      id="stock-unit-cost"
                      className="input ps-12"
                      value={unitCost}
                      aria-invalid={unitCost !== '' && !costValid}
                      aria-describedby="stock-cost-error"
                      onValueChange={value => {
                        setUnitCost(value)
                        clearReceiptKey()
                      }}
                      placeholder="0.00"
                    />
                  </div>
                  {unitCost !== '' && !costValid && (
                    <p id="stock-cost-error" className="mt-1 text-xs font-medium text-red-600">
                      {t('inventory:errors.costNonNegative')}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-primary-700 bg-[#173f2a] p-4 text-white" aria-labelledby="receipt-preview-heading">
              <h3 id="receipt-preview-heading" className="text-sm font-bold">{t('inventory:receipt.preview')}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-4" aria-live="polite">
                <PreviewItem label={t('inventory:receipt.currentStock')} value={`${formatStockQuantity(currentStock)} ${baseUnitName}`} />
                <PreviewItem label={t('inventory:receipt.receiving')} value={selectedUnit && quantityValid ? `${formatStockQuantity(quantityNumber)} ${selectedUnitName}` : '—'} />
                <PreviewItem label={t('inventory:receipt.baseQuantityAdded')} value={`${formatStockQuantity(baseQuantityAdded)} ${baseUnitName}`} />
                <PreviewItem label={t('inventory:receipt.newStock')} value={`${formatStockQuantity(projectedStock)} ${baseUnitName}`} />
                <PreviewItem label={t('inventory:receipt.previousLatestCost')} value={<Rial amount={Number(selectedProduct?.cost ?? 0)} />} />
                <PreviewItem label={t('inventory:receipt.receivedUnitCost')} value={<Rial amount={costValid ? unitCostNumber : 0} />} />
                <PreviewItem label={t('inventory:receipt.estimatedStockValue')} value={<Rial amount={projectedStockValue} />} />
                <div className="rounded-lg bg-white/10 px-3 py-2 ring-1 ring-inset ring-white/15">
                  <dt className="text-white/70">{t('inventory:receipt.totalCost')}</dt>
                  <dd className="mt-1 text-base font-bold text-[#f3d77f]"><Rial amount={totalCost} /></dd>
                </div>
              </dl>
              <p className="mt-2 text-[10px] text-white/60">{t('inventory:receipt.estimateHint')}</p>
            </section>

            <section className="grid gap-4 sm:grid-cols-2" aria-label={t('inventory:receipt.supplierReference')}>
              <div>
                <label className="label" htmlFor="stock-supplier">{t('inventory:receipt.supplierOptional')}</label>
                <select
                  id="stock-supplier"
                  className="input"
                  value={supplierId}
                  onChange={event => {
                    setSupplierId(event.target.value)
                    clearReceiptKey()
                  }}
                >
                  <option value="">{t('inventory:receipt.noSupplier')}</option>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>{dn(supplier.name, supplier.name_ar)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="stock-reference">{t('inventory:receipt.billReference')}</label>
                <input
                  id="stock-reference"
                  className="input"
                  value={reference}
                  onChange={event => {
                    setReference(event.target.value)
                    clearReceiptKey()
                  }}
                  placeholder={t('inventory:receipt.referencePlaceholder')}
                  dir="auto"
                />
                <p className="mt-1 text-[11px] text-gray-500">{t('inventory:receipt.referenceHelper')}</p>
              </div>
            </section>

            <section>
              <label className="label" htmlFor="stock-note">{t('inventory:receipt.note')}</label>
              <textarea
                id="stock-note"
                className="input resize-none"
                rows={2}
                value={note}
                onChange={event => {
                  setNote(event.target.value)
                  clearReceiptKey()
                }}
                placeholder={t('inventory:receipt.notePlaceholder')}
                dir="auto"
              />
              <p className="mt-1 text-[11px] text-gray-500">{t('inventory:receipt.noteHelper')}</p>
            </section>

            {error && (
              <div role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <footer className="flex flex-shrink-0 flex-col gap-3 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs leading-5 text-gray-600 sm:max-w-[66%]" aria-live="polite">
              {formValid
                ? t('inventory:receipt.confirmation', {
                    baseQuantity: formatStockQuantity(baseQuantityAdded),
                    baseUnit: baseUnitName,
                    product: dn(selectedProduct!.name, selectedProduct!.name_ar),
                    total: totalCost.toFixed(2),
                  })
                : t('inventory:receipt.completeRequired')}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="secondary" onClick={requestClose} disabled={saving} className="w-full sm:w-auto">
                {t('common:cancel')}
              </Button>
              <Button type="submit" loading={saving} disabled={!formValid || saving} className="w-full bg-[#173f2a] hover:bg-[#22563b] sm:w-auto">
                {t('inventory:actions.addStock')}
              </Button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}

function PreviewItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-1 py-1">
      <dt className="text-white/65">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums text-white">{value}</dd>
    </div>
  )
}

function stockReceiptError(message: string, t: TFunction) {
  if (/stock module is disabled/i.test(message)) return t('inventory:errors.disabled')
  if (/service product|service businesses/i.test(message)) return t('inventory:errors.serviceUnavailable')
  if (/track stock|must track stock/i.test(message)) return t('inventory:errors.trackingRequired')
  if (/changed; reload|stale.*version/i.test(message)) return t('inventory:errors.packageChanged')
  if (/unit is inactive|package.*inactive/i.test(message)) return t('inventory:errors.packageInactive')
  if (/not enabled for receiving|receiving.*disabled/i.test(message)) return t('inventory:errors.receivingDisabled')
  if (/fingerprint|idempotency/i.test(message)) return t('inventory:errors.receiptFingerprintMismatch')
  if (/supplier belongs|supplier not found/i.test(message)) return t('inventory:errors.supplierMismatch')
  if (/permission|forbidden|unauthorized/i.test(message)) return t('inventory:errors.forbidden')
  if (/quantity/i.test(message)) return t('inventory:errors.quantityInvalid')
  if (/unit purchase cost|unit_cost/i.test(message)) return t('inventory:errors.purchaseCostInvalid')
  return t('inventory:errors.receiveFailed')
}
