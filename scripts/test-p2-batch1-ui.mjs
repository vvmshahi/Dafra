import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const files = {
  confirm: read('src/components/ui/ConfirmDialog.tsx'),
  suppliers: read('src/pages/suppliers/SuppliersPage.tsx'),
  archiveEntity: read('src/lib/archiveEntity.ts'),
  daily: read('src/pages/expenses/DailyExpensesTab.tsx'),
  fixed: read('src/pages/expenses/FixedExpensesTab.tsx'),
  product: read('src/pages/products/ProductDrawer.tsx'),
  dayClose: read('src/pages/day-closing/DayClosingPage.tsx'),
  employees: read('src/pages/employees/EmployeesPage.tsx'),
  client: read('src/pages/super-admin/ClientDetailPage.tsx'),
  zatca: read('src/pages/settings/ZatcaTab.tsx'),
  invoice: read('src/pages/branch/InvoiceSettingsPage.tsx'),
  labels: read('src/components/barcodes/BarcodeLabelSettingsPanel.tsx'),
  designer: read('src/components/barcodes/BarcodeLabelDesigner.tsx'),
  calibration: read('src/components/barcodes/BarcodePrinterSetupPanel.tsx'),
}
const allFrontend = Object.values(files).join('\n')
const expensesEnRaw = read('src/localization/locales/en/expenses.json')
const expensesArRaw = read('src/localization/locales/ar-SA/expenses.json')
const expensesEn = JSON.parse(expensesEnRaw)
const expensesAr = JSON.parse(expensesArRaw)
const suppliersEn = JSON.parse(read('src/localization/locales/en/suppliers.json'))
const suppliersAr = JSON.parse(read('src/localization/locales/ar-SA/suppliers.json'))
const dialogsEn = JSON.parse(read('src/localization/locales/en/dialogs.json'))
const dialogsAr = JSON.parse(read('src/localization/locales/ar-SA/dialogs.json'))

function shape(value) {
  if (value === null || typeof value !== 'object') return typeof value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, shape(value[key])]))
}

function duplicateTopLevelKeys(raw) {
  let depth = 0
  let inString = false
  let escaped = false
  const keys = []
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      if (depth === 1) {
        const match = raw.slice(i).match(/^"((?:\\.|[^"])*)"\s*:/)
        if (match) keys.push(JSON.parse(`"${match[1]}"`))
      }
      inString = true
    } else if (char === '{') depth++
    else if (char === '}') depth--
  }
  return keys.filter((key, index) => keys.indexOf(key) !== index)
}

