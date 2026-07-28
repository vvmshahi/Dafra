import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const sales = read('src/pages/reports/SalesReport.tsx')
const reportsPage = read('src/pages/reports/ReportsPage.tsx')
const reportUtils = read('src/pages/reports/reportUtils.tsx')
const reportingRpc = read('src/pages/reports/reportingRpc.ts')
const baseline = read('supabase/migrations/20260721000100_dafra_current_schema_and_security.sql')
const productUnits = read('supabase/migrations/20260725000700_product_units_commercial_workflow.sql')
const fix = read('supabase/migrations/20260729000100_fix_sales_report_uuid_aggregate.sql')
const zatca = read('src/pages/settings/ZatcaTab.tsx')
const zatcaEn = read('src/localization/locales/en/zatca.json')
const zatcaAr = read('src/localization/locales/ar-SA/zatca.json')

assert.match(sales, /get_sales_report_summary_v2/)
assert.match(sales, /reportParams\(startDate, endDate, branchId\)/)
assert.match(sales, /setData\(null\)[\s\S]*setError/)
assert.match(sales, /data\.invoiceCount === 0/)
assert.match(reportingRpc, /if \(data == null\) return \{ \.\.\.fallback \}/)
assert.match(reportingRpc, /REPORT_PARSE_ERROR/)
assert.match(reportingRpc, /throw error/)

for (const preset of ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'custom']) {
  assert.match(reportUtils, new RegExp(`'${preset}'`))
}
assert.match(reportUtils, /start: pad/)
assert.match(reportingRpc, /p_start_date: startDate[\s\S]*p_end_date: endDate[\s\S]*p_branch_id: branchId/)
assert.match(reportsPage, /profile\?\.role === 'branch' && profile\.branch_id \? profile\.branch_id : null/)
assert.match(reportsPage, /branches\.length > 1/)

const scope = baseline.slice(
  baseline.indexOf('CREATE OR REPLACE FUNCTION "public"."reporting_resolve_scope"'),
  baseline.indexOf('ALTER FUNCTION "public"."reporting_resolve_scope"'),
)
assert.match(scope, /v_user_id UUID := auth\.uid\(\)/)
assert.match(scope, /v_profile\.role = 'owner'/)
assert.match(scope, /scope_branch_id := NULL/)
assert.match(scope, /v_profile\.role = 'branch'/)
assert.match(scope, /scope_branch_id := v_profile\.branch_id/)
assert.match(scope, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/)
assert.match(scope, /v_profile\.branch_id IS DISTINCT FROM v_branch\.id/)
assert.match(scope, /ERRCODE = '42501'/)

assert.match(productUnits, /min\(product_id\) AS product_id/)
assert.match(fix, /min\(product_id::text\)::uuid AS product_id/)
assert.match(fix, /pg_get_functiondef/)
assert.match(fix, /SALES_REPORT_V2_FUNCTION_MISSING/)
assert.match(fix, /SALES_REPORT_V2_UUID_AGGREGATE_ANCHOR_UNEXPECTED/)
assert.match(fix, /public\.get_sales_report_summary_v2\(date,date,uuid\)/)
assert.doesNotMatch(fix, /tenant_id|branch_id|auth\.uid/)

assert.doesNotMatch(zatca, /connection\.featureFlagHelp/)
assert.doesNotMatch(zatcaEn, /featureFlagHelp|Production onboarding can stay disabled/)
assert.doesNotMatch(zatcaAr, /featureFlagHelp|يمكن أن تظل تهيئة الإنتاج/)
for (const key of ['connection.connected', 'fields.branch', 'fields.vat', 'fields.cr', 'fields.environment', 'fields.functionality', 'fields.connectedAt', 'fields.productionCsid', 'fields.status', 'fields.lastUpdated', 'connection.reconnect', 'connection.remove']) {
  assert.match(zatca, new RegExp(key.replace('.', '\\.')))
}
assert.match(zatca, /createPortal\([\s\S]*document\.body/)
assert.match(zatca, /returnFocusRef\.current\?\.focus/)

console.log('ZATCA connected notice removal and Sales report UUID aggregate, role scope, dates, zero-data, and failure contracts passed.')
