import { CalendarRange, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  FilterPanel,
  FilterPresetRow,
  ResponsiveFilterGrid,
} from '@/components/ui/FilterPanel'
import type {
  CustomerIntelligenceFilters,
  IntelligenceDatePreset,
} from '@/lib/customers/customerIntelligence'

export interface IntelligenceFilterOption {
  id: string
  name: string
  nameAr?: string | null
}

interface Props {
  filters: CustomerIntelligenceFilters
  preset: IntelligenceDatePreset
  branches: IntelligenceFilterOption[]
  products: IntelligenceFilterOption[]
  units: IntelligenceFilterOption[]
  canChooseBranch: boolean
  isArabic: boolean
  onPreset: (preset: IntelligenceDatePreset) => void
  onChange: (filters: CustomerIntelligenceFilters) => void
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

const optionName = (option: IntelligenceFilterOption, isArabic: boolean) => (
  isArabic ? option.nameAr?.trim() || option.name : option.name || option.nameAr || '—'
)

export function CustomerIntelligenceFiltersPanel({
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
  const { t } = useTranslation('customerIntelligence')

  return (
    <FilterPanel
      id="customer-intelligence-filters"
      title={t('filters.title')}
      description={t('commercialActivity')}
      icon={SlidersHorizontal}
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
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

      <ResponsiveFilterGrid columns={4}>
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
      </ResponsiveFilterGrid>
    </FilterPanel>
  )
}
