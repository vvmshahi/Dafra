import { documentDirection, normalizeDocumentLanguage, type DocumentLanguage } from '@/localization/documents'
import { resolveHistoricalA4Template } from './presentationSettings'
import type { A4HeaderStyle, InvoicePresentationSettings, LogoAssetSize, QrSize, QrAlignment, ThermalDensity, ThermalWidth } from '@/types/database'

export type DocumentKind = 'invoice' | 'credit_note'
export type DocumentFidelity = 'exact_snapshot' | 'best_effort' | 'sample'

export interface DocumentViewModel {
  readonly source: 'snapshot_v2' | 'snapshot_v1' | 'legacy' | 'preview'
  readonly identity: Readonly<{
    kind: DocumentKind
    invoiceType: string
    number: string
    uuid: string | null
    issueTimestamp: string
    language: DocumentLanguage
    direction: 'ltr' | 'rtl'
    snapshotVersion: 1 | 2 | null
    legacy: boolean
    fidelity: DocumentFidelity
  }>
  readonly seller: Readonly<{
    registeredName: string
    registeredNameAr: string | null
    vatNumber: string
    registrationType: string | null
    registrationNumber: string | null
    registeredAddress: string | null
    displayHeading: string | null
    displaySubheading: string | null
    customDisplayName: string | null
    company: Readonly<{ name: string; nameAr: string | null; visible: boolean }>
    branch: Readonly<{ name: string | null; nameAr: string | null; visible: boolean }>
    renderName: string
    renderNameAr: string | null
  }>
  readonly presentation: Readonly<{
    contact: Readonly<{ phone: string | null; email: string | null; website: string | null; addressVisible: boolean; phoneVisible: boolean; emailVisible: boolean; websiteVisible: boolean }>
    footer: Readonly<{ thankYou: string | null; footer: string | null; refund: string | null; thankYouVisible: boolean; footerVisible: boolean; refundVisible: boolean }>
    logo: Readonly<{ visible: boolean; assetPath: string | null; assetVersion: number | null; size: LogoAssetSize | null; previewUrl: string | null }>
    thermal: Readonly<{ width: ThermalWidth; density: ThermalDensity; qrSize: QrSize; qrAlignment: QrAlignment; wrapItemNames: boolean; showCashChange: boolean }>
    printMode: 'thermal' | 'pdf' | 'both'
  }>
  readonly buyer: Readonly<{ name: string | null; nameAr: string | null; vatNumber: string | null; address: string | null; type: string | null }>
  readonly items: readonly Readonly<{ description: string; descriptionAr: string | null; quantity: number; unitPrice: number; discount: number; taxableAmount: number; vatRate: number; vatAmount: number; lineTotal: number; creditedQuantity: number | null }>[]
  readonly totals: Readonly<{ currency: 'SAR'; subtotal: number; discount: number; taxableAmount: number; vat: number; total: number; paid: number; refunded: number; balance: number | null }>
  readonly payments: Readonly<{ method: string; amount: number; cashTendered: number | null; change: number | null; reference: string | null }>[]
  readonly compliance: Readonly<{ qr: Readonly<{ source: 'stored_reference' | 'sample' | 'unavailable'; reference: string | null }>; xmlState: 'available' | 'unavailable'; originalDocument: Readonly<{ id: string | null; number: string | null }>; creditReason: string | null }>
  readonly template: Readonly<{ rendererFamily: 'thermal' | 'a4'; requestedId: string; requestedVersion: number; resolvedId: string; resolvedVersion: number; fallback: boolean; fallbackReason: string | null; headerStyle: A4HeaderStyle | null }>
  readonly format: Readonly<{ currency: 'SAR'; minimumFractionDigits: 2; maximumFractionDigits: 2; quantityMaximumFractionDigits: 3; numberDirection: 'ltr'; dateLocale: 'en-SA' | 'ar-SA' }>
}

export interface DocumentPresentationInput {
  readonly settings: InvoicePresentationSettings
  readonly language: DocumentLanguage
  readonly printMode: 'thermal' | 'pdf' | 'both'
  readonly registeredName: string
  readonly registeredNameAr: string | null
  readonly vatNumber: string
  readonly registrationType: string | null
  readonly registrationNumber: string | null
  readonly registeredAddress: string | null
  readonly branchName: string | null
  readonly branchNameAr: string | null
  readonly logoPreviewUrl?: string | null
}

