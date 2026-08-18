import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { documentFontFamily, documentLabel, documentLabelLines, documentNames, documentPaymentLabel } from '@/localization/documents'
import { formatDocumentMoney, formatDocumentQuantity, type DocumentViewModel } from '@/lib/invoices/documentViewModel'
import { A4_TEMPLATE_REGISTRY, resolveA4Template, type A4TemplateRendererId } from '@/lib/invoices/a4TemplateRegistry'
import { RiyalSymbol } from '@/components/ui/RiyalSymbol'
import { buildVisibleTotals } from '@/lib/invoices/visibleTotals'
import { resolveInvoiceArtworkUrl } from '@/lib/invoices/runtimePresentation'
import { resolveA4ColorTokens } from '@/lib/invoices/a4ColorTokens'

export interface A4RenderOptions {
  readonly id?: string
  readonly preview?: boolean
  readonly pdfMode?: boolean
  readonly qrImageUrl?: string | null
  readonly nonFiscalDemo?: boolean
  readonly headerArtworkUrl?: string | null
  readonly footerArtworkUrl?: string | null
}

export interface A4DocumentProps { readonly model: DocumentViewModel; readonly options?: A4RenderOptions }

function Money({ value, model }: { value: number; model: DocumentViewModel }) { return <bdi className="a4-money" dir="ltr"><RiyalSymbol /> {formatDocumentMoney(value, model)}</bdi> }
function names(model: DocumentViewModel, en: string | null, ar: string | null) { return documentNames(model.identity.language, en, ar) }
function QuantityCell({ model, item, quantity }: { model: DocumentViewModel; item: DocumentViewModel['items'][number]; quantity: number }) { return <><bdi dir="ltr">{formatDocumentQuantity(quantity, model)}</bdi>{names(model, item.unitName, item.unitNameAr).map((value, index) => <div key={`${value}-${index}`} dir="auto">{value}</div>)}</> }
function DateMeta({ model }: { model: DocumentViewModel }) {
  const date = new Intl.DateTimeFormat(model.format.dateLocale, { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(model.identity.issueTimestamp))
  const time = new Intl.DateTimeFormat('en-SA', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(model.identity.issueTimestamp))
  const supplyDate = model.identity.supplyDate ? new Intl.DateTimeFormat(model.format.dateLocale, { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(model.identity.supplyDate)) : null
  const supplyDiffers = supplyDate && supplyDate !== date
  const credit = model.identity.kind === 'credit_note'
  const debit = model.identity.kind === 'debit_note'
  return <dl className="a4-meta">
    <div><dt>{documentLabel(model.identity.language, credit ? 'creditNoteNumber' : debit ? 'debitNoteNumber' : 'invoiceNumber')}</dt><dd><bdi dir="ltr">{model.identity.number}</bdi></dd></div>
    <div><dt>{documentLabel(model.identity.language, 'date')}</dt><dd><bdi dir="ltr">{date}</bdi></dd></div>
    <div><dt>{documentLabel(model.identity.language, 'time')}</dt><dd><bdi dir="ltr">{time}</bdi></dd></div>
    {supplyDiffers && <div><dt>{documentLabel(model.identity.language, 'supplyDate')}</dt><dd><bdi dir="ltr">{supplyDate}</bdi></dd></div>}
    {(credit || debit) && model.compliance.originalDocument.number && <div><dt>{documentLabel(model.identity.language, 'originalInvoice')}</dt><dd><bdi dir="ltr">{model.compliance.originalDocument.number}</bdi></dd></div>}
  </dl>
}

function hasConfiguredHeaderArtwork(model: DocumentViewModel, options: A4RenderOptions) {
  const applies = model.template.artworkScope === 'all' || model.template.artworkTemplateId === model.template.resolvedId
  if (options.headerArtworkUrl !== undefined) return Boolean(options.headerArtworkUrl)
  return applies && model.template.headerAssetEnabled && Boolean(model.template.headerAssetPath)
}

function showsStandardBranding(model: DocumentViewModel, options: A4RenderOptions) {
  return !hasConfiguredHeaderArtwork(model, options) || model.template.showStandardBranding
}

function normalizedIdentity(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() ?? ''
}

function isLegalSellerIdentity(seller: DocumentViewModel['seller'], value: string | null) {
  const candidate = normalizedIdentity(value)
  return candidate !== '' && [seller.registeredName, seller.registeredNameAr].some(legalName => normalizedIdentity(legalName) === candidate)
}

function hasNamedBuyer(model: DocumentViewModel) {
  return !model.buyer.isWalkIn && Boolean(model.buyer.name)
}

function partyLayout(className: string, model: DocumentViewModel) {
  return `${className}${hasNamedBuyer(model) ? '' : ' a4-parties--seller-only'}`
}

function Seller({ model }: { model: DocumentViewModel }) {
  const { seller, presentation } = model
  const presentationAddress = presentation.contact.address
  return <section className="a4-seller"><section className="a4-legal-seller"><div className="a4-section-title">{documentLabel(model.identity.language, 'seller')}</div>{names(model, seller.registeredName, seller.registeredNameAr).map((value, index) => <div className="a4-legal-seller__name" key={`${value}-${index}`} dir="auto">{value}</div>)}{seller.registeredAddress && <div className="a4-address" dir="auto">{seller.registeredAddress}</div>}{seller.vatNumber && <div>{documentLabel(model.identity.language, 'vatNumber')}: <bdi dir="ltr">{seller.vatNumber}</bdi></div>}{seller.registrationNumber && <div>{seller.registrationType === 'CR' ? documentLabel(model.identity.language, 'crNumber') : seller.registrationType ?? documentLabel(model.identity.language, 'identifier')}: <bdi dir="ltr">{seller.registrationNumber}</bdi></div>}</section>{presentation.contact.addressVisible && presentationAddress && presentationAddress !== seller.registeredAddress && <div className="a4-address a4-address--presentation" dir="auto">{presentationAddress}</div>}{presentation.contact.phoneVisible && presentation.contact.phone && <div>{documentLabel(model.identity.language, 'phone')}: <bdi dir="ltr">{presentation.contact.phone}</bdi></div>}{presentation.contact.websiteVisible && presentation.contact.website && <div>{documentLabel(model.identity.language, 'website')}: <bdi dir="ltr">{presentation.contact.website}</bdi></div>}{presentation.contact.emailVisible && presentation.contact.email && <div>{documentLabel(model.identity.language, 'email')}: <bdi dir="ltr">{presentation.contact.email}</bdi></div>}</section>
}

function SellerBrand({ model, visible = true }: { model: DocumentViewModel; visible?: boolean }) {
  if (!visible) return null
  const { seller, presentation } = model
  const logo = presentation.logo.previewUrl ?? presentation.logo.assetPath
  const hasLogo = presentation.logo.visible && Boolean(logo)
  const displayHeading = isLegalSellerIdentity(seller, seller.displayHeading) ? null : seller.displayHeading
  const displaySubheading = isLegalSellerIdentity(seller, seller.displaySubheading) || normalizedIdentity(seller.displaySubheading) === normalizedIdentity(displayHeading)
    ? null
    : seller.displaySubheading
  if (!hasLogo && !displayHeading && !displaySubheading) return null
  return <section className="a4-seller a4-seller--brand">
    {presentation.logo.visible && logo && <img className={`a4-logo a4-logo--${presentation.logo.size ?? 'medium'}`} src={logo} alt="" onError={event => { event.currentTarget.style.display = 'none' }} />}
    {displayHeading && <div className="a4-display-heading" dir="auto">{displayHeading}</div>}
    {displaySubheading && <div className="a4-display-subheading" dir="auto">{displaySubheading}</div>}
  </section>
}

function Buyer({ model }: { model: DocumentViewModel }) { const { buyer } = model; if (buyer.isWalkIn || !buyer.name) return null; return <section className="a4-buyer"><div className="a4-section-title">{documentLabel(model.identity.language, 'billTo')}</div>{names(model, buyer.name, buyer.nameAr).map((value, index) => <div className="a4-buyer-name" key={`${value}-${index}`} dir="auto">{value}</div>)}{names(model, buyer.address, buyer.addressAr).map((value, index) => <div key={`${value}-${index}`} dir="auto">{value}</div>)}{buyer.vatNumber && <div>{documentLabel(model.identity.language, 'customerVatNumber')}: <bdi dir="ltr">{buyer.vatNumber}</bdi></div>}{buyer.identifierValue && <div>{buyer.identifierType ?? documentLabel(model.identity.language, 'identifier')}: <bdi dir="ltr">{buyer.identifierValue}</bdi></div>}</section> }

function ItemTable({ model }: { model: DocumentViewModel }) { const credit = model.identity.kind === 'credit_note'; const hasDiscount = model.items.some(item => item.discount > 0.005); return <table className="a4-items"><thead><tr><th>#</th><th>{documentLabel(model.identity.language, 'description')}</th><th>{documentLabel(model.identity.language, 'quantity')}</th><th>{documentLabel(model.identity.language, 'unitPrice')}</th>{hasDiscount && <th>{documentLabel(model.identity.language, 'discount')}</th>}<th>{documentLabel(model.identity.language, 'taxableAmount')}</th><th>{documentLabel(model.identity.language, 'vatAmount')}</th><th>{documentLabel(model.identity.language, 'totalIncludingVat')}</th></tr></thead><tbody>{model.items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{index + 1}</td><td>{names(model, item.description, item.descriptionAr).map((value, nameIndex) => <div key={`${value}-${nameIndex}`} dir="auto">{value}</div>)}</td><td><QuantityCell model={model} item={item} quantity={credit && item.creditedQuantity != null ? item.creditedQuantity : item.quantity} /></td><td><Money value={item.unitPrice} model={model} /></td>{hasDiscount && <td>{item.discount > 0.005 ? <Money value={item.discount} model={model} /> : '—'}</td>}<td><Money value={item.taxableAmount} model={model} /></td><td><span><bdi dir="ltr">{formatDocumentQuantity(item.vatRate, model)}%</bdi> · <Money value={item.vatAmount} model={model} /></span></td><td><Money value={item.lineTotal} model={model} /></td></tr>)}</tbody></table> }

function ClassicItemName({ item }: { item: DocumentViewModel['items'][number] }) {
  const english = item.description.trim()
  const arabic = item.descriptionAr?.trim() ?? ''
  const identical = normalizedIdentity(english) !== '' && normalizedIdentity(english) === normalizedIdentity(arabic)
  if (english && arabic && !identical) {
    return <span className="a4-classic-item-name a4-classic-item-name--bilingual"><bdi dir="ltr">{english}</bdi><span className="a4-classic-item-name__separator" aria-hidden="true"> / </span><bdi dir="rtl">{arabic}</bdi></span>
  }
  const value = english || arabic
  return <bdi className="a4-classic-item-name" dir={arabic && !english ? 'rtl' : 'ltr'}>{value}</bdi>
}

function classicColumnLabel(key: 'description' | 'quantity' | 'unit' | 'unitPrice' | 'discount' | 'taxable' | 'rate' | 'vat' | 'total') {
  const labels = {
    description: { en: 'Description', ar: 'الوصف' }, quantity: { en: 'Qty', ar: 'الكمية' }, unit: { en: 'Unit', ar: 'الوحدة' },
    unitPrice: { en: 'Unit Price', ar: 'سعر الوحدة' }, discount: { en: 'Discount', ar: 'الخصم' }, taxable: { en: 'Taxable', ar: 'الخاضع' },
    rate: { en: 'Rate', ar: 'النسبة' }, vat: { en: 'VAT Amt', ar: 'مبلغ الضريبة' }, total: { en: 'Total', ar: 'الإجمالي' },
  } as const
  const label = labels[key]
  return `${label.en} / ${label.ar}`
}

function ClassicItemTable({ model }: { model: DocumentViewModel }) {
  const credit = model.identity.kind === 'credit_note'
  const hasDiscount = model.items.some(item => item.discount > 0.005)
  return <table className={`a4-items a4-classic-items${hasDiscount ? ' a4-classic-items--with-discount' : ''}`}>
    <colgroup><col className="a4-classic-items__index" /><col className="a4-classic-items__description" /><col className="a4-classic-items__quantity" /><col className="a4-classic-items__unit" /><col className="a4-classic-items__price" />{hasDiscount && <col className="a4-classic-items__discount" />}<col className="a4-classic-items__taxable" /><col className="a4-classic-items__rate" /><col className="a4-classic-items__vat" /><col className="a4-classic-items__total" /></colgroup>
    <thead><tr><th>#</th><th>{classicColumnLabel('description')}</th><th>{classicColumnLabel('quantity')}</th><th>{classicColumnLabel('unit')}</th><th>{classicColumnLabel('unitPrice')}</th>{hasDiscount && <th>{classicColumnLabel('discount')}</th>}<th>{classicColumnLabel('taxable')}</th><th>{classicColumnLabel('rate')}</th><th>{classicColumnLabel('vat')}</th><th>{classicColumnLabel('total')}</th></tr></thead>
    <tbody>{model.items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{index + 1}</td><td><ClassicItemName item={item} /></td><td><bdi dir="ltr">{formatDocumentQuantity(credit && item.creditedQuantity != null ? item.creditedQuantity : item.quantity, model)}</bdi></td><td>{names(model, item.unitName, item.unitNameAr).map((value, unitIndex) => <span key={`${value}-${unitIndex}`} dir="auto">{value}</span>)}</td><td><Money value={item.unitPrice} model={model} /></td>{hasDiscount && <td>{item.discount > 0.005 ? <Money value={item.discount} model={model} /> : '—'}</td>}<td><Money value={item.taxableAmount} model={model} /></td><td><bdi dir="ltr">{formatDocumentQuantity(item.vatRate, model)}%</bdi></td><td><Money value={item.vatAmount} model={model} /></td><td><Money value={item.lineTotal} model={model} /></td></tr>)}</tbody>
  </table>
}

function ModernStatementItemName({ item }: { item: DocumentViewModel['items'][number] }) {
  const english = item.description.trim()
  const arabic = item.descriptionAr?.trim() ?? ''
  const identical = normalizedIdentity(english) !== '' && normalizedIdentity(english) === normalizedIdentity(arabic)
  if (english && arabic && !identical) {
    return <span className="a4-statement-item-name a4-statement-item-name--bilingual"><bdi dir="ltr">{english}</bdi><span className="a4-statement-item-name__separator" aria-hidden="true"> / </span><bdi dir="rtl">{arabic}</bdi></span>
  }
  const value = english || arabic
  return <bdi className="a4-statement-item-name" dir={arabic && !english ? 'rtl' : 'ltr'}>{value}</bdi>
}

function modernStatementColumnLabel(model: DocumentViewModel, key: 'description' | 'quantity' | 'unitPrice' | 'taxable' | 'vat' | 'total') {
  const labels = {
    description: { en: 'Description', ar: 'الوصف' }, quantity: { en: 'Qty', ar: 'الكمية' }, unitPrice: { en: 'Unit Price', ar: 'سعر الوحدة' },
    taxable: { en: 'Taxable', ar: 'الخاضع' }, vat: { en: 'VAT', ar: 'الضريبة' }, total: { en: 'Total', ar: 'الإجمالي' },
  } as const
  const label = labels[key]
  return model.identity.language === 'ar' ? `${label.ar} / ${label.en}` : `${label.en} / ${label.ar}`
}

function ModernStatementItemTable({ model }: { model: DocumentViewModel }) {
  const credit = model.identity.kind === 'credit_note'
  const hasDiscount = model.items.some(item => item.discount > 0.005)
  return <table className={`a4-items a4-statement-items${hasDiscount ? ' a4-statement-items--with-discount' : ''}`}>
    <colgroup><col className="a4-statement-items__index" /><col className="a4-statement-items__description" /><col className="a4-statement-items__quantity" /><col className="a4-statement-items__price" />{hasDiscount && <col className="a4-statement-items__discount" />}<col className="a4-statement-items__taxable" /><col className="a4-statement-items__vat" /><col className="a4-statement-items__total" /></colgroup>
    <thead><tr><th>#</th><th>{modernStatementColumnLabel(model, 'description')}</th><th>{modernStatementColumnLabel(model, 'quantity')}</th><th>{modernStatementColumnLabel(model, 'unitPrice')}</th>{hasDiscount && <th>{documentLabel(model.identity.language, 'discount')}</th>}<th>{modernStatementColumnLabel(model, 'taxable')}</th><th>{modernStatementColumnLabel(model, 'vat')}</th><th>{modernStatementColumnLabel(model, 'total')}</th></tr></thead>
    <tbody>{model.items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{index + 1}</td><td><ModernStatementItemName item={item} /></td><td><bdi dir="ltr">{formatDocumentQuantity(credit && item.creditedQuantity != null ? item.creditedQuantity : item.quantity, model)}</bdi>{names(model, item.unitName, item.unitNameAr).map((value, unitIndex) => <span className="a4-statement-item-unit" key={`${value}-${unitIndex}`} dir="auto">{value}</span>)}</td><td><Money value={item.unitPrice} model={model} /></td>{hasDiscount && <td>{item.discount > 0.005 ? <Money value={item.discount} model={model} /> : '—'}</td>}<td><Money value={item.taxableAmount} model={model} /></td><td><span><bdi dir="ltr">{formatDocumentQuantity(item.vatRate, model)}%</bdi> · <Money value={item.vatAmount} model={model} /></span></td><td><Money value={item.lineTotal} model={model} /></td></tr>)}</tbody>
  </table>
}

function LedgerItemName({ item }: { item: DocumentViewModel['items'][number] }) {
  const english = item.description.trim()
  const arabic = item.descriptionAr?.trim() ?? ''
  const identical = normalizedIdentity(english) !== '' && normalizedIdentity(english) === normalizedIdentity(arabic)
  if (english && arabic && !identical) return <span className="a4-ledger-item-name a4-ledger-item-name--bilingual"><bdi dir="ltr">{english}</bdi><span className="a4-ledger-item-name__separator" aria-hidden="true"> / </span><bdi dir="rtl">{arabic}</bdi></span>
  const value = english || arabic
  return <bdi className="a4-ledger-item-name" dir={arabic && !english ? 'rtl' : 'ltr'}>{value}</bdi>
}

function ledgerColumnLabel(model: DocumentViewModel, key: 'description' | 'quantity' | 'unitPrice' | 'taxable' | 'vat' | 'total') {
  const labels = {
    description: { en: 'Description', ar: 'الوصف' }, quantity: { en: 'Qty', ar: 'الكمية' }, unitPrice: { en: 'Unit Price', ar: 'سعر الوحدة' },
    taxable: { en: 'Taxable', ar: 'الخاضع' }, vat: { en: 'VAT', ar: 'الضريبة' }, total: { en: 'Total', ar: 'الإجمالي' },
  } as const
  const label = labels[key]
  return model.identity.language === 'ar' ? `${label.ar} / ${label.en}` : `${label.en} / ${label.ar}`
}

function LedgerItemTable({ model }: { model: DocumentViewModel }) {
  const credit = model.identity.kind === 'credit_note'
  const hasDiscount = model.items.some(item => item.discount > 0.005)
  return <table className={`a4-items a4-ledger-items${hasDiscount ? ' a4-ledger-items--with-discount' : ''}`}>
    <colgroup><col className="a4-ledger-items__index" /><col className="a4-ledger-items__description" /><col className="a4-ledger-items__quantity" /><col className="a4-ledger-items__price" />{hasDiscount && <col className="a4-ledger-items__discount" />}<col className="a4-ledger-items__taxable" /><col className="a4-ledger-items__vat" /><col className="a4-ledger-items__total" /></colgroup>
    <thead><tr><th>#</th><th>{ledgerColumnLabel(model, 'description')}</th><th>{ledgerColumnLabel(model, 'quantity')}</th><th>{ledgerColumnLabel(model, 'unitPrice')}</th>{hasDiscount && <th>{documentLabel(model.identity.language, 'discount')}</th>}<th>{ledgerColumnLabel(model, 'taxable')}</th><th>{ledgerColumnLabel(model, 'vat')}</th><th>{ledgerColumnLabel(model, 'total')}</th></tr></thead>
    <tbody>{model.items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{index + 1}</td><td><LedgerItemName item={item} /></td><td><bdi dir="ltr">{formatDocumentQuantity(credit && item.creditedQuantity != null ? item.creditedQuantity : item.quantity, model)}</bdi>{names(model, item.unitName, item.unitNameAr).map((value, unitIndex) => <span className="a4-ledger-item-unit" key={`${value}-${unitIndex}`} dir="auto">{value}</span>)}</td><td><Money value={item.unitPrice} model={model} /></td>{hasDiscount && <td>{item.discount > 0.005 ? <Money value={item.discount} model={model} /> : '—'}</td>}<td><Money value={item.taxableAmount} model={model} /></td><td><span><bdi dir="ltr">{formatDocumentQuantity(item.vatRate, model)}%</bdi> · <Money value={item.vatAmount} model={model} /></span></td><td><Money value={item.lineTotal} model={model} /></td></tr>)}</tbody>
  </table>
}

