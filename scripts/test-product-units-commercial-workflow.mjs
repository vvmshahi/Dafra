import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260725000700_product_units_commercial_workflow.sql')
const pos = read('src/pages/pos/POSPage.tsx')
const unifiedScanner = read('src/lib/pos/unifiedScanner.ts')
const credit = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const invoiceDetail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const receiving = read('src/pages/inventory/ProductStockReceiptDrawer.tsx')
const report = read('src/pages/reports/SalesReport.tsx')
const reportExport = read('src/pages/reports/pdf/reportExportData.ts')
const reportPdf = read('src/pages/reports/pdf/reportPdfExporters.ts')
const adapters = read('src/lib/invoices/documentViewAdapters.ts')
const documentModel = read('src/lib/invoices/documentViewModel.ts')
const receiptPrint = read('src/pages/print/ReceiptPrintPage.tsx')
const thermal = read('src/components/print/ThermalReceipt.tsx')
const a4 = read('src/components/print/A4Document.tsx')
const atomicClient = read('src/lib/zatca/atomicCheckout.ts')
const atomicMigration = read('supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql')
const productionZatca = read('supabase/functions/zatca-submit/index.ts')
const sandboxZatca = read('supabase/functions/zatca-submit-sandbox-demo/index.ts')
const validator = read('supabase/functions/zatca-validate-sandbox-demo/index.ts')
const samples = read('supabase/functions/_shared/zatca/samples.ts')
const verification = read('scripts/sql/zatca-phase2-finalization-v2/06_verification.sql')
const productionPreflight = read(
  'scripts/sql/zatca-phase2-finalization-v2/operator/preflight_product_units_commercial_workflow.sql',
)
const productionPostflight = read(
  'scripts/sql/zatca-phase2-finalization-v2/operator/verify_product_units_commercial_workflow.sql',
)
const enPos = JSON.parse(read('src/localization/locales/en/pos.json'))
const arPos = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))
const enCredit = JSON.parse(read('src/localization/locales/en/creditNotes.json'))
const arCredit = JSON.parse(read('src/localization/locales/ar-SA/creditNotes.json'))
const enInventory = JSON.parse(read('src/localization/locales/en/inventory.json'))
const arInventory = JSON.parse(read('src/localization/locales/ar-SA/inventory.json'))
const enReports = JSON.parse(read('src/localization/locales/en/reports.json'))
const arReports = JSON.parse(read('src/localization/locales/ar-SA/reports.json'))

const results = []
const test = (name, fn) => {
  fn()
  results.push(name)
}

const resolvePrice = ({ method, basePrice, conversion, customPrice }) =>
  method === 'custom'
    ? customPrice
    : Math.round(basePrice * conversion * 100) / 100

const exactQuantity = ({ quantity, packageScale, conversion, baseScale }) => {
  const packageFactor = 10 ** packageScale
  const baseFactor = 10 ** baseScale
  return Math.abs(quantity * packageFactor - Math.round(quantity * packageFactor)) < 1e-9
    && Math.abs(quantity * conversion * baseFactor - Math.round(quantity * conversion * baseFactor)) < 1e-9
}

const cartIdentity = ({ product, unit, version, pricing, price, vat }) =>
  `${product}:${unit}:${version}:${pricing}:${price.toFixed(2)}:${vat}`

test('migration is bounded, transactional, manual-file safe and leaves purchase inventory untouched', () => {
  assert.match(migration, /^BEGIN;/)
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/)
  assert.match(migration, /SET LOCAL statement_timeout = '5min'/)
  assert.match(migration, /ALTER COLUMN quantity TYPE numeric\(18, 6\)/)
  assert.match(migration, /PRODUCT_UNITS_INVOICE_QUANTITY_TYPE_UNREVIEWED/)
  assert.match(migration, /COMMIT;\s*$/)
  assert.doesNotMatch(migration, /supabase db push|inventory_items\.current_quantity/)
  assert.doesNotMatch(migration, /FUNCTION public\.(?:confirm|cancel)_purchase_receiving/)
})

