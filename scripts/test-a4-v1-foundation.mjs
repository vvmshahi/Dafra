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
const ids = ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border', 'executive_professional', 'creative_studio']
const activeIds = ['classic', 'modern_split', 'clean_ledger', 'contemporary_border', 'executive_professional', 'creative_studio']
const partyClasses = {
  classic: 'a4-classic-parties', modern_split: 'a4-statement-parties',
  minimal_professional: 'a4-minimal-parties', executive_green: 'a4-executive-parties',
  clean_ledger: 'a4-ledger-parties', contemporary_border: 'a4-contemporary-parties', executive_professional: 'a4-execpro-parties', creative_studio: 'a4-creative-parties',
}

const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const a4Source = read('src/components/print/A4Document.tsx')
const css = read('src/index.css')
assert.match(invoiceSettings, /A4_NEW_SELECTION_TEMPLATE_IDS\.map/)
assert.doesNotMatch(invoiceSettings, /sampleLabel|pageNumbers/)
assert.doesNotMatch(a4Source, /sampleLabel|pageNumbers|a4-sample|a4-page-number/)
assert.match(a4Source, /TODO\(a4-foundation\)[\s\S]*cash-change visibility contract/)
for (const id of ids) assert.match(read('src/lib/invoices/a4TemplateRegistry.ts'), new RegExp(`${id}:`))

const printCss = css.match(/@media print[\s\S]*?\/\* Snapshot-driven thermal document/)?.[0] ?? ''
assert.doesNotMatch(printCss, /a4-document--(?:modern_split|minimal_professional|executive_green|clean_ledger|contemporary_border)/)
assert.doesNotMatch(printCss, /\.a4-document\s*\{[^}]*?(?:width|min-height|padding|margin):/)
for (const token of ['--invoice-primary', '--invoice-heading', '--invoice-text', '--invoice-on-primary', '--invoice-border', '--invoice-surface', '--invoice-table-head', '--invoice-total-surface']) assert.match(a4Source, new RegExp(token))
for (const marker of ['a4-statement-items thead', 'a4-document--minimal_professional .a4-items thead', 'a4-ledger-items thead', 'a4-contemporary-qr']) assert.match(css, new RegExp(marker))
assert.match(css, /a4-contemporary-qr[^}]*background: #fff/)
const executiveCss = css.match(/\/\* 7 — Executive Professional \*\/[\s\S]*?(?=\n  \/\* 2 — Modern Statement \*\/)/)?.[0] ?? ''
for (const marker of ['a4-execpro-brand', 'align-self: center', 'a4-execpro-parties .a4-legal-seller', 'th:nth-child(2)', 'th:last-child', 'a4-execpro-closeout', 'a4-execpro-qr', 'padding: .65mm', 'a4-execpro-payment', 'a4-totals__grand', 'a4-document--executive_professional .a4-footer']) assert.ok(executiveCss.includes(marker), `missing Executive Professional refinement marker: ${marker}`)
assert.doesNotMatch(executiveCss, /a4-document--(?:classic|modern_split|minimal_professional|executive_green|clean_ledger|contemporary_border)/, 'Executive Professional refinements cannot target frozen templates')
const creativeCss = css.match(/\/\* 8 — Creative Studio[\s\S]*?(?=\n  \/\* 2 — Modern Statement \*\/)/)?.[0] ?? ''
for (const marker of ['a4-creative-decoration', 'position: absolute', 'pointer-events: none', 'overflow: hidden', 'grid-template-columns: minmax(0,1.35fr) minmax(0,1.45fr)', 'grid-template-columns: minmax(0,1fr) 24mm', 'justify-self: end', 'a4-creative-parties', 'a4-section-title::before', 'a4-contemporary-items th + th', 'gap: 3.5mm', 'a4-creative-totals', 'a4-document--creative_studio .a4-footer']) assert.ok(creativeCss.includes(marker), `missing Creative Studio marker: ${marker}`)
assert.doesNotMatch(creativeCss, /amount in words|signature|quotation|payment terms/i, 'Creative Studio cannot fabricate unsupported reference content')

