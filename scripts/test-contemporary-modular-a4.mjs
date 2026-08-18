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
for (const marker of ['ContemporaryItemName', 'ContemporaryItemTable', 'contemporaryColumnLabel', 'ContemporaryModularDecoration', 'DocumentTitle model={model}', 'a4-contemporary-recipient', 'a4-contemporary-closeout']) assert.match(source, new RegExp(marker))
for (const marker of ['a4-contemporary-decoration__top', 'a4-contemporary-decoration__bottom', 'a4-document-title__main', 'a4-contemporary-recipient', 'a4-contemporary-seller', 'a4-contemporary-items--with-discount', 'a4-contemporary-closeout', 'a4-contemporary-qr', 'a4-contemporary-lower']) assert.match(css, new RegExp(marker))
assert.doesNotMatch(css.match(/\/\* 5 — Accounting Ledger \*\/[\s\S]*?\/\* 6 — Contemporary Modular \*\//)?.[0] ?? '', /a4-contemporary/)
assert.doesNotMatch(source, /Due Date|Payment Terms|Supply Code|Signature/)
assert.match(css, /\.a4-contemporary-decoration__top \{[^}]*clip-path/)
assert.match(css, /\.a4-contemporary-decoration__bottom \{[^}]*clip-path/)
assert.match(css, /\.a4-contemporary-document \.a4-document-title__main \{[^}]*font-size: 29pt/)
assert.match(css, /\.a4-contemporary-head \{[^}]*grid-template-columns: minmax\(0,1\.18fr\) minmax\(54mm,\.82fr\)/)
assert.match(css, /\.a4-contemporary-recipient \{[^}]*border-inline-start: 3px solid var\(--invoice-primary\)/)
assert.match(css, /\.a4-contemporary-qr \{ display: grid; place-items: center; align-self: center; padding: 1mm/)
assert.match(css, /\.a4-contemporary-qr \.a4-qr img,.a4-contemporary-qr \.a4-qr-placeholder \{ width: 25mm; height: 25mm/)
assert.match(css, /\.a4-contemporary-seller \{[^}]*grid-template-columns: minmax\(0,38mm\) minmax\(0,1fr\)/)
assert.match(css, /\.a4-contemporary-items th \{ padding: 1\.3mm 1\.3mm 1\.6mm/)
assert.match(css, /\.a4-contemporary-items td \{ padding: 2\.45mm 1\.3mm/)
assert.match(css, /\.a4-contemporary-closeout \{[^}]*grid-template-columns: 34mm minmax\(0,1fr\) minmax\(67mm,79mm\); gap: 7mm; align-items: center/)
assert.match(css, /\.a4-contemporary-payment \{ min-width: 0; max-width: 100%; align-self: center/)
assert.match(css, /\.a4-contemporary-totals \.a4-totals__grand \{ align-items: center/)
assert.match(css, /\.a4-contemporary-totals \.a4-totals__grand > span \{ max-width: 61%; font-size: 7\.8pt; line-height: 1\.22/)

const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } })
try {
  const [a4, adapters, settings, registry] = await Promise.all([
    server.ssrLoadModule('/src/components/print/A4Document.tsx'),
    server.ssrLoadModule('/src/lib/invoices/documentViewAdapters.ts'),
    server.ssrLoadModule('/src/lib/invoices/presentationSettings.ts'),
    server.ssrLoadModule('/src/lib/invoices/a4TemplateRegistry.ts'),
  ])
  const { default: A4Document } = a4
  assert.equal(registry.A4_TEMPLATE_REGISTRY.contemporary_border.qrRegion, 'financial-band')
  const normalized = settings.normalizeInvoiceSettings({
    invoice_language: 'both', print_mode: 'pdf', presentation_settings: {
      identity: { display_heading: 'Trading House', display_subheading: 'Wholesale division' },
      logo: { visible: true, asset_path: 'data:image/png;base64,RklYVFVSRQ==' },
      contact: { show_phone: true, show_email: true, show_website: true }, footer: { footer_note: 'Thank you for your business.', show_footer: true },
      a4: { template_id: 'contemporary_border', accent_color: '#0f766e', heading_color: '#134e4a', body_color: '#1f2937', auto_foreground: true },
    },
  }, {
    business_name: 'Legal Seller Co', business_name_ar: null, name: 'Trading House', name_ar: null, vat_number: '300000000000003', cr_number: '1010999999', address: 'King Fahd Road, Riyadh', phone: '+966500000001', email: 'seller@example.com', website: 'https://seller.example', show_email: true, show_website: true,
  })
  const draft = { presentation: normalized.presentation, invoiceLanguage: normalized.invoiceLanguage, printMode: normalized.printMode, afterSaleAction: normalized.afterSaleAction }
  const base = adapters.documentFromPreviewDraft(draft, 'data:image/png;base64,RklYVFVSRQ==', { registeredName: 'Legal Seller Co', registeredNameAr: null, registeredAddress: 'King Fahd Road, Riyadh' })
  const contemporary = model => ({ ...model, template: { ...model.template, requestedId: 'contemporary_border', resolvedId: 'contemporary_border', requestedVersion: 1, resolvedVersion: 1, fallback: false, fallbackReason: null } })
  const render = (model, options = {}) => renderToStaticMarkup(createElement(A4Document, { model: contemporary(model), options }))
  const surface = markup => markup.match(/<article[\s\S]*<\/article>/)?.[0] ?? ''
  const count = (markup, value) => markup.split(value).length - 1

  const preview = render(base, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  const printed = render(base, { qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.equal(surface(preview), surface(printed), 'Contemporary preview and print use the same document surface')
  for (const value of ['a4-contemporary-head', 'a4-contemporary-recipient', 'a4-contemporary-seller', 'a4-contemporary-qr', 'a4-contemporary-items', 'a4-contemporary-closeout', 'a4-contemporary-lower', 'Simplified Tax Invoice', 'Trading House', 'Legal Seller Co', '300000000000003']) assert.match(preview, new RegExp(value))
  assert.doesNotMatch(preview, /a4-contemporary-document-class|>INVOICE<\/div>/)
  for (const label of ['Description / الوصف', 'Qty / الكمية', 'Unit Price / سعر الوحدة', 'Taxable / الخاضع', 'VAT / الضريبة', 'Total / الإجمالي']) assert.match(preview, new RegExp(label))
  for (const token of ['--invoice-primary:#0f766e', '--invoice-heading:#134e4a', '--invoice-text:#1f2937', '--invoice-on-primary:']) assert.match(preview, new RegExp(token))
  assert.match(preview, /class="a4-qr"/)
  assert.equal(count(preview, base.identity.number), 1, 'the authoritative document number appears only in upper metadata')
  assert.ok(preview.indexOf('class="a4-meta"') < preview.indexOf(base.identity.number), 'the document number remains in upper metadata')
  assert.ok(preview.indexOf('class="a4-contemporary-qr"') > preview.indexOf('class="a4-contemporary-items"'), 'QR is embedded in the financial closeout band')
  assert.ok(preview.indexOf('class="a4-contemporary-qr"') < preview.indexOf('class="a4-contemporary-payment"'), 'QR precedes payment and totals in the financial band')
  assert.ok(preview.indexOf('class="a4-contemporary-payment"') < preview.indexOf('class="a4-contemporary-totals"'), 'payment precedes totals in closeout')
  assert.match(preview, /a4-totals__grand[\s\S]*Total Including VAT \/ الإجمالي شامل الضريبة/)
  assert.doesNotMatch(preview, /Due Date|Payment Terms|Supply Code|Signature/)

  const noLogo = render({ ...base, presentation: { ...base.presentation, logo: { ...base.presentation.logo, visible: false, previewUrl: null, assetPath: null } }, seller: { ...base.seller, displayHeading: null, displaySubheading: null } }, { preview: true, nonFiscalDemo: true })
  assert.match(noLogo, /Simplified Tax Invoice/); assert.doesNotMatch(noLogo, /class="a4-logo|class="a4-qr"/)
  const walkIn = render({ ...base, buyer: { ...base.buyer, snapshotState: 'walk_in', name: null, nameAr: null, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, isWalkIn: true } }, { preview: true })
  assert.match(walkIn, /a4-contemporary-recipient[\s\S]*a4-seller/); assert.doesNotMatch(walkIn, /class="a4-buyer"/)
  const b2b = render({ ...base, buyer: { ...base.buyer, snapshotState: 'captured', name: 'Buyer Legal LLC', nameAr: null, vatNumber: '310000000000003', address: 'A very long Jeddah, Saudi Arabia legal address for invoice testing', addressAr: null, identifierType: 'CR', identifierValue: '4030000000', isWalkIn: false } }, { preview: true })
  for (const value of ['Buyer Legal LLC', '310000000000003', '4030000000', 'A very long Jeddah']) assert.match(b2b, new RegExp(value))
  const standard = render({ ...base, identity: { ...base.identity, invoiceType: 'standard' } }, { preview: true })
  assert.match(standard, /Tax Invoice/); assert.doesNotMatch(standard, /Simplified Tax Invoice/)

  const item = { ...base.items[0], description: 'English product', descriptionAr: 'منتج عربي', unitName: 'Piece', unitNameAr: 'قطعة', quantity: 2, unitPrice: 18, discount: 2, taxableAmount: 34, vatRate: 15, vatAmount: 5.1, lineTotal: 39.1 }
  const bilingual = render({ ...base, items: [item] }, { preview: true })
  assert.match(bilingual, /a4-contemporary-item-name--bilingual[\s\S]*English product[\s\S]*\/ [\s\S]*منتج عربي/); assert.match(bilingual, /a4-contemporary-items--with-discount/); assert.match(bilingual, /Discount \/ الخصم/)
  const duplicate = render({ ...base, items: [{ ...item, description: 'Pepsi', descriptionAr: 'pepsi' }] }, { preview: true })
  assert.equal(count(duplicate, 'Pepsi') + count(duplicate, 'pepsi'), 1, 'identical bilingual titles render once')
  const englishOnly = render({ ...base, items: [{ ...item, description: 'English only', descriptionAr: null, discount: 0 }] }, { preview: true })
  assert.match(englishOnly, /English only/); assert.doesNotMatch(englishOnly, /a4-contemporary-items--with-discount/)
  const arabicOnly = render({ ...base, items: [{ ...item, description: '', descriptionAr: 'عربي فقط', discount: 0 }] }, { preview: true })
  assert.match(arabicOnly, /عربي فقط/)
  const onePayment = render({ ...base, payments: [base.payments[0]] }, { preview: true })
  assert.match(onePayment, /Cash/); assert.doesNotMatch(onePayment, /Card \/ POS/)
  assert.match(preview, /Cash \/ نقدي[\s\S]*Received \/ المبلغ المستلم[\s\S]*Change \/ الباقي[\s\S]*Card \/ POS/, 'split tenders and cash expansion preserve authoritative payment content')
  const shortInvoice = render({ ...base, items: [item] }, { preview: true })
  assert.match(shortInvoice, /a4-contemporary-closeout a4-closing-group/, 'short invoices keep the closeout in normal flow')
  const noFooter = render({ ...base, presentation: { ...base.presentation, footer: { ...base.presentation.footer, footerVisible: false, footer: null } } }, { preview: true })
  assert.doesNotMatch(noFooter, /Thank you for your business|a4-contemporary-lower/)
  for (const length of [20, 60, 100]) {
    const long = render({ ...base, items: Array.from({ length }, (_, index) => ({ ...item, description: `Contemporary invoice item ${index + 1} with a long commercial description`, descriptionAr: `بند معاصر طويل ${index + 1}` })) }, { preview: true })
    assert.equal(count(long, 'Contemporary invoice item'), length)
  }
  assert.match(css, /table-header-group/); assert.match(css, /\.a4-items tr \{ break-inside: avoid/); assert.match(css, /\.a4-closing-group \{ break-inside: avoid/)
  const credit = adapters.documentFromPreviewCreditNoteDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
  const creditMarkup = render(credit, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  for (const value of ['Credit Note', 'SAMPLE-CN-0042', 'SAMPLE-0042', 'Sample return', 'a4-contemporary-items']) assert.match(creditMarkup, new RegExp(value))
} finally { await server.close() }

console.log('Contemporary Modular A4 regression matrix passed (diagonal geometry, financial-band QR, seller/buyer, canonical items, long documents, credit notes, tokens, and preview parity).')
