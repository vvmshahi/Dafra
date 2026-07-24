import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260725000400_canonical_branch_stock_enabled.sql')
const productControls = read('supabase/phase5l-product-stock-tracking-controls.sql')
const productReceipts = read('supabase/phase5m-product-stock-receipts.sql')
const atomicVerification = read('scripts/sql/zatca-phase2-finalization-v2/06_verification.sql')
const businessType = read('src/lib/utils/businessType.ts')
const branches = read('src/pages/settings/BranchesTab.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const creditNote = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const purchases = read('src/pages/purchases/PurchasesPage.tsx')
const purchaseHistory = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const purchaseDrawer = read('src/pages/inventory/PurchaseDrawer.tsx')

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

const effectiveStockEnabled = (tenantBusinessType, branchSetting) =>
  tenantBusinessType !== 'service' && (branchSetting ?? true)

test('canonical truth table', () => {
  assert.equal(effectiveStockEnabled('service', null), false)
  assert.equal(effectiveStockEnabled('service', false), false)
  assert.equal(effectiveStockEnabled('service', true), false)
  assert.equal(effectiveStockEnabled('trading', null), true)
  assert.equal(effectiveStockEnabled('trading', false), false)
  assert.equal(effectiveStockEnabled('trading', true), true)
})

test('database resolver implements one canonical condition', () => {
  assert.match(migration, /FUNCTION public\.branch_effective_stock_enabled/)
  assert.match(migration, /COALESCE\(t\.business_type, 'trading'\) <> 'service'/)
  assert.match(migration, /AND COALESCE\(b\.stock_enabled, true\)/)
  assert.match(migration, /Service businesses cannot enable the stock module/)
})

test('inventory adjustment grants are deterministic', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.adjust_inventory_item_stock\(jsonb\) FROM PUBLIC, anon;/,
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.adjust_inventory_item_stock\(jsonb\) TO authenticated, service_role;/,
  )
})

test('atomic POS verification remains strict at the canonical stock hash', () => {
  const expectedHash = '0db582cb8451ab6a6a69bb9d9d662de6'
  assert.ok(
    atomicVerification.includes(
      `'pos_checkout_hash', 'public.pos_checkout(jsonb)', '${expectedHash}'`,
    ),
  )
  assert.match(
    atomicVerification,
    /md5\(pg_get_functiondef\(v_oid\)\) = v_function\.expected_hash/,
  )
  assert.match(
    atomicVerification,
    /WHERE check_name = 'pos_checkout_hash' AND result = 'PASS'/,
  )
  assert.match(atomicVerification, /disabled branches skip product deduction/)
  assert.match(atomicVerification, /invoice totals, tax, payment, numbering, and ZATCA calculations remain/)
  assert.doesNotMatch(
    atomicVerification,
    /md5\(pg_get_functiondef\(v_oid\)\)\s*=\s*v_function\.expected_hash\s+OR\s+true/i,
  )
  assert.doesNotMatch(atomicVerification, /expected_hash\s+IS\s+NULL\s+THEN\s+'PASS'/i)
  assert.doesNotMatch(atomicVerification, /b810798d8d9b64248f06ae67c6d95f90/)
})

test('checkout skips balance and movement mutations when disabled', () => {
  assert.match(
    migration,
    /branch_effective_stock_enabled\(v_branch\.tenant_id, v_branch\.id\)[\s\S]*?COALESCE\(v_product\.track_stock, FALSE\)/,
  )
  assert.match(
    migration,
    /branch_effective_stock_enabled\(v_branch\.tenant_id, v_branch\.id\)[\s\S]*?\(v_line ->> 'track_stock'\)::boolean/,
  )

  const checkout = ({ enabled, stock, quantity, key }, state) => {
    if (state.keys.has(key)) return { replay: true, stock: state.stock }
    if (enabled && stock < quantity) throw new Error('insufficient_stock')
    if (enabled) state.stock -= quantity
    state.keys.add(key)
    return { replay: false, stock: state.stock }
  }
  const state = { stock: 0, keys: new Set() }
  const first = checkout({ enabled: false, stock: state.stock, quantity: 2, key: 'checkout-disabled-1' }, state)
  const replay = checkout({ enabled: false, stock: state.stock, quantity: 2, key: 'checkout-disabled-1' }, state)
  assert.equal(first.stock, 0)
  assert.equal(replay.replay, true)
  assert.equal(state.stock, 0)
  assert.equal(state.keys.size, 1)
})

