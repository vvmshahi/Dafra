import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Download, FileSpreadsheet, FileText, Loader2, PackageOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { catalogueTextMatches } from '@/lib/products/catalogue'
import {
  CATALOGUE_EXPORT_MAX_ROWS,
  downloadCatalogueExport,
  type CatalogueExportFormat,
  type CatalogueExportItemType,
  type CatalogueExportPayload,
  type CatalogueExportScope,
  type CatalogueExportStatus,
} from '@/lib/products/catalogueExport'
import CatalogueImportPanel from './CatalogueImportPanel'

type CategoryRow = {
  id: string
  name: string
  is_active: boolean
}

type ExportProductRow = {
  id: string
  category_id: string | null
  name: string
  name_ar: string | null
  sku: string | null
  barcode: string | null
  price: number
  stock_quantity: number | null
  track_stock: boolean
  unit: string | null
  unit_ar: string | null
  vat_treatment: 'inherit' | 'exclusive' | 'inclusive' | 'exempt' | null
  is_active: boolean
  is_service: boolean
  categories: { name: string } | null
}

interface Props {
  open: boolean
  branchId: string
  tenantId: string
  branchName: string
  branchStockEnabled: boolean
  canExport: boolean
  initialSearch: string
  initialCategoryId: string
  onImportComplete?: () => Promise<void> | void
  onClose: () => void
}

function isEligible(scope: CatalogueExportScope, payload: CatalogueExportPayload) {
  return scope === 'items'
    ? payload.items.length > 0
    : scope === 'categories'
      ? payload.categories.length > 0
      : payload.items.length > 0 || payload.categories.length > 0
}

