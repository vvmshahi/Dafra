const SAFE_CORRELATION_HEADERS = [
  'x-request-id',
  'x-correlation-id',
  'request-id',
  'traceparent',
]

const SENSITIVE_PATTERN = /(?:otp|authorization|bearer|secret|binarysecuritytoken|private[ _-]?key|\bcsr\b|certificate|token|csid)/i

export class SandboxComplianceRequestError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'SandboxComplianceRequestError'
    this.httpStatus = options.httpStatus
    this.requiresReconciliation = options.requiresReconciliation === true
    this.retrySafe = options.retrySafe === true
    this.sandboxComplianceEvidence = options.evidence ?? {}
  }
}

export function isSandboxComplianceRequestError(error) {
  return error instanceof SandboxComplianceRequestError ||
    (error instanceof Error && error.name === 'SandboxComplianceRequestError')
}

/**
 * Runs a Compliance-CSID request while making every safe lifecycle boundary
 * observable. Callers own persistence so the same credential-row lock guards
 * every transition. This module never retains or returns raw request bodies in
 * diagnostics; the successful credential material is returned only to the
 * caller that encrypts it immediately.
 */
export async function requestSandboxComplianceCsidWithEvidence(params) {
  const {
    endpoint,
    csrPem,
    otp,
    timeoutMs,
    onDispatching,
    onResponseReceived,
    onDefinitiveFailure,
    onSuccessEvidence,
    persistCredential,
    fetchImpl = fetch,
    baseEvidence = {},
  } = params

  await runCallback(onDispatching, {
    phase: 'dispatching',
  }, {
    message: 'Sandbox Compliance request was not dispatched because dispatch evidence could not be persisted.',
    requiresReconciliation: false,
    retrySafe: true,
    outcome: 'definitive_failure',
    dispatchState: 'not_dispatched',
    errorClass: 'database_persistence_before_dispatch',
    responseEvidence: baseEvidence,
  })

  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-version': 'V2',
        'accept-language': 'en',
        'Content-Type': 'application/json',
        OTP: otp,
      },
      body: JSON.stringify({ csr: btoa(csrPem) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (cause) {
    const timeout = isTimeoutError(cause)
    throw new SandboxComplianceRequestError(
      timeout
        ? 'The Sandbox compliance request timed out before a response was received. Retry the same step.'
        : 'The Sandbox compliance request did not return an HTTP response. Manual reconciliation is required before retrying.',
      {
        requiresReconciliation: !timeout,
        retrySafe: timeout,
        evidence: {
          ...baseEvidence,
          dispatchState: 'dispatching',
          outcome: timeout ? 'timeout_retryable' : 'unknown',
          responseClassification: timeout ? 'abort_timeout' : 'network_or_runtime_failure',
          safeError: safeErrorDiagnostic(cause, timeout ? 'abort_timeout' : 'network_or_runtime_failure'),
        },
      },
    )
  }

  const responseEvidence = {
    ...baseEvidence,
    dispatchState: 'response_received',
    upstreamHttpStatus: response.status,
    upstreamResponseReceivedAt: new Date().toISOString(),
    contentType: safeContentType(response.headers.get('content-type')),
    correlationHeaders: safeCorrelationHeaders(response.headers),
    responseClassification: 'http_response_received',
  }

  await runCallback(onResponseReceived, responseEvidence, {
    message: 'Sandbox Compliance response was received, but its evidence could not be persisted. Manual reconciliation is required before retrying.',
    requiresReconciliation: true,
    retrySafe: false,
    outcome: 'unknown',
    dispatchState: 'response_received',
    errorClass: 'database_persistence_after_response',
    responseEvidence,
  })

  let raw
  try {
    raw = await response.text()
  } catch (cause) {
    if (!response.ok) {
      return throwDefinitiveHttpFailure({
        response,
        responseEvidence,
        baseEvidence,
        onDefinitiveFailure,
        errorCode: null,
        category: 'response_body_read_failure',
        message: `ZATCA compliance request failed (${response.status})`,
        cause,
      })
    }
    throw new SandboxComplianceRequestError(
      'Sandbox Compliance response body could not be read after an HTTP response. Manual reconciliation is required before retrying.',
      {
        requiresReconciliation: true,
        evidence: {
          ...baseEvidence,
          ...responseEvidence,
          outcome: 'unknown',
          responseClassification: 'response_body_read_failure',
          safeError: safeErrorDiagnostic(cause, 'response_body_read_failure'),
        },
      },
    )
  }

  let body
  try {
    body = JSON.parse(raw)
  } catch (cause) {
    if (!response.ok) {
      return throwDefinitiveHttpFailure({
        response,
        responseEvidence,
        baseEvidence,
        onDefinitiveFailure,
        errorCode: null,
        category: 'non_json_error_response',
        message: `ZATCA compliance request failed (${response.status})`,
        cause,
      })
    }
    throw new SandboxComplianceRequestError(
      'Sandbox Compliance returned malformed JSON after an HTTP success response. Manual reconciliation is required before retrying.',
      {
        requiresReconciliation: true,
        evidence: {
          ...baseEvidence,
          ...responseEvidence,
          outcome: 'unknown',
          responseClassification: 'json_parse_failure',
          safeError: safeErrorDiagnostic(cause, 'json_parse_failure'),
        },
      },
    )
  }

  if (!response.ok) {
    return throwDefinitiveHttpFailure({
      response,
      responseEvidence,
      baseEvidence,
      onDefinitiveFailure,
      errorCode: safeErrorCode(body),
      category: safeErrorCategory(body),
      message: safeUpstreamMessage(body, `ZATCA compliance request failed (${response.status})`),
    })
  }

  const compliance = normalizeComplianceSuccess(body)
  if (!compliance) {
    throw new SandboxComplianceRequestError(
      'Sandbox Compliance returned an invalid success-response schema. Manual reconciliation is required before retrying.',
      {
        requiresReconciliation: true,
        evidence: {
          ...baseEvidence,
          ...responseEvidence,
          outcome: 'local_application_validation_failure',
          responseClassification: 'local_application_validation_failure',
          credentialMaterial: credentialMaterialPresence(body),
          safeError: { class: 'local_application_validation_failure', name: 'ComplianceResponseValidationError' },
        },
      },
    )
  }

  const successEvidence = {
    ...baseEvidence,
    ...responseEvidence,
    outcome: 'success_response_received',
    responseClassification: 'success',
    requestIdFingerprint: await fingerprintText(compliance.requestID),
    dispositionMessage: safeDispositionMessage(body.dispositionMessage),
    credentialMaterial: credentialMaterialPresence(compliance),
  }

  await runCallback(onSuccessEvidence, { body: compliance, evidence: successEvidence }, {
    message: 'Sandbox Compliance success response was received, but the safe evidence could not be persisted. Manual reconciliation is required before retrying.',
    requiresReconciliation: true,
    retrySafe: false,
    outcome: 'unknown',
    dispatchState: 'response_received',
    errorClass: 'database_persistence_after_success_response',
    responseEvidence: successEvidence,
  })

  try {
    return await persistCredential(compliance, successEvidence)
  } catch (cause) {
    throw new SandboxComplianceRequestError(
      'Sandbox Compliance success was received, but credential persistence is incomplete. Manual reconciliation is required before retrying.',
      {
        requiresReconciliation: true,
        retrySafe: false,
        evidence: {
          ...baseEvidence,
          ...successEvidence,
          outcome: 'success_response_received_persistence_incomplete',
          responseClassification: 'success_persistence_incomplete',
          safeError: safeErrorDiagnostic(cause, 'database_persistence_after_success_response'),
        },
      },
    )
  }
}

async function throwDefinitiveHttpFailure({
  response,
  responseEvidence,
  baseEvidence,
  onDefinitiveFailure,
  errorCode,
  category,
  message,
  cause,
}) {
  const evidence = {
    ...baseEvidence,
    ...responseEvidence,
    outcome: 'definitive_failure',
    responseClassification: 'definitive_failure',
    upstreamError: {
      code: errorCode,
      category,
      message: safeText(message, `ZATCA compliance request failed (${response.status})`),
    },
    ...(cause ? { safeError: safeErrorDiagnostic(cause, category) } : {}),
  }
  await runCallback(onDefinitiveFailure, evidence, {
    message: 'A definitive Sandbox Compliance HTTP response was received, but its diagnostics could not be persisted.',
    requiresReconciliation: false,
    retrySafe: true,
    outcome: 'definitive_failure',
    dispatchState: 'response_received',
    errorClass: 'database_persistence_after_definitive_response',
    responseEvidence: evidence,
    httpStatus: response.status,
  })
  throw new SandboxComplianceRequestError(evidence.upstreamError.message, {
    httpStatus: response.status,
    requiresReconciliation: false,
    retrySafe: true,
    evidence,
  })
}

async function runCallback(callback, value, failure) {
  if (!callback) return
  try {
    await callback(value)
  } catch (cause) {
    throw new SandboxComplianceRequestError(failure.message, {
      httpStatus: failure.httpStatus,
      requiresReconciliation: failure.requiresReconciliation,
      retrySafe: failure.retrySafe,
      evidence: {
        ...(failure.responseEvidence ?? {}),
        dispatchState: failure.dispatchState,
        outcome: failure.outcome,
        responseClassification: failure.errorClass,
        safeError: safeErrorDiagnostic(cause, failure.errorClass),
      },
    })
  }
}

export function normalizeSandboxComplianceRequestId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : null
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > 128) return null
  if (/^(?:NaN|Infinity|-Infinity)$/i.test(value)) return null
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+e[+-]?\d+)$/i.test(value)) return null
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null
}

