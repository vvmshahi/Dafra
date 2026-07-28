import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const read = path => readFileSync(join(process.cwd(), path), 'utf8')
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const helper = await import(`data:text/javascript;base64,${Buffer.from(compile(
  read('src/lib/products/productEditorUi.ts'),
)).toString('base64')}`)
const drawer = read('src/pages/products/ProductDrawer.tsx')
const units = read('src/pages/products/ProductUnitsSection.tsx')
const barcodes = read('src/pages/products/ProductBarcodesSection.tsx')
const en = JSON.parse(read('src/localization/locales/en/products.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/products.json'))

assert.match(drawer, /const VAT_OPTIONS: VatTreatment\[\] = \['inherit', 'exclusive', 'inclusive', 'exempt'\]/)
assert.match(drawer, /type="radio"[\s\S]{0,160}name="vat-treatment"/)
assert.match(drawer, /checked=\{vatTreatment === value\}/)
assert.match(drawer, /vat_treatment:\s+vatTreatment/)
assert.match(drawer, /bg-emerald-50\/60/)
assert.match(drawer, /products:pricing\.beforeVat/)
assert.match(drawer, /products:pricing\.customerPays/)

assert.deepEqual(helper.projectStockAdjustment(96, '5', 'add'), {
  quantity: 5, delta: 5, projectedStock: 101, error: null,
})
assert.deepEqual(helper.projectStockAdjustment(96, '2', 'remove'), {
  quantity: 2, delta: -2, projectedStock: 94, error: null,
})
for (const value of ['0', '-2', 'nope', 'Infinity']) {
  assert.equal(helper.projectStockAdjustment(96, value, 'add').error, 'invalid')
}
for (const value of ['', '5', '5.25', '.5']) assert.equal(helper.isPositiveQuantityInputDraft(value), true)
for (const value of ['-2', '1e2', '5.0001', 'word']) assert.equal(helper.isPositiveQuantityInputDraft(value), false)
assert.equal(helper.projectStockAdjustment(3, '4', 'remove').error, 'exceedsAvailable')
assert.equal(helper.projectStockAdjustment(96, '2', 'add').projectedStock, 98)
assert.equal(helper.projectStockAdjustment(96, '2', 'remove').projectedStock, 94)
assert.match(drawer, /adjustmentDelta = stockProjection\.delta/)
assert.match(drawer, /update_product_stock_settings/)
assert.match(drawer, /name="stock-operation"/)
assert.match(drawer, /aria-live="polite"/)

assert.equal(en.editor.tabs.units, 'Packages')
assert.equal(ar.editor.tabs.units, 'العبوات')
assert.match(units, /create_product_unit|update_product_unit/)
assert.match(units, /deactivate_product_unit/)
assert.match(units, /reactivate_product_unit/)

assert.match(drawer, /barcodeAutoFocus=\{activeTab === 'barcodes'\}/)
assert.match(units, /autoFocus=\{barcodeAutoFocus\}/)
assert.match(barcodes, /requestAnimationFrame\(\(\) => captureRef\.current\?\.focus\(\)\)/)
assert.match(barcodes, /event\.key === 'Enter'[\s\S]{0,100}void add\(\)/)
assert.doesNotMatch(barcodes, /document\.addEventListener|window\.addEventListener/)
assert.match(barcodes, /create_product_unit_barcode/)
assert.match(barcodes, /generate_internal_product_unit_barcode/)
assert.match(barcodes, /barcodes\.errors\.duplicate/)
assert.match(barcodes, /aria-live="polite"/)
assert.equal(en.barcodes.scannerHelp.includes('USB'), true)
assert.equal(ar.barcodes.scannerHelp.includes('USB'), true)

console.log('product editor Version 1 UI checks passed (23 behavior and contract assertions)')
