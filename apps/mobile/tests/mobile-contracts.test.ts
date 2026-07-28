import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { calculatePreview, canCheckout, matchesCustomer, resolveMobileRole } from '../src/domain.ts'
import { customers, products } from '../src/fixtures.ts'

const root = path.resolve(import.meta.dirname, '..')
const appSource = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const configSource = fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8')
const packageSource = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
const storageSource = fs.readFileSync(path.join(root, 'src/platform/cartStorage.ts'), 'utf8')

function test(name: string, run: () => void) {
  try {
    run()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

test('Owner role routes to the mobile owner contract', () => assert.equal(resolveMobileRole('owner'), 'owner'))
test('Branch role routes to the mobile branch contract', () => assert.equal(resolveMobileRole('branch'), 'branch'))
test('Super Admin is rejected by mobile role resolution', () => assert.equal(resolveMobileRole('super_admin'), null))
test('Unknown and stale roles are rejected', () => assert.equal(resolveMobileRole('admin'), null))
test('Owner bottom navigation includes all five approved tabs', () => {
  for (const tab of ['home', 'branches', 'reports', 'activity', 'more']) assert.match(appSource, new RegExp(`'${tab}'`))
})
test('Branch bottom navigation uses Sales, not an invented Orders domain', () => {
  for (const tab of ['pos', 'sales', 'products', 'customers', 'more']) assert.match(appSource, new RegExp(`'${tab}'`))
})
test('Production checkout and onboarding clients are absent', () => {
  assert.doesNotMatch(appSource, /pos_checkout|prepare_zatca|onboard-zatca|production_csid/i)
  assert.doesNotMatch(packageSource, /@supabase\/supabase-js/)
})
test('No production environment URL or secret is bundled', () => {
  assert.doesNotMatch(configSource + appSource, /supabase\.co|service_role|anon[_-]?key|eyJhbGci/)
})
test('Checkout is blocked offline', () => assert.equal(canCheckout('offline', false, [{ product: products[0], quantity: 1 }]), false))
test('Checkout is blocked while reconnect state is reconciled', () => assert.equal(canCheckout('online', true, [{ product: products[0], quantity: 1 }]), false))
test('Checkout preview is explicitly not server-confirmed', () => {
  const result = calculatePreview([{ product: products[0], quantity: 1 }], 'request-123')
  assert.equal(result.serverConfirmed, false)
  assert.equal(result.requestId, 'request-123')
  assert.equal(result.classification, 'SIMPLIFIED_PREVIEW')
})
test('Cart storage retains cart and request id only, never invoices or payments', () => {
  assert.match(storageSource, /unsent-cart/)
  assert.match(storageSource, /checkout-request/)
  assert.doesNotMatch(storageSource, /queue|invoice_number|payment|fiscal/i)
})
test('Product search supports barcode', () => assert.equal(products.find(p => p.barcode === '6281100001011')?.id, 'p1'))
test('Customer mobile lookup requires exact normalized match', () => {
  assert.equal(matchesCustomer(customers[0], '0501234588'), true)
  assert.equal(matchesCustomer(customers[0], '050123'), false)
})
test('Arabic and RTL runtime contracts are present', () => {
  assert.match(appSource, /ar-SA/)
  assert.match(appSource, /documentElement\.dir/)
})
test('Android Back returns to role home before minimizing', () => {
  assert.match(appSource, /addListener\('backButton'/)
  assert.match(appSource, /setOwnerTab\('home'\)/)
  assert.match(appSource, /setBranchTab\('pos'\)/)
  assert.match(appSource, /minimizeApp/)
})
test('Deep links default to no navigation outside the reserved scheme', () => {
  assert.match(appSource, /addListener\('appUrlOpen'/)
  assert.match(appSource, /startsWith\('kubri:\/\/'\)/)
})
test('Receipt result is visibly simulation-only', () => {
  assert.match(appSource, /SIMULATED RESULT/)
  assert.match(appSource, /No server-confirmed invoice was issued/)
})
test('Native barcode, share, network and app lifecycle dependencies are present', () => {
  for (const dependency of ['@capacitor/barcode-scanner', '@capacitor/share', '@capacitor/network', '@capacitor/app']) {
    assert.match(packageSource, new RegExp(dependency.replace('/', '\\/')))
  }
})

console.log('Mobile focused contract suite complete.')
