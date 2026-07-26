import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260726000500_supplier_intelligence_phase_b.sql')
const preflight = read('scripts/sql/supplier-intelligence/01_preflight.sql')
const verification = read('scripts/sql/supplier-intelligence/02_post_migration_verification.sql')
const runtime = read('scripts/sql/supplier-intelligence/03_isolated_runtime_test.sql')
const api = read('src/lib/suppliers/supplierIntelligence.ts')
const print = read('src/lib/suppliers/supplierIntelligencePrint.ts')
const detail = read('src/pages/suppliers/SupplierDetailPage.tsx')
const reports = read('src/pages/reports/SupplierIntelligenceReportsPage.tsx')
const filters = read('src/components/suppliers/SupplierIntelligenceFilters.tsx')
const suppliers = read('src/pages/suppliers/SuppliersPage.tsx')
const drawer = read('src/pages/suppliers/SupplierDrawer.tsx')
const purchaseDrawer = read('src/pages/inventory/PurchaseDrawer.tsx')
const app = read('src/App.tsx')
const i18n = read('src/localization/i18n.ts')
const en = JSON.parse(read('src/localization/locales/en/supplierIntelligence.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/supplierIntelligence.json'))

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

const isCounted = purchase => {
  const mode = purchase.mode ?? 'detailed_receiving'
  const status = purchase.status ?? 'posted'
  const receiving = purchase.receiving ?? 'not_applicable'
  if (status === 'cancelled' || ['cancelled', 'reversed'].includes(receiving)) return false
  if (['simple_bill', 'bill_only'].includes(mode)) return status === 'posted'
  return ['confirmed', 'confirmed_legacy'].includes(receiving)
    || (mode === 'detailed_receiving' && receiving === 'not_applicable' && status === 'posted')
}

const supplierMetrics = purchases => {
  const completed = purchases.filter(isCounted)
  const gross = completed.reduce((sum, purchase) => sum + purchase.storedTotal, 0)
  const orderedDates = completed.map(purchase => purchase.date).sort()
  const gaps = orderedDates.slice(1).map((date, index) => (
    (new Date(date) - new Date(orderedDates[index])) / 86_400_000
  ))
  return {
    gross,
    count: completed.length,
    average: completed.length ? gross / completed.length : 0,
    last: orderedDates.at(-1) ?? null,
    averageDays: gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null,
  }
}

const flattenKeys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
  const path = prefix ? `${prefix}.${key}` : key
  return child && typeof child === 'object' && !Array.isArray(child)
    ? flattenKeys(child, path)
    : [path]
})

test('migration is additive, transactional, and protects commercial rows', () => {
  assert.match(migration, /^BEGIN;/)
  assert.match(migration, /supplier_intelligence_preservation_baseline/)
  assert.match(migration, /supplier_fingerprint/)
  assert.match(migration, /purchase_fingerprint/)
  assert.match(migration, /purchase_item_fingerprint/)
  assert.match(migration, /stock_movement_fingerprint/)
  assert.match(migration, /COMMIT;\s*$/)
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+public\.(?:suppliers|purchases|purchase_items|purchase_stock_movements)\b/i)
})

test('draft, cancelled, reversed, and incomplete purchases are excluded', () => {
  const metrics = supplierMetrics([
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 100, date: '2026-01-01' },
    { mode: 'simple_bill', status: 'draft', receiving: 'not_applicable', storedTotal: 900, date: '2026-01-02' },
    { mode: 'detailed_receiving', status: 'draft', receiving: 'pending_confirmation', storedTotal: 900, date: '2026-01-03' },
    { mode: 'detailed_receiving', status: 'posted', receiving: 'cancelled', storedTotal: 900, date: '2026-01-04' },
    { mode: 'detailed_receiving', status: 'posted', receiving: 'reversed', storedTotal: 900, date: '2026-01-05' },
  ])
  assert.deepEqual(metrics, { gross: 100, count: 1, average: 100, last: '2026-01-01', averageDays: null })
  assert.match(migration, /reporting_counted_purchases_v/)
  assert.match(migration, /cp\.is_counted IS TRUE/)
})

