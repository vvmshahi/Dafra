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
assert.match(directory, /customer\.vat_number \|\| customer\.cr_number/)
assert.match(directory, /bg-teal-50 text-teal-700/)
assert.match(detail, /const PROFILE_SECTIONS: CustomerProfileSection\[\] = \['overview', 'invoices', 'products', 'credit'\]/)
assert.match(detail, /value === 'documents'.*return 'invoices'/s)
assert.match(detail, /value === 'report'.*return 'overview'/s)
assert.doesNotMatch(detail, /activeProfileSection === 'products' \|\| activeProfileSection === 'report'/)
assert.doesNotMatch(detail, /activeProfileSection === 'invoices' \|\| activeProfileSection === 'documents'/)
assert.match(filters, /'yesterday'/)
assert.match(filters, /preset === 'custom'/)
assert.match(intelligence, /case 'yesterday'/)

console.log('Customer profile targeted refinement contract passed')