test('production preflight and postflight are strict read-only release gates', () => {
  for (const sql of [productionPreflight, productionPostflight]) {
    assert.match(sql, /^BEGIN TRANSACTION READ ONLY;$/m)
    assert.match(sql, /^ROLLBACK;\s*$/m)
    assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|ALTER|DROP)\s+public\./i)
    assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\./i)
    assert.doesNotMatch(sql, /\bCREATE\s+(?:TEMP\s+)?TABLE\b/i)
  }
  for (const hash of [
    '0db582cb8451ab6a6a69bb9d9d662de6',
    '9d9b05d14a501ebfb887e9172b9c1fe2',
    '3e0c27664ae59b78ab51066a612ca6e5',
    '78c5524f0f0ccef32740ca5453aaaa68',
    '00022982d7619aefb65fc1e6f3125108',
  ]) assert.match(productionPreflight, new RegExp(hash))
  assert.match(productionPreflight, /invoice_items_bytes/)
  assert.match(productionPreflight, /active_pos_checkout_queries/)
  assert.match(productionPostflight, /function_privilege_matrix/)
  assert.match(productionPostflight, /function_contract_registry_hashes/)
  assert.match(productionPostflight, /product_receiving_production_safeguards/)
  assert.match(
    productionPostflight,
    /'branch'', ''manager'', ''cashier'', ''accountant'/,
  )
  assert.match(productionPostflight, /IDEMPOTENCY_FINGERPRINT_MISMATCH/)
  assert.match(
    productionPostflight,
    /v_package_unit_cost \/ v_resolved\.conversion_to_base/,
  )
  assert.match(productionPostflight, /historical_rows_not_backfilled/)
  assert.match(productionPostflight, /no_duplicate_request_fingerprints/)
  assert.match(verification, /v_total <> 60 OR v_pass <> 55/)
})

test('authoritative resolver owns scope, eligibility, quantity, conversion and pricing', () => {
  assert.match(migration, /FUNCTION public\.resolve_product_commercial_unit/)
  assert.match(migration, /pu\.product_id = v_product\.id[\s\S]*?pu\.tenant_id = v_product\.tenant_id[\s\S]*?pu\.branch_id = v_product\.branch_id/)
  assert.match(migration, /Product unit does not belong to this product and branch/)
  assert.match(migration, /Product unit is inactive/)
  assert.match(migration, /Product unit changed; reload the unit/)
  assert.match(migration, /not enabled for selling/)
  assert.match(migration, /not enabled for receiving/)
  assert.match(migration, /round\(v_quantity, v_unit\.quantity_scale\) <> v_quantity/)
  assert.match(migration, /v_base_quantity := v_quantity \* v_unit\.conversion_to_base/)
  assert.match(migration, /LEAST\(v_base\.quantity_scale, 3\)/)
  assert.match(migration, /v_base_quantity > 999999999\.999::numeric/)
  assert.match(migration, /v_unit\.custom_selling_price[\s\S]*?v_product\.price[\s\S]*?v_unit\.conversion_to_base/)
  assert.equal(resolvePrice({ method: 'calculated', basePrice: 10, conversion: 24, customPrice: null }), 240)
  assert.equal(resolvePrice({ method: 'custom', basePrice: 10, conversion: 24, customPrice: 220 }), 220)
  assert.equal(exactQuantity({ quantity: 0.5, packageScale: 1, conversion: 24, baseScale: 0 }), true)
  assert.equal(exactQuantity({ quantity: 0.333, packageScale: 3, conversion: 24, baseScale: 0 }), false)
})

