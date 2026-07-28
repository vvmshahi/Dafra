import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = path => readFileSync(resolve(root, path), 'utf8')
const cases = []

function check(name, run) {
  cases.push({ name, run })
}

function flattenKeys(value, prefix = '', keys = []) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenKeys(child, path, keys)
    } else {
      keys.push(path)
    }
  }
  return keys
}

function semanticKeys(value) {
  return [...new Set(flattenKeys(value).map(key => (
    key.replace(/_(zero|one|two|few|many|other)$/, '')
  )))].sort()
}

const app = read('src/App.tsx')
const css = read('src/index.css')
const pageHeader = read('src/components/ui/PageHeader.tsx')
const filterPanel = read('src/components/ui/FilterPanel.tsx')
const contentState = read('src/components/ui/ContentState.tsx')
const button = read('src/components/ui/Button.tsx')
const input = read('src/components/ui/Input.tsx')
const confirmDialog = read('src/components/ui/ConfirmDialog.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
const appLayout = read('src/components/layout/AppLayout.tsx')
const products = read('src/pages/products/ProductsPage.tsx')
const customers = read('src/pages/customers/CustomersPage.tsx')
const suppliers = read('src/pages/suppliers/SuppliersPage.tsx')
const customerFilters = read('src/components/customers/CustomerIntelligenceFilters.tsx')
const supplierFilters = read('src/components/suppliers/SupplierIntelligenceFilters.tsx')
const customerReports = read('src/pages/reports/CustomerIntelligenceReportsPage.tsx')
const supplierReports = read('src/pages/reports/SupplierIntelligenceReportsPage.tsx')
const printingWorkspace = read('src/pages/branch/PrintingDocumentsPage.tsx')
const invoiceSettings = read('src/pages/branch/InvoiceSettingsPage.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const purchaseHistory = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const riyal = read('src/components/ui/RiyalSymbol.tsx')
const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const ownerDashboard = read('src/pages/admin/DashboardPage.tsx')
const invoicesPage = read('src/pages/invoices/InvoicesPage.tsx')
const invoiceDetail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const creditNoteModal = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const packageJson = read('package.json')

check('all production product routes remain registered', () => {
  for (const route of [
    '/login', '/onboarding', '/dashboard', '/branch', '/pos', '/products',
    '/inventory', '/purchases', '/customers', '/customers/:id', '/suppliers',
    '/suppliers/:id', '/invoices', '/invoices/:id', '/reports',
    '/reports/customers', '/reports/suppliers', '/invoice-settings',
    '/device-printer', '/settings', '/employees', '/branches',
  ]) {
    assert.match(app, new RegExp(`path="${route.replace(/[/:]/g, match => match === '/' ? '\\/' : '\\:')}"`))
  }
})

check('Branch Dashboard reuses the Owner Dashboard premium KPI palette', () => {
  for (const tone of [
    'from-[#1B6B3A] to-[#0F2419]',
    'from-[#64748b] to-[#334155]',
    'from-[#0e6f53] to-[#0F4A28]',
    'from-[#1e40af] to-[#1d3a8a]',
    'from-[#059669] to-[#047857]',
    'from-[#256f7a] to-[#174852]',
    'from-[#b45309] to-[#92400e]',
    'from-[#4a5568] to-[#1f2937]',
  ]) {
    assert.match(ownerDashboard, new RegExp(tone.replaceAll('[', '\\[').replaceAll(']', '\\]')))
    assert.match(branchDashboard, new RegExp(tone.replaceAll('[', '\\[').replaceAll(']', '\\]')))
  }
  assert.match(branchDashboard, /BRANCH_KPI_TONES/)
})

check('Branch Dashboard retains eight KPI cards in their established order', () => {
  const order = [
    'BRANCH_KPI_TONES.grossSales',
    'BRANCH_KPI_TONES.creditNotes',
    'BRANCH_KPI_TONES.netSales',
    'BRANCH_KPI_TONES.sessionInvoices',
    'BRANCH_KPI_TONES.sessionCash',
    'BRANCH_KPI_TONES.sessionCard',
    'BRANCH_KPI_TONES.netVat',
    'BRANCH_KPI_TONES.expectedCash',
  ]
  assert.equal((branchDashboard.match(/<StatCard/g) ?? []).length, 8)
  let previous = -1
  for (const marker of order) {
    const index = branchDashboard.indexOf(marker, previous + 1)
    assert.ok(index > previous, `${marker} is missing or out of order`)
    previous = index
  }
})

check('Branch Dashboard KPI calculations and Riyal bindings are unchanged', () => {
  for (const binding of [
    /session\.totalSales \+ session\.creditNoteTotal/,
    /amount=\{session\.creditNoteTotal\}/,
    /amount=\{session\.totalSales\}/,
    /String\(session\.invoiceCount\)/,
    /amount=\{session\.cashTotal\}/,
    /amount=\{session\.cardTotal\}/,
    /amount=\{session\.vatTotal\}/,
    /amount=\{cashFinalValue\}/,
  ]) assert.match(branchDashboard, binding)
  assert.match(branchDashboard, /<Rial amount=/)
  assert.doesNotMatch(branchDashboard, /Intl\.NumberFormat/)
})

check('Branch Dashboard KPI treatment is restrained and structurally consistent', () => {
  assert.match(branchDashboard, /absolute inset-x-0 bottom-0 h-1 bg-gold-400\/70/)
  assert.doesNotMatch(branchDashboard, /-bottom-4 -right-4 w-20 h-20/)
  assert.match(branchDashboard, /flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white\/10 ring-1 ring-white\/10/)
  assert.match(branchDashboard, /border border-\[#173f2a\][\s\S]*shadow-card-md/)
})

check('Branch Dashboard restores the live edge-aligned header and New Sale action', () => {
  const header = branchDashboard.slice(
    branchDashboard.indexOf('<header'),
    branchDashboard.indexOf('</header>') + '</header>'.length,
  )
  assert.match(header, /data-branch-dashboard-header/)
  assert.match(header, /relative overflow-hidden bg-\[#0F2419\] px-6 py-4 shadow-card sm:py-\[18px\]/)
  assert.match(header, /absolute inset-x-0 top-0 h-1 bg-gold-500/)
  assert.doesNotMatch(header.match(/<header[\s\S]*?>/)?.[0] ?? '', /mx-auto|max-w-6xl|rounded-/)
  assert.match(header, /data-branch-header-action-stack/)
  assert.match(header, /onClick=\{\(\) => navigate\('\/pos'\)\}/)
  assert.match(header, /<Receipt size=\{16\} aria-hidden="true" \/>/)
  assert.match(header, /branch\.newSale/)
  assert.match(header, /focus-visible:ring-gold-200/)

  assert.match(sidebar, /\{ labelKey: 'newSale', path: '\/pos', icon: Receipt/)
  const quickActions = branchDashboard.slice(
    branchDashboard.indexOf('function QuickActionsPanel'),
    branchDashboard.indexOf('export default function BranchDashboardPage'),
  )
  assert.match(quickActions, /\{ label: t\('branch\.newSale'\), desc: t\('branch\.openPos'\), icon: Receipt, path: '\/pos'/)
  assert.match(app, /path="\/pos" element=\{<POSPage/)
})

check('Branch Dashboard places informational ZATCA beneath New Sale without header register status', () => {
  const header = branchDashboard.slice(
    branchDashboard.indexOf('<header'),
    branchDashboard.indexOf('</header>') + '</header>'.length,
  )
  const stackIndex = header.indexOf('data-branch-header-action-stack')
  const newSaleIndex = header.indexOf("navigate('/pos')", stackIndex)
  const zatcaIndex = header.indexOf('data-branch-zatca-status', stackIndex)
  const stackMarkup = header.slice(stackIndex)
  assert.ok(stackIndex >= 0 && newSaleIndex > stackIndex, 'New Sale must be in the header action stack')
  assert.ok(zatcaIndex > newSaleIndex, 'ZATCA status must follow New Sale')
  assert.match(stackMarkup, /flex w-full min-w-0 flex-col items-stretch gap-2/)
  assert.equal((stackMarkup.match(/role="status"/g) ?? []).length, 1)
  const zatcaMarkup = stackMarkup.slice(stackMarkup.indexOf('data-branch-zatca-status'))
  assert.doesNotMatch(zatcaMarkup, /<button|onClick|cursor-pointer|hover:|active:/)
  assert.match(zatcaMarkup, /rounded-full/)
  assert.match(zatcaMarkup, /shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.07\)\]/)
  assert.match(stackMarkup, /aria-hidden="true"/)
  assert.match(stackMarkup, /zatcaHeaderStyle\.pill/)
  assert.match(branchDashboard, /shadow-\[0_0_7px_rgba\(110,231,183,0\.48\)\]/)
  assert.doesNotMatch(header, /data-branch-register-status|registerHeaderStatus|registerOpeningLabel|registerDuration/)
})

check('Branch Dashboard removes header register experiment while detailed session duration remains intact', () => {
  assert.doesNotMatch(branchDashboard, /registerStatusStyles|registerHeaderStatus|getRegisterOpeningTime|registerOpeningTime|registerOpeningLabel|branch\.registerOpenedAt/)
  assert.match(branchDashboard, /getRegisterDuration\(registerSession\.openedAt, durationNow\)/)
  assert.match(branchDashboard, /duration=\{registerDuration\}/)
  assert.match(branchDashboard, /registerSession\?\.status === 'open'/)
  assert.doesNotMatch(branchDashboard, /getRegisterDuration\(null/)
  assert.match(branchDashboard, /session\.isLongOpen \? t\('status\.longOpen'\)/)
  assert.match(branchDashboard, /session\.status === 'open' && duration/)
})

check('Branch Dashboard preserves existing ZATCA state sources and avoids animated status dependencies', () => {
  assert.match(branchDashboard, /productionStatusLabel\(productionStatus, hasActiveCert\)/)
  assert.match(branchDashboard, /productionStatusReadable/)
  assert.match(branchDashboard, /zatcaPhase === 2 && !productionStatusReadable[\s\S]*?phase2Unavailable'\), tone: 'danger'/)
  assert.match(branchDashboard, /displayedZatcaLabel/)
  assert.match(branchDashboard, /displayedZatcaTone/)
  assert.match(branchDashboard, /zatcaHeaderStyle/)
  assert.doesNotMatch(branchDashboard, /framer-motion|motion\.|LiquidGlass|HoverBorder/)
  assert.doesNotMatch(packageJson, /framer-motion|class-variance-authority|@radix-ui\/react-slot/)
})

check('Branch Dashboard and Sidebar share one continuous gold top rule', () => {
  assert.match(branchDashboard, /absolute inset-x-0 top-0 h-1 bg-gold-500/)
  assert.match(sidebar, /location\.pathname === '\/branch'/)
  assert.match(sidebar, /data-branch-sidebar-gold-rule/)
  assert.match(sidebar, /absolute inset-x-0 top-0 z-20 h-1 bg-gold-500/)
  assert.match(sidebar, /\$\{collapsed \? 'w-16' : 'w-\[240px\]'\}/)
  assert.match(sidebar, /transition-\[width\]/)
})

check('Branch Dashboard operational routes and register details remain intact', () => {
  assert.match(app, /path="\/branch"\s+element=\{<BranchDashboardPage/)
  assert.match(branchDashboard, /onClick=\{\(\) => navigate\('\/pos'\)\}/)
  for (const path of ["'/pos'", "'/expenses'", "'/invoices'"]) {
    assert.match(branchDashboard, new RegExp(`path: ${path}`))
  }
  for (const metric of [
    'session.openingCash', 'session.expectedCash', 'session.actualCash',
    'session.cashDifference', 'session.creditNoteTotal', 'session.expensesTotal',
  ]) assert.match(branchDashboard, new RegExp(metric.replace('.', '\\.')))
})

check('Branch Dashboard responds without horizontal page overflow', () => {
  assert.match(branchDashboard, /grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4/)
  assert.match(branchDashboard, /data-branch-dashboard-header[\s\S]*?flex max-w-6xl min-w-0 flex-col gap-3 md:flex-row/)
  assert.match(branchDashboard, /data-branch-header-action-stack[\s\S]*?flex w-full min-w-0 flex-col items-stretch/)
  assert.match(branchDashboard, /md:w-auto md:min-w-\[10\.5rem\] md:shrink-0 md:items-end/)
  assert.match(branchDashboard, /min-h-10 w-full[\s\S]*?md:w-auto/)
  assert.match(branchDashboard, /self-start rounded-full[\s\S]*?md:self-end/)
  assert.match(branchDashboard, /min-w-0 rounded-2xl/)
  assert.match(branchDashboard, /overflow-x-auto/)
  assert.match(branchDashboard, /min-w-\[680px\]/)
  assert.doesNotMatch(branchDashboard, /\bw-screen\b/)
})

check('Branch Dashboard supports Arabic, mixed names, and keyboard operation', () => {
  assert.match(branchDashboard, /dir="auto"/)
  assert.match(branchDashboard, /rtl:tracking-normal/)
  assert.match(branchDashboard, /\bms-2\b/)
  assert.match(branchDashboard, /<DirectionalIcon/)
  assert.match(branchDashboard, /<Receipt size=\{16\} aria-hidden="true" \/>[\s\S]*?\{t\('branch\.newSale'\)\}/)
  assert.match(branchDashboard, /aria-label=\{t\('recent\.openInvoice'/)
  assert.match(branchDashboard, /event\.stopPropagation\(\)/)
  assert.match(branchDashboard, /scope="col"/)
  assert.match(branchDashboard, /role="status"/)
})

check('Branch Dashboard snapshot rhythm is tighter and avoids redundant scope copy', () => {
  assert.match(branchDashboard, /min-h-screen min-w-0 bg-gray-50/)
  assert.match(branchDashboard, /mx-auto max-w-6xl space-y-5 px-4 pb-6 pt-4 sm:px-6/)
  assert.doesNotMatch(branchDashboard, /branch\.currentBranchScope/)
  assert.match(branchDashboard, /inline-flex min-h-7 shrink-0 items-center gap-1\.5 rounded-md border px-2\.5 py-1/)
  assert.match(branchDashboard, /session\.status === 'open' && duration/)
})

check('Branch Dashboard adds no new database or network contract', () => {
  const rpcNames = [...branchDashboard.matchAll(/\.rpc\('([^']+)'/g)].map(match => match[1]).sort()
  assert.deepEqual(rpcNames, [
    'get_branch_dashboard_recent_invoices',
    'get_register_session_summary',
  ])
  assert.equal((branchDashboard.match(/loadReportSummary<DashboardSummary>/g) ?? []).length, 1)
  assert.match(branchDashboard, /'get_dashboard_summary'/)
  const tableNames = [...branchDashboard.matchAll(/\.from\('([^']+)'\)/g)].map(match => match[1]).sort()
  assert.deepEqual(tableNames, ['branches', 'branches', 'products'])
  assert.equal((branchDashboard.match(/\.on\('postgres_changes'/g) ?? []).length, 3)
})

check('Invoices route and audited KPI calculation bindings remain unchanged', () => {
  assert.match(app, /path="\/invoices"\s+element=\{<InvoicesPage/)
  assert.match(invoicesPage, /count:\s+filtered\.length/)
  assert.match(invoicesPage, /revenue:\s+filtered\.reduce\(\(s, r\) => s \+ \(r\.documentType === 'credit_note' \? -r\.totalAmount : r\.totalAmount\), 0\)/)
  assert.match(invoicesPage, /vat:\s+filtered\.reduce\(\(s, r\) => s \+ \(r\.documentType === 'credit_note' \? -r\.taxAmount : r\.taxAmount\), 0\)/)
  assert.match(invoicesPage, /label: t\('invoices:totalDocuments'\), value: String\(summary\.count\)/)
  assert.doesNotMatch(invoicesPage, /label: t\('invoices:totalInvoices'\)/)
})

check('Invoices KPI cards restore compact sizing, use a non-orange VAT tone, and retain period context', () => {
  for (const tone of [
    'from-[#334155] to-[#1e293b]',
    'from-[#1B6B3A] to-[#0F2419]',
    'from-[#285e61] to-[#1f3f43]',
  ]) assert.match(invoicesPage, new RegExp(tone.replaceAll('[', '\\[').replaceAll(']', '\\]')))
  assert.doesNotMatch(invoicesPage, /from-\[#b45309\] to-\[#78350f\]/)
  assert.match(invoicesPage, /INVOICE_KPI_TONES/)
  assert.match(invoicesPage, /grid grid-cols-1 gap-2\.5 md:grid-cols-3/)
  assert.match(invoicesPage, /absolute inset-x-0 bottom-0 h-0\.5 bg-gold-400\/65/)
  assert.match(invoicesPage, /min-h-\[92px\]/)
  assert.match(invoicesPage, /px-3\.5 py-3/)
  assert.doesNotMatch(invoicesPage, /min-h-\[118px\]/)
  assert.match(invoicesPage, /text-white tabular-nums/)
  assert.match(invoicesPage, /\{periodLabel\}/)
  assert.match(invoicesPage, /quickRange === 'custom'[\s\S]*?dateRange/)
})

check('Invoices restore the compact two-row filter structure without changing contracts', () => {
  for (const range of ["'today'", "'yesterday'", "'this_month'", "'last_month'", "'custom'"]) {
    assert.match(invoicesPage, new RegExp(`key: ${range}`))
  }
  assert.match(invoicesPage, /data-invoice-compact-filters/)
  assert.match(invoicesPage, /space-y-2 rounded-xl border border-gray-100 bg-white px-3 py-2\.5/)
  assert.doesNotMatch(invoicesPage, /<FilterPanel/)
  assert.doesNotMatch(invoicesPage, /filterDescription/)
  assert.match(invoicesPage, /<fieldset>/)
  assert.match(invoicesPage, /aria-pressed=\{quickRange === option\.key\}/)
  assert.match(invoicesPage, /min-h-8 shrink-0/)
  assert.match(invoicesPage, /xl:grid-cols-\[minmax\(130px,0\.8fr\)_minmax\(130px,0\.8fr\)_minmax\(230px,1\.7fr\)/)
  assert.match(invoicesPage, /r\.invoiceNumber\.toLowerCase\(\)\.includes\(q\)/)
  assert.match(invoicesPage, /r\.customerName \?\? ''\)\.toLowerCase\(\)\.includes\(q\)/)
  assert.match(invoicesPage, /r\.invoiceReference \?\? ''\)\.toLowerCase\(\)\.includes\(q\)/)
  assert.match(invoicesPage, /payFilter !== 'all' && r\.paymentMethod !== payFilter/)
  assert.match(invoicesPage, /zatcaFilter !== 'all' && r\.displayZatcaStatus !== zatcaFilter/)
  assert.match(invoicesPage, /hasActiveFilters && \(/)
  assert.match(invoicesPage, /function resetFilters\(\)/)
  assert.doesNotMatch(invoicesPage, /data-invoice-active-scope/)
  assert.doesNotMatch(invoicesPage, /showingDocumentsFor/)
})

check('Invoices desktop table restores compact separate Date and Time columns', () => {
  assert.match(invoicesPage, /data-invoice-desktop-table/)
  assert.match(invoicesPage, /<table className="w-full min-w-\[1040px\]/)
  assert.match(invoicesPage, /<caption className="sr-only"/)
  assert.match(invoicesPage, /scope="col"/)
  assert.match(invoicesPage, /sticky top-0 z-10/)
  assert.match(invoicesPage, /bg-slate-50/)
  assert.match(invoicesPage, /\[t\('invoices:date'\), 'text-start'\]/)
  assert.match(invoicesPage, /\[t\('invoices:time'\), 'text-start'\]/)
  assert.doesNotMatch(invoicesPage, /\[t\('invoices:dateTime'\)/)
  assert.match(invoicesPage, /px-2\.5 py-2 text-end align-top text-xs/)
  assert.doesNotMatch(invoicesPage, /invoice-documents-heading" className="text-sm/)
  assert.match(invoicesPage, /<Rial amount=\{summary\.revenue - summary\.vat\}/)
  assert.match(invoicesPage, /<Rial amount=\{summary\.vat\}/)
  assert.match(invoicesPage, /<Rial amount=\{summary\.revenue\}/)
})

check('Invoices preserve credit-note arithmetic, identity, and non-destructive differentiation', () => {
  assert.match(invoicesPage, /isCreditNote \? `-\$\{fmt\(r\.subtotal\)\}` : fmt\(r\.subtotal\)/)
  assert.match(invoicesPage, /isCreditNote \? `-\$\{fmt\(r\.taxAmount\)\}` : fmt\(r\.taxAmount\)/)
  assert.match(invoicesPage, /isCreditNote \? '- ' : ''\}<Rial amount=\{row\.totalAmount\}/)
  assert.match(invoicesPage, /border-s-2 border-amber-300/)
  assert.match(invoicesPage, /bg-amber-50\/25/)
  assert.doesNotMatch(invoicesPage, /isCreditNote \? 'bg-red/)
  assert.match(invoicesPage, /invoices:creditNoteShort/)
  assert.match(invoicesPage, /invoices:forInvoice/)
  assert.match(invoicesPage, /invoices:partiallyCredited/)
  assert.match(invoicesPage, /invoices:latestCreditNote/)
  assert.match(invoicesPage, /linkedCreditNoteNumber/)
})

check('Invoices payment and ZATCA badges retain existing values with visible semantic text', () => {
  for (const method of ['cash', 'card', 'split', 'bank_transfer', 'other']) {
    assert.match(invoicesPage, new RegExp(`\\b${method}: \\{`))
  }
  for (const status of [
    'not_submitted', 'pending', 'reported', 'cleared', 'failed',
    'sandbox_validated', 'sandbox_validated_with_warnings',
    'sandbox_validation_pending', 'sandbox_validation_rejected',
    'sandbox_validation_failed', 'sandbox_not_validated',
  ]) assert.match(invoicesPage, new RegExp(`\\b${status}: \\{`))
  assert.match(invoicesPage, /function DocumentBadge/)
  assert.match(invoicesPage, /aria-hidden="true"/)
  assert.match(invoicesPage, /\{label\}/)
})

check('Invoices actions use fixed independent two-slot controls while retaining eligibility', () => {
  assert.match(invoicesPage, /navigate\(`\/invoices\/\$\{r\.id\}`\)/)
  assert.match(invoicesPage, /viewDocumentNumber/)
  assert.match(invoicesPage, /creditNoteDisabledReason\(r, profile\?\.role, t\)/)
  assert.match(invoicesPage, /data-invoice-action-slots/)
  assert.match(invoicesPage, /inline-grid w-\[74px\] grid-cols-2 items-center gap-2/)
  assert.match(invoicesPage, /\{!disabledReason \? \(/)
  assert.match(invoicesPage, /onClick=\{\(\) => setCreditModalRow\(r\)\}/)
  assert.match(invoicesPage, /data-invoice-action-placeholder/)
  assert.match(invoicesPage, /<span className="h-8 w-8" aria-hidden="true"/)
  assert.equal((invoicesPage.match(/inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white/g) ?? []).length, 2)
  assert.doesNotMatch(invoicesPage, /disabled=\{!!disabledReason\}/)
  assert.doesNotMatch(invoicesPage, /inline-flex items-center gap-1 rounded-lg border/)
  assert.match(invoicesPage, /if \(row\.documentType === 'credit_note'\) return/)
  assert.match(invoicesPage, /if \(row\.status === 'cancelled'\) return/)
  assert.match(invoicesPage, /if \(row\.status !== 'posted'\) return/)
  assert.match(invoicesPage, /row\.creditStatus === 'full' \|\| row\.remainingRefundableQuantity <= 0/)
  assert.match(invoicesPage, /retryableZatcaCount = demoSandbox \? 0 : rows\.filter\(r => r\.status !== 'cancelled' && \(r\.zatcaStatus === 'failed' \|\| r\.zatcaStatus === 'pending'\)\)\.length/)
  assert.match(invoicesPage, /retryableZatcaCount > 0 && \(/)
  assert.match(invoicesPage, /retryFailedSubmissions\(tid, profile\?\.branch_id\)/)
})

check('Invoices mobile cards reuse filtered row presentation without another loading path', () => {
  assert.match(invoicesPage, /data-invoice-mobile-cards/)
  assert.match(invoicesPage, /grid gap-3 p-3 lg:hidden sm:grid-cols-2/)
  assert.equal((invoicesPage.match(/documentRows\.map\(/g) ?? []).length, 2)
  assert.equal((invoicesPage.match(/\.from\('invoices'\)/g) ?? []).length, 2)
  assert.match(invoicesPage, /fmtDate\(row\.createdAt, i18n\.language\)/)
  assert.match(invoicesPage, /fmtTime\(row\.createdAt, i18n\.language\)/)
  assert.match(invoicesPage, /dir="auto"/)
  assert.match(invoicesPage, /\bstart-3\b/)
  assert.match(invoicesPage, /\bps-9\b/)
  assert.doesNotMatch(invoicesPage, /\bw-screen\b/)
})

check('Invoices states are merchant-facing and reuse shared ContentState semantics', () => {
  assert.match(invoicesPage, /<ContentState[\s\S]*?kind="loading"/)
  assert.match(invoicesPage, /<ContentState[\s\S]*?kind="error"/)
  assert.match(invoicesPage, /<ContentState[\s\S]*?kind="empty"/)
  assert.match(invoicesPage, /rows\.length === 0 \? emptyTitle : t\('invoices:noMatchingDocuments'\)/)
  assert.match(invoicesPage, /role="alert"/)
  assert.doesNotMatch(invoicesPage, /\{String\(loadError\)\}|loadError\.message/)
})

check('Invoices page adds only the authoritative read-only register-session query', () => {
  const tableNames = [...invoicesPage.matchAll(/\.from\('([^']+)'\)/g)].map(match => match[1]).sort()
  assert.deepEqual(tableNames, ['invoice_items', 'invoices', 'invoices', 'pos_sessions'])
  assert.equal((invoicesPage.match(/getSandboxValidationStatuses\(/g) ?? []).length, 1)
  assert.equal((invoicesPage.match(/retryFailedSubmissions\(/g) ?? []).length, 1)
  assert.doesNotMatch(invoicesPage, /\.rpc\(|\.insert\(|\.update\(|\.delete\(/)
  assert.doesNotMatch(packageJson, /chart\.js|framer-motion|@tanstack\/react-table/)
})

check('shared page header is semantic and adopted across operational pages', () => {
  assert.match(pageHeader, /<header/)
  assert.match(pageHeader, /aria-labelledby/)
  assert.match(pageHeader, /sm:flex-row/)
  const files = [
    'products/ProductsPage.tsx', 'customers/CustomersPage.tsx',
    'suppliers/SuppliersPage.tsx', 'purchases/PurchasesPage.tsx',
    'inventory/InventoryPage.tsx', 'expenses/ExpensesPage.tsx',
    'reports/ReportsPage.tsx', 'settings/SettingsPage.tsx',
  ]
  for (const file of files) assert.match(read(`src/pages/${file}`), /<PageHeader/)
})

check('customer and supplier intelligence share responsive filter primitives', () => {
  for (const source of [customerFilters, supplierFilters]) {
    assert.match(source, /<FilterPanel/)
    assert.match(source, /<fieldset/)
    assert.match(source, /<FilterPresetRow/)
    assert.match(source, /<ResponsiveFilterGrid/)
  }
  assert.match(filterPanel, /grid-cols-1/)
  assert.match(filterPanel, /sm:grid-cols-2/)
  assert.match(filterPanel, /lg:grid-cols-3/)
  assert.match(filterPanel, /xl:grid-cols-6/)
  assert.match(filterPanel, /overflow-x-auto/)
})

check('English and Arabic localization resources have semantic key parity', () => {
  const enDir = resolve(root, 'src/localization/locales/en')
  const arDir = resolve(root, 'src/localization/locales/ar-SA')
  const files = readdirSync(enDir).filter(file => file.endsWith('.json')).sort()
  assert.deepEqual(files, readdirSync(arDir).filter(file => file.endsWith('.json')).sort())
  for (const file of files) {
    const en = JSON.parse(readFileSync(resolve(enDir, file), 'utf8'))
    const ar = JSON.parse(readFileSync(resolve(arDir, file), 'utf8'))
    assert.deepEqual(semanticKeys(en), semanticKeys(ar), `${file} semantic keys differ`)
  }
})

check('new interface copy is localized rather than rendered as raw keys', () => {
  const changedSurfaces = [
    appLayout, sidebar, products, customers, suppliers,
    read('src/pages/settings/SettingsPage.tsx'),
    read('src/pages/auth/LoginPage.tsx'),
  ].join('\n')
  assert.doesNotMatch(changedSurfaces, />\s*(common|settings|navigation|products):[a-zA-Z0-9_.-]+\s*</)
  assert.doesNotMatch(changedSurfaces, /owner@company\.com or counter_user/)
  assert.match(changedSurfaces, /identifierPlaceholder/)
})

check('prominent CRUD search controls use logical RTL positioning', () => {
  for (const source of [products, customers, suppliers]) {
    assert.match(source, /absolute start-/)
    assert.match(source, /\bps-/)
    assert.doesNotMatch(source, /absolute left-3(?:\.5)? top-1\/2/)
  }
  assert.match(products, /absolute start-2 top-2/)
  assert.match(read('src/pages/settings/DevicePrinterPage.tsx'), /DirectionalIcon/)
})

check('shared button hierarchy remains explicit and press feedback is bounded', () => {
  for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'gold']) {
    assert.match(button, new RegExp(`${variant}:`))
  }
  const sharedButtonCss = css.match(/\.btn \{[\s\S]*?\n  \}/)?.[0] ?? ''
  assert.doesNotMatch(sharedButtonCss, /transition-all/)
  assert.match(sharedButtonCss, /active:scale-\[0\.97\]/)
  assert.match(sharedButtonCss, /disabled:scale-100/)
})

check('shared inputs connect labels, help, errors, and invalid state', () => {
  assert.match(input, /useId/)
  assert.match(input, /aria-invalid/)
  assert.match(input, /aria-describedby/)
  assert.match(input, /role="alert"/)
})

check('confirmation dialog has modal semantics and complete focus handling', () => {
  for (const marker of [
    'role="alertdialog"', 'aria-modal="true"', 'handleKeyDown',
    "event.key === 'Escape'", "event.key !== 'Tab'",
    'cancelRef.current?.focus()', 'returnFocusRef.current?.focus()',
    "document.body.style.overflow = 'hidden'",
  ]) {
    assert.match(confirmDialog, new RegExp(marker.replace(/[?.()]/g, '\\$&')))
  }
})

check('application shell has skip navigation and visible keyboard focus', () => {
  assert.match(appLayout, /href="#main-content"/)
  assert.match(appLayout, /id="main-content"/)
  assert.match(appLayout, /skipToContent/)
  assert.match(sidebar, /mainNavigation/)
  assert.match(sidebar, /focus-visible:ring-gold-300/)
})

check('reduced motion is respected globally', () => {
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /animation-duration: 0\.01ms/)
  assert.match(css, /scroll-behavior: auto/)
})

check('shared states cover loading, empty, and error semantics', () => {
  for (const kind of ['loading', 'empty', 'error']) assert.match(contentState, new RegExp(`'${kind}'`))
  assert.match(contentState, /aria-live/)
  assert.match(contentState, /aria-busy/)
  assert.match(contentState, /role=\{isError \? 'alert' : 'status'\}/)
  assert.match(customers, /<ContentState/)
  assert.match(suppliers, /<ContentState/)
})

check('long merchant names have safe wrapping foundations', () => {
  assert.match(pageHeader, /overflow-wrap:anywhere/)
  assert.match(contentState, /overflow-wrap:anywhere/)
  assert.match(filterPanel, /overflow-wrap:anywhere/)
  assert.match(products, /dir="auto"/)
  assert.match(customers, /dir="auto"/)
  assert.match(suppliers, /dir="auto"/)
})

check('Saudi Riyal display remains the shared money primitive', () => {
  assert.match(riyal, /SaudiRiyal/)
  assert.match(riyal, /tabular-nums/)
  assert.match(riyal, /export function Rial/)
  for (const source of [products, suppliers, customerReports, supplierReports, pos]) {
    assert.match(source, /<Rial/)
  }
})

check('Piece and Carton terminology remains localized and separate', () => {
  const posEn = JSON.parse(read('src/localization/locales/en/pos.json'))
  const posAr = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))
  assert.equal(posEn.packages.piece, 'Piece')
  assert.equal(posEn.packages.carton, 'Carton')
  assert.equal(posAr.packages.piece, 'قطعة')
  assert.equal(posAr.packages.carton, 'كرتون')
  assert.match(read('src/localization/locales/en/supplierIntelligence.json'), /Piece and Carton quantities separate/)
})

check('customer and supplier reports retain desktop table and mobile card fallbacks', () => {
  assert.match(customerReports, /hidden md:block overflow-x-auto/)
  assert.match(customerReports, /md:hidden divide-y/)
  assert.match(supplierReports, /hidden lg:block overflow-x-auto/)
  assert.match(supplierReports, /lg:hidden divide-y/)
})

check('Printing and Documents persistence and preview contracts remain intact', () => {
  assert.match(printingWorkspace, /<InvoiceSettingsPage/)
  assert.match(printingWorkspace, /<BarcodeLabelSettingsPanel/)
  assert.match(printingWorkspace, /<BarcodePrinterSetupPanel/)
  assert.match(invoiceSettings, /serializeInvoicePresentationSettingsForSave/)
  assert.match(invoiceSettings, /<ThermalReceipt/)
  assert.match(invoiceSettings, /<A4Document/)
})

check('Customer Intelligence contracts and routes remain intact', () => {
  assert.match(app, /path="\/reports\/customers"/)
  assert.match(app, /path="\/customers\/:id"/)
  assert.match(read('src/lib/customers/customerIntelligence.ts'), /get_customer_intelligence/)
  assert.ok(existsSync(resolve(root, 'scripts/test-customer-intelligence.mjs')))
})

check('Supplier Intelligence contracts and routes remain intact', () => {
  assert.match(app, /path="\/reports\/suppliers"/)
  assert.match(app, /path="\/suppliers\/:id"/)
  assert.match(read('src/lib/suppliers/supplierIntelligence.ts'), /get_supplier_intelligence/)
  assert.ok(existsSync(resolve(root, 'scripts/test-supplier-intelligence.mjs')))
})

check('barcode printing and workflow surfaces remain intact', () => {
  assert.match(products, /BarcodeBatchPrintDrawer/)
  assert.match(printingWorkspace, /BarcodeLabelSettingsPanel/)
  assert.ok(existsSync(resolve(root, 'scripts/test-barcode-printing-ux.mjs')))
  assert.ok(existsSync(resolve(root, 'scripts/test-barcode-workflow.mjs')))
})

check('purchase and receiving UI contracts remain intact', () => {
  assert.match(app, /path="\/purchases"/)
  assert.match(purchaseHistory, /PurchaseBillModal/)
  assert.match(purchaseHistory, /receiving_status/)
  assert.match(read('src/pages/purchases/PurchasesPage.tsx'), /PurchaseHistoryTab/)
})

check('POS route and checkout surface remain intact', () => {
  assert.match(app, /path="\/pos"/)
  assert.match(pos, /documentFromPosReceipt/)
  assert.match(pos, /async function charge\(\)/)
  assert.match(pos, /<ThermalReceipt/)
})

check('invoice and credit-note routes and components remain intact', () => {
  assert.match(app, /path="\/invoices"/)
  assert.match(app, /path="\/invoices\/:id"/)
  assert.match(read('src/pages/invoices/InvoicesPage.tsx'), /credit_note/)
  assert.match(read('src/pages/invoices/InvoiceDetailPage.tsx'), /CreateCreditNoteModal/)
  assert.ok(existsSync(resolve(root, 'src/pages/invoices/AtomicCreditNoteReceiptView.tsx')))
})

check('credit-note redesign preserves identity, calculations, and payload contracts', () => {
  assert.doesNotMatch(creditNoteModal, /data-original-invoice-id/)
  assert.doesNotMatch(creditNoteModal, /originalInvoiceIdentity/)
  assert.match(creditNoteModal, /\{invoice\.invoice_number\}/)
  assert.match(creditNoteModal, /t\('creditNotes:create'\)/)
  assert.match(creditNoteModal, /refundAllocationDisclosure/)
  assert.match(read('src/localization/locales/en/creditNotes.json'), /does not automatically return cash, reverse a card payment, or make a bank transfer/)
  assert.match(creditNoteModal, /const QUICK_REASONS = \[[\s\S]*?'Customer refund'[\s\S]*?'Billing mistake'/)
  assert.match(creditNoteModal, /const finalReason = trimmedRemarks \? `\$\{selectedReason\} - \$\{trimmedRemarks\}` : selectedReason/)
  assert.match(creditNoteModal, /finalReason\.length > 500/)
  assert.match(creditNoteModal, /amountForQuantity\([\s\S]*?remaining_quantity/)
  assert.match(creditNoteModal, /Math\.abs\(returnQuantity - item\.remaining_quantity\)[\s\S]*?roundMoney\(remainingAmount\)/)
  assert.match(creditNoteModal, /return_stock: hasEligibleStockLines \? stockReturnChoice === true : false/)
  assert.match(creditNoteModal, /refund_allocations: refundAllocations/)
  assert.match(creditNoteModal, /original_invoice_item_id: line\.item\.original_invoice_item_id/)
  assert.match(creditNoteModal, /quantity: line\.quantity/)
})

check('credit-note item cards use zero-state quantity controls without per-line stock choices', () => {
  assert.match(creditNoteModal, /Object\.fromEntries\(rows\.map\(row => \[row\.original_invoice_item_id, '0'\]\)\)/)
  assert.match(creditNoteModal, /<Minus/)
  assert.match(creditNoteModal, /type="number"/)
  assert.match(creditNoteModal, /<Plus/)
  assert.match(creditNoteModal, /fullReturnQuantity\(item\)/)
  assert.doesNotMatch(creditNoteModal, /type="checkbox"/)
  assert.match(creditNoteModal, /max=\{item\.remaining_quantity\}/)
  assert.match(creditNoteModal, /previouslyCreditedWithUnit/)
  assert.match(creditNoteModal, /selling_unit_name/)
  assert.match(creditNoteModal, /base_unit_name/)
  assert.match(creditNoteModal, /noInventoryImpact/)
  assert.equal((creditNoteModal.match(/setStockReturnChoice\(option\.value\)/g) ?? []).length, 1)
})

check('credit-note dialog is accessible, responsive, and RTL-safe', () => {
  for (const marker of [
    'role="dialog"',
    'aria-modal="true"',
    'aria-labelledby={titleId}',
    'aria-describedby={descriptionId}',
    "event.key === 'Escape'",
    "event.key !== 'Tab'",
    "document.body.style.overflow = 'hidden'",
    'returnFocusRef.current?.focus()',
    'role="status"',
    'role="alert"',
  ]) assert.ok(creditNoteModal.includes(marker), `missing credit-note dialog behavior: ${marker}`)
  assert.match(creditNoteModal, /max-h-\[100dvh\]/)
  assert.match(creditNoteModal, /overflow-y-auto/)
  assert.match(creditNoteModal, /lg:grid-cols-/)
  assert.match(creditNoteModal, /lg:sticky/)
  assert.match(creditNoteModal, /isRtl/)
  assert.match(creditNoteModal, /dir="ltr"/)
  assert.match(creditNoteModal, /rounded-s-xl/)
  assert.match(creditNoteModal, /rounded-e-xl/)
})

check('credit-note entry points match effective Owner and Branch authorization', () => {
  assert.match(invoicesPage, /!\['owner', 'branch'\]\.includes\(role\)/)
  assert.doesNotMatch(invoicesPage, /\['owner', 'admin', 'branch'\]/)
  assert.match(invoiceDetail, /profile\?\.role === 'owner' \|\| profile\?\.role === 'branch'/)
  assert.match(invoiceDetail, /\{!isCreditNote && canIssueCreditNote && canCreateCreditNote && \(/)
  assert.match(creditNoteModal, /\.rpc\('get_invoice_refundable_items_v2'/)
  assert.match(creditNoteModal, /checkoutSimplifiedAtomically/)
  assert.match(creditNoteModal, /submitInvoiceForBranch/)
})

check('audit and screenshot follow-up artifacts are complete', () => {
  const audit = read('docs/ui-refinement-audit.md')
  const screenshots = read('docs/ui-screenshot-followups.md')
  for (const marker of [
    'Authentication and onboarding', 'Dashboard', 'POS', 'Products',
    'Customers', 'Suppliers', 'Purchases and receiving', 'Invoices and credit notes',
    'Printing & Documents', 'Mobile navigation', 'Arabic', 'Accessibility',
  ]) assert.match(audit, new RegExp(marker.replace('&', '\\&')))
  for (const width of ['360', '390', '768', '1024', '1280', '1440']) {
    assert.match(screenshots, new RegExp(width))
  }
})

let passed = 0
for (const item of cases) {
  try {
    item.run()
    passed += 1
    console.log(`  ✓ ${item.name}`)
  } catch (error) {
    console.error(`  ✗ ${item.name}`)
    throw error
  }
}

console.log(`ui refinement checks passed: ${passed}`)
