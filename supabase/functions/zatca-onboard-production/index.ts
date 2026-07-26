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
import { requireTenantOwner, requireTenantUser, loadOwnedBranch, loadTenant } from '../_shared/zatca/auth.ts'
import { generateProductionCsr, validateCsrInputs, type CsrParams } from '../_shared/zatca/csr.ts'
import { encryptText } from '../_shared/zatca/crypto.ts'
import { isZatcaHttpError, requestComplianceCsid, requestProductionCsid } from '../_shared/zatca/client.ts'
import {
  simulatedComplianceResults,
  stripComplianceSampleDebug,
  submitComplianceSamples,
  type ComplianceSampleResult,
  type SampleSeller,
} from '../_shared/zatca/samples.ts'
import { loadSafeOnboardingStatus, saveOnboardingState } from '../_shared/zatca/storage.ts'
import { auditEvent, enforceRateLimit, hashRequestIp, rateLimitBody, requestId } from '../_shared/security.ts'

interface RequestBody {
  action?: 'onboard' | 'status' | 'preflight'
  branchId?: unknown
  otp?: unknown
  functionalityMap?: unknown
  dryRun?: unknown
  forceReconnect?: unknown
}

const STEP_ORDER: OnboardingStatus[] = [
  'generating_csr',
  'compliance_csid_requested',
  'compliance_samples_passed',
  'production_csid_requested',
  'production_connected',
]

type TraceStatus = 'pending' | 'success' | 'failed' | 'skipped'

type TraceStage =
  | 'request_received'
  | 'auth_checked'
  | 'owner_branch_loaded'
  | 'seller_data_validated'
  | 'feature_flag_checked'
  | 'csr_generated'
  | 'compliance_csid_request_started'
  | 'compliance_csid_request_completed'
  | 'compliance_credentials_saved'
  | 'compliance_samples_started'
  | 'sample_payload_built'
  | 'zatca_sample_request_started'
  | 'zatca_sample_response_received'
  | 'production_csid_request_started'
  | 'production_csid_request_completed'
  | 'production_credentials_saved'
  | 'v2_chain_initialized'

interface TraceEntry {
  stage: TraceStage
  status: TraceStatus
  timestamp?: string
  message?: string
  httpStatus?: number
  warnings?: Array<{ code?: string; message?: string }>
  errors?: Array<{ code?: string; message?: string }>
}

const TRACE_STAGES: TraceStage[] = [
  'request_received',
  'auth_checked',
  'owner_branch_loaded',
  'seller_data_validated',
  'feature_flag_checked',
  'csr_generated',
  'compliance_csid_request_started',
  'compliance_csid_request_completed',
  'compliance_credentials_saved',
  'compliance_samples_started',
  'sample_payload_built',
  'zatca_sample_request_started',
  'zatca_sample_response_received',
  'production_csid_request_started',
  'production_csid_request_completed',
  'production_credentials_saved',
  'v2_chain_initialized',
]

function rpcObject(value: any): Record<string, any> {
  if (Array.isArray(value)) return value[0] ?? {}
  return value && typeof value === 'object' ? value : {}
}

