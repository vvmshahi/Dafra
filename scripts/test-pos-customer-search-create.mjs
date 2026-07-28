import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pos = read('src/pages/pos/POSPage.tsx')
const modal = read('src/pages/pos/PosCustomerQuickCreateModal.tsx')
const en = JSON.parse(read('src/localization/locales/en/pos.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))
const server = await createServer({ appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' })

try {
  const customer = await server.ssrLoadModule('/src/lib/pos/customerSearch.ts')
  const fixtures = [
    {
      id: 'individual', name: 'Sara Ali', name_ar: 'سارة علي', phone: '0512345678',
      customer_type: 'individual', vat_number: null, business_name: null,
      business_name_ar: null, cr_number: null, address: null, address_ar: null,
    },
    {
      id: 'business', name: 'Omar', name_ar: null, phone: '+966 55 000 0000',
      customer_type: 'business', vat_number: '300000000000003',
      business_name: 'Dafra Trading', business_name_ar: 'دفرة للتجارة',
      cr_number: '1010101010', address: null, address_ar: null,
    },
    {
      id: 'partial-mobile', name: 'Sara Other', name_ar: null, phone: '0500125678',
      customer_type: 'individual', vat_number: null, business_name: null,
      business_name_ar: null, cr_number: null, address: null, address_ar: null,
    },
  ]

  assert.equal(customer.normalizeSaudiMobile('0512345678'), '0512345678')
  assert.equal(customer.normalizeSaudiMobile('512345678'), '0512345678')
  assert.equal(customer.normalizeSaudiMobile('+966 51 234 5678'), '0512345678')
  assert.equal(customer.normalizeSaudiMobile('966512345678'), '0512345678')
  assert.equal(customer.searchCustomers(fixtures, 'Sara')[0].id, 'individual')
  assert.equal(customer.searchCustomers(fixtures, 'سارة')[0].id, 'individual')
  assert.equal(customer.searchCustomers(fixtures, 'دفرة')[0].id, 'business')
  assert.equal(customer.searchCustomers(fixtures, '512345678')[0].id, 'individual')
  assert.equal(customer.searchCustomers(fixtures, '+966512345678')[0].id, 'individual')
  assert.equal(customer.searchCustomers(fixtures, '5678').length, 2)
  assert.equal(customer.searchCustomers(fixtures, 'unknown').length, 0)

  assert.equal(customer.findCustomerDuplicate(fixtures, { phone: '512345678' }).id, 'individual')
  assert.equal(customer.findCustomerDuplicate(fixtures, { phone: '0599999999', vatNumber: '300000000000003' }).id, 'business')
  assert.equal(customer.findCustomerDuplicate(fixtures, { phone: '0599999999', crNumber: '1010101010' }).id, 'business')

  const created = { ...fixtures[0], id: 'created' }
  let insertCalls = 0
  const client = {
    from(table) {
      assert.equal(table, 'customers')
      return {
        insert(payload) {
          insertCalls++
          assert.equal(payload.name, 'نورة')
          assert.equal(payload.name_ar, null)
          return { select: () => ({ single: async () => ({ data: created, error: null, status: 201 }) }) }
        },
      }
    },
  }
  assert.equal((await customer.createPosCustomer(client, { name: 'نورة', name_ar: null })).id, 'created')
  assert.equal(insertCalls, 1)
  for (const response of [
    { data: null, error: { code: '23505', message: 'duplicate' }, status: 409 },
    { data: null, error: null, status: 201 },
    { data: created, error: null, status: 500 },
  ]) {
    const failureClient = { from: () => ({ insert: () => ({ select: () => ({ single: async () => response }) }) }) }
    await assert.rejects(() => customer.createPosCustomer(failureClient, {}))
  }

  assert.match(pos, /role="combobox"/)
  assert.match(pos, /aria-activedescendant=/)
  assert.match(pos, /role="listbox"/)
  assert.match(pos, /role="option"/)
  assert.match(pos, /searchCustomers\(customers, custSearch\)/)
  assert.match(pos, /setCustomers\(current => \[\.\.\.current, customer\]\)/)
  assert.match(pos, /setCustomerId\(customer\.id\)/)
  assert.match(pos, /customer_id: customerId/)
  assert.match(pos, /custOpen \|\| showQuickCustomer/)
  assert.match(pos, /setCustomerId\(null\)/)
  assert.match(pos, /limit\(200\)/)

  assert.match(modal, /name: type === 'business' \? \(contactPerson\.trim\(\) \|\| displayName\) : displayName/)
  assert.match(modal, /business_name: type === 'business' \? displayName : null/)
  assert.match(modal, /name_ar: null/)
  assert.match(modal, /business_name_ar: null/)
  assert.match(modal, /if \(saving\) return/)
  assert.match(modal, /findCustomerDuplicate/)
  assert.match(modal, /createPosCustomer/)
  assert.match(modal, /role="dialog"/)
  assert.match(modal, /event\.key === 'Escape'/)
  assert.match(modal, /event\.key !== 'Tab'/)
  assert.doesNotMatch(modal, /English Name|Arabic Name|customer-name-ar|customer-business-name-ar/)

  const createdCallback = pos.slice(pos.indexOf('onCreated={customer =>'), pos.indexOf('/>', pos.indexOf('onCreated={customer =>')))
  assert.doesNotMatch(createdCallback, /setCart|setNote|setPayMethod|setSplit|setCash/)

  assert.deepEqual(Object.keys(en.customerQuick).sort(), Object.keys(ar.customerQuick).sort())
  for (const locale of [en, ar]) {
    for (const value of Object.values(locale.customerQuick)) assert.equal(typeof value, 'string')
  }

  console.log('POS customer ranked search, Saudi mobile normalization, duplicate prevention, verified creation, and state-preservation tests passed.')
} finally {
  await server.close()
}
