import type {
  A4TemplateId, InvoiceIdentitySnapshot, InvoicePresentationSettings,
  LogoAssetSize, QrSize, ThermalDensity, ThermalWidth,
} from '@/types/database'

export interface InvoiceSettingsBranchDefaults {
  display_name?: string | null
  invoice_display_heading?: string | null
  invoice_display_subheading?: string | null
  business_name?: string | null
  business_name_ar?: string | null
  name?: string | null
  name_ar?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  show_website?: boolean | null
  show_email?: boolean | null
  receipt_footer?: string | null
  show_footer?: boolean | null
  show_cash_change?: boolean | null
  show_logo?: boolean | null
  logo_url?: string | null
  logo_asset_version?: number | null
  invoice_language?: string | null
  print_mode?: string | null
  thermal_density?: string | null
  a4_template_id?: string | null
}

export interface NormalizedInvoiceSettings {
  presentation: InvoicePresentationSettings
  invoiceLanguage: 'en' | 'ar' | 'both'
  printMode: 'thermal' | 'pdf' | 'both'
  afterSaleAction: 'ask' | 'receipt' | 'a4' | 'none'
}

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

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {}
const text = (value: unknown, fallback: string | null = null): string | null => typeof value === 'string' ? value : fallback
const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback
const positiveInt = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => typeof value === 'string' && values.includes(value as T) ? value as T : fallback

/**
 * Normalizes both the V1 RPC envelope and a direct/partial presentation object.
 * The branch argument is deliberately presentation-only; it cannot introduce
 * Phase 6A compliance identity data.
 */
export function normalizeInvoiceSettings(rawSettings: unknown, branch: InvoiceSettingsBranchDefaults): NormalizedInvoiceSettings {
  const raw = record(rawSettings)
  const envelopePresentation = record(raw.presentation_settings)
  const directPresentation = record(raw.presentation)
  const source = Object.keys(envelopePresentation).length > 0
    ? envelopePresentation
    : Object.keys(directPresentation).length > 0
      ? directPresentation
      : raw
  const identity = record(source.identity)
  const contact = record(source.contact)
  const footer = record(source.footer)
  const logo = record(source.logo)
  const thermal = record(source.thermal)
  const a4 = record(source.a4)
  const companyName = branch.business_name ?? branch.name ?? null
  const branchHeading = branch.display_name ?? branch.invoice_display_heading ?? companyName
  const language = oneOf(raw.invoice_language ?? source.invoice_language ?? branch.invoice_language, ['en', 'ar', 'both'] as const, 'both')
  const printMode = oneOf(raw.print_mode ?? source.print_mode ?? branch.print_mode, ['thermal', 'pdf', 'both'] as const, 'thermal')
  const afterSaleAction = oneOf(source.after_sale_action ?? raw.after_sale_action, ['ask', 'receipt', 'a4', 'none'] as const, printMode === 'pdf' ? 'a4' : 'receipt')
  const thermalDensity = oneOf(branch.thermal_density, THERMAL_DENSITIES, 'standard')
  const templateId = oneOf(branch.a4_template_id, Object.keys(A4_TEMPLATE_REGISTRY) as A4TemplateId[], 'classic')

  return {
    invoiceLanguage: language,
    printMode,
    presentation: {
      schema_version: 1,
      identity: {
        display_heading: text(identity.display_heading, branchHeading),
        display_subheading: text(identity.display_subheading, branch.invoice_display_subheading ?? null),
        custom_display_name: text(identity.custom_display_name, branch.display_name ?? branch.name ?? null),
        show_company_name: bool(identity.show_company_name, true),
        show_branch_name: bool(identity.show_branch_name, true),
      },
      contact: {
        phone: text(contact.phone, branch.phone ?? null),
        email: text(contact.email, branch.email ?? null),
        website: text(contact.website, branch.website ?? null),
        show_phone: bool(contact.show_phone, !!branch.phone),
        show_email: bool(contact.show_email, branch.show_email ?? !!branch.email),
        show_website: bool(contact.show_website, branch.show_website ?? !!branch.website),
        address_override: text(contact.address_override, null), show_address: bool(contact.show_address, true),
      },
      footer: {
        thank_you_message: text(footer.thank_you_message, null),
        footer_note: text(footer.footer_note, branch.receipt_footer ?? null),
        refund_note: text(footer.refund_note, null),
        show_thank_you: bool(footer.show_thank_you, false),
        show_footer: bool(footer.show_footer, branch.show_footer ?? true),
        show_refund_note: bool(footer.show_refund_note, false),
      },
      logo: {
        visible: bool(logo.visible, branch.show_logo ?? true),
        asset_path: text(logo.asset_path, branch.logo_url ?? null),
        asset_version: positiveInt(logo.asset_version, positiveInt(branch.logo_asset_version, 1)),
        size: oneOf(logo.size, LOGO_SIZES, 'medium'),
      },
      thermal: {
        width: oneOf(thermal.width, THERMAL_WIDTHS, '80mm'),
        density: oneOf(thermal.density, THERMAL_DENSITIES, thermalDensity),
        qr_size: oneOf(thermal.qr_size, QR_SIZES, 'standard'),
        wrap_item_names: bool(thermal.wrap_item_names, true),
        show_cash_change: bool(thermal.show_cash_change, branch.show_cash_change ?? true),
      },
      a4: {
        template_id: oneOf(a4.template_id, Object.keys(A4_TEMPLATE_REGISTRY) as A4TemplateId[], templateId),
        template_version: 1,
        header_style: oneOf(a4.header_style, ['standard', 'compact', 'branded'] as const, 'standard'),
      },
    }, afterSaleAction,
  }
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