function ContemporaryItemName({ item }: { item: DocumentViewModel['items'][number] }) {
  const english = item.description.trim()
  const arabic = item.descriptionAr?.trim() ?? ''
  const identical = normalizedIdentity(english) !== '' && normalizedIdentity(english) === normalizedIdentity(arabic)
  if (english && arabic && !identical) return <span className="a4-contemporary-item-name a4-contemporary-item-name--bilingual"><bdi dir="ltr">{english}</bdi><span className="a4-contemporary-item-name__separator" aria-hidden="true"> / </span><bdi dir="rtl">{arabic}</bdi></span>
  const value = english || arabic
  return <bdi className="a4-contemporary-item-name" dir={arabic && !english ? 'rtl' : 'ltr'}>{value}</bdi>
}

function contemporaryColumnLabel(key: 'description' | 'quantity' | 'unitPrice' | 'discount' | 'taxable' | 'vat' | 'total') {
  const labels = {
    description: { en: 'Description', ar: 'الوصف' }, quantity: { en: 'Qty', ar: 'الكمية' }, unitPrice: { en: 'Unit Price', ar: 'سعر الوحدة' },
    discount: { en: 'Discount', ar: 'الخصم' }, taxable: { en: 'Taxable', ar: 'الخاضع' }, vat: { en: 'VAT', ar: 'الضريبة' }, total: { en: 'Total', ar: 'الإجمالي' },
  } as const
  const label = labels[key]
  return `${label.en} / ${label.ar}`
}

