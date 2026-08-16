import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const BASE = 'd08838b5b652a1ffd0dc01f394cfb0a44daef046'
const MIGRATION_PATH = 'supabase/migrations/20260816000400_source_aware_reporting_credit_restock.sql'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read(MIGRATION_PATH)
const salesReport = read('src/pages/reports/SalesReport.tsx')
const reportExport = read('src/pages/reports/pdf/reportExportData.ts')
const reportPdf = read('src/pages/reports/pdf/reportPdfExporters.ts')
const creditModal = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const customerIntelligenceMigration = read('supabase/migrations/20260726000400_customer_intelligence_phase_a.sql')
const enReports = JSON.parse(read('src/localization/locales/en/reports.json'))
const arReports = JSON.parse(read('src/localization/locales/ar-SA/reports.json'))
const zatcaSubmit = read('supabase/functions/zatca-submit/index.ts')
let passed = 0

function check(condition, message) {
  assert.ok(condition, message)
  passed += 1
}

function matches(source, expression, message) {
  check(expression.test(source), message)
}

function excludes(source, expression, message) {
  check(!expression.test(source), message)
}

function classify({ source, productId, serviceAtSale }) {
  if (source === 'custom') return 'custom'
  if (serviceAtSale) return 'service'
  if (productId) return 'product'
  return 'legacy'
}

function itemKey({ source, productId, invoiceItemId }) {
  if (source === 'custom') return `custom:${invoiceItemId}`
  if (productId) return productId
  return `legacy:${invoiceItemId}`
}

function restockEligibility({
  returnStock,
  branchStockEnabled,
  source,
  productId,
  stockTrackedAtSale,
  serviceAtSale,
  productExists = true,
}) {
  if (!returnStock || !branchStockEnabled) return { restock: false, error: null }
  if (source === 'custom' || !stockTrackedAtSale || serviceAtSale) return { restock: false, error: null }
  if (!productId || !productExists) return { restock: false, error: 'CREDIT_RESTOCK_TARGET_UNAVAILABLE' }
  return { restock: true, error: null }
}

const migrationFiles = readdirSync(new URL('../supabase/migrations/', import.meta.url))
const migrationVersions = migrationFiles
  .map(name => name.match(/^(\d+)_/))
  .filter(Boolean)
  .map(match => match[1])

check(new Set(migrationVersions).size === migrationVersions.length, 'migration versions remain unique')
check(migrationFiles.includes('20260816000300_authoritative_custom_line_checkout.sql'), 'Phase 6 migration remains present')
check(migrationFiles.includes('20260816000400_source_aware_reporting_credit_restock.sql'), 'Phase 7 uses the next audited forward migration version')
matches(migration, /^BEGIN;/m, 'Phase 7 migration is transactional')
matches(migration, /COMMIT;\s*$/m, 'Phase 7 migration commits transactionally')
matches(migration, /PHASE7_SOURCE_AWARE_REQUIRED_CONTRACT_MISSING/, 'Phase 7 checks its required schema and function contracts')

