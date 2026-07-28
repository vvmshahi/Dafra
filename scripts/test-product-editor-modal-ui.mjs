import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const modal = read('src/pages/products/ProductDrawer.tsx')
const confirmDialog = read('src/components/ui/ConfirmDialog.tsx')
const units = read('src/pages/products/ProductUnitsSection.tsx')
const barcodes = read('src/pages/products/ProductBarcodesSection.tsx')
const en = JSON.parse(read('src/localization/locales/en/products.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/products.json'))

assert.match(modal, /role="dialog"/)
assert.match(modal, /aria-modal="true"/)
assert.match(modal, /md:w-\[min\(82%,1180px\)\]/)
assert.match(modal, /md:h-\[min\(90vh,900px\)\]/)
assert.doesNotMatch(modal, /fixed inset-y-0 right-0 w-full max-w-\[560px\]/)
assert.match(modal, /onMouseDown=\{event => event\.stopPropagation\(\)\}/)

const order = ['general', 'pricing', 'inventory', 'units', 'barcodes']
assert.deepEqual(en.editor.tabs, {
  general: 'General',
  pricing: 'Price & VAT',
  inventory: 'Stock',
  units: 'Packages',
  barcodes: 'Barcodes',
})
for (const id of order) {
  assert.match(modal, new RegExp(`id: '${id}'`))
  assert.match(modal, new RegExp(`id="product-panel-${id}"`))
  assert.equal(typeof ar.editor.tabs[id], 'string')
}
assert.match(modal, /role="tablist"/)
assert.match(modal, /role="tab"/)
assert.match(modal, /aria-selected=\{selected\}/)
assert.match(modal, /ArrowRight/)
assert.match(modal, /ArrowLeft/)

assert.match(modal, /previousFocusRef\.current\?\.focus\(\)/)
assert.match(modal, /event\.key === 'Escape'/)
assert.match(modal, /event\.key !== 'Tab'/)
assert.match(modal, /beforeunload/)
assert.match(modal, /document\.addEventListener\('click', routeGuard, true\)/)
assert.match(modal, /<ConfirmDialog/)
assert.match(confirmDialog, /role="alertdialog"/)
assert.match(modal, /dirtyTabs\.has\(id\)/)
const selectTab = modal.slice(modal.indexOf('const selectTab'), modal.indexOf('const handleTabKeyDown'))
assert.doesNotMatch(selectTab, /discard|requestClose/)

assert.match(modal, /aria-invalid=\{Boolean\(fieldErrors\.name\)\}/)
assert.match(modal, /aria-describedby=\{fieldErrors\.name/)
assert.match(modal, /setActiveTab\('pricing'\)/)
assert.match(modal, /visitedTabs\.has\('units'\)/)
assert.match(modal, /visitedTabs\.has\('barcodes'\)/)
assert.match(modal, /saveFirst/)

assert.match(modal, /update_product_stock_settings/)
assert.match(modal, /adjustmentIndependent/)
assert.match(units, /view\?: 'combined' \| 'units' \| 'barcodes'/)
assert.match(units, /view === 'barcodes'/)
assert.match(units, /view="combined"|view === 'combined'/)
assert.match(barcodes, /create_product_unit_barcode/)
assert.match(barcodes, /disable_product_unit_barcode/)
assert.match(barcodes, /reactivate_product_unit_barcode/)
assert.match(barcodes, /set_primary_product_unit_barcode/)
assert.match(barcodes, /<details/)
assert.match(barcodes, /barcodes\.additional/)
assert.match(barcodes, /barcodes\.history/)
assert.doesNotMatch(barcodes, /delete_product_unit_barcode|hard delete|Delete barcode/)
assert.equal(en.barcodes.primary, 'Preferred for labels')
assert.equal(en.barcodes.disable, 'Deactivate barcode')
assert.equal(en.barcodes.reactivate, 'Reactivate barcode')

assert.match(modal, /md:p-4/)
assert.match(modal, /h-full w-full/)
assert.match(modal, /dir="rtl"/)
assert.match(modal, /dir="ltr"/)

const updatePayload = modal.slice(modal.indexOf('const payload:'), modal.indexOf('let savedProductId'))
for (const field of ['name', 'name_ar', 'category_id', 'description', 'price', 'vat_treatment', 'image_url', 'is_available', 'sort_order', 'sku', 'notes']) {
  assert.match(updatePayload, new RegExp(`${field}:`))
}

console.log('product editor modal UI checks passed')
