import type { Branch, Invoice, InvoiceIdentitySnapshot, InvoiceItem, InvoicePresentationSettings, Payment } from '@/types/database'
import { buildPresentationDocument, documentLanguage, type DocumentViewModel } from './documentViewModel'
import { DOCUMENT_PREVIEW_FIXTURE } from './documentPreviewFixture'
import { resolveRuntimeInvoicePresentation, type RuntimePresentationBranch } from './runtimePresentation'

export interface DocumentCustomerInput { readonly name: string | null; readonly nameAr: string | null; readonly vatNumber: string | null; readonly address?: string | null; readonly addressAr?: string | null; readonly identifierType?: string | null; readonly identifierValue?: string | null; readonly type?: string | null }
export interface DocumentTenantInput { readonly name?: string | null; readonly name_ar?: string | null; readonly vat_number?: string | null; readonly cr_number?: string | null; readonly address?: string | null }
export interface StoredDocumentInput { readonly invoice: Invoice; readonly branch: Branch; readonly tenant?: DocumentTenantInput | null; readonly items: readonly InvoiceItem[]; readonly payments: readonly Payment[]; readonly customer?: DocumentCustomerInput | null; readonly originalInvoiceNumber?: string | null }
export interface InvoicePresentationDraft { readonly presentation: InvoicePresentationSettings; readonly invoiceLanguage: 'en' | 'ar' | 'both'; readonly printMode: 'thermal' | 'pdf' | 'both'; readonly afterSaleAction?: 'receipt' | 'a4' | 'both'; readonly preservedSettings?: Record<string, unknown> }
export interface PreviewSellerOverrides { readonly registeredName?: string; readonly registeredNameAr?: string | null; readonly vatNumber?: string; readonly registeredAddress?: string | null; readonly branchName?: string | null; readonly branchNameAr?: string | null }
export interface PosReceiptDocumentInput { readonly invoiceNumber: string; readonly createdAt: string; readonly documentLanguage: 'en' | 'ar' | 'both'; readonly businessNameEn: string; readonly businessNameAr: string | null; readonly branchName: string; readonly branchNameAr: string | null; readonly branchAddress: string | null; readonly vatNumber: string; readonly logoUrl: string | null; readonly showLogo: boolean; readonly phone: string | null; readonly email: string | null; readonly website: string | null; readonly showEmail: boolean; readonly showWebsite: boolean; readonly receiptFooter: string | null; readonly showFooter: boolean; readonly showCashChange: boolean; readonly subtotal: number; readonly taxAmount: number; readonly total: number; readonly discountAmount?: number; readonly paymentMethod: string; readonly payments: readonly { method: string; amount: number; amountReceived?: number | null; changeAmount?: number | null }[]; readonly cashReceived?: number | null; readonly change?: number | null; readonly customerName: string | null; readonly customerNameAr: string | null; readonly customerAddress?: string | null; readonly customerAddressAr?: string | null; readonly buyerVatNumber: string | null; readonly buyerIdentifierType?: string | null; readonly buyerIdentifierValue?: string | null; readonly isStandardInvoice: boolean; readonly zatcaQrCode?: string | null; readonly items: readonly { name: string; nameAr?: string | null; qty: number; unitPrice: number; lineTotal: number; subtotal?: number; taxAmount?: number; taxRate?: number; taxCategory?: string | null }[]; readonly presentationSettings?: unknown; readonly branchDefaults?: RuntimePresentationBranch }