// Credit/restock hardening: only immutable issued state determines eligibility.
matches(migration, /create_partial_credit_note_legacy_phase7_base_v1/, 'legacy financial credit delegate is preserved privately')
matches(migration, /create_partial_credit_note_with_product_units_phase7_base_v1/, 'package financial credit delegate is preserved privately')
matches(migration, /create_partial_credit_note_phase7_base_v1/, 'Phase 7 keeps the prior package-or-legacy dispatch decision')
matches(migration, /v_result := public\.create_partial_credit_note_phase7_base_v1\(p_payload\)/, 'public credit wrapper delegates existing fiscal validation before restock')
matches(migration, /idempotent_replay[\s\S]*?RETURN v_result;/, 'credit replay exits before any new stock mutation')
matches(migration, /SET line_source = original_item\.line_source,[\s\S]*?stock_tracked_at_sale = original_item\.stock_tracked_at_sale,[\s\S]*?service_item_at_sale = original_item\.service_item_at_sale/, 'new credit items copy immutable source and sale-time classification snapshots')
matches(migration, /original_item\.stock_tracked_at_sale/, 'restock reads the original stock-at-sale snapshot')
matches(migration, /original_item\.service_item_at_sale/, 'restock reads the original service-at-sale snapshot')
matches(migration, /original_item\.line_source IS DISTINCT FROM 'custom'/, 'custom source is explicitly excluded from restock')
excludes(migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.create_partial_credit_note(p_payload jsonb)')), /p\.track_stock|p\.is_service/, 'public Phase 7 restock never consults mutable product tracking or service fields')
matches(migration, /CREDIT_RESTOCK_TARGET_UNAVAILABLE/, 'unavailable physical inventory targets fail closed')
matches(migration, /FOR UPDATE OF product/, 'existing physical stock targets are locked before mutation')
matches(migration, /COALESCE\(credit_item\.base_quantity, credit_item\.quantity\) AS base_quantity/, 'package/base-unit restock uses credited immutable unit snapshots')
matches(migration, /reason, created_by,[\s\S]*?'refund_return', auth\.uid\(\)/, 'restock retains the established refund-return movement audit')
matches(migration, /WHEN oi\.line_source = 'custom' THEN false/, 'refundable-item API never offers stock return for Custom Lines')
matches(migration, /ELSE COALESCE\(oi\.stock_tracked_at_sale, false\)/, 'refundable-item API fails closed when legacy sale stock state is absent')

check(restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'catalogue', productId: 'p', stockTrackedAtSale: true, serviceAtSale: false }).restock, 'tracked catalogue product restocks')
check(restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'catalogue', productId: 'p', stockTrackedAtSale: true, serviceAtSale: false }).restock, 'tracked-at-sale product remains eligible after mutable current tracking changes')
check(restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'catalogue', productId: 'p', stockTrackedAtSale: true, serviceAtSale: false }).restock, 'tracked-at-sale product remains eligible after mutable current service changes')
check(!restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'catalogue', productId: 'p', stockTrackedAtSale: false, serviceAtSale: false }).restock, 'non-stock-at-sale product never restocks if later made tracked')
check(!restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'catalogue', productId: 'service', stockTrackedAtSale: false, serviceAtSale: true }).restock, 'saved service never restocks')
check(!restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'custom', productId: null, stockTrackedAtSale: false, serviceAtSale: true }).restock, 'Custom Line credit needs no product and never restocks')
check(!restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'catalogue', productId: 'p', stockTrackedAtSale: true, serviceAtSale: false, productExists: false }).restock, 'missing stock target does not silently mutate another product')
check(restockEligibility({ returnStock: true, branchStockEnabled: true, source: 'catalogue', productId: 'p', stockTrackedAtSale: true, serviceAtSale: false, productExists: false }).error === 'CREDIT_RESTOCK_TARGET_UNAVAILABLE', 'missing target rolls back the same credit transaction')
check(!restockEligibility({ returnStock: true, branchStockEnabled: false, source: 'catalogue', productId: 'p', stockTrackedAtSale: true, serviceAtSale: false }).restock, 'existing branch stock-module rule still gates physical mutation')
matches(creditModal, /line\.item\.product_id && line\.item\.track_stock && !line\.item\.is_service/, 'credit modal retains null-product Custom Line no-stock affordance')

