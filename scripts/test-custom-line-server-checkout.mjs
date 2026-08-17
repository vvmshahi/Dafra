import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const BASE = '2b262f9ee99d7ec4c84186a0d4caaa8b84d41761'
const SCOPE_TIP = 'd08838b5b652a1ffd0dc01f394cfb0a44daef046'
const MIGRATION_PATH = 'supabase/migrations/20260816000300_authoritative_custom_line_checkout.sql'
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read(MIGRATION_PATH)
const displayUnitMigration = read('supabase/migrations/20260817000100_custom_line_display_units.sql')
const pos = read('src/pages/pos/POSPage.tsx')
const cart = read('src/lib/pos/cartLines.ts')
const creditNote = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const documentAdapter = read('src/lib/invoices/documentViewAdapters.ts')
const receiptPage = read('src/pages/print/ReceiptPrintPage.tsx')
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

const migrationFiles = readdirSync(new URL('../supabase/migrations/', import.meta.url))
const migrationVersions = migrationFiles
  .map(name => name.match(/^(\d+)_/))
  .filter(Boolean)
  .map(match => match[1])

check(new Set(migrationVersions).size === migrationVersions.length, 'migration versions must be unique')
check(migrationFiles.includes('20260816000200_branch_billing_profile_foundation.sql'), 'Phase 5.5 migration must remain present')
check(migrationFiles.includes('20260816000300_authoritative_custom_line_checkout.sql'), 'Phase 6 migration must be present')
check(migrationFiles.includes('20260817000100_custom_line_display_units.sql'), 'Custom Line display unit migration must be present')
check(!migrationFiles.includes('20260816000100_branch_billing_profile_foundation.sql'), 'historical occupied version must not be reused')
check('20260816000300' > '20260816000200', 'Phase 6 must be forward-only after Phase 5.5')
matches(migration, /^BEGIN;/m, 'migration must be transactional')
matches(migration, /COMMIT;\s*$/m, 'migration must commit transactionally')
matches(migration, /PHASE6_CUSTOM_LINE_REQUIRED_CONTRACT_MISSING/, 'migration must assert required contracts')
matches(migration, /product_units_commercial_function_contracts_v1/, 'migration must validate the reviewed package checkout definition')
matches(migration, /md5\(v_definition\) IS DISTINCT FROM v_registered_hash/, 'migration must reject an unreviewed package checkout body')
matches(migration, /RETURNING id INTO v_invoice_id/, 'mixed helper must retain persisted parent identity protection')

// Source detection and narrow Custom Line contract.
matches(migration, /v_source IS NULL OR v_source NOT IN \('catalogue', 'custom'\)/, 'unknown and blank sources must be rejected')
matches(migration, /CATALOGUE_PRODUCT_ID_REQUIRED/, 'catalogue requires product_id')
matches(migration, /CUSTOM_LINE_PRODUCT_IDENTITY_FORBIDDEN/, 'custom product identity must be rejected')
matches(migration, /CUSTOM_LINE_PRODUCT_OR_PACKAGE_IDENTITY_FORBIDDEN/, 'custom package identity must be rejected')
matches(migration, /v_source := 'catalogue';/, 'source-less legacy payloads remain catalogue')
matches(migration, /'source', 'product_id', 'product_unit_id', 'package_quantity',[\s\S]*'unit_price', 'vat_treatment'/, 'custom helper must use an allow-list item contract')
excludes(migration, /'tax_amount', 'total', 'vat_rate'/, 'browser totals or arbitrary VAT fields must not be accepted')
matches(migration, /INVALID_CUSTOM_LINE_DESCRIPTION/, 'custom description must be server-validated')
matches(migration, /length\(v_custom_name\) > 255/, 'custom description must observe invoice snapshot bounds')
matches(migration, /length\(COALESCE\(v_custom_name_ar, ''\)\) > 255/, 'Arabic description must observe invoice snapshot bounds')
matches(migration, /INVALID_CUSTOM_LINE_QUANTITY/, 'custom quantity must be validated')
matches(migration, /round\(v_qty, 3\) <> v_qty/, 'custom quantity must retain three-decimal precision')
matches(migration, /INVALID_CUSTOM_LINE_UNIT_PRICE/, 'custom unit price must be validated')
matches(migration, /round\(v_custom_unit_price_input, 2\) <> v_custom_unit_price_input/, 'custom unit price must retain monetary precision')
matches(migration, /INVALID_CUSTOM_LINE_VAT_TREATMENT/, 'VAT treatment must be validated')
matches(migration, /\('inherit', 'exclusive', 'inclusive'\)/, 'only safe V1 VAT treatments are allowed')
matches(migration, /v_rate := 0\.15::numeric;/, 'Custom Line VAT rate must be server-owned')
matches(migration, /v_vat_treatment := v_vat_mode;/, 'inherit must resolve from authoritative branch VAT mode')
matches(migration, /'unit', 'PCE'/, 'Custom Lines must receive PCE server-side')
matches(displayUnitMigration, /INVALID_CUSTOM_LINE_UNIT/, 'display unit must be server-validated')
matches(displayUnitMigration, /length\(v_custom_unit\) > 40/, 'display unit must observe bounded snapshot length')
matches(displayUnitMigration, /CUSTOM_LINE_DISPLAY_UNIT_CONTRACT_UNREVIEWED/, 'display unit patch must fail closed on unknown function shape')
matches(displayUnitMigration, /'unit', v_custom_unit/, 'display unit must be persisted in the Custom Line invoice snapshot')

