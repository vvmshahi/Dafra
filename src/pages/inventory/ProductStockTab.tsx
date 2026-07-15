import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Package, PackagePlus, SlidersHorizontal } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Category, Supplier } from '@/types'
import type { ProductRow } from '@/pages/products/ProductsPage'
import ProductDrawer from '@/pages/products/ProductDrawer'
import ProductStockReceiptDrawer from './ProductStockReceiptDrawer'

interface CategorySnap {
  name: string
  name_ar: string | null
  color: string | null
  icon: string | null
}

export interface ProductStockRow extends ProductRow {
  cost: number | null
  min_stock_alert: number | null
  unit: string | null
  categories: CategorySnap | null
}

function SumCard({ label, value, sub, accent }: {
  label: string
  value: React.ReactNode
  sub?: string
  accent?: 'green' | 'amber' | 'red'
}) {
  const valueClass =
    accent === 'green' ? 'text-emerald-600' :
    accent === 'amber' ? 'text-amber-600' :
    accent === 'red' ? 'text-red-500' :
    'text-gray-900'

  return (
    <div className="min-w-40 flex-1 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-card">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-gray-400">{sub}</p>}
    </div>
  )
}

const formatStockQuantity = (value: number | null | undefined) => {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0'
  if (Number.isInteger(numeric)) return String(numeric)
  return numeric.toFixed(3).replace(/\.?0+$/, '')
}

function productStatus(product: ProductStockRow) {
  const quantity = Number(product.stock_quantity ?? 0)
  const minimum = Number(product.min_stock_alert ?? 0)
  if (quantity <= 0) return { label: 'Out of stock', accent: 'red' as const }
  if (minimum > 0 && quantity <= minimum) return { label: 'Low stock', accent: 'amber' as const }
  return { label: 'In stock', accent: 'green' as const }
}

