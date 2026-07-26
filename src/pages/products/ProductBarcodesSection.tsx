import { useEffect, useMemo, useRef, useState } from 'react'
import { Barcode, CheckCircle2, Printer, ScanLine, Sparkles, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { sarStr } from '@/components/ui/RiyalSymbol'
import { supabase } from '@/lib/supabase'
import {
  BARCODE_TYPES,
  detectBarcodeType,
  normalizeBarcode,
  validateBarcode,
  type BarcodeType,
} from '@/lib/barcodes/barcode'
import { useAuth } from '@/hooks/useAuth'
import BarcodeQuickPrintDialog from '@/components/barcodes/BarcodeQuickPrintDialog'
import { getProductBarcodePrintStatus } from '@/lib/barcodes/labelApi'
import {
  loadBarcodePrintQueue,
  mergeBarcodePrintQueue,
  queueItemKey,
  saveBarcodePrintQueue,
} from '@/lib/barcodes/labelQueue'

interface BarcodeRow {
  id: string
  product_unit_id: string
  barcode: string
  barcode_type: BarcodeType
  source: 'manufacturer' | 'supplier' | 'internal' | 'imported'
  is_primary: boolean
  is_active: boolean
  label_name: string | null
  notes: string | null
}

interface UnitOption {
  id: string
  name: string
  name_ar: string | null
  is_base: boolean
  is_active: boolean
  resolved_selling_price?: number
}

export function ProductBarcodesSection({
  productId,
  productName,
  productNameAr,
  sku,
  price,
  units,
}: {
  productId: string
  productName: string
  productNameAr: string | null
  sku: string | null
  price: string
  units: UnitOption[]
}) {
  const { t } = useTranslation(['products', 'printing'])
  const { tenant, branch } = useAuth()
  const [rows, setRows] = useState<BarcodeRow[]>([])
  const [unitId, setUnitId] = useState(units.find(unit => unit.is_base)?.id ?? '')
  const [value, setValue] = useState('')
  const [type, setType] = useState<BarcodeType>('unknown')
  const [source, setSource] = useState<BarcodeRow['source']>('manufacturer')
  const [primary, setPrimary] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'error' | 'success'>('error')
  const [printStatus, setPrintStatus] = useState<Map<string, { printCount: number }>>(new Map())
  const [printStatusAvailable, setPrintStatusAvailable] = useState(false)
  const [selectedPrint, setSelectedPrint] = useState<{ row: BarcodeRow; unit: UnitOption } | null>(null)
  const captureRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const { data, error } = await (supabase as any).rpc('list_product_unit_barcodes', {
      p_product_id: productId,
    })
    if (error) {
      setMessageTone('error')
      setMessage(t('barcodes.errors.load'))
      return
    }
    setRows((data ?? []) as BarcodeRow[])
    setPrintStatusAvailable(false)
    void getProductBarcodePrintStatus(productId)
      .then(status => {
        setPrintStatus(status)
        setPrintStatusAvailable(true)
      })
      .catch(() => {
        setPrintStatus(new Map())
        setPrintStatusAvailable(false)
      })
  }

  useEffect(() => { void load() }, [productId])

  const grouped = useMemo(() => new Map(units.map(unit => [
    unit.id,
    rows.filter(row => row.product_unit_id === unit.id),
  ])), [rows, units])

  const add = async () => {
    const normalized = normalizeBarcode(value)
    const validation = validateBarcode(normalized, type)
    if (validation) {
      setMessageTone('error')
      setMessage(t(`barcodes.errors.${validation}`))
      return
    }
    setBusy(true)
    setMessageTone('error')
    setMessage('')
    const { error } = await (supabase as any).rpc('create_product_unit_barcode', {
      p_payload: {
        product_unit_id: unitId,
        barcode: normalized,
        barcode_type: type,
        source,
        is_primary: primary,
      },
    })
    setBusy(false)
    if (error) {
      setMessage(t(error.code === '23505' ? 'barcodes.errors.duplicate' : 'barcodes.errors.save'))
      return
    }
    setValue('')
    await load()
  }

  const generate = async () => {
    setBusy(true)
    setMessageTone('error')
    setMessage('')
    const { error } = await (supabase as any).rpc('generate_internal_product_unit_barcode', {
      p_product_unit_id: unitId,
      p_is_primary: primary,
    })
    setBusy(false)
    if (error) setMessage(t('barcodes.errors.save'))
    else await load()
  }

  const disable = async (id: string) => {
    setBusy(true)
    setMessageTone('error')
    const { error } = await (supabase as any).rpc('disable_product_unit_barcode', { p_barcode_id: id })
    setBusy(false)
    if (error) setMessage(t('barcodes.errors.save'))
    else await load()
  }

  const reactivate = async (id: string) => {
    setBusy(true)
    setMessageTone('error')
    const { error } = await (supabase as any).rpc('reactivate_product_unit_barcode', { p_barcode_id: id })
    setBusy(false)
    if (error) setMessage(t(error.code === '23505' ? 'barcodes.errors.duplicate' : 'barcodes.errors.save'))
    else await load()
  }

  const setAsPrimary = async (id: string) => {
    setBusy(true)
    setMessageTone('error')
    const { error } = await (supabase as any).rpc('set_primary_product_unit_barcode', { p_barcode_id: id })
    setBusy(false)
    if (error) setMessage(t('barcodes.errors.save'))
    else await load()
  }

  const addSelectedToQueue = () => {
    if (!selectedPrint || !branch?.id) return
    const selectedUnit = selectedPrint.unit
    const current = loadBarcodePrintQueue(branch.id)
    const next = mergeBarcodePrintQueue(current, {
      key: queueItemKey(productId, selectedUnit.id, selectedPrint.row.id),
      productId,
      productName,
      productNameAr,
      sku,
      unit: {
        id: selectedUnit.id,
        name: selectedUnit.name,
        nameAr: selectedUnit.name_ar,
        isBase: selectedUnit.is_base,
        price: sarStr(Number(selectedUnit.resolved_selling_price ?? price)),
      },
      barcode: {
        id: selectedPrint.row.id,
        productUnitId: selectedUnit.id,
        value: selectedPrint.row.barcode,
        type: selectedPrint.row.barcode_type,
        isPrimary: selectedPrint.row.is_primary,
        isActive: selectedPrint.row.is_active,
      },
      copies: 1,
    })
    saveBarcodePrintQueue(branch.id, next)
    setMessageTone('success')
    setMessage(t('printing:barcodeLabels.batch.added'))
    setSelectedPrint(null)
  }

  return (
    <section className="space-y-3 rounded-xl border border-sky-100 bg-sky-50/30 p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sky-700 shadow-sm">
          <Barcode size={17} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-gray-900">{t('barcodes.title')}</h3>
          <p className="text-[11px] text-gray-500">{t('barcodes.help')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold text-gray-600">
          {t('barcodes.unit')}
          <select className="input mt-1" value={unitId} onChange={event => setUnitId(event.target.value)}>
            {units.filter(unit => unit.is_active).map(unit => (
              <option key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">
          {t('barcodes.value')}
          <div className="relative mt-1">
            <ScanLine size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={captureRef}
              className="input ps-9 font-mono"
              dir="ltr"
              value={value}
              maxLength={128}
              onChange={event => {
                const next = event.target.value
                setValue(next)
                if (type === 'unknown') setType(detectBarcodeType(next))
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void add()
                }
              }}
              placeholder={t('barcodes.scanOrType')}
            />
          </div>
        </label>
        <label className="text-xs font-semibold text-gray-600">
          {t('barcodes.type')}
          <select className="input mt-1" value={type} onChange={event => setType(event.target.value as BarcodeType)}>
            {BARCODE_TYPES.map(option => <option key={option} value={option}>{t(`barcodes.types.${option}`)}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">
          {t('barcodes.source')}
          <select className="input mt-1" value={source} onChange={event => setSource(event.target.value as BarcodeRow['source'])}>
            {(['manufacturer', 'supplier'] as const).map(option => (
              <option key={option} value={option}>{t(`barcodes.sources.${option}`)}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={primary} onChange={event => setPrimary(event.target.checked)} />
        {t('barcodes.makePrimary')}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void add()} loading={busy} disabled={!unitId || !value.trim()}>
          <CheckCircle2 size={14} />{t('barcodes.add')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => void generate()} disabled={!unitId || busy}>
          <Sparkles size={14} />{t('barcodes.generate')}
        </Button>
      </div>
      {message && <p className={`text-xs ${messageTone === 'success' ? 'text-emerald-700' : 'text-red-700'}`} role={messageTone === 'success' ? 'status' : 'alert'}>{message}</p>}

      {units.map(unit => {
        const unitRows = grouped.get(unit.id) ?? []
        if (!unitRows.length) return null
        return (
          <div key={unit.id} className="space-y-1.5">
            <p className="text-xs font-bold text-gray-700">{unit.name}</p>
            {unitRows.map(row => (
              <div key={row.id} className={`flex min-w-0 items-center gap-2 rounded-lg border bg-white px-2.5 py-2 ${row.is_active ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
                <code className="min-w-0 flex-1 truncate text-xs" dir="ltr">{row.barcode}</code>
                <span className="text-[10px] text-gray-400">{t(`barcodes.types.${row.barcode_type}`)}</span>
                {row.is_primary && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{t('barcodes.primary')}</span>}
                {row.is_active && !row.is_primary && (
                  <button type="button" className="text-[10px] font-semibold text-sky-700" onClick={() => void setAsPrimary(row.id)}>
                    {t('barcodes.setPrimary')}
                  </button>
                )}
                {row.is_active && (
                  <>
                    <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-primary-700 hover:bg-primary-50" onClick={() => setSelectedPrint({ row, unit })}>
                      <Printer size={13} aria-hidden="true" />
                      {t(printStatus.get(row.id)?.printCount ? 'printing:barcodeLabels.audit.reprint' : 'printing:barcodeLabels.audit.printLabel')}
                    </button>
                    <button type="button" aria-label={t('barcodes.disable')} onClick={() => void disable(row.id)}>
                      <XCircle size={14} className="text-red-500" />
                    </button>
                  </>
                )}
                {!row.is_active && (
                  <button type="button" className="text-[10px] font-semibold text-sky-700" onClick={() => void reactivate(row.id)}>
                    {t('barcodes.reactivate')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      })}
      {selectedPrint && branch?.id && <BarcodeQuickPrintDialog
        open
        branchId={branch.id}
        barcodeId={selectedPrint.row.id}
        barcode={selectedPrint.row.barcode}
        barcodeType={selectedPrint.row.barcode_type}
        productId={productId}
        productName={productName}
        productNameAr={productNameAr}
        unitId={selectedPrint.unit.id}
        unitName={selectedPrint.unit.name_ar || selectedPrint.unit.name}
        price={sarStr(Number(selectedPrint.unit.resolved_selling_price ?? price))}
        sku={sku}
        businessName={tenant?.business_name_ar || tenant?.business_name || tenant?.name || null}
        hasPrinted={printStatusAvailable
          ? (printStatus.get(selectedPrint.row.id)?.printCount ?? 0) > 0
          : null}
        onClose={() => setSelectedPrint(null)}
        onPrinted={() => {
          setPrintStatusAvailable(true)
          setPrintStatus(current => new Map(current).set(selectedPrint.row.id, {
            printCount: (current.get(selectedPrint.row.id)?.printCount ?? 0) + 1,
          }))
        }}
        onAddToBatch={addSelectedToQueue}
      />}
    </section>
  )
}
