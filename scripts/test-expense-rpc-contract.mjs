import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const daily = readFileSync(new URL('../src/pages/expenses/DailyExpenseModal.tsx', import.meta.url), 'utf8')
const result = readFileSync(new URL('../src/lib/expenses/createExpenseResult.ts', import.meta.url), 'utf8')

test('the production expense modal uses the authoritative create_expense_v1 RPC', () => {
  assert.match(daily, /\.rpc\('create_expense_v1'/)
})

test('non-claimable VAT intentionally omits the conditional VAT amount mode', () => {
  assert.match(daily, /vatChoice === 'claimable'[\s\S]*:\s*null/)
})

test('claimable VAT included maps the UI label to the RPC inclusive enum', () => {
  assert.match(daily, /priceTreatment === 'included' \? 'inclusive' : 'exclusive'/)
})

test('claimable VAT exclusive maps to the RPC exclusive enum', () => {
  assert.match(daily, /\? \(priceTreatment === 'included' \? 'inclusive' : 'exclusive'\)/)
})

test('the UI requires an explicit VAT amount mode before claimable submission', () => {
  assert.match(daily, /if \(!priceTreatment\) \{ setError\(t\('expenses:errors\.priceTreatmentRequired'\)\); return \}/)
  assert.match(daily, /name="expense-price-treatment"/)
})

test('a successful toast requires the RPC-created expense result shape', () => {
  assert.match(daily, /const \{ data, error: err \} = await .*\.rpc\('create_expense_v1'/)
  assert.match(daily, /err \|\| !isCreatedExpenseResult\(data\)/)
  assert.match(result, /result\.ok === true[\s\S]*typeof result\.expense_id === 'string'/)
})

test('the create default and Expenses list use the same Saudi calendar date', () => {
  assert.match(daily, /const today = saudiDateStr\(\)/)
  const list = readFileSync(new URL('../src/pages/expenses/DailyExpensesTab.tsx', import.meta.url), 'utf8')
  assert.match(list, /return saudiNow\(\)\.toISOString\(\)\.split\('T'\)\[0\]/)
  assert.match(list, /\.gte\('expense_date', dateFrom\)[\s\S]*\.lte\('expense_date', dateTo\)/)
})