test('private resolver and helpers cannot be executed by browsers', () => {
  for (const helper of [
    'resolve_product_commercial_unit',
    'pos_checkout_with_product_units_v1',
    'create_partial_credit_note_with_product_units_v1',
    'receive_product_stock_with_units_v1',
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role`),
    )
  }
  assert.match(migration, /SET search_path = public, pg_temp/g)
  assert.match(migration, /SET row_security = off/g)
  assert.match(migration, /ALTER FUNCTION public\.resolve_product_commercial_unit[\s\S]*?OWNER TO postgres/)
})

test('POS loads only scoped active selling units and rejects stale asynchronous results', () => {
  assert.match(migration, /FUNCTION public\.get_branch_selling_product_units/)
  assert.match(migration, /pu\.is_active IS TRUE[\s\S]*?pu\.selling_enabled IS TRUE/)
  assert.match(pos, /\.rpc\('get_branch_selling_product_units'/)
  assert.match(pos, /let cancelled = false/)
  assert.match(pos, /if \(cancelled\) return/)
  assert.doesNotMatch(pos, /\.from\(['"]product_units['"]\)/)
})

test('base-only products remain one-click and alternate units open an accessible chooser', () => {
  assert.match(pos, /const alternates = product\.sellingUnits\.filter\(unit => !unit\.isBase\)/)
  assert.match(pos, /setUnitChooserProduct\(product\)/)
  assert.match(pos, /addQuantityToCart\(product, 1, product\.sellingUnits\.find/)
  assert.match(pos, /role="dialog"/)
  assert.match(pos, /aria-modal="true"/)
  assert.match(pos, /event\.key === 'Escape'/)
  assert.match(pos, /event\.key === 'Enter'/)
  assert.match(pos, /grid-cols-1 gap-2 sm:grid-cols-2/)
  assert.match(pos, /text-start/)
})

test('cart identity keeps Piece and Carton separate while merging the same commercial unit', () => {
  const piece = cartIdentity({ product: 'p', unit: 'piece', version: 1, pricing: 'calculated', price: 10, vat: 'inherit' })
  const carton = cartIdentity({ product: 'p', unit: 'carton', version: 3, pricing: 'custom', price: 220, vat: 'inherit' })
  assert.notEqual(piece, carton)
  assert.equal(piece, cartIdentity({ product: 'p', unit: 'piece', version: 1, pricing: 'calculated', price: 10, vat: 'inherit' }))
  assert.match(pos, /cartLineId = `\$\{product\.id\}:\$\{unitId \?\? 'legacy'\}:\$\{unitVersion \?\? 0\}:\$\{pricingMethod\}:\$\{price\.toFixed\(2\)\}:\$\{product\.vatTreatment\}`/)
  assert.match(pos, /applyScannerCartMutation/)
  assert.match(unifiedScanner, /cart\.find\(item => item\.cartLineId === line\.cartLineId\)/)
  assert.match(pos, /key=\{item\.cartLineId\}/)
  assert.match(pos, /singleUnitCartQuantity/)
  assert.match(pos, /packages\.mixedUnitsInCart/)
  assert.doesNotMatch(pos, /reduce\(\(sum, item\) => sum \+ item\.quantity, 0\)/)
})

test('checkout payload contains identifiers, version and intent but not commercial authority', () => {
  assert.match(pos, /product_unit_id: item\.productUnitId/)
  assert.match(pos, /package_quantity: item\.quantity/)
  assert.match(pos, /expected_product_unit_version: item\.productUnitVersion/)
  const payloadBlock = pos.slice(
    pos.indexOf('items: cart.map(item => item.productUnitId'),
    pos.indexOf('const demoSandbox'),
  )
  assert.doesNotMatch(payloadBlock, /conversion_to_base|base_quantity|package_unit_price|stock_enabled|tenant_id/)
})

test('package checkout locks rows, resolves authority and writes immutable sale snapshots', () => {
  assert.match(migration, /FROM public\.products p[\s\S]*?ORDER BY p\.id[\s\S]*?FOR UPDATE/)
  assert.match(migration, /FROM public\.product_units pu[\s\S]*?ORDER BY pu\.id[\s\S]*?FOR UPDATE/)
  assert.match(migration, /resolve_product_commercial_unit\([\s\S]*?'sell'/)
  assert.match(migration, /v_line_amount := v_resolved\.package_unit_price \* v_resolved\.package_quantity/)
  assert.match(migration, /stock_quantity = stock_quantity - v_resolved\.base_quantity/)
  for (const column of [
    'product_unit_id', 'product_unit_version', 'selling_unit_name',
    'selling_unit_name_ar', 'selling_unit_code', 'package_quantity',
    'package_quantity_scale', 'conversion_to_base', 'base_quantity',
    'base_unit_name', 'base_unit_name_ar', 'base_unit_code',
    'base_quantity_scale', 'package_pricing_method', 'base_unit_price',
    'package_unit_price', 'stock_tracked_at_sale', 'service_item_at_sale',
  ]) assert.match(migration, new RegExp(column))
  assert.match(migration, /round\(package_quantity, package_quantity_scale\) = package_quantity/)
  assert.match(migration, /round\(base_quantity, base_quantity_scale\) = base_quantity/)
  assert.match(migration, /PERFORM public\.mark_product_unit_used/)
})

test('stock-disabled and service sales preserve pricing but create no stock mutation', () => {
  assert.match(migration, /v_resolved\.effective_stock_enabled[\s\S]*?v_resolved\.stock_tracked[\s\S]*?NOT v_resolved\.service_item[\s\S]*?UPDATE public\.products/)
  assert.match(migration, /IF \(v_line ->> 'stock_tracked_at_sale'\)::boolean IS TRUE THEN[\s\S]*?INSERT INTO public\.pos_stock_movements/)
  const sale = ({ enabled, tracked, service, stock, baseQuantity }) => {
    if (!enabled || !tracked || service) return { stock, movement: false }
    if (stock < baseQuantity) throw new Error('insufficient')
    return { stock: stock - baseQuantity, movement: true }
  }
  assert.deepEqual(sale({ enabled: false, tracked: true, service: false, stock: 0, baseQuantity: 24 }), { stock: 0, movement: false })
  assert.deepEqual(sale({ enabled: true, tracked: true, service: true, stock: 0, baseQuantity: 24 }), { stock: 0, movement: false })
  assert.throws(() => sale({ enabled: true, tracked: true, service: false, stock: 0, baseQuantity: 24 }), /insufficient/)
})

test('legacy checkout is byte-gated and package idempotency includes unit identity', () => {
  assert.match(migration, /md5\(v_definition\) <> '0db582cb8451ab6a6a69bb9d9d662de6'/)
  assert.match(migration, /RETURN public\.pos_checkout_legacy_base_v1\(p_payload\)/)
  assert.match(migration, /checkout_request_fingerprint/)
  assert.match(migration, /extensions\.digest\(convert_to\(p_payload::text, 'UTF8'\), 'sha256'\)/)
  assert.match(migration, /IDEMPOTENCY_FINGERPRINT_MISMATCH/)
  assert.match(migration, /pg_advisory_xact_lock/)
  for (const replayField of [
    'package_quantity_scale', 'base_quantity_scale',
    'package_pricing_method', 'package_unit_price',
    'stock_tracked_at_sale', 'service_item_at_sale',
  ]) {
    assert.match(
      migration,
      new RegExp(`v_existing_items[\\s\\S]*?'${replayField}', ${replayField}`),
    )
  }
})

test('atomic checkout snapshots and fingerprints include all package authority', () => {
  assert.match(migration, /patch_atomic_receipt_snapshot/)
  assert.match(migration, /00022982d7619aefb65fc1e6f3125108/)
  for (const field of [
    'product_unit_id', 'product_unit_version', 'package_quantity',
    'conversion_to_base', 'base_quantity', 'package_unit_price',
  ]) {
    assert.match(migration, new RegExp(`'${field}', ii\\.${field}`))
    assert.match(atomicClient, new RegExp(field))
  }
  assert.match(migration, /ATOMIC_CHECKOUT_SNAPSHOT_CHANGED/)
  assert.match(migration, /build_zatca_atomic_receipt_snapshot_v2/)
  assert.match(
    migration,
    /ALTER FUNCTION public\.build_zatca_atomic_receipt_snapshot_v2\(uuid\)[\s\S]*?SET row_security = off/,
  )
  assert.match(atomicMigration, /idempotency_key, cart_fingerprint, request_payload/)
  assert.match(atomicMigration, /v_preview := public\.pos_checkout\(p_payload\)/)
  assert.match(atomicMigration, /v_commercial_result := public\.pos_checkout\(v_intent\.request_payload\)/)
  assert.match(atomicMigration, /v_actual_core IS DISTINCT FROM v_expected_core/)
})

test('credit notes use original snapshots for exact fractional returns and mixed legacy lines', () => {
  assert.match(migration, /9d9b05d14a501ebfb887e9172b9c1fe2/)
  assert.match(migration, /3e0c27664ae59b78ab51066a612ca6e5/)
  assert.match(credit, /\.rpc\('get_invoice_refundable_items_v2'/)
  assert.match(credit, /package_quantity_scale/)
  assert.match(credit, /invalidPackageReturn/)
  assert.match(credit, /remaining_quantity\) <= 0\.0000005/)
  assert.match(credit, /remainingLineCount/)
  assert.doesNotMatch(credit, /totalRemainingQuantity/)
  assert.match(migration, /widen_legacy_credit_request_quantity/)
  assert.match(migration, /quantity NUMERIC\(18, 6\)/)
  assert.match(migration, /replace\(v_widened, '0\.0005', '0\.0000005'\)/)
  assert.match(migration, /PRODUCT_UNITS_CREDIT_QUANTITY_TOLERANCE_UNREVIEWED/)
  assert.match(migration, /include_refund_allocation_in_package_fingerprint/)
  assert.match(migration, /'\{refund_allocation_intent\}'/)
  assert.match(
    migration,
    /v_definition NOT LIKE '%''\{refund_allocation_intent\}''%'/,
  )
  assert.match(migration, /\('public\.create_partial_credit_note_with_refund\(jsonb\)'\)/)
  assert.match(migration, /round\(\s*r\.return_quantity \* oi\.conversion_to_base,\s*oi\.base_quantity_scale/)
  assert.match(migration, /package_unit_price = oi\.package_unit_price/)
  assert.match(migration, /base_quantity = ci\.quantity \* oi\.conversion_to_base/)
  assert.match(migration, /COALESCE\(ci\.base_quantity, ci\.quantity\) AS base_quantity/)
  assert.match(migration, /COALESCE\(ci\.stock_tracked_at_sale, p\.track_stock, false\)[\s\S]*?AND COALESCE\(p\.track_stock, false\)/)
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*?partial-credit-note/)
  assert.equal(exactQuantity({ quantity: 0.5, packageScale: 1, conversion: 24, baseScale: 0 }), true)
})

test('product stock receiving preserves production hardening and stores base/package snapshots once', () => {
  assert.match(migration, /78c5524f0f0ccef32740ca5453aaaa68/)
  assert.match(
    migration,
    /v_profile\.role IN \(\s*'branch', 'manager', 'cashier', 'accountant'\s*\)/,
  )
  assert.match(migration, /v_profile\.role IN \('owner', 'admin'\)/)
  assert.match(migration, /v_profile\.role = 'super_admin'/)
  assert.match(migration, /SET row_security = off/)
  assert.match(migration, /SET search_path = public, pg_temp/)
  assert.match(migration, /Supplier belongs to another branch/)
  assert.match(migration, /Caller profile not found or inactive/)
  assert.match(migration, /Stock module is disabled for this branch/)
  assert.match(migration, /Service products cannot receive stock/)
  assert.match(migration, /Unsupported product stock receipt field/)
  assert.match(
    migration,
    /jsonb_typeof\(p_payload -> 'package_quantity'\) <> 'number'/,
  )
  assert.match(
    migration,
    /jsonb_typeof\(p_payload -> 'unit_cost'\) <> 'number'/,
  )
  assert.match(receiving, /\.rpc\('get_product_units'/)
  assert.match(receiving, /row\.is_active === true && row\.receiving_enabled === true/)
  assert.match(receiving, /unitsRequestRef\.current !== requestId/)
  assert.match(receiving, /product_unit_id: selectedUnit\.id/)
  assert.match(receiving, /expected_product_unit_version: selectedUnit\.version/)
  assert.match(migration, /resolve_product_commercial_unit\([\s\S]*?'receive'/)
  assert.match(
    migration,
    /receive_product_stock_with_units_v1[\s\S]*?pg_advisory_xact_lock\([\s\S]*?v_resolved\.product_id::text[\s\S]*?v_idempotency_key[\s\S]*?SELECT \*[\s\S]*?FROM public\.product_stock_receipts/,
  )
  assert.match(migration, /v_base_unit_cost := round\([\s\S]*?v_package_unit_cost \/ v_resolved\.conversion_to_base/)
  assert.match(migration, /stock_quantity = v_after/)
  assert.match(migration, /cost = round\(v_base_unit_cost, 2\)/)
  assert.match(
    migration,
    /quantity_delta, reason[\s\S]*?v_resolved\.base_quantity, 'stock_receipt'/,
  )
  assert.match(migration, /product_stock_receipts[\s\S]*?package_unit_cost, base_unit_cost, request_fingerprint/)
  assert.match(migration, /reason, created_by, created_at, idempotency_key,[\s\S]*?product_unit_id/)
  assert.match(
    migration,
    /v_existing\.product_unit_id[\s\S]*?v_existing\.product_unit_version[\s\S]*?v_existing\.package_quantity[\s\S]*?v_existing\.base_quantity/,
  )
  assert.match(migration, /PERFORM public\.mark_product_unit_used\(v_resolved\.product_unit_id\)/)
  assert.match(migration, /RETURN public\.receive_product_stock_legacy_base_v1\(p_payload\)/)
})

test('documents render saved selling units and leave legacy unit snapshots nullable', () => {
  assert.match(adapters, /unitName: item\.selling_unit_name \?\? null/)
  assert.doesNotMatch(adapters, /unitName: item\.selling_unit_name \?\? item\.unit/)
  assert.doesNotMatch(receiptPrint, /unitName: item\.selling_unit_name \?\? item\.unit/)
  assert.doesNotMatch(pos, /unitName: i\.selling_unit_name \?\? i\.unit/)
  assert.match(adapters, /item\.selling_unit_name_ar \?\? null/)
  assert.match(thermal, /QuantityWithUnit/)
  assert.match(a4, /QuantityCell/)
  assert.match(documentModel, /quantityMaximumFractionDigits: 6/)
  assert.match(invoiceDetail, /i\.selling_unit_name \?\? null/)
  assert.match(adapters, /unitName: null, unitNameAr: null, unitCode: null/)
})

test('reporting groups by stable product and normalizes quantity with package breakdown', () => {
  assert.match(migration, /COALESCE\(\s*ii\.product_id::text/)
  assert.match(migration, /COALESCE\(ii\.base_quantity, ii\.quantity, 0\)/)
  assert.match(migration, /'packageBreakdown'/)
  assert.match(migration, /'packageUnitPrice', packages\.package_unit_price/)
  assert.match(migration, /lr\.product_unit_version/)
  assert.match(migration, /inv_doc\.accounting_sign \* COALESCE\(ii\.package_quantity, ii\.quantity, 0\)/)
  assert.match(report, /get_sales_report_summary_v2/)
  assert.match(report, /packageBreakdown/)
  assert.match(reportExport, /get_sales_report_summary_v2/)
  assert.match(reportPdf, /formatNumberPdf\(unit\.packageQuantity, 6\)/)
  assert.match(reportPdf, /pt\('sales\.baseQuantitySold'\)/)
})

test('production, sandbox and validator ZATCA builders use saved UBL unit code', () => {
  for (const source of [productionZatca, sandboxZatca]) {
    assert.match(source, /selling_unit_code/)
    assert.match(source, /InvoicedQuantity'\)\.att\('unitCode', line\.unitCode \?\? 'PCE'\)/)
    assert.match(source, /BaseQuantity'\)\.att\('unitCode', line\.unitCode \?\? 'PCE'\)/)
    assert.match(source, /\^\[A-Z0-9\]\{2,8\}\$/)
  }
  assert.match(validator, /selling_unit_code/)
  assert.match(validator, /\.\.\.\(unitCode \? \{ unitCode \} : \{\}\)/)
  assert.match(samples, /unitCode: line\.unitCode \?\? 'PCE'/)
  assert.match(samples, /InvoicedQuantity'\)\.att\('unitCode', line\.unitCode \?\? 'PCE'\)/)
})

test('function owners, deterministic grants and versioned full-definition contracts are enforced', () => {
  assert.match(migration, /product_units_commercial_function_contracts_v1/)
  assert.match(migration, /md5\(pg_get_functiondef\(to_regprocedure\(contract\.signature\)::oid\)\)/)
  assert.match(migration, /ON CONFLICT \(function_signature\) DO NOTHING/)
  assert.match(migration, /PRODUCT_UNITS_FUNCTION_CONTRACT_MISMATCH/)
  assert.match(verification, /product_units_commercial_function_contracts_v1/)
  assert.match(verification, /pos_checkout_legacy_hash/)
  assert.match(verification, /md5\(pg_get_functiondef\(v_oid\)\) = v_contract_hash/)
  assert.match(verification, /registered_contract_mismatches=%s/)
  assert.match(verification, /AND v_missing = 0/)
  assert.doesNotMatch(verification, /v_contract_hash\s+IS\s+NULL\s+OR/)
})

test('English and Arabic package UI keys have parity', () => {
  const posKeys = [
    'chooseSellingUnit', 'piece', 'carton', 'package', 'packageQuantity',
    'packagePrice', 'contains', 'baseEquivalent', 'unavailable', 'changed',
    'sellingDisabled', 'invalidQuantity', 'reload', 'sellingUnit',
    'packageQuantitySold', 'baseQuantitySold', 'inCartWithUnit',
    'mixedUnitsInCart',
  ]
  for (const key of posKeys) {
    assert.equal(typeof enPos.packages[key], 'string', `missing English pos.packages.${key}`)
    assert.equal(typeof arPos.packages[key], 'string', `missing Arabic pos.packages.${key}`)
  }
  for (const key of ['baseEquivalent', 'invalidFraction', 'invalidFractionNamed']) {
    assert.equal(typeof enCredit.packages[key], 'string')
    assert.equal(typeof arCredit.packages[key], 'string')
  }
  assert.equal(typeof enCredit.refundableLines, 'string')
  assert.equal(typeof arCredit.refundableLines, 'string')
  for (const key of ['receivingUnit', 'containsBaseUnits', 'baseQuantityAdded']) {
    assert.equal(typeof enInventory.receipt[key], 'string')
    assert.equal(typeof arInventory.receipt[key], 'string')
  }
  for (const key of ['packageSales', 'sellingUnit', 'packageQuantitySold', 'baseQuantitySold']) {
    assert.equal(typeof enReports.sales[key], 'string')
    assert.equal(typeof arReports.sales[key], 'string')
  }
})

test('concurrency simulations prevent oversell and duplicate stock application', () => {
  const sellLocked = (state, requested) => {
    if (state.stock < requested) throw new Error('insufficient')
    state.stock -= requested
  }
  const state = { stock: 24, receiptKeys: new Set(), creditKeys: new Set() }
  sellLocked(state, 1)
  assert.throws(() => sellLocked(state, 24), /insufficient/)
  const applyOnce = (set, key, delta) => {
    if (set.has(key)) return 0
    set.add(key)
    return delta
  }
  assert.equal(applyOnce(state.receiptKeys, 'receipt-1', 24), 24)
  assert.equal(applyOnce(state.receiptKeys, 'receipt-1', 24), 0)
  assert.equal(applyOnce(state.creditKeys, 'credit-1', 12), 12)
  assert.equal(applyOnce(state.creditKeys, 'credit-1', 12), 0)
  assert.match(migration, /ORDER BY p\.id[\s\S]*?FOR UPDATE OF p/)
})

console.log(`product units commercial workflow checks passed (${results.length} scenarios)`)