function ContemporaryItemTable({ model }: { model: DocumentViewModel }) {
  const credit = model.identity.kind === 'credit_note'
  const hasDiscount = model.items.some(item => item.discount > 0.005)
  return <table className={`a4-items a4-contemporary-items${hasDiscount ? ' a4-contemporary-items--with-discount' : ''}`}>
    <colgroup><col className="a4-contemporary-items__index" /><col className="a4-contemporary-items__description" /><col className="a4-contemporary-items__quantity" /><col className="a4-contemporary-items__price" />{hasDiscount && <col className="a4-contemporary-items__discount" />}<col className="a4-contemporary-items__taxable" /><col className="a4-contemporary-items__vat" /><col className="a4-contemporary-items__total" /></colgroup>
    <thead><tr><th>#</th><th>{contemporaryColumnLabel('description')}</th><th>{contemporaryColumnLabel('quantity')}</th><th>{contemporaryColumnLabel('unitPrice')}</th>{hasDiscount && <th>{contemporaryColumnLabel('discount')}</th>}<th>{contemporaryColumnLabel('taxable')}</th><th>{contemporaryColumnLabel('vat')}</th><th>{contemporaryColumnLabel('total')}</th></tr></thead>
    <tbody>{model.items.map((item, index) => <tr key={`${item.description}-${index}`}><td>{index + 1}</td><td><ContemporaryItemName item={item} /></td><td><bdi dir="ltr">{formatDocumentQuantity(credit && item.creditedQuantity != null ? item.creditedQuantity : item.quantity, model)}</bdi>{names(model, item.unitName, item.unitNameAr).map((value, unitIndex) => <span className="a4-contemporary-item-unit" key={`${value}-${unitIndex}`} dir="auto">{value}</span>)}</td><td><Money value={item.unitPrice} model={model} /></td>{hasDiscount && <td>{item.discount > 0.005 ? <Money value={item.discount} model={model} /> : '—'}</td>}<td><Money value={item.taxableAmount} model={model} /></td><td><span><bdi dir="ltr">{formatDocumentQuantity(item.vatRate, model)}%</bdi> · <Money value={item.vatAmount} model={model} /></span></td><td><Money value={item.lineTotal} model={model} /></td></tr>)}</tbody>
  </table>
}

