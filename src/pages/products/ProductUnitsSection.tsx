import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Box, LockKeyhole, PackagePlus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { RiyalSymbol } from '@/components/ui/RiyalSymbol'
import { Switch } from '@/components/ui/Switch'
import { supabase } from '@/lib/supabase'

export interface ProductUnitRow {
  id: string
  product_id: string
  name: string
  name_ar: string | null
  unit_code: string
  conversion_to_base: number
  quantity_scale: number
  pricing_method: 'calculated' | 'custom'
  custom_selling_price: number | null
  resolved_selling_price: number
  selling_enabled: boolean
  receiving_enabled: boolean
  is_base: boolean
  is_active: boolean
  sort_order: number
  version: number
  first_used_at: string | null
}

type PackageDraft = {
  name: string
  nameAr: string
  conversion: string
  pricingMethod: 'calculated' | 'custom'
  customPrice: string
  sellingEnabled: boolean
  receivingEnabled: boolean
}

const EMPTY_DRAFT: PackageDraft = {
  name: '',
  nameAr: '',
  conversion: '',
  pricingMethod: 'calculated',
  customPrice: '',
  sellingEnabled: true,
  receivingEnabled: true,
}

// Phase 1 requires a standards-ready unit code but deliberately does not expose
// technical UBL terminology to merchants. XPK is the generic package code.
export const DEFAULT_PACKAGE_UNIT_CODE = 'XPK'

export function decimalPackagePrice(basePrice: string, conversion: string): string | null {
  const decimalPattern = /^\d+(?:\.\d+)?$/
  if (!decimalPattern.test(basePrice) || !decimalPattern.test(conversion)) return null

  const [baseWhole, baseFraction = ''] = basePrice.split('.')
  const [conversionWhole, conversionFraction = ''] = conversion.split('.')
  const baseMinor = BigInt(`${baseWhole}${baseFraction}`)
  const conversionMinor = BigInt(`${conversionWhole}${conversionFraction}`)
  const scale = baseFraction.length + conversionFraction.length
  const scaledProduct = baseMinor * conversionMinor
  const cents = (scaledProduct * 100n + (scale > 0 ? 5n * (10n ** BigInt(scale - 1)) : 0n))
    / (10n ** BigInt(scale))
  const whole = cents / 100n
  const fraction = String(cents % 100n).padStart(2, '0')
  return `${whole}.${fraction}`
}

