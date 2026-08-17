import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const daily = read('../src/pages/expenses/DailyExpenseModal.tsx')
const fixed = read('../src/pages/expenses/FixedExpenseModal.tsx')
const shell = read('../src/pages/expenses/ExpenseModalShell.tsx')
const dailyTab = read('../src/pages/expenses/DailyExpensesTab.tsx')
const fixedTab = read('../src/pages/expenses/FixedExpensesTab.tsx')
const page = read('../src/pages/expenses/ExpensesPage.tsx')
const vat = read('../src/lib/utils/expenseVat.ts')
const types = read('../src/types/database.ts')
const en = JSON.parse(read('../src/localization/locales/en/expenses.json'))
const ar = JSON.parse(read('../src/localization/locales/ar-SA/expenses.json'))

test('daily and fixed workflows use one centered accessible modal shell', () => {
  assert.match(daily, /<ExpenseModalShell/)
  assert.match(fixed, /<ExpenseModalShell/)
  assert.match(shell, /role="dialog"/)
  assert.match(shell, /aria-modal="true"/)
  assert.match(shell, /items-center justify-center/)
  assert.match(shell, /max-w-\[920px\]/)
  assert.match(shell, /event\.key === 'Escape'/)
  assert.match(shell, /event\.key !== 'Tab'/)
  assert.doesNotMatch(`${daily}${fixed}${dailyTab}${fixedTab}`, /Drawer|inset-y-0 right-0/)
  assert.doesNotMatch(`${daily}${fixed}`, /role="tab"/)
})

test('daily create/update table, scope and payload keys remain intact', () => {
  assert.match(daily, /\.from\('expenses'\)\.insert\(payload\)/)
  assert.match(daily, /\.from\('expenses'\)\.update\(payload\)\.eq\('id', expense\.id\)/)
  for (const key of [
    'tenant_id', 'branch_id', 'added_by', 'category_id', 'expense_date', 'description',
    'vendor_name', 'amount', 'vat_treatment', 'vat_claim_status', 'expense_before_vat',
    'vat_amount', 'total_paid', 'payment_method', 'tax_invoice_number',
    'supplier_vat_number', 'supplier_id', 'supplier_cr_number', 'supplier_contact',
    'invoice_time', 'receipt_url', 'notes',
  ]) assert.match(daily, new RegExp(`${key}:`))
})

test('actual expense requires explicit VAT, price treatment and payment choices', () => {
  assert.match(daily, /description\.trim\(\)/)
  assert.match(daily, /amountNum <= 0/)
  assert.match(daily, /if \(!date\)/)
  assert.match(daily, /vatChoice === 'claimable'/)
  assert.match(vat, /vatAmount = roundMoney\\?/)
  assert.match(vat, /\(totalPaid \* 15\) \/ 115/)
  assert.match(vat, /expenseBeforeVat \+ vatAmount - totalPaid/)
  for (const value of ['cash', 'card', 'bank_transfer']) {
    assert.match(daily, new RegExp(`value: '${value}'`))
  }
  assert.match(daily, /useState<SimpleExpenseVatChoice \| ''>\(''\)/)
  assert.match(daily, /useState<ExpensePaymentMethod \| ''>\(''\)/)
  assert.match(daily, /priceTreatmentRequired/)
  assert.match(daily, /expense-price-treatment/)
  assert.match(daily, /paymentMethodRequired/)
  assert.match(daily, /type="radio" name="expense-vat"/)
  assert.match(daily, /type="radio" name="expense-payment"/)
})

test('supplier source safely separates saved, manual and no-supplier values', () => {
  assert.match(daily, /'none' \| 'saved' \| 'manual'/)
  assert.match(daily, /source === 'none'/)
  assert.match(daily, /source === 'manual'/)
  assert.match(daily, /selectSupplier\(suppliers\[0\]\.id\)/)
  assert.match(daily, /supplier_id: supplierId \|\| null/)
})

