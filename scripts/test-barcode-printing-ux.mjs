import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JsBarcode from 'jsbarcode'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')
const importSource = async source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const transpile = source => ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const importPureTypeScript = path => importSource(transpile(read(path)))

const settingsModule = await importPureTypeScript('src/lib/barcodes/labelSettings.ts')
const queueModule = await importPureTypeScript('src/lib/barcodes/labelQueue.ts')
const barcodeModule = await importPureTypeScript('src/lib/barcodes/barcode.ts')

globalThis.__BARCODE_TEST_SETTINGS__ = settingsModule
globalThis.__BARCODE_TEST_VALIDATION__ = barcodeModule
globalThis.__BARCODE_TEST_JSBARCODE__ = JsBarcode

const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.window = dom.window
globalThis.document = dom.window.document

let printModuleSource = transpile(read('src/lib/barcodes/labelPrint.ts'))
printModuleSource = printModuleSource
  .replace("import JsBarcode from 'jsbarcode';", 'const JsBarcode = globalThis.__BARCODE_TEST_JSBARCODE__;')
  .replace("import { validateBarcode } from './barcode';", 'const { validateBarcode } = globalThis.__BARCODE_TEST_VALIDATION__;')
  .replace(
    /import \{([\s\S]*?)\} from ['"]\.\/labelSettings['"];/,
    'const {$1} = globalThis.__BARCODE_TEST_SETTINGS__;',
  )
const printModule = await importSource(printModuleSource)

const {
  DEFAULT_BARCODE_DEVICE_CALIBRATION,
  LABEL_PRESETS,
  loadBarcodeDeviceCalibration,
  normalizeBarcodeLabelSettings,
  resetBarcodeDeviceCalibration,
  saveBarcodeDeviceCalibration,
  serializeBarcodeLabelSettings,
  settingsFromPreset,
} = settingsModule
const {
  barcodePrintLayout,
  barcodePrintDocument,
} = printModule
const {
  barcodeQueueTotal,
  clearBarcodePrintQueue,
  loadBarcodePrintQueue,
  mergeBarcodePrintQueue,
  queueItemKey,
  saveBarcodePrintQueue,
  updateBarcodeQueueCopies,
} = queueModule

// Presets and settings are immutable inputs, not mutable global templates.
assert.deepEqual(Object.keys(LABEL_PRESETS), [
  'compact_sticker',
  'standard_product',
  'detailed_product',
  'carton_label',
  'a4_sheet',
  'custom',
])
assert.deepEqual(
  Object.values(LABEL_PRESETS).map(value => [value.widthMm, value.heightMm]),
  [[38, 25], [50, 30], [60, 40], [100, 50], [63.5, 33.9], [50, 30]],
)
assert.ok(Object.values(LABEL_PRESETS).every(Object.isFrozen))
assert.ok(Object.values(LABEL_PRESETS).every(value => Object.isFrozen(value.content) && Object.isFrozen(value.a4)))
const customized = settingsFromPreset('standard_product')
customized.widthMm = 75
customized.content.businessName = false
assert.equal(LABEL_PRESETS.standard_product.widthMm, 50)
assert.equal(LABEL_PRESETS.standard_product.content.businessName, true)
assert.equal(settingsFromPreset('standard_product').widthMm, 50, 'reset recreates preset defaults')
for (const id of Object.keys(LABEL_PRESETS)) {
  const presetSettings = settingsFromPreset(id)
  const presetLayout = barcodePrintLayout(1, { ...presetSettings, outputMode: 'a4' })
  assert.equal(
    presetLayout.fits,
    true,
    `${id} includes a usable A4 grid`,
  )
  assert.equal(presetLayout.warnings.includes('contentMayClip'), false, `${id} content fits its default label`)
}

const normalized = normalizeBarcodeLabelSettings({
  preset_id: 'carton_label',
  width_mm: 999,
  default_copies: 999,
  content: {
    product_name: false,
    product_name_ar: false,
    product_name_en: false,
    selling_price: false,
    unit_name: false,
    sku: false,
    business_name: false,
    barcode_value: false,
    print_date: false,
  },
})
assert.equal(normalized.widthMm, 200)
assert.equal(normalized.defaultCopies, 500)
assert.equal(normalized.content.productName, true, 'an empty visible-content configuration is repaired')
assert.equal(normalized.orientation, 'landscape')
const serialized = serializeBarcodeLabelSettings(normalized)
assert.equal(serialized.preset_id, 'carton_label')
assert.equal(serialized.content.product_name, true)
assert.equal(serialized.a4.start_row, 1)
assert.deepEqual(Object.keys(serialized).sort(), [
  'a4', 'barcode_height_mm', 'content', 'default_copies', 'height_mm',
  'margin_mm', 'orientation', 'output_mode', 'preset_id', 'price_style',
  'product_name_size', 'schema_version', 'template_id', 'text_alignment', 'width_mm',
])

// Device calibration is local, bounded, reloadable, and resettable.
const storageValues = new Map()
const storage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: key => storageValues.delete(key),
}
const savedCalibration = saveBarcodeDeviceCalibration({
  ...DEFAULT_BARCODE_DEVICE_CALIBRATION,
  printerName: '  Counter printer  ',
  horizontalOffsetMm: 50,
  widthScalePercent: 50,
  orientationOverride: 'portrait',
}, storage)
assert.equal(savedCalibration.printerName, 'Counter printer')
assert.equal(savedCalibration.horizontalOffsetMm, 10)
assert.equal(savedCalibration.widthScalePercent, 90)
assert.equal(loadBarcodeDeviceCalibration(storage).orientationOverride, 'portrait')
assert.equal(resetBarcodeDeviceCalibration(storage).horizontalOffsetMm, 0)
assert.equal(loadBarcodeDeviceCalibration(storage).orientationOverride, 'branch')