function Totals({ model }: { model: DocumentViewModel }) { return <section className="a4-totals">{buildVisibleTotals(model).map(row => <div className={row.emphasized ? 'a4-totals__grand' : undefined} key={row.key}><span>{row.label}</span><Money value={row.value} model={model} /></div>)}</section> }

function Payment({ model }: { model: DocumentViewModel }) {
  const credit = model.identity.kind === 'credit_note'
  const customerCredit = model.customerCredit
  // TODO(a4-foundation): A4 intentionally inherits the existing shared
  // cash-change visibility contract until a dedicated A4 control is approved.
  const showCashChange = model.presentation.thermal.showCashChange
  if (customerCredit?.isCustomerCredit) {
    const statusKey = customerCredit.paymentStatus === 'paid' ? 'paid' : customerCredit.paymentStatus === 'partial' ? 'partiallyPaid' : 'unpaid'
    return <section className="a4-payment">
      <div className="a4-section-title">{documentLabel(model.identity.language, 'customerCredit')}</div>
      <div><span>{documentLabel(model.identity.language, 'paymentMethod')}</span><strong>{documentLabel(model.identity.language, 'customerCredit')}</strong></div>
      <div><span>{documentLabel(model.identity.language, 'paymentStatus')}</span><strong>{documentLabel(model.identity.language, statusKey)}</strong></div>
      {customerCredit.initialPaymentMethod && <div><span>{documentLabel(model.identity.language, 'initialPaymentMethod')}</span><span>{documentPaymentLabel(model.identity.language, customerCredit.initialPaymentMethod)}</span></div>}
      <div><span>{documentLabel(model.identity.language, 'amountPaid')}</span><Money value={customerCredit.amountPaid} model={model} /></div>
      <div><span>{documentLabel(model.identity.language, 'balanceDue')}</span><Money value={customerCredit.balanceDue} model={model} /></div>
    </section>
  }
  return <section className="a4-payment"><div className="a4-section-title">{documentLabel(model.identity.language, credit ? 'refundIssued' : 'paymentMethod')}</div>{model.payments.length > 0 ? model.payments.map((payment, index) => <div key={`${payment.method}-${index}`}><span>{documentPaymentLabel(model.identity.language, payment.method)}</span><Money value={payment.amount} model={model} />{payment.method === 'cash' && payment.cashTendered != null && Math.abs(payment.cashTendered - model.totals.total) > 0.005 && <span>{documentLabel(model.identity.language, 'received')}: <Money value={payment.cashTendered} model={model} /></span>}{payment.method === 'cash' && showCashChange && (payment.change ?? 0) > 0 && <span>{documentLabel(model.identity.language, 'change')}: <Money value={payment.change ?? 0} model={model} /></span>}</div>) : <div><span>{documentPaymentLabel(model.identity.language, 'other')}</span></div>}</section>
}

