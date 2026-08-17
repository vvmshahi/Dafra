import type { CSSProperties, ReactNode } from 'react'
import { RiyalSymbol } from '@/components/ui/RiyalSymbol'
import { documentLabel, documentLabelLines, documentNames, documentPaymentLabel } from '@/localization/documents'
import { formatDocumentMoney, formatDocumentQuantity, type DocumentViewModel } from '@/lib/invoices/documentViewModel'
import { buildVisibleTotals } from '@/lib/invoices/visibleTotals'
import type { ThermalRenderOptions } from './ThermalReceipt'

interface ReceiptComposition {
  readonly model: DocumentViewModel
  readonly options: ThermalRenderOptions
  readonly titleLines: readonly string[]
  readonly date: string
  readonly time: string
  readonly paymentKind: string
  readonly mandatoryBuyer: boolean
  readonly logoUrl: string | null
  readonly logoMm: number
  readonly qrMm: number
  readonly optionalFooter: readonly string[]
  readonly visibleTotals: ReturnType<typeof buildVisibleTotals>
  readonly isCredit: boolean
  readonly isDebit: boolean
  readonly isAdjustment: boolean
  readonly isStandard: boolean
}

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

function QuantityWithUnit({ quantity, item, model }: { quantity: number; item: DocumentViewModel['items'][number]; model: DocumentViewModel }) {
  return <><bdi dir="ltr">{formatDocumentQuantity(quantity, model)}</bdi>{names(model, item.unitName, item.unitNameAr).map((unit, index) => <span key={`${unit}-${index}`} dir="auto"> {unit}</span>)}</>
}

function sameIdentity(left: string | null, right: string | null) {
  return !!left && !!right && left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
}

function classicMerchantNames(model: DocumentViewModel) {
  const { seller } = model
  const candidates = [
    seller.displayHeading,
    ...(seller.branch.visible ? names(model, seller.branch.name, seller.branch.nameAr) : []),
    seller.displaySubheading,
  ]
  return candidates.filter((candidate, index, all) => !!candidate
    && !sameIdentity(candidate, seller.registeredName)
    && !sameIdentity(candidate, seller.registeredNameAr)
    && !all.slice(0, index).some(previous => sameIdentity(candidate, previous)))
}

function ReceiptLogo({ receipt }: { receipt: ReceiptComposition }) {
  const { model, logoUrl, logoMm } = receipt
  return model.presentation.logo.visible && logoUrl
    ? <div className="thermal-logo" style={{ '--thermal-logo-height': `${logoMm}mm` } as CSSProperties}><img src={logoUrl} alt="" onError={event => { event.currentTarget.style.display = 'none' }} /></div>
    : null
}

function DisplayIdentity({ receipt, branch = true }: { receipt: ReceiptComposition; branch?: boolean }) {
  const { model } = receipt
  const { seller } = model
  const showHeading = seller.displayHeading && !sameIdentity(seller.displayHeading, seller.registeredName) && !sameIdentity(seller.displayHeading, seller.registeredNameAr)
  return <>
    {showHeading && <div className="thermal-heading" dir="auto">{seller.displayHeading}</div>}
    {seller.displaySubheading && <div className="thermal-subheading" dir="auto">{seller.displaySubheading}</div>}
    {branch && seller.branch.visible && names(model, seller.branch.name, seller.branch.nameAr).map((name, index) => <div key={`${name}-${index}`} className="thermal-branch" dir="auto">{name}</div>)}
  </>
}