test('completed purchase totals use stored document totals', () => {
  const metrics = supplierMetrics([
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 115, currentProductPrice: 999, date: '2026-01-01' },
    { mode: 'detailed_receiving', status: 'posted', receiving: 'confirmed', storedTotal: 230, currentProductPrice: 1, date: '2026-01-02' },
  ])
  assert.equal(metrics.gross, 345)
  assert.match(migration, /sum\(total_amount\)/)
  assert.doesNotMatch(migration, /products\.(?:price|cost).*gross|gross.*products\.(?:price|cost)/i)
})

test('purchase count uses qualifying documents only', () => {
  assert.equal(supplierMetrics([
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 1, date: '2026-01-01' },
    { mode: 'detailed_receiving', status: 'posted', receiving: 'confirmed', storedTotal: 1, date: '2026-01-02' },
    { mode: 'detailed_receiving', status: 'draft', receiving: 'pending_confirmation', storedTotal: 1, date: '2026-01-03' },
  ]).count, 2)
  assert.match(migration, /count\(\*\)::integer AS purchase_count/)
})

test('average purchase safely returns zero for no activity', () => {
  assert.equal(supplierMetrics([]).average, 0)
  assert.match(migration, /WHEN t\.purchase_count = 0 THEN 0/)
  assert.match(migration, /WHEN purchase_count = 0 THEN 0/)
})

test('last purchase uses qualifying documents and deterministic ordering', () => {
  assert.equal(supplierMetrics([
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 1, date: '2026-01-01' },
    { mode: 'detailed_receiving', status: 'posted', receiving: 'confirmed', storedTotal: 1, date: '2026-01-04' },
    { mode: 'detailed_receiving', status: 'cancelled', receiving: 'cancelled', storedTotal: 1, date: '2026-01-10' },
  ]).last, '2026-01-04')
  assert.match(migration, /ORDER BY d\.purchase_date DESC, d\.created_at DESC, d\.id DESC/)
})

test('frequency handles zero, one, and multiple purchases transparently', () => {
  assert.equal(supplierMetrics([]).averageDays, null)
  assert.equal(supplierMetrics([
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 1, date: '2026-01-01' },
  ]).averageDays, null)
  assert.equal(supplierMetrics([
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 1, date: '2026-01-01' },
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 1, date: '2026-01-05' },
    { mode: 'simple_bill', status: 'posted', receiving: 'not_applicable', storedTotal: 1, date: '2026-01-11' },
  ]).averageDays, 5)
  assert.match(migration, /lag\(purchase_date\) OVER/)
})

test('previous-period zero comparison is explicit', () => {
  assert.match(migration, /WHEN previous_gross = 0 THEN NULL/)
  assert.match(migration, /WHEN previous_count = 0 THEN NULL/)
  assert.match(detail, /recent\.noComparable/)
})

test('date filtering is server-authoritative and bounded', () => {
  assert.match(migration, /cp\.purchase_date BETWEEN v_start_date AND v_end_date/)
  assert.match(migration, /Date range must be valid and no longer than 10 years/)
  assert.match(runtime, /date filtering/)
})

test('product filtering is validated and shared across RPCs', () => {
  assert.equal((migration.match(/Product not found in report scope/g) ?? []).length, 3)
  assert.match(migration, /v_product_id IS NULL OR pi\.product_id = v_product_id/)
  assert.match(api, /product_id: filters\.productId/)
})

test('unit filtering is validated and cannot escape the selected product', () => {
  assert.equal((migration.match(/Product unit not found in report scope/g) ?? []).length, 3)
  assert.match(migration, /v_product_id IS NULL OR pu\.product_id = v_product_id/)
  assert.match(api, /product_unit_id: filters\.productUnitId/)
})

test('Piece and Carton identities and quantities remain separate', () => {
  assert.match(migration, /GROUP BY[\s\S]*product_unit_id/)
  assert.match(migration, /COALESCE\(pi\.package_quantity, pi\.quantity, 0\)/)
  assert.match(migration, /purchase_unit_name/)
  assert.match(detail, /product\.productUnitId/)
  assert.match(en.products.subtitle, /Piece and Carton/)
})

