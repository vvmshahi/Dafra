import fs from 'node:fs'

const panel = fs.readFileSync('src/components/customers/CustomerReceivablesPanel.tsx', 'utf8')
const print = fs.readFileSync('src/pages/print/CustomerStatementPrintPage.tsx', 'utf8')
const contract = fs.readFileSync('src/lib/customers/receivables.ts', 'utf8')
const sql = fs.readFileSync('supabase/migrations/20260803000300_customer_receivables_rpcs_v1.sql', 'utf8')

for (const preset of ['this_month', 'last_month', 'last3', 'this_year', 'custom', 'all']) {
  if (!panel.includes(`'${preset}'`)) throw new Error(`missing statement period: ${preset}`)
}
if (!panel.includes('loadCustomerStatementWorkspace') || !print.includes('loadCustomerStatementWorkspace')) throw new Error('Preview and outputs do not share the statement request path')
if (!contract.includes('page_size: 100') || !contract.includes('buildCustomerStatementRequest')) throw new Error('statement request is not capped to the RPC contract')
if (panel.includes('pageSize: 200') || print.includes('pageSize: 200')) throw new Error('invalid page size remains in statement flow')
if (!sql.includes('v_page_size NOT BETWEEN 1 AND 100')) throw new Error('RPC page-size contract was not verified')
if (!panel.includes("import.meta.env.DEV")) throw new Error('statement diagnostics are not development-only')
console.log('Customer Statement filter repair contract: PASS')
