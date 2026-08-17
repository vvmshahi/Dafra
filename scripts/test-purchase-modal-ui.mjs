import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const modal = read('src/pages/inventory/PurchaseBillModal.tsx')
const history = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const page = read('src/pages/purchases/PurchasesPage.tsx')
const migration = read('supabase/migrations/20260817000300_purchase_product_receiving_v1.sql')
const en = JSON.parse(read('src/localization/locales/en/purchases.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/purchases.json'))

assert.match(page, /kubri:open-purchase/)
assert.match(history, /kubri:open-purchase/)
assert.match(history, /const suppliersUsed  = new Set\(countedPurchases/)
assert.match(modal, /type Mode = ["']simple["'] \| ["']receiving["']/)
assert.match(modal, /create_simple_purchase_v1/)
assert.match(modal, /create_product_purchase_and_receive_v1/)
assert.match(modal, /useState<Payment\s*\|\s*null>\(null\)/)
assert.match(modal, /useState<Tax\s*\|\s*null>\(null\)/)
assert.match(modal, /eq\(["']track_stock["'], ?true\)[\s\S]*eq\(["']is_service["'], ?false\)/)
assert.match(modal, /get_product_units/)
assert.match(modal, /receiving_enabled/)
assert.match(modal, /expected_product_unit_version/)
assert.match(modal, /onValueChange=\{\(value\) =>/)
assert.match(modal, /placeholder="0\.00"/)
assert.doesNotMatch(modal, /MoneyInput[\s\S]{0,160}onChange=/)
assert.match(modal, /select\(["']id,name,name_ar,sku,barcode,unit,stock_quantity,cost["']\)/)
assert.match(modal, /productsLoading/)
assert.match(modal, /productsError/)
assert.match(modal, /No stock-tracked products are available/)
assert.match(modal, /Couldn’t load products\. Try again\./)
assert.match(modal, /Current stock: \{\{quantity\}\}/)
assert.match(modal, /Add notes|purchases:chooser.addNotes/)
assert.match(modal, /purchases-bills/)
assert.match(modal, /role="dialog"/)
assert.match(modal, /lg:grid-cols-\[minmax\(0,1fr\)_280px\]/)
assert.doesNotMatch(modal, /inventory_item_id|receive_product_stock|confirm_purchase_receiving/)

for (const locale of [en, ar]) {
  assert.equal(typeof locale.chooser.simple, 'string')
  assert.equal(typeof locale.chooser.receiving, 'string')
  assert.equal(typeof locale.sections.purchaseItems, 'string')
  assert.equal(typeof locale.fields.receivingUnit, 'string')
}

for (const field of ['product_id','product_unit_id','product_unit_version','conversion_to_base','base_quantity','base_unit_cost']) assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${field}`))
assert.match(migration, /create_simple_purchase_v1/)
assert.match(migration, /create_product_purchase_and_receive_v1/)
assert.match(migration, /resolve_product_commercial_unit\(v_product_id,v_unit_id,v_quantity,v_expected_version,'receive'\)/)
assert.match(migration, /IDEMPOTENCY_FINGERPRINT_MISMATCH/)
assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_product_purchase_and_receive_v1/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_product_purchase_and_receive_v1\(jsonb\) TO authenticated/)

console.log('Purchase V1 mode chooser, explicit-payment, product-unit receiving, and RPC contract tests passed.')
