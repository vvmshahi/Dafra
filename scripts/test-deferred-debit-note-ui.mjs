import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const list = await read('src/pages/invoices/InvoicesPage.tsx')
const detail = await read('src/pages/invoices/InvoiceDetailPage.tsx')
const backend = await read('supabase/migrations/20260824001400_generation_debit_notes_accounting.sql')

assert.doesNotMatch(list, /CreateGenerationDebitNoteModal|setDebitModalRow|createDebitNote/)
assert.doesNotMatch(detail, /CreateGenerationDebitNoteModal|debitModalOpen|openDebitModal|createDebitNote/)
assert.match(list, /CreateCreditNoteModal/)
assert.match(detail, /CreateCreditNoteModal/)
assert.match(backend, /create_generation_note_v1/)

console.log('Deferred Debit Note UI hidden; Credit Note UI and Debit Note backend support retained.')
