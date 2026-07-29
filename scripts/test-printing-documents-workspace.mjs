import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const workspace = read('../src/pages/branch/PrintingDocumentsPage.tsx')
const invoice = read('../src/pages/branch/InvoiceSettingsPage.tsx')
const designer = read('../src/components/barcodes/BarcodeLabelDesigner.tsx')
const labelSettings = read('../src/components/barcodes/BarcodeLabelSettingsPanel.tsx')
const calibration = read('../src/components/barcodes/BarcodePrinterSetupPanel.tsx')
const geometry = read('../src/lib/barcodes/labelSettings.ts')
const en = JSON.parse(read('../src/localization/locales/en/printing.json'))
const ar = JSON.parse(read('../src/localization/locales/ar-SA/printing.json'))

test('web exposes three areas while Electron retains Printer Setup', () => {
  for (const id of ['receipts', 'invoices', 'barcodeLabels', 'printerSetup']) {
    assert.match(workspace, new RegExp(`id: '${id}'`))
    assert.ok(en.workspace.tabs[id].label)
    assert.ok(ar.workspace.tabs[id].label)
  }
  assert.match(workspace, /role="tablist"/)
  assert.match(workspace, /role="tab"/)
  assert.match(workspace, /aria-selected=\{selected\}/)
  assert.match(workspace, /role="tabpanel"/)
  assert.match(workspace, /ArrowLeft/)
  assert.match(workspace, /document\.documentElement\.dir === 'rtl'/)
  assert.match(workspace, /tab\.id !== 'printerSetup' \|\| electron/)
  assert.match(workspace, /electron && active === 'printerSetup'/)
  assert.match(workspace, /!electron && <details[\s\S]*BarcodePrinterSetupPanel/)
  assert.match(workspace, /useSearchParams/)
  assert.match(workspace, /return 'receipts'/)
})

test('receipt and invoice workspaces retain branch save, reset and preview contracts', () => {
  assert.match(workspace, /<InvoiceSettingsPage key="receipts" embedded workspace="receipts"/)
  assert.match(workspace, /<InvoiceSettingsPage key="invoices" embedded workspace="invoices"/)
  assert.match(invoice, /saveChanges/)
  assert.match(invoice, /resetChanges/)
  assert.match(invoice, /isDirty/)
  assert.match(invoice, /saving/)
  assert.match(invoice, /saveError/)
  assert.match(invoice, /<ThermalReceipt/)
  assert.match(invoice, /<A4Document/)
  assert.match(invoice, /disabled=\{!canEdit \|\| !isDirty \|\| saving/)
})

test('barcode preview uses localized sample fixture copy without a large scope banner', () => {
  assert.match(designer, /previewDataLabel/)
  assert.doesNotMatch(labelSettings, /settings\.help/)
  assert.equal(en.barcodeLabels.preview.sampleTitle, 'Sample preview')
  assert.equal(en.barcodeLabels.preview.sampleHelp, 'This preview uses sample product data.')
  assert.equal(ar.barcodeLabels.preview.sampleTitle, 'معاينة تجريبية')
  assert.equal(ar.barcodeLabels.preview.sampleHelp, 'تستخدم هذه المعاينة بيانات منتج تجريبية.')
})

test('only four supported presets are selectable while deprecated values remain normalizable', () => {
  for (const preset of ['compact_sticker', 'standard_product', 'detailed_product', 'carton_label', 'a4_sheet', 'custom']) {
    assert.match(geometry, new RegExp(`${preset}:`))
  }
  for (const preset of ['compact_sticker', 'standard_product', 'detailed_product', 'carton_label']) {
    assert.match(designer, new RegExp(`'${preset}'`))
  }
  assert.doesNotMatch(designer, /'a4_sheet'|'custom'/)
  assert.match(geometry, /storedPresetId === 'a4_sheet'/)
  assert.match(geometry, /storedPresetId === 'custom'/)
  for (const key of ['productName', 'sellingPrice', 'unitName', 'sku', 'businessName', 'barcodeValue']) {
    assert.match(designer, new RegExp(`'${key}'`))
  }
  assert.match(designer, /barcodeAlwaysIncluded/)
})

test('sample label print uses the existing print document and browser adapter', () => {
  assert.match(designer, /const printPreview/)
  assert.match(designer, /barcodePrintDocument\(labels, settings, calibration/)
  assert.match(designer, /browserBarcodePrintAdapter\.print\(printable\.html\)/)
  assert.match(designer, /if \(!preview \|\| printing\) return/)
  assert.match(designer, /disabled=\{!preview \|\| printing\}/)
  assert.match(designer, /printUnavailable/)
  assert.match(designer, /role="alert"/)
})

test('tight-fit guidance is compact and does not block printing', () => {
  assert.match(designer, /denseTitle/)
  assert.match(designer, /<details/)
  assert.match(designer, /recommendations/)
  assert.match(designer, /border-s-4 bg-\[#fffaf0\]/)
  assert.doesNotMatch(designer, /warnings\.length[\s\S]{0,500}disabled/)
})

test('branch defaults retain explicit save/restore and accurate dirty state', () => {
  assert.match(labelSettings, /JSON\.stringify\(settings\) !== JSON\.stringify\(saved\)/)
  assert.match(labelSettings, /updateBranchBarcodeLabelSettings\(branchId, settings\)/)
  assert.match(labelSettings, /setSaved\(result\.settings\)/)
  assert.match(labelSettings, /disabled=\{!canEdit \|\| !dirty\}/)
  assert.match(labelSettings, /setSettings\(saved\)/)
})

test('device calibration remains local with exact movement and scaling increments', () => {
  assert.match(calibration, /loadBarcodeDeviceCalibration/)
  assert.match(calibration, /saveBarcodeDeviceCalibration\(calibration\)/)
  assert.match(calibration, /resetBarcodeDeviceCalibration\(\)/)
  assert.match(calibration, /horizontalOffsetMm', -0\.5/)
  assert.match(calibration, /horizontalOffsetMm', 0\.5/)
  assert.match(calibration, /verticalOffsetMm', -0\.5/)
  assert.match(calibration, /verticalOffsetMm', 0\.5/)
  assert.match(calibration, /widthScalePercent', -1/)
  assert.match(calibration, /heightScalePercent', 1/)
  assert.match(calibration, /currentValues/)
  assert.match(calibration, /browserBarcodePrintAdapter\.print/)
  assert.doesNotMatch(calibration, /updateBranchBarcodeLabelSettings/)
  assert.doesNotMatch(calibration, /bg-blue-50/)
})
