import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const modal = read('src/pages/inventory/PurchaseBillModal.tsx')
const legacyDrawer = read('src/pages/inventory/PurchaseDrawer.tsx')
const page = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const purchasesPage = read('src/pages/purchases/PurchasesPage.tsx')
const stockDrawer = read('src/pages/inventory/ProductStockReceiptDrawer.tsx')
const en = JSON.parse(read('src/localization/locales/en/purchases.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/purchases.json'))

// The Purchases route renders one supplier-bill workflow without a mode step.
assert.match(page, /import PurchaseBillModal from '\.\/PurchaseBillModal'/)
assert.match(page, /<PurchaseBillModal/)
assert.doesNotMatch(page, /<PurchaseDrawer/)
assert.doesNotMatch(modal, /name="purchase-mode"|detailed_receiving|receivingItems|inventory_item_id/)
assert.doesNotMatch(modal, /purchase_items|receive_product_stock|confirm_purchase_receiving/)
assert.doesNotMatch(modal, /receivingSummary|totalInventoryCost|totalReceivingQuantity/)
assert.doesNotMatch(page, /<ConfirmStockModal|actions\.confirmStock/)
assert.doesNotMatch(purchasesPage, /stockEnabled|isStockModuleVisible/)

// The legacy drawer remains intact for backend compatibility, but is not routed.
assert.match(legacyDrawer, /detailed_receiving/)
assert.match(legacyDrawer, /\.from\('purchase_items'\)\.insert/)
assert.match(page, /purchase\.purchase_items/)
assert.match(page, /mode === 'simple_bill' \? t\('purchases:mode\.bill'\) : t\('purchases:mode\.stock'\)/)

// Existing supplier-bill contract and calculations are preserved.
assert.match(modal, /purchase_mode: 'simple_bill' as const/)
assert.match(modal, /status: 'posted'/)
assert.match(modal, /receiving_status: 'not_applicable'/)
for (const field of [
  'tenant_id: resolvedTenantId',
  'branch_id: resolvedBranchId',
  'supplier_id: supplierId',
  'purchase_date: date',
  'bill_number: billNumber.trim() || null',
  'tax_input_mode: taxMode',
  'payment_status: paymentStatus',
  'subtotal: totals.subtotal',
  'vat_amount: totals.vat',
  'total_amount: totals.total',
  'payment_method: paymentMethod',
  'notes: notes.trim() || null',
]) assert.ok(modal.includes(field), `missing supplier-bill payload field: ${field}`)

assert.match(modal, /amount \* 15 \/ 115/)
assert.match(modal, /amount \* 0\.15/)
assert.match(modal, /subtotal: roundMoney\(amount - vat\)/)
assert.match(modal, /total: roundMoney\(amount \+ vat\)/)
for (const value of ['cash', 'card', 'bank_transfer']) assert.match(modal, new RegExp(`value: '${value}'`))
assert.match(modal, /useState<PaymentStatus>\('paid'\)/)
assert.doesNotMatch(modal, /name="payment-status"|paid_amount|amount_paid|balance_due/)

// Attachments, validation, error retention, refresh, and duplicate blocking remain.
assert.match(modal, /accept="image\/jpeg,image\/png,image\/webp,image\/heic,application\/pdf"/)
assert.match(modal, /\.from\('purchases-bills'\)/)
assert.match(modal, /rpc\('set_purchase_bill_attachment'/)
assert.match(modal, /if \(saving\) return/)
assert.match(modal, /disabled=\{saving \|\| !formCanSubmit\}/)
assert.match(modal, /role="alert" aria-live="assertive"/)
assert.match(modal, /toast\.success\(t\('purchases:success\.bill'\)\)/)
assert.match(modal, /onSaved\(\)[\s\S]*?reset\(\)[\s\S]*?onClose\(\)/)

// Layout, accessibility, and compact stock guidance.
assert.match(modal, /role="dialog"/)
assert.match(modal, /aria-modal="true"/)
assert.match(modal, /lg:grid-cols-\[minmax\(0,1\.65fr\)_minmax\(280px,1fr\)\]/)
assert.match(modal, /lg:sticky lg:top-0/)
assert.match(modal, /href="\/inventory" target="_blank"/)
assert.match(modal, /modal\.stockGuidance/)
assert.match(modal, /modal\.financialPreview/)
assert.match(modal, /modal\.totalBill/)
assert.match(modal, /event\.key === 'Escape'/)
assert.match(modal, /event\.key !== 'Tab'/)
assert.match(modal, /previousFocusRef\.current\?\.focus\(\)/)
assert.match(modal, /active:scale-\[0\.97\]/)

// Add Stock remains the sole visible sellable-product receiving workflow.
assert.match(stockDrawer, /rpc\('receive_product_stock'/)

for (const locale of [en, ar]) {
  assert.equal(typeof locale.modal.billOnlySubtitle, 'string')
  assert.equal(typeof locale.modal.stockGuidance, 'string')
  assert.equal(typeof locale.modal.openAddStock, 'string')
  assert.equal(typeof locale.actions.recordPurchase, 'string')
  assert.equal(typeof locale.success.bill, 'string')
}
assert.equal(en.modal.stockGuidance, 'This purchase records the supplier bill only. To receive sellable products or cartons, use Stock → Add Stock.')
assert.equal(ar.modal.stockGuidance, 'يسجل هذا الشراء فاتورة المورد فقط. لاستلام المنتجات القابلة للبيع أو الكراتين، استخدم المخزون ← إضافة مخزون.')

console.log('Simplified supplier-bill Purchases workflow, contracts, VAT, stock guidance, history, and accessibility checks passed.')
