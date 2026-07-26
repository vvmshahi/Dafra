import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260725000600_product_units_phase1_foundation.sql')
const baseline = read('supabase/migrations/20260721000100_dafra_current_schema_and_security.sql')

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

const lifecycleUpdate = (before, requested) => {
  const after = { ...before, ...requested }
  if (
    after.productId !== before.productId
    || after.tenantId !== before.tenantId
    || after.branchId !== before.branchId
  ) throw new Error('scope')
  if (after.isBase !== before.isBase) throw new Error('base_relationship')
  if (before.isBase && !after.isActive) throw new Error('base_inactive')
  if (before.firstUsedAt && after.conversion !== before.conversion) throw new Error('used_conversion')

  const commercialKeys = [
    'name', 'nameAr', 'unitCode', 'conversion', 'quantityScale',
    'pricingMethod', 'customPrice', 'sellingEnabled', 'receivingEnabled',
    'isActive', 'sortOrder',
  ]
  const changed = commercialKeys.some(key => after[key] !== before[key])
  if (changed && after.version !== before.version + 1) throw new Error('version')
  return after
}

test('migration is a single transactional additive package', () => {
  assert.match(migration, /^BEGIN;/)
  assert.match(migration, /COMMIT;\s*$/)
  assert.match(migration, /CREATE TABLE public\.product_units/)
  assert.doesNotMatch(migration, /IF NOT EXISTS/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.pos_checkout/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.create_partial_credit_note/)
  assert.doesNotMatch(migration, /zatca-submit|EmbeddedDocumentBinaryObject|InvoiceLine/)
})

test('product_units has the production Phase 1 columns and compatible types', () => {
  const required = [
    /id uuid PRIMARY KEY DEFAULT pg_catalog\.gen_random_uuid\(\)/,
    /tenant_id uuid NOT NULL/,
    /branch_id uuid NOT NULL/,
    /product_id uuid NOT NULL/,
    /name varchar\(80\) NOT NULL/,
    /name_ar varchar\(80\)/,
    /unit_code varchar\(8\) NOT NULL/,
    /conversion_to_base numeric\(18, 6\) NOT NULL/,
    /quantity_scale smallint NOT NULL DEFAULT 3/,
    /pricing_method text NOT NULL DEFAULT 'calculated'/,
    /custom_selling_price numeric\(14, 2\)/,
    /selling_enabled boolean NOT NULL DEFAULT true/,
    /receiving_enabled boolean NOT NULL DEFAULT true/,
    /is_base boolean NOT NULL DEFAULT false/,
    /is_active boolean NOT NULL DEFAULT true/,
    /sort_order integer NOT NULL DEFAULT 0/,
    /version integer NOT NULL DEFAULT 1/,
    /first_used_at timestamptz/,
    /created_by uuid/,
    /updated_by uuid/,
    /created_at timestamptz NOT NULL DEFAULT now\(\)/,
    /updated_at timestamptz NOT NULL DEFAULT now\(\)/,
  ]
  for (const pattern of required) assert.match(migration, pattern)
})

test('scope and commercial constraints are database enforced', () => {
  assert.match(
    migration,
    /FOREIGN KEY \(product_id, tenant_id, branch_id\)[\s\S]*?REFERENCES public\.products \(id, tenant_id, branch_id\)/,
  )
  assert.match(migration, /product_units_conversion_positive[\s\S]*?conversion_to_base > 0/)
  assert.match(migration, /product_units_quantity_scale_range[\s\S]*?quantity_scale BETWEEN 0 AND 6/)
  assert.match(migration, /pricing_method IN \('calculated', 'custom'\)/)
  assert.match(migration, /pricing_method = 'custom' AND custom_selling_price IS NOT NULL/)
  assert.match(migration, /custom_selling_price IS NULL OR custom_selling_price >= 0/)
  assert.match(
    migration,
    /is_base IS FALSE[\s\S]*?conversion_to_base = 1[\s\S]*?pricing_method = 'calculated'[\s\S]*?is_active IS TRUE/,
  )
  assert.match(migration, /sort_order >= 0/)
  assert.match(migration, /version > 0/)
})

