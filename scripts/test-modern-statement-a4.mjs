import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

process.env.VITE_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ??= 'anonymous-test-key'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const source = read('src/components/print/A4Document.tsx')
const css = read('src/index.css')

for (const marker of ['ModernStatementItemName', 'ModernStatementItemTable', 'a4-statement-brand', 'a4-statement-meta-card', 'a4-statement-party-card', 'a4-statement-totals']) assert.match(source, new RegExp(marker))
for (const marker of ['a4-statement-head--identityless', 'a4-statement-document--without-qr', 'a4-statement-qr-card', 'a4-statement-items--with-discount', 'a4-statement-closeout', 'a4-statement-closeout \\+ .a4-footer:empty']) assert.match(css, new RegExp(marker))
assert.doesNotMatch(css.match(/\/\* 1 — Classic Business \*\/[\s\S]*?\/\* 2 — Modern Statement \*\//)?.[0] ?? '', /a4-statement/)
assert.match(css, /\.a4-statement-totals \.a4-totals__grand \{ margin: 0 !important;/)
assert.match(css, /\.a4-statement-items th \{[^}]*white-space: normal/)
assert.match(css, /\.a4-statement-payment-card \{ align-self: start/)

const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } })
try {
  const [a4, adapters, settings] = await Promise.all([
    server.ssrLoadModule('/src/components/print/A4Document.tsx'),
    server.ssrLoadModule('/src/lib/invoices/documentViewAdapters.ts'),
    server.ssrLoadModule('/src/lib/invoices/presentationSettings.ts'),
  ])
  const { default: A4Document } = a4
  const normalized = settings.normalizeInvoiceSettings({
    invoice_language: 'both', print_mode: 'pdf', presentation_settings: {
      identity: { display_heading: 'Trading House', display_subheading: 'Wholesale division' },
      logo: { visible: true, asset_path: 'data:image/png;base64,RklYVFVSRQ==' },
      contact: { show_phone: true, show_email: true, show_website: true },
      footer: { footer_note: 'Thank you for your business.', show_footer: true },
      a4: { template_id: 'modern_split', accent_color: '#0f766e', heading_color: '#134e4a', body_color: '#1f2937' },
    },
  }, {
    business_name: 'Legal Seller Co', business_name_ar: null, name: 'Trading House', name_ar: null,
    vat_number: '300000000000003', cr_number: '1010999999', address: 'King Fahd Road, Riyadh',
    phone: '+966500000001', email: 'seller@example.com', website: 'https://seller.example', show_email: true, show_website: true,
  })
  const draft = { presentation: normalized.presentation, invoiceLanguage: normalized.invoiceLanguage, printMode: normalized.printMode, afterSaleAction: normalized.afterSaleAction }
  const base = adapters.documentFromPreviewDraft(draft, 'data:image/png;base64,RklYVFVSRQ==', { registeredName: 'Legal Seller Co', registeredNameAr: null, registeredAddress: 'King Fahd Road, Riyadh' })
  const modern = model => ({ ...model, template: { ...model.template, requestedId: 'modern_split', resolvedId: 'modern_split', requestedVersion: 1, resolvedVersion: 1, fallback: false, fallbackReason: null } })
  const render = (model, options = {}) => renderToStaticMarkup(createElement(A4Document, { model: modern(model), options }))
  const surface = markup => markup.match(/<article[\s\S]*<\/article>/)?.[0] ?? ''
  const count = (markup, value) => markup.split(value).length - 1

  const preview = render(base, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  const printed = render(base, { qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.equal(surface(preview), surface(printed), 'Modern preview and print use the same document surface')
  for (const value of ['a4-statement-brand', 'a4-statement-meta-card', 'a4-statement-qr-card', 'a4-statement-party-card', 'a4-statement-items', 'a4-statement-payment-card', 'a4-statement-totals', 'Trading House', 'Legal Seller Co', '300000000000003', '1010999999', '+966500000001', 'seller@example.com', 'https://seller.example']) assert.match(preview, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(preview, /a4-totals__grand/)
  assert.match(preview, /class="a4-qr"/)
  assert.ok(preview.indexOf('a4-totals__grand') < preview.indexOf('Paid / المدفوع'), 'Paid renders after the total band without structural overlap')
  for (const token of ['--invoice-primary:#0f766e', '--invoice-heading:#134e4a', '--invoice-text:#1f2937']) assert.match(preview, new RegExp(token))

  const sameIdentity = render({ ...base, presentation: { ...base.presentation, logo: { ...base.presentation.logo, visible: false, previewUrl: null, assetPath: null } }, seller: { ...base.seller, registeredName: 'Trading House', registeredNameAr: null, displayHeading: ' trading house ', displaySubheading: 'TRADING HOUSE' } }, { preview: true })
  assert.match(sameIdentity, /a4-statement-head--identityless/)
  assert.equal(count(sameIdentity, 'Trading House'), 1, 'same legal and trading name renders once')
  assert.doesNotMatch(sameIdentity, /class="a4-logo/)
  const sellerOnly = render({ ...base, seller: { ...base.seller, registrationNumber: null }, presentation: { ...base.presentation, contact: { ...base.presentation.contact, phoneVisible: false, phone: null, emailVisible: false, email: null, websiteVisible: false, website: null } } }, { preview: true })
  for (const value of ['CR Number', 'Phone /', 'Email /', 'Website /']) assert.doesNotMatch(sellerOnly, new RegExp(value))
  const walkIn = render({ ...base, buyer: { ...base.buyer, snapshotState: 'walk_in', name: null, nameAr: null, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, isWalkIn: true } }, { preview: true })
  assert.match(walkIn, /a4-statement-parties a4-parties--seller-only/)
  assert.doesNotMatch(walkIn, /class="a4-buyer"/)
  const b2b = render({ ...base, buyer: { ...base.buyer, snapshotState: 'captured', name: 'Buyer Legal LLC', nameAr: null, vatNumber: '310000000000003', address: 'Jeddah, Saudi Arabia', addressAr: null, identifierType: 'CR', identifierValue: '4030000000', isWalkIn: false } }, { preview: true })
  for (const value of ['Buyer Legal LLC', '310000000000003', 'Jeddah, Saudi Arabia', '4030000000']) assert.match(b2b, new RegExp(value))

  const item = { ...base.items[0], description: 'English product', descriptionAr: 'منتج عربي', unitName: 'Piece', unitNameAr: 'قطعة', quantity: 2, unitPrice: 18, discount: 2, taxableAmount: 34, vatRate: 15, vatAmount: 5.1, lineTotal: 39.1 }
  const bilingual = render({ ...base, items: [item] }, { preview: true })
  assert.match(bilingual, /a4-statement-item-name--bilingual[\s\S]*English product[\s\S]*\/ [\s\S]*منتج عربي/)
  assert.match(bilingual, /a4-statement-items--with-discount/)
  assert.match(bilingual, /15%/); assert.match(bilingual, /5\.10/); assert.match(bilingual, /34\.00/)
  const englishOnly = render({ ...base, identity: { ...base.identity, language: 'en', direction: 'ltr' }, items: [{ ...item, descriptionAr: null }] }, { preview: true })
  assert.match(englishOnly, />English product</); assert.doesNotMatch(englishOnly, /منتج عربي/)
  const arabicOnly = render({ ...base, identity: { ...base.identity, language: 'ar', direction: 'rtl' }, items: [{ ...item, description: '', descriptionAr: 'منتج عربي' }] }, { preview: true })
  assert.match(arabicOnly, /منتج عربي/); assert.doesNotMatch(arabicOnly, />English product</)
  const duplicate = render({ ...base, items: [{ ...item, description: 'Pepsi', descriptionAr: 'pepsi' }] }, { preview: true })
  assert.equal(count(duplicate, 'Pepsi') + count(duplicate, 'pepsi'), 1, 'identical issued names render once')
  const noDiscount = render({ ...base, items: [{ ...item, discount: 0 }] }, { preview: true })
  assert.doesNotMatch(noDiscount, /a4-statement-items--with-discount/)
  const noFooter = render({ ...base, presentation: { ...base.presentation, footer: { ...base.presentation.footer, footerVisible: false, thankYouVisible: false, refundVisible: false } } }, { preview: true })
  assert.match(noFooter, /<footer class="a4-footer"><\/footer>/)
  const singlePayment = render({ ...base, payments: [base.payments[0]] }, { preview: true })
  assert.match(singlePayment, /Cash/); assert.doesNotMatch(singlePayment, /Card \/ POS/)
  const noQr = render(base, { preview: true, nonFiscalDemo: true })
  assert.match(noQr, /a4-statement-document--without-qr/); assert.doesNotMatch(noQr, /a4-statement-qr-card|class="a4-qr"/)
  const long = render({ ...base, items: Array.from({ length: 60 }, (_, index) => ({ ...item, description: `Long bilingual commercial description ${index + 1}`, descriptionAr: `وصف منتج عربي طويل ${index + 1}` })) }, { preview: true })
  assert.equal(count(long, 'Long bilingual commercial description'), 60)
  const twentyItems = render({ ...base, items: Array.from({ length: 20 }, (_, index) => ({ ...item, description: `Twenty item ${index + 1}` })) }, { preview: true })
  assert.equal(count(twentyItems, 'Twenty item'), 20)
  assert.match(css, /table-header-group/); assert.match(css, /\.a4-items tr \{ break-inside: avoid/); assert.match(css, /\.a4-closing-group \{ break-inside: avoid/)

  const credit = adapters.documentFromPreviewCreditNoteDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
  const creditMarkup = render(credit, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  for (const value of ['SAMPLE-CN-0042', 'SAMPLE-0042', 'Sample return', 'a4-statement-items']) assert.match(creditMarkup, new RegExp(value))
} finally {
  await server.close()
}

console.log('Modern Statement A4 regression matrix passed (identity, seller/buyer, metadata, canonical items, totals, QR, optional content, long invoices, credit notes, and preview parity).')
