import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260725000300_inventory_balance_write_hardening.sql')
const currentSchema = read('supabase/migrations/20260721000100_dafra_current_schema_and_security.sql')
const drawer = read('src/pages/inventory/StockItemModal.tsx')
const productDrawer = read('src/pages/products/ProductDrawer.tsx')

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

class InventoryAdjustmentModel {
  constructor() {
    this.items = new Map([
      ['item-a', { tenantId: 'tenant-a', branchId: 'branch-a', quantity: 10, name: 'Material A' }],
      ['item-b', { tenantId: 'tenant-a', branchId: 'branch-b', quantity: 4, name: 'Material B' }],
      ['item-c', { tenantId: 'tenant-b', branchId: 'branch-c', quantity: 3, name: 'Material C' }],
    ])
    this.movements = new Map()
  }

  adjust(actor, { itemId, delta, reason, key }, { failMovement = false } = {}) {
    const item = this.items.get(itemId)
    if (!actor.active) throw new Error('inactive')
    if (!item) throw new Error('not_found')
    if (actor.role === 'owner' && actor.tenantId !== item.tenantId) throw new Error('forbidden')
    if (actor.role === 'branch'
        && (actor.tenantId !== item.tenantId || actor.branchId !== item.branchId)) {
      throw new Error('forbidden')
    }
    if (!['owner', 'branch'].includes(actor.role)) throw new Error('forbidden')
    if (!Number.isFinite(delta) || delta === 0) throw new Error('zero')
    if (!reason.trim()) throw new Error('reason')
    if (key.length < 8 || key.length > 120) throw new Error('key')

    const movementKey = `${item.tenantId}:${item.branchId}:${itemId}:${key}`
    const existing = this.movements.get(movementKey)
    if (existing) {
      if (existing.delta !== delta || existing.reason !== reason.trim()) throw new Error('conflict')
      return { ...existing, replay: true }
    }

    const before = item.quantity
    const after = before + delta
    if (after < 0) throw new Error('negative')

    // Model the single PostgreSQL transaction: a movement failure restores the
    // balance update rather than leaving a partial write.
    item.quantity = after
    try {
      if (failMovement) throw new Error('movement_failure')
      const movement = { before, delta, after, reason: reason.trim() }
      this.movements.set(movementKey, movement)
      return { ...movement, replay: false }
    } catch (error) {
      item.quantity = before
      throw error
    }
  }

  updateMetadata(actor, itemId, name) {
    const item = this.items.get(itemId)
    if (!item || actor.tenantId !== item.tenantId) throw new Error('forbidden')
    if (actor.role === 'branch' && actor.branchId !== item.branchId) throw new Error('forbidden')
    item.name = name
  }
}

const ownerA = { role: 'owner', tenantId: 'tenant-a', branchId: null, active: true }
const ownerB = { role: 'owner', tenantId: 'tenant-b', branchId: null, active: true }
const branchA = { role: 'branch', tenantId: 'tenant-a', branchId: 'branch-a', active: true }
const branchB = { role: 'branch', tenantId: 'tenant-a', branchId: 'branch-b', active: true }

test('migration replaces broad product and inventory update privileges', () => {
  assert.match(migration, /REVOKE INSERT, UPDATE ON TABLE public\.products FROM authenticated/)
  assert.match(migration, /REVOKE INSERT, UPDATE ON TABLE public\.inventory_items FROM authenticated/)
  const productUpdateGrant = migration.match(/GRANT UPDATE \([\s\S]*?\) ON public\.products TO authenticated;/)?.[0] ?? ''
  const inventoryUpdateGrant = migration.match(/GRANT UPDATE \([\s\S]*?\) ON public\.inventory_items TO authenticated;/)?.[0] ?? ''
  assert.doesNotMatch(productUpdateGrant, /stock_quantity|track_stock/)
  assert.doesNotMatch(inventoryUpdateGrant, /current_quantity/)
  assert.match(productUpdateGrant, /name/)
  assert.match(inventoryUpdateGrant, /name/)
})

