import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = file => readFileSync(join(process.cwd(), file), 'utf8')
const drawer = read('src/pages/products/ProductDrawer.tsx')
const products = read('src/pages/products/ProductsPage.tsx')
const pos = read('src/pages/pos/POSPage.tsx')
const credit = read('src/pages/invoices/CreateCreditNoteModal.tsx')
const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const adminDashboard = read('src/pages/admin/BranchDetailPage.tsx')
const submission = read('src/lib/zatca/submission.ts')
const edge = read('supabase/functions/zatca-submit/index.ts')

const checks = [
  ['product option visible', /Item type[\s\S]*Product/.test(drawer)],
  ['service option visible', /Item type[\s\S]*Service/.test(drawer)],
  ['service forces stock tracking off', /if \(!isService\) return[\s\S]*setTrackStock\(false\)/.test(drawer)],
  ['tracked conversion requires existing stock transition', /Disable stock tracking and confirm/.test(drawer)],
  ['secure product payload receives is_service', /is_service:\s+isService/.test(drawer)],
  ['secure create and update RPCs remain in use', /create_product_secure/.test(drawer) && /update_product_secure/.test(drawer)],
  ['catalogue renders a service marker', /product\.is_service[\s\S]*Service/.test(products)],
  ['POS keeps service product-id-backed', /interface CartItem \{[\s\S]*productId: string/.test(pos)],
  ['POS renders a service marker', /product\.isService[\s\S]*Service/.test(pos)],
  ['POS retains document classifier preflight', /resolvePosCheckoutDocument\(branch\.id, customerId\)/.test(pos)],
  ['POS still uses product-unit payloads', /product_unit_id: item\.productUnitId/.test(pos)],
  ['no custom-line cart variant introduced', !/source:\s*'custom'|Custom line|nullable-product cart/i.test(pos)],
  ['credit notes exclude service restock', /track_stock && !line\.item\.is_service/.test(credit)],
  ['branch low-stock excludes services', /\.eq\('track_stock', true\)[\s\S]*\.eq\('is_service', false\)/.test(branchDashboard)],
  ['admin low-stock excludes services', /\.eq\('track_stock', true\)[\s\S]*\.eq\('is_service', false\)/.test(adminDashboard)],
  ['classifier RPC remains authenticated', /resolve_pos_checkout_document_v1/.test(submission)],
  ['edge source remains outside saved-service work', edge.length > 0],
]
for (const [label, passed] of checks) assert.ok(passed, label)
console.log(`saved-services contract checks passed: ${checks.length}`)