Deno.serve(async (req: Request) => {
  const trace = createTrace()
  setTrace(trace, 'request_received', 'success', 'Production onboarding request reached the Edge Function.')

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', trace }, 405)
  }

  try {
    const db = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    )
    const body = await readBody(req)
    const branchId = body.branchId

    if (!isUuid(branchId)) {
      setTrace(trace, 'owner_branch_loaded', 'failed', 'Branch ID was invalid.')
      skipPendingTrace(trace)
      return jsonResponse({ error: 'Invalid branch', trace }, 400)
    }

    if (body.action === 'status') {
      const userContext = await requireTenantUser(db, req)
      setTrace(trace, 'auth_checked', 'success', 'Authenticated tenant user confirmed.')
      const branch = await loadOwnedBranch(
        db,
        branchId,
        userContext.tenantId,
        userContext.role === 'branch' ? userContext.branchId : null,
      )
      setTrace(trace, 'owner_branch_loaded', 'success', 'Branch loaded for this tenant.')
      const status = await loadSafeOnboardingStatus(db, branch.id, userContext.tenantId)
      const readinessResult = await db.rpc('get_zatca_branch_readiness_v2', {
        p_branch_id: branch.id,
        p_user_id: userContext.userId,
      })
      const readiness = readinessResult.error ? {
        branchReady: false,
        branchBlocked: false,
        chainHeadExists: false,
        productionConnected: false,
      } : rpcObject(readinessResult.data)
      skipPendingTrace(trace, 'Status check only.')
      return jsonResponse({
        ok: true,
        ...status,
        branchReady: readiness.branchReady === true,
        branchBlocked: readiness.branchBlocked === true,
        chainHeadExists: readiness.chainHeadExists === true,
        v2Ready: readiness.structurallyReady === true,
        branchName: branch.name,
        vatNumber: branch.vat_number ?? null,
        crNumber: branch.cr_number ?? null,
        trace,
      })
    }

    const owner = await requireTenantOwner(db, req)
    setTrace(trace, 'auth_checked', 'success', 'Authenticated tenant owner confirmed.')
    const branch = await loadOwnedBranch(db, branchId, owner.tenantId)
    setTrace(trace, 'owner_branch_loaded', 'success', 'Owner branch loaded for this tenant.')
    const ipHash = await hashRequestIp(req)
    const reqId = requestId(req)
    const auditBase = {
      tenantId: owner.tenantId,
      branchId: branch.id,
      actorUserId: owner.userId,
      actorRole: 'owner',
      targetType: 'branch',
      targetId: branch.id,
      ipHash,
      requestId: reqId,
    }

    if (body.action === 'preflight') {
      await auditEvent(db as any, {
        ...auditBase,
        action: 'zatca_onboarding_preflight_attempted',
        status: 'attempted',
      })

      if (!isFunctionalityMap(body.functionalityMap)) {
        setTrace(trace, 'seller_data_validated', 'failed', 'Select a ZATCA invoice capability before preflight.')
        skipPendingTrace(trace)
        return jsonResponse({
          ok: false,
          preflight: true,
          branchId: branch.id,
          environment: 'production',
          onboardingStatus: 'failed',
          error: 'Select a ZATCA invoice capability before production onboarding.',
          trace,
        }, 400)
      }

      if ((branch.zatca_phase ?? 1) < 2) {
        setTrace(trace, 'seller_data_validated', 'failed', 'Branch is not upgraded to ZATCA Phase 2.')
        skipPendingTrace(trace)
        return jsonResponse({
          ok: false,
          preflight: true,
          branchId: branch.id,
          environment: 'production',
          onboardingStatus: 'failed',
          error: 'This branch must be upgraded to ZATCA Phase 2 first.',
          trace,
        }, 400)
      }

      const tenant = await loadTenant(db, owner.tenantId)
      const csrParams = buildCsrParams(branch, tenant, body.functionalityMap)
      const missing = [
        ...validateCsrInputs(csrParams),
        ...validateSellerLegalData(branch, tenant, csrParams),
      ]
      if (missing.length > 0) {
        setTrace(trace, 'seller_data_validated', 'failed', `Missing seller data: ${missing.join(', ')}.`)
        skipPendingTrace(trace)
        return jsonResponse({
          ok: false,
          preflight: true,
          branchId: branch.id,
          environment: 'production',
          onboardingStatus: 'failed',
          functionalityMap: body.functionalityMap,
          error: `Complete the branch/taxpayer ZATCA data first: ${missing.join(', ')}.`,
          trace,
        }, 200)
      }

      setTrace(trace, 'seller_data_validated', 'success', 'Seller legal data is sufficient for production onboarding.')
      const allowed = productionCallsAllowed()
      setTrace(
        trace,
        'feature_flag_checked',
        allowed ? 'success' : 'failed',
        allowed
          ? 'Production ZATCA calls are currently enabled.'
          : 'Production ZATCA calls are currently disabled.',
      )
      skipPendingTrace(trace, 'Preflight only. No credential generation or ZATCA calls were used.')
      await auditEvent(db as any, {
        ...auditBase,
        action: 'zatca_onboarding_preflight_completed',
        status: allowed ? 'succeeded' : 'failed',
        severity: allowed ? 'info' : 'warning',
        metadata: { productionCallsAllowed: allowed },
      })
      return jsonResponse({
        ok: allowed,
        preflight: true,
        branchId: branch.id,
        environment: 'production',
        onboardingStatus: allowed ? 'not_started' : 'failed',
        functionalityMap: body.functionalityMap,
        message: allowed
          ? 'Preflight passed. Production calls are enabled.'
          : 'Preflight completed. Production calls are still disabled.',
        trace,
      })
    }

    if (!validateOtp(body.otp)) {
      setTrace(trace, 'seller_data_validated', 'failed', 'Required 6-digit code was missing or invalid before seller validation.')
      skipPendingTrace(trace)
      return jsonResponse({ error: 'Enter the 6-digit OTP from the FATOORA portal.', trace }, 400)
    }

    if (!isFunctionalityMap(body.functionalityMap)) {
      setTrace(trace, 'seller_data_validated', 'failed', 'Invoice capability was not selected.')
      skipPendingTrace(trace)
      return jsonResponse({ error: 'Select a ZATCA invoice capability before production onboarding.', trace }, 400)
    }

    if ((branch.zatca_phase ?? 1) < 2) {
      setTrace(trace, 'seller_data_validated', 'failed', 'Branch is not upgraded to ZATCA Phase 2.')
      skipPendingTrace(trace)
      return jsonResponse({ error: 'This branch must be upgraded to ZATCA Phase 2 first.', trace }, 400)
    }

    const existingStatus = await loadSafeOnboardingStatus(db, branch.id, owner.tenantId)
    if (
      existingStatus.onboardingStatus === 'production_connected' &&
      body.forceReconnect !== true
    ) {
      setTrace(trace, 'seller_data_validated', 'failed', 'Branch is already connected to ZATCA production.')
      skipPendingTrace(trace)
      return jsonResponse({
        ok: false,
        branchId: branch.id,
        environment: 'production',
        onboardingStatus: 'production_connected',
        functionalityMap: existingStatus.functionalityMap,
        connectedAt: existingStatus.connectedAt,
        productionCsidExists: existingStatus.productionCsidExists,
        productionSecretExists: existingStatus.productionSecretExists,
        error: 'This branch is already connected. Use the advanced reconnect action to replace production credentials.',
        trace,
      }, 409)
    }

    const dryRun = body.dryRun !== false
    await auditEvent(db as any, {
      ...auditBase,
      action: dryRun ? 'zatca_onboarding_dry_run_attempted' : 'zatca_onboarding_attempted',
      severity: dryRun ? 'info' : 'warning',
      status: 'attempted',
      metadata: { dryRun, forceReconnect: body.forceReconnect === true },
    })

    if (!dryRun) {
      const rate = await enforceRateLimit(db as any, {
        ...auditBase,
        action: 'zatca_onboard_production',
        scope: 'branch',
        scopeId: branch.id,
        maxAttempts: 3,
        windowSeconds: 86400,
        metadata: { forceReconnect: body.forceReconnect === true },
      })

      if (!rate.allowed) {
        await auditEvent(db as any, {
          ...auditBase,
          action: 'zatca_onboarding_rate_limited',
          severity: 'warning',
          status: 'blocked',
          metadata: { retryAfterSeconds: rate.retryAfterSeconds },
        })
        skipPendingTrace(trace, 'Rate limited before production onboarding.')
        return jsonResponse({ ...rateLimitBody(rate), trace }, 429)
      }
    }

    const tenant = await loadTenant(db, owner.tenantId)
    logOnboardingStage('seller data loaded', { branchId: branch.id, tenantId: owner.tenantId })
    const csrParams = buildCsrParams(branch, tenant, body.functionalityMap)
    const missing = validateCsrInputs(csrParams)
    if (missing.length > 0) {
      setTrace(trace, 'seller_data_validated', 'failed', `Missing CSR data: ${missing.join(', ')}.`)
      skipPendingTrace(trace)
      return jsonResponse({
        error: `Complete the branch/taxpayer ZATCA data first: ${missing.join(', ')}.`,
        trace,
      }, 400)
    }

    const generated = await generateProductionCsr(csrParams)
    setTrace(trace, 'csr_generated', 'success', 'Generation completed inside the Edge Function.')
    logOnboardingStage('CSR generated', { branchId: branch.id })

    if (dryRun) {
      const complianceSampleResults = simulatedComplianceResults(body.functionalityMap)
      setTrace(trace, 'seller_data_validated', 'skipped', 'Dry run skips full live seller legal validation.')
      setTrace(trace, 'feature_flag_checked', 'skipped', 'Dry run does not require the production-call feature flag.')
      setTrace(trace, 'compliance_samples_started', 'skipped', 'Dry run uses simulated compliance sample results.')
      skipPendingTrace(trace, 'Dry run completed without ZATCA calls or credential storage.')
      await auditEvent(db as any, {
        ...auditBase,
        action: 'zatca_onboarding_dry_run_completed',
        status: 'succeeded',
        metadata: { functionalityMap: body.functionalityMap },
      })
      return jsonResponse({
        ok: true,
        dryRun: true,
        branchId: branch.id,
        environment: 'production',
        onboardingStatus: existingStatus.onboardingStatus === 'production_connected'
          ? 'production_connected'
          : 'not_started',
        steps: [],
        functionalityMap: body.functionalityMap,
        complianceSampleResults,
        message: 'Dry run completed. No ZATCA production APIs were called and no secrets were stored.',
        trace,
      })
    }

    const missingSellerSettings = validateSellerLegalData(branch, tenant, csrParams)
    if (missingSellerSettings.length > 0) {
      setTrace(trace, 'seller_data_validated', 'failed', `Missing seller legal data: ${missingSellerSettings.join(', ')}.`)
      skipPendingTrace(trace)
      return jsonResponse({
        error: `Missing seller legal information required for ZATCA onboarding. Complete: ${missingSellerSettings.join(', ')}.`,
        trace,
      }, 400)
    }
    setTrace(trace, 'seller_data_validated', 'success', 'Seller legal data was validated for real production onboarding.')

    if (!productionCallsAllowed()) {
      setTrace(trace, 'feature_flag_checked', 'failed', 'Production onboarding feature flag is disabled.')
      skipPendingTrace(trace)
      return jsonResponse({
        error: 'Production onboarding is disabled. Set ALLOW_ZATCA_PRODUCTION_ONBOARDING=true in Supabase Edge Function secrets before using a live OTP.',
        trace,
      }, 403)
    }
    setTrace(trace, 'feature_flag_checked', 'success', 'Production onboarding feature flag is enabled.')

    const encryptionSecret = requireEnv('ZATCA_SERVER_ENCRYPTION_KEY')
    const encryptedPrivateKey = await encryptText(generated.privateKeyPem, encryptionSecret)

    await saveState(db, owner, csrParams, generated, {
      status: 'generating_csr',
      encryptedPrivateKey,
    })

    let complianceHttpStatus: number | undefined
    setTrace(trace, 'compliance_csid_request_started', 'success', 'Production compliance CSID request started.')
    let compliance
    try {
      compliance = await requestComplianceCsid({
        baseUrl: PRODUCTION_CORE_BASE_URL,
        csrPem: generated.csrPem,
        otp: body.otp,
        onResponse: response => { complianceHttpStatus = response.httpStatus },
      })
    } catch (err) {
      const message = safeErrorMessage(err)
      setTrace(trace, 'compliance_csid_request_completed', 'failed', message, {
        httpStatus: complianceHttpStatus,
      })
      if (isZatcaHttpError(err)) {
        try {
          await saveState(db, owner, csrParams, generated, {
            status: 'compliance_failed',
            encryptedPrivateKey,
            lastError: message,
          })
        } catch (saveErr) {
          console.error('[zatca-onboard-production] compliance CSID failure save failed:', safeDiagnosticField(safeErrorMessage(saveErr), 300))
        }
        skipPendingTrace(trace)
        return jsonResponse({
          error: message,
          trace,
        }, controlledZatcaResponseStatus(err.httpStatus))
      }
      throw err
    }
    setTrace(trace, 'compliance_csid_request_completed', 'success', 'Production compliance CSID request completed.', {
      httpStatus: complianceHttpStatus,
    })
    logOnboardingStage('compliance CSID requested', {
      branchId: branch.id,
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
    setTrace(trace, 'compliance_credentials_saved', 'success', 'Encrypted compliance credentials were saved.')
    logOnboardingStage('compliance credentials stored', {
      branchId: branch.id,
    })

    let complianceSampleResults: ComplianceSampleResult[]
    try {
      logOnboardingStage('sample generation started', {
        branchId: branch.id,
        functionalityMap: body.functionalityMap,
      })
      setTrace(trace, 'compliance_samples_started', 'success', 'Compliance sample submission sequence started.')
      complianceSampleResults = await submitComplianceSamples({
        baseUrl: PRODUCTION_CORE_BASE_URL,
        functionalityMap: body.functionalityMap,
        complianceCsid: compliance.binarySecurityToken,
        complianceSecret: compliance.secret,
        complianceCertificate: compliance.binarySecurityToken,
        privateKeyPem: generated.privateKeyPem,
        seller: buildSampleSeller(branch, tenant, csrParams),
        onTrace: event => {
          setTrace(trace, event.stage, event.status, `${event.type}: ${event.message ?? event.stage}`, {
            httpStatus: event.httpStatus,
            warnings: event.redactedWarnings,
            errors: event.redactedErrors,
          })
        },
      })
    } catch (err) {
      setTrace(trace, 'compliance_samples_started', 'failed', safeErrorMessage(err))
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
        console.error('[zatca-onboard-production] compliance generation failure save failed:', safeDiagnosticField(safeErrorMessage(saveErr), 300))
      }
      skipPendingTrace(trace)
      return jsonResponse({ error: message, trace }, 501)
    }

    const samplesPassed = complianceSampleResults.every(result => result.status === 'accepted')
    if (!samplesPassed) {
      const persistentComplianceSampleResults = stripComplianceSampleDebug(complianceSampleResults)
      try {
        await saveFailedSampleDebugXml(db, owner, branch.id, complianceSampleResults)
      } catch (err) {
        console.error('[zatca-onboard-production] failed sample XML persistence skipped:', safeErrorMessage(err))
      }

      try {
        console.warn('[zatca-onboard-production] compliance sample rejection:', JSON.stringify({
          branchId: branch?.id,
          functionalityMap: body?.functionalityMap,
          complianceSampleResults: persistentComplianceSampleResults,
        }))
      } catch {
        console.warn('[zatca-onboard-production] compliance sample rejection: diagnostics stringify failed')
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
        console.error('[zatca-onboard-production] compliance diagnostics save failed:', safeErrorMessage(err))
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
          console.error('[zatca-onboard-production] fallback compliance save failed:', safeErrorMessage(fallbackErr))
        }
      }

      const failedHttpStatus = complianceSampleResults
        ?.find(result => result?.status !== 'accepted' && typeof result?.httpStatus === 'number')
        ?.httpStatus
      const responseStatus = failedHttpStatus && failedHttpStatus >= 400 && failedHttpStatus <= 599
        ? failedHttpStatus
        : 422

      skipPendingTrace(trace)
      return jsonResponse({
        error: 'Compliance sample invoices were not accepted.',
        complianceSampleResults: persistentComplianceSampleResults,
        trace,
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

    setTrace(trace, 'production_csid_request_started', 'success', 'Production CSID request started.')
    await saveState(db, owner, csrParams, generated, {
      status: 'production_csid_requested',
      encryptedPrivateKey,
      complianceRequestId: compliance.requestID,
      encryptedComplianceCsid,
      encryptedComplianceSecret,
      complianceSampleResults,
    })

    let productionHttpStatus: number | undefined
    let production
    try {
      production = await requestProductionCsid({
        baseUrl: PRODUCTION_CORE_BASE_URL,
        complianceCsid: compliance.binarySecurityToken,
        complianceSecret: compliance.secret,
        complianceRequestId: compliance.requestID,
        onResponse: response => { productionHttpStatus = response.httpStatus },
      })
    } catch (err) {
      const message = safeErrorMessage(err)
      setTrace(trace, 'production_csid_request_completed', 'failed', message, {
        httpStatus: productionHttpStatus,
      })
      if (isZatcaHttpError(err)) {
        try {
          await saveState(db, owner, csrParams, generated, {
            status: 'compliance_failed',
            encryptedPrivateKey,
            complianceRequestId: compliance.requestID,
            encryptedComplianceCsid,
            encryptedComplianceSecret,
            complianceSampleResults,
            lastError: message,
          })
        } catch (saveErr) {
          console.error('[zatca-onboard-production] production CSID failure save failed:', safeDiagnosticField(safeErrorMessage(saveErr), 300))
        }
        skipPendingTrace(trace)
        return jsonResponse({
          error: message,
          trace,
        }, controlledZatcaResponseStatus(err.httpStatus))
      }
      throw err
    }
    setTrace(trace, 'production_csid_request_completed', 'success', 'Production CSID request completed.', {
      httpStatus: productionHttpStatus,
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
    setTrace(trace, 'production_credentials_saved', 'success', 'Encrypted production credentials were saved.')

    const chainInitializationResult = await db.rpc('initialize_zatca_new_branch_chain_v2', {
      p_branch_id: branch.id,
      p_reason: 'Approved production onboarding completed for a new compliance unit.',
      p_approved_by: owner.userId,
    })
    if (chainInitializationResult.error) {
      setTrace(trace, 'v2_chain_initialized', 'failed', 'V2 chain initialization failed closed.')
      throw new Error('Production onboarding completed but branch v2 chain initialization is incomplete')
    }
    const chainInitialization = rpcObject(chainInitializationResult.data)
    const branchV2Ready = chainInitialization.branchReady === true
    setTrace(
      trace,
      'v2_chain_initialized',
      branchV2Ready ? 'success' : 'skipped',
      branchV2Ready
        ? 'New production branch chain initialized with the approved first counter and PIH.'
        : 'Historical branch remains on legacy pending controlled chain reconciliation.',
    )

    await auditEvent(db as any, {
      ...auditBase,
      action: 'zatca_onboarding_completed',
      severity: 'warning',
      status: 'succeeded',
      metadata: {
        functionalityMap: body.functionalityMap,
        branchV2Ready,
        chainInitializationReason: safeDiagnosticField(chainInitialization.reason, 120),
      },
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
      branchV2Ready,
      chainInitialized: chainInitialization.initialized === true,
      checkoutMode: branchV2Ready ? 'v2' : 'legacy',
      trace,
    })
  } catch (err) {
    const message = safeErrorMessage(err)
    const debug = buildSafeFailureLog(err, 'top-level')
    markFirstPendingFailed(trace, message)
    skipPendingTrace(trace)
    console.error('[zatca-onboard-production] top-level failure:', JSON.stringify(debug))
    const status = message === 'Unauthorized' ? 401 : message.startsWith('Forbidden') ? 403 : 500
    return jsonResponse({
      error: message,
      trace,
    }, status)
  }
})

function createTrace(): TraceEntry[] {
  return TRACE_STAGES.map(stage => ({
    stage,
    status: 'pending',
  }))
}

function setTrace(
  trace: TraceEntry[],
  stage: TraceStage,
  status: TraceStatus,
  message?: unknown,
  extra?: {
    httpStatus?: number
    warnings?: Array<{ code?: string; message?: string }>
    errors?: Array<{ code?: string; message?: string }>
  },
): void {
  const item = trace.find(entry => entry.stage === stage)
  if (!item) return
  item.status = status
  item.timestamp = new Date().toISOString()
  item.message = safeTraceMessage(message)
  if (typeof extra?.httpStatus === 'number') item.httpStatus = extra.httpStatus
  item.warnings = safeTraceMessages(extra?.warnings)
  item.errors = safeTraceMessages(extra?.errors)
}

function skipPendingTrace(trace: TraceEntry[], message = 'Skipped because the flow stopped before this stage.'): void {
  for (const item of trace) {
    if (item.status !== 'pending') continue
    item.status = 'skipped'
    item.timestamp = new Date().toISOString()
    item.message = safeTraceMessage(message)
  }
}

function markFirstPendingFailed(trace: TraceEntry[], message: unknown): void {
  if (trace.some(entry => entry.status === 'failed')) return
  const item = trace.find(entry => entry.status === 'pending')
  if (!item) return
  item.status = 'failed'
  item.timestamp = new Date().toISOString()
  item.message = safeTraceMessage(message) ?? 'Flow failed before this stage completed.'
}

function controlledZatcaResponseStatus(httpStatus: number): number {
  return httpStatus >= 400 && httpStatus <= 599 ? httpStatus : 502
}

function safeTraceMessages(values: unknown): Array<{ code?: string; message?: string }> | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined
  const sanitized = values.slice(0, 5).map((item: any) => ({
    code: safeTraceMessage(item?.code),
    message: safeTraceMessage(item?.message),
  })).filter(item => item.code || item.message)
  return sanitized.length > 0 ? sanitized : undefined
}

function safeTraceMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const cleaned = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
  if (!cleaned) return undefined
  if (/otp|secret|token|certificate|private[_ -]?key|authorization|csr|<\?xml|<Invoice|signedInvoiceXmlBase64|signed_invoice_xml_base64|encryption key/i.test(cleaned)) {
    return 'Sensitive detail redacted.'
  }
  return cleaned
}

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
    if (Deno.env.get('ZATCA_CAPTURE_DEBUG_XML') !== 'true') return

    const failed = (Array.isArray(results) ? results : []).find(result =>
      result?.status !== 'accepted' && typeof result?.debugSignedInvoiceXmlBase64 === 'string'
    )
    if (!failed?.debugSignedInvoiceXmlBase64) return

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
      console.error('[zatca-onboard-production] failed sample XML save failed:', {
        message: error.message,
        code: error.code,
      })
    }
  } catch (err) {
    console.error('[zatca-onboard-production] failed sample XML save crashed:', safeErrorMessage(err))
  }
}

