import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Boxes, CircleDollarSign, Package, PackagePlus, PackageX, SlidersHorizontal,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import { displayName as dn } from '@/lib/utils/display'
import type { Category, Supplier } from '@/types'
import type { ProductRow } from '@/pages/products/ProductsPage'
import ProductDrawer, { type ProductDrawerInitialStockAction } from '@/pages/products/ProductDrawer'
import ProductStockReceiptDrawer from './ProductStockReceiptDrawer'
import { useTranslation } from 'react-i18next'

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
  resolved_barcode?: string | null
  categories: CategorySnap | null
}

function SumCard({ label, value, sub, icon: Icon, accent = 'blue', active = true, emphasized = false }: {
  label: string
  value: React.ReactNode
  sub?: string
  icon: typeof Package
  accent?: 'blue' | 'teal' | 'green' | 'amber' | 'red'
  active?: boolean
  emphasized?: boolean
}) {
  const tone = active ? accent : 'neutral'
  const toneClasses = {
    blue: { icon: 'bg-blue-50 text-blue-700', value: 'text-gray-900' },
    teal: { icon: 'bg-teal-50 text-teal-700', value: 'text-gray-900' },
    green: { icon: 'bg-primary-50 text-primary-700', value: 'text-primary-700' },
    amber: { icon: 'bg-amber-50 text-amber-700', value: 'text-amber-700' },
    red: { icon: 'bg-red-50 text-red-700', value: 'text-red-700' },
    neutral: { icon: 'bg-gray-100 text-gray-500', value: 'text-gray-900' },
  } as const
  const styles = toneClasses[tone]
  const valueClass =
    emphasized ? 'text-primary-700' : styles.value

  return (
    <div className="min-w-40 flex-1 rounded-xl border border-[#173f2a]/70 bg-white px-4 py-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-gray-500">{label}</p>
          <p className={`mt-0.5 text-lg font-bold tabular-nums ${valueClass}`}>{value}</p>
        </div>
        <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${styles.icon}`} aria-hidden="true">
          <Icon size={15} />
        </span>
      </div>
      {sub && <p className="mt-0.5 truncate text-[10px] text-gray-500">{sub}</p>}
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
  if (quantity <= 0) return { key: 'status.outOfStock', accent: 'red' as const }
  if (minimum > 0 && quantity <= minimum) return { key: 'status.lowStock', accent: 'amber' as const }
  return { key: 'status.inStock', accent: 'green' as const }
}

interface ProductUnitReadRow {
  id: string
  is_active: boolean
  is_base: boolean
}

interface ProductBarcodeReadRow {
  barcode: string
  product_unit_id: string
  is_active: boolean
  is_primary: boolean
}

async function resolveBaseUnitBarcode(product: ProductStockRow) {
  try {
    const [{ data: unitData, error: unitError }, { data: barcodeData, error: barcodeError }] = await Promise.all([
      (supabase as any).rpc('get_product_units', { p_product_id: product.id }),
      (supabase as any).rpc('list_product_unit_barcodes', { p_product_id: product.id }),
    ])

    if (unitError || barcodeError) return product.barcode ?? null

    const baseUnit = ((unitData ?? []) as ProductUnitReadRow[])
      .find(unit => unit.is_active === true && unit.is_base === true)
    if (!baseUnit) return product.barcode ?? null

    const barcode = ((barcodeData ?? []) as ProductBarcodeReadRow[])
      .filter(item => item.is_active === true && item.product_unit_id === baseUnit.id)
      .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))[0]

    return barcode?.barcode ?? product.barcode ?? null
  } catch {
    return product.barcode ?? null
  }
}

interface ProductStockTabProps {
  initialReceiptProductId?: string | null
  onInitialReceiptHandled?: () => void
}

export default function ProductStockTab({
  initialReceiptProductId = null,
  onInitialReceiptHandled,
}: ProductStockTabProps) {
  const { profile } = useAuth()
  const { t } = useTranslation(['inventory', 'common'])

  const [products, setProducts] = useState<ProductStockRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptProduct, setReceiptProduct] = useState<ProductStockRow | null>(null)
  const [editorContext, setEditorContext] = useState<{
    product: ProductStockRow
    stockAction: ProductDrawerInitialStockAction
  } | null>(null)

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

    const loadedProducts = (productData ?? []) as unknown as ProductStockRow[]
    const productsWithBarcodes = await Promise.all(loadedProducts.map(async product => ({
      ...product,
      resolved_barcode: await resolveBaseUnitBarcode(product),
    })))
    setProducts(productsWithBarcodes)
    setCategories((categoryData ?? []) as unknown as Category[])
    setSuppliers((supplierData ?? []) as unknown as Supplier[])
    setLoading(false)
  }, [profile?.tenant_id, profile?.branch_id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!initialReceiptProductId || loading) return

    const product = products.find(item => item.id === initialReceiptProductId)
    if (product) {
      setReceiptProduct(product)
      setReceiptOpen(true)
    }

    onInitialReceiptHandled?.()
  }, [initialReceiptProductId, loading, onInitialReceiptHandled, products])

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

  const closeReceipt = () => {
    setReceiptOpen(false)
    setReceiptProduct(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap gap-3">
          <SumCard icon={Package} accent="blue" label={t('inventory:metrics.totalProducts')} value={String(products.length)} sub={t('inventory:metrics.trackedProducts')} />
          <SumCard icon={Boxes} accent="teal" label={t('inventory:metrics.totalUnits')} value={formatStockQuantity(metrics.totalUnits)} sub={t('inventory:metrics.availableNow')} />
          <SumCard icon={CircleDollarSign} accent="green" emphasized label={t('inventory:metrics.totalValue')} value={<Rial amount={metrics.totalValue} />} sub={t('inventory:metrics.latestCost')} />
          <SumCard icon={AlertTriangle} accent="amber" active={metrics.lowStock > 0} label={t('inventory:metrics.lowStock')} value={String(metrics.lowStock)} sub={metrics.lowStock > 0 ? t('inventory:metrics.productsBelowThreshold', { count: metrics.lowStock }) : t('inventory:metrics.noneBelowThreshold')} />
          <SumCard icon={PackageX} accent="red" active={metrics.outOfStock > 0} label={t('inventory:metrics.outOfStock')} value={String(metrics.outOfStock)} sub={metrics.outOfStock > 0 ? t('inventory:metrics.productsNeedReceiving', { count: metrics.outOfStock }) : t('inventory:metrics.noneNeedReceiving')} />
        </div>
        <Button size="sm" onClick={() => openReceipt()} className="flex-shrink-0">
          <PackagePlus size={14} />
          {t('inventory:actions.addStock')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50">
            <Package size={22} className="text-emerald-300" />
          </div>
          <p className="font-semibold text-gray-700">{t('inventory:emptyTracked')}</p>
          <p className="mt-1 max-w-sm text-sm text-gray-400">
            {t('inventory:emptyTrackedHint')}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <div className="flex-1">{t('inventory:columns.product')}</div>
            <div className="hidden w-28 md:block">{t('inventory:columns.category')}</div>
            <div className="hidden w-28 lg:block">{t('inventory:columns.skuBarcode')}</div>
            <div className="w-24 text-end">{t('inventory:columns.stock')}</div>
            <div className="hidden w-28 text-end sm:block">{t('inventory:columns.latestCost')}</div>
            <div className="w-28 text-end">{t('inventory:columns.stockValue')}</div>
            <div className="w-40 flex-shrink-0 text-end">{t('inventory:columns.actions')}</div>
          </div>

          {products.map(product => {
            const status = productStatus(product)
            const quantity = Number(product.stock_quantity ?? 0)
            const cost = Number(product.cost ?? 0)
            const categoryColor = product.categories?.color ?? '#6b7280'
            const categoryIcon = product.categories?.icon ?? ''

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
                    <p className="truncate text-sm font-semibold text-gray-900" dir="auto">{dn(product.name, product.name_ar)}</p>
                    {product.name_ar && <p className="truncate text-[10px] text-gray-400" dir="rtl">{product.name_ar}</p>}
                  </div>
                </div>

                <div className="hidden w-28 md:block">
                  {product.categories?.name ? (
                    <span
                      className="inline-block max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${categoryColor}22`, color: categoryColor }}
                    >
                      <span dir="auto">{dn(product.categories.name, product.categories.name_ar)}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>

                <div className="hidden w-28 lg:block">
                  <p className="truncate text-xs text-gray-700" dir="ltr">{product.sku || t('inventory:noSku')}</p>
                  <p className="truncate text-[10px] text-gray-400" dir="ltr">{product.resolved_barcode || t('inventory:noBarcode')}</p>
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
                    {t(`inventory:${status.key}`)}
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
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openReceipt(product)}
                    title={t('inventory:actions.addStockFor', { name: dn(product.name, product.name_ar) })}
                    aria-label={t('inventory:actions.addStockFor', { name: dn(product.name, product.name_ar) })}
                  >
                    {t('inventory:actions.addStock')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditorContext({ product, stockAction: 'adjust' })}
                    className="h-9 w-9 flex-shrink-0 p-0 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                    title={t('inventory:actions.adjustStockFor', { name: dn(product.name, product.name_ar) })}
                    aria-label={t('inventory:actions.adjustStockFor', { name: dn(product.name, product.name_ar) })}
                  >
                    <SlidersHorizontal size={15} aria-hidden="true" />
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
        onClose={closeReceipt}
        onSaved={load}
      />

      <ProductDrawer
        open={editorContext !== null}
        product={editorContext?.product ?? null}
        categories={categories}
        products={products}
        initialTab="inventory"
        initialStockAction={editorContext?.stockAction ?? null}
        onClose={() => setEditorContext(null)}
        onSaved={load}
      />
    </div>
  )
}
