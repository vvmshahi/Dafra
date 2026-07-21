import type { Branch, Invoice, InvoiceIdentitySnapshot, InvoiceItem, InvoicePresentationSettings, Payment } from '@/types/database'
import { buildPresentationDocument, documentLanguage, type DocumentViewModel } from './documentViewModel'
import { DOCUMENT_PREVIEW_FIXTURE } from './documentPreviewFixture'

export interface DocumentCustomerInput { readonly name: string | null; readonly nameAr: string | null; readonly vatNumber: string | null; readonly address?: string | null; readonly type?: string | null }
export interface StoredDocumentInput { readonly invoice: Invoice; readonly branch: Branch; readonly items: readonly InvoiceItem[]; readonly payments: readonly Payment[]; readonly customer?: DocumentCustomerInput | null; readonly originalInvoiceNumber?: string | null }
export interface InvoicePresentationDraft { readonly presentation: InvoicePresentationSettings; readonly invoiceLanguage: 'en' | 'ar' | 'both'; readonly printMode: 'thermal' | 'pdf' | 'both' }

const address = (value: { buildingNumber?: string | null; street?: string | null; district?: string | null; city?: string | null; country?: string | null; postalCode?: string | null }) => [value.buildingNumber, value.street, value.district, value.city, value.country, value.postalCode].filter(Boolean).join(', ') || null
const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0

function base(input: StoredDocumentInput, source: DocumentViewModel['source'], snapshotVersion: 1 | 2 | null, legacy: boolean): Omit<DocumentViewModel, 'seller' | 'presentation' | 'template' | 'format'> {
  const { invoice, items, payments, customer } = input
  const paid = payments.reduce((sum, payment) => sum + n(payment.amount), 0)
  const isCredit = invoice.zatca_invoice_type === 'credit_note'
  return {
    source,
    identity: { kind: isCredit ? 'credit_note' : 'invoice', invoiceType: invoice.zatca_invoice_type, number: invoice.invoice_number, uuid: invoice.zatca_uuid || null, issueTimestamp: invoice.created_at, language: documentLanguage(invoice.document_language), direction: 'ltr', snapshotVersion, legacy, fidelity: legacy ? 'best_effort' : 'exact_snapshot' },
    buyer: { name: customer?.name ?? null, nameAr: customer?.nameAr ?? null, vatNumber: customer?.vatNumber ?? null, address: customer?.address ?? null, type: customer?.type ?? null },
    items: items.map(item => ({ description: item.name, descriptionAr: item.name_ar, quantity: n(item.quantity), unitPrice: n(item.unit_price), discount: n(item.discount_amount), taxableAmount: n(item.subtotal), vatRate: n(item.tax_rate), vatAmount: n(item.tax_amount), lineTotal: n(item.total), creditedQuantity: isCredit ? n(item.quantity) : null })),
    totals: { currency: 'SAR', subtotal: n(invoice.subtotal), discount: n(invoice.discount_amount), taxableAmount: n(invoice.taxable_amount), vat: n(invoice.tax_amount), total: n(invoice.total_amount), paid: isCredit ? 0 : paid, refunded: isCredit ? paid : 0, balance: isCredit ? null : n(invoice.total_amount) - paid },
    payments: payments.map(payment => ({ method: payment.method, amount: n(payment.amount), cashTendered: payment.method === 'cash' ? n(payment.amount_received) : null, change: payment.method === 'cash' ? n(payment.change_amount) : null, reference: payment.reference })),
    compliance: { qr: { source: invoice.zatca_qr_code ? 'stored_reference' : 'unavailable', reference: invoice.zatca_qr_code ?? null }, xmlState: invoice.zatca_xml ? 'available' : 'unavailable', originalDocument: { id: invoice.original_invoice_id, number: invoice.invoice_reference ?? input.originalInvoiceNumber ?? null }, creditReason: invoice.credit_reason },
  }
}

