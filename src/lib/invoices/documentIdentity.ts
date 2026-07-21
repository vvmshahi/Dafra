import type { Branch, InvoiceIdentitySnapshot } from '@/types/database'

export interface DocumentIdentityViewModel {
  snapshotBacked: boolean
  heading: string | null
  subheading: string | null
  branchName: string | null
  branchNameAr: string | null
  registeredSellerName: string
  registeredSellerNameAr: string | null
  vatNumber: string
  registrationIdentifier: string | null
  address: string | null
  logoUrl: string | null
  showLogo: boolean
  phone: string | null
  email: string | null
  website: string | null
  showEmail: boolean
  showWebsite: boolean
  footer: string | null
  showFooter: boolean
  showCashChange: boolean
  logoAssetVersion: number | null
}

export function documentIdentity(snapshot: InvoiceIdentitySnapshot | null, branch: Branch): DocumentIdentityViewModel {
  if (snapshot?.version === 2 && snapshot.legacy === false) {
    const c = snapshot.compliance
    const p = snapshot.presentationSettings
    const address = [c.address.buildingNumber, c.address.street, c.address.district, c.address.city, c.address.country, c.address.postalCode].filter(Boolean).join(', ')
    return {
      snapshotBacked: true, heading: p.identity.display_heading, subheading: p.identity.display_subheading,
      branchName: p.identity.show_branch_name ? p.identity.custom_display_name : null, branchNameAr: null,
      registeredSellerName: c.registeredSellerName, registeredSellerNameAr: c.registeredSellerNameAr,
      vatNumber: c.vatNumber, registrationIdentifier: c.registrationIdentifier,
      address: p.contact.show_address ? address || null : null,
      logoUrl: p.logo.asset_path, showLogo: p.logo.visible, phone: p.contact.phone,
      email: p.contact.email, website: p.contact.website, showEmail: p.contact.show_email,
      showWebsite: p.contact.show_website, footer: p.footer.footer_note,
      showFooter: p.footer.show_footer, showCashChange: p.thermal.show_cash_change,
      logoAssetVersion: p.logo.asset_version,
    }
  }
  if (snapshot?.version === 1 && snapshot.legacy === false) {
    const c = snapshot.compliance
    const p = snapshot.presentation
    const address = [c.address.buildingNumber, c.address.street, c.address.district, c.address.city, c.address.country, c.address.postalCode].filter(Boolean).join(', ')
    return {
      snapshotBacked: true, heading: p.displayHeading, subheading: p.displaySubheading,
      branchName: p.showBranchDisplayName ? p.branchDisplayName : null,
      branchNameAr: p.showBranchDisplayName ? p.branchDisplayNameAr : null,
      registeredSellerName: c.registeredSellerName, registeredSellerNameAr: c.registeredSellerNameAr,
      vatNumber: c.vatNumber, registrationIdentifier: c.registrationIdentifier, address: address || null,
      logoUrl: p.logoUrl, showLogo: p.showLogo, phone: p.phone, email: p.email, website: p.website,
      showEmail: p.showEmail, showWebsite: p.showWebsite, footer: p.footer, showFooter: p.showFooter,
      showCashChange: p.showCashChange, logoAssetVersion: p.logoAssetVersion,
    }
  }
  const address = [branch.building_number, branch.street, branch.district, branch.city, branch.country, branch.postal_code].filter(Boolean).join(', ')
  return {
    snapshotBacked: false, heading: branch.display_name || branch.business_name || branch.name,
    subheading: null, branchName: branch.name, branchNameAr: branch.name_ar,
    registeredSellerName: branch.business_name || branch.name,
    registeredSellerNameAr: branch.business_name_ar, vatNumber: branch.vat_number || '',
    registrationIdentifier: branch.cr_number, address: address || null,
    logoUrl: branch.logo_url, showLogo: branch.show_logo, phone: branch.phone, email: branch.email,
    website: branch.website, showEmail: branch.show_email, showWebsite: branch.show_website,
    footer: branch.receipt_footer, showFooter: branch.show_footer,
    showCashChange: branch.show_cash_change, logoAssetVersion: null,
  }
}
