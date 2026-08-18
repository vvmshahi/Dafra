import type {
  A4TemplateId, InvoiceIdentitySnapshot, InvoicePresentationSettings,
  LogoAssetSize, QrSize, QrAlignment, ThermalDensity, ThermalWidth,
} from '@/types/database'

const DEFAULT_A4_ACCENT = '#0f766e'
const DEFAULT_A4_HEADING = '#10251a'
const DEFAULT_A4_BODY = '#1f2937'

/**
 * V1 letterhead geometry is intentionally document-flow only: header artwork
 * appears at document start and footer artwork at document end. Keep these
 * limits aligned with the settings UI and database validator so a saved
 * configuration never changes when it is read back for preview or print.
 */
export const A4_ARTWORK_BOUNDS = {
  headerHeight: { min: 8, max: 45 },
  footerHeight: { min: 4, max: 18 },
  headerSpacing: { min: 0, max: 8 },
  footerSpacing: { min: 0, max: 8 },
  maxReservedHeight: 74,
} as const

type A4ArtworkGeometry = Pick<InvoicePresentationSettings['a4'],
  'header_asset_height' | 'footer_asset_height' | 'header_asset_spacing' | 'footer_asset_spacing'>

export function isA4ArtworkGeometryWithinBounds(value: A4ArtworkGeometry): boolean {
  const { headerHeight, footerHeight, headerSpacing, footerSpacing, maxReservedHeight } = A4_ARTWORK_BOUNDS
  const dimensions = [
    value.header_asset_height,
    value.footer_asset_height,
    value.header_asset_spacing,
    value.footer_asset_spacing,
  ]
  if (!dimensions.every(Number.isInteger)) return false
  return value.header_asset_height >= headerHeight.min
    && value.header_asset_height <= headerHeight.max
    && value.footer_asset_height >= footerHeight.min
    && value.footer_asset_height <= footerHeight.max
    && value.header_asset_spacing >= headerSpacing.min
    && value.header_asset_spacing <= headerSpacing.max
    && value.footer_asset_spacing >= footerSpacing.min
    && value.footer_asset_spacing <= footerSpacing.max
    && value.header_asset_height + value.footer_asset_height + value.header_asset_spacing + value.footer_asset_spacing <= maxReservedHeight
}

type SavedA4Settings = {
  theme: A4TemplateId
  accent_color: string
  heading_color: string
  body_color: string
  auto_foreground: boolean
  header_asset_path: string | null
  header_asset_version: number
  header_asset_enabled: boolean
  show_standard_branding: boolean
  header_asset_fit: 'contain' | 'cover'
  header_asset_height: number
  header_asset_spacing: number
  header_crop_top: number
  header_crop_height: number
  footer_asset_path: string | null
  footer_asset_version: number
  footer_asset_enabled: boolean
  footer_asset_fit: 'contain' | 'cover'
  footer_asset_height: number
  footer_asset_spacing: number
  footer_crop_top: number
  footer_crop_height: number
  artwork_scope: 'selected' | 'all'
  artwork_template_id: A4TemplateId
}

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
  address?: string | null
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
  afterSaleAction: 'receipt' | 'a4' | 'both'
  preservedSettings?: Record<string, unknown>
}

/** The historical/runtime envelope used by the normalizer and compatibility paths. */
export interface CanonicalInvoicePresentationSettings {
  schema_version: 1
  language: 'ar' | 'both'
  after_sale_action: 'receipt' | 'a4' | 'both'
  branding: {
    heading_mode: 'branch' | 'custom'
    custom_heading: string | null
    subheading: string | null
    show_company_name: boolean
    logo_path: string | null
    logo_size: LogoAssetSize
  }
  contact: {
    show_phone: boolean
    phone_override: string | null
    show_email: boolean
    email: string | null
    show_website: boolean
    website: string | null
    show_address: boolean
    address_override: string | null
  }
  footer: { message: string | null; bold: boolean }
  thermal: { width: ThermalWidth; density: ThermalDensity; qr_size: 'small' | 'medium' | 'large'; qr_alignment: QrAlignment }
  a4: SavedA4Settings
  [key: string]: unknown
}