function LegalSeller({ receipt, contact = false, website = true }: { receipt: ReceiptComposition; contact?: boolean; website?: boolean }) {
  const { model } = receipt
  const { seller, presentation, identity } = model
  const presentationAddress = presentation.contact.address
  return <section className="thermal-legal-info">
    {names(model, seller.registeredName, seller.registeredNameAr).map((name, index) => <div key={`${name}-${index}`} className="thermal-legal-supplier" dir="auto">{name}</div>)}
    {seller.registeredAddress && <div className="thermal-address" dir="auto">{seller.registeredAddress}</div>}
    {seller.vatNumber && <div>{documentLabel(identity.language, 'vatNumber')}: <bdi dir="ltr">{seller.vatNumber}</bdi></div>}
    {seller.registrationNumber && <div>{seller.registrationType === 'CR' ? documentLabel(identity.language, 'crNumber') : seller.registrationType ?? documentLabel(identity.language, 'identifier')}: <bdi dir="ltr">{seller.registrationNumber}</bdi></div>}
    {presentation.contact.addressVisible && presentationAddress && presentationAddress !== seller.registeredAddress && <div className="thermal-address thermal-address--presentation" dir="auto">{presentationAddress}</div>}
    {contact && presentation.contact.phoneVisible && presentation.contact.phone && <div>{documentLabel(identity.language, 'phone')}: <bdi dir="ltr">{presentation.contact.phone}</bdi></div>}
    {contact && website && presentation.contact.websiteVisible && presentation.contact.website && <div><bdi dir="ltr">{presentation.contact.website}</bdi></div>}
    {contact && presentation.contact.emailVisible && presentation.contact.email && <div><bdi dir="ltr">{presentation.contact.email}</bdi></div>}
  </section>
}

/** Traditional merchant masthead: branch/trading identity can lead, while the
 * authoritative legal seller remains visible exactly once underneath. */
function ClassicSellerHeader({ receipt }: { receipt: ReceiptComposition }) {
  const { model } = receipt
  const merchantNames = classicMerchantNames(model)
  return <header className="thermal-header thermal-classic-header">
    <ReceiptLogo receipt={receipt} />
    {merchantNames.map((name, index) => <div key={`${name}-${index}`} className={index === 0 ? 'thermal-heading' : 'thermal-classic-trading-name'} dir="auto">{name}</div>)}
    <LegalSeller receipt={receipt} contact website={false} />
  </header>
}

function ReceiptTitle({ receipt }: { receipt: ReceiptComposition }) {
  return <section className="thermal-title">{receipt.titleLines.map((line, index) => <div key={`${line}-${index}`} className={index === 0 ? 'thermal-title-main' : 'thermal-title-sub'} dir="auto">{line}</div>)}</section>
}

function ReceiptMetadata({ receipt }: { receipt: ReceiptComposition }) {
  const { model, isCredit, isDebit, isAdjustment, date, time } = receipt
  return <section className="thermal-meta">
    <div><span>{documentLabel(model.identity.language, isCredit ? 'creditNoteNumber' : isDebit ? 'debitNoteNumber' : 'invoiceNumber')}</span><bdi dir="ltr">{model.identity.number}</bdi></div>
    <div><span>{documentLabel(model.identity.language, 'date')}</span><bdi dir="ltr">{date}</bdi></div>
    <div><span>{documentLabel(model.identity.language, 'time')}</span><bdi dir="ltr">{time}</bdi></div>
    {isAdjustment && model.compliance.originalDocument.number && <div><span>{documentLabel(model.identity.language, 'originalInvoice')}</span><bdi dir="ltr">{model.compliance.originalDocument.number}</bdi></div>}
    {isAdjustment && model.compliance.creditReason && <div className="thermal-meta-reason"><span>{documentLabel(model.identity.language, 'reason')}</span><span dir="auto">{model.compliance.creditReason}</span></div>}
  </section>
}

function ReceiptBuyer({ receipt, detailed = false }: { receipt: ReceiptComposition; detailed?: boolean }) {
  const { model, mandatoryBuyer } = receipt
  const { buyer, identity } = model
  if (buyer.isWalkIn) return null
  if (!mandatoryBuyer && !buyer.name) return null
  return <section className="thermal-buyer">
    <div className="thermal-section-label">{documentLabel(identity.language, 'customer')}</div>
    {names(model, buyer.name, buyer.nameAr).map((name, index) => <div key={`${name}-${index}`} dir="auto">{name}</div>)}
    {detailed && names(model, buyer.address, buyer.addressAr).map((value, index) => <div key={`${value}-${index}`} dir="auto">{value}</div>)}
    {buyer.vatNumber && <div>{documentLabel(identity.language, 'customerVatNumber')}: <bdi dir="ltr">{buyer.vatNumber}</bdi></div>}
    {buyer.identifierValue && <div>{buyer.identifierType ?? documentLabel(identity.language, 'identifier')}: <bdi dir="ltr">{buyer.identifierValue}</bdi></div>}
  </section>
}