test('branch filtering is resolved inside the trusted scope helper', () => {
  assert.equal((migration.match(/reporting_resolve_scope\(v_branch_id\)/g) ?? []).length, 3)
  assert.match(filters, /canChooseBranch/)
  assert.match(filters, /allBranches/)
})

test('Owner scope follows tenant-wide reporting resolver behavior', () => {
  assert.match(runtime, /owner scope and totals reconciliation/)
  assert.match(migration, /v_scope\.tenant_scope/)
  assert.match(migration, /v_scope\.scope_tenant_id/)
})

test('Branch User scope is forced to the assigned branch', () => {
  assert.match(runtime, /branch-user scope/)
  assert.match(runtime, /row_value ->> 'branchId' <> v_branch_user\.branch_id::text/)
})

test('cross-branch requests are rejected', () => {
  assert.match(runtime, /cross-branch rejection/)
  assert.match(runtime, /Manipulated branch UUID was rejected/)
})

test('cross-tenant supplier identifiers are rejected', () => {
  assert.match(migration, /Supplier not found in report scope/)
  assert.match(runtime, /cross-tenant rejection/)
})

test('supplier and history lists are server paginated', () => {
  assert.match(migration, /LIMIT v_page_size[\s\S]*OFFSET \(v_page - 1\) \* v_page_size/)
  assert.match(api, /page_size: payload\.pageSize \?\? 25/)
  assert.match(reports, /pageSize: PAGE_SIZE/)
  assert.match(detail, /PAGE_SIZE = 20/)
})

test('server sorting is whitelisted and stable', () => {
  assert.match(migration, /v_sort NOT IN/)
  assert.match(migration, /v_direction NOT IN \('asc', 'desc'\)/)
  assert.match(migration, /id ASC/)
  assert.match(runtime, /stable sorting/)
})

test('page-size limits reject oversized requests', () => {
  assert.match(migration, /v_page_size > 50/)
  assert.match(migration, /v_page_size > 100/)
  assert.match(runtime, /invalid page rejection/)
})

test('top-product aggregation uses stored lines and distinct document counts', () => {
  assert.match(migration, /sum\(line_total\)::numeric AS gross_amount/)
  assert.match(migration, /count\(DISTINCT purchase_id\)::integer/)
  assert.match(migration, /average_unit_cost/)
  assert.match(migration, /LIMIT 10/)
})

test('timeline granularity is deterministic and reconciles with summary totals', () => {
  assert.match(migration, /WHEN v_days <= 62 THEN 'day'/)
  assert.match(migration, /WHEN v_days <= 730 THEN 'week'/)
  assert.match(migration, /ELSE 'month'/)
  assert.match(api, /timelineReconciles/)
  assert.match(runtime, /Timeline gross equals the full selected summary gross/)
})

test('history pagination is bounded and deterministically ordered', () => {
  assert.match(migration, /ORDER BY d\.purchase_date DESC, d\.created_at DESC, d\.id DESC/)
  assert.match(migration, /'totalPages'/)
  assert.match(runtime, /history pagination/)
})

test('zero-activity suppliers return zero gross and zero average', () => {
  assert.match(runtime, /zero-activity supplier/)
  assert.match(detail, /empty\.noActivity/)
  assert.match(reports, /reports\.noActivity/)
})

test('payment status is supported only as recorded informational data', () => {
  assert.match(migration, /v_payment_status NOT IN \('paid', 'partial', 'unpaid'\)/)
  assert.match(migration, /Payment status is informational/)
  assert.match(filters, /paymentStatus\.informational/)
  assert.match(detail, /notPayables/)
})

test('supplier returns are deliberately deferred instead of fabricated', () => {
  assert.match(migration, /supplier returns and payables are not represented/i)
  assert.match(preflight, /supplier return representation/)
  assert.match(en.returnsDeferred, /no authoritative supplier-return workflow/i)
  assert.doesNotMatch(api, /creditedAmount|returnedAmount|netPurchases/)
})

