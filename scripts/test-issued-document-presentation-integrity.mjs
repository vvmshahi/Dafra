import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = path => readFileSync(resolve(root, path), 'utf8')

const migration = read('supabase/migrations/20260817000600_capture_immutable_invoice_buyer_snapshot_v1.sql')
const types = read('src/types/database.ts')
const adapters = read('src/lib/invoices/documentViewAdapters.ts')
const model = read('src/lib/invoices/documentViewModel.ts')
const readiness = read('src/lib/invoices/documentPresentationReadiness.ts')
const thermal = read('src/components/print/ThermalReceiptCompositions.tsx')
const a4 = read('src/components/print/A4Document.tsx')
const totals = read('src/lib/invoices/visibleTotals.ts')
const registry = read('src/lib/invoices/a4TemplateRegistry.ts')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const receipt = read('src/pages/print/ReceiptPrintPage.tsx')
const readContract = read('src/lib/invoices/invoiceReadContract.ts')

// New protected documents capture customer identity in the existing immutable
// envelope. Credit notes inherit the original buyer snapshot rather than query
// the current customer master.
assert.match(migration, /'version', 3/)
assert.match(migration, /'buyer', buyer_snapshot/)
assert.match(migration, /original_document\.identity_snapshot->'buyer'/)
assert.match(migration, /'state', 'legacy_unavailable'/)
assert.match(migration, /STANDARD_BUYER_SNAPSHOT_REQUIRED/)
for (const field of ['legalName', 'vatNumber', 'buildingNumber', 'address', 'district', 'city', 'postalCode', 'country']) {
  if (field === 'legalName') assert.match(migration, /buyer_name IS NULL/)
  else assert.match(migration, new RegExp(`buyer_customer\.${field === 'address' ? 'address' : field === 'vatNumber' ? 'vat_number' : field.replace(/[A-Z]/g, value => `_${value.toLowerCase()}`)}`))
}

assert.match(types, /interface InvoiceIdentitySnapshotV3/)
assert.match(types, /InvoiceBuyerIdentitySnapshotV1/)
assert.match(model, /snapshotState: 'captured' \| 'walk_in' \| 'legacy_unavailable' \| 'sample'/)
assert.match(adapters, /function documentFromStoredInvoiceV3/)
assert.match(adapters, /buyerFromSnapshot\(snapshot\.buyer\)/)
assert.match(adapters, /invoiceType: snapshot\.document\.fiscalDocumentKind/)
assert.doesNotMatch(adapters, /const \{ invoice, items, payments, customer \} = input/)
assert.match(readContract, /'identity_snapshot'/)

// B2B readiness is one shared contract and cannot be changed by selecting a
// visual template. Both document routes gate fiscal rendering through it.
assert.match(readiness, /model\.identity\.invoiceType !== 'standard'/)
assert.match(readiness, /model\.buyer\.snapshotState !== 'captured'/)
assert.match(detail, /canRenderFiscalDocument\(documentViewModel\)/)
assert.match(receipt, /canRenderFiscalDocument\(documentViewModel\)/)
assert.match(detail, /inv\.zatca_invoice_type !== 'credit_note'/)
assert.doesNotMatch(receipt, /from\('customers'\)/)

// The walk-in rule is shared: no A4 or thermal buyer shell is rendered.
assert.match(a4, /if \(buyer\.isWalkIn \|\| !buyer\.name\) return null/)
assert.match(thermal, /if \(buyer\.isWalkIn\) return null/)

// All layouts render the normalized model, including all four thermal and all
// six A4 variants. Financial fields remain model/persisted-value driven.
for (const density of ['classic', 'compact', 'standard', 'detailed']) assert.match(thermal, new RegExp(`${density}:`))
for (const template of ['classic', 'modern_split', 'minimal_professional', 'executive_green', 'clean_ledger', 'contemporary_border']) assert.match(registry, new RegExp(`${template}:`))
for (const field of ['item.quantity', 'item.unitPrice', 'item.discount', 'item.taxableAmount', 'item.vatRate', 'item.vatAmount', 'item.lineTotal']) assert.ok(a4.includes(field), `A4 must use persisted ${field}`)
assert.match(totals, /totals\.subtotal/)
assert.match(totals, /if \(totals\.discount > 0\.005\)/)
assert.match(totals, /totals\.taxableAmount/)
assert.match(totals, /totals\.vat/)
assert.match(totals, /totals\.total/)
assert.match(totals, /totals\.paid/)
assert.match(totals, /totals\.balance/)

console.log('Issued document buyer snapshot, readiness, walk-in, template parity, and persisted-value contract assertions passed.')
