import { CalendarRange, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  FilterPanel,
  FilterPresetRow,
  ResponsiveFilterGrid,
} from '@/components/ui/FilterPanel'
import type {
  IntelligenceDatePreset,
  SupplierIntelligenceFilters,
  SupplierPaymentStatusFilter,
} from '@/lib/suppliers/supplierIntelligence'

export interface SupplierFilterOption {
  id: string
  name: string
  nameAr?: string | null
}

interface Props {
  filters: SupplierIntelligenceFilters
  preset: IntelligenceDatePreset
  branches: SupplierFilterOption[]
  products: SupplierFilterOption[]
  units: SupplierFilterOption[]
  canChooseBranch: boolean
  isArabic: boolean
  onPreset: (preset: IntelligenceDatePreset) => void
  onChange: (filters: SupplierIntelligenceFilters) => void
}

const PRESETS: IntelligenceDatePreset[] = [
  'today',
  'last7',
  'last30',
  'thisMonth',
  'previousMonth',
  'thisYear',
  'custom',
]

const PAYMENT_STATUSES: SupplierPaymentStatusFilter[] = [
  'all',
  'paid',
  'partial',
  'unpaid',
]

const optionName = (option: SupplierFilterOption, isArabic: boolean) => (
  isArabic ? option.nameAr?.trim() || option.name : option.name || option.nameAr || '—'
)

export function SupplierIntelligenceFiltersPanel({
  filters,
  preset,
  branches,
  products,
  units,
  canChooseBranch,
  isArabic,
  onPreset,
  onChange,
}: Props) {
  const { t } = useTranslation('supplierIntelligence')

  return (
    <FilterPanel
      id="supplier-intelligence-filters"
      title={t('filters.title')}
      description={t('commercialActivity')}
      icon={SlidersHorizontal}
      accentClassName="bg-amber-50 text-amber-700"
    >
      <fieldset>
        <legend className="sr-only">{t('filters.dateRange')}</legend>
        <FilterPresetRow label={t('filters.dateRange')}>
          {PRESETS.map(value => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              onClick={() => onPreset(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors active:scale-[0.98] ${
                preset === value
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t(`filters.${value}`)}
            </button>
          ))}
        </FilterPresetRow>
      </fieldset>

      <ResponsiveFilterGrid columns={6}>
        <label className="space-y-1">
          <span className="label">{t('filters.startDate')}</span>
          <span className="relative block">
            <CalendarRange size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="date"
              className="input ps-9"
              value={filters.startDate}
              max={filters.endDate}
              onChange={event => onChange({ ...filters, startDate: event.target.value })}
            />
          </span>
        </label>
        <label className="space-y-1">
          <span className="label">{t('filters.endDate')}</span>
          <span className="relative block">
            <CalendarRange size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="date"
              className="input ps-9"
              value={filters.endDate}
              min={filters.startDate}
              onChange={event => onChange({ ...filters, endDate: event.target.value })}
            />
          </span>
        </label>
        {canChooseBranch && (
          <label className="space-y-1">
            <span className="label">{t('filters.branch')}</span>
            <select
              className="input"
              value={filters.branchId ?? ''}
              onChange={event => onChange({
                ...filters,
                branchId: event.target.value || null,
                productId: null,
                productUnitId: null,
              })}
            >
              <option value="">{t('filters.allBranches')}</option>
              {branches.map(branch => (
                <option key={branch.id} value={branch.id}>{optionName(branch, isArabic)}</option>
              ))}
            </select>
          </label>
        )}
        <label className="space-y-1">
          <span className="label">{t('filters.product')}</span>
          <select
            className="input"
            value={filters.productId ?? ''}
            onChange={event => onChange({
              ...filters,
              productId: event.target.value || null,
              productUnitId: null,
            })}
          >
            <option value="">{t('filters.allProducts')}</option>
            {products.map(product => (
              <option key={product.id} value={product.id}>{optionName(product, isArabic)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label">{t('filters.unit')}</span>
          <select
            className="input"
            value={filters.productUnitId ?? ''}
            disabled={!filters.productId || !units.length}
            onChange={event => onChange({
              ...filters,
              productUnitId: event.target.value || null,
            })}
          >
            <option value="">{t('filters.allUnits')}</option>
            {units.map(unit => (
              <option key={unit.id} value={unit.id}>{optionName(unit, isArabic)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label">{t('filters.paymentStatus')}</span>
          <select
            className="input"
            value={filters.paymentStatus}
            onChange={event => onChange({
              ...filters,
              paymentStatus: event.target.value as SupplierPaymentStatusFilter,
            })}
          >
            {PAYMENT_STATUSES.map(status => (
              <option key={status} value={status}>
                {t(`paymentStatus.${status}`)}
              </option>
            ))}
          </select>
          <span className="block text-[10px] leading-snug text-gray-400">
            {t('paymentStatus.informational')}
          </span>
        </label>
      </ResponsiveFilterGrid>
    </FilterPanel>
  )
}
