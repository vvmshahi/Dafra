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
  stripComplianceSampleDebug,
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
    logOnboardingStage('auth loaded')
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
    logOnboardingStage('seller data loaded', { branchId: branch.id, tenantId: owner.tenantId })
    const csrParams = buildCsrParams(branch, tenant, body.functionalityMap)
    const missing = validateCsrInputs(csrParams)
    if (missing.length > 0) {
      return jsonResponse({
        error: `Complete the branch/taxpayer ZATCA data first: ${missing.join(', ')}.`,
      }, 400)
    }

    const generated = await generateProductionCsr(csrParams)
    logOnboardingStage('CSR generated', { branchId: branch.id })

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

    const missingSellerSettings = validateSellerLegalData(branch, tenant, csrParams)
    if (missingSellerSettings.length > 0) {
      return jsonResponse({
        error: `Missing seller legal information required for ZATCA onboarding. Complete: ${missingSellerSettings.join(', ')}.`,
      }, 400)
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
    logOnboardingStage('compliance CSID requested', {
      branchId: branch.id,
      requestId: compliance.requestID,
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
    logOnboardingStage('compliance credentials stored', {
      branchId: branch.id,
      requestId: compliance.requestID,
    })

    let complianceSampleResults: ComplianceSampleResult[]
    try {
      logOnboardingStage('sample generation started', {
        branchId: branch.id,
        functionalityMap: body.functionalityMap,
      })
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
      logComplianceGenerationException(err)
      const message = safeErrorMessage(err)
      try {
        await saveState(db, owner, csrParams, generated, {
          status: 'compliance_failed',
          encryptedPrivateKey,
          complianceRequestId: compliance.requestID,
          encryptedComplianceCsid,
          encryptedComplianceSecret,
          complianceSampleResults: [],
          lastError: message,
        })
      } catch (saveErr) {
        console.error('[zatca-onboard-production] TEMPORARY DEBUG compliance generation failure save failed:', safeDiagnosticField(safeErrorMessage(saveErr), 300))
      }
      return jsonResponse({ error: message }, 501)
    }

    const samplesPassed = complianceSampleResults.every(result => result.status === 'accepted')
    if (!samplesPassed) {
      const persistentComplianceSampleResults = stripComplianceSampleDebug(complianceSampleResults)
      try {
        await saveFailedSampleDebugXml(db, owner, branch.id, complianceSampleResults)
      } catch (err) {
        // TEMPORARY DEBUG: failed XML persistence is diagnostic only and must
        // never turn a controlled sample rejection into EDGE_FUNCTION_ERROR.
        console.error('[zatca-onboard-production] TEMPORARY DEBUG failed sample XML persistence threw:', safeErrorMessage(err))
      }

      // TEMPORARY DEBUG: return and log redacted ZATCA compliance diagnostics so
      // the next live OTP attempt shows the real sample rejection reason.
      try {
        console.error('[zatca-onboard-production] TEMPORARY DEBUG compliance sample rejection:', JSON.stringify({
          branchId: branch?.id,
          functionalityMap: body?.functionalityMap,
          complianceSampleResults: persistentComplianceSampleResults,
        }))
      } catch {
        console.error('[zatca-onboard-production] TEMPORARY DEBUG compliance sample rejection: diagnostics stringify failed')
      }

      try {
        await saveState(db, owner, csrParams, generated, {
          status: 'compliance_failed',
          encryptedPrivateKey,
          complianceRequestId: compliance.requestID,
          encryptedComplianceCsid,
          encryptedComplianceSecret,
          complianceSampleResults: persistentComplianceSampleResults,
          lastError: 'Compliance sample invoices were not accepted.',
        })
      } catch (err) {
        // TEMPORARY DEBUG: diagnostic persistence must not turn the original
        // ZATCA sample rejection into EDGE_FUNCTION_ERROR.
        console.error('[zatca-onboard-production] TEMPORARY DEBUG compliance diagnostics save failed:', safeErrorMessage(err))
        try {
          await saveState(db, owner, csrParams, generated, {
            status: 'compliance_failed',
            encryptedPrivateKey,
            complianceRequestId: compliance.requestID,
            encryptedComplianceCsid,
            encryptedComplianceSecret,
            complianceSampleResults: [],
            lastError: 'Compliance sample invoices were not accepted.',
          })
        } catch (fallbackErr) {
          console.error('[zatca-onboard-production] TEMPORARY DEBUG fallback compliance save failed:', safeErrorMessage(fallbackErr))
        }
      }

      const failedHttpStatus = complianceSampleResults
        ?.find(result => result?.status !== 'accepted' && typeof result?.httpStatus === 'number')
        ?.httpStatus
      const responseStatus = failedHttpStatus && failedHttpStatus >= 400 && failedHttpStatus <= 599
        ? failedHttpStatus
        : 422

      return jsonResponse({
        error: 'Compliance sample invoices were not accepted.',
        complianceSampleResults: persistentComplianceSampleResults,
      }, responseStatus)
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
    const debug = buildSafeDebugError(err, 'top-level')
    console.error('[zatca-onboard-production] TEMPORARY DEBUG top-level failure:', JSON.stringify(debug))
    const status = message === 'Unauthorized' ? 401 : message.startsWith('Forbidden') ? 403 : 500
    return jsonResponse({
      error: message,
      // TEMPORARY DEBUG: remove after live ZATCA onboarding crash is isolated.
      debug,
    }, status)
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
    crNumber: branch.cr_number || tenant.cr_number,
    street: branch.street || tenant.street,
    buildingNumber: branch.building_number || tenant.building_number,
    district: branch.district || tenant.district,
    city: branch.city || tenant.city,
    postalCode: branch.postal_code || tenant.postal_code,
    countryCode: branch.country || tenant.country,
  }
}

function validateSellerLegalData(branch: any, tenant: any, csrParams: CsrParams): string[] {
  const missing: string[] = []
  const crNumber = branch.cr_number || tenant.cr_number
  const buildingNumber = branch.building_number || tenant.building_number
  const street = branch.street || tenant.street
  const district = branch.district || tenant.district
  const city = branch.city || tenant.city
  const postalCode = branch.postal_code || tenant.postal_code
  const country = branch.country || tenant.country

  if (!csrParams.businessName.trim()) missing.push('legal/business name')
  if (!/^3\d{13}3$/.test(csrParams.vatNumber)) missing.push('valid VAT number')
  if (!valuePresent(crNumber)) missing.push('CR number or official seller identifier')
  if (!/^\d{4}$/.test(String(buildingNumber ?? ''))) missing.push('4-digit building number')
  if (!valuePresent(street)) missing.push('street name')
  if (!valuePresent(district)) missing.push('district')
  if (!valuePresent(city)) missing.push('city')
  if (!/^\d{5}$/.test(String(postalCode ?? ''))) missing.push('5-digit postal code')
  if (!valuePresent(country)) missing.push('country code')

  return missing
}

function valuePresent(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
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

async function saveFailedSampleDebugXml(
  db: any,
  owner: { userId: string; tenantId: string },
  branchId: string,
  results: ComplianceSampleResult[] | undefined,
): Promise<void> {
  try {
    const failed = (Array.isArray(results) ? results : []).find(result =>
      result?.status !== 'accepted' && typeof result?.debugSignedInvoiceXmlBase64 === 'string'
    )
    if (!failed?.debugSignedInvoiceXmlBase64) return

    // TEMPORARY DEBUG: persist exact failed sample XML for local SDK validation.
    // This stores signed invoice XML only; never OTP, private key, CSID secret,
    // production secret, or encryption key.
    const signedInvoiceXmlBase64 = safeDebugString(failed.debugSignedInvoiceXmlBase64, 120_000)
    if (!signedInvoiceXmlBase64) return

    const { error } = await db
      .from('zatca_production_debug_samples')
      .insert({
        tenant_id: owner.tenantId,
        branch_id: branchId,
        sample_type: safeDebugString(failed.type, 80) ?? 'unknown',
        invoice_hash: safeDebugString(failed.debugInvoiceHash, 500),
        signed_invoice_xml_base64: signedInvoiceXmlBase64,
        issue_date: safeDebugString(failed.debugIssueDate, 40),
        issue_time: safeDebugString(failed.debugIssueTime, 40),
        qr_timestamp: safeDebugString(failed.debugQrTimestamp, 80),
        transformed_canonical_hash: safeDebugString(failed.debugTransformedCanonicalHash, 500),
      })

    if (error) {
      console.error('[zatca-onboard-production] TEMPORARY DEBUG failed sample XML save failed:', {
        message: error.message,
        code: error.code,
      })
    }
  } catch (err) {
    console.error('[zatca-onboard-production] TEMPORARY DEBUG failed sample XML save crashed:', safeErrorMessage(err))
  }
}

function safeDebugString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, '').slice(0, maxLength)
  return cleaned.length > 0 ? cleaned : null
}

function logComplianceGenerationException(err: unknown): void {
  try {
    // TEMPORARY DEBUG: top-level generation guard. Do not log XML, OTP, keys,
    // CSID secrets, production secrets, encryption keys, or Authorization data.
    console.error('[zatca-onboard-production] TEMPORARY DEBUG compliance sample generation exception:', JSON.stringify({
      sampleType: 'unknown',
      errorName: safeDiagnosticField(err instanceof Error ? err.name : typeof err, 120),
      message: safeDiagnosticField(err instanceof Error ? err.message : String(err ?? 'unknown'), 300),
      stack: safeDiagnosticField(err instanceof Error ? err.stack : undefined, 1600),
    }))
  } catch {
    console.error('[zatca-onboard-production] TEMPORARY DEBUG compliance sample generation exception: diagnostics stringify failed')
  }
}

function logOnboardingStage(stage: string, context?: Record<string, unknown>): void {
  try {
    const safeContext: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(context ?? {})) {
      safeContext[key] = safeDiagnosticField(String(value ?? ''), 160)
    }
    console.error('[zatca-onboard-production] TEMPORARY DEBUG stage:', JSON.stringify({
      stage: safeStageField(stage, 120),
      ...safeContext,
    }))
  } catch {
    console.error('[zatca-onboard-production] TEMPORARY DEBUG stage: diagnostics stringify failed')
  }
}

function buildSafeDebugError(err: unknown, stage: string): Record<string, string | undefined> {
  return {
    stage: safeStageField(stage, 120),
    errorName: safeDiagnosticField(err instanceof Error ? err.name : typeof err, 120),
    message: safeDiagnosticField(err instanceof Error ? err.message : String(err ?? 'unknown'), 500),
    stack: safeDiagnosticField(err instanceof Error ? err.stack : undefined, 2400),
  }
}

function safeStageField(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  return cleaned || undefined
}

function safeDiagnosticField(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
  if (!cleaned) return undefined
  if (/otp|secret|csid|token|certificate|private[_ -]?key|authorization|csr|<\?xml|<Invoice|signedInvoiceXmlBase64|signed_invoice_xml_base64/i.test(cleaned)) {
    return 'Sensitive detail redacted.'
  }
  return cleaned
}