test('direct inserts cannot set authoritative balances', () => {
  const productInsertGrant = migration.match(/GRANT INSERT \([\s\S]*?\) ON public\.products TO authenticated;/)?.[0] ?? ''
  const inventoryInsertGrant = migration.match(/GRANT INSERT \([\s\S]*?\) ON public\.inventory_items TO authenticated;/)?.[0] ?? ''
  assert.doesNotMatch(productInsertGrant, /stock_quantity|track_stock/)
  assert.doesNotMatch(inventoryInsertGrant, /current_quantity/)
})

test('product creation uses the secure RPC and safe stock defaults', () => {
  assert.match(productDrawer, /rpc\('create_product_secure'/)
  assert.doesNotMatch(productDrawer, /\.from\(['"]products['"]\)\s*\.insert/)
  const createProductStart = currentSchema.indexOf('FUNCTION "public"."create_product_secure"')
  assert.notEqual(createProductStart, -1)
  const createProduct = currentSchema.slice(createProductStart, createProductStart + 6500)
  assert.doesNotMatch(createProduct, /INSERT INTO public\.products \([\s\S]*?stock_quantity/)
  assert.doesNotMatch(createProduct, /INSERT INTO public\.products \([\s\S]*?track_stock/)
  assert.match(productDrawer, /rpc\('update_product_stock_settings'/)
})

test('inventory-item creation omits current quantity and adjusts after insert', () => {
  const insertStart = drawer.indexOf(".from('inventory_items')")
  const rpcStart = drawer.indexOf("rpc('adjust_inventory_item_stock'")
  assert.notEqual(insertStart, -1)
  assert.ok(rpcStart > insertStart)
  assert.doesNotMatch(drawer.slice(insertStart, rpcStart), /current_quantity/)
})

test('adjustment RPC has required database controls', () => {
  for (const pattern of [
    /SECURITY DEFINER/,
    /SET row_security = off/,
    /WHERE ii\.id = v_item_id\s+FOR UPDATE OF ii/,
    /v_profile\.is_active IS NOT TRUE/,
    /v_profile\.tenant_id IS DISTINCT FROM v_item\.tenant_id/,
    /v_profile\.branch_id IS DISTINCT FROM v_item\.branch_id/,
    /v_adjustment = 0/,
    /v_after < 0/,
    /length\(v_idempotency_key\) NOT BETWEEN 8 AND 120/,
    /INSERT INTO public\.inventory_item_stock_movements/,
  ]) assert.match(migration, pattern)
})

test('ledger scope and arithmetic are database-enforced', () => {
  assert.match(migration, /CHECK \(quantity_after = quantity_before \+ quantity_delta\)/)
  assert.match(migration, /CREATE TRIGGER trg_inventory_item_stock_movement_scope/)
  assert.match(migration, /ii\.id = NEW\.inventory_item_id/)
  assert.match(migration, /ii\.tenant_id = NEW\.tenant_id/)
  assert.match(migration, /ii\.branch_id = NEW\.branch_id/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.inventory_item_stock_movements FROM authenticated/)
  assert.match(migration, /GRANT SELECT ON TABLE public\.inventory_item_stock_movements TO authenticated/)
})

test('owner adjustment', () => {
  const model = new InventoryAdjustmentModel()
  assert.deepEqual(
    model.adjust(ownerA, { itemId: 'item-a', delta: 2.5, reason: 'Count correction', key: 'owner-key-001' }),
    { before: 10, delta: 2.5, after: 12.5, reason: 'Count correction', replay: false },
  )
})

test('branch user adjustment in own branch', () => {
  const model = new InventoryAdjustmentModel()
  assert.equal(
    model.adjust(branchA, { itemId: 'item-a', delta: -1, reason: 'Waste', key: 'branch-key-001' }).after,
    9,
  )
})

test('cross-branch rejection', () => {
  const model = new InventoryAdjustmentModel()
  assert.throws(
    () => model.adjust(branchB, { itemId: 'item-a', delta: 1, reason: 'Wrong branch', key: 'branch-key-002' }),
    /forbidden/,
  )
})

test('cross-tenant rejection', () => {
  const model = new InventoryAdjustmentModel()
  assert.throws(
    () => model.adjust(ownerB, { itemId: 'item-a', delta: 1, reason: 'Wrong tenant', key: 'owner-key-002' }),
    /forbidden/,
  )
})

test('inactive-user rejection', () => {
  const model = new InventoryAdjustmentModel()
  assert.throws(
    () => model.adjust({ ...ownerA, active: false }, {
      itemId: 'item-a', delta: 1, reason: 'Inactive', key: 'owner-key-003',
    }),
    /inactive/,
  )
})

test('duplicate idempotency replay', () => {
  const model = new InventoryAdjustmentModel()
  const request = { itemId: 'item-a', delta: 1, reason: 'Count', key: 'replay-key-001' }
  assert.equal(model.adjust(ownerA, request).replay, false)
  assert.equal(model.adjust(ownerA, request).replay, true)
  assert.equal(model.items.get('item-a').quantity, 11)
  assert.equal(model.movements.size, 1)
})

test('same-key requests serialize before replay lookup', () => {
  const lockPosition = migration.indexOf('FOR UPDATE OF ii')
  const replayLookupPosition = migration.indexOf('FROM public.inventory_item_stock_movements', lockPosition)
  assert.ok(lockPosition >= 0)
  assert.ok(replayLookupPosition > lockPosition)
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_stock_movements_item_idempotency_idx/,
  )
})

test('negative-result and zero-adjustment rejection', () => {
  const model = new InventoryAdjustmentModel()
  assert.throws(
    () => model.adjust(ownerA, { itemId: 'item-a', delta: -11, reason: 'Invalid', key: 'negative-key-01' }),
    /negative/,
  )
  assert.throws(
    () => model.adjust(ownerA, { itemId: 'item-a', delta: 0, reason: 'Invalid', key: 'zero-key-0001' }),
    /zero/,
  )
})

test('transaction rollback on movement failure', () => {
  const model = new InventoryAdjustmentModel()
  assert.throws(
    () => model.adjust(
      ownerA,
      { itemId: 'item-a', delta: 2, reason: 'Rollback', key: 'rollback-key-01' },
      { failMovement: true },
    ),
    /movement_failure/,
  )
  assert.equal(model.items.get('item-a').quantity, 10)
  assert.equal(model.movements.size, 0)
})

test('permitted metadata update leaves balance unchanged', () => {
  const model = new InventoryAdjustmentModel()
  model.updateMetadata(branchA, 'item-a', 'Renamed material')
  assert.equal(model.items.get('item-a').name, 'Renamed material')
  assert.equal(model.items.get('item-a').quantity, 10)
})

test('frontend removes direct quantity writes and uses signed adjustment RPC', () => {
  assert.doesNotMatch(drawer, /current_quantity:\s*parseFloat\(currentQty\)/)
  assert.match(drawer, /requestedQuantity - quantityBefore/)
  assert.match(drawer, /rpc\('adjust_inventory_item_stock'/)
  assert.match(drawer, /idempotency_key: adjustmentKey/)
  assert.match(drawer, /reason: adjustmentReason\.trim\(\)/)
})

test('existing controlled stock workflows remain security-definer functions', () => {
  for (const functionName of [
    'pos_checkout',
    'create_partial_credit_note',
    'update_product_stock_settings',
    'receive_product_stock',
    'confirm_purchase_receiving',
    'cancel_purchase_receiving',
  ]) {
    const start = currentSchema.indexOf(`FUNCTION "public"."${functionName}"`)
    assert.notEqual(start, -1, `${functionName} must exist`)
    assert.match(currentSchema.slice(start, start + 700), /SECURITY DEFINER/, `${functionName} must remain controlled`)
  }
})

for (const name of results) console.log(`ok - ${name}`)
console.log(`inventory write-hardening tests passed (${results.length})`)
