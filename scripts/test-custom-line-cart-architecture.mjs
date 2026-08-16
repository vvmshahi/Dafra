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
  assert.equal(cart.createCustomCartLine(customInput({ description: 'x'.repeat(256) })), null)
  assert.equal(cart.createCustomCartLine(customInput({ descriptionAr: 'ع'.repeat(256) })), null)

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

  // The server mapper keeps legacy and package catalogue payloads byte-for-byte
  // compatible, while deliberately omitting client cart identity and previews
  // from a Custom Line financial request.
  const legacyCatalogueLine = { ...catalogueLine, productUnitId: null, productUnitVersion: null, quantity: 2 }
  const checkoutItems = cart.serializePosCartLinesForCheckout([legacyCatalogueLine, catalogueLine, first])
  assert.deepEqual(checkoutItems[0], { product_id: 'product-1', quantity: 2 })
  assert.deepEqual(checkoutItems[1], {
    product_id: 'product-1',
    product_unit_id: 'unit-1',
    package_quantity: 1,
    expected_product_unit_version: 2,
  })
  assert.deepEqual(checkoutItems[2], {
    source: 'custom',
    name: 'Manual consultation',
    name_ar: null,
    quantity: 1.25,
    unit_price: 100,
    vat_treatment: 'inherit',
  })
  assert.equal('cartLineId' in checkoutItems[2], false)
  assert.equal('subtotal' in checkoutItems[2], false)
  assert.equal('taxAmount' in checkoutItems[2], false)

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

  // Both insertion points now follow the effective branch capability only;
  // business profile and browser-only development flags never authorize it.
  assert.match(pos, /const customLineActionEnabled = branchBillingConfig\?\.customLinesEnabled === true/)
  assert.doesNotMatch(pos, /CUSTOM_LINE_CART_INTERNAL_ENABLED|VITE_INTERNAL_CUSTOM_LINE_CART/)
  assert.match(pos, /data-pos-custom-line-action="touch"/)
  assert.match(pos, /data-pos-custom-line-action="quick"/)
  assert.match(editor, /CUSTOM_LINE_UNIT_CODE/)
  assert.match(editor, /validateCustomCartLineInput/)
  assert.match(pos, /function saveCustomCartLine[\s\S]*cartLineId === line\.cartLineId/)
  assert.match(pos, /function removeCartLine[\s\S]*filter\(item => item\.cartLineId !== cartLineId\)/)

  // Phase 6 removes the old client-only hard block only after introducing the
  // narrow server contract. The classifier remains before either checkout RPC.
  const charge = pos.slice(pos.indexOf('async function charge()'))
  const classifier = charge.indexOf('resolvePosCheckoutDocument(branch.id, customerId)')
  const rpc = charge.indexOf("'pos_checkout'")
  assert.doesNotMatch(charge, /hasCustomCartLines\(cart\)|customLine\.checkoutUnavailable/)
  assert.ok(classifier >= 0 && classifier < rpc)
  assert.match(charge, /items: serializePosCartLinesForCheckout\(cart\)/)
  const mapper = charge.slice(charge.indexOf('let payload:'), classifier)
  assert.match(mapper, /serializePosCartLinesForCheckout\(cart\)/)
  assert.match(pos, /resolvePosCheckoutDocument\(branch\.id, customerId\)/)

  const changedPaths = [
    ...execFileSync('git', ['diff', '--name-only', '20dffdd31d9f358563996776a5830e04985e2d4c', '--'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean),
  ]
  const permittedLineageRepairPaths = new Set([
    'supabase/migrations/20260813000100_normalize_product_capability_stock_and_pos.sql',
    'supabase/migrations/20260813000200_enforce_pos_checkout_open_register.sql',
    'supabase/migrations/20260816000100_branch_billing_profile_foundation.sql',
    'supabase/migrations/20260816000100_services_and_custom_billing_lines.sql',
    'supabase/migrations/20260816000200_branch_billing_profile_foundation.sql',
    'supabase/migrations/20260816000300_authoritative_custom_line_checkout.sql',
    'supabase/migrations/20260816000400_source_aware_reporting_credit_restock.sql',
    'supabase/migrations/20260804000250_restore_zatca_sandbox_credentials_prerequisite.sql',
    'supabase/migrations/20260804000600_trading_sandbox_v2.sql',
    'supabase/migrations/20260805000200_persist_zatca_capability_selection.sql',
  ])
  assert.equal(
    changedPaths.some(path => path.startsWith('supabase/migrations/') && !permittedLineageRepairPaths.has(path)),
    false,
    'only audited forward branch-billing migrations may touch migrations',
  )
  for (const protectedPath of [
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
    assert.equal(typeof locale.customLine.previewOnly, 'string')
    assert.doesNotMatch(locale.customLine.previewOnly, /unavailable|غير متاح/)
  }

  console.log('Custom line cart architecture tests passed.')
} finally {
  await server.close()
}