function normalizeComplianceSuccess(body) {
  const requestID = normalizeSandboxComplianceRequestId(body?.requestID)
  return body && typeof body === 'object' &&
    typeof body.binarySecurityToken === 'string' && body.binarySecurityToken.length > 0 &&
    typeof body.secret === 'string' && body.secret.length > 0 &&
    requestID
    ? {
      binarySecurityToken: body.binarySecurityToken,
      secret: body.secret,
      requestID,
    }
    : null
}

function credentialMaterialPresence(body) {
  return {
    binarySecurityToken: typeof body?.binarySecurityToken === 'string' && body.binarySecurityToken.length > 0,
    secret: typeof body?.secret === 'string' && body.secret.length > 0,
    requestID: normalizeSandboxComplianceRequestId(body?.requestID) !== null,
  }
}

function safeErrorCode(body) {
  const value = body?.errors?.[0]?.code ?? body?.code ?? body?.errorCode
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(value) ? value : null
}

function safeErrorCategory(body) {
  const value = body?.errors?.[0]?.category ?? body?.category ?? body?.error
  return typeof value === 'string' && /^[A-Za-z0-9 ._:-]{1,120}$/.test(value) && !SENSITIVE_PATTERN.test(value)
    ? value
    : 'upstream_http_error'
}

