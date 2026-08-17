import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CATALOGUE_VAT_TONES,
  PRODUCTS_DEFAULT_VIEW,
  catalogueStockStatus,
  catalogueTextMatches,
  normalizeCatalogueArabic,
  normalizeCatalogueText,
} from '../src/lib/products/catalogue.ts'
import {
  detectBarcodeType,
  normalizeBarcode,
  validateBarcode,
} from '../src/lib/barcodes/barcode.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const page = read('src/pages/products/ProductsPage.tsx')
const categoriesModal = read('src/pages/products/CategoriesModal.tsx')
const quickPrint = read('src/components/barcodes/BarcodeQuickPrintDialog.tsx')
const scannerHook = read('src/hooks/useBarcodeScanner.ts')
const en = JSON.parse(read('src/localization/locales/en/products.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/products.json'))

const sample = {
  name: 'Roasted   Coffee Beans',
  name_ar: 'قَهْوَة عربية',
  sku: 'COF-100',
  barcode: ' 6290000012345 ',
}
const posWorkingBarcode = 'DF2D8315271D414A83BA'

assert.equal(normalizeCatalogueText('  ROASTED   coffee '), 'roasted coffee')
assert.equal(normalizeCatalogueArabic(' قَهْوَة  '), 'قهوة')
assert.equal(catalogueTextMatches('coffee', sample), true)
assert.equal(catalogueTextMatches('قهوة', sample), true)
assert.equal(catalogueTextMatches('cof-1', sample), true)
assert.equal(catalogueTextMatches('6290000012', sample), true)
assert.equal(PRODUCTS_DEFAULT_VIEW, 'list')
assert.equal(normalizeBarcode(posWorkingBarcode), posWorkingBarcode)
assert.equal(validateBarcode(posWorkingBarcode, detectBarcodeType(posWorkingBarcode)), null)

assert.deepEqual(Object.keys(CATALOGUE_VAT_TONES).sort(), ['exclusive', 'exempt', 'inclusive', 'inherit'])
assert.equal(CATALOGUE_VAT_TONES.inclusive, 'success')
assert.equal(CATALOGUE_VAT_TONES.exclusive, 'warning')
assert.equal(CATALOGUE_VAT_TONES.exempt, 'teal')

assert.equal(catalogueStockStatus({
  stockQuantity: 3, trackStock: true, isService: false, branchStockEnabled: true, lowStockThreshold: 5,
}).key, 'status.lowStock')
assert.equal(catalogueStockStatus({
  stockQuantity: 0, trackStock: true, isService: false, branchStockEnabled: true, lowStockThreshold: 5,
}).key, 'status.outOfStock')
assert.equal(catalogueStockStatus({
  stockQuantity: 8, trackStock: true, isService: true, branchStockEnabled: true, lowStockThreshold: 5,
}).key, 'status.serviceItem')
assert.equal(catalogueStockStatus({
  stockQuantity: 8, trackStock: true, isService: false, branchStockEnabled: false, lowStockThreshold: 5,
}).key, 'status.branchStockDisabled')

