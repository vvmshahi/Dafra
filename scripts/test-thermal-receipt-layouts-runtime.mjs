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
    { storedId: 'detailed', publicId: 'branded-modern', landmark: 'thermal-branded-line' },
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
          phone: '+966500000001',
          email: 'fixture@example.com',
          website: 'https://example.com',
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
        assert.equal(restored.presentation.contact.phone, '+966500000001')
        assert.equal(restored.presentation.contact.email, 'fixture@example.com')
        assert.equal(restored.presentation.contact.website, 'https://example.com')
        assert.equal(restored.presentation.contact.show_phone, true)
        assert.equal(restored.presentation.contact.show_email, true)
        assert.equal(restored.presentation.contact.show_website, true)
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
        assert.match(markup, /\+966500000001/)
        assert.match(markup, /fixture@example\.com/)
        if (layout.storedId === 'detailed') assert.match(markup, /https:\/\/example\.com/)
        else assert.doesNotMatch(markup, /https:\/\/example\.com/)
        assert.doesNotMatch(markup, /Bill From|صادرة من|>From</)
        assert.doesNotMatch(markup, /thermal-legal-info[\s\S]{0,120}thermal-section-label/)
        assert.match(markup, /SAMPLE-/)
        assert.match(markup, /thermal-totals/)
        assert.match(markup, /thermal-payments/)
        if (fixtureCase.language === 'ar') assert.match(markup, /dir="rtl"/)
        if (fixtureCase.language === 'both') assert.match(markup, /محمصة|قهوة/)
        if (fixtureCase.payment === 'split') assert.match(markup, /cash[\s\S]*card|نقد[\s\S]*بطاقة/i)
        if (fixtureCase.qr === 'eligible') assert.match(markup, /class="thermal-qr"/)
        if (fixtureCase.qr !== 'eligible') assert.doesNotMatch(markup, /class="thermal-qr"/)
        if (fixtureCase.qr === 'demo') assert.doesNotMatch(markup, /DEMO — NOT A TAX INVOICE/)
        if (isCredit) assert.match(markup, /SAMPLE-CN-0042/)
        if (layout.storedId === 'classic') {
          if (fixtureCase.language === 'both') assert.match(markup, /thermal-classic-line__names--combined/)
          assert.equal((markup.match(/thermal-classic-line__vat/g) ?? []).length, items.length)
          assert.equal((markup.match(/thermal-classic-line__discount/g) ?? []).length, items.filter(item => item.discount > 0.005).length)
          assert.match(markup, fixtureCase.payment === 'split' ? /thermal-classic-payments--split/ : /thermal-classic-payments--single/)
          if (!isCredit) assert.match(markup, /thermal-classic-total-label/)

          if (width === '80mm' && fixtureCase.id === 'both-many-card-qr') {
            const classicMarkupFor = (description, descriptionAr, itemOverrides = {}, documentOverrides = {}) => renderToStaticMarkup(createElement(ThermalReceipt, {
              model: {
                ...model,
                ...documentOverrides,
                items: [{ ...items[0], description, descriptionAr, quantity: 1, unitName: 'piece', unitNameAr: 'قطعة', unitPrice: 2, lineTotal: 2, taxableAmount: 1.74, vatRate: 15, vatAmount: .26, discount: 0, ...itemOverrides }],
              },
              options: { preview: true },
            }))
            const englishOnly = classicMarkupFor('Pepsi', null)
            assert.match(englishOnly, /Pepsi/)
            assert.doesNotMatch(englishOnly, /بيبسي/)
            const arabicOnly = classicMarkupFor('', 'ماء')
            assert.match(arabicOnly, /ماء/)
            assert.doesNotMatch(arabicOnly, /Pepsi|بيبسي/)
            const bilingual = classicMarkupFor('Pepsi', 'بيبسي')
            assert.match(bilingual, /Pepsi[\s\S]*بيبسي/)
            assert.match(bilingual, /thermal-classic-line__names--combined/)
            assert.doesNotMatch(bilingual, /thermal-classic-line__names--bilingual/)
            const duplicate = classicMarkupFor('Pepsi', 'pepsi')
            assert.equal((duplicate.match(/Pepsi|pepsi/g) ?? []).length, 1)
            const longBilingual = classicMarkupFor('Very Long English Product Name For A Narrow Thermal Receipt', 'اسم منتج عربي طويل جداً لإيصال حراري ضيق')
            assert.match(longBilingual, /Very Long English Product Name For A Narrow Thermal Receipt[\s\S]*اسم منتج عربي طويل جداً لإيصال حراري ضيق/)
            assert.match(bilingual, /VAT Amount 15%[\s\S]*مبلغ الضريبة 15%[\s\S]*0\.26/)
            assert.doesNotMatch(bilingual, /VAT included|VAT excluded|VAT added/)
            const noRate = classicMarkupFor('Pepsi', 'بيبسي', { vatRate: 0, vatAmount: .26 })
            assert.match(noRate, /VAT Amount \/ مبلغ الضريبة/)
            assert.doesNotMatch(noRate, /VAT Amount 0%/)
            const credit = classicMarkupFor('Pepsi', 'بيبسي', {}, { identity: { ...model.identity, kind: 'credit_note', invoiceType: 'credit_note' } })
            assert.match(credit, /Pepsi[\s\S]*بيبسي/)
            assert.match(credit, /VAT Amount 15%[\s\S]*مبلغ الضريبة 15%/)
            assert.match(bilingual, /thermal-row thermal-row-strong[\s\S]*thermal-classic-total-label[\s\S]*thermal-value/)
          }
        }
        if (layout.storedId === 'compact') {
          if (fixtureCase.language === 'both') assert.match(markup, /thermal-compact-line__names--bilingual/)
          assert.equal((markup.match(/thermal-compact-line__vat/g) ?? []).length, items.length)
          assert.equal((markup.match(/thermal-compact-line__discount/g) ?? []).length, items.filter(item => item.discount > 0.005).length)
          assert.match(markup, fixtureCase.payment === 'split' ? /thermal-compact-payments--split/ : /thermal-compact-payments--single/)
        }
        if (layout.storedId === 'standard') {
          if (fixtureCase.language === 'both') assert.match(markup, /thermal-structured-line__names--bilingual/)
          assert.equal((markup.match(/thermal-structured-line__vat/g) ?? []).length, items.length)
          assert.equal((markup.match(/thermal-structured-line__discount/g) ?? []).length, items.filter(item => item.discount > 0.005).length)
          assert.match(markup, fixtureCase.payment === 'split' ? /thermal-structured-payments--split/ : /thermal-structured-payments--single/)
          assert.match(markup, /thermal-structured-totals/)
        }
        if (layout.storedId === 'detailed') {
          if (fixtureCase.language === 'both') assert.match(markup, /thermal-branded-line__names--bilingual/)
          assert.equal((markup.match(/thermal-branded-line__vat/g) ?? []).length, items.length)
          assert.equal((markup.match(/thermal-branded-line__discount/g) ?? []).length, items.filter(item => item.discount > 0.005).length)
          assert.match(markup, fixtureCase.payment === 'split' ? /thermal-branded-payments--split/ : /thermal-branded-payments--single/)
          assert.match(markup, /thermal-branded-totals/)
          assert.match(markup, /Thank you/)
        }

        const walkInMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
          model: {
            ...model,
            buyer: {
              ...model.buyer,
              name: 'Walk-in Customer',
              nameAr: 'عميل نقدي',
              isWalkIn: true,
            },
          },
          options: { preview: true, nonFiscalDemo: fixtureCase.qr === 'demo' },
        }))
        assert.doesNotMatch(walkInMarkup, /thermal-buyer|Walk-in Customer|عميل نقدي/)

        const individualMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
          model: {
            ...model,
            buyer: {
              ...model.buyer,
              name: 'Selected Individual',
              nameAr: 'عميل فرد محدد',
              vatNumber: null,
              type: 'individual',
              isWalkIn: false,
            },
          },
          options: { preview: true },
        }))
        assert.match(individualMarkup, /thermal-buyer/)
        assert.match(individualMarkup, /Selected Individual|عميل فرد محدد/)

        const businessMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
          model: {
            ...model,
            identity: { ...model.identity, invoiceType: 'standard' },
            buyer: {
              ...model.buyer,
              name: 'Selected Business',
              nameAr: 'منشأة محددة',
              vatNumber: '399999999999993',
              address: 'Building 99, Northern Ring Road, Al Murooj District, Riyadh 12281, Saudi Arabia',
              addressAr: 'مبنى ٩٩، طريق الدائري الشمالي، حي المروج، الرياض ١٢٢٨١، المملكة العربية السعودية',
              identifierType: 'CR',
              identifierValue: '1010999999',
              type: 'business',
              isWalkIn: false,
            },
          },
          options: { preview: true },
        }))
        assert.match(businessMarkup, /thermal-buyer/)
        assert.match(businessMarkup, /399999999999993/)
        if (layout.storedId === 'compact') {
          if (fixtureCase.language !== 'ar') assert.match(businessMarkup, /Building 99, Northern Ring Road, Al Murooj District, Riyadh 12281, Saudi Arabia/)
          if (fixtureCase.language !== 'en') assert.match(businessMarkup, /مبنى ٩٩، طريق الدائري الشمالي، حي المروج، الرياض ١٢٢٨١، المملكة العربية السعودية/)
          assert.match(businessMarkup, /1010999999/)
          if (width === '58mm') assert.doesNotMatch(businessMarkup, /thermal-buyer[^>]*style="[^"]*display:\s*none/)

          const deduplicatedMerchantMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
            model: {
              ...model,
              seller: {
                ...model.seller,
                registeredName: 'One Seller Name',
                registeredNameAr: null,
                displayHeading: 'One Seller Name',
                displaySubheading: 'One Seller Name',
                branch: { name: 'One Seller Name', nameAr: null, visible: true },
              },
            },
            options: { preview: true },
          }))
          assert.equal((deduplicatedMerchantMarkup.match(/One Seller Name/g) ?? []).length, 1)
        }
        if (layout.storedId === 'standard') {
          if (fixtureCase.language !== 'ar') assert.match(businessMarkup, /Building 99, Northern Ring Road, Al Murooj District, Riyadh 12281, Saudi Arabia/)
          if (fixtureCase.language !== 'en') assert.match(businessMarkup, /مبنى ٩٩، طريق الدائري الشمالي، حي المروج، الرياض ١٢٢٨١، المملكة العربية السعودية/)
          assert.match(businessMarkup, /1010999999/)
          if (width === '58mm') assert.doesNotMatch(businessMarkup, /thermal-buyer[^>]*style="[^"]*display:\s*none/)

          const deduplicatedMerchantMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
            model: {
              ...model,
              seller: {
                ...model.seller,
                registeredName: 'One Seller Name',
                registeredNameAr: null,
                displayHeading: 'One Seller Name',
                displaySubheading: 'One Seller Name',
                branch: { name: 'One Seller Name', nameAr: null, visible: true },
              },
            },
            options: { preview: true },
          }))
          assert.equal((deduplicatedMerchantMarkup.match(/One Seller Name/g) ?? []).length, 1)

          if (width === '58mm' && fixtureCase.language === 'both') {
            const stressMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
              model: {
                ...model,
                identity: { ...model.identity, invoiceType: 'standard' },
                seller: {
                  ...model.seller,
                  registeredName: 'Long Saudi Legal Supplier Company Name for Structured Thermal Compliance Testing',
                  registeredNameAr: 'شركة المورد القانوني السعودية طويلة الاسم لاختبار الامتثال الحراري المنظم',
                  displayHeading: 'Long Trading Name for Fiscal Documents',
                  displaySubheading: null,
                  branch: { name: 'Long Trading Name for Fiscal Documents', nameAr: null, visible: true },
                },
                buyer: {
                  ...model.buyer,
                  name: 'Long Buyer Company Name for Immutable Structured Invoice Validation',
                  nameAr: 'شركة المشتري طويلة الاسم للتحقق من الفاتورة المنظمة غير القابلة للتغيير',
                  vatNumber: '399999999999993',
                  address: 'Building 99, Northern Ring Road, Al Murooj District, Riyadh 12281, Saudi Arabia',
                  addressAr: 'مبنى ٩٩، طريق الدائري الشمالي، حي المروج، الرياض ١٢٢٨١، المملكة العربية السعودية',
                  identifierType: 'CR',
                  identifierValue: '1010999999',
                  type: 'business',
                  isWalkIn: false,
                },
              },
              options: { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' },
            }))
            for (const value of ['Long Saudi Legal Supplier Company Name for Structured Thermal Compliance Testing', 'شركة المورد القانوني السعودية طويلة الاسم لاختبار الامتثال الحراري المنظم', 'Long Buyer Company Name for Immutable Structured Invoice Validation', 'شركة المشتري طويلة الاسم للتحقق من الفاتورة المنظمة غير القابلة للتغيير', '399999999999993', '1010999999']) assert.match(stressMarkup, new RegExp(value))
          }
        }
        if (layout.storedId === 'detailed') {
          if (fixtureCase.language !== 'ar') assert.match(businessMarkup, /Building 99, Northern Ring Road, Al Murooj District, Riyadh 12281, Saudi Arabia/)
          if (fixtureCase.language !== 'en') assert.match(businessMarkup, /مبنى ٩٩، طريق الدائري الشمالي، حي المروج، الرياض ١٢٢٨١، المملكة العربية السعودية/)
          assert.match(businessMarkup, /1010999999/)
          if (width === '58mm') assert.doesNotMatch(businessMarkup, /thermal-buyer[^>]*style="[^"]*display:\s*none/)

          const deduplicatedMerchantMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
            model: {
              ...model,
              seller: {
                ...model.seller,
                registeredName: 'One Seller Name',
                registeredNameAr: null,
                displayHeading: 'One Seller Name',
                displaySubheading: 'One Seller Name',
                branch: { name: 'One Seller Name', nameAr: null, visible: true },
              },
            },
            options: { preview: true },
          }))
          assert.equal((deduplicatedMerchantMarkup.match(/One Seller Name/g) ?? []).length, 1)

          const logoMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
            model: { ...model, presentation: { ...model.presentation, logo: { ...model.presentation.logo, visible: true, previewUrl: 'data:image/png;base64,RklYVFVSRQ==' } } },
            options: { preview: true },
          }))
          assert.match(logoMarkup, /class="thermal-logo"/)
          const noLogoMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
            model: { ...model, presentation: { ...model.presentation, logo: { ...model.presentation.logo, visible: false, previewUrl: null, assetPath: null } } },
            options: { preview: true },
          }))
          assert.doesNotMatch(noLogoMarkup, /class="thermal-logo"/)
          const contactHiddenMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
            model: { ...model, presentation: { ...model.presentation, contact: { ...model.presentation.contact, phoneVisible: false, emailVisible: false, websiteVisible: false } } },
            options: { preview: true },
          }))
          assert.doesNotMatch(contactHiddenMarkup, /fixture@example\.com|\+966500000001|https:\/\/example\.com/)

          if (width === '58mm' && fixtureCase.language === 'both') {
            const stressMarkup = renderToStaticMarkup(createElement(ThermalReceipt, {
              model: {
                ...model,
                identity: { ...model.identity, invoiceType: 'standard' },
                seller: {
                  ...model.seller,
                  registeredName: 'Long Saudi Legal Supplier Company Name for Branded Thermal Compliance Testing',
                  registeredNameAr: 'شركة المورد القانوني السعودية طويلة الاسم لاختبار الامتثال الحراري المميز',
                  displayHeading: 'Long Trading Name for Premium Receipts',
                  displaySubheading: null,
                  branch: { name: 'Long Trading Name for Premium Receipts', nameAr: null, visible: true },
                },
                buyer: {
                  ...model.buyer,
                  name: 'Long Buyer Company Name for Immutable Branded Invoice Validation',
                  nameAr: 'شركة المشتري طويلة الاسم للتحقق من الفاتورة المميزة غير القابلة للتغيير',
                  vatNumber: '399999999999993',
                  address: 'Building 99, Northern Ring Road, Al Murooj District, Riyadh 12281, Saudi Arabia',
                  addressAr: 'مبنى ٩٩، طريق الدائري الشمالي، حي المروج، الرياض ١٢٢٨١، المملكة العربية السعودية',
                  identifierType: 'CR',
                  identifierValue: '1010999999',
                  type: 'business',
                  isWalkIn: false,
                },
              },
              options: { preview: true, qrImageUrl: 'data:image/png;base64,RklYVFVSRQ==' },
            }))
            for (const value of ['Long Saudi Legal Supplier Company Name for Branded Thermal Compliance Testing', 'شركة المورد القانوني السعودية طويلة الاسم لاختبار الامتثال الحراري المميز', 'Long Buyer Company Name for Immutable Branded Invoice Validation', 'شركة المشتري طويلة الاسم للتحقق من الفاتورة المميزة غير القابلة للتغيير', '399999999999993', '1010999999']) assert.match(stressMarkup, new RegExp(value))
          }
        }
        rendered.push({ layout: layout.publicId, width, caseId: fixtureCase.id, markup })
      }
    }
  }

  assert.equal(rendered.length, 48)
  assert.equal(new Set(rendered.map(result => result.layout)).size, 4)
  assert.equal(new Set(rendered.map(result => result.width)).size, 2)
  assert.equal(new Set(layouts.map(layout => layout.landmark)).size, 4)
  console.log('Thermal receipt runtime matrix passed (192 SSR renders: 4 structures × 2 widths × 6 fixture scenarios × base/walk-in/individual/business buyers).')
} finally {
  await server.close()
}
