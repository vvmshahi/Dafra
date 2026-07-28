import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = path => readFileSync(join(process.cwd(), path), 'utf8')
const modal = read('src/pages/products/ProductDrawer.tsx')
const units = read('src/pages/products/ProductUnitsSection.tsx')
const barcodes = read('src/pages/products/ProductBarcodesSection.tsx')
const layout = read('src/components/layout/AppLayout.tsx')
const en = JSON.parse(read('src/localization/locales/en/products.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/products.json'))

assert.match(layout, /--app-sidebar-width/)
assert.match(layout, /collapsed \? '64px' : '240px'/)
assert.match(modal, /md:left-\[var\(--app-sidebar-width\)\]/)
assert.match(modal, /md:w-\[min\(82%,1180px\)\]/)
assert.match(modal, /md:min-w-\[min\(880px,calc\(100%_-_32px\)\)\]/)
assert.match(modal, /h-full w-full/)

assert.equal(en.editor.tabs.advanced, undefined)
assert.equal(ar.editor.tabs.advanced, undefined)
assert.match(modal, /products:editor\.itemCode/)
assert.doesNotMatch(modal, /id="product-sku"/)
assert.doesNotMatch(modal, /id="product-sort-order"/)
assert.match(modal, /sort_order:\s+Number\(sortOrder\)\s+\|\| 0/)
assert.match(modal, /sku:\s+sku\.trim\(\)\s+\|\| null/)
assert.match(modal, /products:editor\.detailsDisclosure/)
assert.match(modal, /h-\[104px\] w-\[104px\]/)

assert.match(modal, /vatLabels\.\$\{value\}/)
assert.deepEqual(Object.keys(en.editor.vatLabels), ['inherit', 'exclusive', 'inclusive', 'exempt'])
assert.deepEqual(Object.keys(ar.editor.vatLabels), ['inherit', 'exclusive', 'inclusive', 'exempt'])
assert.match(modal, /products:editor\.pricePerUnit/)
assert.match(modal, /products:editor\.trackingEnabled/)
assert.match(modal, /products:editor\.trackingDisabled/)

assert.match(units, /onBaseUnitName\?:/)
assert.match(units, /if \(unit && !editing\)/)
assert.match(units, /units\.equation/)
assert.match(units, /units\.retiredHistory/)
assert.match(units, /create_product_unit|update_product_unit/)
assert.match(units, /deactivate_product_unit/)
assert.match(units, /reactivate_product_unit/)

assert.match(barcodes, /barcodes\.entryOptions/)
assert.match(barcodes, /barcodes\.additional/)
assert.match(barcodes, /barcodes\.history/)
assert.match(barcodes, /barcodes\.unitSafety/)
assert.doesNotMatch(barcodes, /delete_product_unit_barcode/)
assert.equal(en.barcodes.generate, 'Generate Kubri barcode')
assert.equal(typeof ar.barcodes.generate, 'string')

console.log('compact product editor UI checks passed')
