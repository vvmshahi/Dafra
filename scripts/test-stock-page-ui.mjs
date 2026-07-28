import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const stock = read('src/pages/inventory/ProductStockTab.tsx')
const editor = read('src/pages/products/ProductDrawer.tsx')
const inventoryPage = read('src/pages/inventory/InventoryPage.tsx')
const receipt = read('src/pages/inventory/ProductStockReceiptDrawer.tsx')
const materials = read('src/pages/inventory/StockOverviewTab.tsx')
const materialEditor = read('src/pages/inventory/StockItemModal.tsx')
const barcodeMigration = read('supabase/migrations/20260726000100_product_unit_barcodes.sql')
const en = JSON.parse(read('src/localization/locales/en/inventory.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/inventory.json'))

assert.match(stock, /min-w-40 flex-1 rounded-xl[\s\S]*?px-4 py-3 shadow-card/)
assert.match(stock, /icon=\{Package\} accent="blue"/)
assert.match(stock, /icon=\{Boxes\} accent="teal"/)
assert.match(stock, /icon=\{CircleDollarSign\} accent="green" emphasized/)
assert.match(stock, /icon=\{AlertTriangle\} accent="amber" active=\{metrics\.lowStock > 0\}/)
assert.match(stock, /icon=\{PackageX\} accent="red" active=\{metrics\.outOfStock > 0\}/)
assert.match(stock, /active \? accent : 'neutral'/)
assert.match(stock, /rounded-xl border border-\[#173f2a\]\/70 bg-white px-4 py-3 shadow-card/)
assert.equal((stock.match(/border-\[#173f2a\]\/70/g) ?? []).length, 1)
assert.doesNotMatch(stock, /border: 'border-(?:blue|teal|primary|amber|red|gray)-/)
assert.doesNotMatch(stock, /border-s-(?:2|blue|teal|primary|amber|red|gray)/)
assert.doesNotMatch(stock, /bg-(?:red|amber|green|blue|teal)-[5-9]00[^/]/)

assert.match(stock, /products\.reduce\(\(sum, product\) => sum \+ Number\(product\.stock_quantity \?\? 0\), 0\)/)
assert.match(stock, /Number\(product\.stock_quantity \?\? 0\) \* Number\(product\.cost \?\? 0\)/)
assert.match(stock, /minimum > 0 && quantity <= minimum && quantity > 0/)
assert.match(stock, /Number\(product\.stock_quantity \?\? 0\) <= 0/)

assert.match(stock, /onClick=\{\(\) => openReceipt\(product\)\}/)
assert.doesNotMatch(stock, /setEditorContext\(\{ product, stockAction: 'add' \}\)/)
assert.match(stock, /setEditorContext\(\{ product, stockAction: 'adjust' \}\)/)
assert.match(stock, /initialTab="inventory"/)
assert.match(stock, /initialStockAction=\{editorContext\?\.stockAction \?\? null\}/)
assert.match(stock, /title=\{t\('inventory:actions\.addStockFor'/)
assert.match(stock, /aria-label=\{t\('inventory:actions\.addStockFor'/)
assert.match(stock, /title=\{t\('inventory:actions\.adjustStockFor'/)
assert.match(stock, /aria-label=\{t\('inventory:actions\.adjustStockFor'/)
assert.match(stock, /className="h-9 w-9[\s\S]*?focus-visible:ring-2/)

assert.match(editor, /initialTab = 'general'/)
assert.match(editor, /initialStockAction = null/)
assert.match(editor, /setActiveTab\(initialTab\)/)
assert.match(editor, /setShowAdjustment\(initialStockAction !== null\)/)
assert.match(editor, /setAdjustmentOperation\('add'\)/)
assert.match(editor, /ref=\{stockAdjustmentRef\}/)
assert.match(editor, /stockAdjustmentRef\.current\?\.focus\(\)/)
assert.match(editor, /stockFocusKeyRef\.current === focusKey/)
assert.match(editor, /if \(initialStockAction === null\) initialFocusRef\.current\?\.focus\(\)/)
assert.match(editor, /setActiveTab\(initialTab\)[\s\S]*?setVisitedTabs/)
assert.doesNotMatch(editor, /product-tab-inventory['"]\)\?*\.click\(\)/)
assert.match(editor, /\(\['add', 'remove'\] as const\)/)
assert.match(editor, /projectStockAdjustment\(/)
assert.match(editor, /adjustment_quantity = adjustmentDelta/)

assert.match(stock, /<Button size="sm" onClick=\{\(\) => openReceipt\(\)\}/)
assert.match(stock, /<ProductStockReceiptDrawer/)
assert.match(stock, /initialProduct=\{receiptProduct\}/)
assert.match(stock, /const closeReceipt = \(\) => \{[\s\S]*?setReceiptOpen\(false\)[\s\S]*?setReceiptProduct\(null\)/)
assert.match(stock, /onClose=\{closeReceipt\}/)
assert.match(receipt, /role="dialog"/)
assert.match(receipt, /aria-modal="true"/)
assert.match(receipt, /max-w-\[860px\]/)
assert.match(receipt, /md:left-\[var\(--app-sidebar-width\)\]/)
assert.doesNotMatch(receipt, /fixed inset-y-0 end-0/)
assert.doesNotMatch(receipt, /role="tab"|tablist|activeTab/)
assert.match(receipt, /<header[\s\S]*?<section[\s\S]*?<footer/)
assert.match(receipt, /productSearchRef\.current\?\.focus\(\)/)
assert.match(receipt, /quantityRef\.current\?\.focus\(\)/)
assert.match(receipt, /event\.key === 'Escape'/)
assert.match(receipt, /event\.key !== 'Tab'/)
assert.match(receipt, /previousFocusRef\.current\?\.focus\(\)/)
assert.match(receipt, /resetForm\(\)[\s\S]*?onClose\(\)/)
assert.match(receipt, /aria-live="polite"/)
assert.match(receipt, /role="alert" aria-live="assertive"/)
assert.match(receipt, /product\.resolved_barcode/)
assert.match(receipt, /selectedProduct\.resolved_barcode \|\| t\('inventory:noBarcode'\)/)
assert.match(receipt, /selectedProduct\.sku \|\| t\('inventory:noSku'\)/)
assert.match(receipt, /selectedProduct\.stock_quantity/)
assert.match(receipt, /selectedProduct\.cost/)
assert.match(receipt, /selectedProduct\.categories/)
assert.match(receipt, /unitCost/)
assert.match(receipt, /supplierId/)
assert.match(receipt, /reference/)
assert.match(receipt, /row\.is_active === true && row\.receiving_enabled === true/)
assert.match(receipt, /quantityNumber \* selectedUnit\.conversionToBase/)
assert.match(receipt, /quantityNumber \* unitCostNumber/)
assert.match(receipt, /currentStock \+ baseQuantityAdded/)
assert.match(receipt, /quantityNumber > 0/)
assert.match(receipt, /unitCostNumber >= 0/)
assert.match(receipt, /disabled=\{!formValid \|\| saving\}/)
assert.match(receipt, /if \(saving\) return/)
assert.match(receipt, /toast\.success/)
assert.match(receipt, /toast\.error/)
assert.match(receipt, /receive_product_stock/)
for (const payloadField of [
  'product_id: selectedProduct.id',
  'product_unit_id: selectedUnit.id',
  'package_quantity: quantityNumber',
  'expected_product_unit_version: selectedUnit.version',
  'supplier_id: supplierId || null',
  'unit_cost: unitCostNumber',
  'reference: reference.trim() || null',
  'note: note.trim() || null',
  'idempotency_key: receiptKey',
]) {
  assert.match(receipt, new RegExp(payloadField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

assert.match(stock, /rpc\('get_product_units'/)
assert.match(stock, /rpc\('list_product_unit_barcodes'/)
assert.match(stock, /unit\.is_active === true && unit\.is_base === true/)
assert.match(stock, /item\.is_active === true && item\.product_unit_id === baseUnit\.id/)
assert.match(stock, /Number\(right\.is_primary\) - Number\(left\.is_primary\)/)
assert.match(stock, /resolved_barcode: await resolveBaseUnitBarcode\(product\)/)
assert.match(stock, /product\.resolved_barcode \|\| t\('inventory:noBarcode'\)/)
assert.match(stock, /product\.sku \|\| t\('inventory:noSku'\)/)
assert.match(barcodeMigration, /CREATE OR REPLACE FUNCTION public\.list_product_unit_barcodes/)
assert.doesNotMatch(stock, /\.from\('product_unit_barcodes'\)[\s\S]*?\.(?:insert|update|delete)\(/)

assert.match(inventoryPage, /<StockOverviewTab \/>/)
assert.match(materials, /\.from\('inventory_items'\)/)
assert.match(materials, /current_quantity \* i\.unit_cost/)
assert.match(materialEditor, /\.from\('inventory_items'\)\.update\(payload\)/)
assert.match(materialEditor, /\.from\('inventory_items'\)[\s\S]*?\.insert\(/)
assert.match(materialEditor, /rpc\('adjust_inventory_item_stock'/)
assert.match(materialEditor, /role="dialog"/)
assert.doesNotMatch(materialEditor, /fixed inset-y-0 right-0 w-full/)
assert.doesNotMatch(stock, /inventory_items/)

for (const locale of [en, ar]) {
  for (const key of ['totalProducts', 'totalUnits', 'totalValue', 'lowStock', 'outOfStock']) {
    assert.equal(typeof locale.metrics[key], 'string')
  }
  assert.equal(typeof locale.actions.addStock, 'string')
  assert.equal(typeof locale.actions.adjust, 'string')
  assert.match(locale.actions.addStockFor, /\{\{name\}\}/)
  assert.match(locale.actions.adjustStockFor, /\{\{name\}\}/)
  assert.equal(typeof locale.metrics.noneBelowThreshold, 'string')
  assert.equal(typeof locale.metrics.noneNeedReceiving, 'string')
  for (const key of [
    'subtitle', 'receiveAs', 'receivedQuantity', 'costPerSelectedUnit',
    'baseQuantityAdded', 'newStock', 'previousLatestCost', 'totalCost',
    'estimatedStockValue', 'billReference', 'noteHelper', 'confirmation', 'success',
  ]) {
    assert.equal(typeof locale.receipt[key], 'string')
  }
}

assert.equal(en.metrics.totalProducts, 'Total Products')
assert.equal(en.metrics.totalValue, 'Total Stock Value')
assert.equal(ar.metrics.totalProducts, 'إجمالي المنتجات')
assert.equal(ar.metrics.totalValue, 'إجمالي قيمة المخزون')

console.log('Stock page KPI, centered receipt modal, barcode, adjustment, and Materials contract tests passed.')
