import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260726000400_customer_intelligence_phase_a.sql')
const preflight = read('scripts/sql/customer-intelligence/01_preflight.sql')
const verification = read('scripts/sql/customer-intelligence/02_post_migration_verification.sql')
const runtime = read('scripts/sql/customer-intelligence/03_isolated_runtime_test.sql')
const api = read('src/lib/customers/customerIntelligence.ts')
const print = read('src/lib/customers/customerIntelligencePrint.ts')
const detail = read('src/pages/customers/CustomerDetailPage.tsx')
const reports = read('src/pages/reports/CustomerIntelligenceReportsPage.tsx')
const customers = read('src/pages/customers/CustomersPage.tsx')
const archiveEntity = read('src/lib/archiveEntity.ts')
const reportTab = read('src/pages/reports/CustomerReport.tsx')
const filters = read('src/components/customers/CustomerIntelligenceFilters.tsx')
const app = read('src/App.tsx')
const i18n = read('src/localization/i18n.ts')
const en = JSON.parse(read('src/localization/locales/en/customerIntelligence.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/customerIntelligence.json'))

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

const completedMetrics = documents => {
  const sales = documents.filter(document =>
    document.status === 'posted'
    && ['simplified', 'standard'].includes(document.type))
  const credits = documents.filter(document =>
    document.status === 'posted'
    && document.type === 'credit_note')
  const gross = sales.reduce((sum, document) => sum + document.storedTotal, 0)
  const credited = credits.reduce((sum, document) => sum + document.storedTotal, 0)
  return {
    gross,
    credited,
    net: gross - credited,
    invoiceCount: sales.length,
    creditCount: credits.length,
    average: sales.length ? gross / sales.length : 0,
  }
}

const flattenKeys = (value, prefix = '') => Object.entries(value).flatMap(([key, child]) => {
  const path = prefix ? `${prefix}.${key}` : key
  return child && typeof child === 'object' && !Array.isArray(child)
    ? flattenKeys(child, path)
    : [path]
})

test('migration is additive, transactional and preserves commercial data', () => {
  assert.match(migration, /^BEGIN;/)
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/)
  assert.match(migration, /SET LOCAL statement_timeout = '5min'/)
  assert.match(migration, /CUSTOMER_INTELLIGENCE_PRESERVATION_MISMATCH/)
  assert.match(migration, /customer_fingerprint/)
  assert.match(migration, /invoice_fingerprint/)
  assert.match(migration, /invoice_item_fingerprint/)
  assert.match(migration, /credit_note_fingerprint/)
  assert.match(migration, /COMMIT;\s*$/)
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+public\.(?:customers|invoices|invoice_items)\b/i)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:pos_checkout|create_partial_credit_note)/)
})

test('gross purchases use stored posted sales totals and exclude non-commercial states', () => {
  const metrics = completedMetrics([
    { status: 'posted', type: 'simplified', storedTotal: 115 },
    { status: 'posted', type: 'standard', storedTotal: 230 },
    { status: 'draft', type: 'simplified', storedTotal: 999 },
    { status: 'cancelled', type: 'standard', storedTotal: 999 },
    { status: 'posted', type: 'debit_note', storedTotal: 999 },
  ])
  assert.equal(metrics.gross, 345)
  assert.equal(metrics.invoiceCount, 2)
  assert.match(migration, /i\.status = 'posted'/)
  assert.match(migration, /i\.zatca_invoice_type IN \('simplified', 'standard', 'credit_note'\)/)
  assert.match(migration, /sum\(total_amount\)/)
})

test('credit notes remain separate and net purchases subtract them exactly once', () => {
  const metrics = completedMetrics([
    { status: 'posted', type: 'simplified', storedTotal: 500 },
    { status: 'posted', type: 'credit_note', storedTotal: 120 },
    { status: 'draft', type: 'credit_note', storedTotal: 90 },
  ])
  assert.deepEqual(metrics, {
    gross: 500,
    credited: 120,
    net: 380,
    invoiceCount: 1,
    creditCount: 1,
    average: 500,
  })
  assert.match(migration, /'netPurchases', totals\.gross - totals\.credited/)
  assert.doesNotMatch(migration, /zatca_(?:reporting|clearance)_response_evidence|outbox/)
})

test('average invoice is zero-safe and purchase frequency is transparent', () => {
  assert.equal(completedMetrics([]).average, 0)
  assert.match(migration, /WHEN totals\.invoice_count = 0 THEN 0/)
  assert.match(migration, /lag\(invoice_date\) OVER/)
  assert.match(migration, /averageDaysBetweenPurchases/)
  assert.match(detail, /notEnoughFrequency/)
})

