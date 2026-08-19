import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const daily = readFileSync(new URL('../src/pages/expenses/DailyExpenseModal.tsx', import.meta.url), 'utf8')

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
