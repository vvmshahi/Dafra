import type { CSSProperties } from 'react'
import { documentFontFamily, normalizeDocumentLanguage } from '@/localization/documents'
import { buildPresentationDocument, type DocumentViewModel } from '@/lib/invoices/documentViewModel'
import { normalizeInvoiceSettings } from '@/lib/invoices/presentationSettings'
import ThermalReceiptCompositions from './ThermalReceiptCompositions'

export interface ThermalRenderOptions {
  /** An already-rendered image of the model's stored/sample QR reference. Never a payload to regenerate here. */
  readonly qrImageUrl?: string | null
  readonly id?: string
  readonly preview?: boolean
  readonly sampleLabel?: string | null
  readonly nonFiscalDemo?: boolean
  /** Preview-only unavailable state. Runtime QR eligibility remains authoritative upstream. */
  readonly qrUnavailable?: boolean
}

export interface ThermalReceiptModelProps {
  readonly model: DocumentViewModel
  readonly options?: ThermalRenderOptions
}

export interface ThermalItem {
  readonly name: string
  readonly nameAr?: string | null
  readonly qty: number
  readonly unitName?: string | null
  readonly unitNameAr?: string | null
  readonly unitCode?: string | null
  readonly baseQuantity?: number | null
  readonly baseUnitName?: string | null
  readonly baseUnitNameAr?: string | null
  readonly unitPrice: number
  readonly lineTotal: number
  readonly subtotal?: number
  readonly taxAmount?: number
  readonly total?: number
  readonly taxRate?: number
  readonly taxCategory?: string | null
}

interface ThermalPayment {
  readonly method: string
  readonly amount: number
  readonly amount_received?: number | null
  readonly change_amount?: number | null
  readonly amountReceived?: number | null
  readonly changeAmount?: number | null
}

/** Compatibility input for the pre-view-model callers restored in V1. */
export interface LegacyThermalReceiptProps {
  readonly preview?: boolean
  readonly documentLanguage?: string | null
  readonly printMode?: 'thermal' | 'pdf' | 'both'
  readonly businessNameAr?: string | null
  readonly businessNameEn: string
  readonly logoUrl?: string | null
  readonly showLogo?: boolean
  readonly branchName?: string | null
  readonly branchNameAr?: string | null
  readonly address?: string | null
  readonly addressAr?: string | null
  readonly vatNumber?: string | null
  readonly phone?: string | null
  readonly website?: string | null
  readonly showWebsite?: boolean
  readonly email?: string | null
  readonly showEmail?: boolean
  readonly invoiceNumber: string
  readonly date?: string
  readonly time?: string
  readonly issueTimestamp?: string | null
  readonly cashierName?: string | null
  readonly items: readonly ThermalItem[]
  readonly subtotal: number
  readonly discountAmount?: number
  readonly taxAmount: number
  readonly total: number
  readonly paymentMethod?: string
  readonly payments?: readonly ThermalPayment[]
  readonly cashReceived?: number | null
  readonly change?: number | null
  readonly showCashChange?: boolean
  readonly customerName?: string | null
  readonly customerNameAr?: string | null
  readonly buyerVatNumber?: string | null
  readonly isStandardInvoice?: boolean
  readonly documentType?: 'invoice' | 'credit_note'
  readonly originalInvoiceNumber?: string | null
  readonly creditReason?: string | null
  readonly qrDataUrl?: string | null
  readonly receiptFooter?: string | null
  readonly showFooter?: boolean
}

export type ThermalReceiptProps = ThermalReceiptModelProps | LegacyThermalReceiptProps

const density = {
  classic: { font: '10.5px', small: '8.8px', gap: '5px', padding: '3.5mm', line: 1.38 },
  compact: { font: '9.5px', small: '8px', gap: '3px', padding: '3mm', line: 1.25 },
  standard: { font: '10.5px', small: '8.8px', gap: '5px', padding: '3.5mm', line: 1.38 },
  detailed: { font: '11px', small: '9.2px', gap: '7px', padding: '4mm', line: 1.48 },
} as const

export const THERMAL_RECEIPT_LAYOUTS = {
  classic: { id: 'classic', header: 'original-centered', metadata: 'original-list', items: 'original-linear-rows', totals: 'original-stacked', qr: 'original-center-footer', footer: 'original-message' },
  compact: { id: 'compact-retail', header: 'centered-compact', metadata: 'inline-strip', items: 'dense-rows', totals: 'grand-total-led', qr: 'center-below-totals', footer: 'short' },
  standard: { id: 'structured-detail', header: 'seller-columns', metadata: 'bordered-summary', items: 'divided-rows', totals: 'accounting-block', qr: 'responsive-side', footer: 'contact-rich' },
  detailed: { id: 'branded-modern', header: 'framed-brand', metadata: 'identity-card', items: 'grouped-cards', totals: 'payment-highlight', qr: 'verification-panel', footer: 'branded-thanks' },
} as const

