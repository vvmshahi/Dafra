import { useEffect, useMemo, useState } from 'react'
import { PackagePlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Supplier } from '@/types'
import type { ProductStockRow } from './ProductStockTab'

interface Props {
  open: boolean
  products: ProductStockRow[]
  suppliers: Supplier[]
  initialProduct: ProductStockRow | null
  onClose: () => void
  onSaved: () => void
}

const formatStockQuantity = (value: number | null | undefined) => {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0'
  if (Number.isInteger(numeric)) return String(numeric)
  return numeric.toFixed(3).replace(/\.?0+$/, '')
}

const createReceiptKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `product-stock-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function ProductStockReceiptDrawer({
  open,
  products,
  suppliers,
  initialProduct,
  onClose,
  onSaved,
}: Props) {
  const [productId, setProductId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setProductId(initialProduct?.id ?? '')
    setSupplierId('')
    setQuantity('')
    setUnitCost(initialProduct ? String(Number(initialProduct.cost ?? 0)) : '')
    setReference('')
    setNote('')
    setIdempotencyKey(null)
    setError('')
  }, [open, initialProduct])

  const selectedProduct = useMemo(
    () => products.find(product => product.id === productId) ?? null,
    [productId, products],
  )
  const quantityNumber = Number(quantity)
  const unitCostNumber = Number(unitCost)
  const totalCost = Number.isFinite(quantityNumber) && Number.isFinite(unitCostNumber)
    ? Math.max(quantityNumber, 0) * Math.max(unitCostNumber, 0)
    : 0

  const clearReceiptKey = () => setIdempotencyKey(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedProduct) {
      setError('Select a tracked product.')
      return
    }
    if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
      setError('Quantity received must be greater than zero.')
      return
    }
    if (!Number.isFinite(unitCostNumber) || unitCostNumber < 0) {
      setError('Unit purchase cost must be zero or higher.')
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
          supplier_id: supplierId || null,
          quantity: quantityNumber,
          unit_cost: unitCostNumber,
          reference: reference.trim() || null,
          note: note.trim() || null,
          idempotency_key: receiptKey,
        },
      })

      if (rpcError) {
        setError(stockReceiptError(rpcError.message ?? ''))
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

      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col bg-white shadow-2xl">
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <PackagePlus size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Add Stock</h2>
                <p className="mt-0.5 text-xs text-gray-400">Receive stock for an existing product</p>
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
              <label className="label">Product</label>
              <select
                className="input"
                value={productId}
                onChange={event => {
                  setProductId(event.target.value)
                  clearReceiptKey()
                }}
              >
                <option value="">Select product</option>
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {dn(product.name, product.name_ar)}
                  </option>
                ))}
              </select>
            </div>

            {selectedProduct && (
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">{dn(selectedProduct.name, selectedProduct.name_ar)}</p>
                {selectedProduct.name_ar && (
                  <p className="mt-0.5 text-xs text-gray-500" dir="rtl">{selectedProduct.name_ar}</p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400">Category</p>
                    <p className="mt-0.5 font-medium text-gray-700">{selectedProduct.categories?.name ?? 'Uncategorised'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Current Stock</p>
                    <p className="mt-0.5 font-semibold text-gray-900">{formatStockQuantity(selectedProduct.stock_quantity)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">SKU</p>
                    <p className="mt-0.5 font-medium text-gray-700">{selectedProduct.sku || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Barcode</p>
                    <p className="mt-0.5 font-medium text-gray-700">{selectedProduct.barcode || '—'}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="label">Supplier (Optional)</label>
              <select
                className="input"
                value={supplierId}
                onChange={event => {
                  setSupplierId(event.target.value)
                  clearReceiptKey()
                }}
              >
                <option value="">No supplier</option>
                {suppliers.map(supplier => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Quantity Received</label>
                <input
                  className="input"
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={quantity}
                  onChange={event => {
                    setQuantity(event.target.value)
                    clearReceiptKey()
                  }}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="label">Unit Purchase Cost</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={unitCost}
                  onChange={event => {
                    setUnitCost(event.target.value)
                    clearReceiptKey()
                  }}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3">
              <span className="text-sm font-semibold text-emerald-800">Total Purchase Cost</span>
              <span className="text-sm font-bold tabular-nums text-emerald-700">
                <Rial amount={totalCost} />
              </span>
            </div>

            <div>
              <label className="label">Reference</label>
              <input
                className="input"
                value={reference}
                onChange={event => {
                  setReference(event.target.value)
                  clearReceiptKey()
                }}
                placeholder="Bill number or receipt reference"
              />
            </div>

            <div>
              <label className="label">Note</label>
              <textarea
                className="input resize-none"
                rows={3}
                value={note}
                onChange={event => {
                  setNote(event.target.value)
                  clearReceiptKey()
                }}
                placeholder="Optional note"
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
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Add Stock
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}

function stockReceiptError(message: string) {
  if (/stock module is disabled/i.test(message)) return 'Stock is disabled for this branch.'
  if (/service product|service businesses/i.test(message)) return 'Stock receiving is not available for service products.'
  if (/track stock|must track stock/i.test(message)) return 'Enable stock tracking for this product before receiving stock.'
  if (/supplier belongs|supplier not found/i.test(message)) return 'Selected supplier does not match this branch.'
  if (/permission|forbidden|unauthorized/i.test(message)) return 'You do not have permission to receive stock.'
  if (/quantity/i.test(message)) return 'Enter a valid quantity received.'
  if (/unit purchase cost|unit_cost/i.test(message)) return 'Enter a valid unit purchase cost.'
  return message || 'Stock could not be received. Check the values and try again.'
}
