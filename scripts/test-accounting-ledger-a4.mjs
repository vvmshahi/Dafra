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

for (const marker of ['LedgerItemName', 'LedgerItemTable', 'ledgerColumnLabel', 'a4-ledger-head--brandless', 'a4-ledger-closeout', 'a4-ledger-payment']) assert.match(source, new RegExp(marker))
for (const marker of ['a4-ledger-items', 'a4-ledger-closeout', 'a4-ledger-payment', 'a4-ledger-head--brandless', 'a4-ledger-items--with-discount']) assert.match(css, new RegExp(marker))
assert.doesNotMatch(css.match(/\/\* 4 — Executive Frame \*\/[\s\S]*?\/\* 5 — Accounting Ledger \*\//)?.[0] ?? '', /a4-ledger/)
assert.doesNotMatch(css.match(/\/\* 5 — Accounting Ledger \*\/[\s\S]*?\/\* 6 — Contemporary Modular \*\//)?.[0] ?? '', /a4-statement|a4-classic/)
assert.match(css, /\.a4-ledger-closeout \{[^}]*\.78fr[^}]*1\.05fr[^}]*align-items: start/)
assert.doesNotMatch(css, /\.a4-ledger-payment \{[^}]*grid-template-columns/)
assert.match(css, /\.a4-ledger-payment \.a4-qr \{[^}]*margin-top: 2\.25mm[^}]*text-align: start/)
assert.match(css, /\.a4-ledger-totals \.a4-totals__grand > span \{ max-width: 55%/)

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
      contact: { show_phone: true, show_email: true, show_website: true }, footer: { footer_note: 'Thank you for your business.', show_footer: true },
      a4: { template_id: 'clean_ledger', accent_color: '#0f766e', heading_color: '#134e4a', body_color: '#1f2937' },
    },
  }, {
    business_name: 'Legal Seller Co', business_name_ar: null, name: 'Trading House', name_ar: null, vat_number: '300000000000003', cr_number: '1010999999', address: 'King Fahd Road, Riyadh', phone: '+966500000001', email: 'seller@example.com', website: 'https://seller.example', show_email: true, show_website: true,
  })
  const draft = { presentation: normalized.presentation, invoiceLanguage: normalized.invoiceLanguage, printMode: normalized.printMode, afterSaleAction: normalized.afterSaleAction }
  const base = adapters.documentFromPreviewDraft(draft, 'data:image/png;base64,RklYVFVSRQ==', { registeredName: 'Legal Seller Co', registeredNameAr: null, registeredAddress: 'King Fahd Road, Riyadh' })
  const ledger = model => ({ ...model, template: { ...model.template, requestedId: 'clean_ledger', resolvedId: 'clean_ledger', requestedVersion: 1, resolvedVersion: 1, fallback: false, fallbackReason: null } })
  const render = (model, options = {}) => renderToStaticMarkup(createElement(A4Document, { model: ledger(model), options }))
  const surface = markup => markup.match(/<article[\s\S]*<\/article>/)?.[0] ?? ''
  const count = (markup, value) => markup.split(value).length - 1

  const preview = render(base, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  const printed = render(base, { qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.equal(surface(preview), surface(printed), 'Ledger preview and print use the same document surface')
  for (const value of ['a4-ledger-head', 'a4-ledger-parties', 'a4-ledger-items', 'a4-ledger-closeout', 'a4-ledger-payment', 'a4-ledger-totals', 'Trading House', 'Legal Seller Co', '300000000000003', '1010999999', '+966500000001', 'seller@example.com', 'https://seller.example']) assert.match(preview, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  for (const label of ['Description / الوصف', 'Qty / الكمية', 'Unit Price / سعر الوحدة', 'Taxable / الخاضع', 'VAT / الضريبة', 'Total / الإجمالي']) assert.match(preview, new RegExp(label))
  for (const token of ['--invoice-primary:#0f766e', '--invoice-heading:#134e4a', '--invoice-text:#1f2937']) assert.match(preview, new RegExp(token))
  assert.match(preview, /class="a4-qr"/)
  assert.ok(preview.indexOf('class="a4-payment"') < preview.indexOf('class="a4-qr"'), 'QR follows payment inside the Ledger verification column')
  assert.ok(preview.indexOf('class="a4-qr"') < preview.indexOf('class="a4-ledger-totals"'), 'payment/verification column precedes totals')
  assert.match(preview, /a4-totals__grand[\s\S]*Total Including VAT \/ الإجمالي شامل الضريبة/)

  const noLogo = render({ ...base, presentation: { ...base.presentation, logo: { ...base.presentation.logo, visible: false, previewUrl: null, assetPath: null } }, seller: { ...base.seller, displayHeading: null, displaySubheading: null } }, { preview: true })
  assert.match(noLogo, /a4-ledger-head--brandless/); assert.doesNotMatch(noLogo, /class="a4-logo/)
  const walkIn = render({ ...base, buyer: { ...base.buyer, snapshotState: 'walk_in', name: null, nameAr: null, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, isWalkIn: true } }, { preview: true })
  assert.match(walkIn, /a4-ledger-parties a4-parties--seller-only/); assert.doesNotMatch(walkIn, /class="a4-buyer"/)
  const b2b = render({ ...base, buyer: { ...base.buyer, snapshotState: 'captured', name: 'Buyer Legal LLC', nameAr: null, vatNumber: '310000000000003', address: 'A very long Jeddah, Saudi Arabia legal address for invoice testing', addressAr: null, identifierType: 'CR', identifierValue: '4030000000', isWalkIn: false } }, { preview: true })
  for (const value of ['Buyer Legal LLC', '310000000000003', '4030000000', 'A very long Jeddah']) assert.match(b2b, new RegExp(value))

  const item = { ...base.items[0], description: 'English product', descriptionAr: 'منتج عربي', unitName: 'Piece', unitNameAr: 'قطعة', quantity: 2, unitPrice: 18, discount: 2, taxableAmount: 34, vatRate: 15, vatAmount: 5.1, lineTotal: 39.1 }
  const bilingual = render({ ...base, items: [item] }, { preview: true })
  assert.match(bilingual, /a4-ledger-item-name--bilingual[\s\S]*English product[\s\S]*\/ [\s\S]*منتج عربي/); assert.match(bilingual, /a4-ledger-items--with-discount/)
  const duplicate = render({ ...base, items: [{ ...item, description: 'Pepsi', descriptionAr: 'pepsi' }] }, { preview: true })
  assert.equal(count(duplicate, 'Pepsi') + count(duplicate, 'pepsi'), 1)
  const noDiscount = render({ ...base, items: [{ ...item, discount: 0 }] }, { preview: true })
  assert.doesNotMatch(noDiscount, /a4-ledger-items--with-discount/)
  const singlePayment = render({ ...base, payments: [base.payments[0]] }, { preview: true })
  assert.match(singlePayment, /Cash/); assert.doesNotMatch(singlePayment, /Card \/ POS/)
  for (const length of [20, 60, 100]) {
    const long = render({ ...base, items: Array.from({ length }, (_, index) => ({ ...item, description: `Ledger invoice item ${index + 1} with a long commercial description`, descriptionAr: `بند دفتر الأستاذ الطويل ${index + 1}` })) }, { preview: true })
    assert.equal(count(long, 'Ledger invoice item'), length)
  }
  assert.match(css, /table-header-group/); assert.match(css, /\.a4-items tr \{ break-inside: avoid/); assert.match(css, /\.a4-closing-group \{ break-inside: avoid/)
  const credit = adapters.documentFromPreviewCreditNoteDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
  const creditMarkup = render(credit, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  for (const value of ['SAMPLE-CN-0042', 'SAMPLE-0042', 'Sample return', 'a4-ledger-items']) assert.match(creditMarkup, new RegExp(value))
} finally { await server.close() }

console.log('Accounting Ledger A4 regression matrix passed (header, legal bands, canonical items, payments/totals, QR, B2B, long invoices, credit notes, colors, and preview parity).')
