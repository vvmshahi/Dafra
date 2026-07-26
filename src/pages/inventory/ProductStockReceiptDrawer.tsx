import { useEffect, useMemo, useRef, useState } from 'react'
import { PackagePlus, X } from 'lucide-react'
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

export default function ProductStockReceiptDrawer({
  open,
  products,
  suppliers,
  initialProduct,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation(['inventory', 'common'])
  const [productId, setProductId] = useState('')
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

  useEffect(() => {
    if (!open) return
    setProductId(initialProduct?.id ?? '')
    setSupplierId('')
    setQuantity('')
    setUnitCost(initialProduct ? String(Number(initialProduct.cost ?? 0)) : '')
    setReceivingUnits([])
    setSelectedUnitId('')
    setUnitsLoading(Boolean(initialProduct))
    setReference('')
    setNote('')
    setIdempotencyKey(null)
    setError('')
  }, [open, initialProduct])

  const selectedProduct = useMemo(
    () => products.find(product => product.id === productId) ?? null,
    [productId, products],
  )
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
      if (base) {
        setUnitCost(String(Number(selectedProduct.cost ?? 0) * base.conversionToBase))
      }
    }).finally(() => {
      if (unitsRequestRef.current === requestId) setUnitsLoading(false)
    })
  }, [open, selectedProduct, t])

  const quantityNumber = Number(quantity)
  const unitCostNumber = Number(unitCost)
  const totalCost = Number.isFinite(quantityNumber) && Number.isFinite(unitCostNumber)
    ? Math.max(quantityNumber, 0) * Math.max(unitCostNumber, 0)
    : 0

  const clearReceiptKey = () => setIdempotencyKey(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedProduct || !selectedUnit) {
      setError(t('inventory:errors.selectTracked'))
      return
    }
    if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
      setError(t('inventory:errors.quantityPositive'))
      return
    }
    if (!Number.isFinite(unitCostNumber) || unitCostNumber < 0) {
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
        setError(stockReceiptError(rpcError.message ?? '', t))
        return
      }

      setIdempotencyKey(null)
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={saving ? undefined : onClose} />

      <div className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[520px] flex-col bg-white shadow-2xl">
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <PackagePlus size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">{t('inventory:receipt.title')}</h2>
                <p className="mt-0.5 text-xs text-gray-400">{t('inventory:receipt.subtitle')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-gray-100"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <label className="label">{t('inventory:receipt.product')}</label>
              <select
                className="input"
                value={productId}
                onChange={event => {
                  setProductId(event.target.value)
                  setReceivingUnits([])
                  setSelectedUnitId('')
                  clearReceiptKey()
                }}
              >
                <option value="">{t('inventory:receipt.selectProduct')}</option>
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {dn(product.name, product.name_ar)}
                  </option>
                ))}
              </select>
            </div>

            {selectedProduct && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900" dir="auto">{dn(selectedProduct.name, selectedProduct.name_ar)}</p>
                {selectedProduct.name_ar && (
                  <p className="mt-0.5 text-xs text-gray-500" dir="rtl">{selectedProduct.name_ar}</p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400">{t('inventory:columns.category')}</p>
                    <p className="mt-0.5 font-medium text-gray-700" dir="auto">{selectedProduct.categories ? dn(selectedProduct.categories.name, selectedProduct.categories.name_ar) : t('inventory:item.uncategorized')}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">{t('inventory:item.currentQty')}</p>
                    <p className="mt-0.5 font-semibold text-gray-900">{formatStockQuantity(selectedProduct.stock_quantity)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">{t('products:fields.sku')}</p>
                    <p className="mt-0.5 font-medium text-gray-700">{selectedProduct.sku || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">{t('products:fields.barcode')}</p>
                    <p className="mt-0.5 font-medium text-gray-700">{selectedProduct.barcode || '—'}</p>
                  </div>
                </div>
              </div>
            )}

            {selectedProduct && (
              <div>
                <label className="label">{t('inventory:receipt.receivingUnit')}</label>
                <select
                  className="input"
                  value={selectedUnitId}
                  disabled={unitsLoading || receivingUnits.length === 0}
                  onChange={event => {
                    const nextId = event.target.value
                    const nextUnit = receivingUnits.find(unit => unit.id === nextId)
                    setSelectedUnitId(nextId)
                    setQuantity('')
                    setUnitCost(nextUnit
                      ? String(Number(selectedProduct.cost ?? 0) * nextUnit.conversionToBase)
                      : '')
                    clearReceiptKey()
                  }}
                >
                  {unitsLoading && <option value="">{t('inventory:receipt.loadingUnits')}</option>}
                  {!unitsLoading && receivingUnits.length === 0 && (
                    <option value="">{t('inventory:receipt.noReceivingUnits')}</option>
                  )}
                  {receivingUnits.map(unit => (
                    <option key={unit.id} value={unit.id}>
                      {dn(unit.name, unit.nameAr)}
                    </option>
                  ))}
                </select>
                {selectedUnit && !selectedUnit.isBase && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    {t('inventory:receipt.containsBaseUnits', {
                      quantity: formatStockQuantity(selectedUnit.conversionToBase, 6),
                      unit: baseUnit ? dn(baseUnit.name, baseUnit.nameAr) : (selectedProduct.unit ?? ''),
                    })}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="label">{t('inventory:receipt.supplierOptional')}</label>
              <select
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('inventory:receipt.quantityReceived')}</label>
                <input
                  className="input"
                  type="number"
                  step={selectedUnit ? 10 ** -Math.max(0, Math.min(6, selectedUnit.quantityScale)) : 0.001}
                  min={selectedUnit ? 10 ** -Math.max(0, Math.min(6, selectedUnit.quantityScale)) : 0.001}
                  value={quantity}
                  onChange={event => {
                    setQuantity(event.target.value)
                    clearReceiptKey()
                  }}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">{t('inventory:receipt.unitCost')}</label>
                <MoneyInput
                  className="input"
                  value={unitCost}
                  onValueChange={value => {
                    setUnitCost(value)
                    clearReceiptKey()
                  }}
                  placeholder="0.00"
                />
              </div>
            </div>

            {selectedUnit && quantityNumber > 0 && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
                <p className="font-semibold">{t('inventory:receipt.baseQuantityAdded')}</p>
                <p className="mt-0.5 tabular-nums" dir="auto">
                  {t('inventory:receipt.baseQuantityAddedValue', {
                    quantity: formatStockQuantity(quantityNumber * selectedUnit.conversionToBase),
                    unit: baseUnit ? dn(baseUnit.name, baseUnit.nameAr) : (selectedProduct?.unit ?? ''),
                  })}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3">
              <span className="text-sm font-semibold text-emerald-800">{t('inventory:receipt.totalCost')}</span>
              <span className="text-sm font-bold tabular-nums text-emerald-700">
                <Rial amount={totalCost} />
              </span>
            </div>

            <div>
              <label className="label">{t('inventory:receipt.reference')}</label>
              <input
                className="input"
                value={reference}
                onChange={event => {
                  setReference(event.target.value)
                  clearReceiptKey()
                }}
                placeholder={t('inventory:receipt.referencePlaceholder')}
                dir="auto"
              />
            </div>

            <div>
              <label className="label">{t('inventory:receipt.note')}</label>
              <textarea
                className="input resize-none"
                rows={3}
                value={note}
                onChange={event => {
                  setNote(event.target.value)
                  clearReceiptKey()
                }}
                placeholder={t('inventory:receipt.notePlaceholder')}
                dir="auto"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 justify-end gap-3 border-t border-gray-100 px-6 py-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" loading={saving} disabled={unitsLoading || !selectedUnit}>
              {t('inventory:actions.addStock')}
            </Button>
          </div>
        </form>
      </div>
    </>
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