export function formatPackagePrice(value: string): string {
  const [whole, fraction = '00'] = value.split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`
}

function packageDraftFromUnit(unit: ProductUnitRow): PackageDraft {
  return {
    name: unit.name,
    nameAr: unit.name_ar ?? '',
    conversion: String(unit.conversion_to_base),
    pricingMethod: unit.pricing_method,
    customPrice: unit.custom_selling_price === null ? '' : String(unit.custom_selling_price),
    sellingEnabled: unit.selling_enabled,
    receivingEnabled: unit.receiving_enabled,
  }
}

function validateDraft(draft: PackageDraft): 'name' | 'nameLength' | 'nameArLength' | 'conversion' | 'customPrice' | null {
  if (!draft.name.trim()) return 'name'
  if (draft.name.trim().length > 80) return 'nameLength'
  if (draft.nameAr.trim().length > 80) return 'nameArLength'
  if (!/^\d+(?:\.\d{1,6})?$/.test(draft.conversion) || Number(draft.conversion) <= 0) return 'conversion'
  if (
    draft.pricingMethod === 'custom'
    && (!/^\d+(?:\.\d{1,2})?$/.test(draft.customPrice) || Number(draft.customPrice) < 0)
  ) return 'customPrice'
  return null
}

function rpcErrorKey(error: { code?: string; message?: string } | null) {
  if (error?.code === '40001' || error?.message?.includes('changed by another request')) return 'stale'
  if (error?.code === '23505' || error?.message?.includes('already exists')) return 'duplicate'
  if (error?.message?.includes('Product not found or inactive')) return 'inactiveProduct'
  if (error?.code === '42501') return 'accessDenied'
  return 'saveFailed'
}

function PackageEditor({
  unit,
  baseUnit,
  baseUnitName,
  basePrice,
  duplicateNames,
  onSaved,
  onStale,
  onDirtyChange,
  onCancel,
}: {
  unit?: ProductUnitRow
  baseUnit: ProductUnitRow
  baseUnitName: string
  basePrice: string
  duplicateNames: string[]
  onSaved: () => Promise<void>
  onStale: () => Promise<void>
  onDirtyChange: (dirty: boolean) => void
  onCancel?: () => void
}) {
  const { t } = useTranslation('products')
  const initial = useMemo(() => unit ? packageDraftFromUnit(unit) : EMPTY_DRAFT, [unit])
  const [draft, setDraft] = useState<PackageDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const conversionLocked = Boolean(unit?.first_used_at)
  const calculatedPrice = decimalPackagePrice(basePrice, draft.conversion)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => setDraft(initial), [initial])

  const setField = <K extends keyof PackageDraft>(field: K, value: PackageDraft[K]) => {
    setDraft(current => ({ ...current, [field]: value }))
    setMessage(null)
  }

  const save = async () => {
    const validationError = validateDraft(draft)
    if (validationError) {
      setMessage({ kind: 'error', text: t(`units.errors.${validationError}`) })
      return
    }
    const normalizedName = draft.name.trim().toLocaleLowerCase()
    if (duplicateNames.some(name => name === normalizedName)) {
      setMessage({ kind: 'error', text: t('units.errors.duplicate') })
      return
    }

    setSaving(true)
    setMessage(null)
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      name_ar: draft.nameAr.trim() || null,
      unit_code: unit?.unit_code ?? DEFAULT_PACKAGE_UNIT_CODE,
      conversion_to_base: Number(draft.conversion),
      quantity_scale: unit?.quantity_scale ?? 3,
      pricing_method: draft.pricingMethod,
      custom_selling_price: draft.pricingMethod === 'custom' ? Number(draft.customPrice) : null,
      selling_enabled: draft.sellingEnabled,
      receiving_enabled: draft.receivingEnabled,
      sort_order: unit?.sort_order ?? 0,
    }
    if (unit) {
      payload.product_unit_id = unit.id
      payload.expected_version = unit.version
    } else {
      payload.product_id = baseUnit.product_id
    }

    const rpcName = unit ? 'update_product_unit' : 'create_product_unit'
    const { error } = await (supabase as any).rpc(rpcName, { p_payload: payload })
    if (error) {
      const errorKey = rpcErrorKey(error)
      setSaving(false)
      if (errorKey === 'stale') {
        await onStale()
        return
      }
      setMessage({ kind: 'error', text: t(`units.errors.${errorKey}`) })
      return
    }

    setSaving(false)
    await onSaved()
  }

  const changeActivity = async () => {
    if (!unit) return
    setSaving(true)
    setMessage(null)
    const rpcName = unit.is_active ? 'deactivate_product_unit' : 'reactivate_product_unit'
    const { error } = await (supabase as any).rpc(rpcName, {
      p_product_unit_id: unit.id,
      p_expected_version: unit.version,
    })
    if (error) {
      const errorKey = rpcErrorKey(error)
      setSaving(false)
      if (errorKey === 'stale') {
        await onStale()
        return
      }
      setMessage({ kind: 'error', text: t(`units.errors.${errorKey}`) })
      return
    }
    setSaving(false)
    await onSaved()
  }

  return (
    <div className={`rounded-xl border p-3.5 ${unit?.is_active === false ? 'border-gray-200 bg-gray-50/70' : 'border-primary-100 bg-white'}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <Box size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-800">
              {unit?.name || t('units.newPackage')}
            </p>
            {unit && (
              <p className={`text-[10px] font-semibold ${unit.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                {t(unit.is_active ? 'units.active' : 'units.inactive')}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="label" htmlFor={`package-name-${unit?.id ?? 'new'}`}>{t('units.packageName')}</label>
          <input
            id={`package-name-${unit?.id ?? 'new'}`}
            className="input"
            maxLength={80}
            value={draft.name}
            onChange={event => setField('name', event.target.value)}
          />
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor={`package-name-ar-${unit?.id ?? 'new'}`}>{t('units.packageNameAr')}</label>
          <input
            id={`package-name-ar-${unit?.id ?? 'new'}`}
            className="input text-right"
            dir="rtl"
            maxLength={80}
            value={draft.nameAr}
            onChange={event => setField('nameAr', event.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 min-w-0">
        <label className="label" htmlFor={`package-contains-${unit?.id ?? 'new'}`}>
          {t('units.contains', { baseUnit: baseUnitName })}
        </label>
        <input
          id={`package-contains-${unit?.id ?? 'new'}`}
          className="input tabular-nums"
          dir="ltr"
          inputMode="decimal"
          disabled={conversionLocked}
          value={draft.conversion}
          onChange={event => setField('conversion', event.target.value)}
          placeholder="24"
        />
        {conversionLocked && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-5 text-amber-700">
            <LockKeyhole size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('units.conversionLocked')}
          </p>
        )}
      </div>

      <fieldset className="mt-3">
        <legend className="label">{t('units.pricing')}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(['calculated', 'custom'] as const).map(method => (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={draft.pricingMethod === method}
              onClick={() => setField('pricingMethod', method)}
              className={`min-w-0 rounded-xl border px-3 py-2.5 text-start ${
                draft.pricingMethod === method
                  ? 'border-primary-400 bg-primary-50 text-primary-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="block text-xs font-semibold">
                {t(method === 'calculated' ? 'units.normalPrice' : 'units.customPriceOption', { baseUnit: baseUnitName })}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-gray-500">
                {t(method === 'calculated' ? 'units.normalPriceHint' : 'units.customPriceHint')}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {draft.pricingMethod === 'custom' ? (
        <div className="mt-3">
          <label className="label" htmlFor={`package-price-${unit?.id ?? 'new'}`}>{t('units.customPackagePrice')}</label>
          <div className="relative">
            <span className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400">
              <RiyalSymbol />
            </span>
            <MoneyInput
              id={`package-price-${unit?.id ?? 'new'}`}
              className="input ps-10 tabular-nums"
              value={draft.customPrice}
              onValueChange={value => setField('customPrice', value)}
              placeholder="0.00"
            />
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-gray-500">{t('units.calculatedPrice')}</span>
            <span className="inline-flex items-baseline gap-1 font-bold tabular-nums text-gray-900" dir="ltr">
              <RiyalSymbol />
              {calculatedPrice ? formatPackagePrice(calculatedPrice) : '—'}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-gray-400">{t('units.previewHint')}</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5">
          <label className="text-xs font-medium text-gray-700" htmlFor={`package-selling-${unit?.id ?? 'new'}`}>{t('units.allowSelling')}</label>
          <Switch
            id={`package-selling-${unit?.id ?? 'new'}`}
            size="sm"
            checked={draft.sellingEnabled}
            onChange={value => setField('sellingEnabled', value)}
            ariaLabel={t('units.allowSelling')}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5">
          <label className="text-xs font-medium text-gray-700" htmlFor={`package-receiving-${unit?.id ?? 'new'}`}>{t('units.allowReceiving')}</label>
          <Switch
            id={`package-receiving-${unit?.id ?? 'new'}`}
            size="sm"
            checked={draft.receivingEnabled}
            onChange={value => setField('receivingEnabled', value)}
            ariaLabel={t('units.allowReceiving')}
          />
        </div>
      </div>

      {message && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs leading-5 ${message.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {!unit && onCancel && (
          <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={onCancel}>
            {t('units.cancel')}
          </Button>
        )}
        {unit && (
          <Button
            type="button"
            size="sm"
            variant={unit.is_active ? 'danger' : 'secondary'}
            disabled={saving}
            onClick={changeActivity}
          >
            {unit.is_active ? <Archive size={13} aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
            {t(unit.is_active ? 'units.deactivate' : 'units.reactivate')}
          </Button>
        )}
        <Button type="button" size="sm" loading={saving} disabled={!dirty && Boolean(unit)} onClick={save}>
          {t('units.save')}
        </Button>
      </div>
    </div>
  )
}

export function ProductUnitsSection({
  productId,
  basePrice,
  serviceRestricted,
  stockEnabled,
  onDirtyChange,
}: {
  productId: string | null
  basePrice: string
  serviceRestricted: boolean
  stockEnabled: boolean
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t, i18n } = useTranslation('products')
  const [units, setUnits] = useState<ProductUnitRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadErrorKey, setLoadErrorKey] = useState<'loadFailed' | 'inactiveProduct' | 'accessDenied' | null>(null)
  const [adding, setAdding] = useState(false)
  const [editorDirty, setEditorDirty] = useState<Record<string, boolean>>({})
  const [successMessage, setSuccessMessage] = useState('')
  const [staleMessage, setStaleMessage] = useState('')
  const loadRequestId = useRef(0)

  const loadUnits = async () => {
    if (!productId) return
    const requestId = ++loadRequestId.current
    setLoading(true)
    setLoadErrorKey(null)
    const { data, error } = await (supabase as any).rpc('get_product_units', {
      p_product_id: productId,
    })
    if (requestId !== loadRequestId.current) return
    if (error) {
      setLoadErrorKey(
        error.message?.includes('Product not found or inactive')
          ? 'inactiveProduct'
          : error.code === '42501'
            ? 'accessDenied'
            : 'loadFailed',
      )
      setLoading(false)
      return
    }
    setUnits((data ?? []) as ProductUnitRow[])
    setLoading(false)
  }

  useEffect(() => {
    loadRequestId.current += 1
    setUnits([])
    setLoading(false)
    setLoadErrorKey(null)
    setAdding(false)
    setEditorDirty({})
    setSuccessMessage('')
    setStaleMessage('')
    if (productId) void loadUnits()
    return () => {
      loadRequestId.current += 1
    }
  }, [productId])

  useEffect(() => {
    onDirtyChange(adding || Object.values(editorDirty).some(Boolean))
  }, [adding, editorDirty, onDirtyChange])

  const baseUnit = units.find(unit => unit.is_base)
  const baseUnitName = baseUnit && i18n.language.startsWith('ar') && baseUnit.name_ar
    ? baseUnit.name_ar
    : baseUnit?.name ?? ''
  const activePackages = units.filter(unit => !unit.is_base && unit.is_active)
  const inactivePackages = units.filter(unit => !unit.is_base && !unit.is_active)
  const activeNames = activePackages.map(unit => unit.name.trim().toLocaleLowerCase())
  const dirtyHandler = (key: string) => (dirty: boolean) => {
    setEditorDirty(current => current[key] === dirty ? current : { ...current, [key]: dirty })
  }
  const handleSaved = async () => {
    setAdding(false)
    setEditorDirty({})
    setStaleMessage('')
    await loadUnits()
    setSuccessMessage(t('units.saved'))
  }
  const handleStale = async () => {
    setAdding(false)
    setEditorDirty({})
    setSuccessMessage('')
    await loadUnits()
    setStaleMessage(t('units.errors.stale'))
  }

  if (!productId) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-4 text-center">
        <PackagePlus size={20} className="mx-auto text-gray-300" aria-hidden="true" />
        <p className="mt-2 text-xs leading-5 text-gray-500">{t('units.saveProductFirst')}</p>
      </div>
    )
  }

  if (serviceRestricted) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3 text-xs leading-5 text-gray-600">
        {t('units.serviceRestriction')}
      </div>
    )
  }

  if (loading) {
    return <p className="py-3 text-center text-xs text-gray-500" role="status">{t('units.loading')}</p>
  }

  if (loadErrorKey || !baseUnit) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700" role="alert">
        <p>{t(`units.errors.${loadErrorKey ?? 'loadFailed'}`)}</p>
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => void loadUnits()}>
          {t('units.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      {!stockEnabled && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3.5 py-3 text-xs leading-5 text-amber-800">
          {t('units.stockDisabled')}
        </div>
      )}

      {successMessage && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700" role="status">
          {successMessage}
        </p>
      )}
      {staleMessage && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" role="alert">
          {staleMessage}
        </p>
      )}

      <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm">
            <Box size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{t('units.baseUnit')}</p>
            <p className="truncate text-sm font-bold text-gray-900">{baseUnitName}</p>
            {baseUnit.name_ar && <p className="truncate text-xs text-gray-500" dir="rtl">{baseUnit.name_ar}</p>}
          </div>
          <span className="ms-auto min-w-0 max-w-[48%] break-words rounded-full bg-white px-2.5 py-1 text-end text-xs font-semibold tabular-nums text-emerald-800">
            {t('units.baseEquation', { baseUnit: baseUnitName })}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-gray-500">{t('units.baseReadOnly')}</p>
      </div>

      {activePackages.map(unit => (
        <PackageEditor
          key={`${unit.id}:${unit.version}`}
          unit={unit}
          baseUnit={baseUnit}
          baseUnitName={baseUnitName}
          basePrice={basePrice}
          duplicateNames={activeNames.filter(name => name !== unit.name.trim().toLocaleLowerCase())}
          onSaved={handleSaved}
          onStale={handleStale}
          onDirtyChange={dirtyHandler(unit.id)}
        />
      ))}

      {adding && (
        <PackageEditor
          baseUnit={baseUnit}
          baseUnitName={baseUnitName}
          basePrice={basePrice}
          duplicateNames={activeNames}
          onSaved={handleSaved}
          onStale={handleStale}
          onDirtyChange={dirtyHandler('new')}
          onCancel={() => {
            setAdding(false)
            setEditorDirty(current => ({ ...current, new: false }))
          }}
        />
      )}

      {!adding && (
        <Button type="button" variant="secondary" className="w-full" onClick={() => {
          setSuccessMessage('')
          setStaleMessage('')
          setAdding(true)
        }}>
          <PackagePlus size={15} aria-hidden="true" />
          {t('units.addPackage')}
        </Button>
      )}

      {inactivePackages.length > 0 && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500">{t('units.inactivePackages')}</p>
          {inactivePackages.map(unit => (
            <PackageEditor
              key={`${unit.id}:${unit.version}`}
              unit={unit}
              baseUnit={baseUnit}
              baseUnitName={baseUnitName}
              basePrice={basePrice}
              duplicateNames={activeNames}
              onSaved={handleSaved}
              onStale={handleStale}
              onDirtyChange={dirtyHandler(unit.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
