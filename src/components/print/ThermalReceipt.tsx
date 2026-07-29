import type { CSSProperties, ReactNode } from 'react'
import { RiyalSymbol } from '@/components/ui/RiyalSymbol'
import { documentFontFamily, documentLabel, documentLabelLines, documentNames, documentPaymentLabel, normalizeDocumentLanguage } from '@/localization/documents'
import { buildPresentationDocument, formatDocumentMoney, formatDocumentQuantity, type DocumentViewModel } from '@/lib/invoices/documentViewModel'
import { normalizeInvoiceSettings } from '@/lib/invoices/presentationSettings'
import { buildVisibleTotals } from '@/lib/invoices/visibleTotals'

export interface ThermalRenderOptions {
  /** An already-rendered image of the model's stored/sample QR reference. Never a payload to regenerate here. */
  readonly qrImageUrl?: string | null
  readonly id?: string
  readonly preview?: boolean
  readonly sampleLabel?: string | null
  readonly nonFiscalDemo?: boolean
}

export interface ThermalReceiptModelProps { readonly model: DocumentViewModel; readonly options?: ThermalRenderOptions }

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
  compact: { font: '9.5px', small: '8px', gap: '3px', padding: '3mm', line: 1.25 },
  standard: { font: '10.5px', small: '8.8px', gap: '5px', padding: '3.5mm', line: 1.38 },
  detailed: { font: '11px', small: '9.2px', gap: '7px', padding: '4mm', line: 1.48 },
} as const

export const THERMAL_RECEIPT_LAYOUTS = {
  compact: { id: 'compact-retail', header: 'centered-compact', metadata: 'inline-strip', items: 'dense-rows', totals: 'grand-total-led', qr: 'center-below-totals', footer: 'short' },
  standard: { id: 'structured-detail', header: 'seller-columns', metadata: 'bordered-summary', items: 'divided-rows', totals: 'accounting-block', qr: 'responsive-side', footer: 'contact-rich' },
  detailed: { id: 'branded-modern', header: 'framed-brand', metadata: 'identity-card', items: 'grouped-cards', totals: 'payment-highlight', qr: 'verification-panel', footer: 'branded-thanks' },
} as const

function Money({ value, model }: { value: number; model: DocumentViewModel }) {
  return <bdi className="thermal-money" dir="ltr"><RiyalSymbol /> {formatDocumentMoney(value, model)}</bdi>
}

function Row({ label, children, strong = false }: { label: ReactNode; children: ReactNode; strong?: boolean }) {
  return <div className={`thermal-row ${strong ? 'thermal-row-strong' : ''}`}><span>{label}</span><span className="thermal-value">{children}</span></div>
}

function Rule() { return <div className="thermal-rule" aria-hidden="true" /> }

function names(model: DocumentViewModel, en: string | null, ar: string | null) {
  return documentNames(model.identity.language, en, ar)
}

function QuantityWithUnit({
  quantity,
  item,
  model,
}: {
  quantity: number
  item: DocumentViewModel['items'][number]
  model: DocumentViewModel
}) {
  return (
    <>
      <bdi dir="ltr">{formatDocumentQuantity(quantity, model)}</bdi>
      {names(model, item.unitName, item.unitNameAr).map((unit, index) => (
        <span key={`${unit}-${index}`} dir="auto"> {unit}</span>
      ))}
    </>
  )
}

export function thermalPrintCss(width: '58mm' | '80mm') {
  const content = width === '58mm' ? '52mm' : '72mm'
  return `@media print { @page { size: ${width} auto; margin: 0; } html, body { width: ${width}; margin: 0 !important; padding: 0 !important; } body > * { visibility: hidden !important; } .thermal-receipt, .thermal-receipt * { visibility: visible !important; } .thermal-receipt { position: absolute !important; inset: 0 auto auto 0 !important; width: ${width} !important; max-width: ${width} !important; min-height: 0 !important; margin: 0 !important; border: 0 !important; box-shadow: none !important; } .thermal-receipt__paper { width: ${content} !important; max-width: ${content} !important; } }`
}

