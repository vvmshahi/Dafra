import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getCataloguePresentation } from '../src/lib/products/cataloguePresentation.ts'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const sidebar = read('src/components/layout/Sidebar.tsx')
const productsPage = read('src/pages/products/ProductsPage.tsx')
const productDrawer = read('src/pages/products/ProductDrawer.tsx')
const routes = read('src/App.tsx')
const enNavigation = JSON.parse(read('src/localization/locales/en/navigation.json'))
const arNavigation = JSON.parse(read('src/localization/locales/ar-SA/navigation.json'))
const enProducts = JSON.parse(read('src/localization/locales/en/products.json'))
const arProducts = JSON.parse(read('src/localization/locales/ar-SA/products.json'))

const config = businessProfile => ({
  branchId: 'branch-1',
  businessProfile,
  legacyProfile: businessProfile === null,
  productsEnabled: businessProfile !== 'services',
  servicesEnabled: businessProfile === 'services',
  stockEnabled: businessProfile !== 'services',
  posMode: businessProfile === 'retail_trading' ? 'quick' : 'touch',
  customLinesEnabled: false,
})

for (const businessProfile of ['retail_trading', 'food_beverage']) {
  const presentation = getCataloguePresentation(config(businessProfile))
  assert.equal(presentation.navigationLabelKey, 'products')
  assert.equal(presentation.titleKey, 'title')
  assert.equal(presentation.addActionKey, 'add')
}

const servicesPresentation = getCataloguePresentation(config('services'))
assert.equal(servicesPresentation.navigationLabelKey, 'catalogue')
assert.equal(servicesPresentation.titleKey, 'catalogue')
assert.equal(servicesPresentation.addActionKey, 'addItem')

const legacyPresentation = getCataloguePresentation(config(null))
assert.equal(legacyPresentation.navigationLabelKey, 'products')
assert.equal(legacyPresentation.titleKey, 'title')
assert.equal(legacyPresentation.addActionKey, 'add')

assert.equal(enNavigation.products, 'Products')
assert.equal(enNavigation.catalogue, 'Catalogue')
assert.equal(arNavigation.products, 'المنتجات')
assert.equal(arNavigation.catalogue, 'الكتالوج')
for (const locale of [enProducts, arProducts]) {
  assert.equal(typeof locale.catalogue, 'string')
  assert.equal(typeof locale.catalogueSubtitle, 'string')
  assert.equal(typeof locale.add, 'string')
  assert.equal(typeof locale.addItem, 'string')
  assert.equal(typeof locale.branchSelector.select, 'string')
  assert.equal(typeof locale.category.title, 'string')
}
assert.equal(enProducts.category.title, 'Categories')
assert.equal(arProducts.category.title, 'التصنيفات')

const ownerNav = sidebar.slice(sidebar.indexOf('const ownerNav'), sidebar.indexOf('const branchNav'))
const branchNav = sidebar.slice(sidebar.indexOf('const branchNav'), sidebar.indexOf('const branchDevicePrinterNavItem'))
assert.match(ownerNav, /labelKey: 'products', path: '\/products', icon: Package, section: 'catalogue'/)
assert.match(branchNav, /labelKey: 'products', path: '\/products', icon: Package, section: 'catalogue'/)
assert.match(sidebar, /useBranchBillingConfig\(catalogueBranchId\)/)
assert.match(sidebar, /getCataloguePresentation\(catalogueBillingConfig\)/)
assert.match(sidebar, /new URLSearchParams\(location\.search\)\.get\('branch'\)/)
assert.match(sidebar, /cataloguePresentation\.navigationLabelKey/)

assert.match(productsPage, /const isBranchUser = profile\?\.role === 'branch'/)
assert.match(productsPage, /const isOwnerAdmin = profile\?\.role === 'owner' \|\| profile\?\.role === 'admin'/)
assert.match(productsPage, /data-catalogue-branch-selector/)
assert.match(productsPage, /useBranchBillingConfig\(catalogueBranchId\)/)
assert.match(productsPage, /getCataloguePresentation\(effectiveBillingConfig\)/)
assert.match(productsPage, /title=\{t\(presentation\.titleKey\)\}/)
assert.match(productsPage, /\{t\(presentation\.addActionKey\)\}/)
assert.match(productsPage, /const bid = catalogueBranchId/)
assert.match(productsPage, /\.eq\('branch_id', bid\)/)
assert.match(productsPage, /branchId=\{catalogueBranchId\}/)
assert.match(productsPage, /branchContext=\{catalogueBranch\}/)
assert.match(productsPage, /tenantId=\{profile\?\.tenant_id \?\? null\}/)
assert.match(productsPage, /<AddCategoryDialog[\s\S]*branchId=\{catalogueBranchId\}/)
assert.doesNotMatch(productsPage, /profile\.branch_id\s*=/)

assert.match(productDrawer, /branchId\?: string \| null/)
assert.match(productDrawer, /branchContext\?: Pick<Branch, 'id' \| 'stock_enabled' \| 'vat_mode'> \| null/)
assert.match(productDrawer, /const resolvedBranchId = branchId \?\? profile\?\.branch_id/)
assert.match(productDrawer, /branch_id: resolvedBranchId/)

assert.match(routes, /path="\/products"\s+element=\{<ProductsPage \/>\}/)
assert.doesNotMatch(routes, /path="\/catalogue"/)

console.log('Profile-aware catalogue navigation tests passed.')
