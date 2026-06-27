/**
 * ZATCA production onboarding orchestrator.
 *
 * Production flow:
 *  - frontend sends OTP + branchId + functionalityMap only
 *  - backend generates CSR/private key
 *  - backend calls production /core/compliance
 *  - backend stores credentials encrypted with ZATCA_SERVER_ENCRYPTION_KEY
 *  - backend submits required compliance samples before requesting production credentials
 *
 * Real ZATCA calls require:
 *  - request body dryRun: false
 *  - ALLOW_ZATCA_PRODUCTION_ONBOARDING=true
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  corsHeaders,
  isFunctionalityMap,
  isUuid,
  jsonResponse,
  productionCallsAllowed,
  PRODUCTION_CORE_BASE_URL,
  requireEnv,
  safeErrorMessage,
  validateOtp,
  type FunctionalityMap,
  type OnboardingStatus,
} from '../_shared/zatca/config.ts'
import { requireTenantOwner, loadOwnedBranch, loadTenant } from '../_shared/zatca/auth.ts'
import { generateProductionCsr, validateCsrInputs, type CsrParams } from '../_shared/zatca/csr.ts'
import { encryptText } from '../_shared/zatca/crypto.ts'
import { requestComplianceCsid, requestProductionCsid } from '../_shared/zatca/client.ts'
import {
  simulatedComplianceResults,
  submitComplianceSamples,
  type ComplianceSampleResult,
  type SampleSeller,
} from '../_shared/zatca/samples.ts'
import { loadSafeOnboardingStatus, saveOnboardingState } from '../_shared/zatca/storage.ts'

interface RequestBody {
  action?: 'onboard' | 'status'
  branchId?: unknown
  otp?: unknown
  functionalityMap?: unknown
  dryRun?: unknown
}

const STEP_ORDER: OnboardingStatus[] = [
  'generating_csr',
  'compliance_csid_requested',
  'compliance_samples_passed',
  'production_csid_requested',
  'production_connected',
]

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const db = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    )
    const body = await readBody(req)
    const owner = await requireTenantOwner(db, req)
    const branchId = body.branchId

    if (!isUuid(branchId)) {
      return jsonResponse({ error: 'Invalid branch' }, 400)
    }

    const branch = await loadOwnedBranch(db, branchId, owner.tenantId)

    if (body.action === 'status') {
      const status = await loadSafeOnboardingStatus(db, branch.id, owner.tenantId)
      return jsonResponse({ ok: true, ...status })
    }

    if (!validateOtp(body.otp)) {
      return jsonResponse({ error: 'Enter the 6-digit OTP from the FATOORA portal.' }, 400)
    }

    if (!isFunctionalityMap(body.functionalityMap)) {
      return jsonResponse({ error: 'Select a ZATCA invoice capability before production onboarding.' }, 400)
    }

    if ((branch.zatca_phase ?? 1) < 2) {
      return jsonResponse({ error: 'This branch must be upgraded to ZATCA Phase 2 first.' }, 400)
    }

    const dryRun = body.dryRun !== false
    const tenant = await loadTenant(db, owner.tenantId)
    const csrParams = buildCsrParams(branch, tenant, body.functionalityMap)
    const missing = validateCsrInputs(csrParams)
    if (missing.length > 0) {
      return jsonResponse({
        error: `Complete the branch/taxpayer ZATCA data first: ${missing.join(', ')}.`,
      }, 400)
    }

    const generated = await generateProductionCsr(csrParams)

    if (dryRun) {
      const complianceSampleResults = simulatedComplianceResults(body.functionalityMap)
      return jsonResponse({
        ok: true,
        dryRun: true,
        branchId: branch.id,
        environment: 'production',
        onboardingStatus: 'production_connected',
        steps: STEP_ORDER,
        functionalityMap: body.functionalityMap,
        complianceSampleResults,
        message: 'Dry run completed. No ZATCA production APIs were called and no secrets were stored.',
      })
    }

    if (!productionCallsAllowed()) {
      return jsonResponse({
        error: 'Production onboarding is disabled. Set ALLOW_ZATCA_PRODUCTION_ONBOARDING=true in Supabase Edge Function secrets before using a live OTP.',
      }, 403)
    }

    const encryptionSecret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
    const encryptedPrivateKey = await encryptText(generated.privateKeyPem, encryptionSecret)

    await saveState(db, owner, csrParams, generated, {
      status: 'generating_csr',
      encryptedPrivateKey,
    })

    const compliance = await requestComplianceCsid({
      baseUrl: PRODUCTION_CORE_BASE_URL,
      csrPem: generated.csrPem,
      otp: body.otp,
    })

    const encryptedComplianceCsid = await encryptText(compliance.binarySecurityToken, encryptionSecret)
    const encryptedComplianceSecret = await encryptText(compliance.secret, encryptionSecret)

    await saveState(db, owner, csrParams, generated, {
      status: 'compliance_csid_requested',
      encryptedPrivateKey,
      complianceRequestId: compliance.requestID,
      encryptedComplianceCsid,
      encryptedComplianceSecret,
    })

    let complianceSampleResults: ComplianceSampleResult[]
    try {
      complianceSampleResults = await submitComplianceSamples({
        baseUrl: PRODUCTION_CORE_BASE_URL,
        functionalityMap: body.functionalityMap,
        complianceCsid: compliance.binarySecurityToken,
        complianceSecret: compliance.secret,
        complianceCertificate: compliance.binarySecurityToken,
        privateKeyPem: generated.privateKeyPem,
        seller: buildSampleSeller(branch, tenant, csrParams),
      })
    } catch (err) {
      const message = safeErrorMessage(err)
      await saveState(db, owner, csrParams, generated, {
        status: 'compliance_failed',
        encryptedPrivateKey,
        complianceRequestId: compliance.requestID,
        encryptedComplianceCsid,
        encryptedComplianceSecret,
        complianceSampleResults: [],
        lastError: message,
      })
      return jsonResponse({ error: message }, 501)
    }

    const samplesPassed = complianceSampleResults.every(result => result.status === 'accepted')
    if (!samplesPassed) {
      await saveState(db, owner, csrParams, generated, {
        status: 'compliance_failed',
        encryptedPrivateKey,
        complianceRequestId: compliance.requestID,
        encryptedComplianceCsid,
        encryptedComplianceSecret,
        complianceSampleResults,
        lastError: 'Compliance sample invoices were not accepted.',
      })
      return jsonResponse({ error: 'Compliance sample invoices were not accepted.' }, 422)
    }

    await saveState(db, owner, csrParams, generated, {
      status: 'compliance_samples_passed',
      encryptedPrivateKey,
      complianceRequestId: compliance.requestID,
      encryptedComplianceCsid,
      encryptedComplianceSecret,
      complianceSampleResults,
    })

    await saveState(db, owner, csrParams, generated, {
      status: 'production_csid_requested',
      encryptedPrivateKey,
      complianceRequestId: compliance.requestID,
      encryptedComplianceCsid,
      encryptedComplianceSecret,
      complianceSampleResults,
    })

    const production = await requestProductionCsid({
      baseUrl: PRODUCTION_CORE_BASE_URL,
      complianceCsid: compliance.binarySecurityToken,
      complianceSecret: compliance.secret,
      complianceRequestId: compliance.requestID,
    })

    const encryptedProductionCsid = await encryptText(production.binarySecurityToken, encryptionSecret)
    const encryptedProductionSecret = await encryptText(production.secret, encryptionSecret)
    const connectedAt = new Date().toISOString()

    await saveState(db, owner, csrParams, generated, {
      status: 'production_connected',
      encryptedPrivateKey,
      complianceRequestId: compliance.requestID,
      encryptedComplianceCsid,
      encryptedComplianceSecret,
      encryptedProductionCsid,
      encryptedProductionSecret,
      complianceSampleResults,
      connectedAt,
    })

    return jsonResponse({
      ok: true,
      dryRun: false,
      branchId: branch.id,
      environment: 'production',
      onboardingStatus: 'production_connected',
      steps: STEP_ORDER,
      functionalityMap: body.functionalityMap,
      complianceSampleResults,
      connectedAt,
    })
  } catch (err) {
    const message = safeErrorMessage(err)
    console.error('[zatca-onboard-production] failed:', message)
    const status = message === 'Unauthorized' ? 401 : message.startsWith('Forbidden') ? 403 : 500
    return jsonResponse({ error: message }, status)
  }
})

async function readBody(req: Request): Promise<RequestBody> {
  try {
    return await req.json()
  } catch {
    throw new Error('Invalid JSON request body')
  }
}

function buildCsrParams(branch: any, tenant: any, functionalityMap: FunctionalityMap): CsrParams {
  const businessName = branch.business_name || tenant.name || branch.name
  const vatNumber = branch.vat_number || tenant.vat_number || ''
  const location = [
    branch.building_number || tenant.building_number,
    branch.street || tenant.street,
    branch.district || tenant.district,
    branch.city || tenant.city,
    branch.postal_code || tenant.postal_code,
  ].filter(Boolean).join(', ')

  return {
    branchId: branch.id,
    commonName: businessName,
    branchName: branch.name,
    businessName,
    vatNumber,
    functionalityMap,
    location,
    industry: 'Supply activities',
  }
}

function buildSampleSeller(branch: any, tenant: any, csrParams: CsrParams): SampleSeller {
  return {
    name: csrParams.businessName,
    vatNumber: csrParams.vatNumber,
    crNumber: branch.cr_number || tenant.cr_number || undefined,
    street: branch.street || tenant.street || 'King Fahd Road',
    buildingNumber: branch.building_number || tenant.building_number || '1234',
    district: branch.district || tenant.district || 'Al Olaya',
    city: branch.city || tenant.city || 'Riyadh',
    postalCode: branch.postal_code || tenant.postal_code || '12345',
    countryCode: branch.country || tenant.country || 'SA',
  }
}

async function saveState(
  db: any,
  owner: { userId: string; tenantId: string },
  csrParams: CsrParams,
  generated: {
    csrPem: string
    publicKeyPem: string
    egsSerialNumber: string
  },
  update: {
    status: OnboardingStatus
    encryptedPrivateKey?: string
    complianceRequestId?: string
    encryptedComplianceCsid?: string
    encryptedComplianceSecret?: string
    encryptedProductionCsid?: string
    encryptedProductionSecret?: string
    complianceSampleResults?: ComplianceSampleResult[]
    lastError?: string
    connectedAt?: string
  },
): Promise<void> {
  await saveOnboardingState(db, {
    tenantId: owner.tenantId,
    branchId: csrParams.branchId,
    userId: owner.userId,
    status: update.status,
    functionalityMap: csrParams.functionalityMap,
    egsSerialNumber: generated.egsSerialNumber,
    csrCommonName: csrParams.commonName,
    csrOrganizationName: csrParams.businessName,
    csrOrganizationalUnitName: csrParams.branchName,
    csrLocation: csrParams.location,
    csrIndustry: csrParams.industry,
    csrPem: generated.csrPem,
    publicKeyPem: generated.publicKeyPem,
    encryptedPrivateKey: update.encryptedPrivateKey,
    complianceRequestId: update.complianceRequestId,
    encryptedComplianceCsid: update.encryptedComplianceCsid,
    encryptedComplianceSecret: update.encryptedComplianceSecret,
    encryptedProductionCsid: update.encryptedProductionCsid,
    encryptedProductionSecret: update.encryptedProductionSecret,
    complianceSampleResults: update.complianceSampleResults,
    lastError: update.lastError,
    connectedAt: update.connectedAt,
  })
}