/** Single snapshot-driven thermal renderer for preview, browser and Electron print paths. */
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
    buyer: { name: props.customerName ?? null, nameAr: props.customerNameAr ?? null, vatNumber: props.buyerVatNumber ?? null, address: null, addressAr: null, identifierType: null, identifierValue: null, type: props.isStandardInvoice ? 'business' : 'individual' },
    items: itemRows,
    totals: { currency: 'SAR', subtotal: Number(props.subtotal) || 0, discount: Number(props.discountAmount ?? 0) || 0, taxableAmount: Number(props.subtotal) || 0, vat: Number(props.taxAmount) || 0, total: Number(props.total) || 0, paid: isCredit ? 0 : totalPaid, refunded: isCredit ? totalPaid : 0, balance: isCredit ? null : (Number(props.total) || 0) - totalPaid },
    payments,
    compliance: { qr: { source: 'unavailable', reference: null }, xmlState: 'unavailable', originalDocument: { id: null, number: props.originalInvoiceNumber ?? null }, creditReason: props.creditReason ?? null },
  })
}

export default function ThermalReceipt(props: ThermalReceiptProps) {
  const model = 'model' in props ? props.model : legacyModel(props)
  const options: ThermalRenderOptions = 'model' in props
    ? props.options ?? {}
    : { preview: props.preview, qrImageUrl: props.qrDataUrl ?? null }
  const { presentation, identity, seller, buyer, totals, payments } = model
  const layout = density[presentation.thermal.density] ?? density.standard
  const receiptTheme = THERMAL_RECEIPT_LAYOUTS[presentation.thermal.density] ?? THERMAL_RECEIPT_LAYOUTS.standard
  const is58 = presentation.thermal.width === '58mm'
  const isDetailed = presentation.thermal.density === 'detailed'
  const isCompact = presentation.thermal.density === 'compact'
  const isCredit = identity.kind === 'credit_note'
  const isDebit = identity.kind === 'debit_note'
  const isAdjustment = isCredit || isDebit
  const isStandard = identity.invoiceType === 'standard'
  const title = isCredit
    ? (isStandard ? 'taxCreditNote' : 'simplifiedTaxCreditNote')
    : isDebit
    ? (isStandard ? 'taxDebitNote' : 'simplifiedTaxDebitNote')
    : (isStandard ? 'standardTaxInvoice' : 'simplifiedTaxInvoice')
  const titleLines = options.nonFiscalDemo
    ? ['DEMO — NOT A TAX INVOICE', 'تجريبي — ليست فاتورة ضريبية']
    : documentLabelLines(identity.language, title)
  const paymentKind = payments.length > 1 ? 'split' : payments[0]?.method ?? 'other'
  const mandatoryBuyer = isStandard || !!buyer.vatNumber
  const logoUrl = presentation.logo.previewUrl ?? presentation.logo.assetPath
  const presentationAddress = presentation.contact.address
  const qrMm = presentation.thermal.qrSize === 'small' ? 22 : presentation.thermal.qrSize === 'large' ? 31 : 26
  const logoMm = presentation.logo.size === 'small' ? 9 : presentation.logo.size === 'large' ? 18 : 14
  const contentMm = is58 ? 52 : 72
  const optionalFooter = [presentation.footer.thankYouVisible ? presentation.footer.thankYou : null, presentation.footer.footerVisible ? presentation.footer.footer : null, presentation.footer.refundVisible ? presentation.footer.refund : null].filter(Boolean)
  const visibleTotals = buildVisibleTotals(model)
  const time = new Intl.DateTimeFormat('en-SA', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(identity.issueTimestamp))
  const date = new Intl.DateTimeFormat(model.format.dateLocale, { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(identity.issueTimestamp))

  return <div id={options.id ?? 'thermal-receipt'} className={`thermal-receipt thermal-receipt--${presentation.thermal.width} thermal-receipt--${presentation.thermal.density} thermal-theme--${receiptTheme.id}`} data-receipt-layout={receiptTheme.id} data-qr-placement={receiptTheme.qr} dir={identity.direction} lang={identity.language === 'both' ? undefined : identity.language} style={{ display: options.preview ? 'block' : 'none', '--thermal-paper-width': presentation.thermal.width, '--thermal-content-width': `${contentMm}mm`, '--thermal-font': layout.font, '--thermal-small': layout.small, '--thermal-gap': layout.gap, '--thermal-padding': layout.padding, '--thermal-line': layout.line } as CSSProperties}>
    <style>{thermalPrintCss(presentation.thermal.width)}</style>
    <article className="thermal-receipt__paper" style={{ fontFamily: documentFontFamily(identity.language) }}>
      {options.sampleLabel && <div className="thermal-sample">{options.sampleLabel}</div>}
      {presentation.logo.visible && logoUrl && <div className="thermal-logo" style={{ '--thermal-logo-height': `${logoMm}mm` } as CSSProperties}><img src={logoUrl} alt="" onError={event => { event.currentTarget.style.display = 'none' }} /></div>}
      <header className="thermal-header">
        {seller.displayHeading && <div className="thermal-heading" dir="auto">{seller.displayHeading}</div>}
        {seller.displaySubheading && <div className="thermal-subheading" dir="auto">{seller.displaySubheading}</div>}
        {seller.company.visible && names(model, seller.registeredName, seller.registeredNameAr).map((name, index) => <div key={`${name}-${index}`} className="thermal-legal-name" dir="auto">{name}</div>)}
        {!isCompact && seller.branch.visible && names(model, seller.branch.name, seller.branch.nameAr).map((name, index) => <div key={`${name}-${index}`} className="thermal-branch" dir="auto">{name}</div>)}
        <section className="thermal-legal-info"><div className="thermal-section-label">{documentLabel(identity.language, 'seller')}</div>{names(model, seller.registeredName, seller.registeredNameAr).map((name, index) => <div key={`${name}-${index}`} className="thermal-legal-supplier" dir="auto">{name}</div>)}{seller.registeredAddress && <div className="thermal-address" dir="auto">{seller.registeredAddress}</div>}{seller.vatNumber && <div>{documentLabel(identity.language, 'vatNumber')}: <bdi dir="ltr">{seller.vatNumber}</bdi></div>}{seller.registrationNumber && <div>{seller.registrationType === 'CR' ? documentLabel(identity.language, 'crNumber') : seller.registrationType ?? documentLabel(identity.language, 'identifier')}: <bdi dir="ltr">{seller.registrationNumber}</bdi></div>}</section>
        {presentation.contact.addressVisible && presentationAddress && presentationAddress !== seller.registeredAddress && <div className="thermal-address thermal-address--presentation" dir="auto">{presentationAddress}</div>}
        {!isCompact && presentation.contact.phoneVisible && presentation.contact.phone && <div>{documentLabel(identity.language, 'phone')}: <bdi dir="ltr">{presentation.contact.phone}</bdi></div>}
        {isDetailed && presentation.contact.websiteVisible && presentation.contact.website && <div><bdi dir="ltr">{presentation.contact.website}</bdi></div>}
        {isDetailed && presentation.contact.emailVisible && presentation.contact.email && <div><bdi dir="ltr">{presentation.contact.email}</bdi></div>}
      </header>
      <Rule />
      <section className="thermal-title">{titleLines.map((line, index) => <div key={`${line}-${index}`} className={index === 0 ? 'thermal-title-main' : 'thermal-title-sub'} dir="auto">{line}</div>)}</section>
      <section className="thermal-meta"><div>{documentLabel(identity.language, isCredit ? 'creditNoteNumber' : isDebit ? 'debitNoteNumber' : 'invoiceNumber')}: <bdi dir="ltr">{identity.number}</bdi></div><div>{documentLabel(identity.language, 'date')}: <bdi dir="ltr">{date}</bdi></div><div>{documentLabel(identity.language, 'time')}: <bdi dir="ltr">{time}</bdi></div>{isAdjustment && model.compliance.originalDocument.number && <div>{documentLabel(identity.language, 'originalInvoice')}: <bdi dir="ltr">{model.compliance.originalDocument.number}</bdi></div>}{isAdjustment && model.compliance.creditReason && <div>{documentLabel(identity.language, 'reason')}: <span dir="auto">{model.compliance.creditReason}</span></div>}</section>
      {(mandatoryBuyer || (!isCompact && buyer.name)) && <><Rule /><section className="thermal-buyer"><div className="thermal-section-label">{documentLabel(identity.language, 'customer')}</div>{names(model, buyer.name, buyer.nameAr).map((name, index) => <div key={`${name}-${index}`} dir="auto">{name}</div>)}{isDetailed && names(model, buyer.address, buyer.addressAr).map((value, index) => <div key={`${value}-${index}`} dir="auto">{value}</div>)}{buyer.vatNumber && <div>{documentLabel(identity.language, 'customerVatNumber')}: <bdi dir="ltr">{buyer.vatNumber}</bdi></div>}{buyer.identifierValue && <div>{buyer.identifierType ?? documentLabel(identity.language, 'identifier')}: <bdi dir="ltr">{buyer.identifierValue}</bdi></div>}</section></>}
      <Rule />
      <section className={`thermal-items ${is58 ? 'thermal-items--stacked' : 'thermal-items--wide'}`}>{model.items.map((item, index) => <article className="thermal-item" key={`${item.description}-${index}`}><div className={`thermal-item-name ${presentation.thermal.wrapItemNames ? '' : 'thermal-item-name--truncate'}`}>{names(model, item.description, item.descriptionAr).map((name, itemIndex) => <div key={`${name}-${itemIndex}`} dir="auto">{name}</div>)}</div><div className="thermal-item-values"><span><QuantityWithUnit quantity={item.quantity} item={item} model={model} /> <span aria-hidden="true">×</span> <Money value={item.unitPrice} model={model} /></span><span><Money value={item.lineTotal} model={model} /></span></div>{(isStandard || isAdjustment || item.discount > 0) && <div className="thermal-item-detail">{(isStandard || isAdjustment) && <span>{documentLabel(identity.language, 'vatAmount')} <bdi dir="ltr">{formatDocumentQuantity(item.vatRate, model)}%</bdi></span>}{item.discount > 0 && <span>{documentLabel(identity.language, 'discount')}: <Money value={item.discount} model={model} /></span>}{isCredit && item.creditedQuantity != null && <span>{documentLabel(identity.language, 'quantity')}: <QuantityWithUnit quantity={item.creditedQuantity} item={item} model={model} /></span>}</div>}</article>)}</section>
      <Rule />
      <section className="thermal-totals">{visibleTotals.map(row => <Row key={row.key} label={row.label} strong={row.emphasized}><Money value={row.value} model={model} /></Row>)}</section>
      <><Rule /><section className="thermal-payments"><div>{documentLabel(identity.language, isCredit ? 'refundMethod' : 'paymentMethod')}: <strong>{documentPaymentLabel(identity.language, paymentKind)}</strong></div>{(isDetailed || payments.length > 1) && payments.map((payment, index) => <Row key={`${payment.method}-${index}`} label={documentPaymentLabel(identity.language, payment.method)}><Money value={payment.amount} model={model} /></Row>)}{presentation.thermal.showCashChange && payments.length === 1 && payments[0]?.method === 'cash' && payments[0]?.cashTendered != null && Math.abs((payments[0]?.cashTendered ?? 0) - totals.total) > 0.005 && <Row label={documentLabel(identity.language, 'received')}><Money value={payments[0].cashTendered} model={model} /></Row>}{presentation.thermal.showCashChange && payments.length === 1 && payments[0]?.method === 'cash' && (payments[0]?.change ?? 0) > 0 && <Row label={documentLabel(identity.language, 'change')}><Money value={payments[0].change ?? 0} model={model} /></Row>}</section></>
      <footer className="thermal-footer">{!options.nonFiscalDemo && <div className="thermal-qr" style={{ width: `${qrMm}mm`, textAlign: 'center' }}>{options.qrImageUrl ? <img src={options.qrImageUrl} alt={documentLabel(identity.language, 'qrCode')} dir="ltr" /> : <div className="thermal-qr-placeholder">{documentLabel(identity.language, 'qrCode')}</div>}{documentLabelLines(identity.language, 'scanToVerify').map((line, index) => <div key={`${line}-${index}`} dir="auto">{line}</div>)}</div>}{optionalFooter.length > 0 && <><div className="thermal-footer-divider" aria-hidden="true" /><div className={`thermal-footer-copy ${model.presentation.footer.bold || optionalFooter.length > 0 ? 'font-bold' : ''}`} style={{ fontSize: 'calc(var(--thermal-small) + 1px)', textAlign: 'center' }}>{optionalFooter.map((line, index) => <div key={`${line}-${index}`} dir="auto">{line}</div>)}</div></>}</footer><div className="thermal-cut" aria-hidden="true" />
    </article>
  </div>
}