/**
 * The exact V1 object accepted by the settings RPC.  This is intentionally a
 * closed type: runtime presentation models, legacy aliases, and compliance
 * identity fields must never leak into a save payload.
 */
export interface InvoicePresentationSaveContract {
  schema_version: 1
  language: 'ar' | 'both'
  after_sale_action: 'receipt' | 'a4' | 'both'
  branding: {
    heading_mode: 'branch' | 'custom'
    custom_heading: string | null
    subheading: string | null
    show_company_name: boolean
    logo_path: string | null
    logo_size: LogoAssetSize
  }
  contact: {
    show_phone: boolean
    phone_override: string | null
    show_email: boolean
    email: string | null
    show_website: boolean
    website: string | null
    show_address: boolean
    address_override: string | null
  }
  footer: { message: string | null; bold: boolean }
  thermal: { width: ThermalWidth; density: ThermalDensity; qr_size: 'small' | 'medium' | 'large'; qr_alignment: 'center' }
  a4: SavedA4Settings
}

export interface InvoicePresentationSaveInput {
  presentation: InvoicePresentationSettings
  invoiceLanguage: 'en' | 'ar' | 'both'
  afterSaleAction?: 'receipt' | 'a4' | 'both'
}

export interface UpdateBranchInvoiceSettingsPayload {
  branch_id: string
  invoice_language: 'ar' | 'both'
  print_mode: 'thermal' | 'pdf' | 'both'
  presentation_settings: InvoicePresentationSaveContract
}

/**
 * Serialize only the hosted V1 presentation contract.  Do not replace this
 * with object spreading: the draft also contains legacy/runtime-only fields.
 */
export function serializeInvoicePresentationSettingsForSave(
  value: InvoicePresentationSaveInput,
  branchName?: string | null,
): InvoicePresentationSaveContract {
  const p = value.presentation
  const heading = p.identity.display_heading?.trim() || null
  const isBranchHeading = !heading || (!!branchName && heading === branchName)
  const footerMessage = p.footer.footer_note?.trim() || null
  const qrSizeInput = p.thermal.qr_size === 'standard' ? 'medium' : p.thermal.qr_size
  const qrSize = oneOf(qrSizeInput, ['small', 'medium', 'large'] as const, 'medium')
  const language = value.invoiceLanguage === 'ar' ? 'ar' : 'both'
  const actionInput: unknown = value.afterSaleAction ?? p.after_sale_action
  const actionAlias = actionInput === 'thermal' ? 'receipt' : actionInput === 'pdf' ? 'a4' : actionInput === 'ask' || actionInput === 'none' ? 'receipt' : actionInput
  const afterSaleAction = oneOf(actionAlias, ['receipt', 'a4', 'both'] as const, 'receipt')

  return {
    schema_version: 1,
    language,
    after_sale_action: afterSaleAction,
    branding: {
      heading_mode: oneOf(p.identity.heading_mode, ['branch', 'custom'] as const, isBranchHeading ? 'branch' : 'custom'),
      custom_heading: isBranchHeading ? null : heading,
      subheading: p.identity.display_subheading?.trim() || null,
      show_company_name: !!p.identity.show_company_name,
      logo_path: p.logo.asset_path?.trim() || null,
      logo_size: oneOf(p.logo.size, LOGO_SIZES, 'medium'),
    },
    contact: {
      show_phone: !!p.contact.show_phone,
      phone_override: p.contact.phone?.trim() || null,
      show_email: !!p.contact.show_email,
      email: p.contact.email?.trim() || null,
      show_website: !!p.contact.show_website,
      website: p.contact.website?.trim() || null,
      show_address: !!p.contact.show_address,
      address_override: p.contact.address_override?.trim() || null,
    },
    footer: { message: footerMessage, bold: !!footerMessage },
    thermal: {
      width: oneOf(p.thermal.width, THERMAL_WIDTHS, '80mm'),
      density: oneOf(p.thermal.density, THERMAL_DENSITIES, 'standard'),
      qr_size: qrSize,
      qr_alignment: 'center',
    },
    a4: {
      theme: oneOf(p.a4.template_id, Object.keys(A4_TEMPLATE_REGISTRY) as A4TemplateId[], 'classic'),
      accent_color: p.a4.accent_color,
      heading_color: p.a4.heading_color,
      body_color: p.a4.body_color,
      auto_foreground: p.a4.auto_foreground,
      header_asset_path: p.a4.header_asset_path,
      header_asset_version: p.a4.header_asset_version,
      header_asset_enabled: p.a4.header_asset_enabled,
      show_standard_branding: p.a4.show_standard_branding,
      header_asset_fit: p.a4.header_asset_fit,
      header_asset_height: p.a4.header_asset_height,
      header_asset_spacing: p.a4.header_asset_spacing,
      header_crop_top: p.a4.header_crop_top,
      header_crop_height: p.a4.header_crop_height,
      footer_asset_path: p.a4.footer_asset_path,
      footer_asset_version: p.a4.footer_asset_version,
      footer_asset_enabled: p.a4.footer_asset_enabled,
      footer_asset_fit: p.a4.footer_asset_fit,
      footer_asset_height: p.a4.footer_asset_height,
      footer_asset_spacing: p.a4.footer_asset_spacing,
      footer_crop_top: p.a4.footer_crop_top,
      footer_crop_height: p.a4.footer_crop_height,
      artwork_scope: p.a4.artwork_scope,
      artwork_template_id: p.a4.artwork_template_id,
    },
  }
}

