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
const studio = read('../src/components/printing/DocumentStudioShell.tsx')
const a4Fit = read('../src/components/print/A4PreviewFit.tsx')
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
  assert.match(workspace, /printerAdjustment=\{<BarcodePrinterSetupPanel/)
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

test('barcode preview uses localized sample fixture copy without the long branch paragraph', () => {
  assert.match(designer, /previewDataLabel/)
  assert.doesNotMatch(labelSettings, /settings\.help/)
  assert.doesNotMatch(labelSettings, /Branch label default/)
  assert.equal(en.barcodeLabels.preview.sampleTitle, 'Sample preview')
  assert.equal(en.barcodeLabels.preview.sampleHelp, 'This preview uses sample product data.')
  assert.equal(ar.barcodeLabels.preview.sampleTitle, 'معاينة تجريبية')
  assert.equal(ar.barcodeLabels.preview.sampleHelp, 'تستخدم هذه المعاينة بيانات منتج تجريبية.')
})

test('one document studio shell owns bounded panes, preview chrome and the action footer', () => {
  assert.match(invoice, /<DocumentStudioWorkspace/)
  assert.match(designer, /<DocumentStudioWorkspace/)
  assert.match(invoice, /<DocumentStudioActionFooter/)
  assert.match(labelSettings, /<DocumentStudioActionFooter/)
  assert.match(studio, /document-studio-header|document-studio-workspace/)
  assert.match(studio, /document-studio-preview-toolbar/)
  assert.match(studio, /document-studio-action-footer/)
  assert.match(studio, /grid min-h-0 flex-1 overflow-hidden/)
  assert.match(studio, /overflow-y-auto overscroll-contain/)
  assert.match(studio, /document-studio-preview-canvas min-h-0 flex-1 overscroll-contain/)
  assert.match(studio, /previewOverflow === 'hidden' \? 'overflow-hidden' : 'overflow-auto'/)
  assert.doesNotMatch(studio, /calc\(100vh|h-\[[0-9]+vh\]/)
  assert.doesNotMatch(a4Fit, /calc\(100dvh/)
  assert.match(a4Fit, /bounded \? 'h-full min-h-0 overflow-auto'/)
})

test('secondary navigation is compact, routed, keyboard accessible and safely normalized', () => {
  assert.match(studio, /DocumentStudioSectionNav/)
  assert.match(studio, /ArrowUp/)
  assert.match(studio, /ArrowDown/)
  assert.match(studio, /ArrowLeft/)
  assert.match(studio, /ArrowRight/)
  assert.match(studio, /aria-current=\{selected/)
  assert.match(invoice, /searchParams\.get\('section'\)/)
  assert.match(invoice, /allowedSections\.includes/)
  assert.match(invoice, /next\.set\('section', nextSection\)/)
  assert.match(designer, /BARCODE_STUDIO_SECTIONS/)
  assert.match(designer, /next\.set\('section', 'layout'\)/)
})

test('responsive settings drawer traps focus, supports Escape and does not duplicate preview', () => {
  assert.match(studio, /useDialogFocus\(drawerState\.open/)
  assert.match(studio, /role="dialog"/)
  assert.match(studio, /aria-modal="true"/)
  assert.match(studio, /xl:hidden/)
  assert.match(studio, /xl:grid-cols-\[minmax\(400px,440px\)_minmax\(0,1fr\)\]/)
  assert.match(studio, /w-\[min\(92%,440px\)\]/)
  assert.equal((studio.match(/\{preview\}/g) ?? []).length, 1)
})

test('primary workspace changes preserve route history and confirm before discarding edits', () => {
  assert.match(workspace, /setPendingWorkspace\(workspace\)/)
  assert.match(workspace, /requestedWorkspace !== active/)
  assert.match(workspace, /restored\.set\('tab', queryValue\[active\]\)/)
  assert.match(workspace, /<ConfirmDialog open=\{pendingWorkspace !== null\} kind="discard"/)
  assert.match(workspace, /next\.delete\('section'\)/)
  assert.match(workspace, /setSearchParams\(next\)/)
  assert.match(invoice, /onDirtyChange\?\.\(isDirty\)/)
  assert.match(labelSettings, /onDirtyChange\?\.\(dirty\)/)
})

test('English and Arabic expose the same studio navigation and status contract', () => {
  for (const locale of [en, ar]) {
    assert.ok(locale.workspace.about)
    assert.ok(locale.workspace.status.saved)
    assert.ok(locale.workspace.status.unsaved)
    assert.ok(locale.workspace.studio.configuration)
    assert.ok(locale.workspace.studio.settings)
    assert.ok(locale.workspace.studio.closeSettings)
    for (const area of ['receipts', 'invoices']) assert.ok(locale.workspace.sections[area])
    for (const section of ['layout', 'size', 'information', 'appearance', 'printer']) {
      assert.ok(locale.barcodeLabels.studio.sections[section])
    }
  }
})

test('only four supported presets are selectable while deprecated values remain normalizable', () => {
  for (const preset of ['compact_sticker', 'standard_product', 'detailed_product', 'carton_label', 'a4_sheet', 'custom']) {
    assert.match(geometry, new RegExp(`${preset}:`))
  }
  for (const preset of ['compact_sticker', 'standard_product', 'detailed_product', 'carton_label']) {
    assert.match(geometry, new RegExp(`'${preset}'`))
  }
  assert.match(designer, /PRIMARY_LABEL_PRESET_IDS\.map/)
  assert.doesNotMatch(designer, /applyPreset\('a4_sheet'\)|applyPreset\('custom'\)/)
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
  assert.match(designer, /preview\.layout\.warnings\.map/)
  assert.match(designer, /fitGuidance/)
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

test('barcode configuration receives a compact rail and readable horizontal layout choices', () => {
  assert.match(studio, /width\?: 'default' \| 'compact'/)
  assert.match(studio, /width === 'compact' \? 'xl:w-\[100px\]' : 'xl:w-\[124px\]'/)
  assert.match(designer, /width="compact"/)
  assert.match(designer, /studio \? 'grid-cols-1' : 'sm:grid-cols-2'/)
  assert.match(designer, /role="radiogroup"/)
  assert.match(designer, /role="radio"/)
  assert.match(designer, /aria-checked=\{selected\}/)
  assert.match(designer, /min-h-\[70px\]/)
  assert.match(designer, /flex w-24 shrink-0 justify-center/)
  assert.equal((designer.match(/<LayoutMiniature id=\{id\}/g) ?? []).length, 1)
  assert.match(designer, /PRIMARY_LABEL_PRESET_IDS\.map/)
  assert.match(studio, /xl:grid-cols-\[minmax\(400px,440px\)_minmax\(0,1fr\)\]/, 'shared preview split stays unchanged')
})

test('barcode sections use compact controls and collapsed device adjustment without changing persistence', () => {
  assert.match(designer, /min-h-9 rounded-lg border px-2\.5 py-1\.5 text-\[11px\]/)
  assert.match(designer, /studio \? 'grid-cols-1 gap-1\.5'/)
  assert.match(designer, /grid min-h-11 grid-cols-\[minmax\(0,1fr\)_minmax\(112px,44%\)\]/)
  assert.match(designer, /activeSection === 'printer' && <details/)
  assert.doesNotMatch(designer, /activeSection === 'printer' && <details[^>]*open/)
  assert.match(workspace, /<BarcodePrinterSetupPanel branchId=\{branchId\} businessName=\{businessName\} compact/)
  assert.match(calibration, /isElectron\(\) && <label/)
  assert.match(calibration, /!compact && <aside/)
  assert.match(labelSettings, /updateBranchBarcodeLabelSettings\(branchId, settings\)/)
  assert.match(labelSettings, /setSaved\(result\.settings\)/)
})

test('configuration scroll resets per selected section while remaining independent of preview and footer', () => {
  assert.match(studio, /configurationKey\?: string/)
  assert.match(studio, /desktopConfigurationRef\.current\?\.scrollTo\(\{ top: 0 \}\)/)
  assert.match(studio, /drawerConfigurationRef\.current\?\.scrollTo\(\{ top: 0 \}\)/)
  assert.match(studio, /\[configurationKey\]/)
  assert.match(designer, /configurationKey=\{activeSection\}/)
  assert.match(studio, /document-studio-preview-canvas min-h-0 flex-1/)
  assert.match(studio, /document-studio-action-footer/)
})

test('bilingual language cards use separate primary and secondary copy in English and Arabic', () => {
  assert.equal(en.invoiceSettings.general.bilingual, 'Bilingual')
  assert.equal(en.invoiceSettings.general.bilingualLanguages, 'Arabic + English')
  assert.equal(ar.invoiceSettings.general.bilingual, 'ثنائية اللغة')
  assert.equal(ar.invoiceSettings.general.bilingualLanguages, 'العربية + الإنجليزية')
  assert.ok(!JSON.stringify(en).includes(['Bilingual', 'Arabic + English'].join(' — ')))
  assert.ok(!JSON.stringify(ar).includes(['ثنائية اللغة', 'العربية والإنجليزية'].join(' — ')))
  assert.match(invoice, /description: t\('printing:invoiceSettings\.general\.bilingualLanguages'\)/)
  assert.match(workspace, /workspace="receipts"/)
  assert.match(workspace, /workspace="invoices"/)
})