export function documentFromPosReceipt(input: PosReceiptDocumentInput): DocumentViewModel {
  const branch = input.branchDefaults ?? { name: input.branchName, name_ar: input.branchNameAr, business_name: input.businessNameEn, business_name_ar: input.businessNameAr, phone: input.phone, email: input.email, website: input.website, address: input.branchAddress, show_email: input.showEmail, show_website: input.showWebsite, receipt_footer: input.receiptFooter, show_footer: input.showFooter, show_cash_change: input.showCashChange, show_logo: input.showLogo, logo_url: input.logoUrl, invoice_language: input.documentLanguage, print_mode: 'thermal' }
  const resolved = resolveRuntimeInvoicePresentation({ branch, savedSettings: input.presentationSettings })
  const payments = input.payments.map(payment => ({ method: payment.method, amount: payment.amount, cashTendered: payment.method === 'cash' ? payment.amountReceived ?? input.cashReceived ?? null : null, change: payment.method === 'cash' ? payment.changeAmount ?? input.change ?? null : null, reference: null }))
  const buyerAddress = resolved.invoiceLanguage === 'ar' ? input.customerAddressAr ?? input.customerAddress ?? null : input.customerAddress ?? input.customerAddressAr ?? null
  return buildPresentationDocument({ settings: resolved.presentation, language: resolved.invoiceLanguage, printMode: resolved.printMode, registeredName: input.businessNameEn, registeredNameAr: input.businessNameAr, vatNumber: input.vatNumber, registrationType: null, registrationNumber: null, registeredAddress: input.branchAddress, branchName: input.branchName, branchNameAr: input.branchNameAr, logoPreviewUrl: resolved.logoUrl }, { source: 'legacy', identity: { kind: 'invoice', invoiceType: input.isStandardInvoice ? 'standard' : 'simplified', number: input.invoiceNumber, uuid: null, issueTimestamp: input.createdAt, supplyDate: null, language: resolved.invoiceLanguage, direction: resolved.invoiceLanguage === 'ar' ? 'rtl' : 'ltr', snapshotVersion: null, legacy: true, fidelity: 'best_effort' }, buyer: { name: input.customerName, nameAr: input.customerNameAr, vatNumber: input.buyerVatNumber, address: buyerAddress, addressAr: input.customerAddressAr ?? null, identifierType: input.buyerIdentifierType ?? null, identifierValue: input.buyerIdentifierValue ?? null, type: input.isStandardInvoice ? 'business' : 'individual' }, items: input.items.map(item => ({ description: item.name, descriptionAr: item.nameAr ?? null, quantity: item.qty, unitPrice: item.unitPrice, discount: 0, taxableAmount: item.subtotal ?? item.lineTotal, vatRate: rate(item.taxRate), vatAmount: item.taxAmount ?? 0, vatCategory: item.taxCategory ?? null, lineTotal: item.lineTotal, creditedQuantity: null })), totals: { currency: 'SAR', subtotal: input.subtotal, discount: input.discountAmount ?? 0, taxableAmount: input.subtotal, vat: input.taxAmount, total: input.total, paid: payments.reduce((sum, payment) => sum + payment.amount, 0), refunded: 0, balance: input.total - payments.reduce((sum, payment) => sum + payment.amount, 0) }, payments, compliance: { qr: { source: input.zatcaQrCode ? 'stored_reference' : 'unavailable', reference: input.zatcaQrCode ?? null }, xmlState: 'unavailable', originalDocument: { id: null, number: null }, creditReason: null } })
}

const address = (value: { buildingNumber?: string | null; street?: string | null; district?: string | null; city?: string | null; country?: string | null; postalCode?: string | null }) => [value.buildingNumber, value.street, value.district, value.city, value.country, value.postalCode].filter(Boolean).join(', ') || null
const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const rate = (value: unknown) => { const numeric = n(value); return Math.abs(numeric) <= 1 ? numeric * 100 : numeric }

function base(input: StoredDocumentInput, source: DocumentViewModel['source'], snapshotVersion: 1 | 2 | null, legacy: boolean): Omit<DocumentViewModel, 'seller' | 'presentation' | 'template' | 'format'> {
  const { invoice, items, payments, customer } = input
  const paid = payments.reduce((sum, payment) => sum + n(payment.amount), 0)
  const isCredit = invoice.zatca_invoice_type === 'credit_note'
  const isDebit = invoice.zatca_invoice_type === 'debit_note'
  return {
    source,
    identity: { kind: isCredit ? 'credit_note' : isDebit ? 'debit_note' : 'invoice', invoiceType: invoice.zatca_invoice_type, number: invoice.invoice_number, uuid: invoice.zatca_uuid || null, issueTimestamp: invoice.created_at, supplyDate: invoice.supply_date, language: documentLanguage(invoice.document_language), direction: 'ltr', snapshotVersion, legacy, fidelity: legacy ? 'best_effort' : 'exact_snapshot' },
    buyer: { name: customer?.name ?? null, nameAr: customer?.nameAr ?? null, vatNumber: customer?.vatNumber ?? null, address: customer?.address ?? null, addressAr: customer?.addressAr ?? null, identifierType: customer?.identifierType ?? null, identifierValue: customer?.identifierValue ?? null, type: customer?.type ?? null },
    items: items.map(item => ({ description: item.name, descriptionAr: item.name_ar, quantity: n(item.quantity), unitPrice: n(item.unit_price), discount: n(item.discount_amount), taxableAmount: n(item.subtotal), vatRate: rate(item.tax_rate), vatAmount: n(item.tax_amount), vatCategory: item.tax_category, lineTotal: n(item.total), creditedQuantity: isCredit ? n(item.quantity) : null })),
    totals: { currency: 'SAR', subtotal: n(invoice.subtotal), discount: n(invoice.discount_amount), taxableAmount: n(invoice.taxable_amount), vat: n(invoice.tax_amount), total: n(invoice.total_amount), paid: isCredit ? 0 : paid, refunded: isCredit ? paid : 0, balance: isCredit ? null : n(invoice.total_amount) - paid },
    payments: payments.map(payment => ({ method: payment.method, amount: n(payment.amount), cashTendered: payment.method === 'cash' && payment.amount_received != null ? n(payment.amount_received) : null, change: payment.method === 'cash' && payment.change_amount != null ? n(payment.change_amount) : null, reference: payment.reference })),
    compliance: { qr: { source: invoice.zatca_qr_code ? 'stored_reference' : 'unavailable', reference: invoice.zatca_qr_code ?? null }, xmlState: invoice.zatca_xml ? 'available' : 'unavailable', originalDocument: { id: invoice.original_invoice_id, number: invoice.invoice_reference ?? input.originalInvoiceNumber ?? null }, creditReason: invoice.credit_reason },
  }
}

