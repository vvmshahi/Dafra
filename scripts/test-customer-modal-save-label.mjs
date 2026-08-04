import assert from 'node:assert/strict'
import fs from 'node:fs'

const modal = fs.readFileSync('src/pages/customers/CustomerModal.tsx', 'utf8')
const en = JSON.parse(fs.readFileSync('src/localization/locales/en/common.json', 'utf8'))
const ar = JSON.parse(fs.readFileSync('src/localization/locales/ar-SA/common.json', 'utf8'))

assert.equal(en.saveChanges, 'Save changes')
assert.equal(ar.saveChanges, 'حفظ التغييرات')
assert.equal(en.saving, 'Saving…')
assert.equal(ar.saving, 'جارٍ الحفظ…')
assert.match(modal, /saving \? t\('common:saving'\) : t\(customer \? 'common:saveChanges' : 'customers:add'\)/)
assert.match(modal, /loading=\{saving\} disabled=\{saving \|\| !formCanSubmit\}/)
assert.doesNotMatch(modal, /t\('common:saveChanges'\)\s*\}/)

console.log('Customer modal save-label contract passed')