test('last purchase and recent comparison use qualifying sales only', () => {
  assert.match(migration, /FROM sales s[\s\S]*ORDER BY s\.invoice_date DESC, s\.created_at DESC, s\.id DESC/)
  assert.match(migration, /v_today - 29 AND v_today/)
  assert.match(migration, /v_today - 59 AND v_today - 30/)
  assert.match(migration, /WHEN previous_gross = 0 THEN NULL/)
  assert.match(detail, /recent\.noComparable/)
})

test('date, branch, product and unit filters are shared by every detail surface', () => {
  for (const file of [migration, api, detail, filters]) {
    assert.match(file, /start_date|startDate/)
    assert.match(file, /end_date|endDate/)
    assert.match(file, /branch_id|branchId/)
    assert.match(file, /product_id|productId/)
    assert.match(file, /product_unit_id|productUnitId/)
  }
  assert.match(migration, /Date range must be valid and no longer than 10 years/)
})

test('Piece and Carton remain distinct immutable unit-snapshot groups', () => {
  assert.match(migration, /ii\.product_unit_id/)
  assert.match(migration, /ii\.selling_unit_name/)
  assert.match(migration, /ii\.selling_unit_name_ar/)
  assert.match(migration, /COALESCE\(sum\(COALESCE\(ii\.package_quantity, ii\.quantity, 0\)\)/)
  assert.match(detail, /product\.productUnitId/)
  assert.match(en.units.piece, /Piece/)
  assert.match(en.units.carton, /Carton/)
})

test('timeline granularity is deterministic and totals use the summary definitions', () => {
  assert.match(migration, /WHEN v_days <= 62 THEN 'day'/)
  assert.match(migration, /WHEN v_days <= 366 THEN 'week'/)
  assert.match(migration, /ELSE 'month'/)
  assert.match(migration, /'netPurchases', gross - credited/)
  assert.match(api, /timelineReconciles/)
  assert.match(detail, /accessibleSummary/)
})

test('top products are a bounded set without collapsing unit identities', () => {
  assert.match(migration, /LIMIT 12/)
  assert.match(migration, /GROUP BY[\s\S]*ii\.product_unit_id/)
  assert.match(migration, /count\(DISTINCT sales\.id\)/)
  assert.match(detail, /Top Products|products\.title/)
})

test('all reporting RPCs enforce the trusted role scope and validate foreign identifiers', () => {
  assert.equal((migration.match(/reporting_resolve_scope\(v_branch_id\)/g) ?? []).length, 3)
  assert.match(migration, /Customer not found in report scope/)
  assert.match(migration, /Product not found in report scope/)
  assert.match(migration, /Product unit not found in report scope/)
  assert.match(runtime, /owner scope and credit-note reconciliation/)
  assert.match(runtime, /branch-user scope/)
  assert.match(runtime, /cross-branch rejection/)
  assert.match(runtime, /cross-tenant rejection/)
})

test('public RPCs use hardened definer configuration and deterministic ACLs', () => {
  for (const functionName of [
    'get_customer_intelligence',
    'get_customer_intelligence_history',
    'list_customer_intelligence',
  ]) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${functionName}\\(p_payload jsonb\\)[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public, pg_temp[\\s\\S]*?SET row_security = off`))
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}\\(jsonb\\)[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role`))
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}\\(jsonb\\)[\\s\\S]*?TO authenticated`))
  }
  assert.doesNotMatch(migration, /GRANT (?:SELECT|ALL).*TABLE public\.(?:customers|invoices|invoice_items)/)
})

test('history uses stable bounded server pagination and actual invoice links', () => {
  assert.match(migration, /v_page_size > 100/)
  assert.match(migration, /ORDER BY i\.invoice_date DESC, i\.created_at DESC, i\.id DESC/)
  assert.match(migration, /LIMIT v_page_size[\s\S]*OFFSET \(v_page - 1\) \* v_page_size/)
  assert.match(detail, /to=\{`\/invoices\/\$\{row\.id\}`\}/)
  assert.match(detail, /credit_note/)
})

test('customer report list is server-paginated, filter-totalled and strictly sorted', () => {
  assert.match(migration, /v_page_size > 50/)
  assert.match(migration, /v_sort NOT IN/)
  assert.match(migration, /v_direction NOT IN \('asc', 'desc'\)/)
  assert.match(migration, /CASE WHEN v_sort = 'net_purchases'/)
  assert.match(migration, /id ASC/)
  assert.match(migration, /'totals', v_totals/)
  assert.match(reports, /loadCustomerReport/)
  assert.match(reports, /pageSize: PAGE_SIZE/)
  assert.match(reports, /searchInput/)
  assert.match(reports, /setTimeout/)
})

test('customer detail no longer loads all invoices or calculates financial authority in the browser', () => {
  assert.doesNotMatch(detail, /\.from\(['"]invoices['"]\)/)
  assert.doesNotMatch(detail, /\.reduce\(\(s, i\) => s \+ i\.total_amount/)
  assert.match(detail, /loadCustomerIntelligence/)
  assert.match(customers, /Financial metrics are intentionally not calculated/)
  assert.doesNotMatch(customers, /\.from\(['"]invoices['"]\)/)
})

test('existing customer editing and soft-deactivation workflow remain available', () => {
  assert.match(detail, /<CustomerModal/)
  assert.match(detail, /\.from\('customers'\)[\s\S]*?\.select\('\*'\)/)
  assert.match(customers, /archiveEntity\([^)]*'customers'/)
  assert.match(archiveEntity, /update\(\{ is_active: false \}\)/)
  assert.match(customers, /<CustomerModal/)
})

test('detail empty, error, loading and credit-only states are merchant friendly', () => {
  assert.match(detail, /aria-live="polite"/)
  assert.match(detail, /role="alert"/)
  assert.match(detail, /empty\.noPurchases/)
  assert.match(detail, /empty\.noActivity/)
  assert.match(detail, /empty\.onlyCredits/)
  assert.doesNotMatch(detail, /\{error\?\.message\}|\{loadError\}/)
})

test('customer insights are transparent and contain no opaque score', () => {
  assert.match(api, /buildCustomerInsights/)
  assert.match(api, /topProduct/)
  assert.match(api, /recentTrend/)
  assert.match(api, /frequency/)
  assert.match(api, /lastPurchase/)
  assert.doesNotMatch(api + detail + reports, /customerScore|riskScore|good customer|bad customer/i)
})

test('PDF report uses local fonts, safe escaping, page breaks and a bounded history', () => {
  assert.match(print, /NotoNaskhArabic-Regular\.ttf/)
  assert.match(print, /SaudiRiyal\.woff2/)
  assert.match(print, /escapeHtml/)
  assert.match(print, /CUSTOMER_REPORT_HISTORY_LIMIT = 100/)
  assert.match(print, /thead \{ display:table-header-group/)
  assert.match(print, /@media print/)
  assert.match(print, /overflow-wrap:anywhere/)
  assert.match(print, /window\.print\(\)/)
  assert.match(en.pdf.limitedHistory, /Summary totals cover the full filtered range/i)
  assert.match(en.pdf.disclaimer, /not an accounts-receivable statement/)
  assert.match(ar.pdf.disclaimer, /ليس كشف حساب/)
})

test('PDF input is the same server summary, filters, timeline and bounded history used on screen', () => {
  assert.match(detail, /loadCustomerHistory\([\s\S]*?CUSTOMER_REPORT_HISTORY_LIMIT/)
  assert.match(detail, /renderCustomerIntelligenceReport/)
  assert.match(detail, /filterLabels/)
  assert.match(print, /data\.summary\.grossPurchases/)
  assert.match(print, /data\.summary\.creditedAmount/)
  assert.match(print, /data\.timeline/)
  assert.match(print, /input\.history/)
})

test('report navigation preserves the selected date and branch range', () => {
  assert.match(detail, /reportQuery\.set\('branch'/)
  assert.match(reports, /customerQuery/)
  assert.match(reports, /to=\{`\/customers\/\$\{row\.customerId\}\?\$\{customerQuery\}`\}/)
  assert.match(app, /path="\/reports\/customers"/)
  assert.match(reportTab, /reports\/customers/)
})

test('filters and sortable report controls are keyboard and screen-reader accessible', () => {
  assert.match(filters, /<fieldset>/)
  assert.match(filters, /<legend className="sr-only">/)
  assert.match(filters, /aria-pressed/)
  assert.match(reports, /aria-label=\{t\(`customerIntelligence:reports/)
  assert.match(detail, /<table/)
  assert.match(detail, /scope="col"/)
  assert.match(detail, /aria-label=\{t\('customerIntelligence:history\.openDocument'/)
})

