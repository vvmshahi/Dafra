import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MoneyInput } from '@/components/ui/MoneyInput'
import {
  CUSTOM_LINE_QUANTITY_SCALE,
  CUSTOM_LINE_UNIT_CODE,
  CUSTOM_LINE_UNIT_PRESETS,
  getCustomLineDisplayPreview,
  isCustomLineUnitPreset,
  createCustomCartLine,
  validateCustomCartLineInput,
  type CustomCartLine,
  type CustomLineVatTreatment,
  type CustomCartLineValidationIssue,
} from '@/lib/pos/cartLines'

interface Props {
  line: CustomCartLine | null
  branchVatMode: 'exclusive' | 'inclusive'
  onClose: () => void
  onSave: (line: CustomCartLine) => void
}

const vatOptions: CustomLineVatTreatment[] = ['inherit', 'exclusive', 'inclusive']

function quantityStep() {
  return Number((10 ** -CUSTOM_LINE_QUANTITY_SCALE).toFixed(CUSTOM_LINE_QUANTITY_SCALE))
}

export function CustomLineEditor({ line, branchVatMode, onClose, onSave }: Props) {
  const { t } = useTranslation(['pos', 'common'])
  const [description, setDescription] = useState(line?.description ?? '')
  const [descriptionAr, setDescriptionAr] = useState(line?.descriptionAr ?? '')
  const [quantity, setQuantity] = useState(line ? String(line.quantity) : '1')
  const [unitPrice, setUnitPrice] = useState(line ? line.unitPrice.toFixed(2) : '')
  const [vatTreatment, setVatTreatment] = useState<CustomLineVatTreatment>(line?.vatTreatment ?? 'inherit')
  const [unitCode, setUnitCode] = useState(line?.unitCode ?? CUSTOM_LINE_UNIT_CODE)
  const [otherUnit, setOtherUnit] = useState(line?.unitCode && !isCustomLineUnitPreset(line.unitCode) ? line.unitCode : '')
  const [error, setError] = useState<CustomCartLineValidationIssue | null>(null)

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])

  const editing = line !== null
  const save = () => {
    const input = {
      cartLineId: line?.cartLineId,
      description,
      descriptionAr,
      quantity: Number(quantity),
      unitPrice: Number(unitPrice),
      vatTreatment,
      unitCode: unitCode === 'OTHER' ? otherUnit : unitCode,
    }
    const validationIssue = validateCustomCartLineInput(input)
    if (validationIssue) {
      setError(validationIssue)
      return
    }
    const next = createCustomCartLine(input)
    if (!next) return
    onSave(next)
  }

  const previewLine = createCustomCartLine({
    description: description || 'Preview', quantity: Number(quantity), unitPrice: Number(unitPrice), vatTreatment,
    unitCode: unitCode === 'OTHER' ? otherUnit : unitCode,
  })
  const preview = previewLine ? getCustomLineDisplayPreview(previewLine, branchVatMode) : null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-line-editor-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="custom-line-editor-title" className="text-base font-bold text-gray-900">
              {editing ? t('pos:customLine.editTitle') : t('pos:customLine.title')}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">{t('pos:customLine.previewOnly')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:close')}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="label" htmlFor="custom-line-description">{t('pos:customLine.description')}</label>
            <input
              id="custom-line-description"
              autoFocus
              value={description}
              maxLength={255}
              onChange={event => { setDescription(event.target.value); setError(null) }}
              className="input"
              aria-invalid={error === 'description'}
            />
            {error === 'description' && <p className="mt-1.5 text-xs text-red-600">{t('pos:customLine.errors.description')}</p>}
          </div>

          <div>
            <label className="label" htmlFor="custom-line-description-ar">{t('pos:customLine.descriptionAr')}</label>
            <input
              id="custom-line-description-ar"
              value={descriptionAr}
              maxLength={255}
              dir="rtl"
              onChange={event => setDescriptionAr(event.target.value)}
              className="input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <label className="label" htmlFor="custom-line-quantity">{t('pos:customLine.quantity')}</label>
              <input
                id="custom-line-quantity"
                type="number"
                inputMode="decimal"
                min={quantityStep()}
                step={quantityStep()}
                value={quantity}
                onChange={event => { setQuantity(event.target.value); setError(null) }}
                className="input tabular-nums"
                dir="ltr"
                aria-invalid={error === 'quantity'}
              />
              {error === 'quantity' && <p className="mt-1.5 text-xs text-red-600">{t('pos:customLine.errors.quantity')}</p>}
            </div>
            <div>
              <label className="label" htmlFor="custom-line-unit">{t('pos:customLine.unit')}</label>
              <select id="custom-line-unit" value={unitCode} onChange={event => { setUnitCode(event.target.value); setError(null) }} className="input" aria-invalid={error === 'unit'}>
                {CUSTOM_LINE_UNIT_PRESETS.map(unit => <option key={unit} value={unit}>{t(`pos:customLine.units.${unit}`)}</option>)}
                <option value="OTHER">{t('pos:customLine.units.OTHER')}</option>
              </select>
              {error === 'unit' && <p className="mt-1.5 text-xs text-red-600">{t('pos:customLine.errors.unit')}</p>}
            </div>
            <div>
              <label className="label" htmlFor="custom-line-unit-price">{t('pos:customLine.unitPrice')}</label>
              <MoneyInput
                id="custom-line-unit-price"
                value={unitPrice}
                onValueChange={value => { setUnitPrice(value); setError(null) }}
                className="input tabular-nums"
                dir="ltr"
                aria-invalid={error === 'unitPrice'}
              />
              {error === 'unitPrice' && <p className="mt-1.5 text-xs text-red-600">{t('pos:customLine.errors.unitPrice')}</p>}
            </div>
          </div>

          {unitCode === 'OTHER' && <div>
            <label className="label" htmlFor="custom-line-other-unit">{t('pos:customLine.customUnit')}</label>
            <input id="custom-line-other-unit" value={otherUnit} maxLength={40} onChange={event => { setOtherUnit(event.target.value); setError(null) }} className="input" aria-invalid={error === 'unit'} />
          </div>}

          <fieldset>
            <legend className="label">{t('pos:customLine.vatTreatment')}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {vatOptions.map(option => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={vatTreatment === option}
                  onClick={() => { setVatTreatment(option); setError(null) }}
                  className={`rounded-xl border px-3 py-2.5 text-start text-xs font-semibold transition-colors ${
                    vatTreatment === option
                      ? 'border-primary-500 bg-primary-50 text-primary-900 ring-1 ring-primary-500'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-primary-200'
                  }`}
                >
                  {t(`pos:customLine.vat.${option}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3" data-custom-line-preview>
            <div className="flex items-center justify-between"><p className="text-xs font-bold text-emerald-900">{t('pos:customLine.preview')}</p><p className="text-[10px] text-emerald-700">{t('pos:customLine.finalTotals')}</p></div>
            {preview ? <div className="mt-2 space-y-1 text-xs text-emerald-900" dir="ltr">
              <p className="font-semibold">{quantity} × SAR {Number(unitPrice || 0).toFixed(2)}</p>
              <div className="flex justify-between"><span>{t('pos:subtotal')}</span><span>SAR {preview.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>{t('pos:vat')}</span><span>SAR {preview.taxAmount.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-emerald-200 pt-1 font-bold"><span>{t('pos:total')}</span><span>SAR {preview.total.toFixed(2)}</span></div>
            </div> : <p className="mt-2 text-xs text-emerald-700">—</p>}
          </div>
        </div>

        <div className="flex gap-2 border-t border-gray-100 bg-gray-50 px-5 py-4">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100">
            {t('common:cancel')}
          </button>
          <button type="button" onClick={save} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1B6B3A] py-2.5 text-sm font-bold text-white hover:bg-[#155830]">
            <Check size={15} />
            {editing ? t('pos:customLine.saveChanges') : t('pos:customLine.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