function ItemFiscalDetail({ receipt, item }: { receipt: ReceiptComposition; item: DocumentViewModel['items'][number] }) {
  const { model, isStandard, isAdjustment, isCredit } = receipt
  if (!isStandard && !isAdjustment && item.discount <= 0) return null
  return <div className="thermal-item-detail">
    {(isStandard || isAdjustment) && <span>{documentLabel(model.identity.language, 'vatAmount')}: <Money value={item.vatAmount} model={model} /> · <bdi dir="ltr">{formatDocumentQuantity(item.vatRate, model)}%</bdi></span>}
    {item.discount > 0 && <span>{documentLabel(model.identity.language, 'discount')}: <Money value={item.discount} model={model} /></span>}
    {isCredit && item.creditedQuantity != null && <span>{documentLabel(model.identity.language, 'quantity')}: <QuantityWithUnit quantity={item.creditedQuantity} item={item} model={model} /></span>}
  </div>
}

function CompactItems({ receipt }: { receipt: ReceiptComposition }) {
  const { model } = receipt
  return <section className="thermal-items thermal-compact-lines">{model.items.map((item, index) => <article className="thermal-item thermal-compact-line" key={`${item.description}-${index}`}>
    <div className={`thermal-item-name ${model.presentation.thermal.wrapItemNames ? '' : 'thermal-item-name--truncate'}`}>{names(model, item.description, item.descriptionAr).map((name, itemIndex) => <div key={`${name}-${itemIndex}`} dir="auto">{name}</div>)}</div>
    <div className="thermal-compact-line__amount"><Money value={item.lineTotal} model={model} /></div>
    <div className="thermal-compact-line__formula"><QuantityWithUnit quantity={item.quantity} item={item} model={model} /> <span aria-hidden="true">×</span> <Money value={item.unitPrice} model={model} /></div>
    <ItemFiscalDetail receipt={receipt} item={item} />
  </article>)}</section>
}

function ClassicItems({ receipt }: { receipt: ReceiptComposition }) {
  const { model } = receipt
  const is58 = model.presentation.thermal.width === '58mm'
  return <section className={`thermal-items thermal-classic-lines ${is58 ? 'thermal-items--stacked' : 'thermal-items--wide'}`}>{model.items.map((item, index) => <article className="thermal-item thermal-classic-line" key={`${item.description}-${index}`}>
    <ClassicItemName item={item} model={model} />
    <div className="thermal-item-values"><span><QuantityWithUnit quantity={item.quantity} item={item} model={model} /> <span aria-hidden="true">×</span> <Money value={item.unitPrice} model={model} /></span><span><Money value={item.lineTotal} model={model} /></span></div>
    <ClassicItemFiscalDetail receipt={receipt} item={item} />
  </article>)}</section>
}

function ClassicItemName({ item, model }: { item: DocumentViewModel['items'][number]; model: DocumentViewModel }) {
  const bilingualPair = model.identity.language === 'both'
    && !!item.description.trim()
    && !!item.descriptionAr?.trim()
    && !sameIdentity(item.description, item.descriptionAr)
  if (bilingualPair) {
    return <div className="thermal-item-name thermal-classic-line__names thermal-classic-line__names--bilingual">
      <span dir="ltr">{item.description}</span><span dir="rtl">{item.descriptionAr}</span>
    </div>
  }
  return <div className={`thermal-item-name thermal-classic-line__names ${model.presentation.thermal.wrapItemNames ? '' : 'thermal-item-name--truncate'}`}>
    {names(model, item.description, item.descriptionAr).map((name, itemIndex) => <div key={`${name}-${itemIndex}`} dir="auto">{name}</div>)}
  </div>
}

