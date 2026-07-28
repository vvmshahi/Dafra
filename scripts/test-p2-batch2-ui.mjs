import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const material = read('src/pages/inventory/StockItemModal.tsx')
const materialsPage = read('src/pages/inventory/StockOverviewTab.tsx')
const product = read('src/pages/products/ProductDrawer.tsx')
const purchases = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const printingSetup = read('src/components/barcodes/BarcodePrinterSetupPanel.tsx')
const printingDefaults = read('src/components/barcodes/BarcodeLabelSettingsPanel.tsx')
const inventoryEn = JSON.parse(read('src/localization/locales/en/inventory.json'))
const inventoryAr = JSON.parse(read('src/localization/locales/ar-SA/inventory.json'))
const printingEn = JSON.parse(read('src/localization/locales/en/printing.json'))
const printingAr = JSON.parse(read('src/localization/locales/ar-SA/printing.json'))

assert.match(material, /role="dialog"/)
assert.match(material, /aria-modal="true"/)
assert.match(material, /max-w-\[900px\]/)
assert.doesNotMatch(material, /fixed inset-y-0 right-0 w-full|max-w-\[500px\]/)
assert.match(materialsPage, /<StockItemModal/)
assert.doesNotMatch(materialsPage, /StockItemDrawer/)

for (const contract of [
  /from\('inventory_items'\)\.update\(payload\)/,
  /from\('inventory_items'\)[\s\S]*\.insert\(\{/,
  /tenant_id: profile\?\.tenant_id!/,
  /branch_id: profile\?\.branch_id!/,
  /adjust_inventory_item_stock/,
  /adjustment_quantity: adjustmentQuantity/,
  /idempotency_key: adjustmentKey/,
]) assert.match(material, contract)
for (const forbidden of [/sale price/i, /vat mode/i, /manufactur/i, /recipe/i, /barcode/i]) assert.doesNotMatch(material, forbidden)

assert.match(material, /document\.body\.style\.overflow = 'hidden'/)
assert.match(material, /document\.body\.style\.overflow = previousOverflow/)
assert.match(material, /event\.key === 'Escape'/)
assert.match(material, /event\.key !== 'Tab'/)
assert.match(material, /previousFocusRef\.current\?\.focus/)
assert.match(material, /nameRef\.current\?\.focus/)
assert.match(material, /if \(saving\) return/)
assert.match(material, /flex-col-reverse[\s\S]*sm:flex-row/)

assert.match(product, /id="product-created-title"/)
assert.doesNotMatch(product.slice(product.indexOf('if (createdTrackedProduct)'), product.indexOf('const persistedProductId')), /fixed inset-y-0 right-0 w-full|max-w-\[480px\]/)
assert.match(purchases, /<PurchaseBillModal/)
assert.doesNotMatch(purchases, /<PurchaseDrawer/)
assert.match(purchases, /<PurchaseDetailModal/)

assert.equal(inventoryEn.tabs.materials, 'Materials & Supplies')
assert.ok(inventoryAr.tabs.materials)
assert.deepEqual(Object.keys(inventoryEn.materialModal).sort(), Object.keys(inventoryAr.materialModal).sort())
assert.deepEqual(Object.keys(printingEn.barcodeLabels.settings).sort(), Object.keys(printingAr.barcodeLabels.settings).sort())
assert.deepEqual(Object.keys(printingEn.barcodeLabels.calibration).sort(), Object.keys(printingAr.barcodeLabels.calibration).sort())
assert.match(printingSetup, /aria-describedby=\{!dirty/)
assert.match(printingDefaults, /branch-label-save-reason/)

console.log('P2 Batch 2 focused UI checks passed')
