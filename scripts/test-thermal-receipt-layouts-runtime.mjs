import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
})

try {
  const [thermalModule, adapters, settings] = await Promise.all([
    server.ssrLoadModule('/src/components/print/ThermalReceipt.tsx'),
    server.ssrLoadModule('/src/lib/invoices/documentViewAdapters.ts'),
    server.ssrLoadModule('/src/lib/invoices/presentationSettings.ts'),
  ])
  const { default: ThermalReceipt, THERMAL_RECEIPT_LAYOUTS } = thermalModule
  assert.deepEqual(Object.keys(THERMAL_RECEIPT_LAYOUTS), ['classic', 'compact', 'standard', 'detailed'])
  assert.equal(new Set(Object.values(THERMAL_RECEIPT_LAYOUTS).map(layout => layout.id)).size, 4)

  const layouts = [
    { storedId: 'classic', publicId: 'classic', landmark: 'thermal-classic-line' },
    { storedId: 'compact', publicId: 'compact-retail', landmark: 'thermal-compact-line' },
    { storedId: 'standard', publicId: 'structured-detail', landmark: 'thermal-structured-line__figures' },
    { storedId: 'detailed', publicId: 'branded-modern', landmark: 'thermal-branded-card__head' },
  ]
  const fixtureCases = [
    { id: 'en-short-cash-qr', language: 'en', sale: 'short', payment: 'cash', qr: 'eligible', document: 'simplified' },
    { id: 'ar-long-split-qr', language: 'ar', sale: 'long', payment: 'split', qr: 'eligible', document: 'simplified' },
    { id: 'both-many-card-qr', language: 'both', sale: 'many', payment: 'card', qr: 'eligible', document: 'standard' },
    { id: 'en-long-split-demo', language: 'en', sale: 'long', payment: 'split', qr: 'demo', document: 'simplified' },
    { id: 'ar-short-cash-unavailable', language: 'ar', sale: 'short', payment: 'cash', qr: 'unavailable', document: 'standard' },
    { id: 'both-credit-card-qr', language: 'both', sale: 'long', payment: 'card', qr: 'eligible', document: 'credit_note' },
  ]
  const widths = ['58mm', '80mm']
  const rendered = []

  for (const layout of layouts) {
    for (const width of widths) {
      for (const fixtureCase of fixtureCases) {
        const normalized = settings.normalizeInvoiceSettings({
          invoice_language: fixtureCase.language,
          presentation_settings: { thermal: { width, density: layout.storedId, qr_size: 'standard', wrap_item_names: true, show_cash_change: true } },
        }, {
          business_name: 'Fixture Roastery',
          business_name_ar: 'محمصة الاختبار',
          name: 'Fixture Branch',
          name_ar: 'فرع الاختبار',
          address: 'King Fahd Road, Riyadh',
          vat_number: '300000000000003',
          receipt_footer: 'Thank you / شكراً',
          show_footer: true,
        })
        const draft = {
          presentation: normalized.presentation,
          invoiceLanguage: normalized.invoiceLanguage,
          printMode: normalized.printMode,
          afterSaleAction: normalized.afterSaleAction,
        }
        const serialized = settings.serializeInvoicePresentationSettingsForSave(draft, 'Fixture Branch')
        const restored = settings.normalizeInvoiceSettings({
          invoice_language: serialized.language,
          print_mode: normalized.printMode,
          presentation_settings: serialized,
        }, { name: 'Fixture Branch' })
        assert.equal(serialized.thermal.density, layout.storedId)
        assert.equal(serialized.thermal.width, width)
        assert.equal(restored.presentation.thermal.density, layout.storedId)
        assert.equal(restored.presentation.thermal.width, width)
        const isCredit = fixtureCase.document === 'credit_note'
        const base = isCredit
          ? adapters.documentFromPreviewCreditNoteDraft(draft)
          : adapters.documentFromPreviewDraft(draft)
        const paymentRows = fixtureCase.payment === 'split'
          ? base.payments
          : fixtureCase.payment === 'card'
            ? [{ method: 'card', amount: base.totals.total, cashTendered: null, change: null, reference: 'FIXTURE' }]
            : [{ method: 'cash', amount: base.totals.total, cashTendered: base.totals.total + 10, change: 10, reference: null }]
        const longItem = {
          ...base.items[0],
          description: 'Extra-long mixed-language Ethiopian coffee gift box for safe narrow-paper wrapping',
          descriptionAr: 'صندوق هدايا قهوة إثيوبية طويل جداً لاختبار التفاف النص على الورق الضيق',
        }
        const items = fixtureCase.sale === 'short'
          ? [base.items[0]]
          : fixtureCase.sale === 'many'
            ? Array.from({ length: 12 }, (_, index) => ({ ...longItem, description: `${longItem.description} ${index + 1}` }))
            : [longItem, ...base.items]
        const model = {
          ...base,
          identity: {
            ...base.identity,
            invoiceType: fixtureCase.document === 'standard' ? 'standard' : base.identity.invoiceType,
          },
          items,
          payments: paymentRows,
        }
        const markup = renderToStaticMarkup(createElement(ThermalReceipt, {
          model,
          options: {
            preview: true,
            qrImageUrl: fixtureCase.qr === 'eligible' ? 'data:image/png;base64,RklYVFVSRQ==' : null,
            nonFiscalDemo: fixtureCase.qr === 'demo',
            qrUnavailable: fixtureCase.qr === 'unavailable',
          },
        }))

        assert.match(markup, new RegExp(`data-receipt-layout="${layout.publicId}"`))
        assert.match(markup, new RegExp(`thermal-receipt--${width}`))
        assert.match(markup, new RegExp(layout.landmark))
        assert.match(markup, /300000000000003/)
        assert.match(markup, /SAMPLE-/)
        assert.match(markup, /thermal-totals/)
        assert.match(markup, /thermal-payments/)
        if (fixtureCase.language === 'ar') assert.match(markup, /dir="rtl"/)
        if (fixtureCase.language === 'both') assert.match(markup, /محمصة|قهوة/)
        if (fixtureCase.payment === 'split') assert.match(markup, /cash[\s\S]*card|نقد[\s\S]*بطاقة/i)
        if (fixtureCase.qr === 'eligible') assert.match(markup, /class="thermal-qr"/)
        if (fixtureCase.qr !== 'eligible') assert.doesNotMatch(markup, /class="thermal-qr"/)
        if (fixtureCase.qr === 'demo') assert.match(markup, /DEMO — NOT A TAX INVOICE/)
        if (isCredit) assert.match(markup, /SAMPLE-CN-0042/)
        rendered.push({ layout: layout.publicId, width, caseId: fixtureCase.id, markup })
      }
    }
  }

  assert.equal(rendered.length, 48)
  assert.equal(new Set(rendered.map(result => result.layout)).size, 4)
  assert.equal(new Set(rendered.map(result => result.width)).size, 2)
  assert.equal(new Set(layouts.map(layout => layout.landmark)).size, 4)
  console.log('Thermal receipt runtime matrix passed (48 actual SSR renders: 4 structures × 2 widths × 6 typed fixture scenarios).')
} finally {
  await server.close()
}