function fromSnapshot(input: StoredDocumentInput, snapshot: InvoiceIdentitySnapshot): DocumentViewModel {
  const b = base(input, snapshot.version === 2 ? 'snapshot_v2' : 'snapshot_v1', snapshot.version, false)
  const compliance = snapshot.compliance
  if (snapshot.version === 2) return buildPresentationDocument({ settings: snapshot.presentationSettings, language: snapshot.document.language, printMode: snapshot.document.printMode, registeredName: compliance.registeredSellerName, registeredNameAr: compliance.registeredSellerNameAr, vatNumber: compliance.vatNumber, registrationType: compliance.registrationScheme, registrationNumber: compliance.registrationIdentifier, registeredAddress: address(compliance.address), branchName: null, branchNameAr: null }, b)
  const p = snapshot.presentation
  const settings: InvoicePresentationSettings = {
    schema_version: 1,
    identity: { display_heading: p.displayHeading, display_subheading: p.displaySubheading, custom_display_name: p.branchDisplayName, show_company_name: p.showCompanyDisplayName, show_branch_name: p.showBranchDisplayName },
    contact: { phone: p.phone, email: p.email, website: p.website, show_phone: !!p.phone, show_email: p.showEmail, show_website: p.showWebsite, show_address: true },
    footer: { thank_you_message: null, footer_note: p.footer, refund_note: null, show_thank_you: false, show_footer: p.showFooter, show_refund_note: false },
    logo: { visible: p.showLogo, asset_path: p.logoUrl, asset_version: p.logoAssetVersion, size: 'medium' },
    thermal: { width: '80mm', density: snapshot.document.thermalDensity === 'compact' || snapshot.document.thermalDensity === 'detailed' ? snapshot.document.thermalDensity : 'standard', qr_size: 'standard', wrap_item_names: true, show_cash_change: p.showCashChange },
    a4: { template_id: snapshot.document.a4TemplateId as InvoicePresentationSettings['a4']['template_id'], template_version: 1, header_style: 'standard' },
  }
  return buildPresentationDocument({ settings, language: snapshot.document.language, printMode: snapshot.document.printMode, registeredName: compliance.registeredSellerName, registeredNameAr: compliance.registeredSellerNameAr, vatNumber: compliance.vatNumber, registrationType: compliance.registrationScheme, registrationNumber: compliance.registrationIdentifier, registeredAddress: address(compliance.address), branchName: p.branchDisplayName, branchNameAr: p.branchDisplayNameAr }, b)
}

export function documentFromStoredInvoiceV2(input: StoredDocumentInput): DocumentViewModel { if (input.invoice.identity_snapshot?.version !== 2) throw new Error('Expected snapshot v2'); return fromSnapshot(input, input.invoice.identity_snapshot) }
export function documentFromStoredInvoiceV1(input: StoredDocumentInput): DocumentViewModel { if (input.invoice.identity_snapshot?.version !== 1) throw new Error('Expected snapshot v1'); return fromSnapshot(input, input.invoice.identity_snapshot) }
export function documentFromLegacyInvoice(input: StoredDocumentInput): DocumentViewModel {
  const { branch } = input
  const settings = branch.presentation_settings ?? { schema_version: 1, identity: { display_heading: branch.display_name, display_subheading: null, custom_display_name: branch.name, show_company_name: true, show_branch_name: true }, contact: { phone: branch.phone, email: branch.email, website: branch.website, show_phone: !!branch.phone, show_email: branch.show_email, show_website: branch.show_website, show_address: true }, footer: { thank_you_message: null, footer_note: branch.receipt_footer, refund_note: null, show_thank_you: false, show_footer: branch.show_footer, show_refund_note: false }, logo: { visible: branch.show_logo, asset_path: branch.logo_url, asset_version: branch.logo_asset_version, size: 'medium' }, thermal: { width: '80mm', density: branch.thermal_density, qr_size: 'standard', wrap_item_names: true, show_cash_change: branch.show_cash_change }, a4: { template_id: 'classic', template_version: 1, header_style: 'standard' } }
  return buildPresentationDocument({ settings, language: documentLanguage(input.invoice.document_language ?? branch.invoice_language), printMode: branch.print_mode, registeredName: branch.business_name || branch.name, registeredNameAr: branch.business_name_ar, vatNumber: branch.vat_number || '', registrationType: 'CR', registrationNumber: branch.cr_number, registeredAddress: address({ buildingNumber: branch.building_number, street: branch.street, district: branch.district, city: branch.city, country: branch.country, postalCode: branch.postal_code }), branchName: branch.name, branchNameAr: branch.name_ar }, base(input, 'legacy', null, true))
}
export function documentFromStoredInvoice(input: StoredDocumentInput): DocumentViewModel { return input.invoice.identity_snapshot?.version === 2 ? documentFromStoredInvoiceV2(input) : input.invoice.identity_snapshot?.version === 1 ? documentFromStoredInvoiceV1(input) : documentFromLegacyInvoice(input) }
export function documentFromFullCreditNote(input: StoredDocumentInput): DocumentViewModel { return documentFromStoredInvoice(input) }
export function documentFromPartialCreditNote(input: StoredDocumentInput): DocumentViewModel { return documentFromStoredInvoice(input) }