export function resolveInvoicePresentationSettings({ savedSettings, branch }: { savedSettings: unknown; branch: InvoiceSettingsBranchDefaults; tenant?: unknown }): NormalizedInvoiceSettings {
  return normalizeInvoiceSettings(savedSettings, branch)
}

export function toCanonicalInvoicePresentationSettings(value: {
  presentation: InvoicePresentationSettings
  invoiceLanguage: 'en' | 'ar' | 'both'
  afterSaleAction?: 'receipt' | 'a4' | 'both'
  preservedSettings?: Record<string, unknown>
}, branchName?: string | null): CanonicalInvoicePresentationSettings {
  const p = value.presentation
  const heading = p.identity.display_heading?.trim() || null
  const isBranchHeading = !heading || (!!branchName && heading === branchName)
  return {
    ...(value.preservedSettings ?? {}),
    schema_version: 1,
    language: value.invoiceLanguage === 'en' ? 'both' : value.invoiceLanguage,
    after_sale_action: value.afterSaleAction ?? p.after_sale_action ?? 'receipt',
    branding: {
      heading_mode: isBranchHeading ? 'branch' : 'custom',
      custom_heading: isBranchHeading ? null : heading,
      subheading: p.identity.display_subheading?.trim() || null,
      show_company_name: p.identity.show_company_name,
      logo_path: p.logo.asset_path,
      logo_size: p.logo.size,
    },
    contact: {
      show_phone: p.contact.show_phone,
      phone_override: p.contact.phone?.trim() || null,
      show_email: p.contact.show_email,
      email: p.contact.email?.trim() || null,
      show_website: p.contact.show_website,
      website: p.contact.website?.trim() || null,
      show_address: p.contact.show_address,
      address_override: p.contact.address_override?.trim() || null,
    },
    footer: { message: p.footer.footer_note?.trim() || null, bold: !!p.footer.footer_note?.trim() },
    thermal: {
      width: p.thermal.width,
      density: p.thermal.density,
      qr_size: p.thermal.qr_size === 'standard' ? 'medium' : p.thermal.qr_size,
      qr_alignment: 'center',
    },
    a4: {
      theme: p.a4.template_id,
      accent_color: p.a4.accent_color,
      heading_color: p.a4.heading_color,
      body_color: p.a4.body_color,
      auto_foreground: p.a4.auto_foreground,
      header_asset_path: p.a4.header_asset_path,
      header_asset_version: p.a4.header_asset_version,
      header_asset_enabled: p.a4.header_asset_enabled,
      show_standard_branding: p.a4.show_standard_branding,
      header_asset_fit: p.a4.header_asset_fit,
      header_asset_height: p.a4.header_asset_height,
      header_asset_spacing: p.a4.header_asset_spacing,
      header_crop_top: p.a4.header_crop_top,
      header_crop_height: p.a4.header_crop_height,
      footer_asset_path: p.a4.footer_asset_path,
      footer_asset_version: p.a4.footer_asset_version,
      footer_asset_enabled: p.a4.footer_asset_enabled,
      footer_asset_fit: p.a4.footer_asset_fit,
      footer_asset_height: p.a4.footer_asset_height,
      footer_asset_spacing: p.a4.footer_asset_spacing,
      footer_crop_top: p.a4.footer_crop_top,
      footer_crop_height: p.a4.footer_crop_height,
      artwork_scope: p.a4.artwork_scope,
      artwork_template_id: p.a4.artwork_template_id,
    },
  }
}