test('exactly one durable base unit is guaranteed for existing and future products', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX product_units_one_base_per_product_idx[\s\S]*?WHERE is_base;/,
  )
  assert.match(
    migration,
    /CREATE TRIGGER trg_products_ensure_base_unit[\s\S]*?AFTER INSERT ON public\.products/,
  )
  assert.match(
    migration,
    /RAISE EXCEPTION 'A product base unit cannot be deleted'/,
  )
  assert.match(
    migration,
    /RAISE EXCEPTION 'A product base unit cannot be deactivated'/,
  )
  assert.match(
    migration,
    /WHERE NOT EXISTS \([\s\S]*?pu\.product_id = p\.id[\s\S]*?pu\.is_base IS TRUE[\s\S]*?\)[\s\S]*?ON CONFLICT \(product_id\) WHERE is_base[\s\S]*?DO NOTHING;/,
  )
})

test('base-unit backfill preserves product balances and historical documents', () => {
  const backfillStart = migration.indexOf('-- Existing products receive exactly one compatibility base row')
  const getRpcStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.get_product_units')
  const backfill = migration.slice(backfillStart, getRpcStart)
  assert.match(backfill, /COALESCE\(NULLIF\(btrim\(p\.unit\), ''\), 'Piece'\)/)
  assert.match(backfill, /'PCE',\s+1,\s+3,\s+'calculated'/)
  assert.match(backfill, /COALESCE\(p\.is_service, false\) IS FALSE,\s+true,\s+true,/)
  assert.doesNotMatch(backfill, /UPDATE public\.products/)
  assert.doesNotMatch(backfill, /UPDATE public\.invoice_items/)
  assert.doesNotMatch(backfill, /UPDATE public\.(?:pos_stock_movements|product_stock_receipts|purchase_items|purchase_stock_movements)/)
  assert.doesNotMatch(backfill, /stock_quantity\s*=/)
  assert.doesNotMatch(backfill, /price\s*=/)
  assert.doesNotMatch(backfill, /track_stock\s*=/)
})

test('active package names are unique while package unit codes may be shared', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX product_units_id_product_id_uidx[\s\S]*?\(id, product_id\)/,
  )
  assert.match(
    migration,
    /product_units_active_name_per_product_idx[\s\S]*?\(product_id, lower\(btrim\(name\)\)\)[\s\S]*?WHERE is_active/,
  )
  assert.match(migration, /Different package sizes may legitimately share one UBL unit code/)
  assert.doesNotMatch(migration, /UNIQUE[^(]*\([^)]*unit_code/)
})

test('authenticated access is scoped read-only and mutations are RPC-owned', () => {
  const privilegeStart = migration.indexOf('REVOKE ALL ON TABLE public.product_units')
  const privilegeEnd = migration.indexOf('REVOKE ALL ON FUNCTION public.get_product_units')
  const tablePrivileges = migration.slice(privilegeStart, privilegeEnd)
  assert.match(migration, /ALTER TABLE public\.product_units ENABLE ROW LEVEL SECURITY/)
  assert.match(
    migration,
    /CREATE POLICY product_units_authenticated_select[\s\S]*?TO authenticated[\s\S]*?rls_can_access_branch\(tenant_id, branch_id\)/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.product_units[\s\S]*?FROM PUBLIC, anon, authenticated/,
  )
  assert.match(migration, /GRANT SELECT ON TABLE public\.product_units[\s\S]*?TO authenticated/)
  assert.doesNotMatch(
    tablePrivileges,
    /GRANT (?:INSERT|UPDATE|DELETE|ALL(?: PRIVILEGES)?) ON TABLE public\.product_units\s+TO authenticated/,
  )
  assert.match(baseline, /Caller profile not found or inactive/)
})