// Authorization, provenance, and stock safety.
matches(migration, /CUSTOM_LINES_DISABLED_FOR_BRANCH/, 'branch capability must be enforced server-side')
matches(migration, /b\.custom_lines_enabled/, 'authorization must read persisted branch capability')
excludes(migration, /business_profile/, 'business profile must not authorize Custom Lines')
matches(migration, /'line_source', 'custom'/, 'Custom snapshots must write custom provenance')
matches(migration, /'line_source', 'catalogue'/, 'new catalogue snapshots must write catalogue provenance')
matches(migration, /NEW\.product_id IS NOT NULL OR NEW\.product_unit_id IS NOT NULL/, 'provenance trigger must reject custom product identity')
matches(migration, /NEW\.stock_tracked_at_sale := false;/, 'provenance trigger must force custom no-stock snapshots')
matches(migration, /NEW\.service_item_at_sale := false;/, 'provenance trigger must mark Custom Lines as non-service no-stock snapshots')
matches(migration, /CREATE OR REPLACE FUNCTION public\.apply_invoice_item_line_source_v1\(\)[\s\S]*?NEW\.service_item_at_sale := false;/, 'the pre-existing companion trigger must agree with the Custom false/false contract')
matches(migration, /v_source IN \('catalogue', 'custom'\)[\s\S]*?\(NEW\.line_source IS NULL OR NEW\.line_source = 'legacy'\)/, 'a transaction-local legacy marker must not overwrite explicit mixed-cart provenance')
matches(migration, /'product_id', NULL,[\s\S]*'product_unit_id', NULL/, 'custom item rows must carry no product or product unit')
matches(migration, /'stock_tracked_at_sale', false,[\s\S]*'service_item_at_sale', false/, 'custom item rows must not enter stock handling')
matches(migration, /phase6_stamp_legacy_catalogue_provenance/, 'legacy catalogue writer is audited and patched in the pending checkout migration')
matches(migration, /pos_checkout_legacy_base_v1/, 'open-register checkout delegate stamps the actual legacy catalogue writer')
matches(migration, /phase6_rebind_public_checkout_dispatcher/, 'public checkout is rebound through the existing source-aware capability dispatcher')
matches(migration, /resolve_pos_checkout_document_internal_v1[\s\S]*?FOR SHARE[\s\S]*?CLOSED_SESSION/, 'public checkout rebinding retains the August 13 authorization and open-register guards')
matches(migration, /RETURN public\.pos_checkout_capability_base_v1\(p_payload\);/, 'public checkout reaches the canonical source-aware writer after its guard')
matches(migration, /'is_service', COALESCE\(v_product\.is_service, FALSE\)/, 'catalogue provenance carries the locked product service classification into the issued line')
matches(migration, /'catalogue',[\s\S]*?stock_tracked_at_sale,[\s\S]*?service_item_at_sale/, 'legacy catalogue invoice insert explicitly persists all provenance fields')
matches(migration, /branch_effective_stock_enabled\(v_branch\.tenant_id, v_branch\.id\)[\s\S]*?v_line ->> 'track_stock'/, 'catalogue stock snapshot follows the sale-time branch capability and locked product state')
matches(migration, /IF NULLIF\(v_line ->> 'product_unit_id', ''\) IS NOT NULL THEN/, 'custom rows must skip product-unit use mutation')
matches(migration, /v_resolved\.effective_stock_enabled[\s\S]*UPDATE public\.products/, 'catalogue stock mutation must remain in the reviewed path')