test('no formal payable, aging, balance, or opaque score is introduced', () => {
  assert.doesNotMatch(detail + reports + api, /Outstanding Balance|supplier aging|riskScore|supplierScore|good supplier|bad supplier/i)
  assert.match(en.notPayables, /not an accounts-payable balance/)
  assert.doesNotMatch(migration, /payment allocation|bank reconciliation|general ledger/i)
})

test('PDF view model includes summary, products, timeline, payment status, insights, and history', () => {
  assert.match(print, /data\.summary\.grossPurchases/)
  assert.match(print, /data\.topProducts/)
  assert.match(print, /data\.timeline/)
  assert.match(print, /data\.paymentStatusSummary/)
  assert.match(print, /input\.insights/)
  assert.match(print, /input\.history/)
})

test('PDF disclaimer rejects payable and ledger semantics', () => {
  assert.match(en.pdf.disclaimer, /not an accounts-payable statement/)
  assert.match(en.pdf.disclaimer, /supplier balance confirmation/)
  assert.match(en.pdf.disclaimer, /accounting ledger/)
  assert.match(ar.pdf.disclaimer, /ليس كشف حسابات دائنة/)
})

test('PDF supports Arabic wrapping, RTL, repeating headers, and bounded history', () => {
  assert.match(print, /lang="\$\{rtl \? 'ar' : 'en'\}"/)
  assert.match(print, /dir="\$\{rtl \? 'rtl' : 'ltr'\}"/)
  assert.match(print, /overflow-wrap:anywhere/)
  assert.match(print, /thead \{ display:table-header-group/)
  assert.match(print, /SUPPLIER_REPORT_HISTORY_LIMIT = 100/)
  assert.match(print, /escapeHtml/)
})

test('Saudi Riyal presentation reuses local project infrastructure', () => {
  assert.match(detail, /<Rial amount=/)
  assert.match(reports, /<Rial amount=/)
  assert.match(print, /SaudiRiyal\.woff2/)
  assert.match(print, /class="riyal"/)
})

test('existing supplier editing and deactivation remain unchanged', () => {
  assert.match(detail, /<SupplierDrawer/)
  assert.match(drawer, /\.from\('suppliers'\)\.update\(payload\)/)
  assert.match(suppliers, /update\(\{ is_active: false \}\)/)
})

test('existing receiving behavior is not replaced or called by intelligence', () => {
  assert.match(purchaseDrawer, /confirm_purchase_receiving|pending_confirmation/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.confirm_purchase_receiving/)
  assert.doesNotMatch(detail + reports + api, /confirm_purchase_receiving/)
})

test('existing stock mutation behavior is untouched', () => {
  assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|DELETE FROM) public\.purchase_stock_movements/i)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:receive_product_stock|cancel_purchase_receiving)/)
  assert.doesNotMatch(detail + reports + api, /stock_quantity/)
})

test('existing product-unit commercial workflow is untouched', () => {
  assert.doesNotMatch(migration, /ALTER TABLE public\.product_units/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:create_product_unit|update_product_unit|receive_product_stock_with_units_v1)/)
})

test('existing customer intelligence remains registered and untouched', () => {
  assert.match(app, /CustomerIntelligenceReportsPage/)
  assert.match(i18n, /customerIntelligenceEn/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:get_customer_intelligence|list_customer_intelligence)/)
})

test('barcode, checkout, invoice, and ZATCA workflows are outside the phase', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:pos_checkout|checkout_simplified|create_partial_credit_note)/)
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?:invoices|invoice_items|product_unit_barcodes|pos_stock_movements)/)
  assert.doesNotMatch(detail + reports + api, /zatca-submit|barcode|checkout_simplified/)
})

test('English and Arabic supplier-intelligence keys have exact parity', () => {
  assert.deepEqual(flattenKeys(en).sort(), flattenKeys(ar).sort())
  assert.match(i18n, /supplierIntelligenceEn/)
  assert.match(i18n, /supplierIntelligenceAr/)
  assert.match(i18n, /'supplierIntelligence'/)
})