export default function ProductStockTab() {
  const { profile } = useAuth()

  const [products, setProducts] = useState<ProductStockRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptProduct, setReceiptProduct] = useState<ProductStockRow | null>(null)
  const [adjustProduct, setAdjustProduct] = useState<ProductStockRow | null>(null)

  const load = useCallback(async () => {
    const tid = profile?.tenant_id
    const bid = profile?.branch_id
    if (!tid || !bid) {
      setLoading(false)
      return
    }

    setLoading(true)
    const [{ data: productData }, { data: categoryData }, { data: supplierData }] = await Promise.all([
      supabase
        .from('products')
        .select([
          'id', 'tenant_id', 'branch_id', 'category_id', 'name', 'name_ar', 'description',
          'sku', 'barcode', 'price', 'cost', 'stock_quantity', 'min_stock_alert',
          'track_stock', 'image_url', 'is_active', 'is_available', 'sort_order',
          'vat_treatment', 'notes', 'is_service', 'unit',
          'categories(name,name_ar,color,icon)',
        ].join(','))
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .eq('is_active', true)
        .eq('track_stock', true)
        .eq('is_service', false)
        .order('name', { ascending: true }),
      supabase
        .from('categories')
        .select('*')
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('suppliers')
        .select('*')
        .eq('tenant_id', tid)
        .eq('branch_id', bid)
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ])

    setProducts((productData ?? []) as unknown as ProductStockRow[])
    setCategories((categoryData ?? []) as unknown as Category[])
    setSuppliers((supplierData ?? []) as unknown as Supplier[])
    setLoading(false)
  }, [profile?.tenant_id, profile?.branch_id])

  useEffect(() => { load() }, [load])

  const metrics = useMemo(() => {
    const totalUnits = products.reduce((sum, product) => sum + Number(product.stock_quantity ?? 0), 0)
    const totalValue = products.reduce(
      (sum, product) => sum + Number(product.stock_quantity ?? 0) * Number(product.cost ?? 0),
      0,
    )
    const lowStock = products.filter(product => {
      const quantity = Number(product.stock_quantity ?? 0)
      const minimum = Number(product.min_stock_alert ?? 0)
      return minimum > 0 && quantity <= minimum && quantity > 0
    }).length
    const outOfStock = products.filter(product => Number(product.stock_quantity ?? 0) <= 0).length

    return { totalUnits, totalValue, lowStock, outOfStock }
  }, [products])

  const openReceipt = (product: ProductStockRow | null = null) => {
    setReceiptProduct(product)
    setReceiptOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap gap-3">
          <SumCard label="Total Products" value={String(products.length)} sub="tracked products" />
          <SumCard label="Total Units" value={formatStockQuantity(metrics.totalUnits)} sub="available now" />
          <SumCard label="Total Stock Value" value={<Rial amount={metrics.totalValue} />} sub="at latest cost" accent="green" />
          <SumCard label="Low Stock" value={String(metrics.lowStock)} sub="above zero" accent={metrics.lowStock > 0 ? 'amber' : undefined} />
          <SumCard label="Out of Stock" value={String(metrics.outOfStock)} sub="needs receiving" accent={metrics.outOfStock > 0 ? 'red' : undefined} />
        </div>
        <Button size="sm" onClick={() => openReceipt()} className="flex-shrink-0">
          <PackagePlus size={14} />
          Add Stock
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <Package size={22} className="text-emerald-300" />
          </div>
          <p className="font-semibold text-gray-700">No tracked products yet</p>
          <p className="mt-1 max-w-sm text-sm text-gray-400">
            Enable inventory tracking from Products, then receive stock here.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <div className="flex-1">Product</div>
            <div className="hidden w-28 md:block">Category</div>
            <div className="hidden w-28 lg:block">SKU / Barcode</div>
            <div className="w-24 text-right">Stock</div>
            <div className="hidden w-28 text-right sm:block">Latest Cost</div>
            <div className="w-28 text-right">Stock Value</div>
            <div className="w-40 flex-shrink-0 text-right">Actions</div>
          </div>

          {products.map(product => {
            const status = productStatus(product)
            const quantity = Number(product.stock_quantity ?? 0)
            const cost = Number(product.cost ?? 0)
            const categoryColor = product.categories?.color ?? '#6b7280'
            const categoryIcon = product.categories?.icon ?? '📦'

            return (
              <div
                key={product.id}
                className={`flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 transition-colors last:border-0 ${
                  status.accent === 'red' ? 'bg-red-50/40' :
                  status.accent === 'amber' ? 'bg-amber-50/30' :
                  'hover:bg-gray-50/70'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-base"
                    style={{ backgroundColor: `${categoryColor}18` }}
                  >
                    {categoryIcon}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{dn(product.name, product.name_ar)}</p>
                    {product.name_ar && <p className="truncate text-[10px] text-gray-400" dir="rtl">{product.name_ar}</p>}
                  </div>
                </div>

                <div className="hidden w-28 md:block">
                  {product.categories?.name ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${categoryColor}22`, color: categoryColor }}
                    >
                      {product.categories.name}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>

                <div className="hidden w-28 lg:block">
                  <p className="truncate text-xs text-gray-700">{product.sku || 'No SKU'}</p>
                  <p className="truncate text-[10px] text-gray-400">{product.barcode || 'No barcode'}</p>
                </div>

                <div className="w-24 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {status.accent !== 'green' && (
                      <AlertTriangle
                        size={12}
                        className={status.accent === 'red' ? 'text-red-500' : 'text-amber-500'}
                      />
                    )}
                    <p className={`text-sm font-bold tabular-nums ${
                      status.accent === 'red' ? 'text-red-600' :
                      status.accent === 'amber' ? 'text-amber-600' :
                      'text-gray-900'
                    }`}>
                      {formatStockQuantity(quantity)}
                    </p>
                  </div>
                  <p className={`text-[10px] ${
                    status.accent === 'red' ? 'text-red-500' :
                    status.accent === 'amber' ? 'text-amber-600' :
                    'text-gray-400'
                  }`}>
                    {status.label}
                  </p>
                </div>

                <div className="hidden w-28 text-right sm:block">
                  <p className="text-sm tabular-nums text-gray-700"><Rial amount={cost} /></p>
                </div>

                <div className="w-28 text-right">
                  <p className="text-sm font-semibold tabular-nums text-emerald-600">
                    <Rial amount={quantity * cost} />
                  </p>
                </div>

                <div className="flex w-40 flex-shrink-0 justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openReceipt(product)}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdjustProduct(product)}>
                    <SlidersHorizontal size={13} />
                    Adjust
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ProductStockReceiptDrawer
        open={receiptOpen}
        products={products}
        suppliers={suppliers}
        initialProduct={receiptProduct}
        onClose={() => setReceiptOpen(false)}
        onSaved={load}
      />

      <ProductDrawer
        open={adjustProduct !== null}
        product={adjustProduct}
        categories={categories}
        products={products}
        onClose={() => setAdjustProduct(null)}
        onSaved={load}
      />
    </div>
  )
}