export function documentFromPreviewDraft(draft: InvoicePresentationDraft, logoPreviewUrl: string | null = null): DocumentViewModel {
  return previewDocument(draft, logoPreviewUrl, 'invoice')
}

export function documentFromPreviewCreditNoteDraft(draft: InvoicePresentationDraft, logoPreviewUrl: string | null = null): DocumentViewModel { return previewDocument(draft, logoPreviewUrl, 'credit_note') }

function previewDocument(draft: InvoicePresentationDraft, logoPreviewUrl: string | null, kind: 'invoice' | 'credit_note'): DocumentViewModel {
  const { seller, buyer, invoice, creditNote, items, payments } = DOCUMENT_PREVIEW_FIXTURE
  const isCredit = kind === 'credit_note'
  return buildPresentationDocument({ settings: draft.presentation, language: draft.invoiceLanguage, printMode: draft.printMode, registeredName: seller.registeredName, registeredNameAr: seller.registeredNameAr, vatNumber: seller.vatNumber, registrationType: seller.registrationType, registrationNumber: seller.registrationNumber, registeredAddress: seller.address, branchName: seller.branchName, branchNameAr: seller.branchNameAr, logoPreviewUrl }, {
    source: 'preview', identity: { kind, invoiceType: isCredit ? 'credit_note' : 'simplified', number: isCredit ? creditNote.number : invoice.number, uuid: null, issueTimestamp: isCredit ? creditNote.issueTimestamp : invoice.issueTimestamp, language: draft.invoiceLanguage, direction: draft.invoiceLanguage === 'ar' ? 'rtl' : 'ltr', snapshotVersion: null, legacy: false, fidelity: 'sample' },
    buyer: { name: buyer.name, nameAr: buyer.nameAr, vatNumber: null, address: null, type: 'individual' },
    items: items.map(item => ({ ...item, creditedQuantity: isCredit ? item.quantity : null })),
    totals: { currency: 'SAR', subtotal: invoice.subtotal, discount: invoice.discount, taxableAmount: invoice.taxableAmount, vat: invoice.vat, total: invoice.total, paid: isCredit ? 0 : invoice.total, refunded: isCredit ? invoice.total : 0, balance: isCredit ? null : 0 },
    payments: payments.map(payment => ({ ...payment })),
    compliance: { qr: { source: 'sample', reference: isCredit ? creditNote.qrMarker : invoice.qrMarker }, xmlState: 'unavailable', originalDocument: { id: null, number: isCredit ? creditNote.originalNumber : null }, creditReason: isCredit ? creditNote.reason : null },
  })
}