function fromSnapshot(input: StoredDocumentInput, snapshot: InvoiceIdentitySnapshot): DocumentViewModel {
  const b = base(input, snapshot.version === 2 ? 'snapshot_v2' : 'snapshot_v1', snapshot.version, false)
  const compliance = snapshot.compliance
  // Historical snapshots retain their captured compliance address when no
  // presentation override was saved; never substitute the current branch
  // address into an old document.
  const snapshotBranch = { ...input.branch, address: null }
  if (snapshot.version === 2) {
    const resolved = resolveRuntimeInvoicePresentation({ branch: snapshotBranch, savedSettings: snapshot.presentationSettings })
    return buildPresentationDocument({ settings: resolved.presentation, language: snapshot.document.language, printMode: snapshot.document.printMode, registeredName: compliance.registeredSellerName, registeredNameAr: compliance.registeredSellerNameAr, vatNumber: compliance.vatNumber, registrationType: compliance.registrationScheme, registrationNumber: compliance.registrationIdentifier, registeredAddress: address(compliance.address), branchName: null, branchNameAr: null, logoPreviewUrl: resolved.logoUrl }, b)
  }
  const p = snapshot.presentation
  const settings: InvoicePresentationSettings = {
    schema_version: 1,
    identity: { display_heading: p.displayHeading, display_subheading: p.displaySubheading, custom_display_name: p.branchDisplayName, show_company_name: p.showCompanyDisplayName, show_branch_name: p.showBranchDisplayName },
    contact: { phone: p.phone, email: p.email, website: p.website, address_override: null, show_phone: !!p.phone, show_email: p.showEmail, show_website: p.showWebsite, show_address: true },
    footer: { thank_you_message: null, footer_note: p.footer, refund_note: null, show_thank_you: false, show_footer: p.showFooter, show_refund_note: false },
    logo: { visible: p.showLogo, asset_path: p.logoUrl, asset_version: p.logoAssetVersion, size: 'medium' },
    thermal: { width: '80mm', density: snapshot.document.thermalDensity === 'compact' || snapshot.document.thermalDensity === 'detailed' ? snapshot.document.thermalDensity : 'standard', qr_size: 'standard', wrap_item_names: true, show_cash_change: p.showCashChange },
    a4: { template_id: snapshot.document.a4TemplateId as InvoicePresentationSettings['a4']['template_id'], template_version: 1, header_style: 'standard' },
  }
  const resolved = resolveRuntimeInvoicePresentation({ branch: snapshotBranch, savedSettings: settings })
  return buildPresentationDocument({ settings: resolved.presentation, language: snapshot.document.language, printMode: snapshot.document.printMode, registeredName: compliance.registeredSellerName, registeredNameAr: compliance.registeredSellerNameAr, vatNumber: compliance.vatNumber, registrationType: compliance.registrationScheme, registrationNumber: compliance.registrationIdentifier, registeredAddress: address(compliance.address), branchName: p.branchDisplayName, branchNameAr: p.branchDisplayNameAr, logoPreviewUrl: resolved.logoUrl }, b)
}

