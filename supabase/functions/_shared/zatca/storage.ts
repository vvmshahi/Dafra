import type { FunctionalityMap, OnboardingStatus } from './config.ts'
import type { ComplianceSampleResult } from './samples.ts'

interface OnboardingUpdate {
  tenantId: string
  branchId: string
  userId: string
  status: OnboardingStatus
  functionalityMap: FunctionalityMap
  egsSerialNumber: string
  csrCommonName?: string
  csrOrganizationName?: string
  csrOrganizationalUnitName?: string
  csrLocation?: string
  csrIndustry?: string
  csrPem?: string
  publicKeyPem?: string
  encryptedPrivateKey?: string
  complianceRequestId?: string
  encryptedComplianceCsid?: string
  encryptedComplianceSecret?: string
  encryptedProductionCsid?: string
  encryptedProductionSecret?: string
  complianceSampleResults?: ComplianceSampleResult[]
  lastError?: string | null
  connectedAt?: string | null
  disconnectedAt?: string | null
}

export async function saveOnboardingState(db: any, update: OnboardingUpdate): Promise<void> {
  const row: Record<string, unknown> = {
    tenant_id: update.tenantId,
    branch_id: update.branchId,
    environment: 'production',
    egs_serial_number: update.egsSerialNumber,
    onboarding_status: update.status,
    functionality_map: update.functionalityMap,
    updated_by: update.userId,
    last_error: update.lastError ?? null,
  }

  if (update.csrCommonName !== undefined) row.csr_common_name = update.csrCommonName
  if (update.csrOrganizationName !== undefined) row.csr_organization_name = update.csrOrganizationName
  if (update.csrOrganizationalUnitName !== undefined) row.csr_organizational_unit_name = update.csrOrganizationalUnitName
  if (update.csrLocation !== undefined) row.csr_location = update.csrLocation
  if (update.csrIndustry !== undefined) row.csr_industry = update.csrIndustry
  if (update.csrPem !== undefined) row.csr_pem = update.csrPem
  if (update.publicKeyPem !== undefined) row.public_key_pem = update.publicKeyPem
  if (update.encryptedPrivateKey !== undefined) row.encrypted_private_key = update.encryptedPrivateKey
  if (update.complianceRequestId !== undefined) row.compliance_request_id = update.complianceRequestId
  if (update.encryptedComplianceCsid !== undefined) row.encrypted_compliance_csid = update.encryptedComplianceCsid
  if (update.encryptedComplianceSecret !== undefined) row.encrypted_compliance_secret = update.encryptedComplianceSecret
  if (update.encryptedProductionCsid !== undefined) row.encrypted_production_csid = update.encryptedProductionCsid
  if (update.encryptedProductionSecret !== undefined) row.encrypted_production_secret = update.encryptedProductionSecret
  if (update.complianceSampleResults !== undefined) row.compliance_sample_results = update.complianceSampleResults
  if (update.connectedAt !== undefined) row.connected_at = update.connectedAt
  if (update.disconnectedAt !== undefined) row.disconnected_at = update.disconnectedAt

  const { error } = await db
    .from('zatca_production_credentials')
    .upsert({
      created_by: update.userId,
      ...row,
    }, { onConflict: 'branch_id,environment' })

  if (error) throw new Error('Unable to save ZATCA production onboarding state')
}

export async function loadSafeOnboardingStatus(db: any, branchId: string, tenantId: string): Promise<Record<string, unknown>> {
  const { data, error, status, statusText } = await db
    .from('zatca_production_credentials')
    .select(`
      branch_id,
      environment,
      onboarding_status,
      functionality_map,
      compliance_sample_results,
      certificate_valid_from,
      certificate_valid_to,
      connected_at,
      disconnected_at,
      encrypted_production_csid,
      encrypted_production_secret,
      updated_at
    `)
    .eq('branch_id', branchId)
    .eq('tenant_id', tenantId)
    .eq('environment', 'production')
    .maybeSingle()

  if (error) {
    console.error('[zatca-storage] loadSafeOnboardingStatus failed', {
      message: error.message,
      code: error.code,
      status,
      statusText,
      branchId,
      tenantId,
    })
    throw new Error('Unable to load ZATCA production onboarding status')
  }
  if (!data) {
    return {
      branchId,
      environment: 'production',
      onboardingStatus: 'not_started',
      steps: [],
    }
  }

  return {
    branchId: data.branch_id,
    environment: data.environment,
    onboardingStatus: data.onboarding_status,
    functionalityMap: data.functionality_map,
    complianceSampleResults: data.compliance_sample_results ?? [],
    certificateValidFrom: data.certificate_valid_from,
    certificateValidTo: data.certificate_valid_to,
    connectedAt: data.connected_at,
    disconnectedAt: data.disconnected_at,
    productionCsidExists: !!data.encrypted_production_csid,
    productionSecretExists: !!data.encrypted_production_secret,
    updatedAt: data.updated_at,
  }
}
