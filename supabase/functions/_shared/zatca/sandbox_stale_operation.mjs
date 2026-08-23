/**
 * Decide how a stale Sandbox onboarding lock can be handled without creating
 * another credential or changing the branch identity.
 *
 * A required reconciliation means the function did not receive a conclusive
 * result.  In that case the lack of local material alone is not proof that
 * the Developer Portal did not process the request, so retrying would be
 * unsafe.  A normal stale lock with no material, on the other hand, can be
 * moved to the existing retryable failure state.
 */
export function classifyStaleSandboxOperation({
  operation,
  reconciliationStatus,
  hasComplianceRequestId,
  hasComplianceCsid,
  hasComplianceSecret,
  complianceBindingVerified = false,
}) {
  if (operation !== 'request_compliance_csid') {
    return reconciliationStatus === 'required' ? 'blocked' : 'failed'
  }

  const material = [hasComplianceRequestId, hasComplianceCsid, hasComplianceSecret]
  const materialCount = material.filter(Boolean).length
  if (materialCount === material.length) {
    return complianceBindingVerified ? 'passed' : 'blocked'
  }
  if (materialCount > 0) return 'blocked'
  return reconciliationStatus === 'required' ? 'blocked' : 'failed'
}