test('English and Arabic customer-intelligence localization have exact key parity', () => {
  assert.deepEqual(flattenKeys(en).sort(), flattenKeys(ar).sort())
  assert.match(i18n, /customerIntelligenceEn/)
  assert.match(i18n, /customerIntelligenceAr/)
  assert.match(i18n, /'customerIntelligence'/)
  assert.equal(en.title, 'Customer Intelligence')
  assert.equal(ar.title, 'ذكاء العملاء')
})

test('Riyal presentation and RTL-aware names are reused consistently', () => {
  assert.match(detail, /<Rial amount=/)
  assert.match(reports, /<Rial amount=/)
  assert.match(print, /SaudiRiyal/)
  assert.match(api, /customerDisplayName/)
  assert.match(filters, /isArabic/)
  assert.match(detail, /isRtl/)
})

test('preflight is read-only and covers conflicts, counts, fingerprints, grants, indexes and sessions', () => {
  assert.match(preflight, /^BEGIN TRANSACTION READ ONLY;/)
  assert.match(preflight, /required_columns/)
  assert.match(preflight, /detail_rpc_absent/)
  assert.match(preflight, /qualifying_sales_invoice_count/)
  assert.match(preflight, /qualifying_credit_note_count/)
  assert.match(preflight, /fingerprint/)
  assert.match(preflight, /role_table_grants/)
  assert.match(preflight, /pg_indexes/)
  assert.match(preflight, /pg_stat_activity/)
  assert.match(preflight, /pg_locks/)
  assert.match(preflight, /schema_migrations/)
  assert.match(preflight, /ROLLBACK;\s*$/)
})

