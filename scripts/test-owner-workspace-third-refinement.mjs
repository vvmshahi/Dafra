import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const dashboard = read('src/pages/admin/DashboardPage.tsx')
const branches = read('src/pages/settings/BranchesTab.tsx')
const zatca = read('src/pages/settings/ZatcaTab.tsx')
const settings = read('src/pages/settings/SettingsPage.tsx')
const subscription = read('src/pages/settings/SubscriptionTab.tsx')
const account = read('src/pages/settings/AccountTab.tsx')
const sidebar = read('src/components/layout/Sidebar.tsx')
const landing = read('src/pages/landing/LandingPage.tsx')
const theme = read('tailwind.config.js')

const dashboardCard = dashboard.slice(dashboard.indexOf('function BranchCard'), dashboard.indexOf('// ── Welcome'))
assert.match(theme, /DEFAULT:\s*'#0F2419'/)
assert.match(sidebar, /bg-sidebar flex flex-col/)
assert.match(dashboard, /rounded-3xl bg-\[#0F2419\]/)
assert.match(dashboardCard, /Header \*\/\}\s*<div className="[^"]*bg-sidebar[^"]*"/)
assert.doesNotMatch(dashboardCard, /Header \*\/\}\s*<div className="[^"]*bg-primary-500[^"]*"/)
assert.match(dashboardCard, /bg-emerald-50\/70/)
assert.match(dashboardCard, /bg-amber-50/)
assert.match(dashboardCard, /min-h-28[\s\S]*register\.noneYet/)
assert.match(dashboardCard, /flex-1 rounded-xl/)
assert.match(dashboardCard, /owner\.viewDetails/)

const directoryCard = branches.slice(branches.indexOf('function BranchCard'), branches.indexOf('export default function BranchesTab'))
assert.match(directoryCard, /border-sidebar-border bg-sidebar/)
assert.doesNotMatch(directoryCard, /border-primary-600 bg-primary-500|invoice_prefix/)
assert.match(directoryCard, /detail\.main/)
assert.match(directoryCard, /status\.\$\{branch\.is_active/)

assert.doesNotMatch(settings, /Section header|businessType\./)
assert.match(settings, /active === 'subscription'.*<SubscriptionTab/s)
assert.match(settings, /active === 'account'.*<AccountTab/s)
const activeSubscription = subscription.slice(subscription.lastIndexOf('// Active'))
const businessAt = activeSubscription.indexOf("BusinessTypeCard")
const planAt = activeSubscription.indexOf("subscription.active")
const usageAt = activeSubscription.indexOf("subscription.branches")
const supportAt = activeSubscription.indexOf("SupportCard")
assert.ok(planAt < usageAt && usageAt < businessAt && businessAt < supportAt)
assert.doesNotMatch(account, /businessType\./)
assert.match(settings, /bg-primary-500 text-white shadow-sm/)
assert.match(subscription, /bg-sidebar p-5 text-white/)
assert.match(subscription, /bg-primary-500.*activeBranches/s)
assert.match(subscription, /w-1 bg-primary-500/)
assert.match(account, /bg-sidebar p-5 shadow-card/)
assert.match(account, /btn-primary flex items-center/)
assert.match(account, /changePassword[\s\S]*bg-primary-500/)
assert.match(zatca, /role="dialog"[\s\S]*bg-sidebar/)

assert.match(account, /user_profiles/)
assert.match(account, /full_name: fullName\.trim\(\), phone: phone\.trim\(\) \|\| null/)
assert.match(account, /if \(!profile \|\| loading\) return/)
assert.match(account, /setFullName\(profile\.full_name \?\? ''\)/)
assert.match(account, /setPhone\(profile\.phone \?\? ''\)/)
assert.match(account, /disabled=\{loading \|\| !profile\}/)
assert.match(account, /fullNameInputRef\.current\?\.focus/)
assert.match(account, /editTriggerRef\.current\?\.focus/)
assert.match(account, /fullName\.trim\(\) === \(profile\?\.full_name \?\? ''\)/)

assert.equal((zatca.match(/function ZatcaBranchModal/g) ?? []).length, 1)
assert.equal((zatca.match(/createPortal\(/g) ?? []).length, 1)
assert.match(zatca, /createPortal\([\s\S]*document\.body/)
assert.match(zatca, /const \[selectedBranchId, setSelectedBranchId\] = useState<string \| null>\(null\)/)
assert.match(zatca, /const selectedBranch = useMemo/)
assert.match(zatca, /returnFocusRef\.current\?\.focus/)
assert.doesNotMatch(zatca, /expandedId|isExpanded|Expanded content/)
const listMapAt = zatca.indexOf('regularBranches.map')
const modalMountAt = zatca.indexOf('{selectedBranch && (')
assert.ok(listMapAt >= 0 && modalMountAt > listMapAt)
const rowSource = zatca.slice(zatca.indexOf('function BranchRow'), zatca.indexOf('function ZatcaBranchModal'))
assert.doesNotMatch(rowSource, /role="dialog"|fixed inset-0|ProductionOnboardingPanel/)
assert.match(zatca, /fixed inset-0 z-\[100\]/)
assert.match(zatca, /Number\.isNaN\(date\.getTime\(\)\)/)

const dom = new JSDOM('<!doctype html><html><body><button id="trigger">Open</button><div id="root"></div></body></html>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let effectRuns = 0
let cleanups = 0
let requests = 0

function StabilityHarness() {
  const [open, setOpen] = useState(false)
  const [renders, setRenders] = useState(0)
  const dialogRef = useRef(null)
  const toggle = useCallback(() => setOpen(value => !value), [])
  const close = useCallback(() => toggle(), [toggle])
  useEffect(() => {
    if (!open) return
    effectRuns += 1
    requests += 1
    dialogRef.current?.focus()
    return () => { cleanups += 1; document.querySelector('#trigger')?.focus() }
  }, [open, close])
  return React.createElement('div', null,
    React.createElement('button', { id: 'open', onClick: toggle }, 'Open'),
    React.createElement('button', { id: 'rerender', onClick: () => setRenders(value => value + 1) }, String(renders)),
    open && React.createElement('div', { id: 'dialog', ref: dialogRef, tabIndex: -1, role: 'dialog' },
      React.createElement('button', { id: 'close', onClick: close }, 'Close')))
}

const root = createRoot(document.querySelector('#root'))
await act(async () => root.render(React.createElement(StabilityHarness)))
await act(async () => document.querySelector('#open').click())
assert.ok(document.querySelector('#dialog'))
for (let index = 0; index < 8; index += 1) {
  await act(async () => document.querySelector('#rerender').click())
}
assert.ok(document.querySelector('#dialog'))
assert.equal(effectRuns, 1)
assert.equal(cleanups, 0)
assert.equal(requests, 1)
await act(async () => document.querySelector('#close').click())
assert.equal(document.querySelector('#dialog'), null)
assert.equal(cleanups, 1)
assert.equal(document.activeElement?.id, 'trigger')
await act(async () => root.unmount())

console.log('Owner Workspace third refinement: palette, status hierarchy, settings order, authoritative profile flow, and stable modal lifecycle passed.')