const sampleLabel = {
  barcodeId: 'barcode-1',
  productId: 'product-1',
  productUnitId: 'unit-piece',
  barcode: 'DF001234567890123456',
  barcodeType: 'code128',
  businessName: 'مؤسسة <Dafra>',
  productName: 'Coffee <script>alert(1)</script>',
  productNameAr: 'قهوة',
  productNameEn: 'Coffee',
  unitName: 'Piece',
  price: 'SAR 12.00',
  sku: 'SKU-001',
  copies: 1,
}

// Thermal output is physically sized and orientation/calibration aware.
const standard = settingsFromPreset('standard_product')
assert.deepEqual(
  [barcodePrintLayout(1, standard).pageWidthMm, barcodePrintLayout(1, standard).pageHeightMm],
  [50, 30],
)
const portraitDocument = barcodePrintDocument(
  [sampleLabel],
  standard,
  { ...DEFAULT_BARCODE_DEVICE_CALIBRATION, orientationOverride: 'portrait' },
)
assert.equal(portraitDocument.layout.pageWidthMm, 30)
assert.equal(portraitDocument.layout.pageHeightMm, 50)
assert.match(portraitDocument.html, /@page \{ size: 30mm 50mm;/)
assert.match(portraitDocument.html, /print-page--thermal/)
assert.match(portraitDocument.html, /transform:translate\(0mm,0mm\) scale\(1,1\)/)

// A4 page distribution includes partial-sheet start position and final-page count.
const sheet = normalizeBarcodeLabelSettings({
  ...settingsFromPreset('a4_sheet'),
  outputMode: 'a4',
  a4: {
    ...settingsFromPreset('a4_sheet').a4,
    columns: 3,
    rows: 8,
    startRow: 2,
    startColumn: 3,
  },
})
const a4Layout = barcodePrintLayout(35, sheet)
assert.equal(a4Layout.leadingEmptyCells, 5)
assert.equal(a4Layout.labelsPerPage, 24)
assert.equal(a4Layout.pageCount, 2)
assert.equal(a4Layout.labelsOnFinalPage, 16)
assert.equal(a4Layout.pageWidthMm, 210)
assert.equal(barcodePrintLayout(1, {
  ...sheet,
  a4: { ...sheet.a4, orientation: 'landscape' },
}).pageWidthMm, 297)
assert.equal(barcodePrintLayout(1, {
  ...sheet,
  widthMm: 200,
  heightMm: 200,
}).fits, false)
const a4Preview = barcodePrintDocument(
  [{ ...sampleLabel, copies: 35 }],
  sheet,
  DEFAULT_BARCODE_DEVICE_CALIBRATION,
  { preview: true },
)
assert.match(a4Preview.html, /print-page--a4/)
assert.match(a4Preview.html, /empty-cell/)
assert.match(a4Preview.html, /\.is-preview \.print-page \{ zoom:0\./)

// Renderer covers templates, RTL/LTR, safe escaping, exact copies, and the 500-label ceiling.
for (const templateId of ['compact', 'standard', 'detailed']) {
  const output = barcodePrintDocument([sampleLabel], {
    ...standard,
    templateId,
    content: {
      ...standard.content,
      productName: false,
      productNameAr: true,
      productNameEn: true,
    },
  }).html
  assert.match(output, new RegExp(`label--${templateId}`))
  assert.match(output, /dir="rtl">قهوة/)
  assert.match(output, /dir="ltr">Coffee/)
  assert.match(output, /&lt;Dafra&gt;/)
  assert.doesNotMatch(output, /<script>alert\(1\)<\/script>/)
  assert.match(output, /DF001234567890123456/)
  assert.match(output, /padding-inline:2\.5mm/)
  assert.match(output, /shape-rendering:crispEdges/)
}
const bilingualSettings = {
  ...standard,
  templateId: 'detailed',
  content: {
    ...standard.content,
    productName: false,
    productNameAr: true,
    productNameEn: true,
  },
}
const englishOnly = barcodePrintDocument([{
  ...sampleLabel,
  productName: 'English only',
  productNameAr: null,
  productNameEn: 'English only',
}], bilingualSettings).html
assert.equal((englishOnly.match(/>English only<\/div>/g) ?? []).length, 1)
assert.match(englishOnly, /product-name--en" dir="ltr">English only/)
const arabicOnly = barcodePrintDocument([{
  ...sampleLabel,
  productName: 'عربي فقط',
  productNameAr: 'عربي فقط',
  productNameEn: null,
}], bilingualSettings).html
assert.equal((arabicOnly.match(/>عربي فقط<\/div>/g) ?? []).length, 1)
assert.match(arabicOnly, /product-name--ar" dir="rtl">عربي فقط/)
assert.match(
  barcodePrintDocument([{
    ...sampleLabel,
    barcode: '000012345678901234',
    unitName: 'Carton · 12 pieces',
  }], settingsFromPreset('carton_label')).html,
  /000012345678901234[\s\S]*Carton · 12 pieces|Carton · 12 pieces[\s\S]*000012345678901234/,
)
assert.throws(
  () => barcodePrintDocument([{ ...sampleLabel, barcode: '4006381333932', barcodeType: 'ean13' }], standard),
  /invalidCheckDigit/,
)
assert.equal(barcodePrintDocument([{ ...sampleLabel, copies: 10 }], standard).layout.labelCount, 10)
const generationStarted = performance.now()
const maxDocument = barcodePrintDocument([{ ...sampleLabel, copies: 500 }], standard)
const generationMs = performance.now() - generationStarted
assert.equal(maxDocument.layout.labelCount, 500)
assert.equal(maxDocument.layout.pageCount, 500)
assert.ok(generationMs < 2_000, `500-label document model took ${generationMs.toFixed(1)} ms`)

// Queue is ordered, unit-aware, duplicate-safe, bounded, and session-expiring.
const unit = { id: 'unit-piece', name: 'Piece', nameAr: 'حبة', isBase: true, price: 'SAR 12.00' }
const carton = { id: 'unit-carton', name: 'Carton', nameAr: 'كرتون', isBase: false, price: 'SAR 120.00' }
const barcode = {
  id: 'barcode-piece', productUnitId: unit.id, value: sampleLabel.barcode,
  type: 'code128', isPrimary: true, isActive: true,
}
const makeItem = (selectedUnit, selectedBarcode, copies = 1) => ({
  key: '',
  productId: 'product-1',
  productName: 'Coffee',
  productNameAr: 'قهوة',
  sku: 'SKU-001',
  unit: selectedUnit,
  barcode: selectedBarcode,
  copies,
})
let queue = mergeBarcodePrintQueue([], makeItem(unit, barcode, 2))
queue = mergeBarcodePrintQueue(queue, makeItem(unit, barcode, 3))
assert.equal(queue.length, 1)
assert.equal(queue[0].copies, 5)
queue = mergeBarcodePrintQueue(queue, makeItem(carton, {
  ...barcode, id: 'barcode-carton', productUnitId: carton.id,
}, 4))
assert.equal(queue.length, 2)
assert.deepEqual(queue.map(item => item.unit.id), ['unit-piece', 'unit-carton'])
assert.equal(barcodeQueueTotal(queue), 9)
queue = updateBarcodeQueueCopies(queue, queue[0].key, 11)
assert.equal(queue[0].copies, 11)
assert.equal(queueItemKey('product-1', 'unit-piece', null), 'product-1:unit-piece:missing')
saveBarcodePrintQueue('branch-1', queue, storage, 1_000)
assert.equal(loadBarcodePrintQueue('branch-1', storage, 1_001).length, 2)
assert.deepEqual(loadBarcodePrintQueue('branch-1', storage, 1_000 + 9 * 60 * 60 * 1000), [])
clearBarcodePrintQueue('branch-1', storage)
assert.deepEqual(loadBarcodePrintQueue('branch-1', storage), [])

const migration = read('supabase/migrations/20260726000300_barcode_label_printing_settings.sql')
const originalBarcodeMigration = read('supabase/migrations/20260726000100_product_unit_barcodes.sql')
const api = read('src/lib/barcodes/labelApi.ts')
const designer = read('src/components/barcodes/BarcodeLabelDesigner.tsx')
const quickPrint = read('src/components/barcodes/BarcodeQuickPrintDialog.tsx')
const batch = read('src/components/barcodes/BarcodeBatchPrintDrawer.tsx')
const settingsPanel = read('src/components/barcodes/BarcodeLabelSettingsPanel.tsx')
const calibrationPanel = read('src/components/barcodes/BarcodePrinterSetupPanel.tsx')
const productBarcodes = read('src/pages/products/ProductBarcodesSection.tsx')
const productsPage = read('src/pages/products/ProductsPage.tsx')
const workspace = read('src/pages/branch/PrintingDocumentsPage.tsx')
const app = read('src/App.tsx')
const preflight = read('scripts/sql/barcode-printing-ux/01_preflight.sql')
const verification = read('scripts/sql/barcode-printing-ux/02_post_migration_verification.sql')
const runtime = read('scripts/sql/barcode-printing-ux/03_isolated_runtime_test.sql')

// Branch defaults use narrow RPCs; direct writes remain unavailable.
assert.match(migration, /CREATE TABLE public\.branch_barcode_label_settings/)
assert.match(migration, /FOREIGN KEY \(branch_id, tenant_id\)/)
assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
assert.match(migration, /REVOKE ALL ON TABLE public\.branch_barcode_label_settings[\s\S]*PUBLIC, anon, authenticated/)
assert.match(migration, /CREATE POLICY branch_barcode_label_settings_service_role/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_branch_barcode_label_settings/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_branch_barcode_label_settings/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_product_barcode_print_status/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_product_barcode_print_batch/)
assert.match(migration, /SET search_path = public, pg_temp/g)
assert.match(migration, /SET row_security = off/g)
assert.match(migration, /jsonb_object_keys\(p_settings\)\) <> 15/)
assert.match(migration, /jsonb_object_keys\(v_content\)\) <> 9/)
assert.match(migration, /jsonb_object_keys\(v_a4\)\) <> 11/)
assert.match(migration, /CONSTRAINT branch_barcode_label_settings_valid/)
assert.match(migration, /item \?& ARRAY\['barcode_id', 'copies'\]/)
assert.match(migration, /public\.record_product_barcode_print\(/, 'batch audit delegates classification to the established server function')
assert.match(originalBarcodeMigration, /first_print[\s\S]*reprint/)
assert.match(originalBarcodeMigration, /copies > 50[\s\S]*reason/)
assert.match(api, /serializeBarcodeLabelSettings/)
assert.match(api, /record_product_barcode_print_batch/)
assert.doesNotMatch(
  api.slice(api.indexOf("rpc('record_product_barcode_print_batch'")),
  /print_kind/,
  'the client never supplies first/reprint classification',
)

// The new IA and workflows keep simple choices first and technical controls collapsed.
for (const tab of ['receipts', 'invoices', 'barcodeLabels', 'printerSetup']) {
  assert.match(workspace, new RegExp(`id: '${tab}'`))
}
assert.match(workspace, /workspace\.tabs\.\$\{tab\.id\}\.label/)
assert.match(app, /PrintingDocumentsPage/)
assert.match(designer, /<details[\s\S]*barcodeLabels\.advanced\.title/)
assert.match(designer, /barcodeLabels\.presets\./)
assert.match(designer, /barcodeLabels\.templates\./)
assert.match(designer, /barcodeLabels\.content\./)
assert.match(settingsPanel, /updateBranchBarcodeLabelSettings/)
assert.match(settingsPanel, /setSettings\(saved\)/)
assert.match(calibrationPanel, /saveBarcodeDeviceCalibration/)
assert.match(calibrationPanel, /calibrationPattern: true/)
assert.match(calibrationPanel, /getPrinters/)
assert.match(read('src/lib/barcodes/labelPrint.ts'), /preview\.opener = null/)
assert.match(quickPrint, /recordBarcodePrintBatch/)
assert.match(quickPrint, /normalizedCopies > 50/)
assert.match(quickPrint, /role="dialog"/)
assert.match(quickPrint, /hasPrinted === null/)
assert.doesNotMatch(quickPrint, /create_product_unit_barcode|generate_internal_product_unit_barcode/)
assert.match(batch, /sessionStorage|loadBarcodePrintQueue/)
assert.match(batch, /queuedProductIds/)
assert.match(batch, /item\.barcode\?\.isActive/)
assert.match(batch, /total > 500/)
assert.match(batch, /recordBarcodePrintBatch/)
assert.match(batch, /role="dialog"/)
assert.match(productBarcodes, /getProductBarcodePrintStatus/)
assert.match(productBarcodes, /BarcodeQuickPrintDialog/)
assert.doesNotMatch(productBarcodes, /print_kind:\s*'reprint'/)
assert.match(productsPage, /BarcodeBatchPrintDrawer/)

// SQL artifacts are read-only/rollback-safe and SQL Editor compatible.
assert.match(preflight, /BEGIN TRANSACTION READ ONLY;/)
assert.match(preflight, /ROLLBACK;/)
assert.match(verification, /BEGIN TRANSACTION READ ONLY;/)
assert.match(verification, /ROLLBACK;/)
for (const fingerprint of [
  'invoice_presentation_fingerprint',
  'barcode_identity_fingerprint',
  'print_event_fingerprint',
]) {
  assert.match(preflight, new RegExp(fingerprint))
  assert.match(verification, new RegExp(fingerprint))
}
assert.match(verification, /pg_get_constraintdef/)
assert.match(verification, /pg_indexes/)
assert.match(runtime, /BEGIN;/)
assert.match(runtime, /ROLLBACK;/)
assert.match(runtime, /first_print/)
assert.match(runtime, /reprint/)
assert.match(runtime, /copies', 51/)
assert.match(runtime, /has_table_privilege\('authenticated'/)
assert.doesNotMatch(`${preflight}\n${verification}\n${runtime}`, /^\\/m)

// English and Arabic keys stay in lockstep for the complete new workspace.
const en = JSON.parse(read('src/localization/locales/en/printing.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/printing.json'))
const leafKeys = (value, prefix = '') => Object.entries(value).flatMap(([key, entry]) => {
  const path = prefix ? `${prefix}.${key}` : key
  return entry && typeof entry === 'object' ? leafKeys(entry, path) : [path]
}).sort()
assert.deepEqual(leafKeys(en.workspace), leafKeys(ar.workspace))
assert.deepEqual(leafKeys(en.barcodeLabels), leafKeys(ar.barcodeLabels))
const resolveKey = (value, key) => key.split('.').reduce((current, part) => current?.[part], value)
for (const source of [
  designer, quickPrint, batch, settingsPanel, calibrationPanel, workspace,
]) {
  for (const match of source.matchAll(/\bt\(['"]([^'"`]+)['"]/g)) {
    assert.notEqual(resolveKey(en, match[1]), undefined, `missing English printing key ${match[1]}`)
    assert.notEqual(resolveKey(ar, match[1]), undefined, `missing Arabic printing key ${match[1]}`)
  }
}

console.log(`barcode printing UX tests passed (500-label document: ${generationMs.toFixed(1)} ms)`)
