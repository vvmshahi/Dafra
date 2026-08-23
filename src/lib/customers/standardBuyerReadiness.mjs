const cleanText = value => typeof value === 'string' ? value.trim() : ''

/**
 * A client-side explanation of the persisted Standard-buyer gate. The database
 * remains authoritative at checkout; this only makes the same required fields
 * visible while a customer is being created or edited.
 *
 * BR-KSA-10 requires street, city and country on a Standard invoice. BR-KSA-63
 * additionally requires building number, postal code and district whenever
 * the buyer country is Saudi Arabia. Kubri Standard buyers are Saudi buyers.
 */
export const STANDARD_BUYER_FIELD_KEYS = Object.freeze([
  'legalName',
  'vatNumber',
  'buildingNumber',
  'address',
  'district',
  'city',
  'postalCode',
  'country',
])

export function getStandardBuyerReadiness(input) {
  const missingFields = []
  const invalidFields = []
  const legalName = cleanText(input?.businessName) || cleanText(input?.companyName)
  const vatNumber = cleanText(input?.vatNumber)
  const postalCode = cleanText(input?.postalCode)
  const country = cleanText(input?.country).toUpperCase()

  if (!legalName) missingFields.push('legalName')
  if (!vatNumber) missingFields.push('vatNumber')
  else if (!/^3[0-9]{13}3$/.test(vatNumber)) invalidFields.push('vatNumber')
  if (!cleanText(input?.buildingNumber)) missingFields.push('buildingNumber')
  if (!cleanText(input?.address)) missingFields.push('address')
  if (!cleanText(input?.district)) missingFields.push('district')
  if (!cleanText(input?.city)) missingFields.push('city')
  if (!postalCode) missingFields.push('postalCode')
  else if (!/^[0-9]{5}$/.test(postalCode)) invalidFields.push('postalCode')
  if (country !== 'SA') missingFields.push('country')

  return {
    eligible: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
  }
}