// Backwards compatibility, idempotency, and classifier order.
matches(migration, /pos_checkout_capability_catalogue_base_v1/, 'catalogue-only carts must retain a preserved delegate')
matches(migration, /item\.value - 'source'/, 'explicit catalogue source must be stripped before legacy delegate')
matches(migration, /RETURN public\.pos_checkout_custom_lines_v1\(p_payload\)/, 'mixed carts must use one helper transaction')
matches(migration, /checkout_request_fingerprint/, 'Custom fields must participate in the existing request fingerprint')
excludes(migration, /CREATE OR REPLACE FUNCTION public\.pos_checkout\(/, 'public classifier wrapper must not be replaced')
matches(pos, /await resolvePosCheckoutDocument\(branch\.id, customerId\)/, 'browser classifier request must remain before checkout')
matches(pos, /items: serializePosCartLinesForCheckout\(cart\)/, 'POS must serialize mixed cart payloads')
excludes(pos, /hasCustomCartLines\(cart\)|checkoutUnavailable/, 'Phase 5 hard checkout block must be removed')
matches(pos, /customLineActionEnabled = branchBillingConfig\?\.customLinesEnabled === true/, 'Touch and Quick POS exposure must follow branch capability')
excludes(pos, /VITE_INTERNAL_CUSTOM_LINE_CART|CUSTOM_LINE_CART_INTERNAL_ENABLED/, 'browser development flag must not authorize custom lines')
matches(cart, /source: 'custom',[\s\S]*name: line\.description,[\s\S]*unit_price: line\.unitPrice/, 'custom mapper must serialize only source-aware server fields')
matches(cart, /cartLineId and display-only preview values never become part/, 'client cart identity must be excluded from financial serialization')
matches(cart, /product_id: line\.productId,[\s\S]*package_quantity: line\.quantity/, 'package catalogue mapper must remain compatible')

// Existing snapshot consumers are product-ID optional.
matches(documentAdapter, /items: items\.map\(item => \(\{ description: item\.name/, 'stored document adapter must render item snapshots directly')
matches(receiptPage, /from\('invoice_items'\)\.select\('\*'\)/, 'receipt page must consume immutable invoice item snapshots')
excludes(documentAdapter, /item\.product_id/, 'document adapter must not require product identity')
matches(zatcaSubmit, /lines: items\.map\(\(it: any, i: number\) => \(\{[\s\S]*name: it\.name/, 'ZATCA line builder must consume item snapshots')
excludes(zatcaSubmit, /invoice_items\([^)]*product_id/, 'ZATCA invoice-item reads must not require product_id')
matches(creditNote, /line\.item\.product_id && line\.item\.track_stock && !line\.item\.is_service/, 'credit UI must exclude product-null custom lines from stock returns')
matches(creditNote, /item\.is_service \|\| !item\.track_stock \|\| !item\.product_id/, 'credit UI must mark product-null lines as no-inventory impact')

const changedPaths = [
  ...execFileSync('git', ['diff', '--name-only', BASE, SCOPE_TIP, '--'], { encoding: 'utf8' })
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
  'scripts/test-source-aware-reporting-credit-hardening.mjs',
  'scripts/test-custom-line-cart-architecture.mjs',
  'scripts/test-custom-line-server-checkout.mjs',
  'scripts/test-demo-tenant-safe-checkout.mjs',
  'scripts/test-saved-services-catalogue.mjs',
  'scripts/test-product-units-commercial-workflow.mjs',
  'src/components/pos/CustomLineEditor.tsx',
  'src/lib/pos/cartLines.ts',
  'src/lib/products/catalogueExport.ts',
  'src/lib/products/catalogueImport.ts',
  'src/localization/locales/ar-SA/pos.json',
  'src/localization/locales/ar-SA/reports.json',
  'src/localization/locales/ar-SA/invoices.json',
  'src/localization/locales/en/pos.json',
  'src/localization/locales/en/reports.json',
  'src/localization/locales/en/invoices.json',
  'src/pages/pos/POSPage.tsx',
  'src/pages/products/CatalogueExportDialog.tsx',
  'src/pages/products/CatalogueImportPanel.tsx',
  'src/pages/products/ProductsPage.tsx',
  'src/pages/purchases/PurchasesPage.tsx',
  'src/pages/inventory/PurchaseHistoryTab.tsx',
  'src/pages/inventory/PurchaseBillModal.tsx',
  'src/localization/locales/en/purchases.json',
  'src/localization/locales/ar-SA/purchases.json',
  // Authorized invoice-list summary presentation refinement; does not affect
  // custom-line checkout, document persistence, or print behavior.
  'src/pages/invoices/InvoicesPage.tsx',
  'src/pages/invoices/InvoiceDetailPage.tsx',
  'src/pages/print/ReceiptPrintPage.tsx',
  'src/lib/invoices/issuedDocumentReadiness.ts',
  // Authorized immutable buyer/document-integrity release: these paths only
  // capture and present issue-time identity; checkout and ZATCA remain scoped.
  'src/components/print/A4Document.tsx',
  'src/components/print/ThermalReceipt.tsx',
  'src/lib/invoices/documentPresentationReadiness.ts',
  'src/lib/invoices/documentViewAdapters.ts',
  'src/lib/invoices/documentViewModel.ts',
  'src/lib/invoices/invoiceReadContract.ts',
  'src/types/database.ts',
  'scripts/test-issued-document-presentation-integrity.mjs',
  'scripts/test-phase4e-thermal-receipts.mjs',
  'scripts/test-phase4f-a4-templates.mjs',
  'src/lib/zatca/authenticatedEdge.ts',
  'src/lib/print/browserPrint.ts',
  'scripts/test-android-print-a4-preview.mjs',
  'scripts/test-final-web-printing-refinements.mjs',
  'scripts/test-invoice-detail-ui.mjs',
  'scripts/test-invoice-summary-ui.mjs',
  'scripts/test-zatca-phase2-finalization-v2.mjs',
  'scripts/test-branch-dashboard-v2.mjs',
  'scripts/test-catalogue-bulk-export.mjs',
  'scripts/test-catalogue-bulk-import.mjs',
  'scripts/run-zatca-atomic-simplified-checkout-runtime.mjs',
  'scripts/test-custom-line-server-checkout.mjs',
  'src/pages/reports/SalesReport.tsx',
  'src/pages/reports/pdf/reportExportData.ts',
  'src/pages/reports/pdf/reportPdfExporters.ts',
  MIGRATION_PATH,
  'supabase/migrations/20260804000250_restore_zatca_sandbox_credentials_prerequisite.sql',
  'supabase/migrations/20260804000600_trading_sandbox_v2.sql',
  'supabase/migrations/20260805000200_persist_zatca_capability_selection.sql',
  'supabase/migrations/20260816000100_services_and_custom_billing_lines.sql',
  'supabase/migrations/20260816000200_branch_billing_profile_foundation.sql',
  'supabase/migrations/20260816000400_source_aware_reporting_credit_restock.sql',
  'supabase/migrations/20260817000100_custom_line_display_units.sql',
  'supabase/migrations/20260817000200_secure_catalogue_bulk_import_v1.sql',
  'supabase/migrations/20260817000300_purchase_product_receiving_v1.sql',
  'supabase/migrations/20260817000400_customer_identity_validation_v1.sql',
  'supabase/migrations/20260817000500_expenses_authority_v1.sql',
  'supabase/migrations/20260817000600_capture_immutable_invoice_buyer_snapshot_v1.sql',
  'scripts/test-purchase-modal-ui.mjs',
  'scripts/test-expense-modal-ui.mjs',
  'scripts/test-expense-authority-v1.mjs',
  'scripts/test-custom-line-cart-architecture.mjs',
  'package.json',
  'src/localization/locales/ar-SA/expenses.json',
  'src/localization/locales/en/expenses.json',
  'src/pages/expenses/DailyExpenseModal.tsx',
  'src/pages/expenses/DailyExpensesTab.tsx',
  'src/pages/expenses/ExpensesPage.tsx',
  'src/pages/expenses/FixedExpenseModal.tsx',
  'src/pages/expenses/FixedExpensesTab.tsx',
  'src/pages/reports/ExpenseReport.tsx',
])
check(changedPaths.every(path => permittedPaths.has(path)), 'Phase 6 diff must stay within its approved scope')
check(!changedPaths.includes('supabase/functions/zatca-submit/index.ts'), 'zatca-submit must remain untouched')
check(
  execFileSync('git', ['diff', BASE, SCOPE_TIP, '--', 'supabase/functions/zatca-submit/index.ts'], { encoding: 'utf8' }) === '',
  'protected ZATCA Edge diff must be empty',
)

console.log(`Custom line server checkout static contract tests passed (${passed} assertions).`)