function ClassicItemFiscalDetail({ receipt, item }: { receipt: ReceiptComposition; item: DocumentViewModel['items'][number] }) {
  const { model, isCredit } = receipt
  const hasVat = Math.abs(item.vatAmount) > 0.005 || Math.abs(item.vatRate) > 0.005
  if (!hasVat && item.discount <= 0.005 && !(isCredit && item.creditedQuantity != null)) return null
  return <div className="thermal-item-detail thermal-classic-line__detail">
    {hasVat && <span className="thermal-classic-line__vat">{documentLabel(model.identity.language, 'vatAmount')} ({formatDocumentQuantity(item.vatRate, model)}%): <Money value={item.vatAmount} model={model} /></span>}
    {item.discount > 0.005 && <span className="thermal-classic-line__discount">{documentLabel(model.identity.language, 'discount')}: <bdi dir="ltr">−</bdi><Money value={item.discount} model={model} /></span>}
    {isCredit && item.creditedQuantity != null && <span>{documentLabel(model.identity.language, 'quantity')}: <QuantityWithUnit quantity={item.creditedQuantity} item={item} model={model} /></span>}
  </div>
}

function StructuredItems({ receipt }: { receipt: ReceiptComposition }) {
  const { model } = receipt
  return <section className="thermal-items thermal-structured-lines">{model.items.map((item, index) => <article className="thermal-item thermal-structured-line" key={`${item.description}-${index}`}>
    <div className={`thermal-item-name ${model.presentation.thermal.wrapItemNames ? '' : 'thermal-item-name--truncate'}`}><span className="thermal-item-index" aria-hidden="true">{index + 1}</span><div className="thermal-structured-line__names">{names(model, item.description, item.descriptionAr).map((name, itemIndex) => <div key={`${name}-${itemIndex}`} dir="auto">{name}</div>)}</div></div>
    <div className="thermal-structured-line__figures">
      <span><small>{documentLabel(model.identity.language, 'quantity')}</small><strong><QuantityWithUnit quantity={item.quantity} item={item} model={model} /></strong></span>
      <span><small>{documentLabel(model.identity.language, 'unitPrice')}</small><Money value={item.unitPrice} model={model} /></span>
      <span><small>{documentLabel(model.identity.language, 'amount')}</small><Money value={item.lineTotal} model={model} /></span>
    </div>
    <ItemFiscalDetail receipt={receipt} item={item} />
  </article>)}</section>
}

function BrandedItems({ receipt }: { receipt: ReceiptComposition }) {
  const { model } = receipt
  return <section className="thermal-items thermal-branded-cards">{model.items.map((item, index) => <article className="thermal-item thermal-branded-card" key={`${item.description}-${index}`}>
    <div className="thermal-branded-card__head"><span className="thermal-branded-card__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div className={`thermal-item-name ${model.presentation.thermal.wrapItemNames ? '' : 'thermal-item-name--truncate'}`}>{names(model, item.description, item.descriptionAr).map((name, itemIndex) => <div key={`${name}-${itemIndex}`} dir="auto">{name}</div>)}</div></div>
    <div className="thermal-branded-card__math"><span><QuantityWithUnit quantity={item.quantity} item={item} model={model} /> × <Money value={item.unitPrice} model={model} /></span><strong><Money value={item.lineTotal} model={model} /></strong></div>
    <ItemFiscalDetail receipt={receipt} item={item} />
  </article>)}</section>
}

function Totals({ receipt }: { receipt: ReceiptComposition }) {
  return <section className="thermal-totals">{receipt.visibleTotals.map(row => <Row key={row.key} label={row.label} strong={row.emphasized}><Money value={row.value} model={receipt.model} /></Row>)}</section>
}