test('credit notes and refundable items use effective eligibility', () => {
  assert.match(
    migration,
    /v_effective_return_stock[\s\S]*?branch_effective_stock_enabled\(v_original\.tenant_id, v_original\.branch_id\)/,
  )
  assert.match(
    migration,
    /branch_effective_stock_enabled\(v_original\.tenant_id, v_original\.branch_id\)[\s\S]*?AS track_stock/,
  )
})

test('all new stock entry points reject disabled branches', () => {
  assert.match(productControls, /COALESCE\(v_product\.business_type, 'trading'\) = 'service'/)
  assert.match(productControls, /v_stock_module_enabled := COALESCE\(v_product\.stock_enabled, TRUE\)/)
  assert.match(productControls, /v_stock_module_enabled IS NOT TRUE/)
  assert.match(productReceipts, /COALESCE\(v_product\.business_type, 'trading'\) = 'service'/)
  assert.match(productReceipts, /COALESCE\(v_product\.stock_enabled, TRUE\) IS NOT TRUE/)
  assert.match(
    migration,
    /adjust_inventory_item_stock\(jsonb\)[\s\S]*?branch_effective_stock_enabled\(v_item\.tenant_id, v_item\.branch_id\)/,
  )
  assert.match(
    migration,
    /confirm_purchase_receiving\(uuid,boolean\)[\s\S]*?branch_effective_stock_enabled\(v_purchase\.tenant_id, v_purchase\.branch_id\)/,
  )
  assert.match(
    migration,
    /confirm_purchase_receiving_unchecked\(uuid,boolean\)[\s\S]*?branch_effective_stock_enabled\(v_purchase\.tenant_id, v_purchase\.branch_id\)/,
  )
})

test('purchase reversal remains outside the disabled-stock guard', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.cancel_purchase_receiving/)
  assert.doesNotMatch(migration, /v_signature := 'public\.cancel_purchase_receiving/)
})

test('frontend resolver gives service tenant precedence', () => {
  const serviceCheck = businessType.indexOf("resolveBusinessType(businessType) === 'service'")
  const falseOverride = businessType.indexOf('stockEnabled === false')
  assert.ok(serviceCheck >= 0)
  assert.ok(falseOverride > serviceCheck)
  assert.match(businessType, /if \(stockEnabled === false\) return false\s+return true/)
})

test('service branch settings cannot select enabled stock', () => {
  assert.match(branches, /serviceTenant && option\.key === 'enabled'/)
  assert.match(branches, /disabled=\{disabled\}/)
})

test('branch stock selector exposes only explicit boolean choices', () => {
  assert.match(
    branches,
    /type StockModuleSetting = 'enabled' \| 'disabled'/,
  )
  assert.match(
    branches,
    /if \(value === false\) return 'disabled'\s+return 'enabled'/,
  )
  assert.match(
    branches,
    /\{ key: 'enabled' \}, \{ key: 'disabled' \}/,
  )
  assert.doesNotMatch(branches, /\{ key: 'default' \}/)
  assert.match(
    branches,
    /function stockModuleValue\(setting: StockModuleSetting\): boolean \{\s+return setting === 'enabled'/,
  )
  assert.match(
    branches,
    /stock_enabled:\s+resolveBusinessType\(tenantBusinessType\) === 'service'\s+\? false\s+:\s+branch\.stock_enabled \?\? true/,
  )
  assert.match(
    branches,
    /stock_enabled: resolveBusinessType\(tenantBusinessType\) === 'service' \? false : true/,
  )
  assert.match(
    branches,
    /p_stock_enabled: form\.stock_enabled/,
  )
})

test('POS hides stock display when disabled', () => {
  assert.match(pos, /isStockModuleVisible\(\{/)
  assert.match(pos, /stockVisible=\{stockVisible\}/)
  assert.match(pos, /\{stockVisible && <span>\{t\('availableStock'\)\}<\/span>\}/)
  assert.match(pos, /\{stockVisible && <div>/)
})

test('credit-note stock choice uses branch stock visibility', () => {
  assert.match(creditNote, /isStockModuleVisible\(\{/)
  assert.match(
    creditNote,
    /hasEligibleStockLines = !isServiceBusiness && stockEnabled && stockReturnQuantity > 0/,
  )
})

test('purchase receiving controls are disabled while stock is disabled', () => {
  assert.match(purchases, /<PurchaseHistoryTab stockEnabled=\{stockEnabled\}/)
  assert.match(purchaseHistory, /stockEnabled &&\s+isInEditWindow/)
  assert.match(purchaseHistory, /stockEnabled=\{stockEnabled\}/)
  assert.match(purchaseDrawer, /!stockEnabled && opt\.value === 'detailed_receiving'/)
})

for (const result of results) console.log(`ok - ${result}`)
console.log(`canonical branch stock-enabled tests passed (${results.length})`)