function QrVerification({ model, options }: { model: DocumentViewModel; options: A4RenderOptions }) { if (options.nonFiscalDemo) return null; return <section className="a4-qr">{options.qrImageUrl ? <img src={options.qrImageUrl} alt={documentLabel(model.identity.language, 'qrCode')} /> : <div className="a4-qr-placeholder">{documentLabel(model.identity.language, 'qrCode')}</div>}{documentLabelLines(model.identity.language, 'scanToVerify').map((line, index) => <div key={`${line}-${index}`} dir="auto">{line}</div>)}</section> }
function Footer({ model }: { model: DocumentViewModel }) { const footer = [model.presentation.footer.thankYouVisible ? model.presentation.footer.thankYou : null, model.presentation.footer.footerVisible ? model.presentation.footer.footer : null, model.presentation.footer.refundVisible ? model.presentation.footer.refund : null].filter(Boolean); return <footer className="a4-footer">{footer.length > 0 && <><div className="a4-footer-divider" aria-hidden="true" /><div className={`a4-footer-copy ${model.presentation.footer.bold || footer.length > 0 ? 'font-bold' : ''}`}>{footer.map((line, index) => <div key={`${line}-${index}`} dir="auto">{line}</div>)}</div></>}</footer> }
function DocumentTitle({ model }: { model: DocumentViewModel }) { const credit = model.identity.kind === 'credit_note'; const debit = model.identity.kind === 'debit_note'; const key = credit ? (model.identity.invoiceType === 'standard' ? 'taxCreditNote' : 'simplifiedTaxCreditNote') : debit ? (model.identity.invoiceType === 'standard' ? 'taxDebitNote' : 'simplifiedTaxDebitNote') : (model.identity.invoiceType === 'standard' ? 'standardTaxInvoice' : 'simplifiedTaxInvoice'); const lines = documentLabelLines(model.identity.language, key); return <section className="a4-document-title">{lines.map((line, index) => <div key={`${line}-${index}`} className={index === 0 ? 'a4-document-title__main' : 'a4-document-title__sub'} dir="auto">{line}</div>)}</section> }
function Adjustment({ model }: { model: DocumentViewModel }) { const credit = model.identity.kind === 'credit_note'; const debit = model.identity.kind === 'debit_note'; if (!credit && !debit) return null; return <section className={`a4-credit ${debit ? 'a4-debit' : ''}`}><strong>{documentLabel(model.identity.language, debit ? 'debitNoteReference' : 'creditNoteReference')}</strong>{model.compliance.originalDocument.number && <span>{documentLabel(model.identity.language, 'originalInvoice')}: <bdi dir="ltr">{model.compliance.originalDocument.number}</bdi></span>}{model.compliance.creditReason && <span>{documentLabel(model.identity.language, 'reason')}: <span dir="auto">{model.compliance.creditReason}</span></span>}</section> }
function useArtworkUrl(path: string | null, override: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(override ?? (/^(?:data:|blob:|https?:)/i.test(path ?? '') ? path : null))
  useEffect(() => {
    let active = true
    if (override !== undefined) {
      setUrl(override)
      return () => { active = false }
    }
    void resolveInvoiceArtworkUrl(path).then(next => { if (active) setUrl(next) })
    return () => { active = false }
  }, [path, override])
  return url
}

