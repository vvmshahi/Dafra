/**
 * Authoritative ZATCA TSXY functionality-map contract.
 * X and Y are reserved and must remain disabled.
 */
export type ZatcaInvoiceCapability =
  | 'simplified_only'
  | 'standard_and_simplified'
  | 'standard_only'

export type ZatcaFunctionalityMap = '0100' | '1000' | '1100'

export const ZATCA_CAPABILITY_MAP: Readonly<Record<ZatcaInvoiceCapability, ZatcaFunctionalityMap>> = {
  simplified_only: '0100',
  standard_and_simplified: '1100',
  standard_only: '1000',
}

export const NORMAL_ONBOARDING_CAPABILITIES = [
  'simplified_only',
  'standard_and_simplified',
] as const satisfies readonly ZatcaInvoiceCapability[]

export function isZatcaFunctionalityMap(value: unknown): value is ZatcaFunctionalityMap {
  return value === '0100' || value === '1000' || value === '1100'
}

export function isZatcaInvoiceCapability(value: unknown): value is ZatcaInvoiceCapability {
  return value === 'simplified_only'
    || value === 'standard_and_simplified'
    || value === 'standard_only'
}

export function functionalityMapForCapability(capability: ZatcaInvoiceCapability): ZatcaFunctionalityMap {
  return ZATCA_CAPABILITY_MAP[capability]
}

export function capabilityForFunctionalityMap(map: ZatcaFunctionalityMap): ZatcaInvoiceCapability {
  if (map === '0100') return 'simplified_only'
  if (map === '1100') return 'standard_and_simplified'
  return 'standard_only'
}

export function validateZatcaFunctionalityMap(value: unknown): ZatcaFunctionalityMap {
  if (typeof value !== 'string' || !/^[01]{4}$/.test(value) || !isZatcaFunctionalityMap(value)) {
    throw new Error('ZATCA_FUNCTIONALITY_MAP_INVALID')
  }
  return value
}
