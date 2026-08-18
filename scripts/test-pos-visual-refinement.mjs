import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/pos.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))

// Keep the functional scanner/checkout seams intact while checking the new
// terminal presentation contract through stable POS-only markers and classes.
assert.match(pos, /useBarcodeScanner\(\{/)
assert.match(pos, /onScan:\s*resolveScannedBarcode/)
assert.match(pos, /onClick=\{\(\) => setScannerEnabled\(value => !value\)\}/)
assert.match(pos, /scannerEnabled\n\s*\? 'border-emerald-300\/60 bg-\[#1B6B3A\] text-white/)
assert.match(pos, /scannerEnabled \? 'bg-emerald-200 ring-1 ring-\[#0F2419\]'\n\s*: 'bg-white\/30'/)
assert.doesNotMatch(pos, /<ScanLine size=\{14\} aria-hidden/)
assert.match(pos, /data-pos-barcode-status/)
assert.match(pos, /scannerEnabled \? 'pos:scanner\.inputOn' : 'pos:scanner\.inputOff'/)

assert.match(pos, /data-pos-more-menu/)
assert.match(pos, /setShowExpense\(true\); setShowMore\(false\)/)
assert.match(pos, /<AuthenticatedLanguageSwitch inverse/)

assert.match(pos, /data-pos-product-card/)
assert.match(pos, /h-\[228px\][\s\S]*?sm:h-\[242px\]/)
assert.match(pos, /data-pos-product-image-well/)
assert.match(pos, /data-pos-product-image-fallback/)
assert.match(pos, /imageUrl && !imageFailed \? \(/)
assert.match(pos, /onError=\{\(\) => setImageFailed\(true\)\}/)
assert.match(pos, /data-pos-product-title className="h-9/)
assert.match(pos, /data-pos-product-metadata className="mt-1 flex h-5/)
assert.match(pos, /data-pos-product-grid/)

assert.match(pos, /data-pos-empty-cart/)
assert.match(pos, /pos:emptyCartTitle/)
assert.match(pos, /pos:emptyCartHint/)
assert.match(pos, /h-10 w-10/)
assert.match(pos, /const \[payMethod,\s+setPayMethod\]\s+=\s+useState<PosPaymentChoice>\('cash'\)/)
assert.match(pos, /data-pos-payment-controls/)
assert.match(pos, /border-primary-500 bg-primary-500 text-white shadow-sm hover:bg-primary-600/)
assert.match(pos, /data-pos-charge/)
assert.match(pos, /data-pos-charge[\s\S]*?bg-primary-500[\s\S]*?\{t\('pos:charge'\)\} —/)
assert.match(pos, /onClick=\{payMethod === 'split' \? \(\) => setSplitOpen\(true\) : charge\}/)
assert.match(pos, /items:\s*serializePosCartLinesForCheckout\(cart\)/)
assert.match(pos, /persistPendingAtomicCheckout\(/)
assert.match(pos, /data-pos-terminal className="flex h-\[100dvh\] flex-col[\s\S]*?lg:flex-row/)
assert.match(pos, /data-pos-order-panel className="flex h-\[44dvh\] w-full[\s\S]*?lg:w-\[360px\]/)
assert.match(pos, /function SplitPaymentModal\([\s\S]*?bg-\[#fffefb\][\s\S]*?bg-primary-500/)
assert.match(pos, /function SplitPaymentModal\([\s\S]*?border-primary-700 bg-primary-700[\s\S]*?payments:cash[\s\S]*?payments:card[\s\S]*?payments:totalPaid/)
const splitModal = pos.slice(pos.indexOf('function SplitPaymentModal'), pos.indexOf('function SavedCheckoutRecoveryDialog'))
assert.doesNotMatch(splitModal, /payments:remaining/)
assert.doesNotMatch(pos, /function useNormalCardPayment\(/)
assert.doesNotMatch(pos, /onUseCard=/)

for (const locale of [en, ar]) {
  assert.equal(typeof locale.more, 'string')
  assert.equal(typeof locale.emptyCartTitle, 'string')
  assert.equal(typeof locale.emptyCartHint, 'string')
  assert.equal(typeof locale.scanner.inputOn, 'string')
  assert.equal(typeof locale.scanner.inputOff, 'string')
  assert.ok(locale.scanner.inputOn.length > 0)
  assert.ok(locale.scanner.inputOff.length > 0)
}

console.log('POS visual refinement contract passed (command bar, scanner copy, equal cards, cart targets, payments, charge, and portrait layout).')