function Shell({ template, model, options, children }: { template: string; model: DocumentViewModel; options: A4RenderOptions; children: ReactNode }) {
  const artworkApplies = model.template.artworkScope === 'all' || model.template.artworkTemplateId === model.template.resolvedId
  const headerArtwork = useArtworkUrl(artworkApplies && model.template.headerAssetEnabled ? model.template.headerAssetPath : null, options.headerArtworkUrl)
  const footerArtwork = useArtworkUrl(artworkApplies && model.template.footerAssetEnabled ? model.template.footerAssetPath : null, options.footerArtworkUrl)
  const tokens = resolveA4ColorTokens({
    templateId: resolveA4Template(model).resolvedId,
    accent: model.template.accentColor,
    heading: model.template.headingColor,
    body: model.template.bodyColor,
    autoForeground: model.template.autoForeground,
  })
  return <article
    className={`a4-document a4-document--${template} a4-header--${resolveA4Template(model).headerStyle} ${showsStandardBranding(model, options) ? '' : 'a4-document--branding-hidden'}`}
    dir={model.identity.direction}
    lang={model.identity.language === 'both' ? undefined : model.identity.language}
    style={{
      '--invoice-primary': tokens.accent,
      '--invoice-on-primary': tokens.accentForeground,
      '--invoice-heading': tokens.heading,
      '--invoice-text': tokens.body,
      '--invoice-muted': tokens.muted,
      '--invoice-border': tokens.border,
      '--invoice-surface': tokens.surfaceTint,
      '--invoice-table-head': tokens.tableHeader,
      '--invoice-table-head-fg': tokens.tableHeaderForeground,
      '--invoice-total-surface': tokens.totalSurface,
      '--invoice-total-fg': tokens.totalForeground,
      '--a4-header-height': `${model.template.headerAssetHeight}mm`,
      '--a4-header-spacing': `${model.template.headerAssetSpacing}mm`,
      '--a4-footer-height': `${model.template.footerAssetHeight}mm`,
      '--a4-footer-spacing': `${model.template.footerAssetSpacing}mm`,
    } as CSSProperties}
  >
    {headerArtwork && <div className="a4-header-artwork"><img src={headerArtwork} alt="" style={{ objectFit: model.template.headerAssetFit }} onError={event => { event.currentTarget.parentElement!.style.display = 'none' }} /></div>}
    {children}
    {footerArtwork && <div className="a4-footer-artwork"><img src={footerArtwork} alt="" style={{ objectFit: model.template.footerAssetFit }} onError={event => { event.currentTarget.parentElement!.style.display = 'none' }} /></div>}
  </article>
}

