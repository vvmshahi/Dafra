export type StandardBuyerField =
  | 'legalName'
  | 'vatNumber'
  | 'buildingNumber'
  | 'address'
  | 'district'
  | 'city'
  | 'postalCode'
  | 'country'

export interface StandardBuyerReadinessInput {
  businessName?: string | null
  companyName?: string | null
  vatNumber?: string | null
  buildingNumber?: string | null
  address?: string | null
  district?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string | null
}

export interface StandardBuyerReadiness {
  eligible: boolean
  missingFields: StandardBuyerField[]
  invalidFields: StandardBuyerField[]
}

export const STANDARD_BUYER_FIELD_KEYS: readonly StandardBuyerField[]
export function getStandardBuyerReadiness(input: StandardBuyerReadinessInput): StandardBuyerReadiness