export function documentFromStoredInvoiceV2(input: StoredDocumentInput): DocumentViewModel { if (input.invoice.identity_snapshot?.version !== 2) throw new Error('Expected snapshot v2'); return fromSnapshot(input, input.invoice.identity_snapshot) }
export function documentFromStoredInvoiceV1(input: StoredDocumentInput): DocumentViewModel { if (input.invoice.identity_snapshot?.version !== 1) throw new Error('Expected snapshot v1'); return fromSnapshot(input, input.invoice.identity_snapshot) }
export function documentFromLegacyInvoice(input: StoredDocumentInput): DocumentViewModel {
  const { branch, tenant } = input
  const resolved = resolveRuntimeInvoicePresentation({ branch })
  const registeredName = branch.business_name || tenant?.name || branch.name
  const registeredNameAr = branch.business_name_ar || tenant?.name_ar || branch.name_ar
  const registeredAddress = address({ buildingNumber: branch.building_number, street: branch.street, district: branch.district, city: branch.city, country: branch.country, postalCode: branch.postal_code }) || tenant?.address || null
  return buildPresentationDocument({ settings: resolved.presentation, language: documentLanguage(input.invoice.document_language ?? resolved.invoiceLanguage), printMode: resolved.printMode, registeredName, registeredNameAr, vatNumber: branch.vat_number || tenant?.vat_number || '', registrationType: 'CR', registrationNumber: branch.cr_number || tenant?.cr_number || null, registeredAddress, branchName: branch.name, branchNameAr: branch.name_ar, logoPreviewUrl: resolved.logoUrl }, base(input, 'legacy', null, true))
}
export function documentFromStoredInvoice(input: StoredDocumentInput): DocumentViewModel { return input.invoice.identity_snapshot?.version === 2 ? documentFromStoredInvoiceV2(input) : input.invoice.identity_snapshot?.version === 1 ? documentFromStoredInvoiceV1(input) : documentFromLegacyInvoice(input) }
export function documentFromFullCreditNote(input: StoredDocumentInput): DocumentViewModel { return documentFromStoredInvoice(input) }
export function documentFromPartialCreditNote(input: StoredDocumentInput): DocumentViewModel { return documentFromStoredInvoice(input) }

export function documentFromPreviewDraft(draft: InvoicePresentationDraft, logoPreviewUrl: string | null = null, sellerOverrides?: PreviewSellerOverrides): DocumentViewModel {
  return previewDocument(draft, logoPreviewUrl, 'invoice', sellerOverrides)
}

export function documentFromPreviewCreditNoteDraft(draft: InvoicePresentationDraft, logoPreviewUrl: string | null = null, sellerOverrides?: PreviewSellerOverrides): DocumentViewModel { return previewDocument(draft, logoPreviewUrl, 'credit_note', sellerOverrides) }

function previewDocument(draft: InvoicePresentationDraft, logoPreviewUrl: string | null, kind: 'invoice' | 'credit_note', sellerOverrides?: PreviewSellerOverrides): DocumentViewModel {
  const { seller: fixtureSeller, buyer, invoice, creditNote, items, payments } = DOCUMENT_PREVIEW_FIXTURE
  const seller = { ...fixtureSeller, ...sellerOverrides }
  const isCredit = kind === 'credit_note'
  return buildPresentationDocument({ settings: draft.presentation, language: draft.invoiceLanguage, printMode: draft.printMode, registeredName: seller.registeredName, registeredNameAr: seller.registeredNameAr, vatNumber: seller.vatNumber, registrationType: seller.registrationType, registrationNumber: seller.registrationNumber, registeredAddress: draft.presentation.contact.address_override || seller.address, branchName: seller.branchName, branchNameAr: seller.branchNameAr, logoPreviewUrl }, {
    source: 'preview', identity: { kind, invoiceType: isCredit ? 'credit_note' : 'simplified', number: isCredit ? creditNote.number : invoice.number, uuid: null, issueTimestamp: isCredit ? creditNote.issueTimestamp : invoice.issueTimestamp, supplyDate: null, language: draft.invoiceLanguage, direction: draft.invoiceLanguage === 'ar' ? 'rtl' : 'ltr', snapshotVersion: null, legacy: false, fidelity: 'sample' },
    buyer: { name: buyer.name, nameAr: buyer.nameAr, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, type: 'individual' },
    items: items.map(item => ({ ...item, creditedQuantity: isCredit ? item.quantity : null })),
    totals: { currency: 'SAR', subtotal: invoice.subtotal, discount: invoice.discount, taxableAmount: invoice.taxableAmount, vat: invoice.vat, total: invoice.total, paid: isCredit ? 0 : invoice.total, refunded: isCredit ? invoice.total : 0, balance: isCredit ? null : 0 },
    payments: payments.map(payment => ({ ...payment })),
    compliance: { qr: { source: 'sample', reference: isCredit ? creditNote.qrMarker : invoice.qrMarker }, xmlState: 'unavailable', originalDocument: { id: null, number: isCredit ? creditNote.originalNumber : null }, creditReason: isCredit ? creditNote.reason : null },
  })
}