function ClassicV1({ model, options = {} }: A4DocumentProps) { const branding = showsStandardBranding(model, options); const brandIdentity = branding && (Boolean(model.presentation.logo.visible && (model.presentation.logo.previewUrl ?? model.presentation.logo.assetPath)) || [model.seller.displayHeading, model.seller.displaySubheading].some(value => normalizedIdentity(value) !== '' && !isLegalSellerIdentity(model.seller, value))); return <Shell template="classic" model={model} options={options}><header className={`a4-classic-head${brandIdentity ? '' : ' a4-classic-head--brandless'}`}><section className="a4-classic-brand"><SellerBrand model={model} visible={branding} /></section><section className="a4-classic-identity"><DocumentTitle model={model} /><DateMeta model={model} /></section></header><div className={partyLayout('a4-classic-parties', model)}><Seller model={model} /><Buyer model={model} /></div><Adjustment model={model} /><ClassicItemTable model={model} /><div className="a4-classic-closeout a4-closing-group"><div className="a4-classic-summary"><QrVerification model={model} options={options} /><Payment model={model} /><Totals model={model} /></div><Footer model={model} /></div></Shell> }
function ModernStatementV1({ model, options = {} }: A4DocumentProps) {
  const branding = showsStandardBranding(model, options)
  const brandIdentity = branding && (Boolean(model.presentation.logo.visible && (model.presentation.logo.previewUrl ?? model.presentation.logo.assetPath)) || [model.seller.displayHeading, model.seller.displaySubheading].some(value => normalizedIdentity(value) !== '' && !isLegalSellerIdentity(model.seller, value)))
  return <Shell template="modern_split" model={model} options={options}>
    <header className={`a4-statement-head${brandIdentity ? '' : ' a4-statement-head--identityless'}`}>
      {brandIdentity && <section className="a4-statement-brand"><SellerBrand model={model} visible={branding} /></section>}
      <section className={`a4-statement-document${options.nonFiscalDemo ? ' a4-statement-document--without-qr' : ''}`}><div className="a4-statement-document-copy"><DocumentTitle model={model} /><section className="a4-statement-meta-card"><DateMeta model={model} /></section></div>{!options.nonFiscalDemo && <section className="a4-statement-qr-card"><QrVerification model={model} options={options} /></section>}</section>
    </header>
    <div className={partyLayout('a4-statement-parties', model)}><div className="a4-statement-party-card a4-statement-party-card--seller"><Seller model={model} /></div>{hasNamedBuyer(model) && <div className="a4-statement-party-card a4-statement-party-card--buyer"><Buyer model={model} /></div>}</div>
    <Adjustment model={model} />
    <ModernStatementItemTable model={model} />
    <div className="a4-statement-closeout a4-closing-group"><section className="a4-statement-payment-card"><Payment model={model} /></section><section className="a4-statement-totals"><Totals model={model} /></section></div>
    <Footer model={model} />
  </Shell>
}
function MinimalProfessionalV1({ model, options = {} }: A4DocumentProps) { const branding = showsStandardBranding(model, options); return <Shell template="minimal_professional" model={model} options={options}><header className="a4-minimal-head"><SellerBrand model={model} visible={branding} /><DocumentTitle model={model} options={options} /></header><div className={partyLayout('a4-minimal-parties', model)}><Seller model={model} /><Buyer model={model} /><DateMeta model={model} /></div><Adjustment model={model} /><ItemTable model={model} /><div className="a4-closing-group"><div className="a4-minimal-total"><Totals model={model} /></div><div className="a4-minimal-foot"><Payment model={model} /><QrVerification model={model} options={options} /></div></div><Footer model={model} /></Shell> }
function ExecutiveFrameV1({ model, options = {} }: A4DocumentProps) { const branding = showsStandardBranding(model, options); return <Shell template="executive_green" model={model} options={options}><header className="a4-executive-band"><section><SellerBrand model={model} visible={branding} /></section><section className="a4-executive-document"><DocumentTitle model={model} options={options} /><QrVerification model={model} options={options} /></section></header><section className="a4-executive-meta"><DateMeta model={model} /></section><div className={partyLayout('a4-executive-parties', model)}><Seller model={model} /><Buyer model={model} /></div><Adjustment model={model} /><ItemTable model={model} /><div className="a4-executive-lower a4-closing-group"><Payment model={model} /><Totals model={model} /></div><Footer model={model} /></Shell> }
function AccountingLedgerV1({ model, options = {} }: A4DocumentProps) {
  const branding = showsStandardBranding(model, options)
  const brandIdentity = branding && (Boolean(model.presentation.logo.visible && (model.presentation.logo.previewUrl ?? model.presentation.logo.assetPath)) || [model.seller.displayHeading, model.seller.displaySubheading].some(value => normalizedIdentity(value) !== '' && !isLegalSellerIdentity(model.seller, value)))
  return <Shell template="clean_ledger" model={model} options={options}>
    <header className={`a4-ledger-head${brandIdentity ? '' : ' a4-ledger-head--brandless'}`}>{brandIdentity && <section className="a4-ledger-brand"><SellerBrand model={model} visible={branding} /></section>}<section className="a4-ledger-document"><DocumentTitle model={model} /></section><section className="a4-ledger-meta"><DateMeta model={model} /></section></header>
    <div className={partyLayout('a4-ledger-parties', model)}><Seller model={model} /><Buyer model={model} /></div>
    <Adjustment model={model} />
    <LedgerItemTable model={model} />
    <div className="a4-ledger-closeout a4-closing-group"><section className="a4-ledger-payment"><Payment model={model} />{!options.nonFiscalDemo && <QrVerification model={model} options={options} />}</section><section className="a4-ledger-totals"><Totals model={model} /></section></div>
    <Footer model={model} />
  </Shell>
}
function ContemporaryModularDecoration() {
  return <div className="a4-contemporary-decoration" aria-hidden="true"><i className="a4-contemporary-decoration__top" /><i className="a4-contemporary-decoration__top-accent" /><i className="a4-contemporary-decoration__bottom" /><i className="a4-contemporary-decoration__bottom-accent" /></div>
}
function ContemporaryModularV1({ model, options = {} }: A4DocumentProps) {
  const branding = showsStandardBranding(model, options)
  const namedBuyer = hasNamedBuyer(model)
  const hasFooter = [model.presentation.footer.thankYouVisible ? model.presentation.footer.thankYou : null, model.presentation.footer.footerVisible ? model.presentation.footer.footer : null, model.presentation.footer.refundVisible ? model.presentation.footer.refund : null].some(Boolean)
  return <Shell template="contemporary_border" model={model} options={options}>
    <ContemporaryModularDecoration />
    <header className="a4-contemporary-head"><section className="a4-contemporary-document"><div className="a4-contemporary-document-copy"><DocumentTitle model={model} /><DateMeta model={model} /></div></section><section className="a4-contemporary-recipient">{namedBuyer ? <Buyer model={model} /> : <Seller model={model} />}</section></header>
    {namedBuyer && <section className="a4-contemporary-seller"><SellerBrand model={model} visible={branding} /><Seller model={model} /></section>}
    <Adjustment model={model} />
    <ContemporaryItemTable model={model} />
    <div className="a4-contemporary-closeout a4-closing-group">{!options.nonFiscalDemo && <section className="a4-contemporary-qr"><QrVerification model={model} options={options} /></section>}<section className="a4-contemporary-payment"><Payment model={model} /></section><section className="a4-contemporary-totals"><Totals model={model} /></section></div>
    {hasFooter && <section className="a4-contemporary-lower"><Footer model={model} /></section>}
  </Shell>
}
function ExecutiveProfessionalV1({ model, options = {} }: A4DocumentProps) {
  const branding = showsStandardBranding(model, options)
  const brandIdentity = branding && (Boolean(model.presentation.logo.visible && (model.presentation.logo.previewUrl ?? model.presentation.logo.assetPath)) || [model.seller.displayHeading, model.seller.displaySubheading].some(value => normalizedIdentity(value) !== '' && !isLegalSellerIdentity(model.seller, value)))
  return <Shell template="executive_professional" model={model} options={options}>
    <header className={`a4-execpro-head${brandIdentity ? '' : ' a4-execpro-head--brandless'}`}><section className="a4-execpro-brand">{brandIdentity && <SellerBrand model={model} visible={branding} />}</section><section className={`a4-execpro-document${options.nonFiscalDemo ? ' a4-execpro-document--without-qr' : ''}`}><div><DocumentTitle model={model} /><DateMeta model={model} /></div></section></header>
    <div className={partyLayout('a4-execpro-parties', model)}><section><Seller model={model} /></section>{hasNamedBuyer(model) && <section><Buyer model={model} /></section>}</div>
    <Adjustment model={model} />
    <ContemporaryItemTable model={model} />
    <div className="a4-execpro-closeout a4-closing-group">{!options.nonFiscalDemo && <section className="a4-execpro-qr"><QrVerification model={model} options={options} /></section>}<section className="a4-execpro-payment"><Payment model={model} /></section><section className="a4-execpro-totals"><Totals model={model} /></section></div>
    <Footer model={model} />
  </Shell>
}
function CreativeStudioDecoration() {
  return <div className="a4-creative-decoration" aria-hidden="true"><i className="a4-creative-decoration__orb" /><i className="a4-creative-decoration__arc" /><i className="a4-creative-decoration__block" /><i className="a4-creative-decoration__footer" /></div>
}
function CreativeStudioV1({ model, options = {} }: A4DocumentProps) {
  const branding = showsStandardBranding(model, options)
  const brandIdentity = branding && (Boolean(model.presentation.logo.visible && (model.presentation.logo.previewUrl ?? model.presentation.logo.assetPath)) || [model.seller.displayHeading, model.seller.displaySubheading].some(value => normalizedIdentity(value) !== '' && !isLegalSellerIdentity(model.seller, value)))
  return <Shell template="creative_studio" model={model} options={options}>
    <CreativeStudioDecoration />
    <header className={`a4-creative-head${brandIdentity ? '' : ' a4-creative-head--brandless'}`}>
      {brandIdentity && <section className="a4-creative-brand"><SellerBrand model={model} visible={branding} /></section>}
      <section className={`a4-creative-document${options.nonFiscalDemo ? ' a4-creative-document--without-qr' : ''}`}><div className="a4-creative-document-copy"><DocumentTitle model={model} /><DateMeta model={model} /></div>{!options.nonFiscalDemo && <section className="a4-creative-qr"><QrVerification model={model} options={options} /></section>}</section>
    </header>
    <div className={partyLayout('a4-creative-parties', model)}><section className="a4-creative-party"><Seller model={model} /></section>{hasNamedBuyer(model) && <section className="a4-creative-party"><Buyer model={model} /></section>}</div>
    <Adjustment model={model} />
    <ContemporaryItemTable model={model} />
    <div className="a4-creative-closeout a4-closing-group"><section className="a4-creative-payment"><Payment model={model} /></section><section className="a4-creative-totals"><Totals model={model} /></section></div>
    <Footer model={model} />
  </Shell>
}