function ClassicTotals({ receipt }: { receipt: ReceiptComposition }) {
  return <section className="thermal-totals thermal-classic-totals">{receipt.visibleTotals.map(row => <Row key={row.key} label={row.label} strong={row.emphasized}>
    {row.key === 'discount' ? <><bdi dir="ltr">−</bdi><Money value={row.value} model={receipt.model} /></> : <Money value={row.value} model={receipt.model} />}
  </Row>)}</section>
}

function Payments({ receipt }: { receipt: ReceiptComposition }) {
  const { model, paymentKind, isCredit } = receipt
  const { payments, totals, presentation, identity } = model
  const customerCredit = model.customerCredit
  if (customerCredit?.isCustomerCredit) {
    const statusKey = customerCredit.paymentStatus === 'paid' ? 'paid' : customerCredit.paymentStatus === 'partial' ? 'partiallyPaid' : 'unpaid'
    return <section className="thermal-payments">
      <div className="thermal-payment-kind">{documentLabel(identity.language, 'paymentMethod')}: <strong>{documentLabel(identity.language, 'customerCredit')}</strong></div>
      <Row label={documentLabel(identity.language, 'paymentStatus')}>{documentLabel(identity.language, statusKey)}</Row>
      {customerCredit.initialPaymentMethod && <Row label={documentLabel(identity.language, 'initialPaymentMethod')}>{documentPaymentLabel(identity.language, customerCredit.initialPaymentMethod)}</Row>}
      <Row label={documentLabel(identity.language, 'amountPaid')}><Money value={customerCredit.amountPaid} model={model} /></Row>
      <Row label={documentLabel(identity.language, 'balanceDue')}><Money value={customerCredit.balanceDue} model={model} /></Row>
    </section>
  }
  return <section className="thermal-payments">
    <div className="thermal-payment-kind">{documentLabel(identity.language, isCredit ? 'refundMethod' : 'paymentMethod')}: <strong>{documentPaymentLabel(identity.language, paymentKind)}</strong></div>
    {payments.map((payment, index) => <Row key={`${payment.method}-${index}`} label={documentPaymentLabel(identity.language, payment.method)}><Money value={payment.amount} model={model} /></Row>)}
    {presentation.thermal.showCashChange && payments.length === 1 && payments[0]?.method === 'cash' && payments[0]?.cashTendered != null && Math.abs((payments[0]?.cashTendered ?? 0) - totals.total) > 0.005 && <Row label={documentLabel(identity.language, 'received')}><Money value={payments[0].cashTendered} model={model} /></Row>}
    {presentation.thermal.showCashChange && payments.length === 1 && payments[0]?.method === 'cash' && (payments[0]?.change ?? 0) > 0 && <Row label={documentLabel(identity.language, 'change')}><Money value={payments[0].change ?? 0} model={model} /></Row>}
  </section>
}

function ClassicPayments({ receipt }: { receipt: ReceiptComposition }) {
  const { model, isCredit } = receipt
  const { customerCredit, identity, payments, presentation, totals } = model
  if (customerCredit?.isCustomerCredit) return <Payments receipt={receipt} />
  const positivePayments = payments.filter(payment => payment.amount > 0.005)
  const paymentKind = positivePayments.length > 1 ? 'split' : positivePayments[0]?.method ?? 'other'
  const singleCash = positivePayments.length === 1 && positivePayments[0]?.method === 'cash' ? positivePayments[0] : null
  return <section className={`thermal-payments thermal-classic-payments thermal-classic-payments--${positivePayments.length > 1 ? 'split' : 'single'}`}>
    <div className="thermal-payment-kind">{documentLabel(identity.language, isCredit ? 'refundMethod' : 'paymentMethod')}: <strong>{documentPaymentLabel(identity.language, paymentKind)}</strong></div>
    {positivePayments.length > 1 && positivePayments.map((payment, index) => <Row key={`${payment.method}-${index}`} label={documentPaymentLabel(identity.language, payment.method)}><Money value={payment.amount} model={model} /></Row>)}
    {presentation.thermal.showCashChange && singleCash?.cashTendered != null && Math.abs(singleCash.cashTendered - totals.total) > 0.005 && <Row label={documentLabel(identity.language, 'received')}><Money value={singleCash.cashTendered} model={model} /></Row>}
    {presentation.thermal.showCashChange && singleCash && (singleCash.change ?? 0) > 0.005 && <Row label={documentLabel(identity.language, 'change')}><Money value={singleCash.change ?? 0} model={model} /></Row>}
  </section>
}

