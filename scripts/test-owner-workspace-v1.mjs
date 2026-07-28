import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const dashboard = read('src/pages/admin/DashboardPage.tsx')
const branches = read('src/pages/settings/BranchesTab.tsx')
const employees = read('src/pages/employees/EmployeesPage.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
const routes = read('src/App.tsx')
const reports = read('src/pages/reports/ReportsPage.tsx')
const zatca = read('src/pages/zatca/ZatcaPage.tsx')
const zatcaTab = read('src/pages/settings/ZatcaTab.tsx')
const settings = read('src/pages/settings/SettingsPage.tsx')
const enBranches = JSON.parse(read('src/localization/locales/en/branches.json'))
const arBranches = JSON.parse(read('src/localization/locales/ar-SA/branches.json'))

const headerStart = dashboard.indexOf('<div className="relative overflow-hidden rounded-3xl bg-[#0F2419]')
const kpiStart = dashboard.indexOf('{/* ── Register Session KPIs', headerStart)
const branchGridStart = dashboard.indexOf('{/* ── Branch grid', kpiStart)
const frozenOwnerArea = dashboard.slice(headerStart, branchGridStart)
assert.match(frozenOwnerArea, /owner\.eyebrow/)
assert.match(frozenOwnerArea, /owner\.manageBranches/)
assert.equal((frozenOwnerArea.match(/<StatCard /g) ?? []).length, 8)
for (const key of ['grossSales', 'creditNotes', 'netSales', 'sessionInvoices', 'sessionCash', 'sessionCard', 'netVat', 'expectedCash']) {
  assert.match(frozenOwnerArea, new RegExp(`kpi\\.${key}`))
}

assert.match(dashboard, /lg:grid-cols-2 \[@media\(min-width:1440px\)\]:grid-cols-3/)
assert.match(dashboard, /sm:grid-cols-3/)
for (const metric of ['sessionSalesLabel', 'expectedCash', 'difference', 'cash', 'card', 'invoices', 'vat']) {
  assert.match(dashboard, new RegExp(metric))
}
assert.match(dashboard, /session\?\.isLongOpen/)
assert.match(dashboard, /register\.closeBeforeShift/)
assert.match(dashboard, /navigate\(`\/dashboard\/branches\/\$\{b\.id\}`\)/)

assert.match(branches, /function BranchModal/)
assert.doesNotMatch(branches, /function BranchDrawer|<BranchDrawer/)
assert.match(branches, /role="dialog" aria-modal="true"/)
assert.match(branches, /(?:max-w-\[(?:960|1040)px\]|md:w-\[min\(100%,1040px\)\])/)
assert.match(branches, /(?:max-h-\[calc\(100dvh-1rem\)\]|md:h-\[min\(760px,calc\(100dvh-32px\)\)\])/)
assert.match(branches, /document\.body\.style\.overflow = 'hidden'/)
assert.match(branches, /event\.key === 'Escape'/)
assert.match(branches, /event\.key !== 'Tab'/)
assert.match(branches, /update\(branchPayload\).*select\('id'\)\.single\(\)/s)
assert.match(branches, /data\?\.id !== branch!\.id/)
assert.match(branches, /create_branch_for_tenant/)
assert.match(branches, /create-branch-user/)
assert.match(branches, /get_tenant_branch_usage/)
assert.match(branches, /disabled aria-describedby="add-branch-disabled-reason"/)
assert.match(branches, /href=\{WA_LINK\}/)
assert.match(branches, /list\.contactAddBranches/)
assert.match(branches, /title=\{item\.value\}/)
assert.match(branches, /title=\{t\('editor\.edit'\)\} aria-label=\{t\('editor\.edit'\)\}/)

assert.match(employees, /function EmployeeModal/)
assert.doesNotMatch(employees, /function EmployeeDrawer|<EmployeeDrawer|<aside/)
assert.match(employees, /role="dialog" aria-modal="true"/)
assert.match(employees, /max-w-\[820px\]/)
assert.match(employees, /event\.key === 'Escape'/)
assert.match(employees, /event\.key !== 'Tab'/)
assert.match(employees, /from\('employees'\)\.update\(payload\).*select\('id'\)\.single\(\)/s)
assert.match(employees, /from\('employees'\)\.insert\(payload\)\.select\('id'\)\.single\(\)/)
assert.match(employees, /tenant_id:\s+tenantId/)
assert.match(employees, /branch_id:\s+form\.branch_id/)
assert.match(employees, /is_active:\s+form\.is_active/)
assert.match(employees, /ConfirmDialog/)
assert.match(employees, /\.delete\(\)\.eq\('id', deleteTarget\.id\)\.select\('id'\)\.maybeSingle\(\)/)

const ownerNav = sidebar.slice(sidebar.indexOf('const ownerNav'), sidebar.indexOf('const branchNav'))
assert.doesNotMatch(ownerNav, /operations/)
assert.match(sidebar, /isSuperAdmin\s*\?\s*\[\.\.\.superAdminNav, operationsNavItem\]/)
assert.match(sidebar, /:\s*ownerNav/)
assert.match(routes, /path="\/operations" element=\{<OperationsPage \/>/)
assert.match(routes, /function RequireOwnerAdminOrSuperAdmin/)
assert.match(routes, /<Route element=\{<RequireOwnerAdminOrSuperAdmin \/>\}>[\s\S]*path="\/operations"/)

assert.match(`${zatca}\n${zatcaTab}`, /branch/i)
assert.match(`${zatca}\n${zatcaTab}`, /production|simulation/i)
assert.match(settings, /SubscriptionTab/)
assert.match(reports, /filters\.allBranches/)
assert.match(reports, /ReportTabs/)
assert.match(reports, /handleExport/)

assert.deepEqual(Object.keys(enBranches.list).sort(), Object.keys(arBranches.list).sort())
for (const locale of [enBranches, arBranches]) {
  for (const key of ['limitReached', 'contactAddBranches', 'addDisabledReason', 'addBranch', 'addFirstBranch']) {
    assert.equal(typeof locale.list[key], 'string')
    assert.ok(locale.list[key].length > 0)
  }
}

console.log('Owner workspace compact sessions, centered branch/employee modals, branch-limit action, Operations hiding, and contract checks passed.')