test('preflight is read-only and produces one consolidated result with SUMMARY', () => {
  assert.match(preflight, /^BEGIN TRANSACTION READ ONLY;/)
  assert.match(preflight, /check_name/)
  assert.match(preflight, /observed_value/)
  assert.match(preflight, /expected_value/)
  assert.match(preflight, /'SUMMARY'/)
  assert.match(preflight, /fingerprint/)
  assert.match(preflight, /pg_stat_activity/)
  assert.match(preflight, /pg_locks/)
  assert.match(preflight, /ROLLBACK;\s*$/)
})

test('post-migration verification checks exact RPC contracts, ACLs, RLS, index, and migration history', () => {
  assert.match(verification, /^BEGIN TRANSACTION READ ONLY;/)
  assert.match(verification, /get_supplier_intelligence\(jsonb\)/)
  assert.match(verification, /search_path=public, pg_temp/)
  assert.match(verification, /row_security=off/)
  assert.match(verification, /has_function_privilege/)
  assert.match(verification, /supplier_intelligence_documents_scope_idx/)
  assert.match(verification, /base reporting tables keep RLS enabled/)
  assert.match(verification, /version = '20260726000500'/)
  assert.match(verification, /'SUMMARY'/)
  assert.match(verification, /ROLLBACK;\s*$/)
})

test('isolated runtime test covers scope, filters, validation, reconciliation, and rollback', () => {
  assert.match(runtime, /^BEGIN;/)
  assert.match(runtime, /ON COMMIT DROP/)
  assert.match(runtime, /owner scope/)
  assert.match(runtime, /branch-user scope/)
  assert.match(runtime, /cross-branch rejection/)
  assert.match(runtime, /cross-tenant rejection/)
  assert.match(runtime, /product and unit filtering/)
  assert.match(runtime, /history pagination/)
  assert.match(runtime, /invalid sort rejection/)
  assert.match(runtime, /invalid date rejection/)
  assert.match(runtime, /ROLLBACK;\s*$/)
})

test('detail and dedicated report routes preserve filter context', () => {
  assert.match(app, /path="\/suppliers\/:id"/)
  assert.match(app, /path="\/reports\/suppliers"/)
  assert.match(reports, /detailQuery/)
  assert.match(reports, /`\/suppliers\/\$\{row\.supplierId\}\?\$\{detailQuery\}`/)
  assert.match(detail, /setSearchParams/)
})

test('accessibility covers labelled filters, live states, tables, sorting, and mobile cards', () => {
  assert.match(filters, /<fieldset>/)
  assert.match(filters, /<legend className="sr-only">/)
  assert.match(filters, /aria-pressed/)
  assert.match(detail, /aria-live="polite"/)
  assert.match(detail, /scope="col"/)
  assert.match(reports, /sortAnnouncement/)
  assert.match(reports, /lg:hidden/)
})

test('optional spreadsheet export remains deferred with no heavy dependency', () => {
  const packageJson = JSON.parse(read('package.json'))
  assert.equal(packageJson.dependencies.xlsx, undefined)
  assert.equal(packageJson.dependencies.exceljs, undefined)
  assert.doesNotMatch(detail + reports, /Export CSV|Export XLSX/)
})

test('the reporting index is focused and avoids duplicate purchase-item indexes', () => {
  assert.match(migration, /CREATE INDEX supplier_intelligence_documents_scope_idx/)
  assert.match(migration, /tenant_id,[\s\S]*branch_id,[\s\S]*supplier_id,[\s\S]*purchase_date DESC/)
  assert.match(migration, /WHERE supplier_id IS NOT NULL/)
  assert.equal((migration.match(/CREATE INDEX/g) ?? []).length, 1)
  assert.doesNotMatch(migration, /CREATE INDEX .*purchase_items/)
})

console.log(`supplier intelligence checks passed: ${results.length}`)
for (const name of results) console.log(`  ✓ ${name}`)
