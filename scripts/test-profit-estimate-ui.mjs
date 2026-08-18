import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const profit = read('src/pages/reports/ProfitLossReport.tsx')
const reportsPage = read('src/pages/reports/ReportsPage.tsx')
const reportingRpc = read('src/pages/reports/reportingRpc.ts')

assert.match(profit, /get_profit_report_summary/)
assert.match(profit, /function ProfitKpi/)
assert.match(profit, /sm:grid-cols-2 lg:grid-cols-4/)
assert.match(profit, /bg-\[#0F2419\] text-\[#FFF9E8\]/)
assert.match(profit, /border-\[#1B6B3A\]\/20 bg-\[#f8fbf7\]/)
assert.doesNotMatch(profit, /amber/)
assert.match(profit, /label=\{t\('metrics\.netMargin'\)\}/)
assert.match(profit, /fill="#1B6B3A"/)
assert.match(profit, /lg:grid-cols-3 lg:items-stretch/)
assert.match(profit, /card flex h-full flex-col p-4/)
assert.match(profit, /flex flex-1 flex-col items-center justify-center/)
assert.match(profit, /fill="#b45355"/)
assert.match(profit, /noExpensesHint/)
assert.match(profit, /border-t-2 border-\[#1B6B3A\]\/20 bg-\[#f8fbf7\]/)
assert.match(reportsPage, /active === tabItem\.id[\s\S]*bg-\[#0F2419\] text-white/)
assert.match(reportingRpc, /p_start_date: startDate[\s\S]*p_end_date: endDate[\s\S]*p_branch_id: branchId/)

console.log('Profit Estimate UI polish retains reporting authority and Kubri visual semantics.')
