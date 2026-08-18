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

for (const marker of ['ClassicItemName', 'ClassicItemTable', 'classicColumnLabel', 'a4-classic-items', 'a4-classic-closeout', 'a4-classic-item-name--bilingual']) assert.match(source, new RegExp(marker))
for (const marker of ['a4-classic-items thead', 'background: var\\(--invoice-primary\\)', 'a4-classic-items--with-discount', 'a4-classic-closeout', 'a4-classic-parties.a4-parties--seller-only']) assert.match(css, new RegExp(marker))
assert.doesNotMatch(css.match(/\/\* 2 — Modern Statement \*\/[\s\S]*?\/\* 3 — Minimal Editorial \*\//)?.[0] ?? '', /a4-classic/)
for (const marker of [
  /a4-classic-head[^}]*74mm[^}]*align-items: stretch[^}]*border-bottom: 2px solid var\(--invoice-primary\)/,
  /a4-classic-brand[^}]*border-inline-start: 3mm solid var\(--invoice-primary\)/,
  /a4-classic-identity[^}]*border-top: 3mm solid var\(--invoice-primary\)[^}]*background: var\(--invoice-surface\)/,
  /a4-classic-brand \.a4-display-heading[^}]*font-size: 18pt/,
  /a4-classic-parties \.a4-legal-seller__name[^}]*font-size: 9\.5pt/,
  /a4-classic-head[^}]*padding: 0 0 4\.5mm/,
  /a4-classic-brand[^}]*padding: 2\.5mm 0 2\.2mm 3\.2mm/,
  /a4-classic-parties > \* \{ padding: 2\.2mm 3mm/,
  /a4-classic-parties \.a4-seller \{ line-height: 1\.24/,
  /a4-classic-items__description \{ width: 38%/,
  /a4-classic-items--with-discount \.a4-classic-items__description \{ width: 31%/,
  /a4-classic-items \{[^}]*border: 1px solid var\(--invoice-border\)/,
  /a4-classic-items th \{[^}]*border-inline-end: 1px solid color-mix/,
  /a4-classic-items tbody tr:nth-child\(even\) \{ background: var\(--invoice-surface\)/,
  /a4-classic-items td:not\(:nth-child\(2\)\):not\(:nth-child\(4\)\) \{ vertical-align: middle/,
  /a4-classic-closeout \{[^}]*padding-top: 2\.5mm[^}]*border-top: 1px solid var\(--invoice-border\)/,
  /a4-classic-summary \{[^}]*30mm[^}]*72mm[^}]*gap: 3mm/,
  /a4-classic-summary > \.a4-qr \{[^}]*justify-items: center[^}]*background: #fff/,
  /a4-classic-summary \.a4-payment \{[^}]*border-inline-start: 2px solid var\(--invoice-primary\)/,
  /a4-classic-summary \.a4-totals \{[^}]*padding: 0[^}]*background: var\(--invoice-total-surface\)/,
  /a4-classic-summary \.a4-totals__grand \{[^}]*background: var\(--invoice-primary\)[^}]*font-size: 13\.5pt/,
]) assert.match(css, marker)

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
      a4: { template_id: 'classic', accent_color: '#7c3aed', heading_color: '#4c1d95', body_color: '#312e81' },
    },
  }, {
    business_name: 'Legal Seller Co', business_name_ar: null, name: 'Trading House', name_ar: null,
    vat_number: '300000000000003', cr_number: '1010999999', address: 'King Fahd Road, Riyadh',
    phone: '+966500000001', email: 'seller@example.com', website: 'https://seller.example', show_email: true, show_website: true,
  })
  const draft = { presentation: normalized.presentation, invoiceLanguage: normalized.invoiceLanguage, printMode: normalized.printMode, afterSaleAction: normalized.afterSaleAction }
  const base = adapters.documentFromPreviewDraft(draft, 'data:image/png;base64,RklYVFVSRQ==', { registeredName: 'Legal Seller Co', registeredNameAr: null, registeredAddress: 'King Fahd Road, Riyadh' })
  const classic = model => ({ ...model, template: { ...model.template, requestedId: 'classic', resolvedId: 'classic', requestedVersion: 1, resolvedVersion: 1, fallback: false, fallbackReason: null } })
  const render = (model, options = {}, forceClassic = true) => renderToStaticMarkup(createElement(A4Document, { model: forceClassic ? classic(model) : model, options }))
  const surface = markup => markup.match(/<article[\s\S]*<\/article>/)?.[0] ?? ''
  const count = (markup, value) => markup.split(value).length - 1

  const preview = render(base, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  const printed = render(base, { qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.equal(surface(preview), surface(printed), 'Classic preview and print use the same document surface')
  assert.match(preview, /data-template-resolved="classic@1"/)
  assert.match(preview, /a4-classic-items/)
  for (const label of ['Description / الوصف', 'Qty / الكمية', 'Unit Price / سعر الوحدة', 'Taxable / الخاضع', 'VAT Amt / مبلغ الضريبة', 'Total / الإجمالي']) assert.match(preview, new RegExp(label))
  assert.match(preview, /--invoice-primary:#7c3aed/)
  assert.match(preview, /--invoice-heading:#4c1d95/)
  assert.match(preview, /--invoice-text:#312e81/)
  assert.match(preview, /class="a4-logo/)
  assert.match(preview, /Trading House/)
  assert.match(preview, /Legal Seller Co/)
  assert.equal(count(preview, 'Legal Seller Co'), 1, 'legal seller identity is not duplicated')
  assert.match(preview, /\+966500000001/)
  assert.match(preview, /seller@example\.com/)
  assert.match(preview, /https:\/\/seller\.example/)
  assert.match(preview, /class="a4-qr"/)
  assert.match(preview, /Thank you for your business\./)

  const noLogo = render({ ...base, presentation: { ...base.presentation, logo: { ...base.presentation.logo, visible: false, previewUrl: null, assetPath: null } } }, { preview: true })
  assert.doesNotMatch(noLogo, /class="a4-logo/)
  const sameIdentity = render({ ...base, seller: { ...base.seller, registeredName: 'Trading House', registeredNameAr: null, displayHeading: ' trading house ', displaySubheading: 'TRADING HOUSE' } }, { preview: true })
  assert.equal(count(sameIdentity, 'Trading House'), 1, 'normalized identical trading and legal identity render once')

  const namedB2c = render({ ...base, buyer: { ...base.buyer, snapshotState: 'captured', name: 'Named retail buyer', nameAr: null, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, isWalkIn: false } }, { preview: true })
  assert.match(namedB2c, /Named retail buyer/)
  const b2b = render({ ...base, buyer: { ...base.buyer, snapshotState: 'captured', name: 'Buyer Legal LLC', nameAr: null, vatNumber: '310000000000003', address: 'Jeddah, Saudi Arabia', addressAr: null, identifierType: 'CR', identifierValue: '4030000000', isWalkIn: false } }, { preview: true })
  assert.match(b2b, /Buyer Legal LLC/); assert.match(b2b, /310000000000003/); assert.match(b2b, /4030000000/)
  const walkIn = render({ ...base, buyer: { ...base.buyer, snapshotState: 'walk_in', name: null, nameAr: null, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, isWalkIn: true } }, { preview: true })
  assert.match(walkIn, /a4-classic-parties a4-parties--seller-only/)
  assert.doesNotMatch(walkIn, /class="a4-buyer"/)

  const item = { ...base.items[0], description: 'English product', descriptionAr: 'منتج عربي', unitName: 'Piece', unitNameAr: 'قطعة', quantity: 2, unitPrice: 18, discount: 2, taxableAmount: 34, vatRate: 15, vatAmount: 5.1, lineTotal: 39.1 }
  const bilingual = render({ ...base, items: [item] }, { preview: true })
  assert.match(bilingual, /a4-classic-item-name--bilingual[\s\S]*English product[\s\S]*\/ [\s\S]*منتج عربي/)
  assert.match(bilingual, /15%/); assert.match(bilingual, /5\.10/); assert.match(bilingual, /34\.00/)
  assert.match(bilingual, /a4-classic-items--with-discount/)
  const englishOnly = render({ ...base, identity: { ...base.identity, language: 'en', direction: 'ltr' }, items: [{ ...item, descriptionAr: null }] }, { preview: true })
  assert.match(englishOnly, /English product/); assert.doesNotMatch(englishOnly, /منتج عربي/)
  const arabicOnly = render({ ...base, identity: { ...base.identity, language: 'ar', direction: 'rtl' }, items: [{ ...item, description: '', descriptionAr: 'منتج عربي' }] }, { preview: true })
  assert.match(arabicOnly, /منتج عربي/); assert.doesNotMatch(arabicOnly, />English product</)
  const canonicalCombined = render({ ...base, identity: { ...base.identity, language: 'en', direction: 'ltr' }, items: [item] }, { preview: true })
  assert.match(canonicalCombined, /a4-classic-item-name--bilingual[\s\S]*English product[\s\S]*\/ [\s\S]*منتج عربي/, 'issued bilingual names remain one combined title regardless of document-language setting')
  const duplicate = render({ ...base, items: [{ ...item, description: 'Pepsi', descriptionAr: 'pepsi' }] }, { preview: true })
  assert.equal(count(duplicate, 'Pepsi') + count(duplicate, 'pepsi'), 1, 'identical issued names render once')
  const noDiscount = render({ ...base, items: [{ ...item, discount: 0 }] }, { preview: true })
  assert.doesNotMatch(noDiscount, /a4-classic-items--with-discount/)
  const long = render({ ...base, items: Array.from({ length: 60 }, (_, index) => ({ ...item, description: `Long bilingual commercial description ${index + 1} with a detailed legal product name`, descriptionAr: `وصف منتج عربي طويل ومفصل ${index + 1}` })) }, { preview: true })
  assert.equal(count(long, 'Long bilingual commercial description'), 60)
  assert.match(css, /table-header-group/); assert.match(css, /\.a4-items tr \{ break-inside: avoid/); assert.match(css, /\.a4-classic-closeout \{ margin-top: 4\.5mm/)

  assert.match(preview, /cash[\s\S]*card/i)
  assert.match(preview, /Received[\s\S]*40\.00/)
  assert.match(preview, /Change[\s\S]*10\.00/)
  const credit = adapters.documentFromPreviewCreditNoteDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
  const creditMarkup = render(credit, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.match(creditMarkup, /SAMPLE-CN-0042/); assert.match(creditMarkup, /SAMPLE-0042/); assert.match(creditMarkup, /Sample return/); assert.match(creditMarkup, /a4-classic-items/)

  for (const historical of ['modern_split', 'clean_ledger', 'contemporary_border', 'minimal_professional', 'executive_green']) {
    const markup = render({ ...base, template: { ...base.template, requestedId: historical, resolvedId: historical } }, { preview: true }, false)
    assert.doesNotMatch(markup, /a4-classic-items/)
  }
} finally {
  await server.close()
}

console.log('Classic Business A4 regression matrix passed (branding, legal buyers, bilingual items, totals/payment, colors, long invoices, credit notes, and preview parity).')