assert.match(page, /rpc\('resolve_product_unit_barcode'/)
assert.match(page, /useBarcodeScanner\(\{/)
assert.match(page, /blocked: drawerOpen \|\| catsOpen \|\| addCatOpen \|\| batchPrintOpen \|\| printSelection !== null/)
assert.match(page, /setSearch\(code\)/)
assert.match(page, /setBarcodeState\(\{ kind: 'loading' \}\)/)
assert.match(page, /rows\.length > 1/)
assert.match(page, /resolution_status === 'active'/)
assert.match(page, /product\.id === barcodeState\.productId/)
assert.match(page, /barcodeId: row\?\.barcode_id/)
assert.match(page, /unitId: row\?\.product_unit_id/)
assert.match(page, /previousFiltersRef/)
assert.match(page, /lastBarcodeRequestRef/)
assert.match(page, /requestId !== barcodeRequestRef\.current/)
assert.match(page, /mountedRef\.current/)
assert.match(page, /normalizeBarcode\(search\)\.length >= 3/)
assert.doesNotMatch(page, /const isBarcodeLike/)
assert.match(page, /get_product_units/)
assert.match(page, /list_product_unit_barcodes/)
assert.match(page, /BarcodeQuickPrintDialog/)
assert.match(page, /event\.stopPropagation\(\)/)
assert.match(page, /errors\.barcodeNotAssigned/)
assert.match(page, /line-clamp-2/)
assert.match(page, /min_stock_alert/)
assert.match(page, /loading="lazy"/)
assert.match(page, /aria-live="polite"/)
assert.match(page, /aria-pressed=\{viewMode === 'grid'\}/)
assert.match(page, /aria-pressed=\{viewMode === 'list'\}/)
assert.match(page, /useState<'grid' \| 'list'>\(PRODUCTS_DEFAULT_VIEW\)/)
assert.doesNotMatch(page, /saved\.viewMode/)
const toggleSource = page.slice(page.indexOf('{/* View toggle */}'), page.indexOf('</div>', page.indexOf('{/* View toggle */}')) + 6)
assert.ok(toggleSource.indexOf("setViewMode('list')") < toggleSource.indexOf("setViewMode('grid')"))
assert.match(page, /bg-\[#173f2a\]/)
assert.match(page, /ring-gold-400\/60/)
assert.match(page, /data-catalogue-command-bar/)
assert.match(page, /data-catalogue-management-actions/)
assert.match(page, /data-catalogue-priority-actions/)
assert.match(page, /!bg-\[#173F2A\][\s\S]*text-\[#FFF8E7\]/)
assert.match(page, /Import \/ Export/)
assert.match(page, /border-\[#a9c6ad\] bg-\[#fffefa\] text-\[#173f2a\]/)
assert.match(page, /border-\[#31543f\] bg-\[#244b36\] text-\[#eef7ed\]/)
assert.match(page, /border-\[#dbe5dc\] bg-\[#f8fbf7\][\s\S]*aria-label=\{t\('viewMode'\)\}/)
assert.match(page, /border-b border-\[#dbe5dc\] bg-\[#f8fbf7\][\s\S]*text-\[#526b59\]/)
const commandBarStart = page.indexOf('data-catalogue-command-bar')
const commandBarSource = page.slice(commandBarStart, page.indexOf(') : undefined}', commandBarStart))
assert.doesNotMatch(commandBarSource, /setAddCatOpen\(true\)/)
assert.match(commandBarSource, /setCatsOpen\(true\)/)
assert.match(commandBarSource, /setBatchPrintOpen\(true\)/)
assert.match(page, /onAddCategory=\{\(\) => \{[\s\S]*setCatsOpen\(false\)[\s\S]*setAddCatOpen\(true\)/)
assert.match(categoriesModal, /onAddCategory: \(\) => void/)
assert.match(categoriesModal, /onClick=\{onAddCategory\}/)
assert.match(categoriesModal, /<Plus size=\{14\} aria-hidden="true" \/>/)
assert.doesNotMatch(page, /function AvailabilityButton/)
assert.doesNotMatch(page, /columns\.status/)
assert.doesNotMatch(page, /handleToggleAvailable/)
assert.match(page, /view === 'grid' \? 'catalogueVatGrid' : 'catalogueVat'/)
assert.match(page, /text-\[9px\]/)
assert.match(page, /rounded-full/)
assert.match(page, /h-1\.5 w-1\.5/)
assert.match(page, /flex w-\[116px\][\s\S]*?gap-1/)
assert.match(scannerHook, /isEditableScannerTarget/)
assert.match(quickPrint, /props\.choices && props\.choices\.length > 1/)
assert.match(quickPrint, /activeChoice\.barcodeId/)
assert.match(page, /barcodeState\.barcodeId && choice\.barcodeId === barcodeState\.barcodeId/)
assert.doesNotMatch(page, /browserBarcodePrintAdapter\.print/)

for (const locale of [en, ar]) {
  assert.equal(typeof locale.searchPlaceholder, 'string')
  assert.equal(typeof locale.actions.printBarcode, 'string')
  assert.equal(typeof locale.errors.barcodeNotAssigned, 'string')
  assert.equal(typeof locale.barcodeSearch.match, 'string')
  assert.equal(typeof locale.barcodeSearch.loading, 'string')
  assert.equal(typeof locale.barcodeSearch.unavailable, 'string')
  assert.equal(typeof locale.status.lowStock, 'string')
  assert.equal(typeof locale.catalogueVat.inclusive, 'string')
  assert.equal(typeof locale.catalogueVat.exclusive, 'string')
  assert.equal(typeof locale.catalogueVat.inherit, 'string')
  assert.equal(typeof locale.catalogueVatGrid.inclusive, 'string')
  assert.equal(typeof locale.catalogueVatGrid.exclusive, 'string')
}
assert.equal(en.catalogueVat.inclusive, 'Inclusive')
assert.equal(en.catalogueVat.exclusive, 'Exclusive')
assert.equal(en.catalogueVat.inherit, 'Default')
assert.equal(en.catalogueVatGrid.inclusive, 'VAT Inclusive')
assert.equal(en.catalogueVatGrid.exclusive, 'VAT Exclusive')
assert.equal(en.catalogueVatGrid.inherit, 'VAT Default')
assert.equal(en.pricing.inclusive, 'Always Inclusive')
assert.equal(en.pricing.exclusive, 'Always Exclusive')

for (const unchangedAction of [
  /setCatsOpen\(true\)/,
  /setAddCatOpen\(true\)/,
  /setBatchPrintOpen\(true\)/,
  /onClick=\{openAdd\}/,
]) {
  assert.match(page, unchangedAction)
}

console.log('Product catalogue search/UI tests passed.')
