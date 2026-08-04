import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const directory = read('src/pages/customers/CustomersPage.tsx')
const detail = read('src/pages/customers/CustomerDetailPage.tsx')
const filters = read('src/components/customers/CustomerIntelligenceFilters.tsx')
const intelligence = read('src/lib/customers/customerIntelligence.ts')

assert.match(directory, /<table className="w-full min-w-\[1050px\]/)
assert.match(directory, /fields\.city/)
assert.match(directory, /fields\.lastPurchase/)
assert.match(directory, /loadCustomerReport/)
assert.match(directory, /const identifier = customer\.vat_number/)
assert.match(directory, /bg-teal-50 text-teal-700/)
assert.match(detail, /const PROFILE_SECTIONS: CustomerProfileSection\[\] = \['overview', 'products', 'credit'\]/)
assert.match(detail, /value === 'documents'.*return 'overview'/s)
assert.match(detail, /value === 'report'.*return 'overview'/s)
assert.match(detail, /value === 'invoices'.*return 'overview'/s)
assert.match(detail, /bg-\[#173d2a\]/)
assert.doesNotMatch(detail, /pdf\.action.*Download/s)
assert.match(detail, /activeProfileSection === 'overview' && <section className="card overflow-hidden" aria-labelledby="history-title">/)
assert.match(filters, /'yesterday'/)
assert.match(filters, /preset === 'custom'/)
assert.match(intelligence, /case 'yesterday'/)

console.log('Customer profile targeted refinement contract passed')
