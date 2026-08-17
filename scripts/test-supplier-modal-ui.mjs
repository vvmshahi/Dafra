import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const modal = read('src/pages/suppliers/SupplierModal.tsx')
const page = read('src/pages/suppliers/SuppliersPage.tsx')
const detail = read('src/pages/suppliers/SupplierDetailPage.tsx')
const purchase = read('src/pages/inventory/PurchaseHistoryTab.tsx')
const en = JSON.parse(read('src/localization/locales/en/suppliers.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/suppliers.json'))

// One shared centered Add/Edit modal replaces the right drawer.
assert.match(modal, /role="dialog"/)
assert.match(modal, /aria-modal="true"/)
assert.match(modal, /max-w-\[900px\]/)
assert.match(modal, /md:left-\[var\(--app-sidebar-width\)\]/)
assert.doesNotMatch(modal, /fixed inset-y-0 right-0|max-w-\[520px\]/)
assert.doesNotMatch(modal, /role="tab"|role="tablist"/)
assert.match(page, /import SupplierModal from '\.\/SupplierModal'/)
assert.match(detail, /import SupplierModal from '\.\/SupplierModal'/)
assert.equal((page.match(/<SupplierModal/g) ?? []).length, 1)
assert.equal((detail.match(/<SupplierModal/g) ?? []).length, 1)

// Structured, responsive sections and live preview.
for (const section of ['identity', 'registration', 'contact', 'addressPayment', 'optional']) {
  assert.match(modal, new RegExp(`suppliers:sections\\.${section}`))
}
assert.match(modal, /lg:grid-cols-\[minmax\(0,1\.55fr\)_minmax\(280px,1fr\)\]/)
assert.match(modal, /lg:sticky lg:top-0/)
assert.match(modal, /supplier-preview-heading/)
assert.match(modal, /name\.trim\(\) \|\| t\('suppliers:preview\.unnamed'\)/)
assert.match(modal, /vatNumber \|\| t\('suppliers:preview\.notProvided'\)/)

// One language-neutral primary name field preserves the existing name contract.
assert.match(modal, /if \(!name\.trim\(\)\)/)
assert.match(modal, /disabled=\{saving \|\| !name\.trim\(\)\}/)
assert.match(modal, /nameRef\.current\?\.focus\(\)/)
assert.doesNotMatch(modal, /if \(!nameAr|if \(!vatNumber|if \(!crNumber|if \(!phone/)
assert.match(modal, /label=\{t\('suppliers:fields\.name'\)\}/)
assert.doesNotMatch(modal, /fields\.nameEn|fields\.nameAr/)
assert.match(modal, /maxLength=\{15\}/)
assert.match(modal, /type="tel" inputMode="tel"/)
assert.match(modal, /emailOpen/)
assert.match(modal, /addressOpen/)
assert.match(modal, /notesOpen/)
for (const action of ['addEmail', 'addAddress', 'addNotes']) {
  assert.match(modal, new RegExp(`suppliers:actions\\.${action}`))
}

// Exact payment terms and supplier payload remain unchanged.
for (const value of ['cash', 'credit_30', 'credit_60']) {
  assert.match(modal, new RegExp(`<option value="${value}">`))
}
for (const field of [
  'tenant_id: profile?.tenant_id!',
  'branch_id: profile?.branch_id',
  'name: name.trim()',
  'name_ar: nameAr.trim() || null',
  'vat_number: vatNumber.trim() || null',
  'cr_number: crNumber.trim() || null',
  'contact_person: contactPerson.trim() || null',
  'phone: phone.trim() || null',
  'email: email.trim() || null',
  'city: city.trim() || null',
  'address: address.trim() || null',
  'payment_terms: paymentTerms',
  'notes: notes.trim() || null',
]) assert.ok(modal.includes(field), `missing supplier payload field: ${field}`)
assert.match(modal, /\.from\('suppliers'\)\.insert\(payload\)/)
assert.match(modal, /\.from\('suppliers'\)\.update\(payload\)\.eq\('id', supplier\.id\)/)

// State lifecycle, feedback, duplicate safety, and accessibility.
assert.match(modal, /if \(saving\) return/)
assert.match(modal, /saveError\.code === '23505'/)
assert.match(modal, /suppliers:errors\.duplicate/)
assert.match(modal, /toast\.success/)
assert.match(modal, /onSaved\(\)[\s\S]*?resetForm\(\)[\s\S]*?onClose\(\)/)
assert.match(modal, /event\.key === 'Escape'/)
assert.match(modal, /event\.key !== 'Tab'/)
assert.match(modal, /previousFocusRef\.current\?\.focus\(\)/)
assert.match(modal, /role="alert" aria-live="assertive"/)
assert.match(modal, /active:scale-\[0\.97\]/)

// KPI calculations and purchase integration remain connected.
assert.equal((page.match(/grid grid-cols-1 gap-3 sm:grid-cols-3/g) ?? []).length, 1)
assert.match(page, /bg-\[#173f2a\]/)
assert.match(page, /bg-\[#edf6f4\]/)
assert.match(page, /Open Supplier Reports|supplierIntelligence:reports\.openReports/)
assert.match(page, /const totalPurchased = suppliers\.reduce/)
assert.match(page, /const creditCount\s+= suppliers\.filter/)
assert.match(page, /onSaved=\{load\}/)
assert.match(purchase, /\.from\('suppliers'\)/)
assert.match(purchase, /\.eq\('is_active', true\)/)

for (const locale of [en, ar]) {
  for (const section of ['identity', 'registration', 'contact', 'addressPayment', 'optional']) {
    assert.equal(typeof locale.sections[section], 'string')
  }
  assert.equal(typeof locale.modal.subtitle, 'string')
  assert.equal(typeof locale.preview.eyebrow, 'string')
  assert.equal(typeof locale.fields.name, 'string')
  for (const action of ['addEmail', 'addAddress', 'addNotes']) {
    assert.equal(typeof locale.actions[action], 'string')
  }
  assert.equal(typeof locale.success.added, 'string')
  assert.equal(typeof locale.success.updated, 'string')
  for (const duplicate of ['name', 'vatNumber', 'crNumber', 'phone', 'email']) {
    assert.equal(typeof locale.errors.duplicate[duplicate], 'string')
  }
}

console.log('Supplier centered modal, payload, validation, preview, accessibility, KPI, and purchase integration checks passed.')