export function buildPresentationDocument(input: DocumentPresentationInput, base: Omit<DocumentViewModel, 'seller' | 'presentation' | 'template' | 'format'>): DocumentViewModel {
  const { settings, language } = input
  const template = resolveHistoricalA4Template(settings.a4.template_id, settings.a4.template_version)
  const displayName = settings.identity.display_heading || settings.identity.custom_display_name || (settings.identity.show_company_name ? input.registeredName : input.branchName) || null
  const displayNameAr = settings.identity.display_subheading || (settings.identity.show_company_name ? input.registeredNameAr : input.branchNameAr) || null
  return immutable({
    ...base,
    identity: { ...base.identity, language, direction: documentDirection(language) },
    seller: {
      registeredName: settings.identity.show_company_name ? input.registeredName : '', registeredNameAr: settings.identity.show_company_name ? input.registeredNameAr : null, vatNumber: input.vatNumber,
      registrationType: input.registrationType, registrationNumber: input.registrationNumber, registeredAddress: input.registeredAddress,
      displayHeading: settings.identity.display_heading, displaySubheading: settings.identity.display_subheading, customDisplayName: settings.identity.custom_display_name,
      company: { name: input.registeredName, nameAr: input.registeredNameAr, visible: settings.identity.show_company_name },
      branch: { name: input.branchName, nameAr: input.branchNameAr, visible: settings.identity.show_branch_name },
      renderName: displayName, renderNameAr: displayNameAr,
    },
    presentation: {
      contact: { phone: settings.contact.phone, email: settings.contact.email, website: settings.contact.website, addressVisible: settings.contact.show_address, phoneVisible: settings.contact.show_phone, emailVisible: settings.contact.show_email, websiteVisible: settings.contact.show_website },
      footer: { thankYou: settings.footer.thank_you_message, footer: settings.footer.footer_note, refund: settings.footer.refund_note, thankYouVisible: settings.footer.show_thank_you, footerVisible: settings.footer.show_footer, refundVisible: settings.footer.show_refund_note },
      logo: { visible: settings.logo.visible, assetPath: settings.logo.asset_path, assetVersion: settings.logo.asset_version, size: settings.logo.size, previewUrl: input.logoPreviewUrl ?? null },
      thermal: { width: settings.thermal.width, density: settings.thermal.density, qrSize: settings.thermal.qr_size, qrAlignment: settings.thermal.qr_alignment, wrapItemNames: settings.thermal.wrap_item_names, showCashChange: settings.thermal.show_cash_change },
      printMode: input.printMode,
    },
    template: { rendererFamily: 'a4', requestedId: template.requestedId, requestedVersion: template.requestedVersion, resolvedId: template.resolvedId, resolvedVersion: template.resolvedVersion, fallback: !template.exact, fallbackReason: template.exact ? null : 'unknown_historical_template', headerStyle: settings.a4.header_style },
    format: { currency: 'SAR', minimumFractionDigits: 2, maximumFractionDigits: 2, quantityMaximumFractionDigits: 3, numberDirection: 'ltr', dateLocale: language === 'ar' ? 'ar-SA' : 'en-SA' },
  })
}

export function formatDocumentMoney(value: number, model: DocumentViewModel): string {
  return value.toLocaleString(model.format.dateLocale, { minimumFractionDigits: model.format.minimumFractionDigits, maximumFractionDigits: model.format.maximumFractionDigits })
}

export function formatDocumentQuantity(value: number, model: DocumentViewModel): string {
  return value.toLocaleString(model.format.dateLocale, { maximumFractionDigits: model.format.quantityMaximumFractionDigits })
}

function immutable<T>(value: T): T {
  const freeze = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== 'object' || Object.isFrozen(candidate)) return candidate
    Object.values(candidate as Record<string, unknown>).forEach(freeze)
    return Object.freeze(candidate)
  }
  return freeze(value) as T
}

export const documentLanguage = (value: string | null | undefined): DocumentLanguage => normalizeDocumentLanguage(value)
