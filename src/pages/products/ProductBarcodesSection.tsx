import { useEffect, useMemo, useRef, useState } from 'react'
import { Barcode, CheckCircle2, Printer, ScanLine, Sparkles, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import {
  BARCODE_TYPES,
  detectBarcodeType,
  normalizeBarcode,
  validateBarcode,
  type BarcodeType,
} from '@/lib/barcodes/barcode'
import {
  barcodeLabelDocument,
  browserBarcodePrintAdapter,
  DEFAULT_LABEL_SETTINGS,
  type LabelPrintSettings,
} from '@/lib/barcodes/labelPrint'
import { useAuth } from '@/hooks/useAuth'

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
}

const LABEL_SETTINGS_KEY = 'dafra_barcode_label_settings_v1'

function savedLabelSettings(): LabelPrintSettings {
  try {
    const value = JSON.parse(localStorage.getItem(LABEL_SETTINGS_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return DEFAULT_LABEL_SETTINGS
    return {
      widthMm: Number(value.widthMm) || DEFAULT_LABEL_SETTINGS.widthMm,
      heightMm: Number(value.heightMm) || DEFAULT_LABEL_SETTINGS.heightMm,
      marginMm: Number(value.marginMm) || 0,
      columns: Number(value.columns) || 1,
      copies: Number(value.copies) || 1,
      template: String(value.template || DEFAULT_LABEL_SETTINGS.template),
    }
  } catch {
    return DEFAULT_LABEL_SETTINGS
  }
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
  const { t } = useTranslation('products')
  const { tenant } = useAuth()
  const [rows, setRows] = useState<BarcodeRow[]>([])
  const [unitId, setUnitId] = useState(units.find(unit => unit.is_base)?.id ?? '')
  const [value, setValue] = useState('')
  const [type, setType] = useState<BarcodeType>('unknown')
  const [source, setSource] = useState<BarcodeRow['source']>('manufacturer')
  const [primary, setPrimary] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [settings, setSettings] = useState(savedLabelSettings)
  const [content, setContent] = useState({
    business: true,
    arabicName: true,
    price: true,
    sku: true,
    printDate: false,
  })
  const [printReason, setPrintReason] = useState('')
  const captureRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const { data, error } = await (supabase as any).rpc('list_product_unit_barcodes', {
      p_product_id: productId,
    })
    if (error) {
      setMessage(t('barcodes.errors.load'))
      return
    }
    setRows((data ?? []) as BarcodeRow[])
  }

  useEffect(() => { void load() }, [productId])
  useEffect(() => {
    localStorage.setItem(LABEL_SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const grouped = useMemo(() => new Map(units.map(unit => [
    unit.id,
    rows.filter(row => row.product_unit_id === unit.id),
  ])), [rows, units])

  const add = async () => {
    const normalized = normalizeBarcode(value)
    const validation = validateBarcode(normalized, type)
    if (validation) {
      setMessage(t(`barcodes.errors.${validation}`))
      return
    }
    setBusy(true)
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
    const { error } = await (supabase as any).rpc('disable_product_unit_barcode', { p_barcode_id: id })
    setBusy(false)
    if (error) setMessage(t('barcodes.errors.save'))
    else await load()
  }

  const reactivate = async (id: string) => {
    setBusy(true)
    const { error } = await (supabase as any).rpc('reactivate_product_unit_barcode', { p_barcode_id: id })
    setBusy(false)
    if (error) setMessage(t(error.code === '23505' ? 'barcodes.errors.duplicate' : 'barcodes.errors.save'))
    else await load()
  }

  const setAsPrimary = async (id: string) => {
    setBusy(true)
    const { error } = await (supabase as any).rpc('set_primary_product_unit_barcode', { p_barcode_id: id })
    setBusy(false)
    if (error) setMessage(t('barcodes.errors.save'))
    else await load()
  }

  const print = async (row: BarcodeRow, selectedUnit: UnitOption) => {
    try {
      const documentHtml = barcodeLabelDocument({
        barcode: row.barcode,
        barcodeType: row.barcode_type,
        businessName: content.business
          ? tenant?.business_name_ar || tenant?.business_name || tenant?.name || null
          : null,
        productName,
        productNameAr: content.arabicName ? productNameAr : null,
        unitName: selectedUnit.name,
        price: content.price ? price : undefined,
        sku: content.sku ? sku : null,
        showPrintDate: content.printDate,
      }, settings)
      const { error } = await (supabase as any).rpc('record_product_barcode_print', {
        p_payload: {
          barcode_id: row.id,
          copies: settings.copies,
          label_template: settings.template,
          print_kind: 'reprint',
          reason: settings.copies > 50 ? printReason.trim() : null,
        },
      })
      if (error) throw error
      browserBarcodePrintAdapter.preview(documentHtml)
    } catch {
      setMessage(t('barcodes.errors.print'))
    }
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
      {message && <p className="text-xs text-red-700" role="alert">{message}</p>}

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-100 bg-white p-2 sm:grid-cols-5">
        {([
          ['widthMm', 25, 210], ['heightMm', 15, 297], ['marginMm', 0, 10],
          ['columns', 1, 5], ['copies', 1, 500],
        ] as const).map(([key, min, max]) => (
          <label key={key} className="text-[10px] font-semibold text-gray-500">
            {t(`barcodes.print.${key}`)}
            <input
              className="input mt-1 h-8 px-2 text-xs tabular-nums"
              type="number"
              min={min}
              max={max}
              value={settings[key]}
              onChange={event => setSettings(current => ({ ...current, [key]: Number(event.target.value) }))}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-gray-600">
        {(Object.keys(content) as (keyof typeof content)[]).map(key => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={content[key]}
              onChange={event => setContent(current => ({ ...current, [key]: event.target.checked }))}
            />
            {t(`barcodes.print.${key}`)}
          </label>
        ))}
      </div>
      {settings.copies > 50 && (
        <label className="block text-xs font-semibold text-gray-600">
          {t('barcodes.print.reason')}
          <input
            className="input mt-1"
            value={printReason}
            maxLength={200}
            onChange={event => setPrintReason(event.target.value)}
            placeholder={t('barcodes.print.reasonPlaceholder')}
          />
        </label>
      )}

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
                    <button type="button" aria-label={t('barcodes.print.action')} onClick={() => void print(row, unit)}>
                      <Printer size={14} className="text-gray-500" />
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
    </section>
  )
}
