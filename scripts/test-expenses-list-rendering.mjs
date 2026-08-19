import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const list = read('../src/pages/expenses/DailyExpensesTab.tsx')
const page = read('../src/pages/expenses/ExpensesPage.tsx')

test('each expense row initializes its translation context before rendering translated copy or localized dates', () => {
  const row = list.slice(list.indexOf('function ExpenseRow('), list.indexOf('// ── Empty state'))
  assert.match(row, /const \{ t, i18n \} = useTranslation\('expenses'\)/)
  assert.match(row, /t\('documentAttached'\)/)
  assert.match(row, /i18n\.resolvedLanguage/)
})

test('the page translation function is not shadowed by tab iteration', () => {
  assert.match(page, /\.map\(tabOption =>/)
  assert.doesNotMatch(page, /\.map\(t =>/)
})