const RENDERERS: Record<A4TemplateRendererId, (props: A4DocumentProps) => ReactNode> = {
  classic_v1: ClassicV1,
  modern_statement_v1: ModernStatementV1,
  minimal_professional_v1: MinimalProfessionalV1,
  executive_frame_v1: ExecutiveFrameV1,
  accounting_ledger_v1: AccountingLedgerV1,
  contemporary_modular_v1: ContemporaryModularV1,
  executive_professional_v1: ExecutiveProfessionalV1,
  creative_studio_v1: CreativeStudioV1,
}

export default function A4Document({ model, options = {} }: A4DocumentProps) {
  const resolved = resolveA4Template(model)
  const Template = RENDERERS[resolved.renderer] ?? RENDERERS[A4_TEMPLATE_REGISTRY.classic.renderer]
  const target = options.pdfMode ? 'pdf' : options.preview ? 'preview' : 'print'
  return <div id={options.id ?? 'a4-document'} className={`a4-document-frame ${options.preview ? '' : 'a4-document-frame--print-only'}`} data-render-target={target} data-template-requested={`${resolved.requestedId}@${resolved.requestedVersion}`} data-template-resolved={`${resolved.resolvedId}@${resolved.resolvedVersion}`} data-layout-landmarks={A4_TEMPLATE_REGISTRY[resolved.resolvedId].landmarks.join(' ')} data-qr-region={A4_TEMPLATE_REGISTRY[resolved.resolvedId].qrRegion} style={{ fontFamily: documentFontFamily(model.identity.language) }}><Template model={model} options={options} /></div>
}