function safeUpstreamMessage(body, fallback) {
  const value = body?.errors?.[0]?.message ?? body?.message ?? body?.error
  return safeText(value, fallback)
}

function safeDispositionMessage(value) {
  return typeof value === 'string' ? safeText(value, null) : null
}

function safeContentType(value) {
  if (typeof value !== 'string') return null
  const normalized = value.split(';', 1)[0].trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized) ? normalized : null
}

function safeCorrelationHeaders(headers) {
  const result = {}
  for (const name of SAFE_CORRELATION_HEADERS) {
    const value = headers.get(name)
    if (typeof value === 'string' && /^[A-Za-z0-9._:/=-]{1,256}$/.test(value) && !SENSITIVE_PATTERN.test(value)) {
      result[name] = value
    }
  }
  return result
}

function safeErrorDiagnostic(error, classification) {
  const name = error instanceof Error && /^[A-Za-z0-9._-]{1,120}$/.test(error.name)
    ? error.name
    : 'Error'
  const message = error instanceof Error ? safeText(error.message, null) : null
  return { class: classification, name, ...(message ? { message } : {}) }
}

function safeText(value, fallback) {
  if (typeof value !== 'string') return fallback
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240)
  return normalized && !SENSITIVE_PATTERN.test(normalized) ? normalized : fallback
}

function isTimeoutError(error) {
  return error instanceof DOMException && error.name === 'TimeoutError' ||
    error instanceof Error && /timeout/i.test(error.name)
}

async function fingerprintText(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
