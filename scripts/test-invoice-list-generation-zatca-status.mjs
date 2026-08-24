import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const page = await read('src/pages/invoices/InvoicesPage.tsx')
const detail = await read('src/pages/invoices/InvoiceDetailPage.tsx')

assert.doesNotMatch(page, /ZATCA \/ fiscal/)
assert.equal((page.match(/ZATCA Status/g) ?? []).length, 2, 'desktop and mobile list headings use ZATCA Status')
assert.doesNotMatch(page, /fiscalStatus/)
assert.doesNotMatch(page, /generationIssued|generationFinalizationRequired/)
assert.match(page, /const zatca = generationInvoice[\s\S]*t\('invoices:notRequired'\)/)
assert.match(page, /const zatcaFilterStatus = isGenerationInvoice\(r, ownerBranches\)\s*\? 'not_required'/)
assert.match(page, /!isGenerationInvoice\(r, ownerBranches\).*r\.status !== 'cancelled'/)
assert.match(page, /zatcaKey = r\.displayZatcaStatus === 'sandbox_validated'/)
assert.match(page, /r\.displayZatcaStatus === 'reported' \? 'reported'/)
assert.match(page, /r\.displayZatcaStatus === 'cleared' \? 'cleared'/)
assert.match(page, /fiscalLifecycleState: inv\.fiscal_lifecycle_state/)
assert.match(detail, /generationIssued/)

console.log('Invoice-list Generation ZATCA status checks passed')