test('post-migration verification is one strict consolidated Supabase-editor query', () => {
  assert.match(verification, /^BEGIN TRANSACTION READ ONLY;/)
  assert.match(verification, /check_name/)
  assert.match(verification, /observed_value/)
  assert.match(verification, /expected_value/)
  assert.match(verification, /'SUMMARY'/)
  assert.match(verification, /count\(\*\) FILTER \(WHERE result = 'FAIL'\) = 0/)
  assert.match(verification, /has_function_privilege/)
  assert.match(verification, /customer_intelligence_documents_scope_idx/)
  assert.match(verification, /preservation fingerprint/)
  assert.doesNotMatch(verification, /^\\/m)
  assert.doesNotMatch(verification, /\\set|\\gset/)
  assert.match(verification, /ROLLBACK;\s*$/)
})

test('isolated runtime SQL rolls back and covers scope, filters, validation and reconciliation', () => {
  assert.match(runtime, /^BEGIN;/)
  assert.match(runtime, /ON COMMIT DROP/)
  assert.match(runtime, /set_config\('request\.jwt\.claim\.sub'/)
  assert.match(runtime, /owner scope/)
  assert.match(runtime, /branch-user scope/)
  assert.match(runtime, /cross-branch rejection/)
  assert.match(runtime, /history pagination/)
  assert.match(runtime, /product and unit filtering/)
  assert.match(runtime, /zero-activity customer/)
  assert.match(runtime, /invalid page rejection/)
  assert.match(runtime, /invalid sort rejection/)
  assert.match(runtime, /invalid date rejection/)
  assert.match(runtime, /ROLLBACK;\s*$/)
})

test('new reporting index is focused and does not duplicate the existing branch-date index', () => {
  assert.match(migration, /CREATE INDEX customer_intelligence_documents_scope_idx/)
  assert.match(migration, /tenant_id,[\s\S]*branch_id,[\s\S]*customer_id,[\s\S]*invoice_date DESC/)
  assert.match(migration, /WHERE status = 'posted'[\s\S]*customer_id IS NOT NULL/)
  assert.match(migration, /COMMENT ON INDEX/)
})

test('optional spreadsheet export remains deferred with no new heavy dependency', () => {
  const packageJson = JSON.parse(read('package.json'))
  assert.equal(packageJson.dependencies.xlsx, undefined)
  assert.equal(packageJson.dependencies.exceljs, undefined)
  assert.doesNotMatch(detail + reports, /CSV|XLSX|spreadsheet/)
})

test('checkout, credit-note, ZATCA, product-unit and barcode production paths are not changed by Phase A files', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:pos_checkout|create_partial_credit_note|receive_product_stock)/)
  assert.doesNotMatch(migration, /ALTER TABLE public\.(?:products|product_units|product_unit_barcodes|pos_stock_movements)/)
  assert.doesNotMatch(api + detail + reports, /zatca-submit|checkout_simplified|stock_quantity|barcode/)
})

console.log(`customer intelligence checks passed: ${results.length}`)
for (const name of results) console.log(`  ✓ ${name}`)
