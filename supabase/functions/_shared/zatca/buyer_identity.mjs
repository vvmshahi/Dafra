const cleanText = (value) => typeof value === 'string' ? value.trim() : ''

export class StandardBuyerIdentityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StandardBuyerIdentityError'
    this.code = code
  }
}

/**
 * Resolves the legal buyer identity from the server-owned customer record.
 * A standard document may contain only one RegistrationName, so Arabic
 * documents prefer the Arabic legal name and all other document languages
 * prefer the primary legal name. A contact/display name is never a fallback.
 */
export function buildStandardBuyerIdentity(customer, documentLanguage) {
  if (!customer) {
    throw new StandardBuyerIdentityError(
      'STANDARD_BUYER_IDENTITY_REQUIRED',
      'A standard invoice requires an authoritative buyer customer record.',
    )
  }

  const businessName = cleanText(customer.business_name)
  const businessNameAr = cleanText(customer.business_name_ar)
  // company_name is the schema's explicitly documented legacy legal-entity
  // field. It is retained only for older authoritative customer records.
  const legacyLegalName = cleanText(customer.company_name)
  const legalName = documentLanguage === 'ar'
    ? businessNameAr || businessName || legacyLegalName
    : businessName || legacyLegalName || businessNameAr

  if (!legalName) {
    throw new StandardBuyerIdentityError(
      'STANDARD_BUYER_LEGAL_NAME_REQUIRED',
      'A standard invoice requires the buyer legal business name.',
    )
  }

  const vatNumber = cleanText(customer.vat_number) || undefined
  const crNumber = cleanText(customer.cr_number) || undefined
  if (!vatNumber && !crNumber) {
    throw new StandardBuyerIdentityError(
      'STANDARD_BUYER_IDENTIFIER_REQUIRED',
      'A standard invoice buyer requires a VAT number or commercial registration number.',
    )
  }

  const street = documentLanguage === 'ar'
    ? cleanText(customer.address_ar) || cleanText(customer.address)
    : cleanText(customer.address) || cleanText(customer.address_ar)
  const address = {
    street: street || undefined,
    buildingNo: cleanText(customer.building_number) || undefined,
    district: cleanText(customer.district) || undefined,
    city: cleanText(customer.city) || undefined,
    postalCode: cleanText(customer.postal_code) || undefined,
    countryCode: cleanText(customer.country) || undefined,
  }

  return {
    legalName,
    vatNumber,
    crNumber,
    address: Object.values(address).some(Boolean) ? address : undefined,
  }
}

/**
 * Uses the same PartyIdentification/PostalAddress conventions as the
 * project's compliant standard-invoice sample builder. Only persisted values
 * are emitted; absent address components are not synthesized as empty nodes.
 */
export function appendStandardBuyerParty(customerParty, buyer, ns) {
  const customer = customerParty.ele(ns.cac, 'Party')
  if (buyer.crNumber) {
    customer.ele(ns.cac, 'PartyIdentification').ele(ns.cbc, 'ID')
      .att('schemeID', 'CRN').txt(buyer.crNumber)
  }
  if (buyer.address) {
    const postalAddress = customer.ele(ns.cac, 'PostalAddress')
    if (buyer.address.street) postalAddress.ele(ns.cbc, 'StreetName').txt(buyer.address.street)
    if (buyer.address.buildingNo) postalAddress.ele(ns.cbc, 'BuildingNumber').txt(buyer.address.buildingNo)
    if (buyer.address.district) postalAddress.ele(ns.cbc, 'CitySubdivisionName').txt(buyer.address.district)
    if (buyer.address.city) postalAddress.ele(ns.cbc, 'CityName').txt(buyer.address.city)
    if (buyer.address.postalCode) postalAddress.ele(ns.cbc, 'PostalZone').txt(buyer.address.postalCode)
    if (buyer.address.countryCode) {
      postalAddress.ele(ns.cac, 'Country').ele(ns.cbc, 'IdentificationCode').txt(buyer.address.countryCode)
    }
  }
  if (buyer.vatNumber) {
    const buyerTax = customer.ele(ns.cac, 'PartyTaxScheme')
    buyerTax.ele(ns.cbc, 'CompanyID').txt(buyer.vatNumber)
    buyerTax.ele(ns.cac, 'TaxScheme').ele(ns.cbc, 'ID').txt('VAT')
  }
  customer.ele(ns.cac, 'PartyLegalEntity').ele(ns.cbc, 'RegistrationName').txt(buyer.legalName)
}