export function thermalPrintCss(width: '58mm' | '80mm') {
  const content = width === '58mm' ? '52mm' : '72mm'
  return `@media print { @page { size: ${width} auto; margin: 0; } html, body { width: ${width}; margin: 0 !important; padding: 0 !important; } body > * { visibility: hidden !important; } .thermal-receipt, .thermal-receipt * { visibility: visible !important; } .thermal-receipt { position: absolute !important; inset: 0 auto auto 0 !important; width: ${width} !important; max-width: ${width} !important; min-height: 0 !important; margin: 0 !important; border: 0 !important; box-shadow: none !important; } .thermal-receipt__paper { width: ${content} !important; max-width: ${content} !important; } }`
}

function legacyModel(props: LegacyThermalReceiptProps): DocumentViewModel {
  const language = normalizeDocumentLanguage(props.documentLanguage)
  const payments = (props.payments ?? []).map(payment => ({
    method: payment.method,
    amount: Number(payment.amount) || 0,
    cashTendered: payment.method === 'cash' ? payment.amount_received ?? payment.amountReceived ?? props.cashReceived ?? null : null,
    change: payment.method === 'cash' ? payment.change_amount ?? payment.changeAmount ?? props.change ?? null : null,
    reference: null,
  }))
  if (payments.length === 0 && props.paymentMethod) {
    payments.push({ method: props.paymentMethod, amount: Number(props.total) || 0, cashTendered: props.cashReceived ?? null, change: props.change ?? null, reference: null })
  }
  const settings = normalizeInvoiceSettings({
    invoice_language: language,
    print_mode: props.printMode ?? 'thermal',
    presentation_settings: {
      identity: { display_heading: null, display_subheading: null, custom_display_name: null, show_company_name: true, show_branch_name: true },
      contact: { phone: props.phone ?? null, email: props.email ?? null, website: props.website ?? null, show_phone: !!props.phone, show_email: !!props.showEmail, show_website: !!props.showWebsite, show_address: true },
      footer: { thank_you_message: null, footer_note: props.receiptFooter ?? null, refund_note: null, show_thank_you: false, show_footer: props.showFooter ?? true, show_refund_note: false },
      logo: { visible: props.showLogo ?? true, asset_path: props.logoUrl ?? null, asset_version: 1, size: 'medium' },
      thermal: { width: '80mm', density: 'standard', qr_size: 'standard', wrap_item_names: true, show_cash_change: props.showCashChange ?? true },
      a4: { template_id: 'classic', template_version: 1, header_style: 'standard', accent_color: '#0f766e', heading_color: '#10251a', body_color: '#1f2937', auto_foreground: true, header_asset_path: null, header_asset_version: 1, header_asset_enabled: false, header_asset_fit: 'contain', header_asset_height: 28, header_asset_spacing: 6, header_crop_top: 0, header_crop_height: 18, footer_asset_path: null, footer_asset_version: 1, footer_asset_enabled: false, footer_asset_fit: 'contain', footer_asset_height: 10, footer_asset_spacing: 4, footer_crop_top: 92, footer_crop_height: 8, artwork_scope: 'all', artwork_template_id: 'classic' },
    },
  }, {
    display_name: null,
    business_name: props.businessNameEn,
    business_name_ar: props.businessNameAr ?? null,
    name: props.branchName ?? null,
    name_ar: props.branchNameAr ?? null,
    phone: props.phone ?? null,
    email: props.email ?? null,
    website: props.website ?? null,
    show_website: props.showWebsite ?? false,
    show_email: props.showEmail ?? false,
    receipt_footer: props.receiptFooter ?? null,
    show_footer: props.showFooter ?? true,
    show_cash_change: props.showCashChange ?? true,
    show_logo: props.showLogo ?? true,
    logo_url: props.logoUrl ?? null,
    invoice_language: language,
    print_mode: props.printMode ?? 'thermal',
  })
  const isCredit = props.documentType === 'credit_note'
  const itemRows = props.items.map(item => ({
    description: item.name,
    descriptionAr: item.nameAr ?? null,
    quantity: Number(item.qty) || 0,
    unitName: item.unitName ?? null,
    unitNameAr: item.unitNameAr ?? null,
    unitCode: item.unitCode ?? null,
    baseQuantity: item.baseQuantity ?? null,
    baseUnitName: item.baseUnitName ?? null,
    baseUnitNameAr: item.baseUnitNameAr ?? null,
    unitPrice: Number(item.unitPrice) || 0,
    discount: 0,
    taxableAmount: Number(item.subtotal ?? item.lineTotal) || 0,
    vatRate: 0,
    vatAmount: Number(item.taxAmount ?? 0) || 0,
    lineTotal: Number(item.lineTotal) || 0,
    creditedQuantity: isCredit ? Number(item.qty) || 0 : null,
  }))
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0)
  return buildPresentationDocument({
    settings: settings.presentation,
    language,
    printMode: settings.printMode,
    registeredName: props.businessNameEn,
    registeredNameAr: props.businessNameAr ?? null,
    vatNumber: props.vatNumber ?? '',
    registrationType: null,
    registrationNumber: null,
    registeredAddress: props.address ?? null,
    branchName: props.branchName ?? null,
    branchNameAr: props.branchNameAr ?? null,
  }, {
    source: 'legacy',
    identity: {
      kind: isCredit ? 'credit_note' : 'invoice',
      invoiceType: props.isStandardInvoice ? 'standard' : 'simplified',
      number: props.invoiceNumber,
      uuid: null,
      issueTimestamp: props.issueTimestamp ?? new Date().toISOString(),
      language,
      direction: language === 'ar' ? 'rtl' : 'ltr',
      snapshotVersion: null,
      legacy: true,
      fidelity: 'best_effort',
    },
    buyer: {
      snapshotState: props.customerName ? 'captured' : 'walk_in',
      name: props.customerName ?? null,
      nameAr: props.customerNameAr ?? null,
      vatNumber: props.buyerVatNumber ?? null,
      address: null,
      addressAr: null,
      identifierType: null,
      identifierValue: null,
      phone: null,
      type: props.isStandardInvoice ? 'business' : 'individual',
      isWalkIn: !props.customerName,
    },
    items: itemRows,
    totals: {
      currency: 'SAR',
      subtotal: Number(props.subtotal) || 0,
      discount: Number(props.discountAmount ?? 0) || 0,
      taxableAmount: Number(props.subtotal) || 0,
      vat: Number(props.taxAmount) || 0,
      total: Number(props.total) || 0,
      paid: isCredit ? 0 : totalPaid,
      refunded: isCredit ? totalPaid : 0,
      balance: isCredit ? null : (Number(props.total) || 0) - totalPaid,
    },
    payments,
    compliance: {
      qr: { source: 'unavailable', reference: null },
      xmlState: 'unavailable',
      originalDocument: { id: null, number: props.originalInvoiceNumber ?? null },
      creditReason: props.creditReason ?? null,
    },
  })
}