test('all remaining native browser confirmations are removed', () => {
  assert.doesNotMatch(allFrontend, /window\.confirm|globalThis\.confirm|(?:^|[^.\w])confirm\s*\(/m)
  for (const workflow of ['employees', 'product', 'suppliers', 'dayClose', 'client', 'zatca']) {
    assert.match(files[workflow], /ConfirmDialog/)
  }
})

test('shared dialog owns semantics, focus containment, Escape and restoration', () => {
  assert.match(files.confirm, /role="alertdialog"/)
  assert.match(files.confirm, /aria-labelledby=\{titleId\}/)
  assert.match(files.confirm, /aria-describedby=\{bodyId\}/)
  assert.match(files.confirm, /event\.key === 'Escape'/)
  assert.match(files.confirm, /button:not\(\[disabled\]\)/)
  assert.match(files.confirm, /returnFocusRef\.current\?\.focus\(\)/)
  assert.match(files.confirm, /loading=\{busy\}/)
})

test('supplier archive verifies response before state and toast success', () => {
  assert.match(files.suppliers, /await archiveEntity\(supabase as unknown as ArchiveEntityClient, 'suppliers', target\.id\)/)
  assert.match(files.archiveEntity, /update\(\{ is_active: false \}\).*select\('id'\).*maybeSingle/s)
  assert.match(files.archiveEntity, /result\.data\?\.id !== id/)
  assert.ok(files.suppliers.indexOf('await archiveEntity') < files.suppliers.indexOf('setSuppliers(prev => prev.filter'))
  assert.match(files.suppliers, /archivingIds\.has\(target\.id\)/)
  assert.match(files.suppliers, /toast\.success\(t\('success\.archived'\)\)/)
  assert.match(files.suppliers, /toast\.error\(t\('errors\.archiveFailed'\)\)/)
  assert.doesNotMatch(files.suppliers, /\.from\(['"]suppliers['"]\)\.delete\(/)
  assert.equal(suppliersEn.success.archived, 'Supplier archived successfully.')
  assert.equal(suppliersAr.success.archived, 'تمت أرشفة المورد بنجاح.')
})

test('daily and fixed permanent deletion is confirmed and verified', () => {
  for (const source of [files.daily, files.fixed]) {
    assert.match(source, /kind="delete"/)
    assert.match(source, /busy=\{deleting\}/)
    assert.match(source, /\.delete\(\).*select\('id'\).*maybeSingle\(\)/s)
    assert.match(source, /result\.data\?\.id !== id/)
    assert.match(source, /toast\.error\(t\('errors\.deleteFailed'\)\)/)
  }
  assert.match(files.daily, /setExpenses\(prev => prev\.filter/)
  assert.match(files.fixed, /setItems\(prev => prev\.filter/)
})

test('fixed activation is single-flight and preserves the template contract', () => {
  assert.match(files.fixed, /if \(togglingIds\.has\(id\)\) return/)
  assert.match(files.fixed, /update\(\{ is_active: val \}\).*select\('id,is_active'\)/s)
  assert.match(files.fixed, /disabled=\{toggling\}/)
  assert.doesNotMatch(files.fixed, /expenses.*insert|recurrence|schedule/i)
})

test('printing confirmations state branch and device scope precisely', () => {
  assert.match(files.invoice, /kind="removeLogo"/)
  assert.match(files.invoice, /kind="discard"/)
  assert.match(files.labels, /kind="restoreBranchLabelDefault"/)
  assert.match(files.designer, /kind="resetLabelPreset"/)
  assert.match(files.calibration, /kind="resetDeviceCalibration"/)
  assert.match(dialogsEn.restoreBranchLabelDefault.body, /Device calibration will not be changed/)
  assert.match(dialogsEn.resetDeviceCalibration.body, /branch label design will not change/)
  assert.match(dialogsAr.restoreBranchLabelDefault.body, /معايرة الجهاز/)
})

test('expense locales have no duplicate roots and matching shapes', () => {
  assert.deepEqual(duplicateTopLevelKeys(expensesEnRaw), [])
  assert.deepEqual(duplicateTopLevelKeys(expensesArRaw), [])
  assert.deepEqual(shape(expensesEn), shape(expensesAr))
  assert.equal(typeof expensesEn.fixed, 'object')
  assert.equal(typeof expensesAr.fixed, 'object')
  assert.equal(expensesEn.tabs.daily, 'Daily Expenses')
  assert.equal(expensesEn.tabs.fixed, 'Fixed Expenses')
  assert.equal(expensesAr.tabs.fixed, 'المصروفات الثابتة')
  assert.ok(!Object.hasOwn(expensesEn, 'daily'))
  assert.ok(!Object.hasOwn(expensesAr, 'daily'))
})

test('touched dialog and supplier locale shapes match and leaves are non-empty', () => {
  assert.deepEqual(shape(dialogsEn), shape(dialogsAr))
  assert.deepEqual(shape(suppliersEn), shape(suppliersAr))
  const verify = value => {
    if (value && typeof value === 'object') return Object.values(value).forEach(verify)
    assert.equal(typeof value, 'string')
    assert.ok(value.trim())
  }
  ;[dialogsEn, dialogsAr, suppliersEn, suppliersAr].forEach(verify)
})
