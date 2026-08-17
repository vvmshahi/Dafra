import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

// The adapter imports the shared Supabase client even though this is a pure SSR test.
// Keep the test offline while satisfying that module's build-time configuration contract.
process.env.VITE_SUPABASE_URL ??= 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY ??= 'anonymous-test-key'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const thermalPreview = invoiceSettings.slice(invoiceSettings.indexOf("preview={previewMode === 'thermal'"), invoiceSettings.indexOf(': <A4PreviewFit'))

assert.match(thermalPreview, /data-thermal-live-preview/)
assert.match(thermalPreview, /<ThermalReceipt model=\{previewModel\}/)
assert.doesNotMatch(thermalPreview, /sampleLabel/)
assert.match(thermalPreview, /w-max min-w-full/)
assert.match(read('src/components/print/DocumentPreview.tsx'), /<ThermalReceipt model=\{model\} options=\{\{ preview: true \}\} \/>/)

const server = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } })

try {
  const [thermalModule, adapters, settings] = await Promise.all([
    server.ssrLoadModule('/src/components/print/ThermalReceipt.tsx'),
    server.ssrLoadModule('/src/lib/invoices/documentViewAdapters.ts'),
    server.ssrLoadModule('/src/lib/invoices/presentationSettings.ts'),
  ])
  const { default: ThermalReceipt, THERMAL_RECEIPT_LAYOUTS } = thermalModule
  const layouts = ['classic', 'compact', 'standard', 'detailed']
  const widths = ['58mm', '80mm']
  const branch = {
    business_name: 'Parity Merchant', business_name_ar: 'تاجر المطابقة', name: 'Parity Branch', name_ar: 'فرع المطابقة',
    phone: '+966500000001', email: 'parity@example.com', address: 'King Fahd Road, Riyadh', vat_number: '300000000000003',
  }
  const normalizeMarkup = markup => markup.replace(/style="display:(?:block|none);/, 'style="display:renderer;')
  const receiptRoot = markup => markup.match(/<div id="thermal-receipt" class="([^"]+)"[^>]*data-receipt-layout="([^"]+)"[^>]*data-qr-placement="([^"]+)"/)?.slice(1)

  for (const density of layouts) {
    for (const width of widths) {
      const normalized = settings.normalizeInvoiceSettings({
        invoice_language: 'both',
        presentation_settings: { thermal: { density, width, qr_size: 'standard', wrap_item_names: true, show_cash_change: true } },
      }, branch)
      const draft = { presentation: normalized.presentation, invoiceLanguage: normalized.invoiceLanguage, printMode: normalized.printMode, afterSaleAction: normalized.afterSaleAction }
      const model = adapters.documentFromPreviewDraft(draft)
      const render = (preview, variant = model) => renderToStaticMarkup(createElement(ThermalReceipt, {
        model: variant,
        options: { preview, qrImageUrl: 'data:image/png;base64,UEFSSVRZ' },
      }))
      const previewMarkup = render(true)
      const printMarkup = render(false)
      assert.deepEqual(receiptRoot(previewMarkup), receiptRoot(printMarkup), `${density}/${width} root parity`)
      assert.equal(normalizeMarkup(previewMarkup), normalizeMarkup(printMarkup), `${density}/${width} renderer markup parity`)
      assert.match(previewMarkup, new RegExp(`thermal-theme--${THERMAL_RECEIPT_LAYOUTS[density].id}`))
      assert.match(previewMarkup, new RegExp(`thermal-receipt--${width}`))
      assert.match(previewMarkup, /thermal-qr/)
      if (density === 'standard') assert.match(previewMarkup, /thermal-structured-close[\s\S]*thermal-qr/)
      if (density === 'detailed') assert.match(previewMarkup, /thermal-branded-close[\s\S]*thermal-qr/)

      const logoModel = { ...model, presentation: { ...model.presentation, logo: { ...model.presentation.logo, visible: true, previewUrl: 'data:image/png;base64,TE9HTw==' } } }
      assert.match(render(true, logoModel), /class="thermal-logo"/)
      assert.equal(normalizeMarkup(render(true, logoModel)), normalizeMarkup(render(false, logoModel)), `${density}/${width} logo-present parity`)
      const noLogoModel = { ...model, presentation: { ...model.presentation, logo: { ...model.presentation.logo, visible: false, previewUrl: null, assetPath: null } } }
      assert.doesNotMatch(render(true, noLogoModel), /class="thermal-logo"/)
      assert.equal(normalizeMarkup(render(true, noLogoModel)), normalizeMarkup(render(false, noLogoModel)), `${density}/${width} logo-absent parity`)
    }
  }
  console.log('thermal live-preview parity tests passed (4 renderers × 2 widths × logo present/absent)')
} finally {
  await server.close()
}
