import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const source = read('src/pages/settings/BranchesTab.tsx')
const appLayout = read('src/components/layout/AppLayout.tsx')
const product = read('src/pages/products/ProductDrawer.tsx')
const modal = source.slice(source.indexOf('function BranchModal'), source.indexOf('function ResetPasswordModal'))

assert.match(appLayout, /'--app-sidebar-width': collapsed \? '64px' : '240px'/)
assert.match(product, /md:left-\[var\(--app-sidebar-width\)\]/)
assert.match(modal, /fixed inset-y-0 left-0 right-0/)
assert.match(modal, /md:left-\[var\(--app-sidebar-width\)\]/)
assert.match(modal, /p-0 md:left-\[var\(--app-sidebar-width\)\] md:p-4/)
assert.doesNotMatch(modal, /sm:left-\[var\(--app-sidebar-width\)\]/)

assert.match(modal, /h-full w-full flex-col/)
assert.match(modal, /md:h-\[min\(760px,calc\(100dvh-32px\)\)\]/)
assert.match(modal, /md:w-\[min\(100%,1040px\)\]/)
assert.match(modal, /min-h-0 flex-1 overflow-y-auto overscroll-contain/)
assert.match(modal, /flex-shrink-0 border-b/)
assert.match(modal, /<footer className="flex flex-shrink-0/)
assert.doesNotMatch(modal, /transition-\[height\]|transition-all.*h-/)

assert.match(modal, /<header className="[^"]*bg-\[#173f2a\][^"]*text-white/)
assert.match(modal, /text-white\/70/)
assert.match(modal, /focus-visible:ring-\[#e7ca78\]/)
assert.match(modal, /border-\[#e8e1d1\] bg-white/)
assert.match(modal, /after:bg-\[#b89138\]/)
assert.match(modal, /bg-\[#fffdf7\]/)

assert.doesNotMatch(modal, /bg-blue-50 border border-blue-100|border-blue-100 rounded-xl/)
assert.doesNotMatch(modal, /rounded-xl bg-amber-50 px-3 py-2/)
assert.match(modal, /bg-primary-50\/50/)
assert.match(modal, /bg-\[#fff9e9\]/)
assert.match(modal, /border-s-2 border-amber-400/)

for (const tab of ['general', 'access', 'pos', 'modules', 'invoices', 'zatca']) {
  assert.match(modal, new RegExp(`branch-panel-${tab}`))
}
assert.match(modal, /activeTab === 'access'/)
assert.match(modal, /activeTab === 'general'/)
assert.match(modal, /overflow-x-auto/)
assert.match(modal, /isRtl \? -1 : 1/)

assert.match(modal, /create_branch_for_tenant/)
assert.match(modal, /update_branch_pos_settings/)
assert.match(modal, /update_branch_module_settings/)
assert.match(modal, /create-branch-user/)
assert.match(modal, /kind="discard"/)
assert.match(modal, /requestClose\(onResetPassword\)/)
assert.match(modal, /navigate\('\/zatca'\)/)

console.log('Branch modal Product-language branding, sidebar-aware centering, stable dimensions, internal scrolling, and contract checks passed.')
