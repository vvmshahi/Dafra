import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { calculatePreview, canCheckout, resolveMobileRole } from '../src/domain.ts'
import { products } from '../src/fixtures.ts'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const app = read('src/RedesignedApp.tsx')
const auth = read('src/mobileAuth.ts')
const css = read('src/redesign.css')
const pkg = read('package.json')
const vite = read('vite.config.ts')
const storage = read('src/platform/cartStorage.ts')

function test(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`) }
  catch (error) { console.error(`FAIL ${name}`); throw error }
}

test('approved Kubri assets are used for icon, wordmark and header mark', () => {
  for (const asset of ['kubiri-app-icon.png', 'kubiri-wordmark.png', 'kubiri-logo-mark.png']) {
    assert.match(app, new RegExp(asset))
    assert.equal(fs.existsSync(path.resolve(root, '../../public/brand', asset)), true)
  }
  assert.match(vite, /publicDir:\s*'\.\.\/\.\.\/public'/)
})
test('POC language is absent from the redesigned experience', () => assert.doesNotMatch(app, /proof of concept|Kubri Mobile Operations|run the day from your pocket/i))
test('real auth supports email, branch username and authoritative role resolution', () => {
  assert.match(pkg, /@supabase\/supabase-js/)
  assert.match(auth, /signInWithPassword/)
  assert.match(auth, /resolve-branch-username/)
  assert.match(auth, /user_profiles/)
  assert.match(auth, /data\.role === 'super_admin'/)
})
test('session restoration, refresh and logout are supported', () => {
  assert.match(auth, /persistSession:\s*true/)
  assert.match(auth, /autoRefreshToken:\s*true/)
  assert.match(auth, /getSession/)
  assert.match(auth, /auth\.signOut/)
})
test('demo bypass is guarded by an explicit build-time flag', () => {
  assert.match(app, /VITE_MOBILE_DEMO_MODE === 'true'/)
  assert.doesNotMatch(app, /VITE_MOBILE_DEMO_MODE !== 'false'/)
})
test('WhatsApp uses the approved support number and localized prefill', () => {
  assert.match(app, /971561373210/)
  assert.match(app, /create a Kubri account/)
  assert.match(app, /إنشاء حساب Kubri/)
})
test('Branch bottom navigation has exactly the three approved destinations', () => {
  const nav = app.slice(app.indexOf('function BranchNav'), app.indexOf('function BranchHome'))
  for (const tab of ["'home'", "'sale'", "'invoices'"]) assert.match(nav, new RegExp(tab))
  assert.equal((nav.match(/\['(?:home|sale|invoices)'/g) ?? []).length, 3)
})
test('drawer preserves the supported Branch modules', () => {
  for (const label of ['Products','Stock','Customers','Purchases','Suppliers','Expenses','Register / Session','Reports','Settings / Profile','Help & Support']) assert.match(app, new RegExp(label.replace('/', '\\/')))
})
test('RTL and Android Back behavior are present', () => {
  assert.match(app, /document\.documentElement\.dir/)
  assert.match(css, /\[dir=(?:"rtl"|rtl)\]/)
  assert.match(app, /addListener\('backButton'/)
  assert.match(app, /NativeApp\.minimizeApp/)
})
test('home contains featured KPI, register, recent invoices and low-stock attention', () => {
  for (const contract of ['sales-ledger','quick-grid','register-card','Recent invoices','low in stock']) assert.match(app, new RegExp(contract))
})
test('POS provides search, categories, scanner, repeated quantity and cart dock', () => {
  for (const contract of ['product-search','category-row','scanSingleBarcode','Math.min\\(l.quantity\\+1','final-cart-dock']) assert.match(app, new RegExp(contract))
})
test('cart survives tab changes and stores no invoice/payment queue', () => {
  assert.match(app, /cartStorage\.restore/)
  assert.match(app, /cartStorage\.save/)
  assert.doesNotMatch(storage, /queue|invoice_number|payment|fiscal/i)
})
test('payment methods and simulation-only success are explicit', () => {
  for (const method of ["'cash'","'card'","'split'","'credit'"]) assert.match(app, new RegExp(method))
  assert.match(app, /PAYMENT COMPLETE · SIMULATION/)
  assert.match(app, /No production invoice, payment or stock record/)
})
test('offline and reconciliation boundaries prevent checkout', () => {
  const line = [{ product: products[0], quantity: 1 }]
  assert.equal(canCheckout('offline', false, line), false)
  assert.equal(canCheckout('online', true, line), false)
  assert.match(app, /Nothing will be queued/)
})
test('mobile never chooses a production fiscal path', () => {
  assert.doesNotMatch(app + auth, /pos_checkout|prepare_zatca|production_csid|service_role/i)
  const preview = calculatePreview([{ product: products[0], quantity: 1 }], 'request-123')
  assert.equal(preview.serverConfirmed, false)
  assert.equal(preview.requestId, 'request-123')
})
test('invoice screen includes mobile filters, status and actions', () => {
  for (const contract of ['Today','All methods','Current session','Reported','Pending','Invoice actions']) assert.match(app, new RegExp(contract))
})
test('accessibility and reduced-motion contracts are present', () => {
  assert.match(app, /aria-label=/)
  assert.match(app, /role="alert"/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /min-height:\s*44px/)
})
test('required native dependencies remain present', () => {
  for (const dependency of ['@capacitor/barcode-scanner','@capacitor/share','@capacitor/network','@capacitor/app']) assert.match(pkg, new RegExp(dependency.replace('/', '\\/')))
})

console.log('Mobile redesign focused contract suite complete.')
