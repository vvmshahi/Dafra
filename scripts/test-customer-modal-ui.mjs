import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const modal = readFileSync(new URL('../src/pages/customers/CustomerModal.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/pages/customers/CustomersPage.tsx', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../src/pages/customers/CustomerDetailPage.tsx', import.meta.url), 'utf8')
const pos = readFileSync(new URL('../src/pages/pos/POSPage.tsx', import.meta.url), 'utf8')
const en = JSON.parse(readFileSync(new URL('../src/localization/locales/en/customers.json', import.meta.url), 'utf8'))
const ar = JSON.parse(readFileSync(new URL('../src/localization/locales/ar-SA/customers.json', import.meta.url), 'utf8'))

test('add and edit use one centered, responsive dialog rather than a drawer', () => {
  assert.match(page, /import CustomerModal from '\.\/CustomerModal'/)
  assert.match(detail, /import CustomerModal from '\.\/CustomerModal'/)
  assert.match(page, /<CustomerModal/)
  assert.match(detail, /<CustomerModal/)
  assert.match(modal, /role="dialog"/)
  assert.match(modal, /aria-modal="true"/)
  assert.match(modal, /items-center justify-center/)
  assert.match(modal, /max-w-\[940px\]/)
  assert.doesNotMatch(modal, /role="tab"|CustomerDrawer|translate-x/)
})

test('customer type remains an accessible, non-colour-only radio choice', () => {
  assert.match(modal, /type="radio"/)
  assert.match(modal, /name="customer-type"/)
  assert.match(modal, /value: 'individual'/)
  assert.match(modal, /value: 'business'/)
  assert.match(modal, /selected \? <Check/)
  assert.match(modal, /useState<CustomerType>\('individual'\)/)
  assert.match(modal, /customer\?\.customer_type/)
})

test('individual and business sections are conditional and use the existing fields', () => {
  assert.match(modal, /\{isBusiness \? \(/)
  assert.match(modal, /\{isBusiness && \(/)
  assert.match(modal, /customer-name/)
  assert.match(modal, /customer-name-ar/)
  assert.match(modal, /customer-business-name/)
  assert.match(modal, /customer-business-name-ar/)
  assert.match(modal, /customer-vat/)
  assert.match(modal, /customer-cr/)
  assert.match(modal, /customer-contact-name/)
  assert.match(modal, /customer-phone/)
  assert.match(modal, /customer-email/)
  assert.match(modal, /customer-city/)
  assert.match(modal, /customer-address/)
})

test('validation preserves the existing phone, VAT and CR policy', () => {
  assert.match(modal, /SAUDI_MOBILE_RE = \/\^05\[0-9\]\{8\}\$\//)
  assert.match(modal, /VAT_RE = \/\^3\\d\{13\}3\$\//)
  assert.match(modal, /type="email"/)
  assert.match(modal, /inputMode="numeric"/)
  assert.doesNotMatch(modal, /CR_RE|crInvalid/)
  assert.match(modal, /businessNameRef\.current\?\.focus\(\)/)
  assert.match(modal, /nameRef\.current\?\.focus\(\)/)
})

test('payload retains names, scope, shared fields, and safely nulls hidden business data', () => {
  assert.match(modal, /tenant_id: profile\?\.tenant_id/)
  assert.match(modal, /branch_id: profile\?\.branch_id/)
  assert.match(modal, /customer_type: custType/)
  assert.match(modal, /name: isBusiness \? \(name\.trim\(\) \|\| businessName\.trim\(\)\) : name\.trim\(\)/)
  assert.match(modal, /name_ar: nameAr\.trim\(\) \|\| null/)
  assert.match(modal, /business_name: isBusiness \? businessName\.trim\(\) : null/)
  assert.match(modal, /business_name_ar: isBusiness \? \(businessNameAr\.trim\(\) \|\| null\) : null/)
  assert.match(modal, /company_name: isBusiness \? businessName\.trim\(\) : null/)
  assert.match(modal, /vat_number: isBusiness \? \(vatTrimmed \|\| null\) : null/)
  assert.match(modal, /cr_number: isBusiness \? \(crNumber\.trim\(\) \|\| null\) : null/)
  for (const field of ['phone', 'email', 'city', 'address', 'notes']) {
    assert.match(modal, new RegExp(`${field}: ${field}\\.trim\\(\\) \\|\\| null`))
  }
})

test('create/update handling blocks duplicates, preserves failures, and closes only on success', () => {
  assert.match(modal, /if \(saving\) return/)
  assert.match(modal, /\.from\('customers'\)\.insert\(payload\)/)
  assert.match(modal, /\.from\('customers'\)\.update\(payload\)\.eq\('id', customer\.id\)/)
  assert.match(modal, /if \(insertError\)[\s\S]*handleSaveError\(insertError\)[\s\S]*return/)
  assert.match(modal, /if \(updateError\)[\s\S]*handleSaveError\(updateError\)[\s\S]*return/)
  assert.match(modal, /saveError\.code === '23505'/)
  assert.match(modal, /toast\.success/)
  assert.match(modal, /onSaved\(\)[\s\S]*resetForm\(\)[\s\S]*onClose\(\)/)
})

test('preview and readiness reflect the existing standard-invoice rule only', () => {
  assert.match(modal, /customers:preview\.eyebrow/)
  assert.match(modal, /role="status"/)
  assert.match(modal, /!businessName\.trim\(\)[\s\S]*!vatTrimmed[\s\S]*!vatIsValid[\s\S]*'ready'/)
  assert.match(pos, /selectedCust\?\.customer_type === 'business'/)
  assert.match(pos, /\/\^3\[0-9\]\{13\}3\$\/\.test\(selectedCust\.vat_number \?\? ''\)/)
})

test('modal lifecycle is keyboard accessible and reset between customers', () => {
  assert.match(modal, /previousFocusRef/)
  assert.match(modal, /event\.key === 'Escape'/)
  assert.match(modal, /event\.key !== 'Tab'/)
  assert.match(modal, /nodes\[nodes\.length - 1\]\.focus\(\)/)
  assert.match(modal, /resetForm\(\)/)
  assert.match(modal, /aria-labelledby="customer-modal-title"/)
  assert.match(modal, /aria-live="assertive"/)
})

test('POS refresh mapping and customer filter/count logic remain present', () => {
  assert.match(pos, /\.from\('customers'\)/)
  assert.match(pos, /customer_type: c\.customer_type \?\? 'individual'/)
  assert.match(page, /customers\.filter\(c => c\.customer_type === 'individual'\)\.length/)
  assert.match(page, /customers\.filter\(c => c\.customer_type === 'business'\)\.length/)
  assert.match(page, /filterType === 'all' \|\| c\.customer_type === filterType/)
})

test('English and Arabic modal, readiness, duplicate, empty and success copy exists', () => {
  assert.equal(en.modal.subtitle, 'Add personal or business customer details.')
  assert.equal(en.emptyHint, 'Add customers for faster sales and invoice creation.')
  assert.equal(en.success.added, 'Customer added successfully.')
  assert.equal(en.success.updated, 'Customer updated successfully.')
  assert.match(en.readiness.ready, /standard tax invoice/)
  assert.ok(en.errors.duplicate.vatNumber)
  assert.ok(ar.modal.subtitle)
  assert.ok(ar.emptyHint)
  assert.ok(ar.success.added)
  assert.ok(ar.success.updated)
  assert.ok(ar.readiness.ready)
  assert.ok(ar.errors.duplicate.vatNumber)
})
