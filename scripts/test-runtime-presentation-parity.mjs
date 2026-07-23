import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// Compile the two pure presentation modules together so this fixture exercises
// the real normalizer and DocumentViewModel builder without a browser or a
// Supabase connection.
const settingsSource = ts.transpileModule(read('src/lib/invoices/presentationSettings.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const documentSource = ts.transpileModule(read('src/lib/invoices/documentViewModel.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replace("import { documentDirection, normalizeDocumentLanguage } from '@/localization/documents';", "const documentDirection = language => language === 'ar' ? 'rtl' : 'ltr'; const normalizeDocumentLanguage = value => value === 'ar' || value === 'both' ? value : 'en';")
  .replace("import { resolveHistoricalA4Template } from './presentationSettings';", '')
const presentationModule = await import(`data:text/javascript,${encodeURIComponent(`${settingsSource}\n${documentSource}`)}`)
const { normalizeInvoiceSettings, buildPresentationDocument } = presentationModule

const branch = {
  name: 'Main Branch',
  business_name: 'Kubri Company',
  phone: '0500000000',
  email: 'legacy@example.test',
  website: 'https://legacy.example.test',
  invoice_language: 'en',
  print_mode: 'thermal',
  show_logo: true,
  show_footer: true,
}
const fixture = {
  presentation_settings: {
    schema_version: 1,
    language: 'both',
    after_sale_action: 'both',
    branding: {
      heading_mode: 'custom',
      custom_heading: 'Kubri Runtime Test',
      subheading: 'Presentation Parity',
      show_company_name: false,
      logo_path: 'branch-1/logo.png',
      logo_size: 'large',
    },
    contact: {
      show_phone: true,
      phone_override: '0555555555',
      show_email: true,
      email: 'parity@example.test',
      show_website: true,
      website: 'https://parity.example.test',
      show_address: true,
      address_override: '1 Parity Street, Riyadh',
    },
    footer: { message: 'Thank you from Kubri', bold: true },
    thermal: { width: '58mm', density: 'compact', qr_size: 'large', qr_alignment: 'right' },
    a4: { theme: 'modern_split' },
  },
}

const resolved = normalizeInvoiceSettings(fixture, branch)
assert.equal(resolved.invoiceLanguage, 'both')
assert.equal(resolved.afterSaleAction, 'both')
assert.equal(resolved.presentation.identity.display_heading, 'Kubri Runtime Test')
assert.equal(resolved.presentation.identity.display_subheading, 'Presentation Parity')
assert.equal(resolved.presentation.identity.show_company_name, false)
assert.equal(resolved.presentation.identity.show_branch_name, false)
assert.equal(resolved.presentation.logo.asset_path, 'branch-1/logo.png')
assert.equal(resolved.presentation.logo.size, 'large')
assert.deepEqual(resolved.presentation.contact, {
  phone: '0555555555', email: 'parity@example.test', website: 'https://parity.example.test',
  address_override: '1 Parity Street, Riyadh', show_phone: true, show_email: true,
  show_website: true, show_address: true,
})
assert.equal(resolved.presentation.footer.footer_note, 'Thank you from Kubri')
assert.equal(resolved.presentation.footer.bold, true)
assert.equal(resolved.presentation.thermal.width, '58mm')
assert.equal(resolved.presentation.thermal.density, 'compact')
assert.equal(resolved.presentation.thermal.qr_size, 'large')
assert.equal(resolved.presentation.thermal.qr_alignment, 'center')
const legacyEnglish = normalizeInvoiceSettings({ invoice_language: 'en' }, branch)
assert.equal(legacyEnglish.invoiceLanguage, 'both')
const hiddenPhone = normalizeInvoiceSettings({ presentation_settings: { contact: { phone_override: '0555555555', show_phone: false } } }, branch)
assert.equal(hiddenPhone.presentation.contact.phone, '0555555555')
assert.equal(hiddenPhone.presentation.contact.show_phone, false)
assert.equal(resolved.presentation.a4.template_id, 'modern_split')

const branchHeading = normalizeInvoiceSettings({ presentation_settings: { branding: { heading_mode: 'branch', custom_heading: null, show_company_name: true, logo_path: null, logo_size: 'medium' } } }, branch)
assert.equal(branchHeading.presentation.identity.display_heading, branch.name)
assert.equal(branchHeading.presentation.identity.show_branch_name, false)

const fallback = normalizeInvoiceSettings({
  presentation_settings: {
    contact: { phone_override: '', email: '', website: '', show_phone: true, show_email: true, show_website: true, show_address: true },
    footer: { message: null, bold: false },
  },
}, { ...branch, address: 'Legacy branch address' })
assert.equal(fallback.presentation.contact.phone, branch.phone)
assert.equal(fallback.presentation.contact.email, '')
assert.equal(fallback.presentation.contact.website, '')
assert.equal(fallback.presentation.contact.address_override, 'Legacy branch address')
assert.equal(fallback.presentation.footer.footer_note, null)
assert.equal(fallback.presentation.footer.show_footer, false)

const model = buildPresentationDocument({
  settings: resolved.presentation,
  language: resolved.invoiceLanguage,
  printMode: resolved.printMode,
  registeredName: branch.business_name,
  registeredNameAr: null,
  vatNumber: '300000000000003',
  registrationType: 'CR',
  registrationNumber: '1010101010',
  registeredAddress: 'Compliance Address, Riyadh',
  branchName: branch.name,
  branchNameAr: null,
  logoPreviewUrl: 'https://public.example.test/branch-1/logo.png',
}, {
  source: 'legacy',
  identity: { kind: 'invoice', invoiceType: 'simplified', number: 'INV-1', uuid: null, issueTimestamp: '2026-07-22T10:00:00Z', language: 'both', direction: 'ltr', snapshotVersion: null, legacy: true, fidelity: 'best_effort' },
  buyer: { name: 'Buyer', nameAr: null, vatNumber: null, address: null, addressAr: null, identifierType: null, identifierValue: null, type: 'individual' },
  items: [{ description: 'Item', descriptionAr: null, quantity: 1, unitPrice: 100, discount: 0, taxableAmount: 100, vatRate: 15, vatAmount: 15, lineTotal: 115, creditedQuantity: null }],
  totals: { currency: 'SAR', subtotal: 100, discount: 0, taxableAmount: 100, vat: 15, total: 115, paid: 115, refunded: 0, balance: 0 },
  payments: [{ method: 'card', amount: 115, cashTendered: null, change: null, reference: null }],
  compliance: { qr: { source: 'unavailable', reference: null }, xmlState: 'unavailable', originalDocument: { id: null, number: null }, creditReason: null },
})

assert.equal(model.seller.displayHeading, 'Kubri Runtime Test')
assert.equal(model.seller.displaySubheading, 'Presentation Parity')
assert.equal(model.seller.company.visible, false)
assert.equal(model.seller.registeredName, 'Kubri Company')
assert.equal(model.seller.branch.visible, false)
assert.equal(model.seller.registeredAddress, 'Compliance Address, Riyadh')
assert.equal(model.presentation.logo.previewUrl, 'https://public.example.test/branch-1/logo.png')
assert.equal(model.presentation.logo.size, 'large')
assert.equal(model.presentation.contact.phone, '0555555555')
assert.equal(model.presentation.contact.email, 'parity@example.test')
assert.equal(model.presentation.contact.website, 'https://parity.example.test')
assert.equal(model.presentation.contact.address, '1 Parity Street, Riyadh')
assert.equal(model.presentation.footer.footer, 'Thank you from Kubri')
assert.equal(model.presentation.footer.bold, true)
assert.equal(model.presentation.thermal.width, '58mm')
assert.equal(model.presentation.thermal.density, 'compact')
assert.equal(model.presentation.thermal.qrSize, 'large')
assert.equal(model.presentation.thermal.qrAlignment, 'center')
assert.equal(model.template.resolvedId, 'modern_split')
assert.equal(model.presentation.afterSaleAction, 'both')

for (const path of ['src/pages/branch/InvoiceSettingsPage.tsx', 'src/pages/pos/POSPage.tsx', 'src/pages/print/ReceiptPrintPage.tsx', 'src/pages/invoices/InvoiceDetailPage.tsx']) {
  const source = read(path)
  assert.match(source, /documentFrom(?:PreviewDraft|PosReceipt|StoredInvoice)/)
}
for (const path of ['src/pages/pos/POSPage.tsx', 'src/pages/invoices/InvoiceDetailPage.tsx']) {
  assert.match(read(path), /<A4Document model=\{documentViewModel\}/)
}
for (const path of ['src/pages/pos/POSPage.tsx', 'src/pages/print/ReceiptPrintPage.tsx', 'src/pages/invoices/InvoiceDetailPage.tsx']) {
  assert.match(read(path), /<ThermalReceipt model=\{documentViewModel\}/)
}

console.log('Runtime presentation parity fixture passed (normalized settings and DocumentViewModel preserve every configured branding, contact, footer, Thermal, A4, logo URL, language, and after-sale field).')