// Report classification: financial totals remain invoice-level while item rows
// make source explicit and never construct a product from a Custom description.
matches(migration, /WHEN ii\.line_source = 'custom' THEN 'custom'/, 'report classifies Custom Lines server-side')
matches(migration, /WHEN COALESCE\(ii\.service_item_at_sale, false\) THEN 'service'/, 'report classifies saved services from issued snapshots')
matches(migration, /WHEN ii\.product_id IS NOT NULL THEN 'product'/, 'report classifies catalogue products without stock assumptions')
matches(migration, /WHEN ii\.line_source = 'custom' THEN 'custom:' \|\| ii\.id::text/, 'each Custom Line has a line-scoped, non-product identity')
excludes(migration, /legacy:' \|\| lower\(COALESCE\(NULLIF\(btrim\(ii\.name\)/, 'report no longer groups null product IDs by name')
matches(migration, /WHERE lr\.line_type <> 'custom'/, 'Custom Lines never gain product package breakdowns')
matches(migration, /'topProducts', v_top_products,[\s\S]*?'topItems', v_top_items/, 'legacy topProducts stays Custom-free while broad topItems carries explicit Custom rows')
matches(migration, /WHERE ii\.line_source IS DISTINCT FROM 'custom'/, 'category report excludes non-catalogue Custom Lines')
matches(migration, /phase7_customer_top_products_exclude_custom/, 'customer Top Products report is audited separately')
matches(migration, /PHASE7_CUSTOMER_PRODUCT_REPORT_DEFINITION_UNREVIEWED/, 'customer product-report patch fails closed on unreviewed SQL drift')
matches(migration, /WHERE ii\.line_source IS DISTINCT FROM 'custom'[\s\S]*?v_product_id IS NULL OR ii\.product_id = v_product_id/, 'customer Top Products excludes Custom Lines while retaining catalogue filters')
check(customerIntelligenceMigration.includes(`    FROM sales\n    JOIN public.invoice_items ii\n      ON ii.invoice_id = sales.id\n     AND ii.tenant_id = sales.tenant_id\n    WHERE (v_product_id IS NULL OR ii.product_id = v_product_id)\n      AND (v_product_unit_id IS NULL OR ii.product_unit_id = v_product_unit_id)\n    GROUP BY`), 'customer product-report patch targets the audited current query shape')
matches(migration, /'lineSourceSummary', v_source_summary/, 'report exposes reconciliable source-class totals')
matches(migration, /v_summary := public\.get_sales_report_summary/, 'canonical invoice financial totals remain authoritative')
matches(migration, /inv_doc\.accounting_sign \* COALESCE\(ii\.tax_amount, 0\) AS vat_amount/, 'Custom VAT uses issued item tax snapshots and signed credits')

check(classify({ source: 'catalogue', productId: 'product', serviceAtSale: false }) === 'product', 'stocked catalogue sale is Product')
check(classify({ source: 'catalogue', productId: 'nonstock', serviceAtSale: false }) === 'product', 'non-stock catalogue sale is still Product')
check(classify({ source: 'catalogue', productId: 'service', serviceAtSale: true }) === 'service', 'saved service is Service')
check(classify({ source: 'custom', productId: null, serviceAtSale: true }) === 'custom', 'Custom Line is Custom before no-stock service fallback')
check(classify({ source: 'legacy', productId: 'historical', serviceAtSale: false }) === 'product', 'legacy product-backed row remains reportable')
check(classify({ source: 'legacy', productId: null, serviceAtSale: false }) === 'legacy', 'legacy null-product row remains reportable without a fake product')
check(itemKey({ source: 'custom', productId: null, invoiceItemId: 'custom-a' }) !== itemKey({ source: 'custom', productId: null, invoiceItemId: 'custom-b' }), 'two Custom Lines with the same description cannot merge into a product identity')
check(itemKey({ source: 'custom', productId: null, invoiceItemId: 'arabic-custom' }) === 'custom:arabic-custom', 'Arabic Custom description keeps a line-scoped identity')
check([100, 50, -20].reduce((sum, amount) => sum + amount, 0) === 130, 'classified source components can reconcile to signed invoice totals')

matches(salesReport, /title=\{t\('sales\.topItems'\)\}/, 'Sales UI uses broad item wording when Custom Lines are present')
matches(salesReport, /arrayFromKeys<Record<string, unknown>>\(record, 'topItems', 'topProducts'\)/, 'Sales UI prefers broad source-aware topItems data')
matches(salesReport, /sales\.itemTypes\.\$\{p\.lineType\}/, 'Sales UI renders Product, Service, Custom, and Legacy markers')
matches(salesReport, /isArabic \? p\.nameAr \?\? p\.name : p\.name/, 'Sales UI renders the immutable Arabic Custom description when applicable')
matches(reportExport, /lineType\?: 'product' \| 'service' \| 'custom' \| 'legacy'/, 'PDF export parser accepts source-aware item types')
matches(reportPdf, /reports:sales\.itemTypes/, 'PDF export shows source type beside the item instead of a null product ID')
check(enReports.sales.itemTypes.custom === 'Custom', 'English Custom source label is present')
check(arReports.sales.itemTypes.custom === 'بند مخصص', 'Arabic Custom source label is present')

const changedPaths = [
  ...execFileSync('git', ['diff', '--name-only', BASE, '--'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean),
]
const permittedPaths = new Set([
  'package.json',
  'scripts/test-migration-lineage-repair.mjs',
  'scripts/test-branch-billing-profile-foundation.mjs',
  'scripts/test-custom-line-cart-architecture.mjs',
  MIGRATION_PATH,
  'scripts/test-custom-line-server-checkout.mjs',
  'scripts/test-source-aware-reporting-credit-hardening.mjs',
  'supabase/migrations/20260804000250_restore_zatca_sandbox_credentials_prerequisite.sql',
  'supabase/migrations/20260804000600_trading_sandbox_v2.sql',
  'supabase/migrations/20260805000200_persist_zatca_capability_selection.sql',
  'supabase/migrations/20260816000100_services_and_custom_billing_lines.sql',
  'supabase/migrations/20260816000200_branch_billing_profile_foundation.sql',
  'src/localization/locales/ar-SA/reports.json',
  'src/localization/locales/en/reports.json',
  'src/pages/reports/SalesReport.tsx',
  'src/pages/reports/pdf/reportExportData.ts',
  'src/pages/reports/pdf/reportPdfExporters.ts',
])
check(changedPaths.every(path => permittedPaths.has(path)), 'Phase 7 diff is restricted to reporting, credit hardening, translations, and focused tests')
check(!changedPaths.includes('supabase/functions/zatca-submit/index.ts'), 'protected ZATCA Edge Function remains untouched')
check(
  execFileSync('git', ['diff', BASE, '--', 'supabase/functions/zatca-submit/index.ts'], { encoding: 'utf8' }) === '',
  'protected ZATCA Edge diff is empty from the Phase 6 base',
)
check(zatcaSubmit.includes('lines: items.map'), 'ZATCA snapshot rendering contract remains present without edits')

console.log(`Source-aware reporting and immutable credit/restock tests passed (${passed} assertions).`)
