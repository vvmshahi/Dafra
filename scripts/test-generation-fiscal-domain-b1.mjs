import assert from 'node:assert/strict'
import {
  canCreateAdjustmentNote,
  isFiscalDocumentFinal,
  isFiscalDocumentPrintable,
  isGenerationIssued,
  isIntegrationAccepted,
  resolveLegacyFiscalPolicy,
} from '../src/lib/fiscal/domain.ts'

const generation = {
  fiscalRegime: 'generation', lifecycleState: 'generation_issued',
  artifactStage: 'generation_final', qrCode: 'qr', canPrint: true, canShare: true,
}
const reported = {
  fiscalRegime: 'integration', lifecycleState: 'reported',
  artifactStage: 'integration_final', qrCode: 'qr', canPrint: true, canShare: true,
}
const cleared = { ...reported, lifecycleState: 'cleared' }

assert.equal(isGenerationIssued(generation), true)
assert.equal(isFiscalDocumentFinal(generation), true)
assert.equal(isFiscalDocumentPrintable(generation), true)
assert.equal(isIntegrationAccepted(generation), false)
assert.equal(isIntegrationAccepted(reported), true)
assert.equal(isIntegrationAccepted(cleared), true)
assert.equal(isFiscalDocumentFinal(reported), true)
assert.equal(isFiscalDocumentPrintable({ ...generation, canPrint: false }), false)
assert.deepEqual(canCreateAdjustmentNote(generation, { regime: 'generation' }), { allowed: true })
assert.deepEqual(canCreateAdjustmentNote(generation, { regime: 'integration' }), {
  allowed: false, code: 'CROSS_REGIME_NOTE_NOT_ALLOWED',
})
assert.deepEqual(canCreateAdjustmentNote(reported, { regime: 'integration' }), { allowed: true })
assert.deepEqual(canCreateAdjustmentNote(reported, { regime: 'generation' }), {
  allowed: false, code: 'FISCAL_POLICY_INVALID',
})

const production = resolveLegacyFiscalPolicy({
  branchId: 'branch-prod', tenantId: 'tenant-1', zatcaPhase: 1,
  zatcaEnvironment: 'production', policyRevision: 4,
})
const sandbox = resolveLegacyFiscalPolicy({
  branchId: 'branch-sandbox', tenantId: 'tenant-1', zatcaPhase: 2,
  zatcaEnvironment: 'sandbox',
})
assert.equal(production.regime, 'integration')
assert.equal(production.integrationEnvironment, 'production')
assert.equal(production.policyRevision, 4)
assert.equal(sandbox.regime, 'integration')
assert.equal(sandbox.integrationEnvironment, 'sandbox')
assert.equal(sandbox.policyRevision, 1)

console.log('Generation fiscal domain B1 tests passed (18 assertions)')
