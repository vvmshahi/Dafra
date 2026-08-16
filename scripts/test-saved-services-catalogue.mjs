import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getCatalogueItemCreationCapabilities,
  getCataloguePresentation,
} from '../src/lib/products/cataloguePresentation.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const productsPage = read('src/pages/products/ProductsPage.tsx')
const productDrawer = read('src/pages/products/ProductDrawer.tsx')
const productUnits = read('src/pages/products/ProductUnitsSection.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const creditNote = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const branchDetail = read('src/pages/admin/BranchDetailPage.tsx')
const stockTab = read('src/pages/inventory/ProductStockTab.tsx')
const thermalItems = read('src/components/print/ThermalReceiptCompositions.tsx')
const a4 = read('src/components/print/A4Document.tsx')
const schema = read('supabase/migrations/20260721000100_dafra_current_schema_and_security.sql')
const phaseOneMigration = read('supabase/migrations/20260816000200_branch_billing_profile_foundation.sql')
const enProducts = JSON.parse(read('src/localization/locales/en/products.json'))
const arProducts = JSON.parse(read('src/localization/locales/ar-SA/products.json'))
const enPos = JSON.parse(read('src/localization/locales/en/pos.json'))
const arPos = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))

const config = ({
  productsEnabled,
  servicesEnabled,
  legacyProfile = false,
  businessProfile = 'services',
}) => ({
  branchId: 'branch-1',
  businessProfile: legacyProfile ? null : businessProfile,
  legacyProfile,
  productsEnabled,
  servicesEnabled,
  stockEnabled: false,
  posMode: 'touch',
  customLinesEnabled: false,
})

const servicesOnly = config({ productsEnabled: false, servicesEnabled: true })
const servicesAndProducts = config({ productsEnabled: true, servicesEnabled: true })
const productsOnly = config({ productsEnabled: true, servicesEnabled: false, businessProfile: 'retail_trading' })
const legacy = config({ productsEnabled: false, servicesEnabled: false, legacyProfile: true })

assert.deepEqual(getCatalogueItemCreationCapabilities(servicesOnly), {
  productsEnabled: false,
  servicesEnabled: true,
  showItemType: true,
})
assert.deepEqual(getCatalogueItemCreationCapabilities(servicesAndProducts), {
  productsEnabled: true,
  servicesEnabled: true,
  showItemType: true,
})
assert.deepEqual(getCatalogueItemCreationCapabilities(productsOnly), {
  productsEnabled: true,
  servicesEnabled: false,
  showItemType: false,
})
assert.deepEqual(getCatalogueItemCreationCapabilities(legacy), {
  productsEnabled: true,
  servicesEnabled: false,
  showItemType: false,
})
assert.equal(getCataloguePresentation(servicesOnly).titleKey, 'catalogue')
assert.equal(getCataloguePresentation(servicesOnly).addActionKey, 'addItem')
assert.equal(getCataloguePresentation(productsOnly).titleKey, 'title')
assert.equal(getCataloguePresentation(productsOnly).addActionKey, 'add')

// The selected Owner/Admin branch remains the only branch passed to the drawer;
// a branch user still resolves its own assigned branch inside the drawer.
assert.match(productsPage, /useBranchBillingConfig\(catalogueBranchId\)/)
assert.match(productsPage, /branchId=\{catalogueBranchId\}/)
assert.match(productsPage, /branchContext=\{catalogueBranch\}/)
assert.match(productDrawer, /const resolvedBranchId = branchId \?\? profile\?\.branch_id/)
assert.match(productDrawer, /branch_id: resolvedBranchId/)