const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } })
try {
  const [a4, adapters, settings, registry] = await Promise.all([
    server.ssrLoadModule('/src/components/print/A4Document.tsx'),
    server.ssrLoadModule('/src/lib/invoices/documentViewAdapters.ts'),
    server.ssrLoadModule('/src/lib/invoices/presentationSettings.ts'),
    server.ssrLoadModule('/src/lib/invoices/a4TemplateRegistry.ts'),
  ])
  const { default: A4Document } = a4
  assert.deepEqual(registry.A4_NEW_SELECTION_TEMPLATE_IDS, activeIds)
  assert.deepEqual(registry.A4_TEMPLATE_IDS, ids)

  const normalized = settings.normalizeInvoiceSettings({
    invoice_language: 'both', print_mode: 'pdf', presentation_settings: {
      a4: { template_id: 'classic', accent_color: '#0f766e', heading_color: '#10251a', body_color: '#1f2937' },
      logo: { visible: true, asset_path: 'data:image/png;base64,RklYVFVSRQ==' },
    },
  }, {
    business_name: 'Legal Seller Co', business_name_ar: null, name: 'Trading Branch', name_ar: null,
    vat_number: '300000000000003', cr_number: '1010999999', address: 'King Fahd Road, Riyadh',
    phone: '+966500000001', email: 'seller@example.com', show_email: true,
  })
  const draft = { presentation: normalized.presentation, invoiceLanguage: normalized.invoiceLanguage, printMode: normalized.printMode, afterSaleAction: normalized.afterSaleAction }
  const base = adapters.documentFromPreviewDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
  const setTemplate = (model, id) => ({ ...model, template: { ...model.template, requestedId: id, resolvedId: id, requestedVersion: 1, resolvedVersion: 1, fallback: false, fallbackReason: null } })
  const render = (model, options = {}) => renderToStaticMarkup(createElement(A4Document, { model, options }))
  const documentSurface = markup => markup.match(/<article[\s\S]*<\/article>/)?.[0] ?? ''
  const count = (markup, text) => markup.split(text).length - 1

  for (const id of ids) {
    const model = setTemplate(base, id)
    const preview = render(model, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
    const printed = render(model, { qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
    assert.match(preview, new RegExp(`data-template-resolved="${id}@1"`))
    assert.equal(documentSurface(preview), documentSurface(printed), `${id} preview and print share the same renderer surface`)
    assert.doesNotMatch(preview, /SAMPLE LABEL|Page \d+ of|a4-sample|a4-page-number/)
    assert.match(preview, /--invoice-primary:#0f766e/)
    assert.match(preview, /--invoice-heading:#10251a/)
    assert.match(preview, /--invoice-text:#1f2937/)
    assert.match(preview, /--invoice-border:/)
    assert.match(preview, /--invoice-surface:/)
    assert.match(preview, /--invoice-table-head:/)
    assert.match(preview, /--invoice-total-surface:/)
  }

  for (const id of activeIds) assert.match(render(setTemplate(base, id), { preview: true }), new RegExp(`data-template-resolved="${id}@1"`))
  for (const id of ['minimal_professional', 'executive_green']) assert.match(render(setTemplate(base, id), { preview: true }), new RegExp(`data-template-resolved="${id}@1"`))

  const executive = setTemplate(base, 'executive_professional')
  const executivePreview = render(executive, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  const executivePrint = render(executive, { qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.equal(documentSurface(executivePreview), documentSurface(executivePrint), 'Executive Professional preview and print share one render surface')
  for (const marker of ['a4-execpro-head', 'a4-execpro-brand', 'a4-execpro-parties', 'a4-contemporary-items', 'a4-execpro-closeout', 'a4-execpro-qr', 'a4-execpro-payment', 'a4-execpro-totals']) assert.match(executivePreview, new RegExp(marker))
  assert.match(executivePreview, /class="a4-logo/, 'configured Executive Professional logo renders once in the brand composition')

  const executiveWithoutLogo = setTemplate({
    ...base,
    seller: { ...base.seller, displayHeading: 'Trading Name' },
    presentation: { ...base.presentation, logo: { ...base.presentation.logo, visible: false, assetPath: null, previewUrl: null } },
  }, 'executive_professional')
  const executiveWithoutLogoMarkup = render(executiveWithoutLogo, { preview: true })
  assert.match(executiveWithoutLogoMarkup, /class="a4-execpro-brand"/, 'brand composition remains when only the merchant name is configured')
  assert.doesNotMatch(executiveWithoutLogoMarkup, /class="a4-logo/, 'no logo element or reserved logo content renders when the logo is absent')

  const executiveFooter = setTemplate({
    ...base,
    presentation: { ...base.presentation, footer: { ...base.presentation.footer, thankYouVisible: false, footerVisible: true, footer: 'Executive contact footer', refundVisible: false } },
  }, 'executive_professional')
  assert.match(render(executiveFooter, { preview: true }), /Executive contact footer/, 'configured Executive Professional footer renders from existing settings')
  const executiveWithoutFooter = setTemplate({
    ...base,
    presentation: { ...base.presentation, footer: { ...base.presentation.footer, thankYouVisible: false, footerVisible: false, footer: null, refundVisible: false } },
  }, 'executive_professional')
  assert.doesNotMatch(render(executiveWithoutFooter, { preview: true }), /a4-footer-copy/, 'no empty footer copy renders without configured footer content')

  const branded = setTemplate({
    ...base,
    seller: { ...base.seller, registeredName: 'Legal Seller Co', registeredNameAr: null, displayHeading: 'Trading Name', displaySubheading: 'Trading Name' },
  }, 'classic')
  const brandedMarkup = render(branded, { preview: true })
  assert.equal(count(brandedMarkup, 'Legal Seller Co'), 1, 'legal seller identity renders once')
  assert.equal(count(brandedMarkup, 'Trading Name'), 1, 'trading identity renders once')
  assert.equal((brandedMarkup.match(/class="a4-logo/g) ?? []).length, 1, 'logo renders once')

  const sameIdentity = setTemplate({
    ...base,
    seller: { ...base.seller, registeredName: 'Legal Seller Co', registeredNameAr: null, displayHeading: ' legal seller co ', displaySubheading: 'LEGAL SELLER CO' },
  }, 'classic')
  assert.equal(count(render(sameIdentity, { preview: true }), 'Legal Seller Co'), 1, 'normalized legal and display names do not duplicate')

  const b2b = setTemplate({ ...base, buyer: { ...base.buyer, snapshotState: 'captured', name: 'Buyer Legal LLC', nameAr: null, vatNumber: '310000000000003', address: 'Jeddah, Saudi Arabia', identifierType: 'CR', identifierValue: '4030000000', isWalkIn: false } }, 'classic')
  const b2bMarkup = render(b2b, { preview: true })
  assert.match(b2bMarkup, /Buyer Legal LLC/)
  assert.match(b2bMarkup, /310000000000003/)
  assert.match(b2bMarkup, /4030000000/)

  const walkIn = { ...base, buyer: { ...base.buyer, snapshotState: 'walk_in', name: null, nameAr: null, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, isWalkIn: true } }
  for (const id of ids) {
    const markup = render(setTemplate(walkIn, id), { preview: true })
    assert.doesNotMatch(markup, /class="a4-buyer"/)
    assert.match(markup, new RegExp(`class="${partyClasses[id]} a4-parties--seller-only"`))
  }

  const recolored = setTemplate({ ...base, template: { ...base.template, accentColor: '#7c3aed', headingColor: '#4c1d95', bodyColor: '#312e81' } }, 'clean_ledger')
  const recoloredMarkup = render(recolored, { preview: true })
  assert.match(recoloredMarkup, /--invoice-primary:#7c3aed/)
  assert.match(recoloredMarkup, /--invoice-heading:#4c1d95/)
  assert.match(recoloredMarkup, /--invoice-text:#312e81/)
  assert.match(render(setTemplate(recolored, 'contemporary_border'), { preview: true }), /--invoice-primary:#7c3aed/)

  const long = setTemplate({ ...base, items: Array.from({ length: 60 }, (_, index) => ({ ...base.items[index % base.items.length], description: `Long invoice item ${index + 1}`, descriptionAr: `بند فاتورة طويل ${index + 1}` })) }, 'clean_ledger')
  const longMarkup = render(long, { preview: true })
  assert.equal((longMarkup.match(/Long invoice item/g) ?? []).length, 60)
  assert.match(longMarkup, /class="a4-items(?: )/)
  assert.match(css, /table-header-group/)
  assert.match(css, /\.a4-closing-group\s*\{\s*break-inside:\s*avoid/)

  const executiveLong = setTemplate({ ...base, items: Array.from({ length: 100 }, (_, index) => ({ ...base.items[index % base.items.length], description: `Executive long item ${index + 1}`, descriptionAr: `بند تنفيذي طويل ${index + 1}` })) }, 'executive_professional')
  const executiveLongMarkup = render(executiveLong, { preview: true })
  assert.equal((executiveLongMarkup.match(/Executive long item/g) ?? []).length, 100, 'Executive Professional retains all long-invoice items')
  assert.match(executiveLongMarkup, /a4-execpro-closeout/, 'Executive Professional closeout remains in normal flow after long content')

  for (const id of ids) {
    const credit = adapters.documentFromPreviewCreditNoteDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
    const markup = render(setTemplate(credit, id), { preview: true })
    assert.match(markup, /SAMPLE-CN-0042/)
    assert.match(markup, new RegExp(`data-template-resolved="${id}@1"`))
  }

  const executiveCredit = adapters.documentFromPreviewCreditNoteDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
  const executiveCreditMarkup = render(setTemplate(executiveCredit, 'executive_professional'), { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.match(executiveCreditMarkup, /SAMPLE-CN-0042/)
  assert.match(executiveCreditMarkup, /a4-execpro-closeout/)
  const executiveRecolored = setTemplate({ ...base, template: { ...base.template, accentColor: '#7c3aed', headingColor: '#4c1d95', bodyColor: '#312e81', autoForeground: true } }, 'executive_professional')
  const executiveRecoloredMarkup = render(executiveRecolored, { preview: true })
  assert.match(executiveRecoloredMarkup, /--invoice-primary:#7c3aed/)
  assert.match(executiveRecoloredMarkup, /--invoice-heading:#4c1d95/)
  assert.match(executiveRecoloredMarkup, /--invoice-text:#312e81/)

  const creative = setTemplate(base, 'creative_studio')
  const creativePreview = render(creative, { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  const creativePrint = render(creative, { qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' })
  assert.equal(documentSurface(creativePreview), documentSurface(creativePrint), 'Creative Studio preview and print share one renderer surface')
  for (const marker of ['a4-creative-decoration', 'a4-creative-head', 'a4-creative-brand', 'a4-creative-qr', 'a4-creative-parties', 'a4-creative-closeout', 'a4-creative-payment', 'a4-creative-totals']) assert.match(creativePreview, new RegExp(marker))
  assert.match(creativePreview, /class="a4-logo/, 'Creative Studio renders a configured logo')

  const creativeWithoutLogo = setTemplate({
    ...base,
    seller: { ...base.seller, displayHeading: 'Creative Trading Name' },
    presentation: { ...base.presentation, logo: { ...base.presentation.logo, visible: false, assetPath: null, previewUrl: null } },
  }, 'creative_studio')
  const creativeWithoutLogoMarkup = render(creativeWithoutLogo, { preview: true })
  assert.match(creativeWithoutLogoMarkup, /a4-creative-brand/)
  assert.doesNotMatch(creativeWithoutLogoMarkup, /class="a4-logo/, 'Creative Studio has no empty logo placeholder')

  const creativeB2b = setTemplate({ ...base, buyer: { ...base.buyer, snapshotState: 'captured', name: 'Creative Buyer LLC', nameAr: 'شركة المشتري الإبداعية', vatNumber: '310000000000003', address: 'Jeddah, Saudi Arabia', identifierType: 'CR', identifierValue: '4030000000', isWalkIn: false } }, 'creative_studio')
  const creativeB2bMarkup = render(creativeB2b, { preview: true })
  assert.match(creativeB2bMarkup, /Creative Buyer LLC/)
  assert.match(creativeB2bMarkup, /310000000000003/)
  const creativeLong = setTemplate({ ...base, items: Array.from({ length: 100 }, (_, index) => ({ ...base.items[index % base.items.length], description: `Creative item ${index + 1}`, descriptionAr: `بند إبداعي ${index + 1}` })) }, 'creative_studio')
  const creativeLongMarkup = render(creativeLong, { preview: true })
  assert.equal((creativeLongMarkup.match(/Creative item/g) ?? []).length, 100, 'Creative Studio retains 100 authoritative rows')
  assert.match(creativeLongMarkup, /a4-creative-closeout/)
  const creativeCredit = adapters.documentFromPreviewCreditNoteDraft(draft, 'data:image/png;base64,RklYVFVSRQ==')
  assert.match(render(setTemplate(creativeCredit, 'creative_studio'), { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' }), /SAMPLE-CN-0042/)
  const creativeRecolored = setTemplate({ ...base, template: { ...base.template, accentColor: '#f59e0b', headingColor: '#78350f', bodyColor: '#1f2937', autoForeground: true } }, 'creative_studio')
  const creativeRecoloredMarkup = render(creativeRecolored, { preview: true })
  assert.match(creativeRecoloredMarkup, /--invoice-primary:#f59e0b/)
  assert.match(creativeRecoloredMarkup, /--invoice-heading:#78350f/)
  assert.match(creativeRecoloredMarkup, /--invoice-text:#1f2937/)
} finally {
  await server.close()
}

console.log('A4 V1 foundation regression checks passed (selection, historical renderers, shared preview/print surface, identity, buyers, tokens, long invoice, and credit notes).')