export default function CatalogueExportDialog({
  open,
  branchId,
  tenantId,
  branchName,
  branchStockEnabled,
  canExport,
  initialSearch,
  initialCategoryId,
  onImportComplete,
  onClose,
}: Props) {
  const { t } = useTranslation('products')
  const [scope, setScope] = useState<CatalogueExportScope>('items')
  const [format, setFormat] = useState<CatalogueExportFormat>('xlsx')
  const [itemType, setItemType] = useState<CatalogueExportItemType>('all')
  const [status, setStatus] = useState<CatalogueExportStatus>('all')
  const [categoryId, setCategoryId] = useState(initialCategoryId)
  const [search, setSearch] = useState(initialSearch)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [payload, setPayload] = useState<CatalogueExportPayload | null>(null)
  const [stage, setStage] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'import' | 'export'>('import')
  const close = useCallback(() => { if (stage !== 'preparing') onClose() }, [onClose, stage])
  const dialogRef = useDialogFocus(open, close)

  useEffect(() => {
    if (!open) return
    setScope('items')
    setFormat('xlsx')
    setItemType('all')
    setStatus('all')
    setCategoryId(initialCategoryId)
    setSearch(initialSearch)
    setPayload(null)
    setStage('idle')
    setError(null)
    setMode('import')
    void supabase
      .from('categories')
      .select('id,name,is_active')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(({ data, error: categoriesError }) => {
        if (categoriesError) return
        setCategories((data ?? []) as CategoryRow[])
      })
  }, [branchId, initialCategoryId, initialSearch, open, tenantId])

  const categoryOptions = useMemo(() => categories.filter(category => category.is_active), [categories])

  const prepare = async () => {
    if (!canExport) {
      setError(t('export.errors.permission'))
      setStage('error')
      return
    }
    setStage('preparing')
    setError(null)
    const startedAt = performance.now()
    try {
      const [{ data: rawProducts, error: productsError }, { data: rawCategories, error: categoriesError }] = await Promise.all([
        supabase
          .from('products')
          .select('id,category_id,name,name_ar,sku,barcode,price,stock_quantity,track_stock,unit,unit_ar,vat_treatment,is_active,is_service,categories(name)')
          .eq('tenant_id', tenantId)
          .eq('branch_id', branchId)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true })
          .range(0, CATALOGUE_EXPORT_MAX_ROWS),
        supabase
          .from('categories')
          .select('id,name,is_active')
          .eq('tenant_id', tenantId)
          .eq('branch_id', branchId)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true })
          .range(0, CATALOGUE_EXPORT_MAX_ROWS),
      ])
      if (productsError || categoriesError) throw productsError ?? categoriesError
      const products = (rawProducts ?? []) as unknown as ExportProductRow[]
      const loadedCategories = (rawCategories ?? []) as CategoryRow[]
      if (products.length > CATALOGUE_EXPORT_MAX_ROWS || loadedCategories.length > CATALOGUE_EXPORT_MAX_ROWS) {
        throw new Error('CATALOGUE_EXPORT_LIMIT')
      }
      const items = products
        .filter(product => (itemType === 'all' || (itemType === 'services') === product.is_service)
          && (status === 'all' || (status === 'active') === product.is_active)
          && (!categoryId || product.category_id === categoryId)
          && catalogueTextMatches(search, product))
        .map(product => ({
          name: product.name,
          secondDescription: product.name_ar,
          isService: product.is_service,
          categoryName: product.categories?.name ?? null,
          sellingPrice: Number(product.price ?? 0),
          sku: product.sku,
          barcode: product.barcode,
          trackStock: product.track_stock,
          currentStock: branchStockEnabled && product.track_stock && !product.is_service
            ? Number(product.stock_quantity ?? 0)
            : null,
          unit: product.unit_ar || product.unit,
          vatTreatment: product.vat_treatment,
          isActive: product.is_active,
        }))
      const categoriesForExport = loadedCategories.map(category => ({
        name: category.name,
        isActive: category.is_active,
        productCount: products.filter(product => product.category_id === category.id).length,
      }))
      const nextPayload = { items, categories: categoriesForExport, scope }
      if (!isEligible(scope, nextPayload)) {
        setPayload(null)
        setStage('idle')
        setError(scope === 'categories' ? t('export.errors.noCategories') : t('export.errors.empty'))
        return
      }
      setPayload(nextPayload)
      setStage('ready')
      if (import.meta.env.DEV) {
        console.info('[catalogue export]', {
          branchId,
          scope,
          format,
          itemCount: items.length,
          categoryCount: categoriesForExport.length,
          durationMs: Math.round(performance.now() - startedAt),
        })
      }
    } catch (prepareError) {
      const code = prepareError instanceof Error ? prepareError.message : ''
      setPayload(null)
      setStage('error')
      setError(code === 'CATALOGUE_EXPORT_LIMIT' ? t('export.errors.limit', { count: CATALOGUE_EXPORT_MAX_ROWS }) : t('export.errors.prepare'))
    }
  }

  const download = () => {
    if (!payload) return
    downloadCatalogueExport(payload, branchName, format)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 p-0 backdrop-blur-[1px] sm:items-center sm:justify-center sm:p-5">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="catalogue-export-title" className="max-h-[94vh] w-full overflow-y-auto rounded-t-[28px] bg-[#fffefa] shadow-2xl sm:max-w-2xl sm:rounded-[28px]">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[#e7eee6] bg-[#fffefa]/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#e5efe6] text-[#173f2a] shadow-[inset_0_0_0_1px_rgba(23,63,42,0.06)]" aria-hidden="true"><Download size={18} /></span>
            <div>
              <h2 id="catalogue-export-title" className="text-base font-extrabold tracking-tight text-[#173f2a]">Import / Export catalogue</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-600">Bring in a prepared catalogue or download the current branch data.</p>
            </div>
          </div>
          <button type="button" onClick={close} disabled={stage === 'preparing'} aria-label={t('export.close')} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"><X size={18} /></button>
        </header>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="grid grid-cols-2 rounded-xl bg-[#eaf1e9] p-1" role="tablist" aria-label="Catalogue data operation">
            {(['import', 'export'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`rounded-lg px-3 py-2 text-xs font-extrabold transition ${mode === value ? 'bg-white text-[#173f2a] shadow-sm' : 'text-[#53715d]'}`}>{value === 'import' ? 'Import' : 'Export'}</button>)}
          </div>
          {mode === 'import' ? <CatalogueImportPanel key={branchId} branchId={branchId} branchName={branchName} disabled={!canExport} onImportComplete={onImportComplete} /> : <>
          <section aria-labelledby="catalogue-export-scope">
            <p id="catalogue-export-scope" className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#53715d]">{t('export.what')}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {([
                ['items', t('export.scopes.items')],
                ['categories', t('export.scopes.categories')],
                ['catalogue', t('export.scopes.catalogue')],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => { setScope(value); setPayload(null); setStage('idle'); setError(null) }} aria-pressed={scope === value} className={`rounded-2xl border px-3 py-3 text-start text-xs font-bold transition ${scope === value ? 'border-[#173f2a] bg-[#173f2a] text-[#fff9e8] shadow-sm' : 'border-[#dbe5dc] bg-white text-slate-700 hover:border-[#9eb9a5]'}`}>
                  <span className="flex items-center gap-2"><span className={`flex size-4 items-center justify-center rounded-full border ${scope === value ? 'border-[#d9bc6c] bg-[#d9bc6c] text-[#173f2a]' : 'border-slate-300'}`}>{scope === value && <Check size={10} strokeWidth={3} />}</span>{label}</span>
                </button>
              ))}
            </div>
          </section>

          {scope !== 'categories' && <section aria-labelledby="catalogue-export-filters" className="rounded-2xl border border-[#e3ece3] bg-[#f8fbf7] p-3.5">
            <p id="catalogue-export-filters" className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#53715d]">{t('export.filters.title')}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select value={itemType} onChange={event => { setItemType(event.target.value as CatalogueExportItemType); setPayload(null); setStage('idle') }} className="input h-10 bg-white text-sm" aria-label={t('export.filters.itemType')}>
                <option value="all">{t('export.filters.allItems')}</option><option value="products">{t('export.filters.products')}</option><option value="services">{t('export.filters.services')}</option>
              </select>
              <select value={status} onChange={event => { setStatus(event.target.value as CatalogueExportStatus); setPayload(null); setStage('idle') }} className="input h-10 bg-white text-sm" aria-label={t('export.filters.status')}>
                <option value="active">{t('export.filters.active')}</option><option value="all">{t('export.filters.allStatus')}</option><option value="inactive">{t('export.filters.inactive')}</option>
              </select>
              <select value={categoryId} onChange={event => { setCategoryId(event.target.value); setPayload(null); setStage('idle') }} className="input h-10 bg-white text-sm" aria-label={t('export.filters.category')}>
                <option value="">{t('export.filters.allCategories')}</option>{categoryOptions.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <input value={search} onChange={event => { setSearch(event.target.value); setPayload(null); setStage('idle') }} placeholder={t('export.filters.search')} className="input h-10 bg-white text-sm" />
            </div>
          </section>}

          <section aria-labelledby="catalogue-export-format">
            <p id="catalogue-export-format" className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#53715d]">{t('export.format.title')}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFormat('xlsx')} aria-pressed={format === 'xlsx'} className={`rounded-2xl border p-3 text-start transition ${format === 'xlsx' ? 'border-[#173f2a] bg-[#ecf5ed] text-[#173f2a]' : 'border-[#dbe5dc] bg-white text-slate-700'}`}><span className="flex items-center gap-2 text-xs font-extrabold"><FileSpreadsheet size={16} />{t('export.format.excel')}</span><span className="mt-1 block text-[11px] font-medium text-slate-500">{t('export.format.excelHint')}</span></button>
              <button type="button" onClick={() => setFormat('csv')} aria-pressed={format === 'csv'} className={`rounded-2xl border p-3 text-start transition ${format === 'csv' ? 'border-[#173f2a] bg-[#ecf5ed] text-[#173f2a]' : 'border-[#dbe5dc] bg-white text-slate-700'}`}><span className="flex items-center gap-2 text-xs font-extrabold"><FileText size={16} />{t('export.format.csv')}</span><span className="mt-1 block text-[11px] font-medium text-slate-500">{t('export.format.csvHint')}</span></button>
            </div>
          </section>

          {stage === 'ready' && payload && <section className="overflow-hidden rounded-2xl border border-[#cfe1d1] bg-[#f2f9f2]" aria-live="polite">
            <div className="flex items-center gap-2 border-b border-[#d8ead9] bg-[#e6f2e6] px-3.5 py-2.5 text-sm font-extrabold text-[#173f2a]"><Check size={15} className="text-[#1b6b3a]" />{t('export.ready')}</div>
            <dl className="grid grid-cols-2 gap-px bg-[#d8ead9] text-xs sm:grid-cols-4">
              {[
                [t('export.summary.items'), payload.items.length],
                [t('export.summary.products'), payload.items.filter(item => !item.isService).length],
                [t('export.summary.services'), payload.items.filter(item => item.isService).length],
                [t('export.summary.categories'), payload.categories.length],
              ].map(([label, value]) => <div key={String(label)} className="bg-[#f8fcf8] px-3 py-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-[#53715d]">{label}</dt><dd className="mt-0.5 text-base font-extrabold tabular-nums text-[#173f2a]">{value}</dd></div>)}
            </dl>
          </section>}
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-800">{error}</p>}
          </>}
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-[#e7eee6] bg-[#fffefa]/95 px-5 py-4 backdrop-blur sm:flex-row sm:justify-end sm:px-6">
          <Button variant="secondary" onClick={close} disabled={stage === 'preparing'}>{t('export.cancel')}</Button>
          {mode === 'export' && (stage === 'ready' && payload ? <Button onClick={download}><Download size={15} />{t('export.download')}</Button> : <Button onClick={() => void prepare()} loading={stage === 'preparing'} disabled={!canExport}><PackageOpen size={15} />{stage === 'preparing' ? t('export.preparing') : t('export.prepare')}</Button>)}
        </footer>
      </div>
    </div>
  )
}
