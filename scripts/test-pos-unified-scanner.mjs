import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/pos.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))

const dom = new JSDOM('<!doctype html><html><body><input id="editable"><div id="plain"></div><div role="dialog"><button id="dialog-control"></button></div></body></html>')
Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element })
const server = await createServer({ appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' })

try {
  const scanner = await server.ssrLoadModule('/src/lib/barcodes/scanner.ts')
  const unified = await server.ssrLoadModule('/src/lib/pos/unifiedScanner.ts')

  assert.doesNotMatch(pos, /manualBarcode|pos:scanner\.manual|pos:scanner\.add/)
  assert.match(pos, /placeholder=\{t\('pos:searchProducts'\)\}/)
  assert.match(pos, /onKeyDown=\{handleCommandBarKeyDown\}/)
  assert.match(pos, /aria-describedby="pos-scanner-status"/)
  assert.match(pos, /aria-live="polite"/)
  assert.match(pos, /useBarcodeScanner\(/)
  assert.match(pos, /applyScannerCartMutation/)
  assert.match(pos, /function addQuantityToCart[\s\S]*?mutateCart\(product, quantity, unit, false\)/)
  assert.match(pos, /const addScannedUnit[\s\S]*?mutateCart\(product, 1, unit, true\)/)
  assert.match(pos, /resolvedBarcodeCacheRef/)
  assert.match(pos, /setCart\(mutation\.cart\)/)
  assert.doesNotMatch(pos, /lastScannerRequestRef|now - previous\.at < 120/)

  assert.equal(en.searchProducts, 'Search product name, SKU, or barcode')
  for (const locale of [en, ar]) {
    for (const key of ['ready', 'processing', 'productAdded', 'quantityUpdated', 'packageAdded', 'unknown', 'conflict', 'outOfStock', 'networkError', 'unavailable']) {
      assert.equal(typeof locale.scanner[key], 'string')
      assert.ok(locale.scanner[key].length > 0)
    }
  }

  const productA = { id: 'a' }
  const productB = { id: 'b' }
  const baseA = { id: 'a-base' }
  const packA = { id: 'a-pack' }
  const baseB = { id: 'b-base' }
  const index = unified.createScannerIndex([
    { code: '001234', product: productA, unit: baseA, source: 'barcode' },
    { code: 'SKU-A', product: productA, unit: baseA, source: 'sku' },
    { code: 'PACK-A', product: productA, unit: packA, source: 'unit' },
    { code: 'B-CODE', product: productB, unit: baseB, source: 'barcode' },
    { code: 'INACTIVE', product: productB, unit: baseB, source: 'barcode', active: false },
  ])
  assert.equal(unified.resolveScannerCode(index, ' 001234 ').entry.unit.id, 'a-base')
  assert.equal(unified.resolveScannerCode(index, 'sku-a').entry.product.id, 'a')
  assert.equal(unified.resolveScannerCode(index, 'PACK-A').entry.unit.id, 'a-pack')
  assert.equal(unified.resolveScannerCode(index, 'INACTIVE').status, 'unknown')
  assert.equal(unified.resolveScannerCode(index, 'missing').status, 'unknown')
  const conflicts = unified.createScannerIndex([
    { code: 'DUP', product: productA, unit: baseA, source: 'barcode' },
    { code: 'DUP', product: productB, unit: baseB, source: 'barcode' },
  ])
  assert.equal(unified.resolveScannerCode(conflicts, 'dup').status, 'conflict')

  const line = (productId, unitId, conversionToBase = 1, price = 10) => ({
    cartLineId: `${productId}:${unitId}`,
    productId,
    quantity: 1,
    conversionToBase,
    price,
  })
  let cart = []
  for (let count = 0; count < 100; count++) {
    cart = unified.applyScannerCartMutation({
      cart,
      line: line('a', 'base'),
      stockQuantity: 1000,
      enforceStock: true,
    }).cart
  }
  assert.equal(cart.length, 1)
  assert.equal(cart[0].quantity, 100)
  assert.equal(cart[0].price * cart[0].quantity, 1000)

  cart = []
  for (let count = 0; count < 100; count++) {
    const next = line(`p-${count}`, 'base', 1, count + 1)
    cart = unified.applyScannerCartMutation({ cart, line: next, stockQuantity: null, enforceStock: false }).cart
  }
  assert.deepEqual(cart.map(item => item.productId), Array.from({ length: 100 }, (_, indexValue) => `p-${indexValue}`))

  cart = []
  for (const next of [line('a', 'base'), line('a', 'pack', 6, 55), line('a', 'base'), line('b', 'base')]) {
    cart = unified.applyScannerCartMutation({ cart, line: next, stockQuantity: 20, enforceStock: true }).cart
  }
  assert.deepEqual(cart.map(item => [item.cartLineId, item.quantity]), [['a:base', 2], ['a:pack', 1], ['b:base', 1]])
  const blocked = unified.applyScannerCartMutation({ cart, line: line('a', 'pack', 6), stockQuantity: 10, enforceStock: true })
  assert.equal(blocked.status, 'out_of_stock')
  assert.equal(blocked.cart, cart)

  cart = []
  for (let count = 0; count < 100; count++) {
    const next = count % 2 === 0 ? line('a', 'base') : line('b', 'base')
    cart = unified.applyScannerCartMutation({ cart, line: next, stockQuantity: null, enforceStock: false }).cart
  }
  assert.deepEqual(cart.map(item => [item.productId, item.quantity]), [['a', 50], ['b', 50]])

  const ordered = []
  const queue = new scanner.OrderedScanQueue()
  for (let count = 0; count < 1000; count++) {
    queue.enqueue(async () => {
      await Promise.resolve()
      ordered.push(count)
    })
  }
  await queue.whenIdle()
  assert.equal(queue.pending, 0)
  assert.equal(ordered.length, 1000)
  assert.deepEqual(ordered.slice(398, 403), [398, 399, 400, 401, 402])
  assert.equal(ordered.at(-1), 999)

  const recovered = []
  const recoveryQueue = new scanner.OrderedScanQueue()
  recoveryQueue.enqueue(async () => { recovered.push('valid-before') })
  recoveryQueue.enqueue(async () => { throw new Error('unknown fixture') }).catch(() => {})
  recoveryQueue.enqueue(async () => { recovered.push('valid-after') })
  await recoveryQueue.whenIdle()
  assert.deepEqual(recovered, ['valid-before', 'valid-after'])
  assert.equal(recoveryQueue.pending, 0)

  let now = 0
  const captures = []
  const wedge = new scanner.KeyboardWedgeCapture(capture => captures.push(capture), { now: () => now, idleCompletionMs: 10_000 })
  for (const character of '001234') {
    wedge.handle({ key: character, repeat: false, isComposing: false })
    now += 5
  }
  assert.equal(wedge.handle({ key: 'Enter', repeat: false, isComposing: false }), true)
  assert.equal(captures.length, 1)
  assert.equal(captures[0].code, '001234')
  assert.equal(wedge.handle({ key: 'Enter', repeat: false, isComposing: false }), false)

  const slow = new scanner.KeyboardWedgeCapture(capture => captures.push(capture), { now: () => now, idleCompletionMs: 10_000 })
  for (const character of 'typing') {
    slow.handle({ key: character, repeat: false, isComposing: false })
    now += 100
  }
  assert.equal(slow.handle({ key: 'Enter', repeat: false, isComposing: false }), false)
  assert.equal(captures.length, 1)

  assert.equal(scanner.isEditableScannerTarget(dom.window.document.querySelector('#editable')), true)
  assert.equal(scanner.isEditableScannerTarget(dom.window.document.querySelector('#dialog-control')), true)
  assert.equal(scanner.isEditableScannerTarget(dom.window.document.querySelector('#plain')), false)

  console.log('POS unified command bar, exact resolution, stock-safe cart mutation, capture, and 1,000-event FIFO tests passed.')
} finally {
  await server.close()
  dom.window.close()
  process.exit()
}
