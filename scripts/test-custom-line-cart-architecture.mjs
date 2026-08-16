import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const scanner = read('src/lib/pos/unifiedScanner.ts')
const cartTypes = read('src/lib/pos/cartLines.ts')
const editor = read('src/components/pos/CustomLineEditor.tsx')
const en = JSON.parse(read('src/localization/locales/en/pos.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))

const catalogueLine = {
  source: 'catalogue',
  cartLineId: 'product-1:unit-1:2:custom:12.50:inherit',
  productId: 'product-1',
  productUnitId: 'unit-1',
  productUnitVersion: 2,
  pricingMethod: 'custom',
  conversionToBase: 6,
  quantityScale: 3,
  unitName: 'Box',
  unitNameAr: 'صندوق',
  unitCode: 'BOX',
  baseUnitName: 'Piece',
  baseUnitNameAr: 'قطعة',
  name: 'Saved service',
  nameAr: 'خدمة محفوظة',
  price: 12.5,
  vatTreatment: 'inherit',
  unit: 'Box',
  quantity: 1,
  catColor: '#008000',
}

const customInput = overrides => ({
  description: 'Manual consultation',
  descriptionAr: null,
  quantity: 1.25,
  unitPrice: 100,
  vatTreatment: 'inherit',
  ...overrides,
})

const server = await createServer({ appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' })

try {
  const cart = await server.ssrLoadModule('/src/lib/pos/cartLines.ts')
  const unified = await server.ssrLoadModule('/src/lib/pos/unifiedScanner.ts')

  // The source-discriminated model preserves the existing product/package
  // shape while ensuring a custom line cannot masquerade as a product.
  assert.match(cartTypes, /export interface CatalogueCartLine/)
  assert.match(cartTypes, /export interface CustomCartLine/)
  assert.match(cartTypes, /export type PosCartLine = CatalogueCartLine \| CustomCartLine/)
  assert.equal(cart.isCatalogueCartLine(catalogueLine), true)
  assert.equal(cart.isCustomCartLine(catalogueLine), false)
  assert.equal(catalogueLine.productId, 'product-1')
  assert.equal(catalogueLine.productUnitId, 'unit-1')
  assert.equal(catalogueLine.conversionToBase, 6)

  const savedService = { ...catalogueLine, productId: 'saved-service-1', name: 'Saved service' }
  assert.equal(savedService.source, 'catalogue')
  assert.equal(savedService.productId, 'saved-service-1')

  const custom = cart.createCustomCartLine(customInput())
  assert.ok(custom)
  assert.equal(cart.isCustomCartLine(custom), true)
  assert.equal(custom.unitCode, 'PCE')
  for (const forbiddenField of ['productId', 'productUnitId', 'trackStock', 'stockQuantity', 'sku', 'barcode']) {
    assert.equal(forbiddenField in custom, false, `custom line must not contain ${forbiddenField}`)
  }

  assert.equal(cart.createCustomCartLine(customInput({ description: '   ' })), null)
  const withoutArabicDescription = cart.createCustomCartLine(customInput({ descriptionAr: undefined }))
  assert.ok(withoutArabicDescription)
  assert.equal(withoutArabicDescription.descriptionAr, null)
  for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.0001]) {
    assert.equal(cart.createCustomCartLine(customInput({ quantity })), null)
  }
  for (const unitPrice of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.001]) {
    assert.equal(cart.createCustomCartLine(customInput({ unitPrice })), null)
  }
  for (const vatTreatment of ['exempt', 'zero_rated', 'out_of_scope']) {
    assert.equal(cart.createCustomCartLine(customInput({ vatTreatment })), null)
  }
  for (const vatTreatment of ['inherit', 'exclusive', 'inclusive']) {
    assert.ok(cart.createCustomCartLine(customInput({ vatTreatment })))
  }

  const first = cart.createCustomCartLine(customInput())
  const second = cart.createCustomCartLine(customInput())
  assert.ok(first && second)
  assert.notEqual(first.cartLineId, second.cartLineId)
  const edited = cart.createCustomCartLine(customInput({ cartLineId: first.cartLineId, description: 'Edited consultation' }))
  assert.ok(edited)
  assert.equal(edited.cartLineId, first.cartLineId)
  const restoredWithoutId = cart.createCustomCartLine(customInput({ cartLineId: '   ' }))
  assert.ok(restoredWithoutId?.cartLineId.startsWith('custom:'))
  const distinctCart = [first, second]
  assert.equal(distinctCart.length, 2)
  assert.deepEqual(distinctCart.filter(line => line.cartLineId !== first.cartLineId), [second])
  assert.equal(cart.hasCustomCartLines([catalogueLine, first]), true)
  assert.equal(cart.hasCustomCartLines([catalogueLine]), false)

  const exclusivePreview = cart.getCustomLineDisplayPreview(
    cart.createCustomCartLine(customInput({ quantity: 2, unitPrice: 100, vatTreatment: 'exclusive' })),
    'inclusive',
  )
  assert.deepEqual(exclusivePreview, {
    lineAmount: 200,
    subtotal: 200,
    taxAmount: 30,
    total: 230,
    effectiveVatTreatment: 'exclusive',
  })
  const inclusivePreview = cart.getCustomLineDisplayPreview(
    cart.createCustomCartLine(customInput({ quantity: 1, unitPrice: 115, vatTreatment: 'inclusive' })),
    'exclusive',
  )
  assert.equal(inclusivePreview.total, 115)
  assert.equal(inclusivePreview.taxAmount, 15)
  assert.match(cartTypes, /non-authoritative browser preview only/)

  // Scanner and package mutations remain catalogue-only and retain their
  // existing merge semantics.
  assert.match(scanner, /export interface ScannerCartLine[\s\S]*productId: string/)
  assert.match(pos, /const catalogueCart = cartRef\.current\.filter\(isCatalogueCartLine\)/)
  assert.match(pos, /cart: catalogueCart/)
  let scannerCart = []
  scannerCart = unified.applyScannerCartMutation({ cart: scannerCart, line: catalogueLine, stockQuantity: 100, enforceStock: true }).cart
  scannerCart = unified.applyScannerCartMutation({ cart: scannerCart, line: catalogueLine, stockQuantity: 100, enforceStock: true }).cart
  assert.equal(scannerCart.length, 1)
  assert.equal(scannerCart[0].quantity, 2)
  assert.equal(scannerCart[0].productUnitId, 'unit-1')

  // Both insertion points are intentionally behind a development-only gate.
  assert.match(pos, /import\.meta\.env\.DEV\s*&&\s*import\.meta\.env\.VITE_INTERNAL_CUSTOM_LINE_CART === 'true'/)
  assert.match(pos, /CUSTOM_LINE_CART_INTERNAL_ENABLED\s*&&\s*branchBillingConfig\?\.customLinesEnabled === true/)
  assert.match(pos, /data-pos-custom-line-action="touch"/)
  assert.match(pos, /data-pos-custom-line-action="quick"/)
  assert.match(editor, /CUSTOM_LINE_UNIT_CODE/)
  assert.match(editor, /validateCustomCartLineInput/)
  assert.match(pos, /function saveCustomCartLine[\s\S]*cartLineId === line\.cartLineId/)
  assert.match(pos, /function removeCartLine[\s\S]*filter\(item => item\.cartLineId !== cartLineId\)/)

  // The hard block is before both the classifier and checkout RPC. The mapper
  // stays product-backed and does not add a client discriminator to its payload.
  const charge = pos.slice(pos.indexOf('async function charge()'))
  const hardBlock = charge.indexOf('hasCustomCartLines(cart)')
  const classifier = charge.indexOf('resolvePosCheckoutDocument(branch.id, customerId)')
  const rpc = charge.indexOf("'pos_checkout'")
  assert.ok(hardBlock >= 0 && hardBlock < classifier && hardBlock < rpc)
  assert.match(charge, /toast\.error\(t\('pos:customLine\.checkoutUnavailable'\)\)/)
  assert.match(charge, /items: cart\.filter\(isCatalogueCartLine\)\.map\(item => item\.productUnitId/)
  const mapper = charge.slice(charge.indexOf('let payload:'), classifier)
  assert.match(mapper, /product_id: item\.productId/)
  assert.match(mapper, /product_unit_id: item\.productUnitId/)
  assert.doesNotMatch(mapper, /source:\s*'catalogue'|source:\s*'custom'/)
  assert.match(pos, /resolvePosCheckoutDocument\(branch\.id, customerId\)/)

  const changedPaths = [
    ...execFileSync('git', ['diff', '--name-only', '20dffdd31d9f358563996776a5830e04985e2d4c', '--'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean),
  ]
  for (const protectedPath of [
    'supabase/migrations/',
    'supabase/functions/',
    'src/pages/invoices/',
    'src/components/print/',
    'src/lib/zatca/',
  ]) {
    assert.equal(changedPaths.some(path => path.startsWith(protectedPath)), false, `${protectedPath} must remain unchanged`)
  }

  for (const locale of [en, ar]) {
    assert.equal(typeof locale.customLine.action, 'string')
    assert.equal(typeof locale.customLine.description, 'string')
    assert.equal(typeof locale.customLine.descriptionAr, 'string')
    assert.equal(typeof locale.customLine.quantity, 'string')
    assert.equal(typeof locale.customLine.unitPrice, 'string')
    assert.equal(typeof locale.customLine.vatTreatment, 'string')
    assert.equal(typeof locale.customLine.vat.inherit, 'string')
    assert.equal(typeof locale.customLine.vat.exclusive, 'string')
    assert.equal(typeof locale.customLine.vat.inclusive, 'string')
    assert.equal(typeof locale.customLine.checkoutUnavailable, 'string')
  }

  console.log('Custom line cart architecture tests passed.')
} finally {
  await server.close()
}