// Creation is profile-aware, while historical rows and editing are left alone.
assert.match(productsPage, /getCatalogueItemCreationCapabilities\(effectiveBillingConfig\)/)
assert.match(productsPage, /const canCreateCatalogueItem = !billingConfigLoading/)
assert.match(productsPage, /itemTypeCapabilities=\{itemTypeCapabilities\}/)
assert.match(productDrawer, /itemTypeCapabilities\?: CatalogueItemCreationCapabilities/)
assert.match(productDrawer, /if \(!product && isService && !servicesEnabled\)/)
assert.match(productDrawer, /if \(!product && !isService && !productsEnabled\)/)
assert.match(productDrawer, /showItemType && \(/)
assert.match(productDrawer, /products:itemType\.product/)
assert.match(productDrawer, /products:itemType\.service/)

// A saved service persists on the existing secure product path and cannot retain
// tracking. Turning a tracked product into a service requires the existing
// tracking-disable workflow first; the reverse leaves tracking off by default.
assert.match(productDrawer, /is_service:\s+isService/)
assert.match(productDrawer, /rpc\('create_product_secure'/)
assert.match(productDrawer, /rpc\('update_product_secure'/)
assert.doesNotMatch(productDrawer, /\.from\('products'\)\.(insert|update)/)
assert.match(productDrawer, /setTrackStock\(nextIsService \? false/)
assert.match(productDrawer, /if \(!isService\) return\s+setTrackStock\(false\)/)
assert.match(productDrawer, /if \(nextIsService && productWasTracked\)/)
assert.match(productDrawer, /products:editor\.serviceRequiresStockDisable/)
const typeSelector = productDrawer.slice(
  productDrawer.indexOf('const selectItemType'),
  productDrawer.indexOf("useEffect(() => {\n    if (!open || product || createdProductId", productDrawer.indexOf('const selectItemType')),
)
assert.match(typeSelector, /setIsService\(nextIsService\)/)
assert.doesNotMatch(typeSelector, /setTrackStock\(true\)/)
assert.match(productDrawer, /PRODUCT_TABS\.filter\(tab => tab\.id !== 'inventory'\)/)
assert.match(productDrawer, /serviceRestricted=\{businessType === 'service' \|\| isService\}/)
assert.match(productUnits, /if \(serviceRestricted\)/)
assert.match(phaseOneMigration, /products_service_cannot_track_stock_check/)
assert.match(phaseOneMigration, /NOT COALESCE\(is_service, false\) OR NOT COALESCE\(track_stock, false\)/)
assert.match(schema, /'is_service'/)
assert.match(schema, /Service products cannot track stock/)

// Services use the same categories, units, and normal product-backed Catalogue
// cart model. Custom Lines are a separate, non-checkoutable client variant.
assert.match(productsPage, /categories=\{categories\}/)
assert.match(pos, /type CatalogueCartLine/)
assert.match(pos, /const line: CatalogueCartLine/)
assert.match(pos, /source: 'catalogue'/)
assert.match(pos, /product_id: item\.productId/)
assert.match(pos, /product_unit_id: item\.productUnitId/)
assert.match(pos, /cart\.filter\(isCatalogueCartLine\)\.map/)
assert.match(pos, /resolvePosCheckoutDocument\(branch\.id, customerId\)/)

// POS filters active operational items only for explicit profiles. Legacy
// branches keep their established catalogue while service and product rows share
// the same product-backed load, search, scanner, and unit resolution paths.
assert.match(pos, /loadEffectiveBranchBillingConfig\(bid\)\.catch\(\(\) => null\)/)
assert.match(pos, /billingConfig && !billingConfig\.legacyProfile/)
assert.match(pos, /product\.is_service \? billingConfig\.servicesEnabled : billingConfig\.productsEnabled/)
assert.match(pos, /isService:\s+Boolean\(p\.is_service\)/)
assert.match(pos, /sellingUnits:\s+unitsByProduct\.get\(p\.id\)/)
assert.match(pos, /useBarcodeScanner\(/)
assert.match(pos, /resolveScannerCode\(/)
assert.match(pos, /enforceStock: enforceScanStock && stockVisible && product\.trackStock && !product\.isService/)
assert.match(pos, /stockVisible && !product\.isService && <div>/)
assert.ok((pos.match(/t\('itemType\.service'\)/g) ?? []).length >= 2)

// Service rows have no stock/low-stock presentation or credit-note restock,
// while the existing documents render snapshot item names, quantities, VAT, and totals.
assert.match(productsPage, /\{product\.is_service && <ServiceBadge \/>\}/)
assert.match(productsPage, /\{!product\.is_service && \(/)
assert.match(creditNote, /line\.item\.product_id && line\.item\.track_stock && !line\.item\.is_service/)
assert.match(creditNote, /line\.item\.is_service \|\| !line\.item\.track_stock \|\| !line\.item\.product_id/)
for (const source of [branchDashboard, branchDetail, stockTab]) {
  assert.match(source, /\.eq\('is_service', false\)/)
}
assert.match(thermalItems, /model\.items\.map/)
assert.match(thermalItems, /item\.descriptionAr/)
assert.match(thermalItems, /item\.unitPrice/)
assert.match(a4, /model\.items\.map/)
assert.match(a4, /item\.descriptionAr/)
assert.match(a4, /item\.vatAmount/)

for (const locale of [enProducts, arProducts]) {
  assert.equal(typeof locale.itemType.label, 'string')
  assert.equal(typeof locale.itemType.product, 'string')
  assert.equal(typeof locale.itemType.productHint, 'string')
  assert.equal(typeof locale.itemType.service, 'string')
  assert.equal(typeof locale.itemType.serviceHint, 'string')
  assert.equal(typeof locale.errors.productCreationDisabled, 'string')
  assert.equal(typeof locale.errors.serviceCreationDisabled, 'string')
  assert.equal(typeof locale.editor.serviceRequiresStockDisable, 'string')
}
assert.equal(enPos.itemType.service, 'Service')
assert.equal(arPos.itemType.service, 'خدمة')

console.log('Saved services catalogue tests passed.')
