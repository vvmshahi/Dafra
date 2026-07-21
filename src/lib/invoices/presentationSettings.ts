import type {
  A4TemplateId, InvoiceIdentitySnapshot, InvoicePresentationSettings,
  LogoAssetSize, QrSize, ThermalDensity, ThermalWidth,
} from '@/types/database'

export const THERMAL_WIDTHS: readonly ThermalWidth[] = ['58mm', '80mm']
export const THERMAL_DENSITIES: readonly ThermalDensity[] = ['compact', 'standard', 'detailed']
export const QR_SIZES: readonly QrSize[] = ['small', 'standard', 'large']
export const LOGO_SIZES: readonly LogoAssetSize[] = ['small', 'medium', 'large']
export const A4_TEMPLATE_REGISTRY = {
  classic: { versions: [1], fallback: 'classic' },
  modern_split: { versions: [1], fallback: 'classic' },
  minimal_professional: { versions: [1], fallback: 'classic' },
} as const satisfies Record<A4TemplateId, { versions: readonly number[]; fallback: A4TemplateId }>

export interface HistoricalTemplateResolution {
  requestedId: string
  requestedVersion: number
  resolvedId: A4TemplateId
  resolvedVersion: 1
  exact: boolean
}

export function resolveHistoricalA4Template(id: string, version: number): HistoricalTemplateResolution {
  const entry = A4_TEMPLATE_REGISTRY[id as A4TemplateId]
  if (entry?.versions.includes(version as 1)) return { requestedId: id, requestedVersion: version, resolvedId: id as A4TemplateId, resolvedVersion: 1, exact: true }
  return { requestedId: id, requestedVersion: version, resolvedId: 'classic', resolvedVersion: 1, exact: false }
}

export function snapshotPresentation(snapshot: InvoiceIdentitySnapshot | null): InvoicePresentationSettings | null {
  return snapshot?.version === 2 ? snapshot.presentationSettings : null
}

export function canonicalPresentationDefaults(current: InvoicePresentationSettings): InvoicePresentationSettings {
  return {
    schema_version: 1,
    identity: { display_heading: null, display_subheading: null, custom_display_name: null, show_company_name: true, show_branch_name: true },
    contact: { ...current.contact, show_phone: !!current.contact.phone, show_email: !!current.contact.email, show_website: !!current.contact.website, show_address: true },
    footer: { thank_you_message: null, footer_note: null, refund_note: null, show_thank_you: false, show_footer: true, show_refund_note: false },
    logo: { ...current.logo, visible: !!current.logo.asset_path, size: 'medium' },
    thermal: { width: '80mm', density: 'standard', qr_size: 'standard', wrap_item_names: true, show_cash_change: true },
    a4: { template_id: 'classic', template_version: 1, header_style: 'standard' },
  }
}

export function immutableLogoObjectPath(tenantId: string, branchId: string, assetVersion: number, extension: 'png' | 'jpg' | 'jpeg' | 'webp') {
  if (!Number.isSafeInteger(assetVersion) || assetVersion < 1) throw new Error('Invalid logo asset version')
  return `invoice-branding/${tenantId}/${branchId}/${assetVersion}/logo.${extension}`
}