/** Shared entry point for preview, POS, history, dedicated print and reprint. */
export default function ThermalReceipt(props: ThermalReceiptProps) {
  const model = 'model' in props ? props.model : legacyModel(props)
  const options: ThermalRenderOptions = 'model' in props
    ? props.options ?? {}
    : { preview: props.preview, qrImageUrl: props.qrDataUrl ?? null }
  const { presentation, identity } = model
  const layout = density[presentation.thermal.density] ?? density.standard
  const receiptTheme = THERMAL_RECEIPT_LAYOUTS[presentation.thermal.density] ?? THERMAL_RECEIPT_LAYOUTS.standard
  const contentMm = presentation.thermal.width === '58mm' ? 52 : 72

  return <div
    id={options.id ?? 'thermal-receipt'}
    className={`thermal-receipt thermal-receipt--${presentation.thermal.width} thermal-receipt--${presentation.thermal.density} thermal-theme--${receiptTheme.id}`}
    data-receipt-layout={receiptTheme.id}
    data-qr-placement={receiptTheme.qr}
    dir={identity.direction}
    lang={identity.language === 'both' ? undefined : identity.language}
    style={{
      display: options.preview ? 'block' : 'none',
      '--thermal-paper-width': presentation.thermal.width,
      '--thermal-content-width': `${contentMm}mm`,
      '--thermal-font': layout.font,
      '--thermal-small': layout.small,
      '--thermal-gap': layout.gap,
      '--thermal-padding': layout.padding,
      '--thermal-line': layout.line,
    } as CSSProperties}
  >
    <style>{thermalPrintCss(presentation.thermal.width)}</style>
    <article className="thermal-receipt__paper" style={{ fontFamily: documentFontFamily(identity.language) }}>
      {options.sampleLabel && <div className="thermal-sample">{options.sampleLabel}</div>}
      <ThermalReceiptCompositions model={model} options={options} />
      <div className="thermal-cut" aria-hidden="true" />
    </article>
  </div>
}