test('management RPCs derive scope from the product and preserve service restrictions', () => {
  for (const signature of [
    /FUNCTION public\.get_product_units\(/,
    /FUNCTION public\.create_product_unit\(/,
    /FUNCTION public\.update_product_unit\(/,
    /FUNCTION public\.deactivate_product_unit\(/,
    /FUNCTION public\.reactivate_product_unit\(/,
  ]) assert.match(migration, signature)

  assert.match(migration, /FROM public\.assert_product_write_access\(v_product\.branch_id\)/)
  assert.match(migration, /Product belongs to another branch/)
  assert.match(migration, /Product unit belongs to another branch/)
  assert.match(migration, /Product packages are not available for service products/)
  assert.doesNotMatch(
    migration,
    /jsonb_object_keys\(p_payload\)[\s\S]{0,500}'tenant_id'|'branch_id'/,
  )
  assert.match(migration, /FOR UPDATE OF p/)
  assert.match(migration, /FROM public\.product_units[\s\S]*?FOR UPDATE/)
})

test('lifecycle guard permits future price changes but freezes used conversions', () => {
  const unused = {
    productId: 'p1',
    tenantId: 't1',
    branchId: 'b1',
    isBase: false,
    firstUsedAt: null,
    name: 'Carton',
    nameAr: null,
    unitCode: 'CT',
    conversion: 24,
    quantityScale: 3,
    pricingMethod: 'custom',
    customPrice: 220,
    sellingEnabled: true,
    receivingEnabled: true,
    isActive: true,
    sortOrder: 1,
    version: 1,
  }
  assert.equal(lifecycleUpdate(unused, { conversion: 30, version: 2 }).conversion, 30)

  const used = { ...unused, firstUsedAt: '2026-07-25T00:00:00Z' }
  assert.throws(() => lifecycleUpdate(used, { conversion: 30, version: 2 }), /used_conversion/)
  assert.equal(lifecycleUpdate(used, { customPrice: 210, version: 2 }).customPrice, 210)
  assert.equal(lifecycleUpdate(used, { isActive: false, version: 2 }).isActive, false)
  assert.throws(() => lifecycleUpdate(used, { customPrice: 210, version: 1 }), /version/)

  assert.match(migration, /A used product unit conversion cannot be changed; create a new unit/)
  assert.match(migration, /A used product unit cannot be deleted; deactivate it instead/)
  assert.match(migration, /Product unit version must increase by one/)

  const base = {
    ...unused,
    isBase: true,
    conversion: 1,
    pricingMethod: 'calculated',
    customPrice: null,
  }
  assert.throws(() => lifecycleUpdate(base, { isActive: false, version: 2 }), /base_inactive/)
})

test('first-use marker is private and Phase 1 does not mark any unit used', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_product_unit_used/)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.mark_product_unit_used\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated/,
  )
  const calls = migration.match(/mark_product_unit_used\s*\(/g) ?? []
  assert.equal(calls.length, 3)
  assert.doesNotMatch(migration, /first_used_at\s*=\s*now\(\)[\s\S]*?FROM public\.products/)
})

test('owners and application-role grants are explicit and deterministic', () => {
  assert.match(migration, /ALTER TABLE public\.product_units OWNER TO postgres/)
  for (const signature of [
    'product_unit_lifecycle_guard\\(\\)',
    'ensure_product_base_unit\\(\\)',
    'get_product_units\\(uuid\\)',
    'create_product_unit\\(jsonb\\)',
    'update_product_unit\\(jsonb\\)',
    'deactivate_product_unit\\(uuid, integer\\)',
    'reactivate_product_unit\\(uuid, integer\\)',
    'mark_product_unit_used\\(uuid\\)',
  ]) {
    assert.match(migration, new RegExp(`ALTER FUNCTION public\\.${signature} OWNER TO postgres`))
  }
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.product_units[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;[\s\S]*?GRANT SELECT[\s\S]*?TO authenticated;[\s\S]*?GRANT ALL PRIVILEGES[\s\S]*?TO service_role;/,
  )
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.mark_product_unit_used\(uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
  )
})

test('snapshot columns are additive, nullable, and historical rows are not backfilled', () => {
  for (const table of [
    'invoice_items',
    'product_stock_receipts',
    'pos_stock_movements',
    'purchase_items',
    'purchase_stock_movements',
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table}`))
  }
  assert.match(
    migration,
    /invoice_items[\s\S]*?product_unit_id uuid[\s\S]*?package_quantity numeric\(18, 6\)[\s\S]*?package_quantity_scale smallint[\s\S]*?base_quantity numeric\(18, 6\)[\s\S]*?base_quantity_scale smallint[\s\S]*?stock_tracked_at_sale boolean[\s\S]*?service_item_at_sale boolean/,
  )
  assert.match(migration, /product_stock_receipts[\s\S]*?package_unit_cost numeric\(14, 2\)[\s\S]*?base_unit_cost numeric\(18, 6\)/)
  assert.match(migration, /purchase_items[\s\S]*?stock_target_type text[\s\S]*?product_id uuid/)
  for (const table of [
    'invoice_items',
    'product_stock_receipts',
    'pos_stock_movements',
    'purchase_items',
    'purchase_stock_movements',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `ALTER TABLE public\\.${table}[\\s\\S]*?`
        + `FOREIGN KEY \\(product_unit_id, product_id\\)[\\s\\S]*?`
        + 'REFERENCES public\\.product_units\\(id, product_id\\)',
      ),
    )
  }
  for (const table of [
    'invoice_items',
    'pos_stock_movements',
    'purchase_items',
    'purchase_stock_movements',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `${table}_product_unit_requires_product[\\s\\S]*?`
        + 'product_unit_id IS NULL OR product_id IS NOT NULL',
      ),
    )
  }

  const snapshotStart = migration.indexOf('-- Package-ready document snapshots')
  const snapshots = migration.slice(snapshotStart)
  assert.doesNotMatch(snapshots, /UPDATE public\./)
  assert.doesNotMatch(snapshots, /ADD COLUMN[^,;\n]*NOT NULL/)
})

test('legacy purchase inserts cannot populate Phase 1 snapshot fields', () => {
  const grantStart = migration.indexOf('-- purchase_items has a legacy authenticated table-level INSERT grant')
  const commentStart = migration.indexOf('COMMENT ON COLUMN public.invoice_items.product_unit_id')
  const privileges = migration.slice(grantStart, commentStart)
  assert.match(
    privileges,
    /REVOKE INSERT ON TABLE public\.purchase_items\s+FROM PUBLIC, anon, authenticated;/,
  )
  assert.match(privileges, /GRANT INSERT \([\s\S]*?\) ON public\.purchase_items TO authenticated;/)
  for (const legacyColumn of [
    'purchase_id',
    'inventory_item_id',
    'name',
    'quantity',
    'unit_cost',
    'total',
    'supplier_item_name',
    'line_type',
    'receiving_status',
    'received_quantity',
    'match_source',
  ]) {
    assert.match(privileges, new RegExp(`\\b${legacyColumn}\\b`))
  }
  for (const snapshotColumn of [
    'stock_target_type',
    'product_id',
    'product_unit_id',
    'product_unit_version',
    'package_quantity',
    'conversion_to_base',
    'base_quantity',
  ]) {
    assert.doesNotMatch(privileges, new RegExp(`\\b${snapshotColumn}\\b`))
  }
})

test('existing commercial contracts remain unchanged', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.pos_checkout/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.create_partial_credit_note/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.get_invoice_refundable_items/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.receive_product_stock/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.confirm_purchase_receiving/)
  assert.doesNotMatch(migration, /UPDATE public\.invoices|UPDATE public\.invoice_items/)
})

test('stable product-unit UUID supports a future separate identifier table', () => {
  assert.match(migration, /id uuid PRIMARY KEY DEFAULT pg_catalog\.gen_random_uuid\(\)/)
  assert.doesNotMatch(migration, /barcode|qr_code|identifier_value|label_print/i)
})

for (const result of results) console.log(`ok - ${result}`)
console.log(`Product units Phase 1 tests passed (${results.length})`)
