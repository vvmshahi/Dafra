import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = await read('supabase/migrations/20260824001000_generation_snapshot_rpc_service_access.sql')
const edge = await read('supabase/functions/fiscal-finalize-generation/index.ts')
const invoiceList = await read('src/pages/invoices/InvoicesPage.tsx')
const pos = await read('src/pages/pos/POSPage.tsx')
const detail = await read('src/pages/invoices/InvoiceDetailPage.tsx')

assert.match(migration, /REVOKE ALL ON FUNCTION public\.build_zatca_atomic_receipt_snapshot_v2\(uuid\)\s+FROM PUBLIC, anon, authenticated/)
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.build_zatca_atomic_receipt_snapshot_v2\(uuid\)\s+TO service_role/)
assert.match(edge, /rpc\('build_zatca_atomic_receipt_snapshot_v2'/)
assert.match(invoiceList, /function isGenerationInvoice\(/)
assert.match(invoiceList, /!isGenerationInvoice\(r, ownerBranches\)/)
assert.match(invoiceList, /t\('invoices:notRequired'\)/)
assert.match(pos, /receipt\.canPrint\s*\?/)
assert.match(pos, /const paymentReceiptReady = Boolean\(receipt\.invoiceId\)/)
assert.match(detail, /finalizeGenerationInvoice\(/)
assert.match(detail, /const generationRetryAvailable = Boolean\(/)
assert.match(detail, /const displayZatcaStatus = generationDocument \? 'not_submitted'/)

console.log('Generation snapshot lookup and status UX regression checks passed')
