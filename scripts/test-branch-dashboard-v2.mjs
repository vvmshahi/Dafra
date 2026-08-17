import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(path, 'utf8')
const dashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const layout = read('src/components/layout/AppLayout.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
const app = read('src/App.tsx')
const en = JSON.parse(read('src/localization/locales/en/dashboard.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/dashboard.json'))

assert.match(layout, /return true/)
assert.match(layout, /localStorage\.getItem\('meem-sidebar-collapsed'\)/)
assert.match(layout, /localStorage\.setItem\('meem-sidebar-collapsed'/)
for (const label of ['expandSidebar', 'collapseSidebar', 'profile']) {
  assert.match(sidebar, new RegExp(`navigation:${label}`))
}
assert.match(sidebar, /AuthenticatedLanguageSwitch inverse/)
assert.match(sidebar, /auth:signOut/)

assert.match(dashboard, /data-branch-dashboard-header/)
assert.match(dashboard, /max-w-6xl min-w-0 flex-col gap-3 px-4 sm:px-6/)
assert.match(dashboard, /branch\.operations/)
assert.match(dashboard, /branch\.establishment/)
assert.match(dashboard, /navigate\('\/pos'\)/)
assert.match(dashboard, /data-branch-zatca-status/)

assert.match(dashboard, /function BranchOperationsSurface/)
for (const path of ['/pos', '/invoices', '/products', '/purchases', '/suppliers', '/customers', '/expenses', '/reports']) {
  assert.match(dashboard, new RegExp(`path: '${path.replaceAll('/', '\\/')}'`))
  assert.match(app, new RegExp(`path="${path.replaceAll('/', '\\/')}"`))
}
assert.match(dashboard, /sm:col-span-2 bg-\[#0F2419\]/)
assert.match(dashboard, /branch-register-session-heading/)
assert.match(dashboard, /register\.manage/)

const headerOrder = ['recent.invoice', 'recent.customer', 'recent.dateTime', 'recent.amount', 'recent.status']
let position = -1
for (const key of headerOrder) {
  position = dashboard.indexOf(`t('${key}')`, position + 1)
  assert.ok(position >= 0, `${key} must be a recent-invoices column`)
}
assert.match(dashboard, /documentType === 'credit_note' \? -Math\.abs\(amount\) : amount/)
assert.match(dashboard, /t\('status\.credit'\)/)
assert.match(dashboard, /navigate\('\/invoices'\)/)
assert.match(dashboard, /dir="auto"/)
assert.match(dashboard, /min-w-\[760px\]/)
assert.doesNotMatch(dashboard, /businessType|business_type|profile badge/i)

for (const dictionary of [en, ar]) {
  for (const key of ['establishment', 'products', 'purchases', 'suppliers', 'customers', 'reports']) assert.ok(dictionary.branch[key])
  assert.ok(dictionary.recent.dateTime)
}

console.log('Branch Dashboard V2 shell, actions, register, ledger, localization, and collapsed navigation contracts passed')