function Verification({ receipt }: { receipt: ReceiptComposition }) {
  if (receipt.options.nonFiscalDemo || receipt.options.qrUnavailable) return null
  return <div className="thermal-qr" style={{ width: `${receipt.qrMm}mm`, textAlign: 'center' }}>
    {receipt.options.qrImageUrl ? <img src={receipt.options.qrImageUrl} alt={documentLabel(receipt.model.identity.language, 'qrCode')} dir="ltr" /> : <div className="thermal-qr-placeholder">{documentLabel(receipt.model.identity.language, 'qrCode')}</div>}
    {documentLabelLines(receipt.model.identity.language, 'scanToVerify').map((line, index) => <div key={`${line}-${index}`} dir="auto">{line}</div>)}
  </div>
}

function FooterCopy({ receipt }: { receipt: ReceiptComposition }) {
  if (receipt.optionalFooter.length === 0) return null
  return <div className={`thermal-footer-copy ${receipt.model.presentation.footer.bold ? 'font-bold' : ''}`} style={{ fontSize: 'calc(var(--thermal-small) + 1px)', textAlign: 'center' }}>{receipt.optionalFooter.map((line, index) => <div key={`${line}-${index}`} dir="auto">{line}</div>)}</div>
}

/** Traditional, printer-first Kubri receipt with the shared issued-document model. */
export function ClassicReceipt({ receipt }: { receipt: ReceiptComposition }) {
  const hasBuyer = !receipt.model.buyer.isWalkIn && (receipt.mandatoryBuyer || !!receipt.model.buyer.name)
  return <>
    <ClassicSellerHeader receipt={receipt} />
    <Rule />
    <ReceiptTitle receipt={receipt} />
    <ReceiptMetadata receipt={receipt} />
    {hasBuyer && <><Rule /><ReceiptBuyer receipt={receipt} detailed={receipt.isStandard} /></>}
    <Rule />
    <ClassicItems receipt={receipt} />
    <Rule />
    <ClassicTotals receipt={receipt} />
    <ClassicPayments receipt={receipt} />
    <footer className="thermal-footer thermal-classic-footer"><Verification receipt={receipt} /><FooterCopy receipt={receipt} /></footer>
  </>
}

export function CompactRetailReceipt({ receipt }: { receipt: ReceiptComposition }) {
  return <>
    <header className="thermal-header thermal-compact-masthead"><ReceiptLogo receipt={receipt} /><DisplayIdentity receipt={receipt} /><LegalSeller receipt={receipt} contact /></header>
    <ReceiptTitle receipt={receipt} />
    <ReceiptMetadata receipt={receipt} />
    <ReceiptBuyer receipt={receipt} />
    <Rule /><CompactItems receipt={receipt} /><Rule /><Totals receipt={receipt} />
    <Payments receipt={receipt} />
    <footer className="thermal-footer thermal-compact-close"><Verification receipt={receipt} /><FooterCopy receipt={receipt} /></footer>
  </>
}

export function StructuredDetailReceipt({ receipt }: { receipt: ReceiptComposition }) {
  return <>
    <header className="thermal-header thermal-structured-masthead"><div className="thermal-structured-brand"><ReceiptLogo receipt={receipt} /><DisplayIdentity receipt={receipt} /></div><LegalSeller receipt={receipt} contact /></header>
    <div className="thermal-structured-document"><ReceiptTitle receipt={receipt} /><ReceiptMetadata receipt={receipt} /></div>
    <ReceiptBuyer receipt={receipt} detailed />
    <section className="thermal-structured-items-heading"><span>{documentLabel(receipt.model.identity.language, 'description')}</span><span>{documentLabel(receipt.model.identity.language, 'amount')}</span></section>
    <StructuredItems receipt={receipt} />
    <section className="thermal-structured-accounting"><Totals receipt={receipt} /><Payments receipt={receipt} /></section>
    <footer className="thermal-footer thermal-structured-close"><FooterCopy receipt={receipt} /><Verification receipt={receipt} /></footer>
  </>
}

