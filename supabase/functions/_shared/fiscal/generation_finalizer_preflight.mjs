export const GENERATION_PREFLIGHT_CODES = Object.freeze({
  POLICY_LOOKUP_FAILED: 'GENERATION_POLICY_LOOKUP_FAILED',
  POLICY_NOT_FOUND: 'GENERATION_POLICY_NOT_FOUND',
  INVOICE_LOOKUP_FAILED: 'GENERATION_INVOICE_LOOKUP_FAILED',
  INVOICE_NOT_FOUND: 'GENERATION_INVOICE_NOT_FOUND',
  SNAPSHOT_LOOKUP_FAILED: 'GENERATION_SNAPSHOT_LOOKUP_FAILED',
  SNAPSHOT_NOT_FOUND: 'GENERATION_SNAPSHOT_NOT_FOUND',
  BRANCH_LOOKUP_FAILED: 'GENERATION_BRANCH_LOOKUP_FAILED',
  BRANCH_NOT_FOUND: 'GENERATION_BRANCH_NOT_FOUND',
  INVOICE_BRANCH_MISMATCH: 'GENERATION_INVOICE_BRANCH_MISMATCH',
  REGIME_INVALID: 'GENERATION_POLICY_INVALID',
})

export function classifyGenerationFinalizerPreflight({
  policy,
  policyError,
  invoice,
  invoiceError,
  snapshot,
  snapshotError,
  branch,
  branchError,
  branchId,
}) {
  if (policyError) return {
    stage: 'policy_lookup',
    code: GENERATION_PREFLIGHT_CODES.POLICY_LOOKUP_FAILED,
    error: policyError,
  }
  if (!policy) return {
    stage: 'policy_lookup',
    code: GENERATION_PREFLIGHT_CODES.POLICY_NOT_FOUND,
  }
  if (invoiceError) return {
    stage: 'invoice_lookup',
    code: GENERATION_PREFLIGHT_CODES.INVOICE_LOOKUP_FAILED,
    error: invoiceError,
  }
  if (!invoice) return {
    stage: 'invoice_lookup',
    code: GENERATION_PREFLIGHT_CODES.INVOICE_NOT_FOUND,
  }
  if (snapshotError) return {
    stage: 'snapshot_lookup',
    code: GENERATION_PREFLIGHT_CODES.SNAPSHOT_LOOKUP_FAILED,
    error: snapshotError,
  }
  if (!snapshot) return {
    stage: 'snapshot_lookup',
    code: GENERATION_PREFLIGHT_CODES.SNAPSHOT_NOT_FOUND,
  }
  if (branchError) return {
    stage: 'branch_lookup',
    code: GENERATION_PREFLIGHT_CODES.BRANCH_LOOKUP_FAILED,
    error: branchError,
  }
  if (!branch) return {
    stage: 'branch_lookup',
    code: GENERATION_PREFLIGHT_CODES.BRANCH_NOT_FOUND,
  }
  if (invoice.branch_id !== branchId) return {
    stage: 'invoice_branch_scope',
    code: GENERATION_PREFLIGHT_CODES.INVOICE_BRANCH_MISMATCH,
  }
  if (policy.regime !== 'generation') return {
    stage: 'policy_regime',
    code: GENERATION_PREFLIGHT_CODES.REGIME_INVALID,
  }
  return null
}
