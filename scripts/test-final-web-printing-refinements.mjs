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
assert.match(workspace, /return 'receipts'/)
assert.match(workspace, /value === 'invoices'/)
assert.match(workspace, /value === 'barcode-labels'/)
assert.match(workspace, /useSearchParams/)
assert.match(workspace, /tab\.id !== 'printerSetup' \|\| electron/)
assert.match(workspace, /electron && active === 'printerSetup'/)
assert.match(workspace, /!electron && <section[\s\S]*BarcodePrinterSetupPanel/)
assert.match(workspace, /setSearchParams\(next\)/)

const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
assert.match(invoiceSettings, /bg-sidebar/)
assert.match(invoiceSettings, /role="tablist"/)
assert.match(invoiceSettings, /role="radio"/)
assert.match(invoiceSettings, /ThemeChoice/)

const registry = read('src/lib/invoices/a4TemplateRegistry.ts')
const a4 = read('src/components/print/A4Document.tsx')
const css = read('src/index.css')
const migration = read('supabase/migrations/20260729000500_extend_a4_invoice_themes.sql')
for (const theme of ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border']) {
  assert.match(registry, new RegExp(`${theme}:`))
}
for (const className of ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border']) {
  assert.match(css, new RegExp(`a4-document--${className}`))
}
assert.match(a4, /options\.nonFiscalDemo/)
assert.match(a4, /page-break-inside|Footer/)
assert.match(css, /a4-document--modern_split \.a4-seller \*/)
assert.match(migration, /validate_invoice_presentation_settings/)
assert.match(migration, /executive_green/)
assert.doesNotMatch(migration, /UPDATE public\.(invoices|payments|products|pos_stock_movements|zatca_)/)

const barcode = read('src/components/barcodes/BarcodeBatchPrintDrawer.tsx')
for (const contract of [
  /get_product_units/,
  /list_product_unit_barcodes/,
  /copies/,
  /missingBarcode/,
  /barcodePrintDocument/,
  /saveAsPdf/,
  /recordBarcodePrintBatch/,
]) {
  assert.match(barcode, contract)
}

const electron = read('src/lib/electron.ts')
const printerTab = read('src/pages/settings/PrinterTab.tsx')
assert.match(electron, /isElectron/)
assert.match(printerTab, /getPrinters|receiptPrinterName|a4PrinterName|silentPrint/)

console.log('final web printing refinement tests passed')
