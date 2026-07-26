import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Barcode, ChevronDown, Layers3, PackagePlus, Printer, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import { supabase } from '@/lib/supabase'
import { getBranchBarcodeLabelSettings, recordBarcodePrintBatch } from '@/lib/barcodes/labelApi'
import {
  barcodePrintDocument,
  browserBarcodePrintAdapter,
  type BarcodeLabel,
} from '@/lib/barcodes/labelPrint'
import {
  barcodeQueueTotal,
  clearBarcodePrintQueue,
  loadBarcodePrintQueue,
  mergeBarcodePrintQueue,
  queueItemKey,
  saveBarcodePrintQueue,
  updateBarcodeQueueCopies,
  type BarcodePrintQueueItem,
  type BarcodeQueueBarcode,
  type BarcodeQueueUnit,
} from '@/lib/barcodes/labelQueue'
import {
  DEFAULT_BARCODE_LABEL_SETTINGS,
  loadBarcodeDeviceCalibration,
  type BarcodeLabelSettings,
} from '@/lib/barcodes/labelSettings'
import type { BarcodeType } from '@/lib/barcodes/barcode'
import BarcodeLabelDesigner from './BarcodeLabelDesigner'

interface BatchProduct {
  id: string
  name: string
  name_ar: string | null
  sku: string | null
  price: number
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

interface ProductOptions {
  units: BarcodeQueueUnit[]
  barcodes: BarcodeQueueBarcode[]
}

interface Props {
  open: boolean
  branchId: string
  businessName: string | null
  products: BatchProduct[]
  onClose: () => void
}

const money = (value: number) => `SAR ${Number(value).toFixed(2)}`

export default function BarcodeBatchPrintDrawer({
  open,
  branchId,
  businessName,
  products,
  onClose,
}: Props) {
  const { t } = useTranslation('printing')
  const [items, setItems] = useState<BarcodePrintQueueItem[]>([])
  const [options, setOptions] = useState<Record<string, ProductOptions>>({})
  const [settings, setSettings] = useState<BarcodeLabelSettings>(DEFAULT_BARCODE_LABEL_SETTINGS)
  const [search, setSearch] = useState('')
  const [showProducts, setShowProducts] = useState(true)
  const [showDesigner, setShowDesigner] = useState(false)
  const [loadingProduct, setLoadingProduct] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const calibration = useMemo(() => loadBarcodeDeviceCalibration(), [open])
  const total = barcodeQueueTotal(items)
  const close = useCallback(() => {
    if (!printing) onClose()
  }, [printing, onClose])
  const dialogRef = useDialogFocus(open, close)

  useEffect(() => {
    if (!open) return
    setItems(loadBarcodePrintQueue(branchId))
    setError('')
    void getBranchBarcodeLabelSettings(branchId)
      .then(result => setSettings(result.settings))
      .catch(() => {
        setSettings(DEFAULT_BARCODE_LABEL_SETTINGS)
        setError(t('barcodeLabels.errors.branchDefaultsUnavailable'))
      })
  }, [open, branchId, t])

  useEffect(() => {
    if (!open) return
    saveBarcodePrintQueue(branchId, items)
  }, [open, branchId, items])

  const loadOptions = async (product: BatchProduct): Promise<ProductOptions | null> => {
    if (options[product.id]) return options[product.id]
    setLoadingProduct(product.id)
    try {
      const [{ data: unitData, error: unitError }, { data: barcodeData, error: barcodeError }] = await Promise.all([
        (supabase as any).rpc('get_product_units', { p_product_id: product.id }),
        (supabase as any).rpc('list_product_unit_barcodes', { p_product_id: product.id }),
      ])
      if (unitError || barcodeError) throw unitError ?? barcodeError
      const next: ProductOptions = {
        units: ((unitData ?? []) as RawUnit[]).filter(unit => unit.is_active).map(unit => ({
          id: unit.id,
          name: unit.name,
          nameAr: unit.name_ar,
          isBase: unit.is_base,
          price: money(unit.resolved_selling_price ?? product.price),
        })),
        barcodes: ((barcodeData ?? []) as RawBarcode[]).map(row => ({
          id: row.id,
          productUnitId: row.product_unit_id,
          value: row.barcode,
          type: row.barcode_type,
          isPrimary: row.is_primary,
          isActive: row.is_active,
        })),
      }
      setOptions(current => ({ ...current, [product.id]: next }))
      setItems(current => current.map(item => {
        if (item.productId !== product.id) return item
        const liveUnit = next.units.find(unit => unit.id === item.unit.id) ?? item.unit
        const liveBarcode = item.barcode
          ? next.barcodes.find(barcode =>
            barcode.id === item.barcode?.id
            && barcode.productUnitId === liveUnit.id
            && barcode.isActive,
          ) ?? null
          : null
        return {
          ...item,
          key: queueItemKey(item.productId, liveUnit.id, liveBarcode?.id ?? null),
          unit: liveUnit,
          barcode: liveBarcode,
        }
      }))
      return next
    } catch {
      setError(t('barcodeLabels.batch.loadProductFailed'))
      return null
    } finally {
      setLoadingProduct(null)
    }
  }

  useEffect(() => {
    if (!open) return
    const queuedProductIds = new Set(loadBarcodePrintQueue(branchId).map(item => item.productId))
    const queuedProducts = products.filter(product => queuedProductIds.has(product.id))
    void (async () => {
      for (const product of queuedProducts) await loadOptions(product)
    })()
  }, [open, branchId])

  const addProduct = async (product: BatchProduct) => {
    setError('')
    const productOptions = await loadOptions(product)
    if (!productOptions?.units.length) {
      setError(t('barcodeLabels.batch.noUnits'))
      return
    }
    const unit = productOptions.units.find(option => option.isBase) ?? productOptions.units[0]
    const activeBarcodes = productOptions.barcodes.filter(row => row.productUnitId === unit.id && row.isActive)
    const barcode = activeBarcodes.find(row => row.isPrimary) ?? activeBarcodes[0] ?? null
    setItems(current => mergeBarcodePrintQueue(current, {
      key: queueItemKey(product.id, unit.id, barcode?.id ?? null),
      productId: product.id,
      productName: product.name,
      productNameAr: product.name_ar,
      sku: product.sku,
      unit,
      barcode,
      copies: settings.defaultCopies,
    }))
  }

  const ensureOptions = async (item: BarcodePrintQueueItem) => {
    const product = products.find(row => row.id === item.productId)
    if (product) await loadOptions(product)
  }

  const replaceItem = (
    oldKey: string,
    item: BarcodePrintQueueItem,
  ) => setItems(current => mergeBarcodePrintQueue(
    current.filter(row => row.key !== oldKey),
    item,
  ))

  const changeUnit = (item: BarcodePrintQueueItem, unitId: string) => {
    const productOptions = options[item.productId]
    const unit = productOptions?.units.find(row => row.id === unitId)
    if (!unit) return
    const rows = productOptions.barcodes.filter(row => row.productUnitId === unit.id && row.isActive)
    const barcode = rows.find(row => row.isPrimary) ?? rows[0] ?? null
    replaceItem(item.key, {
      ...item,
      key: queueItemKey(item.productId, unit.id, barcode?.id ?? null),
      unit,
      barcode,
    })
  }

  const changeBarcode = (item: BarcodePrintQueueItem, barcodeId: string) => {
    const barcode = options[item.productId]?.barcodes.find(row => row.id === barcodeId && row.isActive) ?? null
    replaceItem(item.key, {
      ...item,
      key: queueItemKey(item.productId, item.unit.id, barcode?.id ?? null),
      barcode,
    })
  }

  const labels = useMemo<BarcodeLabel[]>(() => items.filter(item => item.barcode?.isActive).map(item => ({
    barcodeId: item.barcode?.id,
    productId: item.productId,
    productUnitId: item.unit.id,
    barcode: item.barcode?.value ?? '',
    barcodeType: item.barcode?.type ?? 'unknown',
    businessName,
    productName: item.productName,
    productNameEn: item.productName,
    productNameAr: item.productNameAr,
    unitName: item.unit.nameAr || item.unit.name,
    price: item.unit.price,
    sku: item.sku,
    copies: item.copies,
  })), [items, businessName])

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return products.slice(0, 30)
    return products.filter(product =>
      product.name.toLocaleLowerCase().includes(query)
      || (product.name_ar ?? '').includes(search.trim())
      || (product.sku ?? '').toLocaleLowerCase().includes(query),
    ).slice(0, 30)
  }, [products, search])

  const preview = () => {
    setError('')
    if (!items.length || items.some(item => !item.barcode?.isActive)) {
      setError(t('barcodeLabels.batch.resolveMissing'))
      return
    }
    try {
      const document = barcodePrintDocument(labels, settings, calibration, {
        preview: true,
        copy: {
          title: t('barcodeLabels.batch.previewTitle'),
          print: t('barcodeLabels.actions.print'),
          saveAsPdf: t('barcodeLabels.preview.saveAsPdf'),
          dialogGuidance: t('barcodeLabels.preview.dialogGuidance'),
        },
      })
      if (!browserBarcodePrintAdapter.preview(document.html)) {
        setError(t('barcodeLabels.errors.previewBlocked'))
      }
    } catch {
      setError(t('barcodeLabels.errors.invalidBarcodeForPrint'))
    }
  }

  const print = async () => {
    if (!items.length || items.some(item => !item.barcode?.isActive)) {
      setError(t('barcodeLabels.batch.resolveMissing'))
      return
    }
    if (total > 500) {
      setError(t('barcodeLabels.batch.maximum'))
      return
    }
    if (total > 50 && reason.trim().length < 3) {
      setError(t('barcodeLabels.errors.reasonRequired'))
      return
    }
    setPrinting(true)
    setError('')
    try {
      const document = barcodePrintDocument(labels, settings, calibration, {
        copy: {
          title: t('barcodeLabels.batch.previewTitle'),
          print: t('barcodeLabels.actions.print'),
          saveAsPdf: t('barcodeLabels.preview.saveAsPdf'),
          dialogGuidance: t('barcodeLabels.preview.dialogGuidance'),
        },
      })
      if (!document.layout.fits) throw new Error('layout')
      await recordBarcodePrintBatch(
        items.map(item => ({ barcodeId: item.barcode!.id, copies: item.copies })),
        `${settings.presetId}:${settings.templateId}`.slice(0, 40),
        total > 50 ? reason : null,
      )
      browserBarcodePrintAdapter.print(document.html)
      clearBarcodePrintQueue(branchId)
      setItems([])
      setReason('')
      onClose()
    } catch {
      setError(t('barcodeLabels.errors.printFailed'))
    } finally {
      setPrinting(false)
    }
  }

  if (!open) return null
  return <div className="fixed inset-0 z-[65] flex justify-end bg-black/45" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-batch-title"
      className="flex h-full w-full max-w-6xl flex-col bg-white shadow-2xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#10261a] text-white"><Layers3 size={18} aria-hidden="true" /></span>
          <div>
            <h2 id="barcode-batch-title" className="text-base font-bold text-gray-950">{t('barcodeLabels.batch.title')}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t('barcodeLabels.batch.help')}</p>
          </div>
        </div>
        <button type="button" aria-label={t('barcodeLabels.actions.close')} onClick={close} className="grid h-9 w-9 place-items-center rounded-xl text-gray-400 hover:bg-gray-100"><X size={18} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {error && <p className="mb-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700" role="alert"><AlertTriangle size={14} className="shrink-0" aria-hidden="true" /> {error}</p>}
        <div className="grid items-start gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <button type="button" onClick={() => setShowProducts(value => !value)} aria-expanded={showProducts} className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-gray-900">
              <span className="inline-flex items-center gap-2"><PackagePlus size={15} aria-hidden="true" /> {t('barcodeLabels.batch.addProducts')}</span>
              <ChevronDown size={14} className={showProducts ? 'rotate-180' : ''} aria-hidden="true" />
            </button>
            {showProducts && <div className="rounded-2xl border border-gray-200 bg-white p-3">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input data-autofocus className="input h-10 ps-9 text-xs" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('barcodeLabels.batch.search')} />
              </div>
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {filteredProducts.map(product => <button
                  key={product.id}
                  type="button"
                  disabled={loadingProduct === product.id}
                  onClick={() => void addProduct(product)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="min-w-0"><span className="block truncate text-xs font-semibold text-gray-800" dir="auto">{product.name_ar || product.name}</span><span className="block truncate text-[10px] text-gray-400">{product.sku || money(product.price)}</span></span>
                  <PackagePlus size={14} className="shrink-0 text-emerald-700" aria-hidden="true" />
                </button>)}
              </div>
            </div>}
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('barcodeLabels.batch.total')}</p>
              <p className="mt-1 text-3xl font-black tabular-nums text-[#10261a]">{total}</p>
              <p className="text-xs text-gray-500">{t('barcodeLabels.batch.labels')}</p>
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            {!items.length ? <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
              <div><Barcode size={28} className="mx-auto text-gray-300" aria-hidden="true" /><p className="mt-3 text-sm font-bold text-gray-800">{t('barcodeLabels.batch.empty')}</p><p className="mt-1 max-w-sm text-xs leading-5 text-gray-500">{t('barcodeLabels.batch.emptyHelp')}</p></div>
            </div> : <>
              <div className="space-y-2">
                {items.map((item, index) => {
                  const productOptions = options[item.productId]
                  const unitBarcodes = productOptions?.barcodes.filter(row => row.productUnitId === item.unit.id && row.isActive) ?? []
                  return <article key={item.key} className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_150px_170px_90px_auto] sm:items-end">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-gray-400">{index + 1}</p>
                      <p className="truncate text-xs font-bold text-gray-900" dir="auto">{item.productNameAr || item.productName}</p>
                      {!item.barcode && <p className="mt-1 text-[10px] text-red-600">{t('barcodeLabels.batch.missingBarcode')}</p>}
                    </div>
                    <label className="space-y-1 text-[10px] font-semibold text-gray-500">
                      <span>{t('barcodeLabels.batch.unit')}</span>
                      <select
                        className="input h-9 px-2 text-xs"
                        value={item.unit.id}
                        onFocus={() => void ensureOptions(item)}
                        onChange={event => changeUnit(item, event.target.value)}
                      >
                        {(productOptions?.units ?? [item.unit]).map(unit => <option key={unit.id} value={unit.id}>{unit.nameAr || unit.name}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-[10px] font-semibold text-gray-500">
                      <span>{t('barcodeLabels.batch.barcode')}</span>
                      <select
                        className="input h-9 px-2 font-mono text-xs"
                        dir="ltr"
                        value={item.barcode?.id ?? ''}
                        onFocus={() => void ensureOptions(item)}
                        onChange={event => changeBarcode(item, event.target.value)}
                      >
                        <option value="">{t('barcodeLabels.batch.noBarcode')}</option>
                        {unitBarcodes.map(row => <option key={row.id} value={row.id}>{row.value}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-[10px] font-semibold text-gray-500">
                      <span>{t('barcodeLabels.copies')}</span>
                      <input type="number" min={1} max={500} step={1} value={item.copies} onChange={event => setItems(current => updateBarcodeQueueCopies(current, item.key, Number(event.target.value)))} className="input h-9 px-2 text-xs tabular-nums" />
                    </label>
                    <button type="button" aria-label={t('barcodeLabels.batch.remove')} onClick={() => setItems(current => current.filter(row => row.key !== item.key))} className="grid h-9 w-9 place-items-center rounded-xl text-red-500 hover:bg-red-50"><Trash2 size={14} aria-hidden="true" /></button>
                  </article>
                })}
              </div>

              <button type="button" onClick={() => setShowDesigner(value => !value)} aria-expanded={showDesigner} className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-bold text-gray-800">
                {t('barcodeLabels.batch.designAndPreview')}
                <ChevronDown size={14} className={showDesigner ? 'rotate-180' : ''} aria-hidden="true" />
              </button>
              {showDesigner && <BarcodeLabelDesigner labels={labels} settings={settings} calibration={calibration} onChange={setSettings} previewDataLabel={t('barcodeLabels.preview.actualData')} compact />}

              {total > 50 && <label className="block space-y-1.5 text-xs font-semibold text-gray-700">
                <span>{t('barcodeLabels.audit.reason')}</span>
                <input className="input" value={reason} maxLength={200} onChange={event => setReason(event.target.value)} placeholder={t('barcodeLabels.audit.reasonPlaceholder')} />
              </label>}
            </>}
          </main>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
        <Button type="button" variant="ghost" onClick={() => setConfirmClear(true)} disabled={!items.length || printing}>{t('barcodeLabels.batch.clear')}</Button>
        <span className="min-w-0 flex-1 text-[10px] text-gray-500">{t('barcodeLabels.preview.dialogGuidance')}</span>
        <Button type="button" variant="secondary" onClick={preview} disabled={!items.length || printing}>{t('barcodeLabels.actions.preview')}</Button>
        <Button type="button" onClick={() => void print()} loading={printing} disabled={!items.length || total > 500}>
          <Printer size={14} aria-hidden="true" /> {t('barcodeLabels.batch.printCount', { count: total })}
        </Button>
      </footer>
    </div>
    <ConfirmDialog
      open={confirmClear}
      kind="delete"
      name={t('barcodeLabels.batch.queueName')}
      onConfirm={() => {
        clearBarcodePrintQueue(branchId)
        setItems([])
        setConfirmClear(false)
      }}
      onClose={() => setConfirmClear(false)}
    />
  </div>
}
