import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isLowStockProduct } from '../src/lib/products/lowStock.ts'
import { formatSaudiDate, formatSaudiTime } from '../src/lib/utils/date.ts'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')

const tracked = {
  stock_quantity: 4,
  min_stock_alert: 5,
  track_stock: true,
  is_service: false,
  is_active: true,
  is_available: true,
}
assert.equal(isLowStockProduct({ ...tracked, is_service: true }), false)
assert.equal(isLowStockProduct({ ...tracked, track_stock: false }), false)
assert.equal(isLowStockProduct(tracked), true)
assert.equal(isLowStockProduct({ ...tracked, stock_quantity: 5 }), true)
assert.equal(isLowStockProduct({ ...tracked, is_active: false }), false)
assert.equal(isLowStockProduct({ ...tracked, is_available: false }), false)
assert.equal(isLowStockProduct({ ...tracked, min_stock_alert: 0 }), false)

const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const ownerBranch = read('src/pages/admin/BranchDetailPage.tsx')
for (const source of [branchDashboard, ownerBranch]) {
  assert.match(source, /\.eq\('tenant_id',/)
  assert.match(source, /\.eq\('branch_id',/)
  assert.match(source, /\.eq\('track_stock', true\)/)
  assert.match(source, /\.eq\('is_service', false\)/)
  assert.match(source, /isLowStockProduct/)
  assert.match(source, /formatSaudiTime/)
}

const instant = '2026-07-29T12:42:00.000Z'
assert.match(formatSaudiDate(instant, 'en'), /29 Jul 2026/)
assert.match(formatSaudiTime(instant, 'en'), /03:42\s*pm/i)
assert.match(formatSaudiDate(instant, 'ar-SA'), /29/)
assert.match(formatSaudiTime(instant, 'ar-SA'), /03:42/)

const workspace = read('src/pages/branch/PrintingDocumentsPage.tsx')
assert.match(branchDashboard, /\[t\('recent\.invoice'\), t\('recent\.customer'\), t\('recent\.amount'\), t\('recent\.status'\), t\('recent\.date'\), t\('recent\.time'\)\]/)
assert.match(branchDashboard, /data-branch-title-block/)
assert.match(branchDashboard, /dir="ltr" className="relative mx-auto/)
assert.match(branchDashboard, /formatSaudiDate\(invoiceTimestamp/)
assert.match(branchDashboard, /formatSaudiTime\(invoiceTimestamp/)
assert.match(ownerBranch, /'date', 'time'/)
assert.match(workspace, /return 'receipts'/)
assert.match(workspace, /value === 'invoices'/)
assert.match(workspace, /value === 'barcode-labels'/)
assert.match(workspace, /useSearchParams/)
assert.match(workspace, /tab\.id !== 'printerSetup' \|\| electron/)
assert.match(workspace, /electron && active === 'printerSetup'/)
assert.match(workspace, /!electron && <details[\s\S]*BarcodePrinterSetupPanel/)
assert.match(workspace, /setSearchParams\(next\)/)

const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
assert.match(invoiceSettings, /border-gray-200 bg-white/)
assert.match(invoiceSettings, /role="tablist"/)
assert.match(invoiceSettings, /role="radio"/)
assert.match(invoiceSettings, /ThemeChoice/)

const registry = read('src/lib/invoices/a4TemplateRegistry.ts')
const a4 = read('src/components/print/A4Document.tsx')
const css = read('src/index.css')
const migration = read('supabase/migrations/20260729000500_extend_a4_invoice_themes.sql')
const brandingMigration = read('supabase/migrations/20260729000600_extend_a4_invoice_branding.sql')
for (const theme of ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border']) {
  assert.match(registry, new RegExp(`${theme}:`))
}
for (const className of ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border']) {
  assert.match(css, new RegExp(`a4-document--${className}`))
}
assert.match(a4, /options\.nonFiscalDemo/)
assert.doesNotMatch(a4, /SharedA4Layout/)
for (const layout of ['a4-classic-head', 'a4-split-shell', 'a4-minimal-head', 'a4-executive-band', 'a4-ledger-head', 'a4-frame-cards']) assert.match(a4, new RegExp(layout))
assert.match(a4, /page-break-inside|Footer/)
assert.match(css, /a4-document--modern_split \.a4-seller \*/)
assert.match(migration, /validate_invoice_presentation_settings/)
assert.match(migration, /executive_green/)
assert.doesNotMatch(migration, /UPDATE public\.(invoices|payments|products|pos_stock_movements|zatca_)/)
for (const marker of ['accent_color', 'header_asset_path', 'header_asset_enabled', 'header_asset_fit', 'header_asset_height', 'header_asset_spacing']) {
  assert.match(invoiceSettings, new RegExp(marker))
  assert.match(brandingMigration, new RegExp(marker))
}
assert.match(a4, /--a4-accent/)
assert.match(a4, /a4-header-artwork/)
assert.match(invoiceSettings, /A4PreviewFit zoom=\{previewZoom\} bounded/)
assert.match(workspace, /inline-flex max-w-full/)
assert.doesNotMatch(brandingMigration, /UPDATE public\.(invoices|payments|products|pos_stock_movements|zatca_)/)

const barcode = read('src/components/barcodes/BarcodeBatchPrintDrawer.tsx')
const designer = read('src/components/barcodes/BarcodeLabelDesigner.tsx')
const labelSettingsSource = read('src/lib/barcodes/labelSettings.ts')
const labelPrint = read('src/lib/barcodes/labelPrint.ts')
for (const contract of [
  /get_product_units/,
  /list_product_unit_barcodes/,
  /copies/,
  /barcodeRequired/,
  /barcodePrintDocument/,
  /saveAsPdf/,
  /recordBarcodePrintBatch/,
  /generate_internal_product_unit_barcode/,
]) {
  assert.match(barcode, contract)
}
assert.match(barcode, /md:left-\[var\(--app-sidebar-width\)\]/)
assert.match(barcode, /max-h-\[min\(860px,calc\(100dvh-2rem\)\)\]/)
assert.match(barcode, /useDialogFocus/)
assert.match(barcode, /items\.some\(item => !item\.barcode\?\.isActive\)/)
assert.match(barcode, /p_product_unit_id: item\.unit\.id/)
assert.match(barcode, /p_is_primary: true/)
for (const preset of ['compact_sticker', 'standard_product', 'detailed_product', 'carton_label']) assert.match(designer, new RegExp(`'${preset}'`))
assert.doesNotMatch(designer, /'a4_sheet'|'custom'/)
assert.match(labelSettingsSource, /storedPresetId === 'a4_sheet'/)
assert.match(labelSettingsSource, /storedPresetId === 'custom'/)
for (const preset of ['compact_sticker', 'standard_product', 'detailed_product', 'carton_label']) assert.match(labelPrint, new RegExp(`label--preset-${preset}`))

const thermal = read('src/components/print/ThermalReceipt.tsx')
for (const layout of ['compact-retail', 'structured-detail', 'branded-modern']) assert.match(thermal, new RegExp(layout))
assert.match(thermal, /data-receipt-layout/)
assert.match(thermal, /data-qr-placement/)
assert.match(css, /thermal-receipt--58mm\.thermal-theme--structured-detail/)
assert.match(css, /thermal-theme--branded-modern/)

const electron = read('src/lib/electron.ts')
const printerTab = read('src/pages/settings/PrinterTab.tsx')
assert.match(electron, /isElectron/)
assert.match(printerTab, /getPrinters|receiptPrinterName|a4PrinterName|silentPrint/)

console.log('final web printing refinement tests passed')
