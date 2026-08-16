import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = path => readFileSync(join(root, path), 'utf8')

function sourceFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .flatMap(entry => {
      const relative = join(directory, entry.name)
      return entry.isDirectory()
        ? sourceFiles(relative)
        : /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : []
    })
}

const branchDashboard = read('src/pages/branch/BranchDashboardPage.tsx')
const adminBranchDetail = read('src/pages/admin/BranchDetailPage.tsx')
const productStockTab = read('src/pages/inventory/ProductStockTab.tsx')
const productsPage = read('src/pages/products/ProductsPage.tsx')
const posPage = read('src/pages/pos/POSPage.tsx')
const databaseTypes = read('src/types/database.ts')
const baseSchema = read('supabase/schema.sql')
const canonicalSchema = read('supabase/migrations/20260721000100_dafra_current_schema_and_security.sql')
const browserSources = sourceFiles('src').map(read).join('\n')

for (const dashboard of [branchDashboard, adminBranchDetail]) {
  assert.match(dashboard, /\.select\('id, name, stock_quantity, min_stock_alert, track_stock, is_service, is_active, is_available'\)/)
  assert.match(dashboard, /\.not\('min_stock_alert', 'is', null\)/)
  assert.match(dashboard, /\.eq\('is_service', false\)/)
  assert.match(dashboard, /filter\(isLowStockProduct\)/)
  assert.doesNotMatch(dashboard, /min_stock_level/)
}

assert.match(adminBranchDetail, /min: p\.min_stock_alert/)
assert.match(databaseTypes, /min_stock_alert: number/)
assert.match(baseSchema, /min_stock_alert\s+NUMERIC\(12, 3\) DEFAULT 0/)
assert.match(canonicalSchema, /"min_stock_alert" numeric\(12,3\) DEFAULT 0/)
assert.doesNotMatch(baseSchema + canonicalSchema, /min_stock_level/)

assert.match(productStockTab, /'stock_quantity', 'min_stock_alert'/)
assert.match(productStockTab, /\.eq\('track_stock', true\)/)
assert.match(productsPage, /'stock_quantity', 'min_stock_alert'/)
assert.match(productsPage, /'min_stock_alert', 'track_stock'/)
assert.match(posPage, /stock_quantity, track_stock/)

assert.doesNotMatch(browserSources, /min_stock_level/)
assert.doesNotMatch(
  browserSources,
  /\.from\(\s*['"]products['"]\s*\)[\s\S]{0,500}?\.select\(\s*['"]\*['"]\s*\)/,
)

console.log('Dashboard product schema compatibility: canonical min_stock_alert selectors and explicit product reads passed')
