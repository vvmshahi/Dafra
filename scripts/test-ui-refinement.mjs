import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = path => readFileSync(resolve(root, path), 'utf8')
const cases = []

function check(name, run) {
  cases.push({ name, run })
}

function flattenKeys(value, prefix = '', keys = []) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenKeys(child, path, keys)
    } else {
      keys.push(path)
    }
  }
  return keys
}

function semanticKeys(value) {
  return [...new Set(flattenKeys(value).map(key => (
    key.replace(/_(zero|one|two|few|many|other)$/, '')
  )))].sort()
}

const app = read('src/App.tsx')
const css = read('src/index.css')
const pageHeader = read('src/components/ui/PageHeader.tsx')
const filterPanel = read('src/components/ui/FilterPanel.tsx')
const contentState = read('src/components/ui/ContentState.tsx')
const button = read('src/components/ui/Button.tsx')
const input = read('src/components/ui/Input.tsx')
const confirmDialog = read('src/components/ui/ConfirmDialog.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
const appLayout = read('src/components/layout/AppLayout.tsx')
const products = read('src/pages/products/ProductsPage.tsx')
const customers = read('src/pages/customers/CustomersPage.tsx')
const suppliers = read('src/pages/suppliers/SuppliersPage.tsx')
const customerFilters = read('src/components/customers/CustomerIntelligenceFilters.tsx')
const supplierFilters = read('src/components/suppliers/SupplierIntelligenceFilters.tsx')
const customerReports = read('src/pages/reports/CustomerIntelligenceReportsPage.tsx')
const supplierReports = read('src/pages/reports/SupplierIntelligenceReportsPage.tsx')
const printingWorkspace = read('src/pages/branch/PrintingDocumentsPage.tsx')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const purchaseHistory = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const riyal = read('src/components/ui/RiyalSymbol.tsx')

check('all production product routes remain registered', () => {
  for (const route of [
    '/login', '/onboarding', '/dashboard', '/branch', '/pos', '/products',
    '/inventory', '/purchases', '/customers', '/customers/:id', '/suppliers',
    '/suppliers/:id', '/invoices', '/invoices/:id', '/reports',
    '/reports/customers', '/reports/suppliers', '/invoice-settings',
    '/device-printer', '/settings', '/employees', '/branches',
  ]) {
    assert.match(app, new RegExp(`path="${route.replace(/[/:]/g, match => match === '/' ? '\\/' : '\\:')}"`))
  }
})

check('shared page header is semantic and adopted across operational pages', () => {
  assert.match(pageHeader, /<header/)
  assert.match(pageHeader, /aria-labelledby/)
  assert.match(pageHeader, /sm:flex-row/)
  const files = [
    'products/ProductsPage.tsx', 'customers/CustomersPage.tsx',
    'suppliers/SuppliersPage.tsx', 'purchases/PurchasesPage.tsx',
    'inventory/InventoryPage.tsx', 'expenses/ExpensesPage.tsx',
    'reports/ReportsPage.tsx', 'settings/SettingsPage.tsx',
  ]
  for (const file of files) assert.match(read(`src/pages/${file}`), /<PageHeader/)
})

check('customer and supplier intelligence share responsive filter primitives', () => {
  for (const source of [customerFilters, supplierFilters]) {
    assert.match(source, /<FilterPanel/)
    assert.match(source, /<fieldset/)
    assert.match(source, /<FilterPresetRow/)
    assert.match(source, /<ResponsiveFilterGrid/)
  }
  assert.match(filterPanel, /grid-cols-1/)
  assert.match(filterPanel, /sm:grid-cols-2/)
  assert.match(filterPanel, /lg:grid-cols-3/)
  assert.match(filterPanel, /xl:grid-cols-6/)
  assert.match(filterPanel, /overflow-x-auto/)
})

check('English and Arabic localization resources have semantic key parity', () => {
  const enDir = resolve(root, 'src/localization/locales/en')
  const arDir = resolve(root, 'src/localization/locales/ar-SA')
  const files = readdirSync(enDir).filter(file => file.endsWith('.json')).sort()
  assert.deepEqual(files, readdirSync(arDir).filter(file => file.endsWith('.json')).sort())
  for (const file of files) {
    const en = JSON.parse(readFileSync(resolve(enDir, file), 'utf8'))
    const ar = JSON.parse(readFileSync(resolve(arDir, file), 'utf8'))
    assert.deepEqual(semanticKeys(en), semanticKeys(ar), `${file} semantic keys differ`)
  }
})

check('new interface copy is localized rather than rendered as raw keys', () => {
  const changedSurfaces = [
    appLayout, sidebar, products, customers, suppliers,
    read('src/pages/settings/SettingsPage.tsx'),
    read('src/pages/auth/LoginPage.tsx'),
  ].join('\n')
  assert.doesNotMatch(changedSurfaces, />\s*(common|settings|navigation|products):[a-zA-Z0-9_.-]+\s*</)
  assert.doesNotMatch(changedSurfaces, /owner@company\.com or counter_user/)
  assert.match(changedSurfaces, /identifierPlaceholder/)
})

check('prominent CRUD search controls use logical RTL positioning', () => {
  for (const source of [products, customers, suppliers]) {
    assert.match(source, /absolute start-/)
    assert.match(source, /\bps-/)
    assert.doesNotMatch(source, /absolute left-3(?:\.5)? top-1\/2/)
  }
  assert.match(products, /absolute end-2 top-2/)
  assert.match(read('src/pages/settings/DevicePrinterPage.tsx'), /DirectionalIcon/)
})

check('shared button hierarchy remains explicit and press feedback is bounded', () => {
  for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'gold']) {
    assert.match(button, new RegExp(`${variant}:`))
  }
  const sharedButtonCss = css.match(/\.btn \{[\s\S]*?\n  \}/)?.[0] ?? ''
  assert.doesNotMatch(sharedButtonCss, /transition-all/)
  assert.match(sharedButtonCss, /active:scale-\[0\.97\]/)
  assert.match(sharedButtonCss, /disabled:scale-100/)
})