test('real receipt storage support is retained for daily expenses only', () => {
  assert.match(daily, /\.from\('expense-receipts'\)/)
  assert.match(daily, /\.upload\(path, imageFile/)
  assert.match(daily, /receipt_url:/)
  assert.doesNotMatch(fixed, /receipt|attachment|storage/)
})

test('recurring contract remains a monthly template without payment or VAT posting', () => {
  assert.match(fixed, /\.from\('fixed_expenses'\)\.insert\(payload\)/)
  assert.match(fixed, /\.from\('fixed_expenses'\)\.update\(payload\)\.eq\('id', item\.id\)/)
  for (const key of ['tenant_id', 'branch_id', 'name', 'category_id', 'monthly_amount', 'payment_method', 'is_active']) {
    assert.match(fixed, new RegExp(`${key}:`))
  }
  assert.doesNotMatch(fixed, /start_date|end_date|next_due_date|frequency:|vat_amount|supplier_id/)
  assert.match(types, /interface FixedExpense[\s\S]*monthly_amount: number[\s\S]*is_active: boolean/)
  assert.match(en.fixed.templateOnly, /Record the actual payment as an Expense/)
  assert.doesNotMatch(fixed, /fixed-payment/)
})

test('previews, pending guards, failures, success refresh and deletion safety are present', () => {
  assert.match(daily, /preview\.financial/)
  assert.match(fixed, /preview\.recurring/)
  assert.match(daily, /if \(saving\) return/)
  assert.match(fixed, /if \(saving\) return/)
  assert.match(daily, /onSaved\(\)[\s\S]*onClose\(\)/)
  assert.match(fixed, /onSaved\(\)[\s\S]*onClose\(\)/)
  assert.match(dailyTab, /if \(result\.error[\s\S]*return[\s\S]*setExpenses/)
  assert.match(fixedTab, /if \(result\.error[\s\S]*return[\s\S]*setItems/)
})

test('page calculations, filters and header actions are authoritative', () => {
  assert.match(dailyTab, /filtered\.reduce\(\(s, e\) => s \+ e\.total_paid/)
  assert.match(dailyTab, /preset === 'custom'/)
  assert.match(dailyTab, /filterCat/)
  assert.match(dailyTab, /filterPay/)
  assert.match(fixedTab, /monthlyTotal  = activeItems\.reduce/)
  assert.match(fixedTab, /yearlyTotal   = monthlyTotal \* 12/)
  assert.match(`${dailyTab}${fixedTab}`, /border-primary-800/)
  assert.match(page, /actions=/)
  assert.match(page, /bg-\[#173f2a\]/)
})

test('English and Arabic modal, preview, empty, success and error copy is complete', () => {
  for (const locale of [en, ar]) {
    assert.ok(locale.modal.dailySubtitle)
    assert.ok(locale.modal.fixedSubtitle)
    assert.ok(locale.preview.financial)
    assert.ok(locale.preview.recurring)
    assert.ok(locale.ui.savedSupplier)
    assert.ok(locale.ui.manualSupplier)
    assert.ok(locale.ui.noSupplier)
    assert.ok(locale.success.dailyAdded)
    assert.ok(locale.success.fixedAdded)
    assert.ok(locale.errors.deleteFailed)
  }
})

test('expense tabs use leaf-string keys in English and Arabic', () => {
  assert.match(page, /t\('tabs\.daily'\)/)
  assert.match(page, /t\('tabs\.fixed'\)/)
  assert.doesNotMatch(page, /t\('daily'\)|t\('fixed'\)/)
  assert.equal(en.tabs.daily, 'Expenses')
  assert.equal(en.tabs.fixed, 'Recurring Expenses')
  assert.equal(ar.tabs.daily, 'المصروفات')
  assert.equal(ar.tabs.fixed, 'المصروفات المتكررة')
  assert.equal(typeof en.fixed, 'object')
  assert.equal(en.fixed.monthly, 'Monthly')
  assert.equal(ar.fixed.monthly, 'شهرياً')
  assert.doesNotMatch(`${page}${JSON.stringify(en)}${JSON.stringify(ar)}`, /returned an object instead of string/)
})