export const THERMAL_WIDTHS: readonly ThermalWidth[] = ['58mm', '80mm']
export const THERMAL_DENSITIES: readonly ThermalDensity[] = ['classic', 'compact', 'standard', 'detailed']
export const QR_SIZES: readonly QrSize[] = ['small', 'standard', 'large']
export const QR_ALIGNMENTS: readonly QrAlignment[] = ['left', 'center', 'right']
export const LOGO_SIZES: readonly LogoAssetSize[] = ['small', 'medium', 'large']
export const A4_TEMPLATE_REGISTRY = {
  classic: { versions: [1], fallback: 'classic' },
  modern_split: { versions: [1], fallback: 'classic' },
  minimal_professional: { versions: [1], fallback: 'classic' },
  executive_green: { versions: [1], fallback: 'classic' },
  clean_ledger: { versions: [1], fallback: 'classic' },
  contemporary_border: { versions: [1], fallback: 'classic' },
  executive_professional: { versions: [1], fallback: 'classic' },
  creative_studio: { versions: [1], fallback: 'classic' },
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
const color = (value: unknown, fallback: string): string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
const percent = (value: unknown, fallback: number, minimum = 0): number => typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(minimum, Math.round(value))) : fallback
const has = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
const nonEmptyText = (value: unknown, fallback: string | null = null): string | null => typeof value === 'string' && value.trim() ? value : fallback

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
  const canonicalBranding = record(source.branding)
  const identity = record(source.identity)
  const branding = Object.keys(canonicalBranding).length > 0 ? canonicalBranding : identity
  const contact = record(source.contact)
  const footer = record(source.footer)
  const logo = record(source.logo)
  const thermal = record(source.thermal)
  const a4 = record(source.a4)
  const preservedSettings = Object.fromEntries(Object.entries(source).filter(([key]) => ![
    'schema_version','language','invoice_language','after_sale_action','branding','identity','contact','footer','logo','thermal','a4','print_mode',
    'display_name','phone','show_logo','logo_url','website','email','show_website','show_email','receipt_footer','show_footer','show_cash_change',
    'branch_id','can_edit','role','compliance','zatca','registeredSellerName','vatNumber','registrationIdentifier','certificate','csid',
  ].includes(key)))
  const companyName = branch.business_name ?? branch.name ?? null
  const branchHeading = branch.display_name ?? branch.invoice_display_heading ?? branch.name ?? companyName
  const languageInput = oneOf(raw.invoice_language ?? source.language ?? source.invoice_language ?? branch.invoice_language, ['en', 'ar', 'both'] as const, 'both')
  const language = languageInput === 'en' ? 'both' : languageInput
  const printMode = oneOf(raw.print_mode ?? source.print_mode ?? branch.print_mode, ['thermal', 'pdf', 'both'] as const, 'thermal')
  const actionValue = source.after_sale_action ?? raw.after_sale_action
  const actionAlias = actionValue === 'thermal' ? 'receipt' : actionValue === 'pdf' ? 'a4' : actionValue === 'ask' || actionValue === 'none' ? 'receipt' : actionValue
  const afterSaleAction = oneOf(actionAlias, ['receipt', 'a4', 'both'] as const, printMode === 'pdf' ? 'a4' : printMode === 'both' ? 'both' : 'receipt')
  const thermalDensity = oneOf(branch.thermal_density, THERMAL_DENSITIES, 'standard')
  const templateId = oneOf(branch.a4_template_id, Object.keys(A4_TEMPLATE_REGISTRY) as A4TemplateId[], 'classic')
  const canonicalHeadingMode = oneOf(canonicalBranding.heading_mode, ['branch', 'custom'] as const, 'branch')
  const canonicalFooterField = has(footer, 'message') || has(footer, 'footer_note')
  const footerValue = text(footer.message, text(footer.footer_note, canonicalFooterField ? null : branch.receipt_footer ?? null))

  return {
    invoiceLanguage: language,
    printMode,
    preservedSettings: Object.keys(preservedSettings).length > 0 ? preservedSettings : undefined,
    presentation: {
      schema_version: 1,
      identity: {
        display_heading: canonicalHeadingMode === 'custom'
          ? nonEmptyText(canonicalBranding.custom_heading, null)
          : text(canonicalBranding.custom_heading, text(identity.display_heading, branchHeading)),
        display_subheading: text(canonicalBranding.subheading, text(identity.display_subheading, branch.invoice_display_subheading ?? null)),
        custom_display_name: canonicalHeadingMode === 'custom'
          ? nonEmptyText(canonicalBranding.custom_heading, text(identity.custom_display_name, null))
          : text(identity.custom_display_name, branch.display_name ?? branch.name ?? null),
        show_company_name: bool(canonicalBranding.show_company_name, bool(identity.show_company_name, true)),
        // The resolved primary heading is the only branch/custom heading. A
        // second branch line would duplicate it in every renderer, so branch
        // visibility is presentation-disabled after resolution.
        show_branch_name: false,
        heading_mode: canonicalHeadingMode,
      },
      contact: {
        phone: nonEmptyText(contact.phone_override, nonEmptyText(contact.phone, branch.phone ?? null)),
        email: text(contact.email, has(contact, 'email') ? null : branch.email ?? null),
        website: text(contact.website, has(contact, 'website') ? null : branch.website ?? null),
        show_phone: bool(contact.show_phone, !!branch.phone),
        show_email: bool(contact.show_email, branch.show_email ?? !!branch.email),
        show_website: bool(contact.show_website, branch.show_website ?? !!branch.website),
        address_override: nonEmptyText(contact.address_override, branch.address ?? null), show_address: bool(contact.show_address, true),
      },
      footer: {
        thank_you_message: text(footer.thank_you_message, null),
        footer_note: footerValue,
        refund_note: text(footer.refund_note, null), bold: !!footerValue,
        show_thank_you: bool(footer.show_thank_you, false),
        show_footer: bool(footer.show_footer, !!footerValue && (canonicalFooterField ? true : branch.show_footer ?? true)),
        show_refund_note: bool(footer.show_refund_note, false),
      },
      logo: {
        visible: bool(canonicalBranding.logo_path !== undefined ? true : logo.visible, branch.show_logo ?? true) && (text(canonicalBranding.logo_path, text(logo.asset_path, branch.logo_url ?? null)) !== null),
        asset_path: text(canonicalBranding.logo_path, text(logo.asset_path, branch.logo_url ?? null)),
        asset_version: positiveInt(logo.asset_version, positiveInt(branch.logo_asset_version, 1)),
        size: oneOf(canonicalBranding.logo_size, LOGO_SIZES, oneOf(logo.size, LOGO_SIZES, 'medium')),
      },
      thermal: {
        width: oneOf(thermal.width, THERMAL_WIDTHS, '80mm'),
        density: oneOf(thermal.density, THERMAL_DENSITIES, thermalDensity),
        qr_size: oneOf(thermal.qr_size === 'medium' ? 'standard' : thermal.qr_size, QR_SIZES, 'standard'), qr_alignment: 'center',
        wrap_item_names: bool(thermal.wrap_item_names, true),
        show_cash_change: bool(thermal.show_cash_change, branch.show_cash_change ?? true),
      },
      a4: {
        template_id: oneOf(a4.template_id ?? a4.theme, Object.keys(A4_TEMPLATE_REGISTRY) as A4TemplateId[], templateId),
        template_version: 1,
        header_style: oneOf(a4.header_style, ['standard', 'compact', 'branded'] as const, 'standard'),
        accent_color: color(a4.accent_color, DEFAULT_A4_ACCENT),
        heading_color: color(a4.heading_color, DEFAULT_A4_HEADING),
        body_color: color(a4.body_color, DEFAULT_A4_BODY),
        auto_foreground: bool(a4.auto_foreground, true),
        header_asset_path: text(a4.header_asset_path),
        header_asset_version: positiveInt(a4.header_asset_version, 1),
        header_asset_enabled: bool(a4.header_asset_enabled, false),
        show_standard_branding: bool(a4.show_standard_branding, !bool(a4.header_asset_enabled, false)),
        header_asset_fit: oneOf(a4.header_asset_fit, ['contain', 'cover'] as const, 'contain'),
        header_asset_height: typeof a4.header_asset_height === 'number' ? Math.min(A4_ARTWORK_BOUNDS.headerHeight.max, Math.max(A4_ARTWORK_BOUNDS.headerHeight.min, a4.header_asset_height)) : 28,
        header_asset_spacing: typeof a4.header_asset_spacing === 'number' ? Math.min(A4_ARTWORK_BOUNDS.headerSpacing.max, Math.max(A4_ARTWORK_BOUNDS.headerSpacing.min, a4.header_asset_spacing)) : 6,
        header_crop_top: percent(a4.header_crop_top, 0),
        header_crop_height: percent(a4.header_crop_height, 18, 1),
        footer_asset_path: text(a4.footer_asset_path),
        footer_asset_version: positiveInt(a4.footer_asset_version, 1),
        footer_asset_enabled: bool(a4.footer_asset_enabled, false),
        footer_asset_fit: oneOf(a4.footer_asset_fit, ['contain', 'cover'] as const, 'contain'),
        footer_asset_height: typeof a4.footer_asset_height === 'number' ? Math.min(A4_ARTWORK_BOUNDS.footerHeight.max, Math.max(A4_ARTWORK_BOUNDS.footerHeight.min, a4.footer_asset_height)) : 10,
        footer_asset_spacing: typeof a4.footer_asset_spacing === 'number' ? Math.min(A4_ARTWORK_BOUNDS.footerSpacing.max, Math.max(A4_ARTWORK_BOUNDS.footerSpacing.min, a4.footer_asset_spacing)) : 4,
        footer_crop_top: percent(a4.footer_crop_top, 92),
        footer_crop_height: percent(a4.footer_crop_height, 8, 1),
        artwork_scope: oneOf(a4.artwork_scope, ['selected', 'all'] as const, 'all'),
        artwork_template_id: oneOf(a4.artwork_template_id, Object.keys(A4_TEMPLATE_REGISTRY) as A4TemplateId[], oneOf(a4.template_id ?? a4.theme, Object.keys(A4_TEMPLATE_REGISTRY) as A4TemplateId[], templateId)),
      },
      after_sale_action: afterSaleAction,
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
    a4: {
      template_id: 'classic',
      template_version: 1,
      header_style: 'standard',
      accent_color: DEFAULT_A4_ACCENT,
      heading_color: DEFAULT_A4_HEADING,
      body_color: DEFAULT_A4_BODY,
      auto_foreground: true,
      header_asset_path: null,
      header_asset_version: 1,
      header_asset_enabled: false,
      show_standard_branding: true,
      header_asset_fit: 'contain',
      header_asset_height: 28,
      header_asset_spacing: 6,
      header_crop_top: 0,
      header_crop_height: 18,
      footer_asset_path: null,
      footer_asset_version: 1,
      footer_asset_enabled: false,
      footer_asset_fit: 'contain',
      footer_asset_height: 10,
      footer_asset_spacing: 4,
      footer_crop_top: 92,
      footer_crop_height: 8,
      artwork_scope: 'all',
      artwork_template_id: 'classic',
    },
  }
}

export function immutableLogoObjectPath(tenantId: string, branchId: string, assetVersion: number, extension: 'png' | 'jpg' | 'jpeg' | 'webp') {
  if (!Number.isSafeInteger(assetVersion) || assetVersion < 1) throw new Error('Invalid logo asset version')
  return `invoice-branding/${tenantId}/${branchId}/${assetVersion}/logo.${extension}`
}

export function invoiceArtworkObjectPath(
  tenantId: string,
  branchId: string,
  assetId: string,
  region: 'header' | 'footer',
  extension: 'png' | 'jpg' | 'jpeg' | 'webp',
) {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(branchId) || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    throw new Error('Invalid invoice artwork identity')
  }
  return `tenant/${tenantId}/branch/${branchId}/invoice-artwork/${assetId}/${region}.${extension}`
}