function safeDebugString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, '').slice(0, maxLength)
  return cleaned.length > 0 ? cleaned : null
}

function logComplianceGenerationException(err: unknown): void {
  try {
    console.error('[zatca-onboard-production] compliance sample generation exception:', JSON.stringify({
      sampleType: 'unknown',
      errorName: safeDiagnosticField(err instanceof Error ? err.name : typeof err, 120),
      message: safeDiagnosticField(err instanceof Error ? err.message : String(err ?? 'unknown'), 300),
    }))
  } catch {
    console.error('[zatca-onboard-production] compliance sample generation exception: diagnostics stringify failed')
  }
}

function logOnboardingStage(stage: string, context?: Record<string, unknown>): void {
  try {
    const safeContext: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(context ?? {})) {
      safeContext[key] = safeDiagnosticField(String(value ?? ''), 160)
    }
    console.info('[zatca-onboard-production] stage:', JSON.stringify({
      stage: safeStageField(stage, 120),
      ...safeContext,
    }))
  } catch {
    console.info('[zatca-onboard-production] stage: diagnostics stringify failed')
  }
}

function buildSafeFailureLog(err: unknown, stage: string): Record<string, string | undefined> {
  return {
    stage: safeStageField(stage, 120),
    errorName: safeDiagnosticField(err instanceof Error ? err.name : typeof err, 120),
    message: safeDiagnosticField(err instanceof Error ? err.message : String(err ?? 'unknown'), 500),
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
