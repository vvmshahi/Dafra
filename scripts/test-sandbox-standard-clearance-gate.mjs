import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const gate = read('supabase/migrations/20260824000100_sandbox_standard_clearance_gate.sql')
const sandboxAuth = read('supabase/functions/_shared/zatca/sandbox_submission_auth.mjs')
const sandboxSubmitter = read('supabase/functions/zatca-submit-sandbox-demo/index.ts')
const pos = read('src/pages/pos/POSPage.tsx')
const invoiceDetail = read('src/pages/invoices/InvoiceDetailPage.tsx')
const creditNoteModal = read('src/pages/invoices/CreateCreditNoteModal.tsx')

const functionBody = gate.match(/CREATE OR REPLACE FUNCTION public\.resolve_pos_checkout_document_internal_v1[\s\S]*?\$function\$;/)?.[0] ?? ''
assert.ok(functionBody, 'function-only Sandbox clearance correction is present')

// A: Sandbox 1100 is the authoritative fiscal profile for both document paths.
assert.match(functionBody, /c\.functionality_map = '1100'/)
assert.match(functionBody, /'checkoutPath', 'sandbox'/)
assert.match(functionBody, /'capability', '1100'/)
assert.doesNotMatch(functionBody, /SANDBOX_STANDARD_CLEARANCE_UNAVAILABLE/)
assert.doesNotMatch(functionBody, /c\.compliance_demo_status/)

// B/C: document classification is preserved; the stale Standard-only rejection
// cannot be emitted by the active resolver or mapped by the current POS UI.
assert.match(functionBody, /resolve_pos_checkout_document_internal_base_20260803/)
assert.match(functionBody, /validate_standard_buyer_identity_internal_v1/)
assert.doesNotMatch(pos, /SANDBOX_STANDARD_CLEARANCE_UNAVAILABLE/)

// D/E: the POS uses the Sandbox submitter and its Standard path is Clearance.
const sandboxCheckout = pos.match(/else if \(sandboxDemo\) \{[\s\S]*?\n        \} else if \(productionCheckoutMode/)
assert.ok(sandboxCheckout)
assert.match(sandboxCheckout[0], /submitInvoiceForBranch/)
assert.match(sandboxSubmitter, /profileId:'reporting:1\.0'/)
assert.doesNotMatch(sandboxSubmitter, /profileId:isSimplified\?'reporting:1\.0':'clearance:1\.0'/)
assert.match(sandboxSubmitter, /isSimplified \? '\/invoices\/reporting\/single' : '\/invoices\/clearance\/single'/)
assert.match(invoiceDetail, /await submitInvoiceForBranch\(\{[\s\S]*?documentKind: isStandardDocument \? 'standard' : 'simplified'/)
assert.match(creditNoteModal, /autoSubmitSucceeded = routed\.result\.ok/)

// F: buyer preflight runs before route selection and returns its field failures.
assert.match(functionBody, /v_decision->>'documentType' = 'standard'[\s\S]*?validate_standard_buyer_identity_internal_v1/s)
assert.match(functionBody, /'missingFields', COALESCE\(v_buyer_preflight->'missingFields'/)

// G/H: incomplete state and 0100 cannot reach the fiscal Sandbox route.
for (const fragment of [
  "t.is_active IS TRUE", "b.is_active IS TRUE", "b.zatca_environment = 'sandbox'",
  "c.status = 'active'", "c.onboarding_status = 'active'", "c.functionality_map = '1100'",
  "c.reconciliation_status IS DISTINCT FROM 'required'", 'c.onboarding_operation IS NULL',
  "'standard_invoice'", "NULLIF(c.encrypted_production_csid, '') IS NOT NULL",
]) assert.ok(functionBody.includes(fragment), `operational Sandbox guard includes ${fragment}`)
assert.match(sandboxAuth, /credential\?\.functionality_map === '1100'/)
assert.match(sandboxAuth, /SANDBOX_1100_DOCUMENT_TYPES/)

// I: the correction is limited to the checkout resolver and never names the
// Production submitter or its credentials table.
assert.doesNotMatch(functionBody, /zatca-submit(?!-sandbox-demo)/)
assert.doesNotMatch(functionBody, /zatca_production_credentials/)

console.log('Sandbox Standard clearance gate contract tests passed')
