import type { BusinessType } from '@/types'

export const BUSINESS_TYPE_OPTIONS: {
  value: BusinessType
  label: string
  shortLabel: string
  description: string
}[] = [
  {
    value: 'trading',
    label: 'Trading business',
    shortLabel: 'Trading',
    description: 'Products, stock, and purchase tracking.',
  },
  {
    value: 'service',
    label: 'Service business',
    shortLabel: 'Service',
    description: 'Services, produced items, materials, and simple profit estimates.',
  },
]

export function resolveBusinessType(value: string | null | undefined): BusinessType {
  return value === 'service' ? 'service' : 'trading'
}

export function businessTypeLabel(value: string | null | undefined) {
  const businessType = resolveBusinessType(value)
  return BUSINESS_TYPE_OPTIONS.find(option => option.value === businessType)?.label ?? 'Trading business'
}

export function businessTypeDescription(value: string | null | undefined) {
  const businessType = resolveBusinessType(value)
  return BUSINESS_TYPE_OPTIONS.find(option => option.value === businessType)?.description ?? BUSINESS_TYPE_OPTIONS[0].description
}

export function isStockModuleVisible({
  businessType,
  stockEnabled,
}: {
  businessType: string | null | undefined
  stockEnabled: boolean | null | undefined
}) {
  if (resolveBusinessType(businessType) === 'service') return false
  if (stockEnabled === false) return false
  return true
}