check('shared inputs connect labels, help, errors, and invalid state', () => {
  assert.match(input, /useId/)
  assert.match(input, /aria-invalid/)
  assert.match(input, /aria-describedby/)
  assert.match(input, /role="alert"/)
})

check('confirmation dialog has modal semantics and complete focus handling', () => {
  for (const marker of [
    'role="alertdialog"', 'aria-modal="true"', 'handleKeyDown',
    "event.key === 'Escape'", "event.key !== 'Tab'",
    'cancelRef.current?.focus()', 'returnFocusRef.current?.focus()',
    "document.body.style.overflow = 'hidden'",
  ]) {
    assert.match(confirmDialog, new RegExp(marker.replace(/[?.()]/g, '\\$&')))
  }
})

check('application shell has skip navigation and visible keyboard focus', () => {
  assert.match(appLayout, /href="#main-content"/)
  assert.match(appLayout, /id="main-content"/)
  assert.match(appLayout, /skipToContent/)
  assert.match(sidebar, /mainNavigation/)
  assert.match(sidebar, /focus-visible:ring-gold-300/)
})

check('reduced motion is respected globally', () => {
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /animation-duration: 0\.01ms/)
  assert.match(css, /scroll-behavior: auto/)
})

check('shared states cover loading, empty, and error semantics', () => {
  for (const kind of ['loading', 'empty', 'error']) assert.match(contentState, new RegExp(`'${kind}'`))
  assert.match(contentState, /aria-live/)
  assert.match(contentState, /aria-busy/)
  assert.match(contentState, /role=\{isError \? 'alert' : 'status'\}/)
  assert.match(customers, /<ContentState/)
  assert.match(suppliers, /<ContentState/)
})

check('long merchant names have safe wrapping foundations', () => {
  assert.match(pageHeader, /overflow-wrap:anywhere/)
  assert.match(contentState, /overflow-wrap:anywhere/)
  assert.match(filterPanel, /overflow-wrap:anywhere/)
  assert.match(products, /dir="auto"/)
  assert.match(customers, /dir="auto"/)
  assert.match(suppliers, /dir="auto"/)
})

check('Saudi Riyal display remains the shared money primitive', () => {
  assert.match(riyal, /SaudiRiyal/)
  assert.match(riyal, /tabular-nums/)
  assert.match(riyal, /export function Rial/)
  for (const source of [products, suppliers, customerReports, supplierReports, pos]) {
    assert.match(source, /<Rial/)
  }
})

check('Piece and Carton terminology remains localized and separate', () => {
  const posEn = JSON.parse(read('src/localization/locales/en/pos.json'))
  const posAr = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))
  assert.equal(posEn.packages.piece, 'Piece')
  assert.equal(posEn.packages.carton, 'Carton')
  assert.equal(posAr.packages.piece, 'قطعة')
  assert.equal(posAr.packages.carton, 'كرتون')
  assert.match(read('src/localization/locales/en/supplierIntelligence.json'), /Piece and Carton quantities separate/)
})

