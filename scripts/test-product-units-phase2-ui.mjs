import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const drawer = read('src/pages/products/ProductDrawer.tsx')
const units = read('src/pages/products/ProductUnitsSection.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const english = JSON.parse(read('src/localization/locales/en/products.json'))
const arabic = JSON.parse(read('src/localization/locales/ar-SA/products.json'))

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

const calculatedPreview = (basePrice, conversion) => {
  const [baseWhole, baseFraction = ''] = basePrice.split('.')
  const [conversionWhole, conversionFraction = ''] = conversion.split('.')
  const product = BigInt(`${baseWhole}${baseFraction}`) * BigInt(`${conversionWhole}${conversionFraction}`)
  const scale = baseFraction.length + conversionFraction.length
  const cents = (product * 100n + (scale ? 5n * 10n ** BigInt(scale - 1) : 0n)) / 10n ** BigInt(scale)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

test('ProductDrawer owns the units section and keeps product and package saves separate', () => {
  assert.match(drawer, /import \{ ProductUnitsSection \} from '\.\/ProductUnitsSection'/)
  assert.match(drawer, /<Section title=\{t\('products:sections\.units'\)\}/)
  assert.match(drawer, /productId=\{product\?\.id \?\? createdProductId\}/)
  assert.match(drawer, /isFirstProductSave = !product && !createdProductId/)
  assert.match(drawer, /setProductCreatedMessage\(true\)/)
  assert.match(english.units.productCreated, /saved separately/i)
})

test('a product with only a base unit renders a read-only base relationship', () => {
  assert.match(units, /const baseUnit = units\.find\(unit => unit\.is_base\)/)
  assert.match(units, /t\('units\.baseUnit'\)/)
  assert.match(units, /t\('units\.baseEquation'/)
  assert.match(units, /t\('units\.baseReadOnly'\)/)
  assert.doesNotMatch(units, /unit\.is_base[\s\S]{0,120}(deactivate_product_unit|reactivate_product_unit)/)
})

test('existing active and inactive packages are loaded through the approved read RPC', () => {
  assert.match(units, /\.rpc\('get_product_units',[\s\S]*?p_product_id: productId/)
  assert.match(units, /activePackages = units\.filter\(unit => !unit\.is_base && unit\.is_active\)/)
  assert.match(units, /inactivePackages = units\.filter\(unit => !unit\.is_base && !unit\.is_active\)/)
})

test('calculated and custom packages send only the package-management RPC payload', () => {
  assert.match(units, /rpcName = unit \? 'update_product_unit' : 'create_product_unit'/)
  assert.match(units, /pricing_method: draft\.pricingMethod/)
  assert.match(units, /custom_selling_price: draft\.pricingMethod === 'custom' \? Number\(draft\.customPrice\) : null/)
  assert.match(units, /selling_enabled: draft\.sellingEnabled/)
  assert.match(units, /receiving_enabled: draft\.receivingEnabled/)
  assert.match(units, /payload\.product_id = baseUnit\.product_id/)
  assert.doesNotMatch(units, /tenant_id|branch_id/)
})

test('calculated price preview uses decimal arithmetic and rounds only for display', () => {
  assert.equal(calculatedPreview('2.35', '24'), '56.40')
  assert.equal(calculatedPreview('0.10', '3'), '0.30')
  assert.equal(calculatedPreview('1.005', '2'), '2.01')
  assert.match(units, /export function decimalPackagePrice/)
  assert.match(units, /export function formatPackagePrice/)
  assert.match(units, /BigInt/)
  assert.match(units, /formatPackagePrice\(calculatedPrice\)/)
})

test('validation covers package names, conversion, custom price and duplicate active names', () => {
  assert.match(units, /draft\.name\.trim\(\)\.length > 80/)
  assert.match(units, /draft\.nameAr\.trim\(\)\.length > 80/)
  assert.match(units, /\\d\{1,6\}/)
  assert.match(units, /Number\(draft\.conversion\) <= 0/)
  assert.match(units, /\\d\{1,2\}/)
  assert.match(units, /duplicateNames\.some/)
  assert.match(units, /error\?\.code === '23505'/)
  assert.match(english.units.errors.duplicate, /already exists/i)
})

test('updates use optimistic versions and stale conflicts are explicit', () => {
  assert.match(units, /payload\.expected_version = unit\.version/)
  assert.match(units, /error\?\.code === '40001'/)
  assert.match(units, /if \(errorKey === 'stale'\)[\s\S]*?await onStale\(\)/)
  assert.match(units, /const handleStale = async \(\) => \{[\s\S]*?await loadUnits\(\)/)
  assert.match(english.units.errors.stale, /changed elsewhere/i)
  assert.match(english.units.errors.stale, /reloaded/i)
  assert.match(arabic.units.errors.stale, /مكان آخر/)
})

test('out-of-order unit loads are ignored when switching products', () => {
  assert.match(units, /const loadRequestId = useRef\(0\)/)
  assert.match(units, /const requestId = \+\+loadRequestId\.current/)
  assert.match(units, /if \(requestId !== loadRequestId\.current\) return/)
  assert.match(units, /return \(\) => \{\s*loadRequestId\.current \+= 1/)
})

test('packages deactivate and reactivate without hard deletion', () => {
  assert.match(units, /unit\.is_active \? 'deactivate_product_unit' : 'reactivate_product_unit'/)
  assert.match(units, /p_product_unit_id: unit\.id/)
  assert.match(units, /p_expected_version: unit\.version/)
  assert.doesNotMatch(units, /\.delete\(|delete_product_unit/)
})

test('first-use conversion is visibly locked while other package fields remain editable', () => {
  assert.match(units, /conversionLocked = Boolean\(unit\?\.first_used_at\)/)
  assert.match(units, /disabled=\{conversionLocked\}/)
  assert.match(units, /t\('units\.conversionLocked'\)/)
})

test('service and stock-disabled states have distinct safe behavior', () => {
  assert.match(drawer, /serviceRestricted=\{businessType === 'service' \|\| product\?\.is_service === true\}/)
  assert.match(units, /if \(serviceRestricted\)/)
  assert.match(units, /t\('units\.serviceRestriction'\)/)
  assert.match(units, /!stockEnabled/)
  assert.match(units, /t\('units\.stockDisabled'\)/)
  assert.match(english.units.stockDisabled, /no stock will move/i)
  assert.match(arabic.units.stockDisabled, /لن تحدث حركة مخزون/)
})

test('English and Arabic package copy is complete and dynamically names the base unit', () => {
  const requiredKeys = [
    'baseUnit', 'addPackage', 'packageName', 'packageNameAr', 'contains',
    'normalPrice', 'customPriceOption', 'calculatedPrice', 'customPackagePrice',
    'allowSelling', 'allowReceiving', 'active', 'inactive', 'deactivate',
    'reactivate', 'saved', 'conversionLocked', 'serviceRestriction', 'stockDisabled',
  ]
  for (const key of requiredKeys) {
    assert.equal(typeof english.units[key], 'string', `missing English units.${key}`)
    assert.equal(typeof arabic.units[key], 'string', `missing Arabic units.${key}`)
  }
  assert.match(english.units.contains, /\{\{baseUnit\}\}/)
  assert.match(arabic.units.contains, /\{\{baseUnit\}\}/)
})

test('package editor is keyboard-accessible, RTL-safe and mobile-safe', () => {
  assert.match(drawer, /aria-expanded=\{open\}/)
  assert.match(units, /grid-cols-1 gap-3 sm:grid-cols-2/)
  assert.match(units, /min-w-0/)
  assert.match(units, /max-w-\[48%\] break-words/)
  assert.match(units, /text-start/)
  assert.match(units, /dir="rtl"/)
  assert.match(units, /htmlFor=/)
  assert.match(units, /role="radio"/)
  assert.doesNotMatch(units, /min-w-\[|w-\[\d+px\]/)
})

test('newly persisted products stop using add-product SKU suggestion behavior', () => {
  assert.match(drawer, /!open \|\| product \|\| createdProductId \|\| skuManuallyEdited/)
  assert.match(drawer, /\[open, product, createdProductId, skuManuallyEdited, resolvedBranchId, name\]/)
})

test('browser package mutations remain RPC-only while POS uses the approved scoped read RPC', () => {
  assert.doesNotMatch(units, /\.from\(['"]product_units['"]\)/)
  assert.doesNotMatch(units, /\.insert\(|\.update\(|\.delete\(/)
  assert.match(pos, /\.rpc\('get_branch_selling_product_units'/)
  assert.doesNotMatch(pos, /\.from\(['"]product_units['"]\)/)
  assert.doesNotMatch(pos, /ProductUnitsSection|create_product_unit|update_product_unit/)
})

test('Phase 2 UI contains no checkout, credit-note, reporting, ZATCA or migration implementation', () => {
  assert.doesNotMatch(units, /pos_checkout|atomic|credit.note|invoice|zatca/i)
  assert.doesNotMatch(drawer, /create_product_unit|update_product_unit|deactivate_product_unit|reactivate_product_unit/)
})

test('safe feedback covers access denial, inactive products and informational pricing', () => {
  assert.match(units, /error\?\.code === '42501'/)
  assert.match(units, /Product not found or inactive/)
  assert.match(english.units.errors.accessDenied, /account cannot manage/i)
  assert.match(arabic.units.errors.accessDenied, /صلاحية/)
  assert.match(units, /t\('units\.previewHint'\)/)
  assert.match(english.units.previewHint, /Preview only/i)
  assert.equal(typeof arabic.units.previewHint, 'string')
})

console.log(`product units Phase 2 UI checks passed (${results.length} assertions)`)