export function BrandedModernReceipt({ receipt }: { receipt: ReceiptComposition }) {
  return <>
    <header className="thermal-header thermal-branded-masthead"><ReceiptLogo receipt={receipt} /><div className="thermal-branded-identity"><DisplayIdentity receipt={receipt} /><LegalSeller receipt={receipt} contact /></div></header>
    <section className="thermal-branded-document"><ReceiptTitle receipt={receipt} /><ReceiptMetadata receipt={receipt} /></section>
    <ReceiptBuyer receipt={receipt} detailed />
    <BrandedItems receipt={receipt} />
    <section className="thermal-branded-summary"><div className="thermal-branded-summary__label">{documentLabel(receipt.model.identity.language, 'totalIncludingVat')}</div><Totals receipt={receipt} /></section>
    <Payments receipt={receipt} />
    <section className="thermal-branded-verification"><Verification receipt={receipt} /></section>
    <footer className="thermal-footer thermal-branded-close"><FooterCopy receipt={receipt} /></footer>
  </>
}

const THERMAL_LAYOUT_RENDERERS = {
  classic: ClassicReceipt,
  compact: CompactRetailReceipt,
  standard: StructuredDetailReceipt,
  detailed: BrandedModernReceipt,
} as const

export default function ThermalReceiptCompositions({ model, options }: { model: DocumentViewModel; options: ThermalRenderOptions }) {
  const { presentation, identity, buyer, payments } = model
  const isCredit = identity.kind === 'credit_note'
  const isDebit = identity.kind === 'debit_note'
  const isAdjustment = isCredit || isDebit
  const isStandard = identity.invoiceType === 'standard'
  const title = isCredit
    ? (isStandard ? 'taxCreditNote' : 'simplifiedTaxCreditNote')
    : isDebit
    ? (isStandard ? 'taxDebitNote' : 'simplifiedTaxDebitNote')
    : (isStandard ? 'standardTaxInvoice' : 'simplifiedTaxInvoice')
  const titleLines = documentLabelLines(identity.language, title)
  const optionalFooter = [presentation.footer.thankYouVisible ? presentation.footer.thankYou : null, presentation.footer.footerVisible ? presentation.footer.footer : null, presentation.footer.refundVisible ? presentation.footer.refund : null].filter((line): line is string => !!line)
  const receipt: ReceiptComposition = {
    model,
    options,
    titleLines,
    date: new Intl.DateTimeFormat(model.format.dateLocale, { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(identity.issueTimestamp)),
    time: new Intl.DateTimeFormat('en-SA', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(identity.issueTimestamp)),
    paymentKind: payments.length > 1 ? 'split' : payments[0]?.method ?? 'other',
    mandatoryBuyer: isStandard || !!buyer.vatNumber,
    logoUrl: presentation.logo.previewUrl ?? presentation.logo.assetPath,
    logoMm: presentation.logo.size === 'small' ? 9 : presentation.logo.size === 'large' ? 18 : 14,
    qrMm: presentation.thermal.qrSize === 'small' ? 22 : presentation.thermal.qrSize === 'large' ? 31 : 26,
    optionalFooter,
    visibleTotals: buildVisibleTotals(model),
    isCredit,
    isDebit,
    isAdjustment,
    isStandard,
  }
  const Renderer = THERMAL_LAYOUT_RENDERERS[presentation.thermal.density] ?? THERMAL_LAYOUT_RENDERERS.standard
  return <Renderer receipt={receipt} />
}
