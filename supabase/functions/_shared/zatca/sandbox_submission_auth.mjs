export const TENANT_SUBMIT_ROLES = new Set(['owner', 'admin'])

export const SANDBOX_1100_SAMPLE_TYPES = Object.freeze([
  'simplified_invoice',
  'simplified_credit_note',
  'simplified_debit_note',
  'standard_invoice',
  'standard_credit_note',
  'standard_debit_note',
])

const SANDBOX_1100_DOCUMENT_TYPES = new Set([
  'simplified',
  'standard',
  'credit_note',
  'debit_note',
])

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function samplesAreComplete(value) {
  if (!Array.isArray(value)) return false
  const accepted = new Set(
    value
      .filter(sample => sample?.status === 'accepted')
      .map(sample => sample?.type),
  )
  return SANDBOX_1100_SAMPLE_TYPES.every(type => accepted.has(type))
    && accepted.size === SANDBOX_1100_SAMPLE_TYPES.length
}

export function callerCanSubmitForTarget(caller, target) {
  if (!caller?.is_active || !caller.tenant_id || !target?.tenantId || !target?.branchId) return false
  if (TENANT_SUBMIT_ROLES.has(caller.role)) return target.tenantId === caller.tenant_id
  return caller.role === 'branch'
    && target.tenantId === caller.tenant_id
    && !!caller.branch_id
    && target.branchId === caller.branch_id
}

export function sandboxScopeAllowsSubmission({ tenant, branch, target }) {
  return tenant?.id === target?.tenantId
    && tenant?.is_demo === true
    && tenant?.is_active === true
    && !tenant?.suspended_at
    && branch?.id === target?.branchId
    && branch?.tenant_id === target?.tenantId
    && branch?.zatca_environment === 'sandbox'
    && branch?.is_active === true
}

export function sandboxCredentialIsConnected(credential, now = Date.now()) {
  const expired = !!credential?.expires_at && new Date(credential.expires_at).getTime() <= now
  return credential?.environment === 'sandbox'
    && credential?.status === 'active'
    && credential?.onboarding_status === 'active'
    && credential?.functionality_map === '1100'
    && !expired
    && nonEmpty(credential?.encrypted_private_key)
    && nonEmpty(credential?.compliance_request_id)
    && nonEmpty(credential?.encrypted_compliance_csid)
    && nonEmpty(credential?.encrypted_compliance_secret)
    && nonEmpty(credential?.encrypted_production_csid)
    && nonEmpty(credential?.encrypted_production_secret)
    && nonEmpty(credential?.certificate)
    && credential?.reconciliation_status !== 'required'
    && !credential?.onboarding_operation
    && samplesAreComplete(credential?.compliance_sample_results)
}

export function sandboxCredentialMatchesTarget(credential, target) {
  return credential?.tenant_id === target?.tenantId
    && credential?.branch_id === target?.branchId
    && credential?.environment === 'sandbox'
}

export function sandboxCredentialAllowsDocument(credential, documentType, target, now = Date.now()) {
  return sandboxCredentialMatchesTarget(credential, target)
    && sandboxCredentialIsConnected(credential, now)
    && SANDBOX_1100_DOCUMENT_TYPES.has(documentType)
}