check('customer and supplier reports retain desktop table and mobile card fallbacks', () => {
  assert.match(customerReports, /hidden md:block overflow-x-auto/)
  assert.match(customerReports, /md:hidden divide-y/)
  assert.match(supplierReports, /hidden lg:block overflow-x-auto/)
  assert.match(supplierReports, /lg:hidden divide-y/)
})

check('Printing and Documents persistence and preview contracts remain intact', () => {
  assert.match(printingWorkspace, /<InvoiceSettingsPage/)
  assert.match(printingWorkspace, /<BarcodeLabelSettingsPanel/)
  assert.match(printingWorkspace, /<BarcodePrinterSetupPanel/)
  assert.match(invoiceSettings, /serializeInvoicePresentationSettingsForSave/)
  assert.match(invoiceSettings, /<ThermalReceipt/)
  assert.match(invoiceSettings, /<A4Document/)
})

check('Customer Intelligence contracts and routes remain intact', () => {
  assert.match(app, /path="\/reports\/customers"/)
  assert.match(app, /path="\/customers\/:id"/)
  assert.match(read('src/lib/customers/customerIntelligence.ts'), /get_customer_intelligence/)
  assert.ok(existsSync(resolve(root, 'scripts/test-customer-intelligence.mjs')))
})

check('Supplier Intelligence contracts and routes remain intact', () => {
  assert.match(app, /path="\/reports\/suppliers"/)
  assert.match(app, /path="\/suppliers\/:id"/)
  assert.match(read('src/lib/suppliers/supplierIntelligence.ts'), /get_supplier_intelligence/)
  assert.ok(existsSync(resolve(root, 'scripts/test-supplier-intelligence.mjs')))
})

check('barcode printing and workflow surfaces remain intact', () => {
  assert.match(products, /BarcodeBatchPrintDrawer/)
  assert.match(printingWorkspace, /BarcodeLabelSettingsPanel/)
  assert.ok(existsSync(resolve(root, 'scripts/test-barcode-printing-ux.mjs')))
  assert.ok(existsSync(resolve(root, 'scripts/test-barcode-workflow.mjs')))
})

check('purchase and receiving UI contracts remain intact', () => {
  assert.match(app, /path="\/purchases"/)
  assert.match(purchaseHistory, /PurchaseDrawer/)
  assert.match(purchaseHistory, /receiving_status/)
  assert.match(read('src/pages/purchases/PurchasesPage.tsx'), /PurchaseHistoryTab/)
})

check('POS route and checkout surface remain intact', () => {
  assert.match(app, /path="\/pos"/)
  assert.match(pos, /documentFromPosReceipt/)
  assert.match(pos, /async function charge\(\)/)
  assert.match(pos, /<ThermalReceipt/)
})

check('invoice and credit-note routes and components remain intact', () => {
  assert.match(app, /path="\/invoices"/)
  assert.match(app, /path="\/invoices\/:id"/)
  assert.match(read('src/pages/invoices/InvoicesPage.tsx'), /credit_note/)
  assert.match(read('src/pages/invoices/InvoiceDetailPage.tsx'), /CreateCreditNoteModal/)
  assert.ok(existsSync(resolve(root, 'src/pages/invoices/AtomicCreditNoteReceiptView.tsx')))
})

check('audit and screenshot follow-up artifacts are complete', () => {
  const audit = read('docs/ui-refinement-audit.md')
  const screenshots = read('docs/ui-screenshot-followups.md')
  for (const marker of [
    'Authentication and onboarding', 'Dashboard', 'POS', 'Products',
    'Customers', 'Suppliers', 'Purchases and receiving', 'Invoices and credit notes',
    'Printing & Documents', 'Mobile navigation', 'Arabic', 'Accessibility',
  ]) assert.match(audit, new RegExp(marker.replace('&', '\\&')))
  for (const width of ['360', '390', '768', '1024', '1280', '1440']) {
    assert.match(screenshots, new RegExp(width))
  }
})

let passed = 0
for (const item of cases) {
  try {
    item.run()
    passed += 1
    console.log(`  ✓ ${item.name}`)
  } catch (error) {
    console.error(`  ✗ ${item.name}`)
    throw error
  }
}

console.log(`ui refinement checks passed: ${passed}`)
