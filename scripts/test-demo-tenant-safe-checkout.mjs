import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260729000300_demo_tenant_non_fiscal_checkout.sql')
const readGrantMigration = read('supabase/migrations/20260729000400_grant_demo_invoice_read.sql')
const pos = read('src/pages/pos/POSPage.tsx')
const submission = read('src/lib/zatca/submission.ts')
const detail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const list = read('src/pages/invoices/InvoicesPage.tsx')
const en = JSON.parse(read('src/localization/locales/en/pos.json'))
const ar = JSON.parse(read('src/localization/locales/ar-SA/pos.json'))

// Server authority and tenant/branch isolation.
assert.match(migration, /COALESCE\(t\.is_demo, false\)/)
assert.match(migration, /v_profile\.tenant_id IS DISTINCT FROM v_branch\.tenant_id/)
assert.match(migration, /v_profile\.role = 'branch'.*v_profile\.branch_id IS DISTINCT FROM v_branch\.id/s)
assert.match(migration, /p_payload - 'is_demo' - 'non_fiscal'/)
assert.match(migration, /DEMO_MARKER_SERVER_ONLY/)
assert.match(migration, /DEMO_CHECKOUT_REQUIRES_SANDBOX_BRANCH/)

// Real branches retain the existing production capability/readiness contract.
assert.match(migration, /INVOICE_CAPABILITY_NOT_CONFIGURED/)
assert.match(migration, /functionality_map NOT IN \('0100', '1000', '1100'\)/)
assert.match(migration, /get_zatca_atomic_checkout_eligibility_v2/)
assert.match(migration, /standard_uses_legacy_clearance/)

// Demo records cannot acquire fiscal artifacts or enter fiscal queues.
assert.match(migration, /ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false/)
assert.match(
  readGrantMigration,
  /GRANT SELECT \(is_demo\) ON TABLE public\.invoices TO authenticated/,
)
assert.match(migration, /DEMO_FISCAL_OUTPUT_FORBIDDEN/)
assert.match(migration, /zatca_reporting_outbox_guard_demo_v1/)
assert.match(migration, /zatca_chain_reservations_guard_demo_v1/)
assert.match(migration, /zatca_qr_code = NULL/)
assert.match(migration, /zatca_status = 'not_submitted'/)

// Web and Capacitor share this POS. It consumes the server decision and the
// demo branch performs no submission/finalization call.
assert.match(submission, /PosCheckoutPath = 'atomic' \| 'legacy' \| 'demo'/)
assert.match(pos, /await resolvePosCheckoutDocument\(branch\.id, customerId\)/)
assert.match(pos, /documentDecision\.checkoutPath === 'demo'/)
const demoBlock = pos.match(/else if \(demoSandbox\) \{[\s\S]*?\n        \} else if \(productionCheckoutMode/)
assert.ok(demoBlock)
assert.doesNotMatch(demoBlock[0], /submitInvoiceForBranch|validateInvoiceInSandbox|finalizeInvoiceForZatca/)
assert.match(pos, /finalQrCode = null/)
assert.match(pos, /canPrintCustomerCopy = true/)

// Existing cart/customer/barcode and all payment choices remain in the flow.
assert.match(pos, /type PosPaymentChoice = 'cash' \| 'card' \| 'split'/)
assert.match(pos, /useBarcodeScanner/)
assert.match(pos, /customer_id: customerId/)
assert.match(pos, /items: cart\.map/)
assert.match(pos, /session_id: session\?\.id/)

// Persistent bilingual labelling covers success, print, detail, and history.
assert.equal(en.demo.receiptLabelBilingual, 'DEMO — NOT A TAX INVOICE / تجريبي — ليست فاتورة ضريبية')
assert.equal(ar.demo.receiptLabelBilingual, en.demo.receiptLabelBilingual)
assert.match(pos, /sampleLabel: receipt\.isDemo/)
assert.match(detail, /sampleLabel: nonFiscalDemo/)
assert.match(list, /DEMO · NOT A TAX INVOICE/)

console.log('demo tenant safe checkout contract tests passed')
